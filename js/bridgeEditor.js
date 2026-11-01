import { BMAT, SPAN, BridgeSim, AXLE_LOAD, anchorList, costOf, memberLen } from './bridge.js';
import { MAT_INFO } from './materials.js';
import { audio } from './audio.js';

const U0 = -4, U1 = SPAN + 4, VTOP = 6.5, SNAP = 0.5, WHEELBASE = 4.85;

// Workbench popup: craft planks + design the bridge in a side view, test it, build it.
export class BridgeEditor {
  constructor(bridgeWorld, materials, hooks) {
    this.bw = bridgeWorld; this.mats = materials; this.hooks = hooks;
    this.open = false; this.tool = 'road'; this.undo = []; this.drag = null; this.hover = null; this.test = null; this.result = '';
    this.waterY = bridgeWorld.W - bridgeWorld.D; this.bedY = bridgeWorld.BED - bridgeWorld.D;
    this.design = this._fresh(false);
    try { const s = JSON.parse(localStorage.getItem('rv-bridge-design')); if (s && s.nodes && s.members) this.design = s; } catch (e) { /* ignore */ }
    this._buildDOM();
    materials.onChange(() => { if (this.open) this._side(); });
  }

  _fresh(pier) { return { pier, nodes: anchorList(pier).map(a => ({ ...a, fixed: true })), members: [] }; }

  /* ---------- DOM ---------- */
  _buildDOM() {
    const root = this.root = document.createElement('div');
    root.id = 'bridgeUI'; root.className = 'hidden';
    root.innerHTML = `
      <div class="bbox">
        <div class="bhead"><b>🛠 Workbench · Bridge Designer</b><button data-a="close" class="bbtn y">Close (Esc)</button></div>
        <div class="bmain">
          <div class="bleft">
            <div class="btools">
              <button data-t="road" class="bbtn">🟫 Road</button><button data-t="log" class="bbtn">🪵 Beam</button><button data-t="rope" class="bbtn">🪢 Rope</button><button data-t="del" class="bbtn">✖ Delete</button>
              <span class="sep"></span><button data-a="undo" class="bbtn">↶ Undo</button><button data-a="clear" class="bbtn">Clear</button>
              <span class="sep"></span><button data-a="pier" class="bbtn">🪨 Stone pier (6 stones)</button>
            </div>
            <canvas width="960" height="520"></canvas>
            <div class="binfo"></div>
          </div>
          <div class="bside">
            <h4>Materials</h4><div class="bmats"></div>
            <h4>Craft</h4>
            <button data-a="craft1" class="bbtn wide">Saw 1 log → 2 planks</button>
            <button data-a="craftall" class="bbtn wide">Saw all logs</button>
            <h4>This design needs</h4><div class="bcost"></div>
            <button data-a="test" class="bbtn wide g">▶ Test with the RV's weight</button>
            <button data-a="build" class="bbtn wide y">🔨 Build bridge</button>
            <p class="bhelp">Drag from a joint (●) to draw a piece. <b>Road</b> is what the RV drives on and must reach both banks. Plain road alone sags and snaps — add <b>beams</b> in <b>triangles</b> under or over it, or hang it from <b>ropes</b> (rope only pulls). Red = overloaded.</p>
          </div>
        </div>
      </div>`;
    document.body.appendChild(root);
    this.cv = root.querySelector('canvas'); this.ctx = this.cv.getContext('2d');
    this.info = root.querySelector('.binfo');
    root.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.t) { this.tool = b.dataset.t; this._side(); }
      else this._action(b.dataset.a);
    });
    const pt = e => { const r = this.cv.getBoundingClientRect(); return this._toWorld((e.clientX - r.left) * this.cv.width / r.width, (e.clientY - r.top) * this.cv.height / r.height); };
    this.cv.addEventListener('pointerdown', e => { e.preventDefault(); this.cv.setPointerCapture(e.pointerId); this.hover = pt(e); this._down(pt(e)); });
    this.cv.addEventListener('pointermove', e => { this.hover = pt(e); if (!this.test) this.draw(); });
    this.cv.addEventListener('pointerup', e => { if (this.drag) this._up(pt(e)); });
    document.addEventListener('keydown', e => {
      if (!this.open) return;
      if (e.code === 'Escape' || e.code === 'KeyE') { e.preventDefault(); this.close(); }
      else if (e.code === 'KeyZ' && (e.metaKey || e.ctrlKey)) this._action('undo');
    });
  }

  show() {
    if (this.open) return;
    this.open = true; this.root.classList.remove('hidden');
    this.result = this.bw.state === 'damaged' ? '💥 The last bridge broke. Strengthen the red parts and build again (old materials are salvaged).' : '';
    this._side(); this.draw();
    this.hooks.onOpen();
    this._loop();
  }
  close() {
    if (!this.open) return;
    this.open = false; this.test = null; this.root.classList.add('hidden');
    try { localStorage.setItem('rv-bridge-design', JSON.stringify(this.design)); } catch (e) { /* ignore */ }
    this.hooks.onClose();
  }

  /* ---------- coordinates ---------- */
  get sc() { return this.cv.width / (U1 - U0); }
  _toPx(x, y) { return [(x - U0) * this.sc, (VTOP - y) * this.sc]; }
  _toWorld(px, py) { return { x: px / this.sc + U0, y: VTOP - py / this.sc }; }
  _snap(p) { return { x: Math.round(p.x / SNAP) * SNAP, y: Math.round(p.y / SNAP) * SNAP }; }
  _nodeAt(p, r = 0.45) { let bi = -1, bd = r; this.design.nodes.forEach((n, i) => { const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < bd) { bd = d; bi = i; } }); return bi; }
  _valid(p) { return p.x >= 0.5 && p.x <= SPAN - 0.5 && p.y <= 6 && p.y >= this.waterY + 0.3; }

  /* ---------- editing ---------- */
  _push() { this.undo.push(JSON.stringify(this.design)); if (this.undo.length > 60) this.undo.shift(); }
  _down(p) {
    if (this.test) return;
    if (this.tool === 'del') { this._delete(p); return; }
    const i = this._nodeAt(p), s = this._snap(p);
    if (i < 0 && !this._valid(s)) { this._msg('Joints must sit over the river, above the water.'); return; }
    this.drag = { a: i, p: i >= 0 ? { ...this.design.nodes[i] } : s };
  }
  _up(p) {
    const d = this.drag; this.drag = null;
    const j = this._nodeAt(p), e = j >= 0 ? this.design.nodes[j] : this._snap(p);
    const L = Math.hypot(e.x - d.p.x, e.y - d.p.y), t = BMAT[this.tool];
    if (L < 0.9) { this.draw(); return; }
    if (j < 0 && !this._valid(e)) { this._msg('That end point is outside the build area.'); this.draw(); return; }
    if (L > t.maxLen + 1e-6) { this._msg(`${t.name} can be at most ${t.maxLen} m long (this is ${L.toFixed(1)} m). Add a joint in between.`); this.draw(); return; }
    if (this.tool === 'road' && Math.abs(e.y - d.p.y) / Math.max(0.01, Math.abs(e.x - d.p.x)) > 0.4) { this._msg('Road pieces must be fairly level, or the RV can\'t drive on them.'); this.draw(); return; }
    this._push();
    const id = q => { const k = this._nodeAt(q, 0.1); if (k >= 0) return k; this.design.nodes.push({ x: q.x, y: q.y, fixed: false }); return this.design.nodes.length - 1; };
    const a = d.a >= 0 ? d.a : id(d.p), b = j >= 0 ? j : id(e);
    if (a === b || this.design.members.some(m => (m.a === a && m.b === b) || (m.a === b && m.b === a))) { this.undo.pop(); this.draw(); return; }
    this.design.members.push({ a, b, type: this.tool });
    audio.click(); this.result = ''; this._side(); this.draw();
  }
  _delete(p) {
    const D = this.design;
    let bi = -1, bd = 0.35;
    D.members.forEach((m, i) => { const A = D.nodes[m.a], B = D.nodes[m.b]; const d = segDist(p, A, B); if (d < bd) { bd = d; bi = i; } });
    const ni = this._nodeAt(p, 0.4);
    if (ni >= 0 && !D.nodes[ni].fixed) { this._push(); D.members = D.members.filter(m => m.a !== ni && m.b !== ni); }
    else if (bi >= 0) { this._push(); D.members.splice(bi, 1); }
    else return;
    this._prune(); audio.click(); this.result = ''; this._side(); this.draw();
  }
  // drop free joints that no longer have pieces, and re-index
  _prune() {
    const D = this.design, keep = D.nodes.map((n, i) => n.fixed || D.members.some(m => m.a === i || m.b === i));
    const map = []; let k = 0;
    D.nodes = D.nodes.filter((n, i) => { map[i] = keep[i] ? k++ : -1; return keep[i]; });
    D.members = D.members.filter(m => map[m.a] >= 0 && map[m.b] >= 0).map(m => ({ ...m, a: map[m.a], b: map[m.b] }));
  }
  _action(a) {
    if (a === 'close') return this.close();
    if (a === 'craft1' || a === 'craftall') {
      const n = a === 'craft1' ? Math.min(1, this.mats.get('logs')) : this.mats.get('logs');
      if (!n) { this._msg('No logs. Cut fallen trees, chop jungle trees, or take logs from the pile.'); return; }
      this.mats.spend({ logs: n }); this.mats.add('planks', n * 2); audio.thud(200, 0.08);
      this._msg(`Sawed ${n} log${n > 1 ? 's' : ''} into ${n * 2} planks.`); return;
    }
    if (this.test && a !== 'test') return;
    if (a === 'undo') { const s = this.undo.pop(); if (s) this.design = JSON.parse(s); }
    else if (a === 'clear') { this._push(); this.design = this._fresh(this.design.pier); }
    else if (a === 'pier') {
      this._push();
      const D = this.design;
      if (D.pier) { D.pier = false; const ids = [4, 5]; D.members = D.members.filter(m => !ids.includes(m.a) && !ids.includes(m.b)); D.nodes[4].fixed = D.nodes[5].fixed = false; this._prune(); }
      else {
        D.pier = true;
        const free = D.nodes.slice(4), fm = D.members;
        D.nodes = [...D.nodes.slice(0, 4), { x: SPAN / 2, y: 0, fixed: true }, { x: SPAN / 2, y: -2, fixed: true }, ...free];
        D.members = fm.map(m => ({ ...m, a: m.a >= 4 ? m.a + 2 : m.a, b: m.b >= 4 ? m.b + 2 : m.b }));
      }
    } else if (a === 'test') { if (this.test) { this.test = null; this.result = ''; } else this._startTest(); this._side(); this.draw(); return; }
    else if (a === 'build') return this._build();
    this.result = ''; this._side(); this.draw();
  }

  /* ---------- side panel ---------- */
  _side() {
    const R = this.root, cost = costOf(this.design), refund = this.bw.spent || {};
    R.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === this.tool));
    R.querySelector('[data-a="pier"]').classList.toggle('on', this.design.pier);
    R.querySelector('.bmats').innerHTML = Object.keys(MAT_INFO).map(k => `<div>${MAT_INFO[k].icon} ${MAT_INFO[k].name}<b>${this.mats.get(k)}</b></div>`).join('');
    R.querySelector('.bcost').innerHTML = Object.keys(MAT_INFO).filter(k => cost[k]).map(k => {
      const have = this.mats.get(k) + (refund[k] || 0), ok = have >= cost[k];
      return `<div class="${ok ? '' : 'bad'}">${MAT_INFO[k].icon} ${MAT_INFO[k].name}<b>${cost[k]} / ${have}</b></div>`;
    }).join('') || '<div class="dim">Nothing yet — start drawing.</div>';
    R.querySelector('[data-a="test"]').textContent = this.test ? '■ Stop test' : '▶ Test with the RV\'s weight';
    const t = BMAT[this.tool];
    this.info.innerHTML = this.result || (this.tool === 'del' ? 'Click a piece or joint to remove it.' :
      `<b>${t.name}</b>: max ${t.maxLen} m · costs 1 ${t.mat === 'logs' ? 'log' : t.mat === 'planks' ? 'plank' : 'rope'} per ${t.per} m · strength ${Math.round(t.max / 1000)} kN${t.tension ? ' (pull only)' : ''}`);
  }
  _msg(t) { this.result = t; this._side(); }

  _roadCovers() {
    const D = this.design, iv = D.members.filter(m => m.type === 'road').map(m => [Math.min(D.nodes[m.a].x, D.nodes[m.b].x), Math.max(D.nodes[m.a].x, D.nodes[m.b].x)]).sort((a, b) => a[0] - b[0]);
    let reach = 0;
    for (const [a, b] of iv) { if (a > reach + 0.05) return false; reach = Math.max(reach, b); }
    return reach >= SPAN - 0.05 && D.members.some(m => m.type === 'road' && (D.nodes[m.a].x === 0 || D.nodes[m.b].x === 0));
  }

  /* ---------- test drive (2D sim with the RV's axle loads) ---------- */
  _startTest() {
    if (!this._roadCovers()) { this._msg('⚠ The road must go all the way from the south bank (left) to the north bank (right).'); return; }
    this.test = { sim: new BridgeSim(this.design, this.bedY + 0.3), x: -1.5, t: 0, peak: 0, fail: null, done: false };
    this.result = 'Testing… the RV is rolling across.'; this._side();
  }
  _stepTest(dt) {
    const T = this.test, sim = T.sim;
    T.t += dt;
    sim.clearLoads();
    if (T.t > 1.3 && !T.fail) T.x += dt * 3.2;
    let gap = false;
    for (const ax of [T.x, T.x - WHEELBASE]) if (ax >= 0 && ax <= SPAN && !T.fail) { if (!sim.addLoad(ax, AXLE_LOAD)) gap = true; }
    sim.step(dt);
    if (T.t > 1.3) T.peak = Math.max(T.peak, sim.maxRatio);
    if (!T.fail && (sim.broke.length || gap)) {
      T.fail = T.t; sim.broke.length = 0;
      audio.thud(70, 0.3);
      this._msg(`❌ The bridge broke${gap ? ' and the RV fell through' : ''}. The red pieces were overloaded — add triangles, supports or ropes, or use a stone pier.`);
    }
    if (T.fail && T.t - T.fail > 2.5) { this.test = null; this._side(); }
    if (!T.fail && T.x - WHEELBASE > SPAN + 0.5) {
      const p = Math.round(T.peak * 100);
      this.test = null;
      this._msg(`✅ The bridge holds the RV! Peak stress ${p}%${p > 85 ? ' — risky, consider reinforcing.' : '.'} Press Build when ready.`);
    }
  }
  _loop() {
    if (!this.open) return;
    requestAnimationFrame(() => this._loop());
    if (this.test) { this._stepTest(1 / 60); this.draw(); }
  }

  _build() {
    if (!this._roadCovers()) { this._msg('⚠ The road must go all the way across before you can build.'); return; }
    const err = this.commit(this.design, true);
    if (err) { this._msg(err); return; }
    this.close();
  }
  // check materials, salvage the old bridge, pay and build. Returns an error message or null.
  commit(D, local) {
    const cost = costOf(D), refund = this.bw.spent || {};
    const pool = {}; for (const k in MAT_INFO) pool[k] = this.mats.get(k) + (refund[k] || 0);
    const missing = Object.keys(cost).filter(k => cost[k] > pool[k]);
    if (missing.length) return 'Not enough ' + missing.map(k => `${MAT_INFO[k].name.toLowerCase()} (${cost[k]} needed, ${pool[k]} available)`).join(', ') + '. Collect more or simplify the design.';
    if (local && this.hooks.remoteBuild) { this.hooks.remoteBuild(D); this.hooks.toast('🌉 Design sent to the host — building it for everyone…'); return null; }
    if (this.bw.spent) this.mats.addAll(this.bw.spent);   // salvage the previous bridge
    this.mats.spend(cost);
    this.bw.build(D); this.bw.spent = cost;
    audio.thud(150, 0.3);
    this.hooks.toast('🌉 Bridge built! Drive across slowly — watch for red (overloaded) parts.');
    this.hooks.onBuilt && this.hooks.onBuilt();
    return null;
  }

  /* ---------- drawing ---------- */
  draw() {
    const c = this.ctx, W = this.cv.width, H = this.cv.height, sc = this.sc;
    const sky = c.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#9cc6e6'); sky.addColorStop(1, '#d9ecf5');
    c.fillStyle = sky; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1;
    for (let x = Math.ceil(U0); x <= U1; x++) { const [px] = this._toPx(x, 0); c.beginPath(); c.moveTo(px, 0); c.lineTo(px, H); c.stroke(); }
    for (let y = -6; y <= 6; y++) { const [, py] = this._toPx(0, y); c.beginPath(); c.moveTo(0, py); c.lineTo(W, py); c.stroke(); }
    const [, wy] = this._toPx(0, this.waterY), [, by] = this._toPx(0, this.bedY);
    c.fillStyle = '#3d7fa6'; c.fillRect(0, wy, W, H - wy);
    c.fillStyle = '#6b5d42'; c.fillRect(0, by, W, H - by);
    const bank = (x0, x1) => { const [a, top] = this._toPx(x0, 0), [b] = this._toPx(x1, 0); c.fillStyle = '#8a877e'; c.fillRect(a, top, b - a, H - top); c.fillStyle = '#5c9a42'; c.fillRect(a, top - 6, b - a, 6); c.fillStyle = '#7a6446'; c.fillRect(a, top - 3, b - a, 3); };
    bank(U0, 0); bank(SPAN, U1);
    if (this.design.pier) { const [a, top] = this._toPx(SPAN / 2 - 0.7, 0), [b] = this._toPx(SPAN / 2 + 0.7, 0); c.fillStyle = '#8a877e'; c.fillRect(a, top, b - a, H - top); }
    c.fillStyle = 'rgba(255,255,255,.85)'; c.font = 'bold 14px system-ui'; c.textAlign = 'center';
    c.fillText('SOUTH BANK', this._toPx(-2, 0)[0], this._toPx(0, -1)[1]); c.fillText('NORTH BANK', this._toPx(SPAN + 2, 0)[0], this._toPx(0, -1)[1]);
    c.fillText('RIVER', this._toPx(SPAN / 2, 0)[0] + (this.design.pier ? 70 : 0), this._toPx(0, this.waterY - 1)[1]);

    const sim = this.test && this.test.sim;
    const nodes = sim ? sim.nodes : this.design.nodes, members = sim ? sim.members : this.design.members;
    for (const m of members) {
      if (m.broken) continue;
      const A = nodes[m.a], B = nodes[m.b], t = BMAT[m.type];
      const [x0, y0] = this._toPx(A.x, A.y), [x1, y1] = this._toPx(B.x, B.y);
      c.strokeStyle = sim ? stressColor(t.color, m.ratio) : t.color;
      c.lineWidth = m.type === 'road' ? 9 : m.type === 'log' ? 6 : 2.5; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    }
    nodes.forEach((n, i) => {
      if (!sim && !n.fixed && !this.design.members.some(m => m.a === i || m.b === i)) return;
      const [px, py] = this._toPx(n.x, n.y);
      if (n.fixed) { c.fillStyle = '#d9342b'; c.fillRect(px - 7, py - 7, 14, 14); }
      else { c.fillStyle = '#fff'; c.strokeStyle = '#333'; c.lineWidth = 2; c.beginPath(); c.arc(px, py, 6, 0, 7); c.fill(); c.stroke(); }
    });
    if (this.test) {
      const T = this.test, ys = [T.x, T.x - WHEELBASE].map(ax => { const r = ax >= 0 && ax <= SPAN ? T.sim.roadAt(ax) : null; return r ? r.y : (ax < 0 || ax > SPAN ? 0 : this.waterY); });
      const [fx, fy] = this._toPx(T.x, ys[0] + (T.fail ? -(T.t - T.fail) * 2 : 0)), [rx, ry] = this._toPx(T.x - WHEELBASE, ys[1] + (T.fail ? -(T.t - T.fail) * 2 : 0));
      c.save(); c.translate(rx, ry); c.rotate(Math.atan2(fy - ry, fx - rx));
      const len = Math.hypot(fx - rx, fy - ry);
      c.fillStyle = '#ebe3d1'; c.fillRect(-1.6 * sc, -3.0 * sc, len + 2.8 * sc, 2.6 * sc);
      c.fillStyle = '#8e2f22'; c.fillRect(-1.6 * sc, -1.4 * sc, len + 2.8 * sc, 0.25 * sc);
      c.fillStyle = '#18212a'; c.fillRect(0.2 * sc, -2.6 * sc, 1.2 * sc, 0.7 * sc); c.fillRect(2.2 * sc, -2.6 * sc, 1.2 * sc, 0.7 * sc);
      c.fillStyle = '#1e1e20'; for (const x of [0, len]) { c.beginPath(); c.arc(x, -0.45 * sc, 0.45 * sc, 0, 7); c.fill(); }
      c.restore();
    } else if (this.drag && this.hover) {
      const j = this._nodeAt(this.hover), e = j >= 0 ? this.design.nodes[j] : this._snap(this.hover);
      const L = Math.hypot(e.x - this.drag.p.x, e.y - this.drag.p.y), t = BMAT[this.tool], ok = L <= t.maxLen && L >= 0.9;
      const [x0, y0] = this._toPx(this.drag.p.x, this.drag.p.y), [x1, y1] = this._toPx(e.x, e.y);
      c.strokeStyle = ok ? t.color : '#ff4d3d'; c.globalAlpha = 0.7; c.lineWidth = 6; c.setLineDash([8, 6]);
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
      c.fillStyle = '#111'; c.font = 'bold 13px system-ui'; c.fillText(`${L.toFixed(1)} m`, (x0 + x1) / 2, (y0 + y1) / 2 - 10);
    } else if (this.hover && this.tool !== 'del') {
      const s = this._snap(this.hover), j = this._nodeAt(this.hover), [px, py] = this._toPx(j >= 0 ? this.design.nodes[j].x : s.x, j >= 0 ? this.design.nodes[j].y : s.y);
      c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 2; c.beginPath(); c.arc(px, py, 9, 0, 7); c.stroke();
    }
  }
}

function segDist(p, a, b) {
  const ex = b.x - a.x, ey = b.y - a.y, l = ex * ex + ey * ey || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l));
  return Math.hypot(p.x - a.x - ex * t, p.y - a.y - ey * t);
}
function stressColor(hex, r) {
  const k = Math.max(0, Math.min(1, (r - 0.45) / 0.55));
  const n = parseInt(hex.slice(1), 16), R = n >> 16, G = (n >> 8) & 255, B = n & 255;
  return `rgb(${Math.round(R + (255 - R) * k)},${Math.round(G * (1 - k) + 42 * k)},${Math.round(B * (1 - k) + 26 * k)})`;
}
export { memberLen };
