// Fishing rules, shared by the game and the server (server/src/fishing.js imports this file).
// The server rolls what bites (from the player's rod), and when a catch is claimed it replays the
// player's pull / release log through the same challenge below — a fish only counts if the replay lands
// it. So a client can't just say "I caught a large fish". Plain JavaScript: no browser or three.js here.
//
// The challenge after a bite:
//  1. HOOK    — the fish bites: pull (S / PULL) within the hook window, or it gets away.
//  2. RESIST  — the fish fights: RELEASE. Pulling now sends the line tension up fast; at 100 % it snaps.
//  3. TIRED   — the fish weakens: PULL and hold until one pull is reeled in. A tired window that passes
//               without a finished pull is a miss; too many misses and the fish escapes.
//  RESIST and TIRED take turns until enough pulls are done. Bigger fish fight harder and need more pulls;
//  better rods keep the tension lower, reel faster, allow more misses and give a longer hook window.

// fish that can bite. strength: how hard it fights · pulls: [min, max] pulls to land it ·
// resist / tired: [min, max] seconds of each phase · weight: kg (just for the collection)
export const FISH = {
  fish_small:  { strength: 0.75, pulls: [2, 3], resist: [0.7, 1.2], tired: [1.4, 2.1], weight: [0.2, 0.7] },
  fish_medium: { strength: 1.15, pulls: [4, 5], resist: [0.9, 1.6], tired: [1.2, 1.9], weight: [0.8, 2.4] },
  fish_large:  { strength: 1.6,  pulls: [6, 8], resist: [1.1, 2.0], tired: [1.0, 1.7], weight: [3.0, 7.5] },
};
// rods. control: tension rises slower and pulls reel in faster · misses: missed pulls allowed ·
// hook: seconds to set the hook after a bite · bite: chance that anything bites at all ·
// odds: which fish bites (a rod can't hook fish that aren't in its list — large needs Level 3)
export const RODS = {
  1: { name: 'Basic Wooden Rod', control: 0.85, misses: 1, hook: 1.1, bite: 0.8, odds: { fish_small: 0.8, fish_medium: 0.2 } },
  2: { name: 'Steel Grip Rod', control: 1.0, misses: 2, hook: 1.3, bite: 0.88, odds: { fish_small: 0.62, fish_medium: 0.38 } },
  3: { name: 'Advanced Fibre Rod', control: 1.25, misses: 2, hook: 1.5, bite: 0.93, odds: { fish_small: 0.42, fish_medium: 0.36, fish_large: 0.22 } },
};
export const BITE_WAIT = [3000, 10000];   // ms between the cast and the bite
export const GIVE_UP = 13000;             // ms after which nothing will bite (worm lost)
export const STEP = 50;                   // ms per simulation step (game and server step the same way)
export const MAX_MS = 120000;             // a challenge never lasts longer than this
export const SAFE = 0.55, DANGER = 0.8;   // tension zones (for the meter); 1.0 = the line snaps
// how fast the tension rises when pulling while the fish fights / while it is tired, and seconds of holding
// for one pull (both scaled by the fish's strength and the rod's control). Tuned with a simulated player:
// reacting in ~0.45 s lands almost every small fish, ~3 of 4 medium fish on the Basic rod, nearly all on
// the Steel rod, and most large fish on the Fibre rod; a slow, careless player loses most big fish.
export const T = { PULL_HARD: 1.0, PULL_TIRED: 0.25, PULL_S: 0.7 };

// small seeded random generator (same numbers on every device)
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const between = (r, [a, b]) => a + (b - a) * r();
const pick = (r, odds) => { let x = r() * Object.values(odds).reduce((s, v) => s + v, 0); for (const [k, v] of Object.entries(odds)) { if ((x -= v) < 0) return k; } return Object.keys(odds)[0]; };

// the server decides what a cast brings (rand: () => 0..1)
export function rollCast(rodLevel, rand) {
  const R = RODS[rodLevel] || RODS[1], seed = Math.floor(rand() * 2 ** 31);
  if (rand() > R.bite) return { fish: null, biteMs: null, pulls: 0, weight: 0, seed };
  const fish = pick(rand, R.odds), F = FISH[fish];
  let pulls = Math.round(between(rand, F.pulls));
  if (rodLevel >= 3 && fish !== 'fish_small') pulls = Math.max(F.pulls[0] - 1, pulls - 1);   // the best rod lands big fish quicker
  return { fish, pulls, seed, biteMs: Math.round(between(rand, BITE_WAIT)), weight: Math.round(between(rand, F.weight) * 100) / 100 };
}

// a new challenge (spec: { seed, fish, rod, pulls })
export function startChallenge(spec) {
  const F = FISH[spec.fish] || FISH.fish_small, R = RODS[spec.rod] || RODS[1];
  return { F, R, r: rng((spec.seed ^ 0x5bd1e995) >>> 0), need: spec.pulls, t: 0, tension: 0.15, pulls: 0, misses: 0, pp: 0,
    phase: 'hook', left: R.hook, done: false, ok: false, why: '', pulling: false };
}
// advance one STEP with the input held (true) or not
export function step(s, pulling) {
  if (s.done) return s;
  const dt = STEP / 1000, F = s.F, R = s.R;
  s.t += STEP; s.left -= dt; s.pulling = pulling;
  const end = (ok, why) => { s.done = true; s.ok = ok; s.why = why; return s; };
  if (s.phase === 'hook') {
    if (pulling) return next(s, 'resist');
    if (s.left <= 0) return end(false, 'missed');
    return s;
  }
  if (s.phase === 'resist') s.tension += pulling ? T.PULL_HARD * F.strength / R.control * dt : -0.55 * dt;
  else {                                                     // tired
    s.tension += pulling ? T.PULL_TIRED * F.strength / R.control * dt : -0.45 * dt;
    if (pulling) {
      s.pp += dt * R.control / T.PULL_S;
      if (s.pp >= 1) {
        s.pp = 0; s.pulls++;
        if (s.pulls >= s.need) return end(true, 'caught');
        return next(s, 'resist');
      }
    }
  }
  s.tension = Math.max(0, s.tension);
  if (s.tension >= 1) return end(false, 'snap');
  if (s.t >= MAX_MS) return end(false, 'timeout');
  if (s.left <= 0) {
    if (s.phase === 'tired') { s.misses++; s.pp = 0; if (s.misses > R.misses) return end(false, 'slack'); }
    return next(s, s.phase === 'resist' ? 'tired' : 'resist');
  }
  return s;
}
function next(s, phase) {
  s.phase = phase;
  s.left = between(s.r, phase === 'resist' ? s.F.resist : s.F.tired);
  return s;
}
// the input at time t (ms since the bite) from a log of changes [[t, 1 | 0], ...] in time order
export function inputAt(log, t) {
  let v = 0;
  for (const e of log) { if (e[0] > t) break; v = e[1]; }
  return !!v;
}
// replay a whole challenge from its log (the server's check; the game steps the same way while playing)
export function runChallenge(spec, log) {
  const s = startChallenge(spec);
  while (!s.done) step(s, inputAt(log, s.t));
  return { ok: s.ok, why: s.why, t: s.t, pulls: s.pulls };
}
// a log is a short list of [ms, 0|1] with rising times (anything else is rejected)
export function cleanLog(raw) {
  if (!Array.isArray(raw) || raw.length > 600) return null;
  const out = [];
  let last = -1;
  for (const e of raw) {
    if (!Array.isArray(e) || e.length !== 2) return null;
    const t = Number(e[0]), v = Number(e[1]);
    if (!Number.isInteger(t) || t < 0 || t > MAX_MS || t < last || (v !== 0 && v !== 1)) return null;
    out.push([t, v]); last = t;
  }
  return out;
}
export const WHY = {
  caught: 'Caught!',
  missed: 'The fish got away — pull as soon as it bites!',
  snap: 'Too much tension — the line snapped! Release while the fish fights.',
  slack: 'The line went slack and the fish escaped — pull when it tires.',
  timeout: 'The fish escaped.',
};
