import * as THREE from 'three';
import { iconImage } from './icons.js';
import { X0, X1, Z0, Z1, SX, SZ, START, CAMP, BRIDGE, RIVER_HALF, NORTH, VALLEY, TOWER_ZONE, GIANT } from './terrain.js';

const RES = 512, RESZ = Math.round(RES * SZ / SX), VIEW = 110;   // base map pixels (width x height), minimap radius in metres

// Map image is painted once from the terrain; the minimap/big map just crop + draw markers.
export class MiniMap {
  constructor(world) {
    this.world = world;
    this.base = basePainter(world, RES).paint(Infinity).cv;
    this.hi = null;                              // a sharper map for the big view, painted a few rows a frame on first open
    this.mini = document.getElementById('minimap'); this.mctx = this.mini.getContext('2d');
    this.big = document.getElementById('bigmap'); this.bcv = document.getElementById('bigmapCanvas'); this.bctx = this.bcv.getContext('2d');
    this.bigOpen = false; this.t = 0; this.tBig = 0; this.hooks = null;
    this.view = { cx: 0, cz: 0, s: 1 }; this.dirty = true; this._me = null; this._markers = [];
    this._board();
    this._controls();
  }
  toPx(x, z) { return [((x - X0) / SX) * RES, ((Z1 - z) / SX) * RES]; }

  // the trailhead map board shows the same map
  _board() {
    const c = document.createElement('canvas'); c.width = RES; c.height = Math.round(RES * 0.7);
    const g = c.getContext('2d');
    g.drawImage(this.base, 0, RESZ - RES * 0.88, RES, RES * 0.7, 0, 0, c.width, c.height);
    g.fillStyle = 'rgba(40,25,10,.85)'; g.fillRect(0, 0, c.width, 34);
    g.fillStyle = '#f2e3b6'; g.font = 'bold 24px Georgia'; g.textAlign = 'center'; g.fillText('JUNGLE TRAIL MAP', c.width / 2, 25);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    this.world.mapBoard.material.map = tex; this.world.mapBoard.material.needsUpdate = true;
  }

  // the big map: opens zoomed in on the player with the mouse free (scroll = zoom, drag = move)
  toggleBig(on = !this.bigOpen) {
    if (on === this.bigOpen) return;
    this.bigOpen = on; this.big.classList.toggle('hidden', !on);
    if (on) {
      this._size();
      const me = this._me || { x: 0, z: 0 };
      this.view.cx = me.x; this.view.cz = me.z; this.view.s = Math.min(this.bcv.width, this.bcv.height) / 260;
      this._clamp(); this.dirty = true;
      if (!this.hi) this.hi = basePainter(this.world, RES * 2);
      this.hooks && this.hooks.onOpen && this.hooks.onOpen();
    } else this.hooks && this.hooks.onClose && this.hooks.onClose();
  }
  _size() {
    const r = this.bcv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    this.dpr = dpr; this.bcv.width = Math.max(200, Math.round(r.width * dpr)); this.bcv.height = Math.max(200, Math.round(r.height * dpr));
  }
  _sMin() { return Math.min(this.bcv.width / SX, this.bcv.height / SZ) * 0.96; }
  _clamp() {
    const v = this.view; v.s = Math.max(this._sMin(), Math.min(5 * this.dpr, v.s));
    const hw = this.bcv.width / 2 / v.s, hh = this.bcv.height / 2 / v.s;
    v.cx = SX / 2 < hw ? (X0 + X1) / 2 : Math.max(X0 + hw, Math.min(X1 - hw, v.cx));
    v.cz = SZ / 2 < hh ? (Z0 + Z1) / 2 : Math.max(Z0 + hh, Math.min(Z1 - hh, v.cz));
  }
  // zoom by factor k keeping the canvas point (px, py) where it is
  _zoom(k, px = this.bcv.width / 2, py = this.bcv.height / 2) {
    const v = this.view, W = this.bcv.width, H = this.bcv.height;
    const wx = v.cx + (px - W / 2) / v.s, wz = v.cz - (py - H / 2) / v.s;
    v.s *= k; this._clamp();
    v.cx = wx - (px - W / 2) / v.s; v.cz = wz + (py - H / 2) / v.s; this._clamp(); this.dirty = true;
  }
  _controls() {
    const cv = this.bcv, pts = new Map();
    const at = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * this.dpr, (e.clientY - r.top) * this.dpr]; };
    let pinch = 0;
    cv.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = at(e); this._zoom(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0016)), x, y); }, { passive: false });
    cv.addEventListener('pointerdown', e => { e.preventDefault(); cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, at(e)); cv.classList.add('drag'); pinch = 0; });
    cv.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      const p = at(e), q = pts.get(e.pointerId);
      if (pts.size === 1) { this.view.cx -= (p[0] - q[0]) / this.view.s; this.view.cz += (p[1] - q[1]) / this.view.s; this._clamp(); this.dirty = true; }
      pts.set(e.pointerId, p);
      if (pts.size === 2) {                                   // pinch: zoom by the change in finger distance, about their middle
        const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) this._zoom(d / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        pinch = d;
      }
    });
    const up = e => { pts.delete(e.pointerId); pinch = 0; if (!pts.size) cv.classList.remove('drag'); };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('dblclick', e => { const [x, y] = at(e); this._zoom(2, x, y); });
    this.big.addEventListener('click', e => {
      const b = e.target.closest('[data-bm]');
      if (b) {
        e.stopPropagation();
        const a = b.dataset.bm;
        if (a === 'in') this._zoom(1.6); else if (a === 'out') this._zoom(1 / 1.6);
        else if (a === 'me' && this._me) { this.view.cx = this._me.x; this.view.cz = this._me.z; this.view.s = Math.max(this.view.s, Math.min(this.bcv.width, this.bcv.height) / 230); this._clamp(); this.dirty = true; }
        else if (a === 'all') { this.view.s = 0; this._clamp(); this.dirty = true; }
        else if (a === 'close') this.toggleBig(false);
        return;
      }
      if (e.target === this.big) this.toggleBig(false);      // a click outside the map closes it
    });
    document.addEventListener('keydown', e => { if (this.bigOpen && !e.repeat && (e.code === 'Escape' || e.code === 'KeyM')) { e.preventDefault(); this.toggleBig(false); } });
    addEventListener('resize', () => { if (this.bigOpen) { this._size(); this._clamp(); this.dirty = true; } });
  }

  update(dt, me, markers) {
    this.t += dt;
    if (this.t > 1 / 15) { this.t = 0; this._drawMini(me, markers); }
    this._me = { x: me.x, z: me.z, yaw: me.yaw }; this._markers = markers;
    if (this.bigOpen) {
      if (this.hi && !this.hi.done && this.hi.paint(this.world.lite ? 24 : 48).done) this.dirty = true;   // (a few rows a frame: no stutter)
      this.tBig += dt;
      if (this.dirty || this.tBig > 0.2) { this.tBig = 0; this.dirty = false; this._drawBig(this._me, markers); }
    }
  }

  _drawMini(me, markers) {
    const c = this.mctx, S = this.mini.width, R = S / 2, k = (R / VIEW) / (RES / SX);
    const [bx, by] = this.toPx(me.x, me.z);
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, S, S);
    c.save(); c.beginPath(); c.arc(R, R, R - 3, 0, Math.PI * 2); c.clip();
    c.fillStyle = '#2d4f2a'; c.fillRect(0, 0, S, S);
    c.translate(R, R); c.scale(k, k); c.translate(-bx, -by);
    c.drawImage(this.base, 0, 0);
    c.setTransform(1, 0, 0, 1, 0, 0);
    for (const m of markers) {
      const [px, py] = this.toPx(m.x, m.z), sx = R + (px - bx) * k, sy = R + (py - by) * k;
      const d = Math.hypot(sx - R, sy - R);
      if (d > R - 10) { if (!m.edge) continue; const f = (R - 12) / d; this._icon(c, R + (sx - R) * f, R + (sy - R) * f, m, 12); continue; }
      this._icon(c, sx, sy, m, 15);
    }
    this._arrow(c, R, R, me.yaw, 8);
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 3; c.beginPath(); c.arc(R, R, R - 2, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#fff'; c.font = 'bold 12px system-ui'; c.textAlign = 'center'; c.fillText('N', R, 14);
  }

  _drawBig(me, markers) {
    const c = this.bctx, W = this.bcv.width, H = this.bcv.height, v = this.view, d = this.dpr || 1;
    const sx = x => W / 2 + (x - v.cx) * v.s, sy = z => H / 2 + (v.cz - z) * v.s;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#1d2a1c'; c.fillRect(0, 0, W, H);
    const base = this.hi && this.hi.done ? this.hi.cv : this.base, k = v.s * SX / base.width;
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(base, sx(X0), sy(Z1), base.width * k, base.height * k);
    // markers, then their labels (a label that would cover another one is left out)
    const boxes = [], size = Math.round(22 * d);
    const order = markers.slice().sort((a, b) => (b.label ? 1 : 0) - (a.label ? 1 : 0));
    for (const m of markers) this._icon(c, sx(m.x), sy(m.z), m, size, false);
    c.font = `bold ${Math.round(12 * d)}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const m of order) {
      if (!m.label || m.dot) continue;
      const x = sx(m.x), y = sy(m.z) + size * 0.62 + 9 * d, w = c.measureText(m.label).width + 10 * d, h = 17 * d;
      if (x < -w || x > W + w || y < -h || y > H + h) continue;
      const bx = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
      if (boxes.some(o => bx[0] < o[2] && bx[2] > o[0] && bx[1] < o[3] && bx[3] > o[1])) continue;
      boxes.push(bx);
      c.fillStyle = 'rgba(20,22,30,.78)'; c.fillRect(bx[0], bx[1], w, h);
      c.fillStyle = '#fff'; c.fillText(m.label, x, y + d);
    }
    for (const m of markers) if (m.dot && m.label) { c.fillStyle = m.dot; c.fillText(m.label, sx(m.x), sy(m.z) - size * 0.55); }
    c.textBaseline = 'alphabetic';
    this._arrow(c, sx(me.x), sy(me.z), me.yaw, 12 * d);
    // scale bar
    const want = 110 * d / v.s, nice = [10, 20, 50, 100, 200, 500, 1000].find(n => n >= want * 0.6) || 1000, bw = nice * v.s;
    const x0 = 16 * d, y0 = H - 18 * d;
    c.fillStyle = 'rgba(20,22,30,.7)'; c.fillRect(x0 - 8 * d, y0 - 20 * d, bw + 16 * d + 46 * d, 30 * d);
    c.fillStyle = '#fff'; c.fillRect(x0, y0 - 4 * d, bw, 4 * d); c.fillRect(x0, y0 - 9 * d, 2 * d, 9 * d); c.fillRect(x0 + bw - 2 * d, y0 - 9 * d, 2 * d, 9 * d);
    c.font = `bold ${Math.round(12 * d)}px system-ui`; c.textAlign = 'left'; c.fillText(nice >= 1000 ? '1 km' : nice + ' m', x0 + bw + 8 * d, y0);
  }

  _icon(c, x, y, m, size, labels) {
    if (m.dot) {                                   // other players: coloured dot
      c.fillStyle = m.dot; c.strokeStyle = '#111'; c.lineWidth = 2;
      c.beginPath(); c.arc(x, y, size * 0.32, 0, 7); c.fill(); c.stroke();
      if (labels && m.label) { c.font = 'bold 12px system-ui'; c.textAlign = 'center'; c.fillStyle = m.dot; c.fillText(m.label, x, y - size * 0.5); }
      return;
    }
    if (m.ring) { c.strokeStyle = '#ffd34d'; c.lineWidth = 3; c.beginPath(); c.arc(x, y, size * 0.75 + Math.sin(performance.now() / 200) * 2, 0, 7); c.stroke(); if (!m.icon) return; }
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const im = iconImage(m.icon);                  // the game's icon on a small dark badge
    if (im) {
      const r = size * 0.62;
      c.fillStyle = 'rgba(16,18,26,.72)'; c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1.2;
      c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.stroke();
      c.drawImage(im, x - r * 0.78, y - r * 0.78, r * 1.56, r * 1.56);
    }
    if (labels && m.label) {
      c.font = 'bold 12px system-ui'; const w = c.measureText(m.label).width + 10;
      c.fillStyle = 'rgba(20,22,30,.75)'; c.fillRect(x - w / 2, y + size * 0.6, w, 17);
      c.fillStyle = '#fff'; c.fillText(m.label, x, y + size * 0.6 + 9);
    }
    c.textBaseline = 'alphabetic';
  }
  _arrow(c, x, y, yaw, s) {
    c.save(); c.translate(x, y); c.rotate(yaw);
    c.fillStyle = '#ffd34d'; c.strokeStyle = '#222'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -s * 1.4); c.lineTo(s, s); c.lineTo(0, s * 0.45); c.lineTo(-s, s); c.closePath(); c.fill(); c.stroke();
    c.restore();
  }
}

// the map image, painted from the terrain: paint(rows) does a few rows at a time (Infinity: all of it)
function basePainter(world, res) {
  const T = world.T, resz = Math.round(res * SZ / SX), cv = document.createElement('canvas'); cv.width = res; cv.height = resz;
  const g = cv.getContext('2d'), img = g.createImageData(res, resz), d = img.data, step = SX / res;
  const lo = [76, 142, 50], hi = [136, 190, 80];
  let row = 0;
  const P = {
    cv, done: false,
    paint(rows) {
      const end = Math.min(resz, row + rows);
      for (let py = row; py < end; py++) for (let px = 0; px < res; px++) {
        const x = X0 + (px + 0.5) * step, z = Z1 - (py + 0.5) * step, h = T.heightAt(x, z);
        let r, gg, b;
        const rd = T.riverDistAt(x, z), od = T.roadDistAt(x, z);
        if (rd < RIVER_HALF + 0.8 && h < T.W + 0.4) { r = 70; gg = 146; b = 192; }
        else if (od < 4.6) { r = 196; gg = 160; b = 106; }
        else {
          const t = Math.max(0, Math.min(1, (h + 5) / 45));
          r = lo[0] + (hi[0] - lo[0]) * t; gg = lo[1] + (hi[1] - lo[1]) * t; b = lo[2] + (hi[2] - lo[2]) * t;
          if (Math.hypot(x - START.x, z - START.z) < 34 || Math.hypot(x - CAMP.x, z - CAMP.z) < 28 || Math.hypot(x - GIANT.x, z - GIANT.z) < 40
            || (Math.abs(x - TOWER_ZONE.x) < TOWER_ZONE.hw + 4 && Math.abs(z - TOWER_ZONE.z) < TOWER_ZONE.hd + 4)) { r += 30; gg += 22; b += 10; }
          if (h > 40) { const m = Math.min(1, (h - 40) / 30); r += (150 - r) * m; gg += (146 - gg) * m; b += (136 - b) * m; }
          const shade = 1 + (T.heightAt(x - 2, z + 2) - T.heightAt(x + 2, z - 2)) * 0.05;
          r *= shade; gg *= shade; b *= shade;
        }
        const i = (py * res + px) * 4; d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
      }
      row = end;
      if (row >= resz && !P.done) {
        g.putImageData(img, 0, 0);
        // bridge site marker line
        const p = (x, z) => [((x - X0) / SX) * res, ((Z1 - z) / SX) * res], k = res / RES;
        const [ax, ay] = p(BRIDGE.ax, BRIDGE.az), [bx, by] = p(BRIDGE.bx, BRIDGE.bz);
        g.strokeStyle = '#6e4a2a'; g.lineWidth = 3 * k; g.setLineDash([3 * k, 3 * k]); g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); g.setLineDash([]);
        // the sharper map also shows every tree's crown (painted when the big map is first opened, so the cleared farm stays clear)
        if (res > RES) {
          const m = res / SX;
          for (const cell of world.grid) for (const c of cell) {
            if (!c.tree) continue;
            const [x, y] = p(c.x, c.z), r = Math.max(1.5, (c.kind && c.kind.startsWith('tall') ? 3.4 : 2.3) * (c.sc || 1) * m);
            g.fillStyle = 'rgba(24, 60, 22, .38)'; g.beginPath(); g.arc(x + r * 0.25, y + r * 0.3, r, 0, 7); g.fill();
            g.fillStyle = /pine/.test(c.kind || '') ? '#5f8f3a' : '#6fae3c'; g.beginPath(); g.arc(x, y, r * 0.86, 0, 7); g.fill();
            g.fillStyle = 'rgba(200, 240, 120, .35)'; g.beginPath(); g.arc(x - r * 0.25, y - r * 0.3, r * 0.4, 0, 7); g.fill();
          }
        }
        P.done = true;
      }
      return P;
    },
  };
  return P;
}
