import * as THREE from 'three';
import { World } from './world.js';
import { RV } from './rv.js';
import { Player } from './player.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { audio } from './audio.js';
import { Inventory } from './inventory.js';
import { Gear } from './gear.js';
import { Drone } from './drone.js';
import { BridgeWorld, AXLE_LOAD, PLAYER_LOAD } from './bridge.js';
import { BridgeEditor } from './bridgeEditor.js';
import { Obstacles } from './obstacles.js';
import { Materials, MAT_INFO } from './materials.js';
import { MiniMap } from './minimap.js';
import { START, CAMP, BRIDGE, VALLEY, GIANT } from './terrain.js';
import { AXLE_F, AXLE_R } from './rvDims.js';
import { Net, cleanRoomCode } from './net.js';
import { Remotes } from './remote.js';
import { Session, MAX_PLAYERS } from './multiplayer.js';
import { TouchUI } from './touch.js';
import { Save, CheckpointFlags } from './save.js';
import { Zombies } from './zombies.js';
import { Survival } from './survival.js';
import { Combat, Tracers } from './combat.js';
import { Voice } from './voice.js';
import { Structures } from './structures.js';
import { Designer } from './designer.js';
import { Giants } from './giants.js';
import { PLAYER_COLORS } from './remote.js';
import { app } from './app.js';
import { Farm } from './farm/farm.js';
import { FarmMenu } from './farm/menu.js';
import { FarmPanel } from './farm/panel.js';
import { FarmEconomy } from './farm/economy.js';
import { Farmland } from './farm/farmland.js';
import { FarmUI } from './farm/farmui.js';
import { MARKET, STORE, STORAGE, PLOTS, FARM_CENTER, FISH_MARKET, ROAD_U, ROAD_V, inFarm } from './farm/layout.js';
import { FishingArea } from './fishing/area.js';
import { Fishing } from './fishing/fishing.js';
import { Notebook } from './farm/notebook.js';
import { Ambience } from './ambience.js';
import { Birds } from './birds.js';
import { Grass } from './grass.js';
import { Music } from './music.js';
import { icon, startIconizer } from './icons.js';
import { RIVER_HALF } from './terrain.js';

const $ = id => document.getElementById(id);
// icons instead of emoji: fill the placeholders in the page, then keep every emoji written later out of sight
for (const el of document.querySelectorAll('i[data-ic]')) el.outerHTML = icon(el.dataset.ic);
$('hpText').insertAdjacentHTML('beforebegin', icon('heart', 'hpIco'));
startIconizer();

/* ---------- renderer ---------- */
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power', stencil: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setSize(innerWidth, innerHeight, false);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.15, 520);

const input = new Input(canvas);
const touch = new TouchUI(input);
let savedQ = null;
try { savedQ = localStorage.getItem('rv-quality'); } catch (e) { /* ignore */ }

/* ---------- game objects ---------- */
const world = new World(scene, { lite: input.touch || savedQ === 'low' });
const bridgeWorld = new BridgeWorld(scene, world, msg => toast(msg));
world.bridge = bridgeWorld;
const net = new Net();
const rvs = [];
const rv0 = new RV(scene, world, 0);
rvs.push(rv0);
const player = new Player(scene, world, rv0);
player.rvs = rvs;
const rig = new CameraRig(camera);
rig.world = world;
const drone = new Drone(scene, world, rv0);
drone.rvs = rvs;
const uiHooks = {
  // popups need the cursor: free the pointer without pausing
  onOpen: () => { input.muted = true; input.down.clear(); input.vdown.clear(); if (document.pointerLockElement) document.exitPointerLock(); },
  onClose: () => { setTimeout(() => { input.muted = false; input.pressed.clear(); }, 0); if (started && !paused) input.requestLock(); },
  toast: msg => toast(msg),
};
const inv = new Inventory({ ...uiHooks, onChange: () => gear.refreshHeld(), onStorage: st => session.sendStorage(st) });
inv.player = player; inv.addRV(rv0);
const gear = new Gear(scene, world, rv0, player, inv, drone, msg => toast(msg));
player.gear = gear; player.extraActs = inv.acts();
rig.drone = drone; rig.gear = gear;
const materials = new Materials();
const obstacles = new Obstacles(scene, world, materials, msg => toast(msg));
gear.obstacles = obstacles; gear.materials = materials;
const editor = new BridgeEditor(bridgeWorld, materials, { ...uiHooks, onBuilt: () => { session.dirty = true; saveNow(); } });
const minimap = new MiniMap(world);
const flags = new CheckpointFlags(scene, world, rv0.checkpoints);
const remotes = new Remotes(scene, rvs);
let objI = 0;
const session = new Session({ net, player, rvs, addRV, remotes, obstacles, bridgeWorld, editor, materials, world, inv, gear,
  toast: m => toast(m), getObj: () => objI, setObj: v => { objI = v; }, onRoster: () => renderRoster() });

/* ---------- zombie nights: zombies, shotgun, health, revive/carry, RV damage ---------- */
const zombies = new Zombies(scene, world);
const giants = new Giants(scene, world);
const structures = new Structures(scene, world, m => toast(m));
structures.player = player;
const tracers = new Tracers(scene);
const combat = new Combat({ scene, camera, rig, player, gear, zombies, giants, tracers, world, toast: m => toast(m),
  onHits: (h, x, z) => survival.onHits(h, x, z), onGiantHit: h => survival.onGiantHit(h), weapon: () => survival.weapon });
const survival = new Survival({ net, session, player, rvs, remotes, zombies, giants, structures, combat, gear, inv, world, materials, rig, camera,
  toast: m => toast(m), myName: () => session.myName, colorOfSlot: c => PLAYER_COLORS[c % PLAYER_COLORS.length].css,
  onEnd: () => { if (!net.isGuest && !farm.active) Save.clear(); },
  onLeave: () => { try { net.leave(); } catch (e) { /* ignore */ } location.replace(location.pathname); },
  onEndScreen: () => { if (document.pointerLockElement) document.exitPointerLock(); },
  onStage: () => { session.dirty = true; saveNow(); } });
remotes.tracers = tracers; remotes.listener = camera.position; remotes.localRoot = player.char.root; remotes.night = () => survival.isNight; remotes.combat = combat;
const designer = new Designer({ materials, structures, hooks: { ...uiHooks, commit: (kind, d) => survival.commitBuild(kind, d, true), ready: () => survival.ready(), canReady: kind => survival.canReady(kind) } });
gear.repair = type => survival.repair(type);
player.canDrive = rv => survival.canDrive(rv);
const voice = new Voice({ net, session, remotes, toast: m => toast(m), onChange: () => renderVoice() });
survival.g.voice = voice;
player.netExtra = () => ({ sh: combat.shots, sf: survival.safeSpot(), mc: voice.micOn ? 1 : 0 });
Object.assign(session.g, {
  onPlayerGone: id => survival.playerGone(id),
  survivalState: cid => survival.state(cid),
  applySurvival: d => survival.applyState(d),
  buildState: () => structures.save(),
  applyBuild: d => structures.load(d),
  onBackground: dt => survival.background(dt),
  // 🔄 Sync (host) / a host's sync reaching a guest: fresh game state + new voice links
  onResync: () => { survival.dirty = true; voice.restart(); },
  // kicked by the host: back to the start screen with a message
  onKicked: (msg, why) => { if (farm.active) farm.gone(msg, why === 'removed'); else backToMenu(msg); },
});
// back to the start screen with a message (keeps ?api= when testing on this computer)
function backToMenu(msg, mode) {
  try { sessionStorage.setItem('rv-flash', msg); sessionStorage.setItem('rv-tab-keep', '1'); if (mode) sessionStorage.setItem('rv-mode-next', mode); } catch (e) { /* ignore */ }
  const api = new URLSearchParams(location.search).get('api');
  location.replace(location.pathname + (api && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? '?api=' + encodeURIComponent(api) : ''));
}

/* ---------- Farm World: a permanent world saved online, for up to 4 members (js/farm) ---------- */
const farm = new Farm({ net, session, toast: m => toast(m),
  collectWorld: () => collectWorld(), applyWorld: w => applyWorld(w), freshWorld: () => survival.setFarm(),
  onGone: msg => backToMenu(msg, 'farm'), onRoster: () => renderRoster(), onHosting: () => renderRoster() });
session.farm = farm;
survival.g.farmHud = () => farmHud();
// the farm itself: plots, shelters, animals and the market. The numbers come from the server (farmEco).
const farmland = new Farmland(scene, world, { onMarket: () => farmUI.open('market'), onStore: () => farmUI.open('store'), onStorage: () => farmUI.open('storage'),
  onPlot: i => farmUI.open('plot', i), onShelter: b => farmUI.open('shelter', b), onFeed: b => farmUI.open('feed', b),
  onCollect: b => farmUI.collect(b), eggsIn: b => (farmEco.ready ? farmEco.shelterInfo(b).ready : 0),
  // gates: move at once here and for the others (PeerJS), then the server keeps it (shared and saved)
  onGate: (b, open) => {
    farmland.setGate(b.id, open, true); audio.thud(open ? 120 : 90, 0.07);
    try { net.send('farmGate', { id: b.id, open }); } catch (e) { /* playing alone */ }
    farmEco.act({ action: 'gate', shelter: b.id, open }).then(() => farmland.gateDone(b.id),
      e => { toast('⚠ ' + (e.message || e)); farmland.setGate(b.id, null); try { net.send('farmGate', { id: b.id, open: !open }); } catch (er) { /* alone */ } });
  } });
net.on('farmGate', d => { if (d && typeof d.id === 'string') farmland.setGate(d.id, !!d.open); });
rig.clip = (t, d, dist) => (farm.active ? farmland.camClip(t, d, dist) : dist);
const farmEco = new FarmEconomy({ net, toast: m => toast(m), onGone: msg => farm.gone(msg, true),
  onChange: st => { farmland.setState(st); farmUI.render(); farmUI.renderBar(farm.active); notebook.render(); if (!overlay.classList.contains('hidden')) farmPanel.render(); } });
// day and night (js/day-night.js): Farm World follows the real time in India by the farm server's clock, the
// same for every member, so the sun, sky and lamps match on every screen without any messages
world.dayNight.clock = () => farmEco.serverNow();
world.dayNight.synced = () => farmEco.syncAt > 0;
const PHASE_MSG = { evening: '🌇 Evening — the sun is going down; the lamps come on at dusk', night: '🌙 Night has fallen — lanterns, windows and torches light the farm', morning: '🌅 Sunrise — a new day on the farm' };
world.dayNight.onPhase = ph => { if (started && survival.farm && PHASE_MSG[ph]) toast(PHASE_MSG[ph]); };
const farmUI = new FarmUI({ eco: farmEco, materials, toast: m => toast(m), hooks: uiHooks, onCollect: () => { farmEco.collected = true; audio.thud(300, 0.05); },
  beforeOpen: () => notebook.close() });
// the bag (Farm Notebook) and the order slip: floating buttons, N / O
const notebook = new Notebook({ eco: farmEco, materials, hooks: uiHooks, worldName: () => (farm.L ? farm.L.roomName : ''),
  dateText: () => new Date(farmEco.serverNow()).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }),
  beforeOpen: () => { if (farmUI.isOpen) farmUI.close(); } });
farmUI.book = notebook;
// fishing (Farm World): the Fish Market, the docks on the river and the mini-game; the server checks catches
const fishArea = new FishingArea(scene, world);
const fishing = new Fishing({ scene, area: fishArea, eco: farmEco, player, gear, remotes, input, audio, toast: m => toast(m), haptic: ms => app.haptic(ms),
  beforeStart: () => { if (combat.out) combat.setOut(false); if (farmUI.isOpen) farmUI.close(); },
  openMarket: () => farmUI.open('fish'), onCatch: () => { farmEco.fished = true; },
  freeMouse: () => { if (document.pointerLockElement) document.exitPointerLock(); },
  lockMouse: () => { if (started && !paused && !input.locked) input.requestLock(); } });
player.fishing = fishing;
// birds in the trees and the sky; the jungle's sounds (crickets, toads, birdsong, the river, footsteps)
const birds = new Birds(scene, world);
const grass = new Grass(scene, world);             // wild flowers around the player (js/grass.js)
const music = new Music();                         // Farm World's tune (js/music.js)
const ambience = new Ambience();
const listener = { x: 0, z: 0, fx: 0, fz: 1 }, _fwd = new THREE.Vector3();
fishArea.onJump = (x, z, landing) => ambience.onFishJump(x, z, landing, listener, fishing.active);
{ const base = player.netExtra; player.netExtra = () => ({ ...base(), ...fishing.netExtra() }); }

function setupRV(r) { r.onMsg = m => toast(m); r.onCheckpoint = onCheckpoint; }
setupRV(rv0);
function addRV() {
  const r = new RV(scene, world, rvs.length);
  setupRV(r); rvs.push(r); inv.addRV(r);
  if (net.isHost) r.owner = net.id;
  toast(`🚐 RV ${rvs.length} arrived at the trailhead for the new team`);
  return r;
}
player.canUseSeat = (rv, seat) => remotes.seatTaken(rvs.indexOf(rv), seat);
player.onDrive = rv => session.claimRV(rv);
gear.onDeploy = d => session.sendDeploy(d);
gear.onPack = d => session.sendPack(d);
obstacles.onChange = () => { session.dirty = true; };
materials.onChange(() => { session.dirty = true; });
player.spawnBesideRV();
rig.yaw = player.yaw + Math.PI + 0.55;

/* ---------- world interactions: crates, workbench, map board, checkpoint flags ---------- */
const crateActs = world.crates.map((c, i) => ({ c, pos: c.pos, r: 2.2, label: () => c.label, act: () => {
  if (c.taken) return;
  c.taken = true; audio.thud(140, 0.1);
  if (net.isGuest) net.send('crate', { i }, true); else { materials.addAll(c.give); session.dirty = true; }
  toast('Got ' + Object.entries(c.give).map(([k, n]) => `+${n} ${MAT_INFO[k].name.toLowerCase()}`).join(', '));
} }));
const benchAct = { pos: bridgeWorld.workbenchPos, r: 2.6, label: () => 'Use the workbench (craft planks · design the bridge)', act: () => editor.show() };
const towerBenchAct = { pos: world.towerBenchPos, r: 2.6, label: () => (survival.at('tbuild') ? (structures.tDesign ? 'Tower workbench (built ✓ · craft planks)' : 'Use the Tower workbench (design + build towers)') : 'Tower workbench — opens when you reach the valley'),
  act: () => { if (survival.at('tbuild')) designer.show('towers'); else toast('Bring the RV to Watchtower Valley first'); } };
const castleBenchAct = { pos: world.castleBenchPos, r: 2.6, label: () => (survival.at('cbuild') ? (structures.cDesign ? 'Castle workbench (built ✓ · craft planks)' : 'Use the Castle workbench (design + build the wall)') : 'Castle workbench — opens after the valley siege'),
  act: () => { if (survival.at('cbuild')) designer.show('castle'); else toast('Survive the valley siege first'); } };
const boardAct = { pos: world.mapBoardPos, r: 2.6, label: () => 'Look at the trail map', act: () => minimap.toggleBig(true) };
const flagActs = flags.acts(() => manualSave());
player.worldActs = () => {
  const l = gear.worldActs(), eq = inv.equippedItem();
  l.push(...obstacles.acts(eq && eq.type));
  for (const a of crateActs) if (!a.c.taken) l.push(a);
  l.push(benchAct, boardAct, towerBenchAct, castleBenchAct, ...flagActs, ...survival.acts(), ...structures.acts());
  if (farm.active) l.push(...farmland.acts(), ...fishing.acts());
  return l;
};

/* ---------- objectives ---------- */
const anyRV = fn => rvs.some(fn);
const OBJ = [
  { text: 'Get a chainsaw (or axe) and the sledgehammer from the Gear Locker in the RV', done: () => (inv.has('chainsaw') || inv.has('axe')) && inv.has('sledge'), at: () => player.rv.root.position },
  { text: 'Drive up the trail and cut the fallen tree (hold the chainsaw, press F)', done: () => obstacles.list[0].state !== 'blocking', at: () => obstacles.list[0].pos },
  { text: 'Smash the rockfall with the sledgehammer', done: () => obstacles.list[1].state !== 'blocking', at: () => obstacles.list[1].pos },
  { text: 'The bridge is out! Collect logs, rope & planks, then design and build a bridge at the workbench', done: () => bridgeWorld.state === 'built', at: () => bridgeWorld.workbenchPos },
  { text: 'Drive the RV across the river', done: () => anyRV(r => r.cp >= 2 && !r.stuck), at: () => ({ x: BRIDGE.bx, z: BRIDGE.bz }) },
  { text: 'Cut the fallen tree on the hill road', done: () => obstacles.list[4].state !== 'blocking', at: () => obstacles.list[4].pos },
  { text: 'Smash the last rockfall', done: () => obstacles.list[5].state !== 'blocking', at: () => obstacles.list[5].pos },
  { text: 'Drive up to the Hilltop Camp', done: () => anyRV(r => r.root.position.distanceTo(world.campPos) < 30) || survival.at('tbuild'), at: () => world.campPos },
  { text: 'Drive north over the pass to Watchtower Valley (clear the road on the way)', done: () => survival.at('tbuild'), at: () => world.towerBenchPos },
  { text: 'Build a tower shelter before the horde: collect logs, planks, rope & stone, then use the Tower workbench', done: () => survival.at('siege'), at: () => world.towerBenchPos },
  { text: 'Survive the zombie siege — fight from your towers, repair them with the hammer', done: () => survival.at('trail2'), at: () => world.towerBenchPos },
  { text: 'Drive on to the Giant Plateau', done: () => survival.at('cbuild'), at: () => world.castleBenchPos },
  { text: 'Build a stone castle wall at the Castle workbench before the giants come (stone: crates, rock piles)', done: () => survival.at('giants'), at: () => world.castleBenchPos },
  { text: 'Defeat the 10 giants with your cannons (G, then click / F)', done: () => survival.at('won'), at: () => giants.list.find(x => x.st !== 4) || world.castleBenchPos },
  { text: 'You won! Press Esc for the scoreboard', done: () => false, at: () => world.castleBenchPos },
];
const STAGE_OBJ = { tbuild: 9, siege: 10, trail2: 11, cbuild: 12, giants: 13, won: 14 };
// Farm World: the same trail to clear, then the north is yours to explore (no siege, no giants)
const nearValley = () => anyRV(r => Math.hypot(r.root.position.x - VALLEY.x, r.root.position.z - VALLEY.z) < 70) || Math.hypot(player.pos.x - VALLEY.x, player.pos.z - VALLEY.z) < 70;
const farmHas = fn => farmEco.ready && fn(farmEco.st);
const FARM_OBJ = [
  { text: 'Walk to the farm east of the trailhead (follow the FARM sign by the road)', done: () => inFarm(whereAmI().x, whereAmI().z) || farmHas(s => s.buildings.length > 0), at: () => FARM_CENTER },
  { text: 'Get 20 wood: chop trees and store the logs at the farm storage — or buy wood at the Farm Store across the road', done: () => farmHas(s => s.inventory.wood >= 20 || s.buildings.length > 0), at: () => STORAGE },
  { text: 'Build a chicken coop: walk up to a plot sign', done: () => farmHas(s => s.buildings.some(b => b.type === 'coop')), at: () => PLOTS[0] },
  { text: 'Buy chickens (and feed) from the farmer at the Farm Store, across the road', done: () => farmHas(s => s.animals.some(a => a.type.startsWith('chicken'))), at: () => STORE },
  { text: 'Feed the chickens every 2 hours: open the pen gate, walk to the trough, press E', done: () => farmHas(s => s.animals.length > 0) && farmEco.fedOnce, at: () => PLOTS[0] },
  { text: 'Fed chickens lay an egg every few minutes — collect them at the nest boxes, then sell them at the Market', done: () => farmEco.sold, at: () => (farmEco.collected ? MARKET : PLOTS[0]) },
  { text: 'Grow the farm: goats need a goat shed, cows a barn, horses a stable', done: () => farmHas(s => s.buildings.length >= 3), at: () => FARM_CENTER },
  ...OBJ.slice(0, 8),
  { text: 'Explore north over the pass to Watchtower Valley (clear the road on the way)', done: nearValley, at: () => world.towerBenchPos },
  { text: 'Go fishing: buy worms at the Fish Market (east of the Market), follow the path to the river docks and land a fish', done: () => farmEco.fished || farmHas(s => !!(s.fishing && s.fishing.mine)), at: () => (farmEco.qty('worms') ? fishArea.spots[1].stand : FISH_MARKET) },
  { text: 'Your world is saved online — any member can open it, together or alone', done: () => false, at: () => world.campPos },
];
const objList = () => (survival.farm ? FARM_OBJ : OBJ);
function updateObjective() {
  const list = objList();
  let changed = false;
  if (!survival.farm && STAGE_OBJ[survival.stage] > objI) { objI = STAGE_OBJ[survival.stage]; changed = true; }
  objI = Math.min(objI, list.length - 1);
  while (objI < list.length - 1 && list[objI].done()) { objI++; changed = true; }
  if (changed) { toast('✔ Objective complete!'); session.dirty = true; saveNow(); }
  const txt = touchText(list[objI].text);
  if (txt !== lastObj) {
    if (lastObj) openObjective(6);              // a new goal: show it in full for a moment (phones)
    lastObj = txt; hud.objective.innerHTML = `${icon('target')}<span>${escapeHTML(txt)}</span>`;
  }
}
let lastObj = '', objT = 0;
function openObjective(sec) { hud.objective.classList.add('open'); clearTimeout(objT); objT = setTimeout(() => hud.objective.classList.remove('open'), sec * 1000); }

/* ---------- map markers ---------- */
const markers = [];
function mapMarkers() {
  markers.length = 0;
  markers.push({ x: START.x, z: START.z, icon: 'flag', label: 'Trailhead' });
  markers.push({ x: bridgeWorld.workbenchPos.x, z: bridgeWorld.workbenchPos.z, icon: 'tools', label: 'Workbench' });
  markers.push({ x: BRIDGE.mx, z: BRIDGE.mz, icon: bridgeWorld.state === 'built' ? 'bridge' : 'warn', label: bridgeWorld.state === 'built' ? 'Bridge' : 'Broken bridge' });
  for (const o of obstacles.list) if (o.state === 'blocking') markers.push({ x: o.pos.x, z: o.pos.z, icon: o.type === 'tree' ? 'tree' : 'rock', label: o.type === 'tree' ? 'Fallen tree' : o.type === 'rock' ? 'Rockfall' : '' });
  for (const c of world.crates) if (!c.taken) markers.push({ x: c.pos.x, z: c.pos.z, icon: 'crate' });
  markers.push({ x: CAMP.x, z: CAMP.z, icon: 'camp', label: 'Hilltop Camp' });
  markers.push({ x: VALLEY.x, z: VALLEY.z, icon: 'tower', label: 'Watchtower Valley' });
  markers.push({ x: GIANT.x, z: GIANT.z, icon: 'castle', label: 'Giant Plateau' });
  for (const gi of giants.list) if (gi.st !== 4) markers.push({ x: gi.x, z: gi.z, icon: 'giant', edge: true });
  rvs.forEach((r, i) => { if (!(player.frame === 'rv' && player.rv === r)) markers.push({ x: r.root.position.x, z: r.root.position.z, icon: 'rv', label: rvs.length > 1 ? `RV ${i + 1}` : 'RV', edge: r === player.rv }); });
  remotes.each((r, p) => markers.push({ x: p.x, z: p.z, dot: r.color, label: (r.s.dn ? 'DOWN · ' : '') + r.s.n, edge: true }));
  for (const z of zombies.list) if (z.st !== 4) markers.push({ x: z.x, z: z.z, dot: '#e0362a' });
  if (farm.active && fishArea.on) {
    markers.push({ x: FISH_MARKET.x, z: FISH_MARKET.z, icon: 'fish_medium', label: 'Fish Market' });
    for (const sp of fishArea.spots) markers.push({ x: sp.stand.x, z: sp.stand.z, icon: 'rod', label: sp.i === 1 ? 'Fishing docks' : '' });
  }
  if (drone.active) markers.push({ x: drone.pos.x, z: drone.pos.z, icon: 'drone' });
  const ol = objList(), t = ol[Math.min(objI, ol.length - 1)].at(); markers.push({ x: t.x, z: t.z, ring: true, edge: true });
  return markers;
}
const me = { x: 0, z: 0, yaw: 0 };
function whereAmI() {
  const rv = player.rv;
  if (drone.active) { me.x = drone.pos.x; me.z = drone.pos.z; me.yaw = drone.yaw; }
  else if (player.frame === 'rv') { me.x = rv.root.position.x; me.z = rv.root.position.z; me.yaw = rv.heading + (player.mode === 'drive' ? 0 : player.yaw); }
  else { me.x = player.pos.x; me.z = player.pos.z; me.yaw = player.yaw; }
  return me;
}

/* ---------- bridge loads (every RV axle + everyone on foot) ---------- */
const loadPool = Array.from({ length: 24 }, () => ({ x: 0, y: 0, z: 0, w: 0 }));
const loads = [], _ax = new THREE.Vector3();
function gatherLoads() {
  loads.length = 0; let k = 0;
  const push = (x, y, z, w) => { if (k < loadPool.length) { const L = loadPool[k++]; L.x = x; L.y = y; L.z = z; L.w = w; loads.push(L); } };
  for (const r of rvs) for (const lz of [AXLE_F, AXLE_R]) { r.axleWorld(lz, _ax); push(_ax.x, _ax.y, _ax.z, AXLE_LOAD); }
  if (player.frame === 'world' && player.mode === 'foot') push(player.pos.x, player.pos.y, player.pos.z, PLAYER_LOAD);
  remotes.each((r, p) => { if (!r.s.f) push(p.x, p.y, p.z, PLAYER_LOAD); });
}

/* ---------- saving ---------- */
function collectSave() {
  const bw = bridgeWorld;
  return { v: 1, t: Date.now(), obj: objI, obst: obstacles.stateArray(), crates: world.crates.map(c => (c.taken ? 1 : 0)), mats: { ...materials.c },
    br: bw.design && bw.state === 'built' ? { d: bw.design, sp: bw.spent } : null, rvs: rvs.map(r => r.cp),
    bag: inv.backpack.map(it => (it ? it.type : null)), st: inv.sets.map(set => set.map(st => ({ id: st.id, s: inv.types(st) }))), sv: survival.state(), bs: structures.save() };
}
function applySave(s) {
  if (!s || s.v !== 1) return false;
  obstacles.applyStateArray(s.obst, false);
  s.crates.forEach((t, i) => { if (world.crates[i]) world.crates[i].taken = !!t; });
  materials.setAll(s.mats);
  if (s.br) { bridgeWorld.build(s.br.d); bridgeWorld.spent = s.br.sp; }
  rvs.forEach((r, i) => { if (s.rvs[i] !== undefined) { r.cp = s.rvs[i]; r.reset(r.cp); } });
  flags.setReached(Math.max(...rvs.map(r => r.cp)));
  inv.setBackpack(s.bag || []);
  (s.st || []).forEach((set, i) => set.forEach(x => inv.applyStorage(i, x.id, x.s)));
  if (s.bs) structures.load(s.bs);
  if (s.sv) { survival.applyState(s.sv); if (s.sv.sc) survival.score = new Map(s.sv.sc.map(r => [r[0] + '#' + r[1], { n: r[0], c: r[1], k: r[2], g: r[3], r: r[4], d: r[5], p: r[6] }])); }
  objI = s.obj || 0;
  player.spawnBesideRV();
  return true;
}
function saveNow() {
  if (farm.active) return farm.saveSoon();            // Farm World saves online (the host sends it)
  if (!net.isGuest && started) return Save.write(collectSave()); return false;
}
// Farm World snapshot: the shared world only (no personal backpack, no zombie campaign)
function collectWorld() {
  const s = collectSave();
  delete s.t; delete s.bag; delete s.sv; delete s.bs;
  return s;
}
function applyWorld(w) { if (w && w.v === 1) applySave({ bag: [], ...w }); survival.setFarm(); }
function manualSave() {
  if (farm.active) { toast(farm.saveSoon() ? '💾 Saving the world online…' : '💾 The player hosting the world saves it online'); return; }
  if (net.isGuest) { toast('In co-op the host saves the shared game'); return; }
  toast(saveNow() ? '💾 Progress saved' : 'Could not save (private browsing?)');
}
function onCheckpoint(r, cp) {
  flags.setReached(Math.max(...rvs.map(x => x.cp)));
  if (net.isGuest) toast(`🚩 Checkpoint ${cp} reached`);
  else { saveNow(); toast(`💾 Checkpoint ${cp} reached — progress saved`); }
}

/* ---------- quality presets (resolution, shadows, view distance, fps cap = heat) ---------- */
const QUALITY = {
  low: { pr: 0.75, shadows: false, size: 512, fps: 30, far: 240, fog: 200 },
  medium: { pr: 1, shadows: true, size: 1024, fps: 60, far: 520, fog: 300 },
  high: { pr: Math.min(devicePixelRatio || 1, 2), shadows: true, size: 2048, fps: 60, far: 520, fog: 300 },
};
let quality = QUALITY.medium;
function applyQuality(name) {
  const q = QUALITY[name] || QUALITY.medium;
  const shadowChanged = q.shadows !== renderer.shadowMap.enabled;
  quality = q;
  renderer.setPixelRatio(q.pr);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = q.shadows;
  camera.far = q.far; camera.updateProjectionMatrix(); scene.fog.far = q.fog; scene.fog.near = q.fog * 0.25;
  world.sun.castShadow = q.shadows;
  world.dayNight.setQuality(QUALITY[name] ? name : 'medium');   // lamps' real lights + torch smoke
  grass.setQuality(QUALITY[name] ? name : 'medium');            // how far and how dense the grass blades grow
  if (world.sun.shadow.mapSize.x !== q.size) {
    world.sun.shadow.mapSize.set(q.size, q.size);
    if (world.sun.shadow.map) { world.sun.shadow.map.dispose(); world.sun.shadow.map = null; }
  }
  if (shadowChanged) scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
  try { localStorage.setItem('rv-quality', name); } catch (e) { /* storage unavailable */ }
}
const qSel = $('quality');
qSel.value = QUALITY[savedQ] ? savedQ : (input.touch ? 'low' : 'medium');
renderer.shadowMap.enabled = true;
applyQuality(qSel.value);
qSel.addEventListener('change', () => { applyQuality(qSel.value); qSel.blur(); });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  requestRender = true;
});

/* ---------- HUD ---------- */
const hud = { objective: $('objective'), room: $('room'), droneHud: $('droneHud'), binoHud: $('binoHud'), dAlt: $('dAlt'), dDist: $('dDist'), dSpd: $('dSpd'), dBat: $('dBat'), dWarn: $('dWarn'),
  prompt: $('prompt'), toast: $('toast'), gunSlot: $('gunSlot'), vitals: $('vitals'), speedo: $('speedBadge'), speed: $('speed'), gear: $('gear'), lights: $('icoLights'), help: $('help'), helpBody: $('helpBody'), fps: $('fps') };
const GUN_SVG = $('gunSlot').querySelector('svg').outerHTML, CANNON_SVG = '<svg class="gunIco" viewBox="0 0 64 22" aria-hidden="true"><path d="M16 4.5 L61 1.5 L61 12.5 L16 13.5 Z M10 6 h8 v8 h-8z" fill="currentColor"/><circle cx="20" cy="16" r="5.2" fill="none" stroke="currentColor" stroke-width="2.6"/></svg>';
let shownWeapon = 'shotgun';
let scoreT = 0, lastScore = '', pingAt = 0, toastT = 0, lastPrompt = '', lastHelp = '', hudT = 0, promptKey = 'E';
function toast(msg) { hud.toast.textContent = touchText(msg); hud.toast.classList.remove('hidden'); toastT = 2.6; }
// phones have no keyboard: turn key hints into tap wording
const TOUCH_TEXT = [
  [/\s+\[Q\] Leave/g, ''], [/W\/S to drive/g, 'the left stick to drive'], [/click \/ F to (shoot|fire)/g, 'tap ◎ to $1'], [/\(G, then click \/ F\)/g, '(gun button, then ◎)'],
  [/ · G to put it away/g, ''], [/G to put it away/g, ''], [/Shotgun: G/g, 'Shotgun: gun button'], [/\(G\)/g, ''], [/\(B to mute\)/g, '(tap the mic button to mute)'],
  [/press B again/g, 'tap the mic button again'], [/\(hold E[^)]*\)/gi, '(tap the prompt)'], [/Hold E — /g, ''], [/hold E next to (them|you)/gi, 'tap the prompt next to $1'],
  [/\(X\)/g, '(tap “Carry”)'], [/ · X to put down/g, ' · tap the prompt to put down'], [/\(E at the ladder\)/g, '(tap the prompt at the ladder)'], [/climb with E/gi, 'climb by tapping the prompt'],
  [/press F next to it/g, 'tap the use button next to it'], [/and press F/g, 'and tap the use button'], [/press F/g, 'tap the use button'], [/Press Esc/g, 'Tap ☰'], [/press Esc/g, 'tap ☰'], [/Esc → /g, '☰ → '], [/\(Esc\)/g, '(☰)'],
  [/click \/ tap \/ → to/g, 'tap to'], [/Press 1-6 to hold an item/g, 'Tap a slot to hold an item'], [/ — F to use/g, ''], [/Press (\d) to hold it, F to use\./g, 'Tap slot $1 to hold it.'],
];
function touchText(t) { if (!input.touch || !t) return t; for (const [a, b] of TOUCH_TEXT) t = t.replace(a, b); return t; }
const HELP = {
  farm: [['WASD', 'move'], ['Shift', 'run'], ['Space', 'jump'], ['F / Click', 'use item / punch'], ['1 - 6', 'hold an item'], ['E', 'interact'], ['N', 'farm notebook'], ['O', 'order slip'], ['M', 'map'], ['V', '1st / 3rd person'], ['R', 'RV back to the Farm Store'], ['B', 'mic on / off'], ['I', 'invite a friend']],
  foot: [['WASD', 'move'], ['Shift', 'run'], ['Space', 'jump'], ['G', 'shotgun / cannon'], ['F / Click', 'shoot / use item / punch'], ['1 - 6', 'hold an item'], ['E', 'interact (hold: revive)'], ['X', 'carry a downed teammate'], ['E', 'climb towers / walls'], ['M', 'map'], ['V', '1st / 3rd person'], ['R', 'RV to last checkpoint'], ['B', 'mic on / off (co-op voice)'], ['I', 'copy invite link (co-op)']],
  drone: [['WASD', 'fly'], ['Space / Shift', 'up / down'], ['Mouse', 'turn + tilt camera'], ['V', 'drone cam / chase'], ['E', 'bring the drone back']],
  zoom: [['Mouse', 'look around'], ['F', 'lower binoculars']],
  inside: [['WASD', 'walk (out the side door to leave)'], ['E', 'use / sit / lie / open storage'], ['1 - 6', 'hold an item'], ['L', 'interior lights'], ['Space', 'jump'], ['V', '1st / 3rd person'], ['Mouse', 'look (roof hides)']],
  seat: [['E', 'stand up'], ['T', 'TV on / off'], ['L', 'interior lights'], ['Mouse', 'look around'], ['V', '1st / 3rd person']],
  lie: [['E', 'get up'], ['L', 'interior lights'], ['Mouse', 'look around']],
  drive: [['W / S', 'gas / brake + reverse'], ['A / D', 'steer'], ['Space', 'handbrake'], ['H', 'horn'], ['L', 'headlights'], ['V', 'chase / cockpit'], ['E', 'get out (when slow)'], ['Q', 'walk to the back'], ['M', 'map'], ['R', 'back to last checkpoint']],
};
function stateName() {
  if (player.dead) return '☠ Eliminated — spectating';
  if (player.downed) return player.carried ? '⬇ Down — being carried' : '⬇ Down!';
  if (player.carrying) return '🤝 Carrying ' + session.nameOf(player.carrying);
  if (drone.active) return 'Flying the drone';
  if (gear.zooming) return 'Binoculars';
  switch (player.mode) {
    case 'drive': return 'Driving';
    case 'seat': return player.seat === 'passengerSeat' ? 'Passenger seat' : 'Sitting';
    case 'lie': return 'Lying down';
    case 'inside': return 'Inside the RV';
    case 'tween': return '...';
    default: return player.pos.y > world.heightAt(player.pos.x, player.pos.z) + 2.2 ? 'On the RV roof' : 'On foot';
  }
}
const COPY_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M5 15V6a2 2 0 0 1 2-2h9" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>';
function renderRoster() {
  voice.sync();
  renderVoice();
  if (farm.active) { renderFarmRoster(); return; }
  if (!net.online) {
    hud.room.classList.add('hidden');
    // a guest who couldn't get back in after a connection drop can try again from here
    $('pauseRoom').innerHTML = session.lastCode && session.joined ? `<div class="plist"><button class="mbig alt rejoinBtn" data-rejoin="1">🔄 Rejoin room ${session.lastCode}</button></div>` : '';
    return;
  }
  hud.room.classList.remove('hidden');
  if (session.rejoining) { hud.room.innerHTML = `📡 Reconnecting to room <b>${session.lastCode}</b>…`; $('pauseRoom').innerHTML = '<div class="plist"><div class="phead">📡 Reconnecting to the room…</div></div>'; return; }
  const names = session.roster().map(p => `<span style="color:${session.colorOf(p.id)}">${p.id === net.id ? 'You' : escapeHTML(p.n)}</span>`).join(', ');
  hud.room.innerHTML = `👥 Room <b>${net.code}</b> <span class="dim">(${Math.max(1, session.players.size)}/${MAX_PLAYERS})</span> · ${names || 'connecting…'} <span id="ping" class="dim"></span> <button class="copyBtn mini" data-copy="link" title="Copy invite link">${COPY_ICON}<span>Invite</span></button>`;
  const plist = session.roster().map(p => `<div class="prow"><i style="background:${session.colorOf(p.id)}"></i><span>${p.id === net.id ? 'You' : escapeHTML(p.n)}${p.c === 0 ? ' <em>host</em>' : ''}<em class="pping" data-ping="${p.id}"></em></span>${net.isHost && p.id !== net.id ? `<button class="rcBtn" data-rc="${p.id}" title="Ask ${escapeHTML(p.n)} to reconnect">↻ Reconnect</button><button class="kickBtn" data-kick="${p.id}">Kick</button>` : ''}</div>`).join('');
  $('pauseRoom').innerHTML = `<div class="plist"><div class="phead">Players ${Math.max(1, session.players.size)}/${MAX_PLAYERS}${session.isFull ? ' · room full' : ''}</div>${plist}
    <button class="micBtn wide" data-mic="1"></button>
    <button class="syncBtn wide" data-sync="1">${net.isHost ? '🔄 Sync everyone — fresh copy, voice restart, weak links reconnect' : '🔄 Reconnect &amp; sync — if a teammate is missing or the voice breaks'}</button></div>
    <div class="invite">
      <div class="irow"><span>Room code</span><code>${net.code}</code><button class="copyBtn" data-copy="code" title="Copy room code">${COPY_ICON}<span>Copy</span></button></div>
      <div class="irow"><span>Invite link</span><input class="ilink" readonly value="${inviteLink()}" /><button class="copyBtn" data-copy="link" title="Copy invite link">${COPY_ICON}<span>Copy</span></button></div>
      <div class="ihint">Send the link (or the code) to friends — up to ${MAX_PLAYERS} players, all in one RV.</div>
    </div>`;
}
// Farm World: room bar + the members panel in the pause menu
const farmPanel = new FarmPanel($('pauseRoom'), { farm, session, net, eco: farmEco, toast: m => toast(m), copy: t => copyText(t),
  syncLabel: () => (net.isHost ? '🔄 Sync everyone — fresh copy, voice restart, weak links reconnect' : net.online ? '🔄 Reconnect & sync — if a teammate is missing or the voice breaks' : '🔄 Rejoin the world'),
  after: () => renderVoice() });
function renderFarmRoster() {
  const L = farm.L;
  hud.room.classList.remove('hidden');
  if (session.rejoining || !net.online) hud.room.innerHTML = `📡 ${session.rejoining ? 'Reconnecting to' : 'Not connected to'} <b>${escapeHTML(L.roomName)}</b>…`;
  else {
    const names = session.roster().map(p => `<span style="color:${session.colorOf(p.id)}">${p.id === net.id ? 'You' : escapeHTML(p.n)}</span>`).join(', ');
    hud.room.innerHTML = `🌾 <b>${escapeHTML(L.roomName)}</b> <span class="dim">${L.code} · ${Math.max(1, session.players.size)}/4 online</span> · ${names} <span id="ping" class="dim"></span>${L.isOwner ? ` <button class="copyBtn mini" data-copy="farminvite" title="Invite a friend (one-time link)">${COPY_ICON}<span>Invite</span></button>` : ''}`;
  }
  farmPanel.render();                  // (also fills the mic button inside the panel)
  clearTimeout(farmInfoT);             // players came or went: refresh the member list in a moment
  farmInfoT = setTimeout(() => farm.refreshInfo(true).then(() => farmPanel.render(), () => {}), 2000);
}
let farmInfoT = 0;
function farmHud() {
  const L = farm.L, dn = world.dayNight;
  const name = `<span class="cy-n">${icon('sprout')}<span>${escapeHTML(L ? L.roomName : 'Farm World')}</span></span>`;
  if (!L) return name;
  const on = net.online && !session.rejoining ? Math.max(1, session.players.size) : 1, mem = farm.info ? farm.info.members.length : 0;
  return `${name}<i class="cy-sep"></i><span class="cy-t">${icon(dn.phaseIcon())}${dn.clockText()}</span><i class="cy-sep"></i>`
    + `<span class="cy-o" title="${on} playing now${mem ? ` · ${mem} of 4 members` : ''}">${icon('users')}${on}<small>/4</small></span>`;
}
async function farmInvite() {
  if (!farm.isOwner) { toast('Only the owner of this world can invite new members'); return; }
  try { const r = await farm.createInvite(); await copyText(r.message); toast(`📋 Invite copied — world code ${r.code}, invite code ${r.pretty} (works once, 72 h)`); }
  catch (e) { toast('⚠ ' + (e.message || e)); }
}
// mic button (top bar + pause menu) — B toggles it too
function renderVoice() {
  const on = voice.micOn, txt = on ? (voice.meTalking ? 'Talking…' : 'Mic on') : 'Mic off';
  const btn = $('micBtn');
  btn.classList.toggle('hidden', !net.online || session.rejoining);
  btn.classList.toggle('on', on); btn.classList.toggle('talk', on && voice.meTalking);
  const mh = `${icon(on ? 'mic' : 'micOff')}<span class="lbl">${txt}</span><span class="k">B</span>`;
  if (btn.dataset.h !== mh) { btn.dataset.h = mh; btn.innerHTML = mh; }
  // 🔄 next to the mic: guests reconnect, the host syncs everyone
  const sb = $('syncBtn');
  sb.classList.toggle('hidden', !net.online || session.rejoining);
  const lbl = net.isHost ? 'Sync' : 'Reconnect';
  if (sb.dataset.lbl !== lbl) {
    sb.dataset.lbl = lbl;
    sb.innerHTML = `${icon('refresh')}<span class="lbl">${lbl}</span>`;
    sb.title = net.isHost ? 'Sync everyone: fresh copy of the game for all players, restart voice, reconnect players with a weak link'
      : 'Reconnect & sync: press it if a teammate is missing or frozen, or the voice breaks';
  }
  for (const b of document.querySelectorAll('#pauseRoom .micBtn')) { b.classList.toggle('on', on); const h = on ? `${icon('mic')} Mic is ON — click to mute (B)` : `${icon('micOff')} Mic is off — click to talk to your team (B)`; if (b.dataset.h !== h) { b.dataset.h = h; b.innerHTML = h; } }
}
const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inviteLink = () => `${location.origin}${location.pathname}?room=${net.code}`;
// Clipboard API needs https + a click; fall back to the old execCommand trick if it's blocked
function copyText(text) {
  const legacy = () => new Promise((res, rej) => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove(); ok ? res() : rej(new Error('copy blocked'));
  });
  return navigator.clipboard && window.isSecureContext ? navigator.clipboard.writeText(text).catch(legacy) : legacy();
}
function onCopyClick(e) {
  const btn = e.target.closest('.copyBtn');
  if (!btn) return;
  e.preventDefault(); e.stopPropagation();
  if (btn.dataset.copy === 'farminvite') { farmInvite(); return; }
  const what = btn.dataset.copy, text = what === 'code' ? net.code : inviteLink(), label = btn.querySelector('span'), old = label.textContent;
  copyText(text).then(() => {
    btn.classList.add('ok'); label.textContent = 'Copied!';
    toast(what === 'code' ? `📋 Room code ${net.code} copied` : '📋 Invite link copied — send it to a friend');
  }, () => {
    label.textContent = 'Select it';
    const inp = $('pauseRoom').querySelector('.ilink'); if (inp) { inp.focus(); inp.select(); }
  });
  setTimeout(() => { btn.classList.remove('ok'); label.textContent = old; }, 1800);
}
hud.room.addEventListener('click', onCopyClick);
$('micBtn').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); voice.toggle(); });
// 🔄 Reconnect (guest) / Sync (host)
let syncAt = -1e9;
function syncNow() {
  const now = performance.now();
  if (now - syncAt < 3000) { toast('🔄 Syncing… give it a few seconds'); return; }
  syncAt = now;
  session.reconnect();
}
$('syncBtn').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); syncNow(); });
// is the connection in trouble? (lights up the 🔄 button)
function linkWeak() {
  if (!net.online || session.rejoining) return false;
  if (net.isGuest && (net.hostWeak || session.rtt > 800)) return true;
  if (net.isHost) for (const id of session.players.keys()) if (id !== net.id && net.weak(net.connOf(id))) return true;
  for (const r of remotes.map.values()) if (r.away && !r.s.dd) return true;   // a teammate stopped moving on our screen
  return false;
}
let weakFor = 0, weakHintAt = -1e9;
$('pauseRoom').addEventListener('click', e => {
  if (e.target.classList.contains('ilink')) e.target.select();
  if (e.target.closest('.micBtn')) { e.preventDefault(); voice.toggle(); return; }
  if (e.target.closest('.rejoinBtn')) { e.preventDefault(); session.rejoin(); return; }
  if (e.target.closest('.syncBtn')) { e.preventDefault(); syncNow(); return; }
  const rc = e.target.closest('.rcBtn');
  if (rc) { e.preventDefault(); e.stopPropagation(); session.reconnectPlayer(rc.dataset.rc); return; }
  const k = e.target.closest('.kickBtn');
  if (k) {   // two taps: "Kick" -> "Sure?" -> kicked
    e.preventDefault(); e.stopPropagation();
    if (k.dataset.sure) session.kick(k.dataset.kick);
    else { k.dataset.sure = '1'; k.textContent = 'Sure?'; k.classList.add('sure'); setTimeout(() => { if (k.isConnected) { delete k.dataset.sure; k.textContent = 'Kick'; k.classList.remove('sure'); } }, 2500); }
    return;
  }
  onCopyClick(e);
});
hud.prompt.addEventListener('click', e => { if (!input.touch) return; input.tap(e.target.closest('.alt') ? 'KeyX' : 'Key' + promptKey); });
$('minimap').addEventListener('click', () => minimap.toggleBig());
$('gunSlot').addEventListener('click', e => { e.stopPropagation(); if (!farm.active) combat.toggle(); });
// phones: the goal line shows one line; tap it to read all of it
hud.objective.addEventListener('click', e => { e.stopPropagation(); if (hud.objective.classList.contains('open')) { hud.objective.classList.remove('open'); clearTimeout(objT); } else openObjective(8); });
$('bigmap').addEventListener('click', () => minimap.toggleBig(false));

function updateHUD(dt) {
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) hud.toast.classList.add('hidden'); }
  if (player.toast) { toast(player.toast); player.toast = null; }
  const pr = inv.isOpen ? null : player.prompt;
  const p = pr ? pr.key + '|' + pr.text + (pr.alt ? '|' + pr.alt.text : '') : '';
  if (p !== lastPrompt) {
    lastPrompt = p;
    if (p) {
      promptKey = /^[A-Z]$/.test(pr.key) ? pr.key : 'E';
      const tk = k => (input.touch && /^[A-Z]$/.test(k) ? 'TAP' : k);
      hud.prompt.innerHTML = `<span class="key">${tk(pr.key)}</span>${touchText(pr.text).replace(/\s+\[Q\] Go to the back/, input.touch ? '' : ' [Q] Go to the back')}` + (pr.alt ? `<span class="alt"><span class="key">${tk(pr.alt.key)}</span>${touchText(pr.alt.text)}</span>` : '');
      hud.prompt.classList.remove('hidden');
    } else hud.prompt.classList.add('hidden');
  }
  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.12; // DOM writes ~8x per second only
  hud.gunSlot.classList.toggle('sel', combat.out);
  hud.vitals.classList.toggle('hidden', farm.active && player.hp >= 100 && !player.downed && !player.dead);
  if (combat.weapon !== shownWeapon) {   // shotgun <-> cannon (giant stage)
    shownWeapon = combat.weapon;
    hud.gunSlot.innerHTML = `<span class="n">G</span>${shownWeapon === 'cannon' ? CANNON_SVG : GUN_SVG}`;
    hud.gunSlot.title = shownWeapon === 'cannon' ? 'Cannon (G)' : 'Shotgun (G)';
    touch.weapon = shownWeapon; touch.mode = '';
  }
  // scoreboard in the pause menu
  if (started && !overlay.classList.contains('hidden') && (scoreT -= 0.12) <= 0) {
    scoreT = 1;
    const rows = farm.active ? [] : survival.scoreRows();      // no zombie scoreboard in Farm World
    const html = rows.length ? `<div class="phead">🏆 Scoreboard</div><table class="stable"><thead><tr><th>#</th><th>Player</th><th title="Zombies">Zombies</th><th title="Giants">Giants</th><th title="Revives">Revives</th><th title="Deaths">Deaths</th><th>Points</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td><td><i style="background:${PLAYER_COLORS[r[1] % PLAYER_COLORS.length].css}"></i>${escapeHTML(r[0])}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td><td>${r[5]}</td><td><b>${r[6]}</b></td></tr>`).join('')}</tbody></table>` : '';
    if (html !== lastScore) { lastScore = html; $('pauseScore').innerHTML = html; }
  }
  // connection quality
  if (net.online && performance.now() - pingAt >= 1000) {   // real time: on a slow phone the game clock runs slow
    pingAt = performance.now();
    const pe = $('ping');
    if (pe) {
      pe.textContent = net.isGuest ? (session.rtt ? `📶 ${Math.round(session.rtt)} ms` : '') : '';
      pe.className = net.isGuest && session.rtt > 400 ? 'pbad' : net.isGuest && session.rtt > 180 ? 'pmid' : 'dim';
    }
    // weak connection: the 🔄 button pulses, and after a few seconds a hint says what to do (at most once a minute)
    const weak = linkWeak(), now = pingAt;
    $('syncBtn').classList.toggle('warn', weak);
    weakFor = weak ? weakFor + 1 : 0;
    if (weakFor >= 4 && now - weakHintAt > 60000) {
      weakHintAt = now;
      toast(net.isHost ? '📡 A teammate has a weak connection — press 🔄 Sync (top) if someone is missing or the voice breaks'
        : '📡 Weak connection — press 🔄 Reconnect (top) if a teammate is missing or the voice breaks');
    }
    for (const el of document.querySelectorAll('#pauseRoom [data-ping]')) {
      const r = remotes.map.get(el.dataset.ping), ms = el.dataset.ping === net.id ? Math.round(session.rtt) : r ? r.s.pg : 0;
      el.textContent = ms ? ` · ${ms} ms` : '';
    }
  }
  updateObjective();
  hud.droneHud.classList.toggle('hidden', !(drone.active && rig.droneView === 'cam'));
  hud.binoHud.classList.toggle('hidden', !gear.zooming);
  if (drone.active) {
    hud.dAlt.textContent = `ALT ${drone.pos.y.toFixed(0)} m`;
    hud.dDist.textContent = `DIST ${Math.hypot(drone.pos.x - pw.x, drone.pos.z - pw.z).toFixed(0)} m`;
    hud.dSpd.textContent = `${Math.round(drone.speed * 3.6)} km/h`;
    hud.dBat.textContent = `BATT ${Math.round(drone.battery * 100)}%`;
    hud.dWarn.textContent = drone.warn;
  }
  const key = drone.active ? 'drone' : gear.zooming ? 'zoom' : player.mode === 'tween' ? lastHelp : (player.mode === 'foot' ? (farm.active ? 'farm' : 'foot') : player.mode);
  if (key && key !== lastHelp && HELP[key]) { lastHelp = key; hud.helpBody.innerHTML = HELP[key].map(([k, v]) => `<div><b>${k}</b>${v}</div>`).join(''); }
  const driving = player.mode === 'drive', rv = player.rv;
  hud.speedo.classList.toggle('hidden', !driving);
  if (driving) {
    hud.speed.textContent = Math.round(Math.abs(rv.speed) * 3.6);
    hud.gear.textContent = rv.speed < -0.3 ? 'R' : rv.speed > 0.3 ? 'D' : (input.isDown('Space') ? 'P' : 'N');
    hud.lights.classList.toggle('on', rv.headlights);
  }
}

/* ---------- start menu / pause ---------- */
const overlay = $('overlay');
let paused = true, started = false, requestRender = true, useSave = Save.has();
const M = { name: $('mName'), saveRow: $('mSaveRow'), cont: $('mContinue'), fresh: $('mNew'), solo: $('mSolo'), host: $('mHost'), code: $('mCode'), join: $('mJoin'), status: $('mStatus') };
try { M.name.value = localStorage.getItem('rv-name') || ''; } catch (e) { /* ignore */ }
if (!M.name.value) M.name.value = 'Camper' + Math.floor(10 + Math.random() * 90);
M.saveRow.classList.toggle('hidden', !useSave);
const setUseSave = v => { useSave = v; M.cont.classList.toggle('on', v); M.fresh.classList.toggle('on', !v); };
setUseSave(useSave);
M.cont.onclick = () => setUseSave(true); M.fresh.onclick = () => setUseSave(false);
const roomParam = new URLSearchParams(location.search).get('room');
let flash = '';
try { flash = sessionStorage.getItem('rv-flash') || ''; sessionStorage.removeItem('rv-flash'); } catch (e) { /* ignore */ }
// Farm World screens (tabs: Zombie Trail / Farm World)
const farmMenu = new FarmMenu({ enter: enterFarm, defaultName: () => { try { return localStorage.getItem('rv-name') || ''; } catch (e) { return ''; } } });
if (flash) { if (farmMenu.mode === 'farm') farmMenu.status('⚠ ' + flash, true); else M.status.textContent = '⚠ ' + flash; }
// Farm World: the RV parks on the store's side of the road, right in front of the Farm Store, its side door
// facing the store, and you stand outside it (looking at the store). Extra RVs park behind it.
function parkAtStore() {
  const heading = Math.atan2(ROAD_U.x, ROAD_U.z);           // along the road: the side door faces the store
  rvs.forEach((r, i) => {
    const u = 1.5 - i * 10, v = -17;                         // the store-side lane (the store's steps reach ~9 m from the road's middle)
    r.parkAt(STORE.x + ROAD_U.x * u + ROAD_V.x * v, STORE.z + ROAD_U.z * u + ROAD_V.z * v, heading);
  });
}
function standAtStore() {
  player.rv = rvs[0];
  player.spawnBesideRV();
  player.yaw = rvs[0].heading - Math.PI / 2;                 // facing the store
  rig.yaw = player.yaw + Math.PI + 0.9;                     // the camera off to one side: the van, you and the store in view
}
async function enterFarm(L, status, isNew) {
  const r = await farm.enter(L, status);
  if (r.role === 'host') { parkAtStore(); standAtStore(); }  // (guests stand beside the host's RV, already parked here)
  gear.netId = String(L.memberId || 'f').slice(0, 8) + Date.now().toString(36);   // ids of gear you set down
  document.body.classList.add('farm');  // (CSS: no gun button, the floating bag + order slip)
  $('musicBtn').classList.remove('hidden');
  farmland.enable();                   // clear the ground, put up the market, the store and the plots
  fishArea.enable();                   // the Fish Market, the path and the docks on the river
  farmEco.start(L);
  startGame(r.role === 'host'
    ? (isNew || r.fresh ? `🌾 Welcome to ${L.roomName}! World code ${L.code} — invite friends from the menu (Esc)` : `🌾 Welcome back to ${L.roomName}`)
    : `🌾 You joined ${r.hostName || 'your friend'} in ${L.roomName}`);
  renderRoster();
  farm.refreshInfo(true).then(() => renderRoster(), () => {});
}
if (roomParam) { M.code.value = cleanRoomCode(roomParam); M.status.textContent = 'You were invited! Pick a name and press Join.'; M.join.classList.add('pulse'); }
const playerName = () => { const n = (M.name.value || 'Camper').trim().slice(0, 16) || 'Camper'; try { localStorage.setItem('rv-name', n); } catch (e) { /* ignore */ } return n; };
const busy = b => [M.solo, M.host, M.join].forEach(x => { x.disabled = b; });
function loadOrReset() { if (useSave) applySave(Save.load()); else { Save.clear(); survival.reset(); } }
function startGame(msg) {
  audio.init();
  app.enterGame(input.touch);     // phones: full screen + landscape, keep the screen on
  overlay.classList.add('hidden'); $('menuStart').classList.add('hidden'); farmMenu.hide(); $('menuPause').classList.remove('hidden');
  paused = false; started = true; input.muted = false;
  input.requestLock();
  lastT = performance.now();
  if (msg) toast(msg);
}
// typed a code but pressed Solo/Host? warn once — that's the usual "my friend isn't in my game" mistake
let codeWarned = false;
function codeTyped() {
  if (cleanRoomCode(M.code.value).length < 4 || codeWarned) return false;
  codeWarned = true; M.join.classList.add('pulse');
  M.status.textContent = '⚠ You typed a room code — press "Join a friend" to play together. (Press again to ignore the code.)';
  return true;
}
M.code.addEventListener('input', () => {
  const v = M.code.value;
  if (/room=/i.test(v)) M.code.value = cleanRoomCode(v);           // a whole invite link was pasted
  else if (v !== v.toUpperCase().replace(/\s/g, '')) M.code.value = v.toUpperCase().replace(/\s/g, '');
  M.join.classList.toggle('pulse', cleanRoomCode(M.code.value).length >= 4); codeWarned = false;
});
M.code.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); M.join.click(); } });
M.name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); (cleanRoomCode(M.code.value).length >= 4 ? M.join : M.solo).click(); } });
M.solo.onclick = () => { if (codeTyped()) return; session.myName = playerName(); loadOrReset(); startGame('Walk up to the side door to go inside'); };
M.host.onclick = async () => {
  if (codeTyped()) return;
  busy(true); M.status.textContent = 'Creating a room…';
  try {
    loadOrReset();
    const code = await session.host(playerName());
    gear.netId = net.id;
    startGame(`Room ${code} created — press "Copy invite link" (top) and send it to friends`);
    renderRoster();
  } catch (e) { M.status.textContent = '⚠ ' + (e.message || e); busy(false); }
};
M.join.onclick = async () => {
  const code = cleanRoomCode(M.code.value);
  if (code.length < 4) { M.status.textContent = 'Type the room code your friend sent you.'; return; }
  busy(true); M.status.textContent = 'Connecting to room ' + code + '…';
  try { await session.join(code, playerName()); gear.netId = net.id; startGame('Connected! Waiting for the host…'); }
  catch (e) { M.status.textContent = '⚠ ' + (e.message || e); busy(false); }
};
function resume() {
  overlay.classList.add('hidden'); paused = false; input.muted = false;
  input.requestLock(); lastT = performance.now();
}
function openMenu() {
  if (!started) return;
  if (!net.online) paused = true;      // solo: the game stops so the GPU idles; co-op keeps running
  input.muted = true; input.vdown.clear(); input.stick.active = false;
  overlay.classList.remove('hidden');
  scoreT = 0; requestRender = true;
  if (farm.active) farm.refreshInfo(true).then(() => farmPanel.render(), () => {});
}
$('play').addEventListener('click', resume);
// tap outside the menu card = back to the game
overlay.addEventListener('click', e => { if (e.target === overlay && started) resume(); });
// phones have no Esc key: the ☰ button opens the same menu
$('menuBtn').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openMenu(); });
document.addEventListener('pointerlockchange', () => {
  // Esc frees the mouse -> pause menu
  if (!document.pointerLockElement && started && !input.dragging && !inv.isOpen && !farmUI.isOpen && !notebook.isOpen && !editor.open && !designer.open && !fishing.cardOpen) openMenu();
});
// installable app: back button (Android) closes the open popup or shows the menu
app.init({
  toast: m => toast(m),
  onBack: () => {
    if (farmUI.isOpen) farmUI.close();
    else if (notebook.isOpen) notebook.close();
    else if (inv.isOpen) inv.closeStorage();
    else if (designer.open) designer.close();
    else if (editor.open) editor.close();
    else if (minimap.bigOpen) minimap.toggleBig(false);
    else if (!overlay.classList.contains('hidden')) resume();
    else openMenu();
  },
});
survival.g.haptic = ms => app.haptic(ms);
// menu settings: sound + graphics (on phones the graphics setting lives here instead of the top-right corner)
const sndBtn = $('sndBtn');
const sndLabel = () => { sndBtn.innerHTML = `${icon(audio.muted ? 'speakerOff' : 'speaker')} ${audio.muted ? 'Sound off' : 'Sound on'}`; };
sndLabel();
sndBtn.addEventListener('click', e => { e.stopPropagation(); audio.toggleMute(); sndLabel(); });
// Farm World's music on / off (remembered on this device)
const musicBtn = $('musicBtn');
const musicLabel = () => { musicBtn.innerHTML = `${icon('music')} ${music.on ? 'Music on' : 'Music off'}`; musicBtn.classList.toggle('off', !music.on); };
musicLabel();
musicBtn.addEventListener('click', e => { e.stopPropagation(); music.toggle(); musicLabel(); });
if (input.touch) { const l = document.createElement('label'); l.className = 'qlab'; l.textContent = 'Graphics '; l.appendChild(qSel); $('qualSlot').appendChild(l); }
canvas.addEventListener('click', () => { if (started && !paused && !input.locked) input.requestLock(); });

/* ---------- global keys ---------- */
function globalKeys() {
  if (input.wasPressed('KeyV')) toast(rig.toggle(player));
  if (input.wasPressed('KeyG') && !fishing.active && !farm.active) combat.toggle();
  if (farm.active && !fishing.active) {
    if (input.wasPressed('KeyN')) notebook.toggle('book');
    if (input.wasPressed('KeyO')) notebook.toggle('slip');
  }
  if (input.wasPressed('KeyB')) voice.toggle();
  if (input.wasPressed('KeyK')) { toast(audio.toggleMute() ? 'Sound off' : 'Sound on'); sndLabel(); }
  if (input.wasPressed('KeyM')) minimap.toggleBig();
  if (input.wasPressed('Escape') && minimap.bigOpen) minimap.toggleBig(false);
  if (input.wasPressed('KeyR')) {
    const r = player.rv;
    if (farm.active && (player.mode === 'drive' || r.isLocal(net))) { parkAtStore(); toast('RV parked in front of the Farm Store'); }
    else if (player.mode === 'drive' || r.isLocal(net)) { r.reset(); toast(`RV ${rvs.length > 1 ? r.index + 1 + ' ' : ''}moved to the last checkpoint`); }
    else toast('Only the driver can reset this RV');
  }
  if (input.wasPressed('Tab')) hud.help.classList.toggle('hidden');
  if (input.wasPressed('KeyI') && farm.active) farmInvite();
  else if (input.wasPressed('KeyI') && net.online) copyText(inviteLink()).then(() => toast('📋 Invite link copied — send it to a friend'), () => toast('Press Esc to see the invite link'));
  if (!drone.active && !fishing.active && (player.mode === 'foot' || player.mode === 'inside')) for (let i = 1; i <= 6; i++) if (input.wasPressed('Digit' + i)) inv.equip(i - 1);
}

/* ---------- main loop ---------- */
let lastT = performance.now(), lastRender = 0, fpsFrames = 0, fpsT = 0, saveT = 0;
const focus = new THREE.Vector3(), pw = new THREE.Vector3();
let freezeCam = null, plotInfoT = 0;

function step(dt) {
  globalKeys();
  const ctrl = player.update(dt, input, rig);
  gear.update(dt, input);
  combat.update(dt, input);
  fishing.update(dt, input);
  for (const r of rvs) {
    if (r.isLocal(net)) r.update(dt, r === player.rv && player.mode === 'drive' && survival.canDrive(r) ? ctrl : null);
    else r.netUpdate(dt);
    r.setAudible(r === player.rv && player.frame === 'rv');
  }
  obstacles.update(dt);
  gatherLoads();
  bridgeWorld.update(dt, loads);
  if (freezeCam) {
    camera.position.set(freezeCam[0], freezeCam[1], freezeCam[2]); camera.lookAt(freezeCam[3], freezeCam[4], freezeCam[5]);
    player.rv.setCutaway(camera.position, !!freezeCam[6], false);
  } else rig.update(dt, input, player, player.rv);
  for (const r of rvs) if (r !== player.rv) r.setCutaway(camera.position, false, false);
  remotes.localId = net.online ? net.id : 'local';
  remotes.tick(dt);
  survival.update(dt, input);
  if (farm.active) {
    farmland.update(dt, farmEco.serverNow(), player.mode === 'foot' ? player.pos : null);
    fishArea.update(dt, player.mode === 'foot' ? player.pos : null);
    if ((plotInfoT -= dt) <= 0) { plotInfoT = 0.25; farmUI.renderInfo(player.mode === 'foot' ? farmland.plotAt(player.pos) : null); }
  } else if (plotInfoT !== 1) { plotInfoT = 1; farmUI.renderInfo(null); }
  structures.update(dt, camera.position);
  tracers.update(dt);
  player.char.root.getWorldPosition(pw);
  focus.copy(drone.active ? drone.pos : player.mode === 'drive' ? player.rv.root.position : pw);
  world.dayNight.setMode(survival.farm ? 'real' : 'game');     // Farm World: real time · Zombie Trail: zombie nights
  world.update(dt, focus, camera);
  flags.update(dt);
  minimap.update(dt, whereAmI(), mapMarkers());
  sounds(dt);
  session.tick();
  if (started && (saveT += dt) > 45) { saveT = 0; saveNow(); }
  const tmode = drone.active ? 'drone' : fishing.active ? 'fish' : player.mode === 'drive' ? 'drive' : (player.mode === 'seat' || player.mode === 'lie') ? 'seat' : 'foot';
  touch.farm = farm.active;
  touch.setMode(tmode, combat.out ? 'gun' : !!inv.equippedItem());
  input.stickRun = tmode === 'foot';
  updateHUD(dt);
  input.endFrame();
}

// birds and the jungle's sounds follow the player (and the camera, for left / right)
function sounds(dt) {
  const dn = world.dayNight, dark = dn.dark ?? world.night;
  birds.update(dt, focus, dark);
  music.update(farm.active && started, dark);
  grass.setDark(dark);
  grass.update(dt, focus);
  if (player.frame === 'world' && player.mode === 'foot') grass.press(pw.x, pw.z); else grass.press(null);
  camera.getWorldDirection(_fwd);
  listener.x = camera.position.x; listener.z = camera.position.z; listener.fx = _fwd.x; listener.fz = _fwd.z;
  let walk = null;
  const m = player.mode;
  if ((m === 'foot' || m === 'inside') && player.grounded && !fishing.active && !player.downed && !player.dead) {
    const x = player.pos.x, z = player.pos.z;
    const surface = m === 'inside' || player.pos.y > world.heightAt(x, z) + 0.3 ? 'wood' : world.T.roadDistAt(x, z) < 3.6 ? 'gravel' : 'grass';
    walk = { speed: player.vel.length(), surface };
  }
  ambience.update(dt, { dark, phase: dn.phase, water: Math.max(0, world.T.riverDistAt(pw.x, pw.z) - RIVER_HALF), fishing: fishing.active,
    muffled: player.frame === 'rv', walk, listener, birds: birds.perched() });
}

function frame(now) {
  requestAnimationFrame(frame);
  if (paused || editor.open || designer.open) {   // nothing to animate behind the designers / pause menu: save the GPU
    if (requestRender) { renderer.render(scene, camera); requestRender = false; }
    if ((editor.open || designer.open) && net.online) { const bdt = Math.min(0.05, (now - lastT) / 1000); session.tick(); survival.background(bdt); }
    lastT = now; input.endFrame();
    return;
  }
  const idle = now - input.lastInput > 25000 && player.mode !== 'drive' && !net.online;
  const cap = idle ? 15 : quality.fps;
  if (now - lastRender < 1000 / cap - 2) return;
  lastRender = now;
  let dt = (now - lastT) / 1000;
  if (!(dt > 0)) dt = 1 / 60;          // rAF timestamps can repeat or go backwards
  dt = Math.min(dt, 0.05);
  lastT = now;
  step(dt);
  renderer.render(scene, camera);
  fpsFrames++; fpsT += dt;
  if (fpsT >= 0.5) { hud.fps.textContent = Math.round(fpsFrames / fpsT) + ' fps'; fpsFrames = 0; fpsT = 0; }
}
addEventListener('beforeunload', () => saveNow());

// first frame behind the overlay so the scene is visible
step(0.016);
renderer.render(scene, camera);
requestAnimationFrame(frame);
// test hook: jump to a campaign stage (tbuild | siege | cbuild | giants), optionally building towers / castle
function debugStage(st, build) {
  const rv = rvs[0], cp = { tbuild: 4, siege: 4, cbuild: 5, giants: 5 }[st];
  rv.cp = cp; rv.reset(cp); flags.setReached(cp); player.spawnBesideRV(); obstacles.list.forEach(o => obstacles.clearInstant(o));
  materials.addAll({ logs: 30, planks: 40, rope: 12, stone: 90 });
  survival.stage = st === 'tbuild' || st === 'siege' ? 'trail' : 'trail2';
  survival._toStage(st === 'siege' ? 'tbuild' : st === 'giants' ? 'cbuild' : st);
  if (build) { designer.show(build); designer._action('build'); designer.close(); }
  if (st === 'siege' || st === 'giants') survival._toStage(st);
}
window.__game = { debugStage, net, session, voice, birds, ambience, notebook, grass, structures, designer, giants, player, rvs, remotes, obstacles, bridgeWorld, materials, world, inv, gear, editor, input, rig, camera, zombies, survival, combat, applySave, collectSave, saveNow, farm, farmEco, farmUI, farmland, fishArea, fishing, dayNight: world.dayNight, get objI() { return objI; },
  // test hooks: advance the game n frames / pin the camera
  run: n => { for (let i = 0; i < n; i++) step(1 / 60); renderer.render(scene, camera); }, setCam: a => { freezeCam = a; } };

/* ---------- debug screenshots: ?shot=inside | drive | bridgegood,align,drive&keys=KeyW | editor ... ---------- */
const qs = new URLSearchParams(location.search);
if (qs.has('shot')) {
  overlay.classList.add('hidden'); paused = false; started = true;
  const s = qs.get('shot'), road = world.T.road, rv = rv0;
  const run = n => { for (let i = 0; i < n; i++) step(1 / 60); };
  const sample = good => {
    const n = [[0, 0], [0, -2], [16, 0], [16, -2], [4, 0], [8, 0], [12, 0], [4, -2.5], [8, -2.5], [12, -2.5]].map(([x, y], i) => ({ x, y, fixed: i < 4 }));
    const rd = [[0, 4], [4, 5], [5, 6], [6, 2]].map(([a, b]) => ({ a, b, type: 'road' }));
    const logs = [[1, 7], [7, 8], [8, 9], [9, 3], [4, 7], [5, 8], [6, 9], [0, 7], [7, 5], [5, 9], [9, 2]].map(([a, b]) => ({ a, b, type: 'log' }));
    return { pier: false, nodes: good ? n : n.slice(0, 7), members: good ? [...rd, ...logs] : rd };
  };
  if (s.includes('bridgegood') || s.includes('bridgeweak')) { bridgeWorld.build(sample(s.includes('bridgegood'))); rv.reset(1); player.spawnBesideRV(); obstacles.list.forEach(o => obstacles.clearInstant(o)); }
  if (s.includes('align')) { rv.heading = Math.atan2(BRIDGE.dx, BRIDGE.dz); rv.rear.set(BRIDGE.ax - BRIDGE.dx * 12, 0, BRIDGE.az - BRIDGE.dz * 12); rv.y = 50; rv._place(1, true); player.spawnBesideRV(); }
  if (s.includes('tworv')) { addRV(); player.spawnBesideRV(); }
  if (qs.get('cp')) { rv.cp = +qs.get('cp'); rv.reset(rv.cp); flags.setReached(rv.cp); player.spawnBesideRV(); obstacles.list.forEach(o => obstacles.clearInstant(o)); }
  if (/inside|sit|sofa|lie|bunk|fridge/.test(s)) { player.placeInside(); run(20); }
  if (s.includes('sit')) { player.sitAt('dinetteA'); run(80); }
  if (s.includes('drive')) { player.enterDriver(true); run(120); }
  if (s.includes('night')) { world.setNight(1, true); rv.headlights = true; rv.interiorLights = true; }
  if (qs.get('stage')) debugStage(qs.get('stage'), qs.get('build'));
  if (s.includes('zombies')) {   // a zombie night around the player (debug screenshots)
    survival._setPhase('night', 300, 1); world.night = 0.999;
    for (let i = 0; i < 8; i++) { const a = i * 0.8 - 1.5, d = 5 + (i % 3) * 3; const z = zombies.spawn(player.pos.x + Math.sin(a) * d, player.pos.z + Math.cos(a) * d, 1.6); z.st = 1; z.t = 2; }
  }
  if (s.includes('gun')) { combat.setOut(true); rig.yaw = player.yaw + Math.PI; rig.pitch = 0.12; }
  if (s.includes('editor')) { materials.addAll({ logs: 20, planks: 20, rope: 10, stone: 10 }); editor.design = sample(!s.includes('weak')); editor.show(); }
  if (s.includes('bigmap')) minimap.toggleBig(true);
  if (qs.get('keys')) qs.get('keys').split(',').forEach(k => input.down.add(k));
  if (qs.get('yaw')) rig.yaw = +qs.get('yaw');
  if (qs.get('pitch')) rig.pitch = +qs.get('pitch');
  if (qs.get('dist')) rig.distTarget = rig.dist = rig.driveDist = +qs.get('dist');
  if (qs.get('cam')) freezeCam = qs.get('cam').split(',').map(Number);
  run(+(qs.get('frames') || 60));
  renderer.render(scene, camera);
  document.title = [player.mode, player.frame, 'rv', rv.root.position.x.toFixed(1), rv.y.toFixed(1), rv.root.position.z.toFixed(1), 'cp', rv.cp, 'stuck', rv.stuck, 'bridge', bridgeWorld.state, 'rvs', rvs.length, 'obj', objI].join(' ');
}
window.__gameReady = true;
