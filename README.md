# RV Van – Jungle Trail

A low-poly RV adventure in plain HTML/CSS/JS + Three.js. Start at the trailhead, drive through a hilly jungle, clear the road, rebuild the broken bridge over the river and reach the hilltop camp — and survive the zombie nights. Play alone or with up to 3 friends (4 players, one RV), on desktop or mobile.

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
- **Leaving:** closing or refreshing the tab removes you from the room right away (no duplicate players when you come back). A player whose connection dies is removed after 15 seconds of silence.
- **Kick:** the host can remove a player from the pause menu (**Esc → Kick**, then confirm). Kicked players go back to the start screen and can't rejoin that room.
- **Seats:** one player drives and the other can take the **passenger seat**, or sit or lie anywhere inside, and rides along. Seats are exclusive, so nobody can take the driver seat while someone is using it.
- **Shared progress:** road blocks, the bridge (including its physics), materials, supply crates, camping gear, the day/night clock, the zombies and the RV's health are shared. The RV's Gear Locker, fridge and storage bay are shared too.

**How it works:** browsers connect directly to each other with WebRTC. PeerJS's free public service only helps them find each other, which is why this works on GitHub Pages without a game server. The host's game is the authority for shared things (including the zombies), and whoever drives the RV controls it. Every player sends their avatar to the host, and the host sends everyone one snapshot with all players in it, so all screens show the same people. If the host leaves, the others continue solo.

**Limits:** connections go peer-to-peer, with PeerJS's free relay as a fallback. Very strict networks (some offices or schools) can still block WebRTC. The public PeerJS service has no uptime guarantee; for a big audience, run your own PeerJS server.

## Zombie nights

- The day lasts **3 minutes**; then night falls for **5 minutes** and **zombies** rise out of the jungle and come for the players. The timer is at the top of the screen.
- Everyone has a **pump shotgun with unlimited ammo**: press **G** (or tap the shotgun) to take it out, **click / F** to shoot. It hits hardest up close. It's drawn automatically when night falls.
- Each player has **health** (bar at the bottom; teammates' health shows in the team list and above their heads). Health comes back during the day, slowly at night when you're safe, and faster lying in a bed. Food and drinks from the fridge give +25.
- At 0 health you're **down**. A teammate can **revive** you (hold **E** next to you) or **carry** you (**X**) to a safe spot and put you down (**X** again). If nobody helps in time, you wake up inside the RV. Solo, you wake up there after a few seconds.
- **The RV is safe:** zombies can't climb onto the roof (ladder at the back) or get inside. Instead they **attack the RV**. Shoot them off before it's wrecked. A wrecked RV can't be driven, and the zombies can reach the people in and on it.
- Driving into zombies kills them (and dents the RV a little).
- **Morning:** the zombies collapse. **Repair the RV** with the hammer (or sledgehammer) from the Gear Locker: stand next to it and press **F**. **The next night only comes once the RV is back to 100%.**

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
| G | shotgun out / away | V | chase / cockpit view |
| F / click | shoot / use item / punch | E | get out (when slow) |
| E (hold) | interact / revive a teammate | Q | walk to the back |
| X | carry a teammate / pack up gear | | |

Global: **M** map, **K** sound, **R** RV back to the last checkpoint, **Tab** hide help, **Esc** pause (co-op: player list, kick).

## The trail

1. At the trailhead, take a **chainsaw** (or axe) and the **sledgehammer** from the Gear Locker. The supply crate by the ranger hut has planks, rope and logs.
2. Fallen trees need the chainsaw or axe; rockfalls need the sledgehammer (hold the tool, press **F**). They give **logs** and **stones**.
3. At the **workbench** by the broken bridge:
   - saw logs into planks;
   - design a bridge from road planks, log beams, rope and an optional stone pier;
   - test it with a virtual RV, then build it.
4. Drive across. The bridge is a real spring simulation, so weak designs snap and drop the RV into the river (**R** recovers it).
5. Clear the hill road and reach the **Hilltop Camp**.

## Files

- `js/main.js` – setup, loop, HUD, start menu, saving
- `js/net.js`, `js/multiplayer.js`, `js/remote.js` – peer-to-peer networking, co-op session, other players' avatars
- `js/touch.js`, `js/input.js` – mobile controls, keyboard/mouse/touch input
- `js/save.js` – save/load + checkpoint flags
- `js/terrain.js`, `js/world.js`, `js/obstacles.js` – map, jungle, road blocks
- `js/bridge.js`, `js/bridgeEditor.js`, `js/materials.js` – bridge physics, designer, materials
- `js/rv.js`, `js/rvModel.js`, `js/rvInterior.js`, `js/rvDims.js` – the RV
- `js/player.js`, `js/character.js`, `js/camera.js` – player, animation, cameras
- `js/items.js`, `js/inventory.js`, `js/gear.js`, `js/drone.js` – items, storages, item use, drone
- `js/survival.js`, `js/zombies.js`, `js/combat.js` – day/night clock, health, revive/carry, RV damage + repair; zombie AI and drawing; the shotgun
- `js/minimap.js` – minimap and full map

## Performance

- The jungle is drawn with instanced meshes split into chunks (off-screen trees are skipped). A typical frame is about 100 draw calls and 150k triangles.
- Frame rate is capped (60, or 30 on Low). The game drops to 15 fps after 25 s idle when playing solo, and stops rendering while paused or while the bridge designer is open.
- All zombies together are drawn with 7 instanced meshes, so 20 zombies cost about the same as one. At most 24 are around at once.
- Network traffic is small: 10 player snapshots, 10 zombie snapshots and 15 RV updates per second, each a few hundred bytes.
- Quality menu (top-right): **Low** (no shadows, shorter view distance, 30 fps), **Medium**, **High**.
