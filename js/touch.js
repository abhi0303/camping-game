// Mobile controls: floating joystick (left), drag-to-look (right), context buttons.
// Everything feeds the normal Input object, so the game code doesn't care where input comes from.
// white line icons (24x24)
const I = (paths, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths.split('|').map(d => `<path d="${d}"/>`).join('')}${extra}</svg>`;
export const ICON = {
  punch: I('M12 3l1.8 5.2L19 6.5l-3 4.5 4.5 3-5.4.6.4 5.4-3.5-4-3.5 4 .4-5.4-5.4-.6 4.5-3-3-4.5 5.2 1.7z'),
  use: I('M14.7 6.3a4 4 0 0 0-5.4 5.4L3.5 17.5l3 3 5.8-5.8a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z'),
  fire: I('M12 2v5|M12 17v5|M2 12h5|M17 12h5', '<circle cx="12" cy="12" r="6"/><circle class="fill" cx="12" cy="12" r="1.7"/>'),
  jump: I('M12 20V5|M6 11l6-6 6 6'),
  crouch: I('M12 4v15|M6 13l6 6 6-6'),
  up: I('M6 15l6-6 6 6'),
  down: I('M6 9l6 6 6-6'),
  brake: I('M10 17V7h3a3 3 0 0 1 0 6h-3', '<circle cx="12" cy="12" r="9.5"/>'),
  door: I('M13 3H6v18h7|M10 12h11|M17 8l4 4-4 4'),
  stand: I('M12 15V4|M8 8l4-4 4 4|M4 14v6h16v-6'),
  back: I('M9 14L4 9l5-5|M4 9h11a5 5 0 0 1 0 10h-4'),
  eye: I('M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z', '<circle cx="12" cy="12" r="3"/>'),
  sofa: I('M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3|M3 11h18v6H3z|M6 17v2|M18 17v2'),
  horn: I('M3 10v4h4l6 5V5L7 10H3z|M16 9a4 4 0 0 1 0 6|M19 6a8 8 0 0 1 0 12'),
  light: I('M9 18h6|M10 21h4|M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z'),
  reset: I('M3 12a9 9 0 1 0 2.8-6.5|M3 4v5h5'),
  E: '<b style="font-size:20px">E</b>',
  PULL: '<b style="font-size:17px;letter-spacing:.04em">PULL</b>',
  leave: I('M15 4h4v16h-4|M10 8l-4 4 4 4|M6 12h10'),
};
const CANNON_SVG = '<svg class="gunIco" viewBox="0 0 64 22" aria-hidden="true"><path d="M16 4.5 L61 1.5 L61 12.5 L16 13.5 Z M10 6 h8 v8 h-8z" fill="currentColor"/><circle cx="20" cy="16" r="5.2" fill="none" stroke="currentColor" stroke-width="2.6"/></svg>';
const BUTTONS = [
  // code, icon per mode ({mode: icon}), modes shown
  ['KeyF', { foot: 'punch', item: 'use', gun: 'fire' }, 'foot'],
  ['Space', { foot: 'jump', drive: 'brake', drone: 'up' }, 'foot drive drone'],
  ['KeyE', { foot: 'E', drive: 'door', seat: 'stand', drone: 'back', fish: 'E' }, 'foot drive seat drone fish'],
  ['KeyS', { fish: 'PULL' }, 'fish'],
  ['KeyQ', { fish: 'leave' }, 'fish'],
  ['KeyC', { foot: 'crouch', drone: 'down' }, 'foot drone'],
  ['KeyG', { foot: 'GUN' }, 'foot'],
  ['KeyV', { foot: 'eye', drive: 'eye', seat: 'eye', drone: 'eye', fish: 'eye' }, 'foot drive seat drone fish'],
  ['KeyQ', { drive: 'sofa' }, 'drive'],
  ['KeyH', { drive: 'horn' }, 'drive'],
  ['KeyL', { drive: 'light', seat: 'light' }, 'drive seat'],
  ['KeyR', { drive: 'reset' }, 'drive'],
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
      <div id="tBtns">${BUTTONS.map(([code, , modes], i) => `<button class="tb${i < 2 || code === 'KeyS' ? ' big' : ''}${code === 'KeyS' ? ' pull' : ''}" data-code="${code}" data-modes="${modes}"></button>`).join('')}</div>`;
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

  // mode: foot | drive | seat | drone | fish ; holding: true when an item is in hand, 'gun' with the shotgun out
  // (this.farm: Farm World — the gun button is left out)
  setMode(mode, holding) {
    if (!this.enabled) return;
    const key = mode + '|' + holding + '|' + (this.weapon || '') + '|' + !!this.farm;
    if (key === this.mode) return;
    this.mode = key;
    this.btns.forEach((b, i) => {
      const def = BUTTONS[i], show = def[2].split(' ').includes(mode) && !(this.farm && def[0] === 'KeyG');   // Farm World: no gun
      b.style.display = show ? '' : 'none';
      const lab = (holding === 'gun' && def[1].gun) || (holding === true && def[1].item) || def[1][mode] || def[1].foot || '';
      b.innerHTML = lab === 'GUN' ? (this.weapon === 'cannon' ? CANNON_SVG : GUN_SVG) : (ICON[lab] || '');
    });
  }
}
