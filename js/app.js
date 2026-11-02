// Installable app (PWA) glue for Android, iOS and desktop:
// service worker, "install" button / iOS add-to-home-screen hint, full screen + landscape lock on phones,
// keep the screen awake while playing, the Android back button, and short vibrations.
const $ = id => document.getElementById(id);
const ua = navigator.userAgent;
export const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = /android/i.test(ua);
export const isStandalone = () => matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

let installEvt = null, wake = null, playing = false, hooks = {};

export const app = {
  init(h = {}) {
    hooks = h;
    document.body.classList.toggle('standalone', isStandalone());
    document.body.classList.toggle('ios', isIOS);
    // offline cache + installability
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('./sw.js').catch(() => {});
    // Android / desktop Chrome: our own "Install the app" button
    addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; this._installUI(); });
    addEventListener('appinstalled', () => { installEvt = null; this._installUI(); hooks.toast && hooks.toast('📲 Installed! Start RV Van from your home screen'); });
    $('installBtn').addEventListener('click', async () => {
      if (!installEvt) return;
      installEvt.prompt();
      try { await installEvt.userChoice; } catch (e) { /* ignore */ }
      installEvt = null; this._installUI();
    });
    this._installUI();
    // full screen toggle in the menu (Android browsers, desktop; iPhone Safari can't do it — install the app there)
    const fsBtn = $('fsBtn');
    if (document.fullscreenEnabled && !isStandalone()) {
      fsBtn.classList.remove('hidden');
      const label = () => { fsBtn.textContent = document.fullscreenElement ? '⛶ Exit full screen' : '⛶ Full screen'; };
      fsBtn.addEventListener('click', e => { e.stopPropagation(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else this.fullscreen(); });
      document.addEventListener('fullscreenchange', label);
    }
    // keep the screen on while playing; ask again when coming back to the app
    document.addEventListener('visibilitychange', () => { if (!document.hidden && playing) this.keepAwake(); });
    // phones: re-measure after rotating (iOS reports the new size a moment later)
    const resized = () => setTimeout(() => dispatchEvent(new Event('resize')), 250);
    addEventListener('orientationchange', resized);
    if (window.visualViewport) visualViewport.addEventListener('resize', () => dispatchEvent(new Event('resize')));
    // Android back button / back gesture: close what's open or show the menu instead of leaving the game
    addEventListener('popstate', () => {
      if (!playing) return;
      history.pushState({ rv: 1 }, '');
      hooks.onBack && hooks.onBack();
    });
  },
  _installUI() {
    const show = !isStandalone() && (!!installEvt || isIOS);
    $('appRow').classList.toggle('hidden', !show);
    $('installBtn').classList.toggle('hidden', !installEvt);
    $('iosHint').classList.toggle('hidden', !(isIOS && !installEvt));
  },
  // called when a game starts (inside the tap on Play / Host / Join, so the browser allows it)
  enterGame(touch) {
    playing = true;
    history.pushState({ rv: 1 }, '');
    this.keepAwake();
    if (touch && !isStandalone() && !isIOS) this.fullscreen();
    else this.lockLandscape();
  },
  fullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenEnabled || document.fullscreenElement || !el.requestFullscreen) { this.lockLandscape(); return; }
    el.requestFullscreen({ navigationUI: 'hide' }).then(() => this.lockLandscape()).catch(() => {});
  },
  lockLandscape() {
    try { const o = screen.orientation; if (o && o.lock) o.lock('landscape').catch(() => {}); } catch (e) { /* not supported (iOS) */ }
  },
  async keepAwake() {
    try { if ('wakeLock' in navigator && !document.hidden && (!wake || wake.released)) wake = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed / not supported */ }
  },
  // short buzz on Android phones (iPhones don't vibrate from the web)
  haptic(ms) { try { if (navigator.vibrate && document.body.classList.contains('touch')) navigator.vibrate(ms); } catch (e) { /* ignore */ } },
};
