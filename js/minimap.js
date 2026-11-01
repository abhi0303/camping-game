import * as THREE from 'three';
import { HALF, SIZE, START, CAMP, BRIDGE, RIVER_HALF } from './terrain.js';

const RES = 512, VIEW = 110;   // base map pixels, minimap radius in metres

// Map image is painted once from the terrain; the minimap/big map just crop + draw markers.
export class MiniMap {
  constructor(world) {
    this.world = world;
    this.base = paintBase(world);
    this.mini = document.getElementById('minimap'); this.mctx = this.mini.getContext('2d');
    this.big = document.getElementById('bigmap'); this.bcv = document.getElementById('bigmapCanvas'); this.bctx = this.bcv.getContext('2d');
    this.bigOpen = false; this.t = 0; this.tBig = 0;
    this._board();
  }
  toPx(x, z) { return [((x + HALF) / SIZE) * RES, ((HALF - z) / SIZE) * RES]; }

  // the trailhead map board shows the same map
  _board() {
    const c = document.createElement('canvas'); c.width = RES; c.height = Math.round(RES * 0.7);
    const g = c.getContext('2d');
    g.drawImage(this.base, 0, RES * 0.12, RES, RES * 0.7, 0, 0, c.width, c.height);
    g.fillStyle = 'rgba(40,25,10,.85)'; g.fillRect(0, 0, c.width, 34);
    g.fillStyle = '#f2e3b6'; g.font = 'bold 24px Georgia'; g.textAlign = 'center'; g.fillText('JUNGLE TRAIL MAP', c.width / 2, 25);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    this.world.mapBoard.material.map = tex; this.world.mapBoard.material.needsUpdate = true;
  }

  toggleBig(on = !this.bigOpen) { this.bigOpen = on; this.big.classList.toggle('hidden', !on); if (on) this.tBig = 1; }

  update(dt, me, markers) {
    this.t += dt;
    if (this.t > 1 / 15) { this.t = 0; this._drawMini(me, markers); }
    if (this.bigOpen) { this.tBig += dt; if (this.tBig > 0.2) { this.tBig = 0; this._drawBig(me, markers); } }
  }

  _drawMini(me, markers) {
    const c = this.mctx, S = this.mini.width, R = S / 2, k = (R / VIEW) / (RES / SIZE);
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
    const c = this.bctx, S = this.bcv.width, k = S / RES;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.base, 0, 0, S, S);
    for (const m of markers) { const [px, py] = this.toPx(m.x, m.z); this._icon(c, px * k, py * k, m, 22, true); }
    const [px, py] = this.toPx(me.x, me.z);
    this._arrow(c, px * k, py * k, me.yaw, 12);
    c.fillStyle = 'rgba(20,22,30,.75)'; c.fillRect(10, S - 34, 250, 24);
    c.fillStyle = '#fff'; c.font = '13px system-ui'; c.textAlign = 'left'; c.fillText('M or Esc to close · ▲ you are here', 18, S - 17);
  }

  _icon(c, x, y, m, size, labels) {
    if (m.dot) {                                   // other players: coloured dot
      c.fillStyle = m.dot; c.strokeStyle = '#111'; c.lineWidth = 2;
      c.beginPath(); c.arc(x, y, size * 0.32, 0, 7); c.fill(); c.stroke();
      if (labels && m.label) { c.font = 'bold 12px system-ui'; c.textAlign = 'center'; c.fillStyle = m.dot; c.fillText(m.label, x, y - size * 0.5); }
      return;
    }
    if (m.ring) { c.strokeStyle = '#ffd34d'; c.lineWidth = 3; c.beginPath(); c.arc(x, y, size * 0.75 + Math.sin(performance.now() / 200) * 2, 0, 7); c.stroke(); if (!m.icon) return; }
    c.font = `${size}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(m.icon, x, y);
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

function paintBase(world) {
  const T = world.T, cv = document.createElement('canvas'); cv.width = cv.height = RES;
  const g = cv.getContext('2d'), img = g.createImageData(RES, RES), d = img.data, step = SIZE / RES;
  const lo = [42, 92, 40], hi = [120, 160, 80];
  for (let py = 0; py < RES; py++) for (let px = 0; px < RES; px++) {
    const x = -HALF + (px + 0.5) * step, z = HALF - (py + 0.5) * step, h = T.heightAt(x, z);
    let r, gg, b;
    const rd = T.riverDistAt(x, z), od = T.roadDistAt(x, z);
    if (rd < RIVER_HALF + 0.8 && h < T.W + 0.4) { r = 61; gg = 127; b = 166; }
    else if (od < 4.6) { r = 176; gg = 146; b = 98; }
    else {
      const t = Math.max(0, Math.min(1, (h + 5) / 45));
      r = lo[0] + (hi[0] - lo[0]) * t; gg = lo[1] + (hi[1] - lo[1]) * t; b = lo[2] + (hi[2] - lo[2]) * t;
      if (Math.hypot(x - START.x, z - START.z) < 34 || Math.hypot(x - CAMP.x, z - CAMP.z) < 28) { r += 30; gg += 25; b += 10; }
      if (h > 40) { const m = Math.min(1, (h - 40) / 30); r += (130 - r) * m; gg += (125 - gg) * m; b += (115 - b) * m; }
      const shade = 1 + (T.heightAt(x - 2, z + 2) - T.heightAt(x + 2, z - 2)) * 0.05;
      r *= shade; gg *= shade; b *= shade;
    }
    const i = (py * RES + px) * 4; d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // bridge site marker line
  const p = (x, z) => [((x + HALF) / SIZE) * RES, ((HALF - z) / SIZE) * RES];
  const [ax, ay] = p(BRIDGE.ax, BRIDGE.az), [bx, by] = p(BRIDGE.bx, BRIDGE.bz);
  g.strokeStyle = '#6e4a2a'; g.lineWidth = 3; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); g.setLineDash([]);
  return cv;
}
