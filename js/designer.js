import { MAT_INFO } from './materials.js';
import { TOWER_ZONE, GIANT } from './terrain.js';
import { TSIZE, MAX_SLOTS, towerCost, towerHp, towerProblems, slotsUsed, castleCost, castleProblems, wallSegs, wallHp, wallThick } from './structures.js';
import { audio } from './audio.js';
import { clamp } from './utils.js';

// Workbench designer for the two build stages (like the bridge designer):
//  - towers: pick 4 small / 2 medium / 1 big (or mix), floors, stone base, then drag them into place
//  - castle: shape the stone wall ring by dragging its corners inside the plateau, pick the gate and height
const HEIGHTS = { low: 2.6, mid: 3.6, high: 4.6 };
const snap = v => Math.round(v * 2) / 2;

export class Designer {
  constructor({ materials, structures, hooks }) {
    this.mats = materials; this.st = structures; this.hooks = hooks;
    this.open = false; this.kind = 'towers'; this.sel = -1; this.selEdge = -1; this.drag = null; this.msg = ''; this.spacing = 5;
    this.t = { towers: [] };
    this.c = { pts: [], h: HEIGHTS.mid, thick: false, gate: -1, turrets: false };
    this._preset('2m'); this._shape(6, 13, 0);
    this._dom();
    materials.onChange(() => { if (this.open) this._side(); });
  }

  /* ---------- presets ---------- */
  _preset(k) {
    const T = this.t.towers = [];
    if (k === '4s') for (let i = 0; i < 4; i++) T.push({ size: 's', floors: 2, stone: false, x: 0, z: 0 });
    if (k === '2m') for (let i = 0; i < 2; i++) T.push({ size: 'm', floors: 2, stone: false, x: 0, z: 0 });
    if (k === '1b') T.push({ size: 'b', floors: 3, stone: false, x: 0, z: 0 });
    this._arrange(T.length === 4 ? 'square' : 'row');
    this.sel = -1;
  }
  _arrange(how) {
    const T = this.t.towers, g = this.spacing;
    if (!T.length) return;
    if (how === 'square' && T.length >= 3) {
      const cols = Math.ceil(Math.sqrt(T.length)), rows = Math.ceil(T.length / cols);
      const w = Math.max(...T.map(t => TSIZE[t.size].half)) * 2 + g;
      T.forEach((t, i) => { const c = i % cols, r = Math.floor(i / cols); t.x = snap((c - (cols - 1) / 2) * w); t.z = snap(((rows - 1) / 2 - r) * w); });
    } else {
      const total = T.reduce((s, t) => s + TSIZE[t.size].half * 2, 0) + g * (T.length - 1);
      let x = -total / 2;
      for (const t of T) { const h = TSIZE[t.size].half; t.x = snap(x + h); t.z = 0; x += h * 2 + g; }
    }
    for (const t of T) this._clampT(t);
  }
  _clampT(t) { const h = TSIZE[t.size].half; t.x = clamp(t.x, -TOWER_ZONE.hw + h, TOWER_ZONE.hw - h); t.z = clamp(t.z, -TOWER_ZONE.hd + h, TOWER_ZONE.hd - h); }
  _shape(n, r, rot) {
    const pts = [];
    for (let i = 0; i < n; i++) { const a = rot + (i / n) * Math.PI * 2 + Math.PI / n; pts.push([snap(Math.cos(a) * r), snap(Math.sin(a) * r)]); }
    this.c.pts = pts; this.c.size = r; this.c.n = n; this.c.rot = rot;
    // gate: the wall facing the road (south-east of the plateau)
    let best = 0, bd = -1e9;
    wallSegs(this.c).forEach(s => { const mx = (s.ax + s.bx) / 2, mz = (s.az + s.bz) / 2, d = mx * 0.6 - mz; if (d > bd) { bd = d; best = s.i; } });
    this.c.gate = best;
  }

  /* ---------- DOM ---------- */
  _dom() {
    const root = this.root = document.createElement('div');
    root.id = 'buildUI'; root.className = 'hidden';
    root.innerHTML = `<div class="bbox"><div class="bhead"><b class="dtitle"></b><button data-a="close" class="bbtn y">Close (Esc)</button></div>
      <div class="bmain"><div class="bleft"><div class="btools"></div><canvas width="760" height="470"></canvas><div class="binfo"></div></div>
      <div class="bside"><h4>Team materials</h4><div class="bmats"></div><h4>Craft</h4>
        <button data-a="craft1" class="bbtn wide">Saw 1 log → 2 planks</button><button data-a="craftall" class="bbtn wide">Saw all logs</button>
        <h4>This design needs</h4><div class="bcost"></div><h4>Strength</h4><div class="bstat"></div>
        <button data-a="build" class="bbtn wide y">🔨 Build it</button><button data-a="ready" class="bbtn wide g">⏩ We're ready — start now</button>
        <p class="bhelp"></p></div></div></div>`;
    document.body.appendChild(root);
    this.cv = root.querySelector('canvas'); this.ctx = this.cv.getContext('2d');
    root.addEventListener('click', e => {
      if (e.target === root) { this.close(); return; }           // tap outside = close
      const b = e.target.closest('button'); if (b && b.dataset.a) this._action(b.dataset.a, b.dataset.v);
    });
    root.addEventListener('input', e => {
      const el = e.target;
      if (el.dataset.r === 'spacing') { this.spacing = +el.value; this._arrange(this.t.towers.length >= 3 && this._lastArr === 'square' ? 'square' : 'row'); }
      if (el.dataset.r === 'size') this._shape(this.c.n, +el.value, this.c.rot);
      if (el.dataset.r === 'rot') this._shape(this.c.n, this.c.size, +el.value * Math.PI / 180);
      this._side(); this.draw();
    });
    const pt = e => { const r = this.cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * this.cv.width / r.width, y: (e.clientY - r.top) * this.cv.height / r.height }; };
    this.cv.addEventListener('pointerdown', e => { e.preventDefault(); this.cv.setPointerCapture(e.pointerId); this._down(pt(e)); });
    this.cv.addEventListener('pointermove', e => { if (this.drag) { this._move(pt(e)); } });
    this.cv.addEventListener('pointerup', () => { if (this.drag) { this.drag = null; this._side(); this.draw(); } });
    document.addEventListener('keydown', e => { if (this.open && (e.code === 'Escape' || e.code === 'KeyE')) { e.preventDefault(); this.close(); } });
  }
  get built() { return this.kind === 'towers' ? !!this.st.tDesign : !!this.st.cDesign; }

  show(kind) {
    if (this.open) return;
    this.kind = kind; this.open = true; this.sel = -1; this.selEdge = -1; this.msg = '';
    if (this.built) { if (kind === 'towers') this.t = JSON.parse(JSON.stringify(this.st.tDesign)); else this.c = { ...this.c, ...JSON.parse(JSON.stringify(this.st.cDesign)) }; }
    this.root.classList.remove('hidden');
    this._tools(); this._side(); this.draw();
    this.hooks.onOpen();
  }
  close() { if (!this.open) return; this.open = false; this.drag = null; this.root.classList.add('hidden'); this.hooks.onClose(); }

  _tools() {
    const R = this.root, T = this.kind === 'towers';
    R.querySelector('.dtitle').textContent = T ? '🗼 Workbench · Watchtower Designer' : '🏰 Workbench · Castle Wall Designer';
    R.querySelector('.btools').innerHTML = T ? `
      <button data-a="preset" data-v="4s" class="bbtn">4 small</button><button data-a="preset" data-v="2m" class="bbtn">2 medium</button><button data-a="preset" data-v="1b" class="bbtn">1 big</button>
      <span class="sep"></span><button data-a="add" data-v="s" class="bbtn">+ Small</button><button data-a="add" data-v="m" class="bbtn">+ Medium</button><button data-a="add" data-v="b" class="bbtn">+ Big</button>
      <span class="sep"></span><label class="brange">Spacing <input data-r="spacing" type="range" min="1.5" max="12" step="0.5" value="${this.spacing}"></label>
      <button data-a="arr" data-v="row" class="bbtn">Line up</button><button data-a="arr" data-v="square" class="bbtn">Square</button>
      <span class="sep"></span><span class="bsel"></span>` : `
      <button data-a="shape" data-v="4" class="bbtn">Square</button><button data-a="shape" data-v="6" class="bbtn">Hexagon</button><button data-a="shape" data-v="8" class="bbtn">Octagon</button>
      <label class="brange">Size <input data-r="size" type="range" min="7" max="${GIANT.r}" step="0.5" value="${this.c.size || 13}"></label>
      <label class="brange">Turn <input data-r="rot" type="range" min="0" max="90" step="5" value="${Math.round((this.c.rot || 0) * 180 / Math.PI)}"></label>
      <span class="sep"></span><button data-a="h" data-v="low" class="bbtn">Low wall</button><button data-a="h" data-v="mid" class="bbtn">Medium</button><button data-a="h" data-v="high" class="bbtn">High</button>
      <button data-a="thick" class="bbtn">🧱 Thick</button><button data-a="turrets" class="bbtn">🗼 Corner turrets</button>
      <span class="sep"></span><span class="bsel"></span>`;
  }

  _side() {
    const R = this.root, T = this.kind === 'towers', d = T ? this.t : this.c;
    const cost = T ? towerCost(d) : castleCost(d), probs = T ? towerProblems(d) : castleProblems(d);
    R.querySelector('.bmats').innerHTML = Object.keys(MAT_INFO).map(k => `<div>${MAT_INFO[k].icon} ${MAT_INFO[k].name}<b>${this.mats.get(k)}</b></div>`).join('');
    R.querySelector('.bcost').innerHTML = Object.keys(MAT_INFO).filter(k => cost[k]).map(k => {
      const ok = this.mats.get(k) >= cost[k];
      return `<div class="${ok ? '' : 'bad'}">${MAT_INFO[k].icon} ${MAT_INFO[k].name}<b>${cost[k]}${ok ? '' : ` (need ${cost[k] - this.mats.get(k)} more)`}</b></div>`;
    }).join('') || '<div>—</div>';
    R.querySelector('.bstat').innerHTML = T
      ? d.towers.map((t, i) => `<div>${i + 1}. ${TSIZE[t.size].name} · ${t.floors} fl${t.stone ? ' · stone' : ''}<b>${towerHp(t)} HP</b></div>`).join('') + `<div class="dim">Slots ${slotsUsed(d)}/${MAX_SLOTS}</div>`
      : `<div>Walls<b>${wallSegs(d).filter(s => !s.gate).length} × ${d.h.toFixed(1)} m${d.thick ? ' thick' : ''}</b></div><div>Total wall HP<b>${wallSegs(d).reduce((s, w) => s + wallHp(d, w), 0)}</b></div><div>Gate<b>${d.gate >= 0 ? 'wall ' + (d.gate + 1) : 'none'}</b></div>`;
    const sel = R.querySelector('.bsel');
    if (T) sel.innerHTML = this.sel >= 0 && d.towers[this.sel] ? `Tower ${this.sel + 1}: <button data-a="fl" data-v="-1" class="bbtn">− floor</button><button data-a="fl" data-v="1" class="bbtn">+ floor</button><button data-a="stone" class="bbtn${d.towers[this.sel].stone ? ' on' : ''}">🪨 Stone base</button><button data-a="del" class="bbtn">✖ Remove</button>` : '<span class="dim">Click a tower to change it · drag to move</span>';
    else sel.innerHTML = this.selEdge >= 0 ? `Wall ${this.selEdge + 1}: <button data-a="gate" class="bbtn${d.gate === this.selEdge ? ' on' : ''}">🚪 Gate here</button><button data-a="split" class="bbtn">+ Corner</button>`
      : this.sel >= 0 ? `Corner ${this.sel + 1}: <button data-a="delpt" class="bbtn">✖ Remove corner</button>` : '<span class="dim">Drag corners · click a wall to pick the gate</span>';
    if (!T) for (const b of R.querySelectorAll('[data-a="h"]')) b.classList.toggle('on', HEIGHTS[b.dataset.v] === d.h);
    if (!T) { R.querySelector('[data-a="thick"]').classList.toggle('on', d.thick); R.querySelector('[data-a="turrets"]').classList.toggle('on', d.turrets); }
    const afford = Object.keys(cost).every(k => this.mats.get(k) >= cost[k]);
    const bb = R.querySelector('[data-a="build"]');
    bb.disabled = this.built || probs.length > 0 || !afford;
    bb.textContent = this.built ? '✔ Built' : T ? '🔨 Build the towers' : '🔨 Build the castle';
    R.querySelector('[data-a="ready"]').classList.toggle('hidden', !this.hooks.canReady(this.kind));
    R.querySelector('.bhelp').innerHTML = T
      ? 'Up to <b>4 slots</b>: small = 1, medium = 2, big = 4. More floors and a <b>stone base</b> make a tower tougher. Climb the ladder (E) and shoot from the top — zombies can\'t climb, but they will smash the tower. Repair it with the hammer (F).'
      : 'Drag the <b>corners</b> to shape the wall inside the dashed boundary. Giants come from the <b>north and west</b>. Walls block their boulders; walk on top (climb with E) and fire your <b>cannon</b>. Repair with the hammer or sledgehammer.';
    this.info = R.querySelector('.binfo');
    this.info.innerHTML = this.msg || (this.built ? '✔ Built! Close this and get ready.' : probs.length ? '⚠ ' + probs[0] : afford ? '✅ Ready to build.' : '⚠ Not enough materials — chop trees (logs), smash rocks (stone), open supply crates.');
  }

  _action(a, v) {
    const T = this.kind === 'towers', d = T ? this.t : this.c;
    this.msg = '';
    if (a === 'close') { this.close(); return; }
    if (a === 'craft1' || a === 'craftall') {
      const n = a === 'craft1' ? Math.min(1, this.mats.get('logs')) : this.mats.get('logs');
      if (!n) this.msg = 'No logs to saw. Chop trees with the chainsaw or axe.';
      else { this.mats.delta({ logs: -n, planks: n * 2 }); audio.hum('saw', true, 'sawtooth', 115, 0.05); setTimeout(() => audio.hum('saw', false), 400); this.msg = `🪚 Sawed ${n} log${n > 1 ? 's' : ''} into ${n * 2} planks.`; }
    }
    if (a === 'ready') { this.hooks.ready(this.kind); this.close(); return; }
    if (a === 'build') {
      const err = this.hooks.commit(this.kind, JSON.parse(JSON.stringify(d)));
      if (err) this.msg = '🚫 ' + err; else { this.close(); return; }
    }
    if (this.built && !['craft1', 'craftall'].includes(a)) { this.msg = 'Already built.'; this._side(); this.draw(); return; }
    if (T) {
      if (a === 'preset') this._preset(v);
      if (a === 'add') {
        if (slotsUsed(d) + TSIZE[v].slots > MAX_SLOTS) this.msg = 'No room for that one: 4 slots in total (small 1 · medium 2 · big 4).';
        else { d.towers.push({ size: v, floors: Math.min(2, TSIZE[v].maxF), stone: false, x: 0, z: 0 }); this.sel = d.towers.length - 1; this._arrange(this._lastArr || 'row'); }
      }
      if (a === 'arr') { this._lastArr = v; this._arrange(v); }
      const t = d.towers[this.sel];
      if (t && a === 'fl') t.floors = clamp(t.floors + +v, 1, TSIZE[t.size].maxF);
      if (t && a === 'stone') t.stone = !t.stone;
      if (t && a === 'del') { d.towers.splice(this.sel, 1); this.sel = -1; }
    } else {
      if (a === 'shape') this._shape(+v, this.c.size || 13, this.c.rot || 0);
      if (a === 'h') d.h = HEIGHTS[v];
      if (a === 'thick') d.thick = !d.thick;
      if (a === 'turrets') d.turrets = !d.turrets;
      if (a === 'gate' && this.selEdge >= 0) d.gate = d.gate === this.selEdge ? -1 : this.selEdge;
      if (a === 'split' && this.selEdge >= 0 && d.pts.length < 12) {
        const i = this.selEdge, A = d.pts[i], B = d.pts[(i + 1) % d.pts.length];
        d.pts.splice(i + 1, 0, [snap((A[0] + B[0]) / 2), snap((A[1] + B[1]) / 2)]);
        if (d.gate > i) d.gate++;
        this.selEdge = -1; this.sel = i + 1;
      }
      if (a === 'delpt' && this.sel >= 0 && d.pts.length > 3) {
        d.pts.splice(this.sel, 1);
        if (d.gate >= d.pts.length || d.gate === this.sel) d.gate = -1; else if (d.gate > this.sel) d.gate--;
        this.sel = -1;
      }
    }
    this._side(); this.draw();
  }

  /* ---------- top-down canvas ---------- */
  _view() {
    const W = this.cv.width, H = this.cv.height;
    if (this.kind === 'towers') { const k = Math.min(W / (TOWER_ZONE.hw * 2 + 22), H / (TOWER_ZONE.hd * 2 + 10)); return { k, cx: W / 2 - 4 * k, cy: H / 2 }; }
    const k = Math.min(W, H) / ((GIANT.r + 7) * 2); return { k, cx: W / 2, cy: H / 2 };
  }
  _s(x, z) { const v = this._view(); return { x: v.cx + x * v.k, y: v.cy - z * v.k }; }
  _w(p) { const v = this._view(); return { x: (p.x - v.cx) / v.k, z: -(p.y - v.cy) / v.k }; }

  _down(p) {
    if (this.built) return;
    const w = this._w(p);
    if (this.kind === 'towers') {
      this.sel = -1;
      this.t.towers.forEach((t, i) => { const h = TSIZE[t.size].half; if (Math.abs(w.x - t.x) < h + 0.3 && Math.abs(w.z - t.z) < h + 0.3) this.sel = i; });
      if (this.sel >= 0) this.drag = { i: this.sel, ox: w.x - this.t.towers[this.sel].x, oz: w.z - this.t.towers[this.sel].z };
    } else {
      const v = this._view(); this.sel = -1; this.selEdge = -1;
      this.c.pts.forEach((q, i) => { const s = this._s(q[0], q[1]); if (Math.hypot(s.x - p.x, s.y - p.y) < 14) this.sel = i; });
      if (this.sel >= 0) this.drag = { i: this.sel };
      else wallSegs(this.c).forEach(s => {
        const A = this._s(s.ax, s.az), B = this._s(s.bx, s.bz), ex = B.x - A.x, ey = B.y - A.y, l = ex * ex + ey * ey || 1;
        const t = clamp(((p.x - A.x) * ex + (p.y - A.y) * ey) / l, 0, 1);
        if (Math.hypot(A.x + ex * t - p.x, A.y + ey * t - p.y) < 10) this.selEdge = s.i;
      });
      void v;
    }
    this._side(); this.draw();
  }
  _move(p) {
    const w = this._w(p);
    if (this.kind === 'towers') { const t = this.t.towers[this.drag.i]; t.x = snap(w.x - this.drag.ox); t.z = snap(w.z - this.drag.oz); this._clampT(t); }
    else {
      let x = snap(w.x), z = snap(w.z); const r = Math.hypot(x, z);
      if (r > GIANT.r) { x = snap(x * GIANT.r / r * 0.999); z = snap(z * GIANT.r / r * 0.999); if (Math.hypot(x, z) > GIANT.r) { x *= 0.98; z *= 0.98; } }
      this.c.pts[this.drag.i] = [x, z];
    }
    this._side(); this.draw();
  }

  draw() {
    const g = this.ctx, W = this.cv.width, H = this.cv.height, v = this._view(), T = this.kind === 'towers';
    g.fillStyle = '#5f8f3c'; g.fillRect(0, 0, W, H);
    // grid (2 m)
    g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1;
    for (let x = -60; x <= 60; x += 2) { const a = this._s(x, -60), b = this._s(x, 60); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
    for (let z = -60; z <= 60; z += 2) { const a = this._s(-60, z), b = this._s(60, z); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
    g.font = 'bold 13px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (T) {
      // the road on the east side + building zone
      const r0 = this._s(TOWER_ZONE.hw + 7, 40), r1 = this._s(TOWER_ZONE.hw + 16, -40);
      g.fillStyle = '#9a8158'; g.fillRect(r0.x, r0.y, r1.x - r0.x, r1.y - r0.y);
      g.fillStyle = 'rgba(255,255,255,.85)'; g.fillText('ROAD', (r0.x + r1.x) / 2, 18);
      const z0 = this._s(-TOWER_ZONE.hw, TOWER_ZONE.hd), z1 = this._s(TOWER_ZONE.hw, -TOWER_ZONE.hd);
      g.fillStyle = 'rgba(163,148,99,.55)'; g.fillRect(z0.x, z0.y, z1.x - z0.x, z1.y - z0.y);
      g.setLineDash([8, 6]); g.strokeStyle = '#ffd34d'; g.lineWidth = 2; g.strokeRect(z0.x, z0.y, z1.x - z0.x, z1.y - z0.y); g.setLineDash([]);
      g.fillStyle = '#ffd34d'; g.fillText('BUILDING ZONE', (z0.x + z1.x) / 2, z0.y - 10);
      const probs = towerProblems(this.t);
      this.t.towers.forEach((t, i) => {
        const h = TSIZE[t.size].half, a = this._s(t.x - h, t.z + h), b = this._s(t.x + h, t.z - h);
        const bad = probs.some(p => p.includes(`Tower ${i + 1}`) || p.includes(`and ${i + 1}`) || p.includes(`Towers ${i + 1}`));
        g.fillStyle = t.stone ? '#8d8a82' : '#a0703f'; g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
        g.strokeStyle = bad ? '#ff5a4a' : i === this.sel ? '#ffd34d' : '#4a2c16'; g.lineWidth = i === this.sel || bad ? 4 : 2; g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        for (let f = 1; f < t.floors; f++) { const m = f * 4; g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; g.strokeRect(a.x + m, a.y + m, b.x - a.x - 2 * m, b.y - a.y - 2 * m); }
        const lb = this._s(t.x, t.z - h - 0.5); g.fillStyle = '#4a2c16'; g.fillRect(lb.x - 6, lb.y - 3, 12, 6);          // ladder
        g.fillStyle = '#fff'; g.fillText(`${i + 1} · ${t.floors}F`, (a.x + b.x) / 2, (a.y + b.y) / 2);
        g.font = '11px system-ui'; g.fillText(`${towerHp(t)} HP`, (a.x + b.x) / 2, (a.y + b.y) / 2 + 14); g.font = 'bold 13px system-ui';
      });
      // spacing helper between neighbours
      g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '11px system-ui';
      const ts = [...this.t.towers].sort((a, b) => a.x - b.x);
      for (let i = 1; i < ts.length; i++) {
        const A = ts[i - 1], B = ts[i]; if (Math.abs(A.z - B.z) > 2) continue;
        const gap = B.x - TSIZE[B.size].half - (A.x + TSIZE[A.size].half); if (gap <= 0) continue;
        const p = this._s((A.x + TSIZE[A.size].half + B.x - TSIZE[B.size].half) / 2, A.z); g.fillText(`${gap.toFixed(1)} m`, p.x, p.y - 2);
      }
    } else {
      const c = this._s(0, 0), R = GIANT.r * v.k;
      g.fillStyle = 'rgba(163,148,99,.5)'; g.beginPath(); g.arc(c.x, c.y, R, 0, 7); g.fill();
      g.setLineDash([8, 6]); g.strokeStyle = '#ffd34d'; g.lineWidth = 2; g.beginPath(); g.arc(c.x, c.y, R, 0, 7); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#ffd34d'; g.fillText('BUILD BOUNDARY', c.x, c.y - R - 10);
      g.fillStyle = 'rgba(255,90,70,.9)'; g.fillText('▲ giants come from here ▲', c.x - R * 0.5, 16);
      const rd = this._s(14, -26); g.fillStyle = '#9a8158'; g.beginPath(); g.moveTo(c.x, c.y); g.lineTo(rd.x + 18, rd.y + 40); g.lineTo(rd.x + 50, rd.y + 40); g.closePath(); g.fill();
      g.fillStyle = '#fff'; g.fillText('RV', c.x, c.y);
      const d = this.c, probs = castleProblems(d), th = wallThick(d) * v.k;
      for (const s of wallSegs(d)) {
        const A = this._s(s.ax, s.az), B = this._s(s.bx, s.bz);
        g.strokeStyle = s.gate ? '#a0703f' : '#8d8a82'; g.lineWidth = Math.max(5, th * (s.gate ? 0.7 : 1)); g.lineCap = 'round';
        if (s.i === this.selEdge) g.strokeStyle = '#ffd34d';
        if (s.len < 3 || (s.gate && s.len < 5)) g.strokeStyle = '#ff5a4a';
        g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke();
        g.fillStyle = '#fff'; g.font = '11px system-ui'; g.fillText(s.gate ? 'gate' : `${s.len.toFixed(1)} m`, (A.x + B.x) / 2, (A.y + B.y) / 2 - 12); g.font = 'bold 13px system-ui';
      }
      d.pts.forEach((q, i) => { const s = this._s(q[0], q[1]); g.fillStyle = i === this.sel ? '#ffd34d' : '#fff'; g.strokeStyle = '#222'; g.lineWidth = 2; g.beginPath(); g.arc(s.x, s.y, d.turrets ? 9 : 7, 0, 7); g.fill(); g.stroke(); });
      if (probs.length) { g.fillStyle = '#ff8a80'; g.fillText(probs[0], W / 2, H - 14); }
    }
    g.fillStyle = '#fff'; g.font = 'bold 14px system-ui'; g.fillText('N ↑', W - 24, 18);
  }
}
