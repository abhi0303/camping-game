// Mobile controls: floating joystick (left), drag-to-look (right), context buttons.
// Everything feeds the normal Input object, so the game code doesn't care where input comes from.
const BUTTONS = [
  // code, label per mode ({mode: label}), modes shown
  ['KeyF', { foot: '✊', item: '🛠️', gun: '💥' }, 'foot'],
  ['Space', { foot: '⤒', drive: '🅿️', drone: '▲' }, 'foot drive drone'],
  ['KeyE', { foot: 'E', drive: '🚪', seat: '⬆️', drone: '↩️' }, 'foot drive seat drone'],
  ['KeyC', { foot: '⤓', drone: '▼' }, 'foot drone'],
  ['KeyG', { foot: 'GUN' }, 'foot'],
  ['KeyV', { foot: '👁️', drive: '🎥', seat: '👁️', drone: '🎥' }, 'foot drive seat drone'],
  ['KeyQ', { drive: '🛋️' }, 'drive'],
  ['KeyH', { drive: '📯' }, 'drive'],
  ['KeyL', { drive: '💡', seat: '💡' }, 'drive seat'],
  ['KeyR', { drive: '↺' }, 'drive'],
];

const GUN_SVG = '<svg class="gunIco" viewBox="0 0 64 22" aria-hidden="true"><path d="M17 6h46v3.4H31V12h-2l-1 3.4h-3.2L24 12h-6.5L3.4 19.5 1 13.4z M34 10.6h12.5v3.6H34z" fill="currentColor"/></svg>';

export class TouchUI {
  constructor(input) {
    this.input = input; this.enabled = input.touch; this.mode = '';
    if (!this.enabled) return;
    document.body.classList.add('touch');
    const root = this.root = document.createElement('div');
    root.id = 'touchUI';
    root.innerHTML = `<div id="tStick" class="hidden"><div id="tKnob"></div></div>
      <div id="tBtns">${BUTTONS.map(([code, , modes], i) => `<button class="tb${i < 2 ? ' big' : ''}" data-code="${code}" data-modes="${modes}"></button>`).join('')}</div>`;
    document.body.appendChild(root);
    this.base = root.querySelector('#tStick'); this.knob = root.querySelector('#tKnob');
    this.btns = [...root.querySelectorAll('.tb')];
    // buttons
    for (const b of this.btns) {
      b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); b.setPointerCapture(e.pointerId); b.classList.add('on'); input.press(b.dataset.code); });
      const up = e => { e.preventDefault(); b.classList.remove('on'); input.release(b.dataset.code); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    }
    // stick (left part of the screen) + look (right part) on the game canvas
    const cv = input.canvas;
    this.stickId = null; this.lookId = null; this.last = { x: 0, y: 0 }; this.origin = { x: 0, y: 0 };
    cv.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') return;
      e.preventDefault();
      if (e.clientX < innerWidth * 0.42 && this.stickId === null) {
        this.stickId = e.pointerId; this.origin = { x: e.clientX, y: e.clientY };
        this.base.style.left = e.clientX + 'px'; this.base.style.top = e.clientY + 'px';
        this.base.classList.remove('hidden'); input.stick.active = true; input.stick.x = input.stick.y = 0;
      } else if (this.lookId === null) { this.lookId = e.pointerId; this.last = { x: e.clientX, y: e.clientY }; }
      cv.setPointerCapture(e.pointerId);
    }, { passive: false });
    cv.addEventListener('pointermove', e => {
      if (e.pointerId === this.stickId) {
        const R = 58, dx = e.clientX - this.origin.x, dy = e.clientY - this.origin.y, d = Math.hypot(dx, dy), k = d > R ? R / d : 1;
        input.stick.x = (dx * k) / R; input.stick.y = -(dy * k) / R;
        this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
        input.lastInput = performance.now();
      } else if (e.pointerId === this.lookId) {
        input.dx += (e.clientX - this.last.x) * 2.4; input.dy += (e.clientY - this.last.y) * 2.4;
        this.last = { x: e.clientX, y: e.clientY }; input.lastInput = performance.now();
      }
    });
    const end = e => {
      if (e.pointerId === this.stickId) { this.stickId = null; input.stick.active = false; input.stick.x = input.stick.y = 0; this.base.classList.add('hidden'); this.knob.style.transform = ''; }
      if (e.pointerId === this.lookId) this.lookId = null;
    };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    document.addEventListener('gesturestart', e => e.preventDefault());
  }

  // mode: foot | drive | seat | drone ; holding: true when an item is in hand, 'gun' with the shotgun out
  setMode(mode, holding) {
    if (!this.enabled) return;
    const key = mode + (holding ? '+' : '');
    if (key === this.mode) return;
    this.mode = key;
    this.btns.forEach((b, i) => {
      const def = BUTTONS[i], show = def[2].split(' ').includes(mode);
      b.style.display = show ? '' : 'none';
      const lab = (holding === 'gun' && def[1].gun) || (holding === true && def[1].item) || def[1][mode] || def[1].foot || '';
      if (lab === 'GUN') b.innerHTML = GUN_SVG; else b.textContent = lab;
    });
  }
}
