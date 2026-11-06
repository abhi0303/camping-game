// The machines' panels in the farm popup (js/farm/farmui.js): the gold mine (status, its night shift, progress to the next
// coin, the coins in its box, collect, upgrade) and the flour machine (buy it; wheat, capacity and its window, grinding,
// the packets in its tray, put wheat in, turn the millstone, collect, upgrade). Every number comes from the farm server's
// state, worked out to now (js/farm/machines/machineProduction.js); every button asks the server.
import { icon } from '../../icons.js';
import { levelOf } from './machineProduction.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ist = t => new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const istH = t => (((t + 19800e3) % 86400e3) + 86400e3) % 86400e3 / 3600e3;
const tile = (v, l, cls = '') => `<div class="fi-tile ${cls}"><b>${v}</b><small>${l}</small></div>`;
const coin = n => `${n} gold coin${n === 1 ? '' : 's'}`;
// a live countdown to moment t (farmui.js keeps it ticking): 18:05 · 1:20:30
const cd = (t, now) => { const s = Math.max(0, Math.ceil((t - now) / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0');
  return `<b data-cd="${new Date(t).toISOString()}" data-re="1">${h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${String(m).padStart(2, '0')}:${x}`}</b>`; };

/* ---------- the gold mine ---------- */
export function mineView(ui) {
  const e = ui.eco, M = e.machines();
  if (!M) return '<div class="fu-sub">The gold mine opens with the next farm server update.</div>';
  const now = e.serverNow(), m = e.mineNow(now), R = M.rules.mine, L = levelOf(R, m.level), next = R.levels.find(l => l.level === m.level + 1), busy = ui.busy ? 'disabled' : '';
  const h = istH(now), sched = `<div class="mc-sched"><div class="mc-bar">${[[0, R.end], [R.start, 24]].map(([a, b]) => `<i style="left:${a / 24 * 100}%;width:${(b - a) / 24 * 100}%"></i>`).join('')}<em style="left:${h / 24 * 100}%"></em></div>
    <div class="mc-hours"><span>12 AM</span><span>4 AM</span><span>12 PM</span><span>7 PM</span><span>12 AM</span></div></div>`;
  const status = m.running ? `<b class="fu-ok">Running</b> · stops at ${ist(m.switchAt)} (in ${cd(m.switchAt, now)})`
    : `<b class="fu-need">Stopped</b> — too noisy by day · starts at ${ist(m.switchAt)} (in ${cd(m.switchAt, now)})`;
  let html = `<div class="fu-npc"><span class="fu-ico">${icon('gold')}</span><span class="fu-say"><b>Gold mine · level ${m.level}</b>${esc(L.name)} — runs by itself from 7 PM to 4 AM (India time). No fuel, no feed. It's ${ist(now)} now.</span></div>
    <div class="fi-tiles">${tile(m.level, 'level')}${tile(m.running ? 'Running' : 'Stopped', 'status', m.running ? 'green' : '')}${tile(m.ready, 'coins in the box', m.ready ? 'gold' : '')}${tile(M.gold, 'farm gold')}</div>
    ${sched}<div class="fu-sub">${status}</div>
    <div class="fd-grow"><div class="fd-stage">Next coin</div><div class="fd-bar"><i style="width:${Math.round(m.progress * 100)}%"></i></div>
      <div class="fu-sub">${Math.round(m.progress * 100)}% done · ${m.running ? `ready in ${cd(m.nextCoinAt, now)}` : `ready at ${ist(m.nextCoinAt)} (after it starts)`} · 1 coin every ${L.min} minutes of running · about ${+m.perNight.toFixed(1)} a night</div></div>
    <button class="fu-go wide collect" data-x="mcollect" ${m.ready ? busy : 'disabled'}>${m.ready ? `${icon('gold')} Collect ${coin(m.ready)}` : 'No coins in the box yet'}</button>`;
  if (next) {
    const perNight = (24 - R.start + R.end) * 60 / next.min;
    html += `<div class="fu-row"><span class="fu-ico">⬆️</span><span class="fu-main"><span class="fu-name">Level ${next.level} · ${esc(next.name)}</span>
        <span class="fu-sub">1 coin every ${next.min} minutes (now ${L.min}) · about ${+perNight.toFixed(1)} a night · a bigger machine</span></span>
      <button class="fu-go" data-x="mup" data-l="${next.level}" ${M.gold < next.cost ? 'disabled' : busy}>Upgrade · ${coin(next.cost)}</button></div>`;
  } else html += '<div class="fu-sub fu-c">Top level — a coin every half hour of the night.</div>';
  html += `<div class="fu-sub">Gold coins are the farm's second money, shared by everyone: they buy the flour machine (across from the Farm Store) and upgrade the machines. Unfinished work at 4 AM carries on the next night.</div>`;
  return html;
}

/* ---------- the flour machine ---------- */
export function flourView(ui) {
  const e = ui.eco, M = e.machines();
  if (!M) return '<div class="fu-sub">The flour machine comes with the next farm server update.</div>';
  const R = M.rules.flour, busy = ui.busy ? 'disabled' : '', wheat = e.qty('wheat'), fl = e.cat('flour') || { name: 'Flour' };
  if (!M.flour) {
    const L1 = R.levels[0];
    return `<div class="fu-npc"><span class="fu-ico">${icon('flour')}</span><span class="fu-say"><b>Aata Chakki · flour machine</b>A stone mill to grind your wheat into flour: 10 wheat make ${L1.per10} packets of 10 kg. Upgrade it later to an electric machine that grinds by itself.</span></div>
      <div class="fi-tiles">${tile(R.buy, 'gold coins')}${tile(M.gold, 'farm gold', M.gold >= R.buy ? 'green' : '')}${tile(wheat, 'wheat in storage')}</div>
      <button class="fu-go wide" data-x="fbuy" ${M.gold < R.buy ? 'disabled' : busy}>${M.gold < R.buy ? `Need ${coin(R.buy - M.gold)} more — the gold mine makes them at night` : `Buy the flour machine · ${coin(R.buy)}`}</button>
      <div class="fu-sub">One machine for the whole farm — every member can use it.</div>`;
  }
  const now = e.serverNow(), f = e.flourNow(now), L = levelOf(R, f.level), next = R.levels.find(l => l.level === f.level + 1);
  const cap = (e.st.caps && e.st.caps.flour) || 0, maxIn = Math.max(0, Math.min(f.room, Math.floor(wheat / 10) * 10));
  const q = Math.min(Math.max(10, ui._q('b:wheatin', Math.min(100, maxIn) || 10)), Math.max(10, maxIn));
  const status = f.manual ? (f.hopper >= 10 ? 'Ready to turn' : 'Waiting for wheat') : f.grinding ? 'Grinding' : 'Waiting for wheat';
  let html = `<div class="fu-npc"><span class="fu-ico">${icon('flour')}</span><span class="fu-say"><b>Flour machine · level ${f.level}</b>${esc(L.name)} — 10 wheat → ${f.per10} packets (${f.per10 * 10} kg) · takes ${L.cap} wheat per ${L.winMin} minutes${f.manual ? ' · turned by hand' : ' · grinds by itself'}.</span></div>
    <div class="fi-tiles">${tile(status, 'status', f.grinding || (f.manual && f.hopper >= 10) ? 'green' : '')}${tile(wheat, 'wheat in storage')}${tile(f.hopper, 'wheat in the machine')}${tile(f.ready, 'packets in the tray', f.ready ? 'gold' : '')}${tile(`${e.qty('flour')}/${cap}`, 'flour in storage')}</div>
    <div class="fd-grow"><div class="fd-stage">Capacity · ${f.used} of ${L.cap} wheat put in</div><div class="fd-bar"><i style="width:${Math.round(f.used / L.cap * 100)}%"></i></div>
      <div class="fu-sub">${f.room ? `Room for ${f.room} more wheat now` : '<b class="fu-need">Full for now</b>'} · the capacity resets at ${ist(f.resetAt)} (in ${cd(f.resetAt, now)})</div></div>`;
  if (!f.manual && f.hopper >= 10) html += `<div class="fd-grow"><div class="fd-stage">Grinding · ${f.hopper} wheat left</div><div class="fd-bar"><i style="width:${Math.round(f.progress / 10 * 100)}%"></i></div>
      <div class="fu-sub">Next ${f.per10} packets in ${cd(f.nextAt, now)} · all done at ${ist(f.doneAt)}</div></div>`;
  // put wheat in, turn the millstone, collect
  html += `<div class="fu-row"><span class="fu-ico">${icon('wheat')}</span><span class="fu-main"><span class="fu-name">Add wheat</span><span class="fu-sub">${maxIn ? `By tens, up to ${maxIn} now` : wheat < 10 ? 'No wheat in the storage — harvest a field by the windmill' : 'The machine is full for now'}</span></span>
      ${maxIn ? ui._stepper('b:wheatin', q, maxIn) : ''}<span class="fu-col"><button class="fu-go" data-x="fadd" data-q="${q}" ${maxIn ? busy : 'disabled'}>Add ${q}</button>${maxIn > q ? `<button class="fu-go alt" data-x="fadd" data-q="${maxIn}" ${busy}>Fill · ${maxIn}</button>` : ''}</span></div>`;
  if (f.manual) html += `<button class="fu-go wide" data-x="fturn" ${f.hopper >= 10 ? busy : 'disabled'}>${f.hopper >= 10 ? `⚙ Turn the millstone · ${R.grindS} s → ${Math.min(R.batch, f.hopper)} wheat into ${Math.min(R.batch, f.hopper) / 10 * f.per10} packets` : 'Put wheat in to turn the millstone'}</button>`;
  html += `<button class="fu-go wide collect" data-x="fcollect" ${f.ready ? busy : 'disabled'}>${f.ready ? `${icon('flour')} Collect ${f.ready} packets (${f.ready * 10} kg)` : 'No flour in the tray yet'}</button>`;
  if (next) {
    const more = [next.per10 > L.per10 ? `10 wheat → ${next.per10} packets` : '', next.cap !== L.cap || next.winMin !== L.winMin ? `${next.cap} wheat per ${next.winMin} min` : '', L.manual ? 'electric — grinds by itself' : ''].filter(Boolean).join(' · ');
    html += `<div class="fu-row"><span class="fu-ico">⬆️</span><span class="fu-main"><span class="fu-name">Level ${next.level} · ${esc(next.name)}</span><span class="fu-sub">${more}</span></span>
      <button class="fu-go" data-x="fup" data-l="${next.level}" ${M.gold < next.cost ? 'disabled' : busy}>Upgrade · ${coin(next.cost)}</button></div>`;
  } else html += '<div class="fu-sub fu-c">Top level — 2000 wheat every half hour.</div>';
  html += `<div class="fu-sub">Farm gold: ${coin(M.gold)}. Flour packets go into the farm storage and sell at the Market (₹${fl.sell || 0} each). Wheat in the machine is never lost — it waits until it's ground.</div>`;
  return html;
}

// the panels' buttons (farmui.js calls this for data-x values it doesn't know)
export async function machineClick(ui, x, b) {
  const n = v => Number(v);
  if (x === 'mcollect') { let got = 0; await ui._do({ action: 'machine', machine: 'mine', op: 'collect' }, r => { got = r.result.got || 0; }); if (got && ui.g.onGold) ui.g.onGold(got); return true; }
  if (x === 'mup') { await ui._do({ action: 'machine', machine: 'mine', op: 'upgrade', level: n(b.dataset.l) }); return true; }
  if (x === 'fbuy') { await ui._do({ action: 'machine', machine: 'flour', op: 'buy' }); return true; }
  if (x === 'fadd') { await ui._do({ action: 'machine', machine: 'flour', op: 'add', qty: n(b.dataset.q) }, () => { delete ui.qty['b:wheatin']; }); return true; }
  if (x === 'fturn') { await ui._do({ action: 'machine', machine: 'flour', op: 'turnstart' }, () => { ui.close(); if (ui.g.onTurn) ui.g.onTurn(); }); return true; }
  if (x === 'fcollect') { await ui._do({ action: 'machine', machine: 'flour', op: 'collect' }); return true; }
  if (x === 'fup') { await ui._do({ action: 'machine', machine: 'flour', op: 'upgrade', level: n(b.dataset.l) }); return true; }
  return false;
}
