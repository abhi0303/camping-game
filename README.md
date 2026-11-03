# RV Van – Jungle Trail

A low-poly RV adventure in plain HTML/CSS/JS + Three.js. Start at the trailhead, drive through a hilly jungle, clear the road, rebuild the broken bridge over the river, reach the hilltop camp, then cross the pass into the highlands. Play alone or with up to 3 friends (4 players, one RV), on desktop or mobile.

There are two modes. Pick one with the tabs on the start screen:
- **🧟 Zombie Trail:** the campaign. Build towers to survive a zombie siege and a stone castle to face 10 stone-throwing giants, surviving the zombie nights along the way. Saved in this browser.
- **🌾 Farm World:** a peaceful world that never ends and is **saved online**. Up to 4 members share it and any of them can open it, alone or together. See [Farm World](#farm-world).

## Install it as an app

RV Van is a PWA (installable web app). Installed, it opens full screen in landscape, starts faster, and solo play works without internet. Co-op still needs a connection.

- **Android (Chrome):** open the game, then tap **📲 Install the app** on the start screen (or Chrome menu → *Install app* / *Add to Home screen*).
- **iPhone / iPad (Safari):** tap **Share** ⬆︎ → **Add to Home Screen**. The start screen shows this hint too.
- **Desktop (Chrome / Edge):** use the install icon in the address bar, or the **Install the app** button.

On phones the game also:
- goes full screen and locks to landscape when you start (Android; on iPhone, install it to get full screen);
- keeps the screen awake while you play;
- vibrates when you're hurt (Android);
- opens the game menu with the Android **back button** (or closes the open popup) instead of leaving the game.

The ☰ button opens the same menu on any phone.

Updates arrive automatically: the game loads the newest version whenever you're online.

## Play locally

The game uses ES modules, so it has to be served (opening `index.html` directly won't work):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Three.js and PeerJS load from a CDN, so you need an internet connection.

## Deploy to GitHub Pages

Everything is static, so no server or build step is needed.

1. Push this folder to a GitHub repository (branch `main`).
2. In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. The included workflow (`.github/workflows/pages.yml`) publishes the site on every push to `main`. The URL looks like `https://<your-user>.github.io/<repo>/`.

All paths are relative, so the game works from the repo sub-folder. `.nojekyll` stops GitHub from processing the files.

## Co-op multiplayer

- **Host:** on the start screen, enter your name and press **Host co-op**. You get a room code; press **Copy invite link** (top of the screen) and send it to friends.
- **Join:** open the invite link (or type the code) and press **Join a friend**.
- **Room size:** a room holds **4 players**, and all 4 share one RV (driver, passenger, and two more at the dinette, sofa or beds). A 5th player who tries to join sees *"That room is full"*.
- **Leaving:** closing or refreshing the tab removes you from the room right away (no duplicate players when you come back).
- **Connection drops:** if your link to the host drops (Wi-Fi hiccup, phone switched to another app, a frozen tab), the game **reconnects by itself** within a few seconds and puts you back in the same slot, at the same spot, still in your seat. A link that is stuck (its network path down, or nothing getting through) is replaced after about 10 seconds. The room bar shows your ping (📶, yellow or red when it's slow). If it can't get back in after 90 seconds you continue solo, and **Esc → Rejoin room** tries again.
- **🔄 Reconnect / Sync button** (top, next to the mic, and in the Esc menu): press it if a teammate is missing or frozen, or the voice breaks. It pulses orange when the connection looks weak.
  - **Guest (🔄 Reconnect):** your game drops its link and joins the room again in a second or two. You keep your slot, your spot and your seat, and get a fresh copy of the world, every player and new voice links.
  - **Host (🔄 Sync):** everyone gets a fresh copy, all voice links restart, and players with a weak link reconnect. In the Esc menu the host can also press **↻ Reconnect** next to one player.
- **Voice chat:** everyone in the room hears each other. Your mic starts **off**; press **B** (or tap the 🔇 Mic off button at the top) to talk, and again to mute. 🔊 shows who is talking (team list and name tags), 🎙 shows whose mic is on. The browser asks for microphone permission the first time (it works on the https GitHub Pages site).
- **Kick:** the host can remove a player from the pause menu (**Esc → Kick**, then confirm). Kicked players go back to the start screen and can't rejoin that room.
- **Seats:** one player drives and the other can take the **passenger seat**, or sit or lie anywhere inside, and rides along. Seats are exclusive, so nobody can take the driver seat while someone is using it.
- **Shared progress:** road blocks, the bridge (including its physics), materials, supply crates, camping gear, the day/night clock, the zombies and the RV's health are shared. The RV's Gear Locker, fridge and storage bay are shared too.

**How it works:** browsers connect directly to each other with WebRTC. PeerJS's free public service only helps them find each other, which is why this works on GitHub Pages without a game server. The host's game is the authority for shared things (including the zombies), and whoever drives the RV controls it. Every player sends their avatar to the host, and the host sends everyone one snapshot with all players in it, so all screens show the same people. If the host leaves, the others continue solo.

**Limits:** connections go peer-to-peer, with PeerJS's free relay as a fallback. Very strict networks (some offices or schools) can still block WebRTC. The public PeerJS service has no uptime guarantee; for a big audience, run your own PeerJS server.

## Farm World

A permanent world for a group of up to 4 friends. It's saved on the Farm World server (a small Cloudflare Worker + NeonDB, see [`server/`](server/README.md)), so it remembers everything when nobody is playing, and you can continue from any device.

- **Create a world** (Farm World tab → *Create a new world*): your name, a world name and a **PIN** (4–6 digits). You become the world's **owner** and get a 6-character world code.
- **Invite friends:** Esc menu → **➕ Invite a friend** (owner only) makes a one-time invite, valid for 72 hours. **Copy** copies a message with the link *and* two codes: the **world code** and the **invite code**. Your friend can either:
  - open the link in the browser, pick a name and a PIN; or
  - in the installed app (which can't open links): **Farm World → New here? Join with an invite**, type the world code and invite code (or paste the whole message), a name and a PIN.

  Either way they are a member from then on and log in later with world code + name + PIN. A world has at most **4 members**; knowing the world code alone doesn't let anyone in.
- **Play any time:** any member opens the world, from the saved list (*▶ Play*) or with *Open a world you belong to* (code + name + PIN, also on a new device). Any 1–4 members can play together; offline members keep their place.
- **Members vs. online:** the Esc menu shows both, e.g. *Members 4/4 · Online 2/4*, with who is playing now and when the others were last seen.
- **Who hosts:** the first member to open the world hosts the live game; the others join them. If the host leaves or their browser crashes, one of the remaining players takes over automatically and play goes on.
- **Saving:** the host saves the world every ~25 s when something changed, right after important events (objectives, checkpoints, the bridge) and when the page closes. If the server can't be reached, the game keeps going and saves once it's back.
- **Owner tools (Esc menu):** remove a member (frees their place, ends their logins), delete the world (type its name to confirm). Everyone can *Log out on this device*.
- No zombies, nights, siege or giants in Farm World. You clear the same trail, rebuild the bridge and explore — and run a farm.

### The farm

The farm is in a clearing just east of the trailhead (follow the **🌾 FARM** sign by the road). Everything on it belongs to the whole group: one shared money balance (💰, starts at ₹500), one store of goods, the same shelters and animals for every member, online or not.

The main road splits it in two: **the farm** (plots and storage) on one side, **the Farm Store and the Market** on the other.

- **Plots:** 8 plots in two rows along a walkway, each with its own wooden signboard by its gate. Walk up to a plot sign to build a shelter on it:

  | Shelter | Cost | Holds |
  |---|---|---|
  | 🏠 Chicken coop | ₹100 · 20 wood | 6 chickens (any kind) |
  | 🛖 Goat shed | ₹250 · 40 wood | 4 goats |
  | 🏚 Cow barn | ₹500 · 60 wood · 20 stone | 3 cows |
  | 🐎 Horse stable | ₹600 · 60 wood · 20 stone | 4 horses |
- **Pens and gates:** every shelter has a fenced pen with a dirt yard, a feed trough and a water trough. Press **E** at the gate to open or close it — a closed gate blocks the way, everyone sees it move, and it stays as you left it.
- **Feeding:** animals only eat when you feed them. Open the gate, walk to the feed trough and press **E**: **Feed all** or **Feed selected** (the hungriest first). One feeding costs 1 🌾 feed per chicken (2 per goat or horse, 3 per cow) and keeps it fed — and producing — for **2 hours** (you can feed up to a day ahead). With too little feed only some animals get fed. New animals arrive fed for 2 hours.
- **Production panel:** stand at a plot to see its numbers live — total animals, **next egg / milk in**, **feed due in**, feeding duration and what's in storage. When nobody is fed it says **Production Paused – Feed Required**. The timers come from the server's time stamps.
- **Chickens:** every chicken has its own egg timer and its own nest box. Eggs wait in the nest (up to 24 per chicken) until someone **collects** them — at the nest boxes in the pen (**E**) or with **Collect** in the coop's panel. A full nest stops that chicken laying, so an untended farm never piles up endless eggs.

  | Chicken | Price | Lays (while fed) | Egg price | Unlocks |
  |---|---|---|---|---|
  | 🐔 Regular White | ₹40 | 1 egg every **5 min** | ₹1 | from the start |
  | 🐓 Brown Desi | ₹180 | 1 brown egg every **7 min** | ₹3 | after the farm earns ₹300 from sales |
  | 🐦‍⬛ Black | ₹450 | 1 black egg every **9 min** | ₹7 | after the farm earns ₹1500 from sales |

  The timings live in one file, [`server/src/animals.js`](server/src/animals.js). A Regular White pays for itself in about 3½ hours, a Brown Desi in about 7 and a Black in about 10 — but a Black chicken earns the most per place in the coop. The **Chicken Farm panel** (stand at the coop, or open it from its sign) shows the varieties, **Next Egg In** (the shortest timer, ticking every second), the eggs ready to collect, the feeding left and the feed needed, in colours: 🟢 laying · 🟡 an egg is seconds away · 🔵 eggs ready · 🔴 feed required. The coop's panel also lists every chicken with its own timer.

  Each kind has its own look, and its eggs are kept separately. 🐐 Goats (₹150) give goat milk (₹30), 🐄 cows (₹400) cow milk (₹25).
- **Horses:** six colours, each with its own look. Buy a **baby** (Level 1) or a **grown** horse (Level 10):

  | Colour | Baby | Grown | Rent (per 2 h) | Sells for (Level 1 → 10) |
  |---|---|---|---|---|
  | Bay, Chestnut (common) | ₹150 | ₹600 | ₹50 | ₹105 → ₹480 |
  | Black, White (uncommon) | ₹220 | ₹800 | ₹65 | ₹154 → ₹640 |
  | Golden (Palomino), Spotted (Pinto) (rare) | ₹320 | ₹1,100 | ₹85 | ₹224 → ₹880 |

  A fed horse grows **one level every 2 hours** (2 feed per feeding) up to **Level 10** — about 18 hours of feeding; a hungry one stops growing. Babies are small and grow bigger with each level. **Sell** a horse at any level from the stable's panel (older and rarer horses sell for more). **Rent out** Level 10 horses: now and then (about every 1–2 hours) a customer asks at the Market's Orders tab for 1 or 2 horses for 1–4 hours — any colour at the common rate, or a certain colour for that colour's rate + 20 %. A request waits about an hour for a player to **hand the horses over**; the farm is paid at once, the horses leave the pen and come back by themselves when the time is up (looked after by the renter).
- **Health:** an animal left hungry for a day gets weak (it never dies). Fed again it recovers.
- **Farm Store** (across the road): talk to the farmer behind the counter (**E**). His menu: purchase animals, sell farm products, purchase animal feed (₹2), farming supplies (coming with crop fields) and construction materials (🪵 wood ₹6, 🪨 stone ₹8). You can walk inside.
- **Fish Market** (east of the Market, set back from the road; follow the 🐟 sign): talk to the fisherman (**E**) to buy worms, buy or upgrade your fishing rod, sell fish and see the farm's fish collection. See [Fishing](#fishing) below.
- **Customer orders** (the **Orders** tab at the Market, or the farmer's menu; look for the 📜 ORDERS sign): customers ask for a mix of what your farm can make — eggs, milk and the fish your rods catch, sized to your farm — and pay **10 % more** than the normal price. One order at a time: after you deliver one (everything at once, from the farm storage), the next arrives 30–60 minutes later, up to **3 a day**. A day ends at **midnight India time** for everyone in the world. Deliver at least one order a day for **5 days in a row** and get a **₹200 bonus** on the 5th day (again on the 10th, 15th…); miss a day and the streak starts again. Any member can deliver; an order is paid once.
- **Market** (next to the store): the selling hall — sell eggs, milk, wood and stone, see the price board and the farm's trade log (who bought, sold, built or upgraded what).
- **Farm storage** (end of the walkway): store the logs and stones you collect (chopping trees, rockfalls, crates) — logs become 🪵 wood. It also sets how much the farm can hold: level 1 holds 60 of each egg, 30 of each milk, 500 feed / wood / stone. **Upgrade to level 2** (₹600 · 80 wood · 40 stone) for twice as much and a bigger storehouse. Two players pressing Upgrade at once upgrade it only once.
- **While nobody plays:** fed animals keep producing until their feed runs out. When anyone opens the world, the server works out what happened since, using its own clock, for up to a week of absence. Goods stop at the storage limit, so sell before it fills up.
- **Safe for a group:** every purchase, sale, feeding, build, gate and upgrade is checked by the server against the shared money and goods. Two members buying at the same moment can't spend the same money; a double click or a retry after a lost connection never does anything twice.
- The money bar above the hotbar and the Esc menu show the money, the goods, the animals and how many are hungry. Animals walk around their pens the same way on every player's screen.

### Fishing

A stone path with lanterns leads from behind the Fish Market north through the jungle to **three wooden docks** on the river. Fish swim around the docks and jump now and then.

- **Worms:** 10 for ₹1 at the Fish Market. Each cast puts one worm on the hook (an escaped fish keeps it). No worms, no fishing.
- **Fishing:** walk to the end of a dock — **E – Start Fishing**. Your character casts; wait and watch the float. Not every cast gets a bite.
- **The tug of war:** when a fish bites (*“A fish has bitten! Pull now!”*) hold **S** (phones: the **PULL** button). Then the fish takes turns: while it **fights**, let go — pulling raises the line tension and at 100 % the line snaps. When it's **tired**, hold S until the pull is reeled in. Small fish need 2–3 pulls, medium 4–5, large 6–8. The panel shows the tension (safe · tension · danger), the pulls, how hard the fish resists and what to do. Miss a tired spell too often and the line goes slack — *“The fish escaped! Try again.”*
- **A catch** shows the fish, its weight and selling value (*“You caught a Medium Fish! Selling Value: ₹5”*) and goes into the farm storage. **E** casts again; **Q** or walking away leaves the dock.
- **Rods:** each player has their own rod, bought with the farm money and kept with your name. Every rod looks different:

  | Rod | Price | Catches | Also |
  |---|---|---|---|
  | 🎣 Level 1 · Basic Wooden | starter | small, some medium | short time to set the hook, 1 missed pull allowed |
  | 🎣 Level 2 · Steel Grip | ₹150 | small, more medium | steadier line, 2 missed pulls |
  | 🎣 Level 3 · Advanced Fibre | ₹500 | small, medium and **large** | lowest tension, longest hook time, big fish land in fewer pulls |

- **Fish:** 🐟 small ₹2 · 🐠 medium ₹5 · 🎏 large ₹14 (the storage holds 40 / 40 / 20 at level 1). Fishing earns roughly ₹400 an hour with the basic rod and ₹950 with the best one — a quick start, while a full farm of chickens earns more without anyone playing.
- **Together:** players fish at the same time at different docks and see each other's rod, line, float and catches; a dock someone is using is taken. **No cheating:** the server decides what bites, and a catch only counts if the server replays your pull / release presses through the same challenge and the fish lands — never faster than real time. Each cast pays out once.

The shared world is everything the zombie save holds except your personal backpack: road blocks, crates, materials, the bridge, the RV's checkpoint, the RV storages and the objective.

## Survival rules

- **Nights:** the first night falls after **3 minutes**, the next one **6 minutes** after that, then every **10 minutes**. A night lasts **5 minutes** and brings **zombies**. The timer is at the top of the screen.
- **Stronger zombies:** every checkpoint you pass makes them tougher (more health, harder bites, faster). The level (⚔ Lv) shows next to the timer.
- **Weapon:** everyone has a **pump shotgun with unlimited ammo**. Press **G** (or tap the gun slot) to take it out and **click / F** to shoot. In the giant stage it becomes a **cannon**.
- **Health:** your bar is at the bottom; teammates' health is in the team list (with their points) and above their heads. Health comes back in daylight, slowly at night when you're safe, and faster lying in a bed. Food and drinks give +25.
- **Down = last chance:** at 0 health you're down. A teammate can **revive** you (hold **E** next to you, +50 points for them) or **carry** you (**X**) to a safe spot. Zombies keep attacking downed players; if nobody saves you in time, you are **eliminated for good**. No respawns: you can only **spectate** your teammates (click / tap / → to switch) or **leave the game**. When everyone is eliminated it's game over.
- **Safe spots:** inside the RV, on the RV roof (ladder at the back) and on top of a standing tower. Zombies can't reach you there, so they smash the RV or the tower instead.
- **The RV only drives at 100%.** Repair it with the hammer (or sledgehammer) from the Gear Locker: stand next to it and press **F**.
- Driving into zombies kills them (and counts for the driver).

## Watchtower Valley (tower shelter)

North of the hilltop camp the road crosses a pass into the pine highlands. When you reach **Watchtower Valley** you get **10 minutes** to prepare, then a **5-minute zombie siege**.

1. Collect materials: open the supply crates, chop trees for **logs** (saw them into **planks** at the workbench), smash rocks for **stone**, bring **rope**. Everything goes into one shared team pool.
2. At the **Tower workbench**, design your shelter:
   - **4 small**, **2 medium** or **1 big** tower, or a mix (4 slots: small 1, medium 2, big 4);
   - each tower gets 1–4 floors (more floors = tougher) and an optional **stone base** (+60% strength);
   - drag the towers anywhere inside the roped **building zone**, or use the spacing slider to line them up.
3. Press **Build**: the towers rise. Climb with **E** at the ladder; shoot from the top. Zombies can't climb but will smash the towers. Repair them with the hammer. A tower at 0% collapses and everyone on it falls.
4. Done early? Press **"We're ready — start now"**.

## Giant Plateau (the final stand)

The road ends at the **Giant Plateau**. It's daytime, with no zombies: you get **10 minutes** to build a **stone castle wall**, then **10 giants** come (2 first, then one more every 30 seconds).

- At the **Castle workbench**:
  - pick a shape (square, hexagon, octagon) and a size;
  - **drag the corners** anywhere inside the plateau boundary, and add or remove corners;
  - choose the wall height and thickness, and optional corner turrets;
  - choose which wall gets the **gate**.

  Stone comes from crates, rock piles and rocks.
- Giants throw **boulders** at you. Walls block them (and take the damage); some giants walk up and punch the walls. Climb onto the walls with **E** and repair them with the hammer.
- Your weapon is now a **cannon** (G, then click / F). The ball drops a little over distance; aim at the giants. "Giants remaining" shows at the top.
- Beat all 10 giants to win.

## Scoreboard

- Zombie kill: **10** points, more at higher zombie levels.
- Giant kill: **150**.
- Revive: **50**.
- Deaths are counted too.
- The scoreboard is in the pause menu (**Esc**) and shows at the end (victory or game over), with badges for the top zombie killer, giant slayer and medic.

## Saving

- Orange **checkpoint flags** stand beside the trail. When an RV passes one it turns green and the game **auto-saves**. You can also walk up to any flag and press **E** to save.
- The game also saves when you complete an objective, every 45 seconds, and when you close the tab.
- Next time, the start screen offers **Continue** or **New game**. Saves live in this browser (`localStorage`).
- In co-op the **host's** game is saved; hosting with *Continue* brings your friends into your saved world.

## Mobile

- **Left thumb:** joystick to move or steer. A full push runs.
- **Right thumb:** drag to look.
- **Buttons** change with what you're doing: on foot (use / punch / 💥 shoot, jump, interact, crouch, shotgun, camera), driving (handbrake, horn, lights, get out, walk to the back, reset), and the drone (up / down).
- Tapping the prompt next to a downed teammate starts the revive; stay close until it finishes.
- **Tap** the prompt pill to interact, a hotbar slot to hold an item, and the minimap for the full map.
- Phones start on Low quality with a lighter jungle. Landscape works best.

## Controls (keyboard)

| On foot | | Driving | |
|---|---|---|---|
| WASD | move (swim in deep water) | W / S | gas / brake, reverse |
| Shift | run | A / D | steer |
| Space | jump | Space | handbrake |
| C | crouch | H | horn |
| 1–6 | hold an item | L | headlights |
| G | weapon out / away (shotgun / cannon) | V | chase / cockpit view |
| F / click | shoot / use item / punch | E | get out (when slow) |
| E (hold) | interact / climb towers & walls / revive a teammate | Q | walk to the back |
| X | carry a teammate / pack up gear | | |

Global: **M** map, **K** sound, **B** mic on / off (co-op), **R** RV back to the last checkpoint, **Tab** hide help, **Esc** pause (co-op: player list, ping, mic, kick).

## The trail

1. At the trailhead, take a **chainsaw** (or axe) and the **sledgehammer** from the Gear Locker. The supply crate by the ranger hut has planks, rope and logs.
2. Fallen trees need the chainsaw or axe; rockfalls need the sledgehammer (hold the tool, press **F**). They give **logs** and **stones**.
3. At the **workbench** by the broken bridge:
   - saw logs into planks;
   - design a bridge from road planks, log beams, rope and an optional stone pier;
   - test it with a virtual RV, then build it.
4. Drive across. The bridge is a real spring simulation, so weak designs snap and drop the RV into the river (**R** recovers it).
5. Clear the hill road and reach the **Hilltop Camp**.
6. Cross the pass north (more road blocks) to **Watchtower Valley**: build towers and survive the siege.
7. Drive on to the **Giant Plateau**: build the castle and defeat the giants.

## Files

- `js/main.js` – setup, loop, HUD, start menu, saving
- `js/net.js`, `js/multiplayer.js`, `js/remote.js`, `js/voice.js` – peer-to-peer networking (with auto-reconnect), co-op session, other players' avatars, voice chat
- `js/touch.js`, `js/input.js` – mobile controls, keyboard/mouse/touch input
- `js/save.js` – save/load + checkpoint flags
- `js/terrain.js`, `js/world.js`, `js/obstacles.js` – map, jungle, road blocks
- `js/bridge.js`, `js/bridgeEditor.js`, `js/materials.js` – bridge physics, designer, materials
- `js/rv.js`, `js/rvModel.js`, `js/rvInterior.js`, `js/rvDims.js` – the RV
- `js/player.js`, `js/character.js`, `js/camera.js` – player, animation, cameras
- `js/items.js`, `js/inventory.js`, `js/gear.js`, `js/drone.js` – items, storages, item use, drone
- `js/survival.js` – the campaign: day/night schedule, stages (siege, giants), health, down / revive / carry / elimination, scores, RV damage + repair
- `js/zombies.js`, `js/giants.js` – zombie and giant AI + instanced drawing, boulders
- `js/structures.js`, `js/designer.js` – towers and castle walls (build, climb, damage, repair) and their workbench designer
- `js/combat.js` – shotgun and cannon
- `js/minimap.js` – minimap and full map
- `js/app.js`, `sw.js`, `manifest.webmanifest`, `icons/` – installable app: service worker (offline cache), install button / iOS hint, full screen, wake lock, back button
- `js/farm/` – Farm World: server address (`config.js`), API calls (`api.js`), logins kept on this device (`logins.js`), the session that hosts / joins / saves / hands over the world (`farm.js`), start-menu screens (`menu.js`), Esc-menu members panel (`panel.js`); the farm: plot / store layout (`layout.js`), small props (`props.js`), models (`models.js`), the farmer (`npc.js`), farm in the world + animals + gates (`farmland.js`), shared money, goods and production timers (`economy.js`), store / market / storage / plot / shelter / feeding popups, the production panel and the money bar (`farmui.js`)
- `js/fishing/` – fishing: the challenge rules shared with the server (`sim.js`), rods / fish / docks / Fish Market models (`models.js`), the docks, path and water life in the world (`area.js`), the mini-game, HUD and other players' lines (`fishing.js`), the Fish Market screens (`marketui.js`) and their 3D pictures (`thumbs.js`)
- `server/` – the Farm World server (Cloudflare Worker + NeonDB): API, migrations, tests, setup and deploy steps in [`server/README.md`](server/README.md)

## Performance

- The jungle is drawn with instanced meshes split into chunks (off-screen trees are skipped). A typical frame is about 100 draw calls and 150k triangles.
- Frame rate is capped (60, or 30 on Low). The game drops to 15 fps after 25 s idle when playing solo, and stops rendering while paused or while the bridge designer is open.
- All zombies together are drawn with 7 instanced meshes, so 20 zombies cost about the same as one. At most 24 are around at once.
- Network traffic is small: player snapshots only carry players that changed (plus a full one each second), 10 zombie snapshots per second, and RV / bridge updates only while they move. Voice uses one small audio link per pair of players (Opus), and sends silence while your mic is off.
- Slow links don't fall behind: when a link has a lot of data waiting, position and state snapshots for it are skipped (the next one replaces them) instead of piling up, and network timers run on real time, so a slow phone still sends its updates on time.
- Voice links check themselves: a link whose network path stays down, or that brings no sound while that player's mic is on, is remade. In each pair only one player rings, so the other one asks over the game connection when it has no working link.
- Quality menu (top-right): **Low** (no shadows, shorter view distance, 30 fps), **Medium**, **High**.
