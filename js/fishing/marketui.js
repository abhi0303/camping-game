// The Fish Market's screens, shown in the farm popup (FarmUI): the fisherman's menu, buying worms, the
// rods (3D pictures, a comparison, buy / upgrade), selling fish and the farm's fish collection. Buttons use
// FarmUI's actions (buy, sell, rod), so every purchase and sale goes through the server.
import { RODS, FISH } from './sim.js';
import { thumb } from './thumbs.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FISH_IDS = ['fish_small', 'fish_medium', 'fish_large'];
const MENU = [
  ['worms', '🪱', 'Buy worms', '10 worms for ₹1 · one worm per cast'],
  ['rods', '🎣', 'Buy & upgrade fishing rods', 'better rods hook bigger fish'],
  ['sell', '💰', 'Sell fish', 'small, medium and large fish'],
  ['book', '📖', 'View fish collection', 'everything the farm has caught'],
];
const pct = v => Math.round(v * 100) + '%';
const bar = (v, c = '#5aa9ff') => `<span class="fu-bar"><u style="width:${Math.max(4, Math.min(100, v * 100))}%;background:${c}"></u></span>`;

export function fishHead(ui) {
  const e = ui.eco, f = e.st.fishing || { rod: 1 };
  return `<div class="fu-head"><span class="fu-chip">💰 ₹${e.money}</span><span class="fu-chip">🪱 ${e.qty('worms')} worms</span><span class="fu-chip">🎣 ${esc(RODS[f.rod || 1].name)}</span>${FISH_IDS.map(k => `<span class="fu-chip">${(e.cat(k) || {}).icon || '🐟'} ${e.qty(k)}</span>`).join('')}</div>`;
}

export function fishMarketView(ui) {
  const e = ui.eco;
  if (!e.cat('worm_pack') || !e.cat('rod')) return '<div class="fu-sub">The Fish Market opens as soon as the farm server is updated.</div>';
  if (!ui.tab) {
    return `<div class="fu-npc fish"><span class="fu-ico">🧔</span><span><b>Fisherman:</b> “Welcome! Looking for worms, fishing rods or want to sell your catch?”</span></div>
      <div class="fu-menu">${MENU.map(([t, i, l, s]) => `<button data-x="tab" data-t="${t}"><span class="fu-ico">${i}</span><span><b>${l}</b><small>${s}</small></span></button>`).join('')}</div>
      <div class="fu-sub">🎣 The fishing docks are on the river — follow the stone path behind the Fish Market. Walk to the end of a dock and press E.</div>`;
  }
  const back = `<button class="fu-back" data-x="tab" data-t="">‹ Back to the fisherman</button>`;
  if (ui.tab === 'worms') return back + worms(ui);
  if (ui.tab === 'rods') return back + rods(ui);
  if (ui.tab === 'sell') return back + sell(ui);
  if (ui.tab === 'book') return back + book(ui);
  return back;
}

function worms(ui) {
  const e = ui.eco, k = e.cat('worm_pack'), have = e.qty('worms'), cap = e.st.caps.worms || 500, n = k.pack ? k.pack.n : 10;
  const room = Math.floor(Math.max(0, cap - have) / n), q = Math.min(ui._q('b:worm_pack', 1), Math.max(1, room));
  const quick = [1, 5, 10].filter(p => p <= room).map(p => `<button class="fu-go alt" data-x="buy" data-i="worm_pack" data-q="${p}" ${e.money < k.buy * p || ui.busy ? 'disabled' : ''}>${p * n} worms · ₹${k.buy * p}</button>`).join('');
  return `<div class="fu-row"><span class="fu-ico">🪱</span><span class="fu-main"><span class="fu-name">Worms · ${n} for ₹${k.buy}</span>
      <span class="fu-sub">You have <b>${have}</b> worms (the farm storage holds ${cap}). Every cast puts one worm on the hook — a fish that escapes keeps it.</span></span>
      ${room ? ui._stepper('b:worm_pack', q, room) : ''}<button class="fu-go" data-x="buy" data-i="worm_pack" data-q="${q}" ${!room || e.money < k.buy * q || ui.busy ? 'disabled' : ''}>${room ? `Buy ${q * n} · ₹${k.buy * q}` : 'Storage full'}</button></div>
    ${quick ? `<div class="fu-quick">${quick}</div>` : ''}`;
}

function rods(ui) {
  const e = ui.eco, have = (e.st.fishing && e.st.fishing.rod) || 1, levels = e.cat('rod').levels || [];
  const price = l => (levels.find(x => x.level === l) || {}).price || 0;
  const cards = [1, 2, 3].map(l => {
    const R = RODS[l], img = thumb('rod' + l), large = !!R.odds.fish_large;
    let btn;
    if (l === have) btn = '<span class="fr-tag on">✓ Equipped</span>';
    else if (l < have) btn = '<span class="fr-tag">Owned</span>';
    else if (l === have + 1) btn = `<button class="fu-go" data-x="rod" data-l="${l}" ${e.money < price(l) || ui.busy ? 'disabled' : ''}>${have === 1 && l === 2 ? 'Buy' : 'Upgrade'} · ₹${price(l)}</button>`;
    else btn = `<span class="fr-tag lock">🔒 Get Level ${l - 1} first</span>`;
    return `<div class="fr-card${l === have ? ' on' : ''}${l > have + 1 ? ' locked' : ''}">
      ${img ? `<img src="${img}" alt="">` : '<div class="fu-ico">🎣</div>'}
      <div class="fr-name">Level ${l} · ${esc(R.name)}</div>
      <div class="fr-price">${l === 1 ? 'Starter rod (free)' : '₹' + price(l)}</div>
      <div class="fr-stat"><span>Control</span>${bar((R.control - 0.6) / 0.7)}</div>
      <div class="fr-stat"><span>Hook time</span>${bar(R.hook / 1.6, '#f2c14e')}</div>
      <div class="fr-stat"><span>Bites</span>${bar(R.bite, '#5bd16a')}</div>
      <div class="fr-fish">${FISH_IDS.map(f => `<span class="${R.odds[f] ? '' : 'no'}">${(e.cat(f) || {}).icon || '🐟'} ${R.odds[f] ? pct(R.odds[f]) : '—'}</span>`).join('')}</div>
      <div class="fr-note">${large ? 'Catches large fish' : l === 1 ? 'Small and some medium fish' : 'More medium fish, steadier line'}</div>
      ${btn}</div>`;
  }).join('');
  const row = (label, fn) => `<tr><td>${label}</td>${[1, 2, 3].map(l => `<td class="${l === have ? 'on' : ''}">${fn(RODS[l], l)}</td>`).join('')}</tr>`;
  return `<div class="fr-grid">${cards}</div>
    <table class="fu-table fr-table"><tr><th>Compare</th><th>Lv 1</th><th>Lv 2</th><th>Lv 3</th></tr>
      ${row('Price', (R, l) => (l === 1 ? 'free' : '₹' + price(l)))}
      ${row('Line control', R => R.control.toFixed(2) + '×')}
      ${row('Time to set the hook', R => R.hook.toFixed(1) + ' s')}
      ${row('Missed pulls allowed', R => R.misses)}
      ${row('Chance of a bite', R => pct(R.bite))}
      ${row('Small · medium · large', R => FISH_IDS.map(f => (R.odds[f] ? pct(R.odds[f]) : '—')).join(' · '))}
    </table>
    <div class="fu-sub">Each player has their own rod. It's paid from the farm money and kept with your name. A better rod keeps the line tension lower, gives you longer to set the hook, and only the Level 3 rod can hook large fish.</div>`;
}

function sell(ui) {
  const e = ui.eco;
  const rows = FISH_IDS.map(id => {
    const k = e.cat(id); if (!k) return '';
    const have = e.qty(id), q = Math.min(ui._q('s:' + id, have), have), img = thumb(id);
    return `<div class="fu-row"><span class="fu-ico">${img ? `<img class="fu-thumb" src="${img}" alt="">` : k.icon}</span><span class="fu-main"><span class="fu-name">${esc(k.name)}</span><span class="fu-sub">₹${k.sell} each · the farm has ${have} / ${e.st.caps[id] || '—'}</span></span>
      ${have ? ui._stepper('s:' + id, q, have) : ''}<button class="fu-go sell" data-x="sell" data-i="${id}" data-q="${q}" ${!have || ui.busy ? 'disabled' : ''}>${have ? `Sell ${q} for ₹${k.sell * q}` : 'None yet'}</button></div>`;
  }).join('');
  const total = FISH_IDS.reduce((t, id) => t + e.qty(id) * ((e.cat(id) || {}).sell || 0), 0);
  return rows + `<div class="fu-sub">Everything in the fish storage is worth <b>₹${total}</b>. Fish are shared farm goods — any member can sell them.</div>`;
}

function book(ui) {
  const e = ui.eco, f = e.st.fishing || { caught: {}, best: {}, mine: 0 };
  const cards = FISH_IDS.map(id => {
    const k = e.cat(id) || {}, F = FISH[id], img = thumb(id), n = f.caught[id] || 0;
    return `<div class="fr-card${n ? '' : ' locked'}">${img ? `<img src="${img}" alt="">` : `<div class="fu-ico">${k.icon}</div>`}
      <div class="fr-name">${esc(k.name || id)}</div><div class="fr-price">₹${k.sell} each</div>
      <div class="fr-note">Caught by the farm: <b>${n}</b>${f.best[id] ? ` · best ${f.best[id]} kg` : ''}</div>
      <div class="fr-note">${F.pulls[0]}–${F.pulls[1]} pulls · ${F.weight[0]}–${F.weight[1]} kg${id === 'fish_large' ? ' · needs the Level 3 rod' : ''}</div>
      <div class="fr-note">In storage: ${e.qty(id)}</div></div>`;
  }).join('');
  return `<div class="fr-grid">${cards}</div><div class="fu-sub">You have caught <b>${f.mine || 0}</b> fish yourself.</div>`;
}
