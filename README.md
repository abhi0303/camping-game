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
- **Invite friends:** Esc menu → **➕ Invite a friend** (owner only) makes a one-time link, valid for 72 hours. Your friend opens it, picks a name and a PIN, and is a member from then on. A world has at most **4 members**; knowing the code alone doesn't let anyone in.
- **Play any time:** any member opens the world, from the saved list (*▶ Play*) or with *Open a world you belong to* (code + name + PIN, also on a new device). Any 1–4 members can play together; offline members keep their place.
- **Members vs. online:** the Esc menu shows both, e.g. *Members 4/4 · Online 2/4*, with who is playing now and when the others were last seen.
- **Who hosts:** the first member to open the world hosts the live game; the others join them. If the host leaves or their browser crashes, one of the remaining players takes over automatically and play goes on.
- **Saving:** the host saves the world every ~25 s when something changed, right after important events (objectives, checkpoints, the bridge) and when the page closes. If the server can't be reached, the game keeps going and saves once it's back.
- **Owner tools (Esc menu):** remove a member (frees their place, ends their logins), delete the world (type its name to confirm). Everyone can *Log out on this device*.
- No zombies, nights, siege or giants in Farm World. You clear the same trail, rebuild the bridge and explore. Animals, the market, vehicles and building come in later updates.

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
- `js/farm/` – Farm World: server address (`config.js`), API calls (`api.js`), logins kept on this device (`logins.js`), the session that hosts / joins / saves / hands over the world (`farm.js`), start-menu screens (`menu.js`), Esc-menu members panel (`panel.js`)
- `server/` – the Farm World server (Cloudflare Worker + NeonDB): API, migrations, tests, setup and deploy steps in [`server/README.md`](server/README.md)

## Performance

- The jungle is drawn with instanced meshes split into chunks (off-screen trees are skipped). A typical frame is about 100 draw calls and 150k triangles.
- Frame rate is capped (60, or 30 on Low). The game drops to 15 fps after 25 s idle when playing solo, and stops rendering while paused or while the bridge designer is open.
- All zombies together are drawn with 7 instanced meshes, so 20 zombies cost about the same as one. At most 24 are around at once.
- Network traffic is small: player snapshots only carry players that changed (plus a full one each second), 10 zombie snapshots per second, and RV / bridge updates only while they move. Voice uses one small audio link per pair of players (Opus), and sends silence while your mic is off.
- Slow links don't fall behind: when a link has a lot of data waiting, position and state snapshots for it are skipped (the next one replaces them) instead of piling up, and network timers run on real time, so a slow phone still sends its updates on time.
- Voice links check themselves: a link whose network path stays down, or that brings no sound while that player's mic is on, is remade. In each pair only one player rings, so the other one asks over the game connection when it has no working link.
- Quality menu (top-right): **Low** (no shadows, shorter view distance, 30 fps), **Medium**, **High**.
