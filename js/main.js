import * as THREE from 'three';
import { World } from './world.js';
import { RV } from './rv.js';
import { Player } from './player.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { audio } from './audio.js';
import { Inventory } from './inventory.js';
import { Gear } from './gear.js';
import { Drone } from './drone.js';
import { BridgeWorld, AXLE_LOAD, PLAYER_LOAD } from './bridge.js';
import { BridgeEditor } from './bridgeEditor.js';
import { Obstacles } from './obstacles.js';
import { Materials, MAT_INFO } from './materials.js';
import { MiniMap } from './minimap.js';
import { START, CAMP, BRIDGE } from './terrain.js';
import { AXLE_F, AXLE_R } from './rvDims.js';
import { Net, cleanRoomCode } from './net.js';
import { Remotes } from './remote.js';
import { Session } from './multiplayer.js';
import { TouchUI } from './touch.js';
import { Save, CheckpointFlags } from './save.js';

const $ = id => document.getElementById(id);

/* ---------- renderer ---------- */
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power', stencil: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setSize(innerWidth, innerHeight, false);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.15, 520);

const input = new Input(canvas);
const touch = new TouchUI(input);
let savedQ = null;
try { savedQ = localStorage.getItem('rv-quality'); } catch (e) { /* ignore */ }

/* ---------- game objects ---------- */
const world = new World(scene, { lite: input.touch || savedQ === 'low' });
const bridgeWorld = new BridgeWorld(scene, world, msg => toast(msg));
world.bridge = bridgeWorld;
const net = new Net();
const rvs = [];
const rv0 = new RV(scene, world, 0);
rvs.push(rv0);
const player = new Player(scene, world, rv0);
player.rvs = rvs;
const rig = new CameraRig(camera);
rig.world = world;
const drone = new Drone(scene, world, rv0);
drone.rvs = rvs;
const uiHooks = {
  // popups need the cursor: free the pointer without pausing
  onOpen: () => { input.muted = true; input.down.clear(); input.vdown.clear(); if (document.pointerLockElement) document.exitPointerLock(); },
  onClose: () => { setTimeout(() => { input.muted = false; input.pressed.clear(); }, 0); if (started && !paused) input.requestLock(); },
  toast: msg => toast(msg),
};
const inv = new Inventory({ ...uiHooks, onChange: () => gear.refreshHeld(), onStorage: st => session.sendStorage(st) });
inv.player = player; inv.addRV(rv0);
const gear = new Gear(scene, world, rv0, player, inv, drone, msg => toast(msg));
player.gear = gear; player.extraActs = inv.acts();
rig.drone = drone; rig.gear = gear;
const materials = new Materials();
const obstacles = new Obstacles(scene, world, materials, msg => toast(msg));
gear.obstacles = obstacles; gear.materials = materials;
const editor = new BridgeEditor(bridgeWorld, materials, { ...uiHooks, onBuilt: () => { session.dirty = true; saveNow(); } });
const minimap = new MiniMap(world);
const flags = new CheckpointFlags(scene, world, rv0.checkpoints);
const remotes = new Remotes(scene, rvs);
let objI = 0;
const session = new Session({ net, player, rvs, addRV, remotes, obstacles, bridgeWorld, editor, materials, world, inv, gear,
  toast: m => toast(m), getObj: () => objI, setObj: v => { objI = v; }, onRoster: () => renderRoster() });

function setupRV(r) { r.onMsg = m => toast(m); r.onCheckpoint = onCheckpoint; }
setupRV(rv0);
function addRV() {
  const r = new RV(scene, world, rvs.length);
  setupRV(r); rvs.push(r); inv.addRV(r);
  if (net.isHost) r.owner = net.id;
  toast(`🚐 RV ${rvs.length} arrived at the trailhead for the new team`);
  return r;
}
player.canUseSeat = (rv, seat) => remotes.seatTaken(rvs.indexOf(rv), seat);
player.onDrive = rv => session.claimRV(rv);
gear.onDeploy = d => session.sendDeploy(d);
gear.onPack = d => session.sendPack(d);
world.onNightChange = n => session.sendNight(n);
obstacles.onChange = () => { session.dirty = true; };
materials.onChange(() => { session.dirty = true; });
player.spawnBesideRV();
rig.yaw = player.yaw + Math.PI + 0.55;

/* ---------- world interactions: crates, workbench, map board, checkpoint flags ---------- */
const crateActs = world.crates.map((c, i) => ({ c, pos: c.pos, r: 2.2, label: () => c.label, act: () => {
  if (c.taken) return;
  c.taken = true; audio.thud(140, 0.1);
  if (net.isGuest) net.send('crate', { i }, true); else { materials.addAll(c.give); session.dirty = true; }
  toast('Got ' + Object.entries(c.give).map(([k, n]) => `+${n} ${MAT_INFO[k].name.toLowerCase()} ${MAT_INFO[k].icon}`).join(', '));
} }));
const benchAct = { pos: bridgeWorld.workbenchPos, r: 2.6, label: () => 'Use the workbench (craft planks · design the bridge)', act: () => editor.show() };
const boardAct = { pos: world.mapBoardPos, r: 2.6, label: () => 'Look at the trail map', act: () => minimap.toggleBig(true) };
const flagActs = flags.acts(() => manualSave());
player.worldActs = () => {
  const l = gear.worldActs(), eq = inv.equippedItem();
  l.push(...obstacles.acts(eq && eq.type));
  for (const a of crateActs) if (!a.c.taken) l.push(a);
  l.push(benchAct, boardAct, ...flagActs);
  return l;
};

/* ---------- objectives ---------- */
const anyRV = fn => rvs.some(fn);
const OBJ = [
  { text: 'Get a chainsaw (or axe) and the sledgehammer from the Gear Locker in the RV', done: () => (inv.has('chainsaw') || inv.has('axe')) && inv.has('sledge'), at: () => player.rv.root.position },
  { text: 'Drive up the trail and cut the fallen tree (hold the chainsaw, press F)', done: () => obstacles.list[0].state !== 'blocking', at: () => obstacles.list[0].pos },
  { text: 'Smash the rockfall with the sledgehammer', done: () => obstacles.list[1].state !== 'blocking', at: () => obstacles.list[1].pos },
  { text: 'The bridge is out! Collect logs, rope & planks, then design and build a bridge at the workbench', done: () => bridgeWorld.state === 'built', at: () => bridgeWorld.workbenchPos },
  { text: 'Drive the RV across the river', done: () => anyRV(r => r.cp >= 2 && !r.stuck), at: () => ({ x: BRIDGE.bx, z: BRIDGE.bz }) },
  { text: 'Cut the fallen tree on the hill road', done: () => obstacles.list[4].state !== 'blocking', at: () => obstacles.list[4].pos },
  { text: 'Smash the last rockfall', done: () => obstacles.list[5].state !== 'blocking', at: () => obstacles.list[5].pos },
  { text: 'Drive up to the Hilltop Camp', done: () => anyRV(r => r.root.position.distanceTo(world.campPos) < 30), at: () => world.campPos },
  { text: '🏕 You made it! Set up camp — tent, chair and a campfire', done: () => false, at: () => world.firePos },
];
function updateObjective() {
  let changed = false;
  while (objI < OBJ.length - 1 && OBJ[objI].done()) { objI++; changed = true; }
  if (changed) { toast('✔ Objective complete!'); session.dirty = true; saveNow(); }
  hud.objective.textContent = '🎯 ' + OBJ[objI].text;
}

/* ---------- map markers ---------- */
const markers = [];
function mapMarkers() {
  markers.length = 0;
  markers.push({ x: START.x, z: START.z, icon: '🚩', label: 'Trailhead' });
  markers.push({ x: bridgeWorld.workbenchPos.x, z: bridgeWorld.workbenchPos.z, icon: '🛠️', label: 'Workbench' });
  markers.push({ x: BRIDGE.mx, z: BRIDGE.mz, icon: bridgeWorld.state === 'built' ? '🌉' : '⚠️', label: bridgeWorld.state === 'built' ? 'Bridge' : 'Broken bridge' });
  for (const o of obstacles.list) if (o.state === 'blocking') markers.push({ x: o.pos.x, z: o.pos.z, icon: o.type === 'tree' ? '🌲' : '🪨', label: o.type === 'tree' ? 'Fallen tree' : o.type === 'rock' ? 'Rockfall' : '' });
  for (const c of world.crates) if (!c.taken) markers.push({ x: c.pos.x, z: c.pos.z, icon: '📦' });
  markers.push({ x: CAMP.x, z: CAMP.z, icon: '🏕️', label: 'Hilltop Camp' });
  rvs.forEach((r, i) => { if (!(player.frame === 'rv' && player.rv === r)) markers.push({ x: r.root.position.x, z: r.root.position.z, icon: '🚐', label: rvs.length > 1 ? `RV ${i + 1}` : 'RV', edge: r === player.rv }); });
  remotes.each((r, p) => markers.push({ x: p.x, z: p.z, dot: r.color, label: r.s.n, edge: true }));
  if (drone.active) markers.push({ x: drone.pos.x, z: drone.pos.z, icon: '🚁' });
  const t = OBJ[objI].at(); markers.push({ x: t.x, z: t.z, ring: true, edge: true });
  return markers;
}
const me = { x: 0, z: 0, yaw: 0 };
function whereAmI() {
  const rv = player.rv;
  if (drone.active) { me.x = drone.pos.x; me.z = drone.pos.z; me.yaw = drone.yaw; }
  else if (player.frame === 'rv') { me.x = rv.root.position.x; me.z = rv.root.position.z; me.yaw = rv.heading + (player.mode === 'drive' ? 0 : player.yaw); }
  else { me.x = player.pos.x; me.z = player.pos.z; me.yaw = player.yaw; }
  return me;
}

/* ---------- bridge loads (every RV axle + everyone on foot) ---------- */
const loadPool = Array.from({ length: 24 }, () => ({ x: 0, y: 0, z: 0, w: 0 }));
const loads = [], _ax = new THREE.Vector3();
function gatherLoads() {
  loads.length = 0; let k = 0;
  const push = (x, y, z, w) => { if (k < loadPool.length) { const L = loadPool[k++]; L.x = x; L.y = y; L.z = z; L.w = w; loads.push(L); } };
  for (const r of rvs) for (const lz of [AXLE_F, AXLE_R]) { r.axleWorld(lz, _ax); push(_ax.x, _ax.y, _ax.z, AXLE_LOAD); }
  if (player.frame === 'world' && player.mode === 'foot') push(player.pos.x, player.pos.y, player.pos.z, PLAYER_LOAD);
  remotes.each((r, p) => { if (!r.s.f) push(p.x, p.y, p.z, PLAYER_LOAD); });
}

/* ---------- saving ---------- */
function collectSave() {
  const bw = bridgeWorld;
  return { v: 1, t: Date.now(), obj: objI, obst: obstacles.stateArray(), crates: world.crates.map(c => (c.taken ? 1 : 0)), mats: { ...materials.c },
    br: bw.design && bw.state === 'built' ? { d: bw.design, sp: bw.spent } : null, rvs: rvs.map(r => r.cp),
    bag: inv.backpack.map(it => (it ? it.type : null)), st: inv.sets.map(set => set.map(st => ({ id: st.id, s: inv.types(st) }))), night: world.nightTarget };
}
function applySave(s) {
  if (!s || s.v !== 1) return false;
  obstacles.applyStateArray(s.obst, false);
  s.crates.forEach((t, i) => { if (world.crates[i]) world.crates[i].taken = !!t; });
  materials.setAll(s.mats);
  if (s.br) { bridgeWorld.build(s.br.d); bridgeWorld.spent = s.br.sp; }
  rvs.forEach((r, i) => { if (s.rvs[i] !== undefined) { r.cp = s.rvs[i]; r.reset(r.cp); } });
  flags.setReached(Math.max(...rvs.map(r => r.cp)));
  inv.setBackpack(s.bag || []);
  (s.st || []).forEach((set, i) => set.forEach(x => inv.applyStorage(i, x.id, x.s)));
  if (s.night) world.setNight(1, true);
  objI = s.obj || 0;
  player.spawnBesideRV();
  return true;
}
function saveNow() { if (!net.isGuest && started) return Save.write(collectSave()); return false; }
function manualSave() {
  if (net.isGuest) { toast('In co-op the host saves the shared game'); return; }
  toast(saveNow() ? '💾 Progress saved' : 'Could not save (private browsing?)');
}
function onCheckpoint(r, cp) {
  flags.setReached(Math.max(...rvs.map(x => x.cp)));
  if (net.isGuest) toast(`🚩 Checkpoint ${cp} reached`);
  else { saveNow(); toast(`💾 Checkpoint ${cp} reached — progress saved`); }
}

/* ---------- quality presets (resolution, shadows, view distance, fps cap = heat) ---------- */
const QUALITY = {
  low: { pr: 0.75, shadows: false, size: 512, fps: 30, far: 240, fog: 200 },
  medium: { pr: 1, shadows: true, size: 1024, fps: 60, far: 520, fog: 300 },
  high: { pr: Math.min(devicePixelRatio || 1, 2), shadows: true, size: 2048, fps: 60, far: 520, fog: 300 },
};
let quality = QUALITY.medium;
function applyQuality(name) {
  const q = QUALITY[name] || QUALITY.medium;
  const shadowChanged = q.shadows !== renderer.shadowMap.enabled;
  quality = q;
  renderer.setPixelRatio(q.pr);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = q.shadows;
  camera.far = q.far; camera.updateProjectionMatrix(); scene.fog.far = q.fog; scene.fog.near = q.fog * 0.25;
  world.sun.castShadow = q.shadows;
  if (world.sun.shadow.mapSize.x !== q.size) {
    world.sun.shadow.mapSize.set(q.size, q.size);
    if (world.sun.shadow.map) { world.sun.shadow.map.dispose(); world.sun.shadow.map = null; }
  }
  if (shadowChanged) scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
  try { localStorage.setItem('rv-quality', name); } catch (e) { /* storage unavailable */ }
}
const qSel = $('quality');
qSel.value = QUALITY[savedQ] ? savedQ : (input.touch ? 'low' : 'medium');
renderer.shadowMap.enabled = true;
applyQuality(qSel.value);
qSel.addEventListener('change', () => { applyQuality(qSel.value); qSel.blur(); });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  requestRender = true;
});

/* ---------- HUD ---------- */
const hud = { objective: $('objective'), room: $('room'), droneHud: $('droneHud'), binoHud: $('binoHud'), dAlt: $('dAlt'), dDist: $('dDist'), dSpd: $('dSpd'), dBat: $('dBat'), dWarn: $('dWarn'),
  prompt: $('prompt'), toast: $('toast'), state: $('state'), speedo: $('speedo'), speed: $('speed'), gear: $('gear'), lights: $('icoLights'), help: $('help'), helpBody: $('helpBody'), fps: $('fps') };
let toastT = 0, lastPrompt = '', lastHelp = '', hudT = 0, promptKey = 'E';
function toast(msg) { hud.toast.textContent = msg; hud.toast.classList.remove('hidden'); toastT = 2.6; }
const HELP = {
  foot: [['WASD', 'move'], ['Shift', 'run'], ['Space', 'jump'], ['1 - 6', 'hold an item'], ['F / Click', 'use item / punch'], ['E', 'interact'], ['M', 'map'], ['V', '1st / 3rd person'], ['N', 'day / night'], ['R', 'RV to last checkpoint'], ['I', 'copy invite link (co-op)']],
  drone: [['WASD', 'fly'], ['Space / Shift', 'up / down'], ['Mouse', 'turn + tilt camera'], ['V', 'drone cam / chase'], ['E', 'bring the drone back']],
  zoom: [['Mouse', 'look around'], ['F', 'lower binoculars']],
  inside: [['WASD', 'walk (out the side door to leave)'], ['E', 'use / sit / lie / open storage'], ['1 - 6', 'hold an item'], ['L', 'interior lights'], ['Space', 'jump'], ['V', '1st / 3rd person'], ['Mouse', 'look (roof hides)']],
  seat: [['E', 'stand up'], ['T', 'TV on / off'], ['L', 'interior lights'], ['Mouse', 'look around'], ['V', '1st / 3rd person']],
  lie: [['E', 'get up'], ['L', 'interior lights'], ['Mouse', 'look around']],
  drive: [['W / S', 'gas / brake + reverse'], ['A / D', 'steer'], ['Space', 'handbrake'], ['H', 'horn'], ['L', 'headlights'], ['V', 'chase / cockpit'], ['E', 'get out (when slow)'], ['Q', 'walk to the back'], ['M', 'map'], ['R', 'back to last checkpoint']],
};
function stateName() {
  if (drone.active) return 'Flying the drone';
  if (gear.zooming) return 'Binoculars';
  switch (player.mode) {
    case 'drive': return 'Driving';
    case 'seat': return player.seat === 'passengerSeat' ? 'Passenger seat' : 'Sitting';
    case 'lie': return 'Lying down';
    case 'inside': return 'Inside the RV';
    case 'tween': return '...';
    default: return player.pos.y > world.heightAt(player.pos.x, player.pos.z) + 2.2 ? 'On the RV roof' : 'On foot';
  }
}
const COPY_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M5 15V6a2 2 0 0 1 2-2h9" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>';
function renderRoster() {
  if (!net.online) { hud.room.classList.add('hidden'); $('pauseRoom').innerHTML = ''; return; }
  const names = session.roster().map(p => `<span style="color:${session.colorOf(p.id)}">${p.id === net.id ? 'You' : escapeHTML(p.n)}</span>`).join(', ');
  hud.room.classList.remove('hidden');
  hud.room.innerHTML = `👥 Room <b>${net.code}</b> <span class="dim">(${Math.max(1, session.players.size)}/6)</span> · ${names || 'connecting…'} <button class="copyBtn mini" data-copy="link" title="Copy invite link">${COPY_ICON}<span>Invite</span></button>`;
  $('pauseRoom').innerHTML = `<div class="invite">
      <div class="irow"><span>Room code</span><code>${net.code}</code><button class="copyBtn" data-copy="code" title="Copy room code">${COPY_ICON}<span>Copy</span></button></div>
      <div class="irow"><span>Invite link</span><input class="ilink" readonly value="${inviteLink()}" /><button class="copyBtn" data-copy="link" title="Copy invite link">${COPY_ICON}<span>Copy</span></button></div>
      <div class="ihint">Send the link (or the code) to a friend — 2 players share each RV.</div>
    </div>`;
}
const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inviteLink = () => `${location.origin}${location.pathname}?room=${net.code}`;
// Clipboard API needs https + a click; fall back to the old execCommand trick if it's blocked
function copyText(text) {
  const legacy = () => new Promise((res, rej) => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove(); ok ? res() : rej(new Error('copy blocked'));
  });
  return navigator.clipboard && window.isSecureContext ? navigator.clipboard.writeText(text).catch(legacy) : legacy();
}
function onCopyClick(e) {
  const btn = e.target.closest('.copyBtn');
  if (!btn) return;
  e.preventDefault(); e.stopPropagation();
  const what = btn.dataset.copy, text = what === 'code' ? net.code : inviteLink(), label = btn.querySelector('span'), old = label.textContent;
  copyText(text).then(() => {
    btn.classList.add('ok'); label.textContent = 'Copied!';
    toast(what === 'code' ? `📋 Room code ${net.code} copied` : '📋 Invite link copied — send it to a friend');
  }, () => {
    label.textContent = 'Select it';
    const inp = $('pauseRoom').querySelector('.ilink'); if (inp) { inp.focus(); inp.select(); }
  });
  setTimeout(() => { btn.classList.remove('ok'); label.textContent = old; }, 1800);
}
hud.room.addEventListener('click', onCopyClick);
$('pauseRoom').addEventListener('click', e => { if (e.target.classList.contains('ilink')) e.target.select(); onCopyClick(e); });
hud.prompt.addEventListener('click', e => { if (!input.touch) return; input.tap(e.target.closest('.alt') ? 'KeyX' : 'Key' + promptKey); });
$('minimap').addEventListener('click', () => minimap.toggleBig());
$('bigmap').addEventListener('click', () => minimap.toggleBig(false));

function updateHUD(dt) {
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) hud.toast.classList.add('hidden'); }
  if (player.toast) { toast(player.toast); player.toast = null; }
  const pr = inv.isOpen ? null : player.prompt;
  const p = pr ? pr.key + '|' + pr.text + (pr.alt ? '|' + pr.alt.text : '') : '';
  if (p !== lastPrompt) {
    lastPrompt = p;
    if (p) {
      promptKey = /^[A-Z]$/.test(pr.key) ? pr.key : 'E';
      hud.prompt.innerHTML = `<span class="key">${pr.key}</span>${pr.text}` + (pr.alt ? `<span class="alt"><span class="key">${pr.alt.key}</span>${pr.alt.text}</span>` : '');
      hud.prompt.classList.remove('hidden');
    } else hud.prompt.classList.add('hidden');
  }
  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.12; // DOM writes ~8x per second only
  hud.state.textContent = stateName() + (player.boost ? '  ⚡ boosted' : '') + (player.swimming ? '  🏊 swimming' : '');
  updateObjective();
  hud.droneHud.classList.toggle('hidden', !(drone.active && rig.droneView === 'cam'));
  hud.binoHud.classList.toggle('hidden', !gear.zooming);
  if (drone.active) {
    hud.dAlt.textContent = `ALT ${drone.pos.y.toFixed(0)} m`;
    hud.dDist.textContent = `DIST ${Math.hypot(drone.pos.x - pw.x, drone.pos.z - pw.z).toFixed(0)} m`;
    hud.dSpd.textContent = `${Math.round(drone.speed * 3.6)} km/h`;
    hud.dBat.textContent = `BATT ${Math.round(drone.battery * 100)}%`;
    hud.dWarn.textContent = drone.warn;
  }
  const key = drone.active ? 'drone' : gear.zooming ? 'zoom' : player.mode === 'tween' ? lastHelp : (player.mode === 'foot' ? 'foot' : player.mode);
  if (key && key !== lastHelp && HELP[key]) { lastHelp = key; hud.helpBody.innerHTML = HELP[key].map(([k, v]) => `<div><b>${k}</b>${v}</div>`).join(''); }
  const driving = player.mode === 'drive', rv = player.rv;
  hud.speedo.classList.toggle('hidden', !driving);
  if (driving) {
    hud.speed.textContent = Math.round(Math.abs(rv.speed) * 3.6);
    hud.gear.textContent = rv.speed < -0.3 ? 'R' : rv.speed > 0.3 ? 'D' : (input.isDown('Space') ? 'P' : 'N');
    hud.lights.classList.toggle('on', rv.headlights);
  }
}

/* ---------- start menu / pause ---------- */
const overlay = $('overlay');
let paused = true, started = false, requestRender = true, useSave = Save.has();
const M = { name: $('mName'), saveRow: $('mSaveRow'), cont: $('mContinue'), fresh: $('mNew'), solo: $('mSolo'), host: $('mHost'), code: $('mCode'), join: $('mJoin'), status: $('mStatus') };
try { M.name.value = localStorage.getItem('rv-name') || ''; } catch (e) { /* ignore */ }
if (!M.name.value) M.name.value = 'Camper' + Math.floor(10 + Math.random() * 90);
M.saveRow.classList.toggle('hidden', !useSave);
const setUseSave = v => { useSave = v; M.cont.classList.toggle('on', v); M.fresh.classList.toggle('on', !v); };
setUseSave(useSave);
M.cont.onclick = () => setUseSave(true); M.fresh.onclick = () => setUseSave(false);
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) { M.code.value = cleanRoomCode(roomParam); M.status.textContent = 'You were invited! Pick a name and press Join.'; M.join.classList.add('pulse'); }
const playerName = () => { const n = (M.name.value || 'Camper').trim().slice(0, 16) || 'Camper'; try { localStorage.setItem('rv-name', n); } catch (e) { /* ignore */ } return n; };
const busy = b => [M.solo, M.host, M.join].forEach(x => { x.disabled = b; });
function loadOrReset() { if (useSave) applySave(Save.load()); else Save.clear(); }
function startGame(msg) {
  audio.init();
  overlay.classList.add('hidden'); $('menuStart').classList.add('hidden'); $('menuPause').classList.remove('hidden');
  paused = false; started = true; input.muted = false;
  input.requestLock();
  lastT = performance.now();
  if (msg) toast(msg);
}
// typed a code but pressed Solo/Host? warn once — that's the usual "my friend isn't in my game" mistake
let codeWarned = false;
function codeTyped() {
  if (cleanRoomCode(M.code.value).length < 4 || codeWarned) return false;
  codeWarned = true; M.join.classList.add('pulse');
  M.status.textContent = '⚠ You typed a room code — press "Join a friend" to play together. (Press again to ignore the code.)';
  return true;
}
M.code.addEventListener('input', () => {
  const v = M.code.value;
  if (/room=/i.test(v)) M.code.value = cleanRoomCode(v);           // a whole invite link was pasted
  else if (v !== v.toUpperCase().replace(/\s/g, '')) M.code.value = v.toUpperCase().replace(/\s/g, '');
  M.join.classList.toggle('pulse', cleanRoomCode(M.code.value).length >= 4); codeWarned = false;
});
M.code.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); M.join.click(); } });
M.name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); (cleanRoomCode(M.code.value).length >= 4 ? M.join : M.solo).click(); } });
M.solo.onclick = () => { if (codeTyped()) return; playerName(); loadOrReset(); startGame('Walk up to the side door to go inside'); };
M.host.onclick = async () => {
  if (codeTyped()) return;
  busy(true); M.status.textContent = 'Creating a room…';
  try {
    loadOrReset();
    const code = await session.host(playerName());
    gear.netId = net.id;
    startGame(`Room ${code} created — press "Copy invite link" (top) and send it to friends`);
    renderRoster();
  } catch (e) { M.status.textContent = '⚠ ' + (e.message || e); busy(false); }
};
M.join.onclick = async () => {
  const code = cleanRoomCode(M.code.value);
  if (code.length < 4) { M.status.textContent = 'Type the room code your friend sent you.'; return; }
  busy(true); M.status.textContent = 'Connecting to room ' + code + '…';
  try { await session.join(code, playerName()); gear.netId = net.id; startGame('Connected! Waiting for the host…'); }
  catch (e) { M.status.textContent = '⚠ ' + (e.message || e); busy(false); }
};
$('play').addEventListener('click', () => {
  overlay.classList.add('hidden'); paused = false; input.muted = false;
  input.requestLock(); lastT = performance.now();
});
document.addEventListener('pointerlockchange', () => {
  // Esc frees the mouse -> pause menu (solo: the game stops so the GPU idles; co-op keeps running)
  if (!document.pointerLockElement && started && !input.dragging && !inv.isOpen && !editor.open) {
    if (!net.online) paused = true;
    input.muted = true;
    overlay.classList.remove('hidden');
  }
});
canvas.addEventListener('click', () => { if (started && !paused && !input.locked) input.requestLock(); });

/* ---------- global keys ---------- */
function globalKeys() {
  if (input.wasPressed('KeyV')) toast(rig.toggle(player));
  if (input.wasPressed('KeyN')) { const n = world.nightTarget ? 0 : 1; world.setNight(n); toast(n ? 'Night' : 'Day'); if (n && player.mode === 'drive' && !player.rv.headlights) player.rv.toggleHeadlights(); }
  if (input.wasPressed('KeyK')) toast(audio.toggleMute() ? 'Sound off' : 'Sound on');
  if (input.wasPressed('KeyM')) minimap.toggleBig();
  if (input.wasPressed('Escape') && minimap.bigOpen) minimap.toggleBig(false);
  if (input.wasPressed('KeyR')) {
    const r = player.rv;
    if (player.mode === 'drive' || r.isLocal(net)) { r.reset(); toast(`RV ${rvs.length > 1 ? r.index + 1 + ' ' : ''}moved to the last checkpoint`); }
    else toast('Only the driver can reset this RV');
  }
  if (input.wasPressed('Tab')) hud.help.classList.toggle('hidden');
  if (input.wasPressed('KeyI') && net.online) copyText(inviteLink()).then(() => toast('📋 Invite link copied — send it to a friend'), () => toast('Press Esc to see the invite link'));
  if (!drone.active && (player.mode === 'foot' || player.mode === 'inside')) for (let i = 1; i <= 6; i++) if (input.wasPressed('Digit' + i)) inv.equip(i - 1);
}

/* ---------- main loop ---------- */
let lastT = performance.now(), lastRender = 0, fpsFrames = 0, fpsT = 0, saveT = 0;
const focus = new THREE.Vector3(), pw = new THREE.Vector3();
let freezeCam = null;

function step(dt) {
  globalKeys();
  const ctrl = player.update(dt, input, rig);
  gear.update(dt, input);
  for (const r of rvs) {
    if (r.isLocal(net)) r.update(dt, r === player.rv && player.mode === 'drive' ? ctrl : null);
    else r.netUpdate(dt);
    r.setAudible(r === player.rv && player.frame === 'rv');
  }
  obstacles.update(dt);
  gatherLoads();
  bridgeWorld.update(dt, loads);
  if (freezeCam) {
    camera.position.set(freezeCam[0], freezeCam[1], freezeCam[2]); camera.lookAt(freezeCam[3], freezeCam[4], freezeCam[5]);
    player.rv.setCutaway(camera.position, !!freezeCam[6], false);
  } else rig.update(dt, input, player, player.rv);
  for (const r of rvs) if (r !== player.rv) r.setCutaway(camera.position, false, false);
  remotes.tick(dt);
  player.char.root.getWorldPosition(pw);
  focus.copy(drone.active ? drone.pos : player.mode === 'drive' ? player.rv.root.position : pw);
  world.update(dt, focus, camera);
  flags.update(dt);
  minimap.update(dt, whereAmI(), mapMarkers());
  session.tick(dt);
  if (started && (saveT += dt) > 45) { saveT = 0; saveNow(); }
  const tmode = drone.active ? 'drone' : player.mode === 'drive' ? 'drive' : (player.mode === 'seat' || player.mode === 'lie') ? 'seat' : 'foot';
  touch.setMode(tmode, !!inv.equippedItem());
  input.stickRun = tmode === 'foot';
  updateHUD(dt);
  input.endFrame();
}

function frame(now) {
  requestAnimationFrame(frame);
  if (paused || editor.open) {   // nothing to animate behind the designer / pause menu: save the GPU
    if (requestRender) { renderer.render(scene, camera); requestRender = false; }
    if (editor.open && net.online) session.tick(Math.min(0.05, (now - lastT) / 1000));
    lastT = now; input.endFrame();
    return;
  }
  const idle = now - input.lastInput > 25000 && player.mode !== 'drive' && !net.online;
  const cap = idle ? 15 : quality.fps;
  if (now - lastRender < 1000 / cap - 2) return;
  lastRender = now;
  let dt = (now - lastT) / 1000;
  if (!(dt > 0)) dt = 1 / 60;          // rAF timestamps can repeat or go backwards
  dt = Math.min(dt, 0.05);
  lastT = now;
  step(dt);
  renderer.render(scene, camera);
  fpsFrames++; fpsT += dt;
  if (fpsT >= 0.5) { hud.fps.textContent = Math.round(fpsFrames / fpsT) + ' fps'; fpsFrames = 0; fpsT = 0; }
}
addEventListener('beforeunload', () => saveNow());

// first frame behind the overlay so the scene is visible
step(0.016);
renderer.render(scene, camera);
requestAnimationFrame(frame);
window.__game = { net, session, player, rvs, remotes, obstacles, bridgeWorld, materials, world, inv, gear, editor, input, applySave, collectSave, saveNow, get objI() { return objI; } };

/* ---------- debug screenshots: ?shot=inside | drive | bridgegood,align,drive&keys=KeyW | editor ... ---------- */
const qs = new URLSearchParams(location.search);
if (qs.has('shot')) {
  overlay.classList.add('hidden'); paused = false; started = true;
  const s = qs.get('shot'), road = world.T.road, rv = rv0;
  const run = n => { for (let i = 0; i < n; i++) step(1 / 60); };
  const sample = good => {
    const n = [[0, 0], [0, -2], [16, 0], [16, -2], [4, 0], [8, 0], [12, 0], [4, -2.5], [8, -2.5], [12, -2.5]].map(([x, y], i) => ({ x, y, fixed: i < 4 }));
    const rd = [[0, 4], [4, 5], [5, 6], [6, 2]].map(([a, b]) => ({ a, b, type: 'road' }));
    const logs = [[1, 7], [7, 8], [8, 9], [9, 3], [4, 7], [5, 8], [6, 9], [0, 7], [7, 5], [5, 9], [9, 2]].map(([a, b]) => ({ a, b, type: 'log' }));
    return { pier: false, nodes: good ? n : n.slice(0, 7), members: good ? [...rd, ...logs] : rd };
  };
  if (s.includes('bridgegood') || s.includes('bridgeweak')) { bridgeWorld.build(sample(s.includes('bridgegood'))); rv.reset(1); player.spawnBesideRV(); obstacles.list.forEach(o => obstacles.clearInstant(o)); }
  if (s.includes('align')) { rv.heading = Math.atan2(BRIDGE.dx, BRIDGE.dz); rv.rear.set(BRIDGE.ax - BRIDGE.dx * 12, 0, BRIDGE.az - BRIDGE.dz * 12); rv.y = 50; rv._place(1, true); player.spawnBesideRV(); }
  if (s.includes('tworv')) { addRV(); player.spawnBesideRV(); }
  if (/inside|sit|sofa|lie|bunk|fridge/.test(s)) { player.placeInside(); run(20); }
  if (s.includes('sit')) { player.sitAt('dinetteA'); run(80); }
  if (s.includes('drive')) { player.enterDriver(true); run(120); }
  if (s.includes('night')) { world.setNight(1); rv.headlights = true; rv.interiorLights = true; }
  if (s.includes('editor')) { materials.addAll({ logs: 20, planks: 20, rope: 10, stone: 10 }); editor.design = sample(!s.includes('weak')); editor.show(); }
  if (s.includes('bigmap')) minimap.toggleBig(true);
  if (qs.get('keys')) qs.get('keys').split(',').forEach(k => input.down.add(k));
  if (qs.get('yaw')) rig.yaw = +qs.get('yaw');
  if (qs.get('pitch')) rig.pitch = +qs.get('pitch');
  if (qs.get('dist')) rig.distTarget = rig.dist = rig.driveDist = +qs.get('dist');
  if (qs.get('cam')) freezeCam = qs.get('cam').split(',').map(Number);
  run(+(qs.get('frames') || 60));
  renderer.render(scene, camera);
  document.title = [player.mode, player.frame, 'rv', rv.root.position.x.toFixed(1), rv.y.toFixed(1), rv.root.position.z.toFixed(1), 'cp', rv.cp, 'stuck', rv.stuck, 'bridge', bridgeWorld.state, 'rvs', rvs.length, 'obj', objI].join(' ');
}
window.__gameReady = true;
