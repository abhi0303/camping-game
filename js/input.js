// Keyboard + mouse + touch state. Pressed-this-frame sets are cleared by endFrame().
// Touch controls feed the same API: an analog stick (stick.x/y) and virtual keys (press/release).
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set(); this.pressed = new Set(); this.vdown = new Set();
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.locked = false; this.dragging = false; this.click = false;
    this.muted = false;                       // true while a UI popup is open
    this.stick = { active: false, x: 0, y: 0 };
    this.stickRun = true;                     // full stick = run (on foot)
    this.touch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
    this.lastInput = performance.now();
    const block = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) return;
      if (this.muted) return;
      if (block.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code); this.lastInput = performance.now();
    });
    addEventListener('keyup', e => { this.down.delete(e.code); });
    addEventListener('blur', () => { this.down.clear(); this.vdown.clear(); this.dragging = false; this.stick.active = false; });
    addEventListener('mousemove', e => {
      if (this.locked || this.dragging) { this.dx += e.movementX || 0; this.dy += e.movementY || 0; this.lastInput = performance.now(); }
    });
    canvas.addEventListener('mousedown', e => {
      if (this.touch && e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
      this.lastInput = performance.now();
      if (this.locked) { if (e.button === 0) this.click = true; }
      else this.dragging = true;
    });
    addEventListener('mouseup', () => { this.dragging = false; });
    canvas.addEventListener('wheel', e => { this.wheel += Math.sign(e.deltaY); this.lastInput = performance.now(); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    // Long-press on phones: no "select the whole page" blue highlight, copy menu, callout or image drag —
    // they also cancel the finger held on the joystick. Text fields keep it (long-press to paste a code / link).
    const editable = t => { const el = t && t.nodeType === 3 ? t.parentElement : t; return !!el && !!el.closest && !!el.closest('input, textarea, [contenteditable="true"], .irow code'); };
    document.addEventListener('contextmenu', e => { if (!editable(e.target)) e.preventDefault(); });
    document.addEventListener('selectstart', e => { if (!editable(e.target)) e.preventDefault(); });
    document.addEventListener('dragstart', e => { if (!editable(e.target)) e.preventDefault(); });
    // anything that still got selected somehow: clear it as soon as the finger lifts
    addEventListener('touchend', () => {
      const sel = window.getSelection && window.getSelection();
      if (sel && sel.rangeCount && !editable(document.activeElement) && !editable(sel.anchorNode)) sel.removeAllRanges();
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
  }
  requestLock() {
    if (this.touch) return;
    try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
  }
  // virtual buttons (touch UI)
  press(code) { if (this.muted) return; this.pressed.add(code); this.vdown.add(code); this.lastInput = performance.now(); }
  release(code) { this.vdown.delete(code); }
  tap(code) { this.press(code); setTimeout(() => this.release(code), 120); }

  _analog(c) {
    const s = this.stick;
    if (!s.active) return 0;
    return c === 'KeyW' ? Math.max(0, s.y) : c === 'KeyS' ? Math.max(0, -s.y) : c === 'KeyD' ? Math.max(0, s.x) : c === 'KeyA' ? Math.max(0, -s.x) : 0;
  }
  isDown(...codes) {
    if (this.muted) return false;
    for (const c of codes) {
      if (this.down.has(c) || this.vdown.has(c)) return true;
      if (c === 'ShiftLeft' && this.stickRun && this.stick.active && Math.hypot(this.stick.x, this.stick.y) > 0.92) return true;
    }
    return false;
  }
  wasPressed(code) { return !this.muted && this.pressed.has(code); }
  axis(neg, pos) {
    if (this.muted) return 0;
    const v = list => list.reduce((m, c) => Math.max(m, (this.down.has(c) || this.vdown.has(c)) ? 1 : this._analog(c)), 0);
    return v(pos) - v(neg);
  }
  endFrame() { this.pressed.clear(); this.dx = 0; this.dy = 0; this.wheel = 0; this.click = false; }
}
