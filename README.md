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

The farm is in a clearing just east of the trailhead (follow the **FARM** sign by the road). Everything on it belongs to the whole group: one shared money balance (💰, starts at ₹500), one store of goods, the same shelters and animals for every member, online or not.

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

  Each kind has its own look, and its eggs are kept separately. 🐐 Goats (₹150; Boer-style: white body, brown head with a white blaze, curved horns, droopy ears, beard) give goat milk (₹30), 🐄 cows (₹400) cow milk (₹25).
- **Horses:** six colours, each with its own look. Buy a **baby** (Level 1) or a **grown** horse (Level 10):

  | Colour | Baby | Grown | Rent (per 2 h) | Sells for (Level 1 → 10) |
  |---|---|---|---|---|
  | Bay, Chestnut (common) | ₹150 | ₹600 | ₹50 | ₹105 → ₹480 |
  | Black, White (uncommon) | ₹220 | ₹800 | ₹65 | ₹154 → ₹640 |
  | Golden (Palomino), Spotted (Pinto) (rare) | ₹320 | ₹1,100 | ₹85 | ₹224 → ₹880 |

  A fed horse grows **one level every 2 hours** (2 feed per feeding) up to **Level 10** — about 18 hours of feeding; a hungry one stops growing. Babies are small and grow bigger with each level. **Sell** a horse at any level from the stable's panel (older and rarer horses sell for more). **Rent out** Level 10 horses: now and then (about every 1–2 hours) a customer asks at the Market's Orders tab for 1 or 2 horses for 1–4 hours — any colour at the common rate, or a certain colour for that colour's rate + 20 %. A request waits about an hour for a player to **hand the horses over**; the farm is paid at once, the horses leave the pen and come back by themselves when the time is up (looked after by the renter).
- **How they move:** goats and chickens walk with real steps — legs swinging from the hips, no sliding or floating. When a pen (or the goat field by the store) has two or more goats, the same two always butt heads: they walk up to each other, back off, rear up and clash (you hear the horns clack), 10 s of fighting, 10 s rest, 5 s of fighting, 10 s rest, again and again. The other goats walk between the feed trough and the water trough and eat or drink there with their heads down. Chickens walk in short bursts with a bobbing head, peck at the ground when they stop, and now and then hop with a flap of the wings. It all comes from the shared clock, so every player sees the same (`js/farm/animals.js`).
- **Health:** an animal left hungry for a day gets weak (it never dies). Fed again it recovers.
- **Farm Store** (across the road): talk to the farmer behind the counter (**E**). His menu: purchase animals, sell farm products, purchase animal feed (₹2), farming supplies (coming with crop fields) and construction materials (🪵 wood ₹6, 🪨 stone ₹8). You can walk inside.
- **Fish Market** (east of the Market, set back from the road; follow the 🐟 sign): talk to the fisherman (**E**) to buy worms, buy or upgrade your fishing rod, sell fish and see the farm's fish collection. See [Fishing](#fishing) below.
- **Customer orders** (the **Orders** tab at the Market, or the farmer's menu; look for the 📜 ORDERS sign): customers ask for a mix of what your farm can make — eggs, milk and the fish your rods catch, sized to your farm — and pay **10 % more** than the normal price. One order at a time: after you deliver one (everything at once, from the farm storage), the next arrives 30–60 minutes later, up to **3 a day**. A day ends at **midnight India time** for everyone in the world. Deliver at least one order a day for **5 days in a row** and get a **₹200 bonus** on the 5th day (again on the 10th, 15th…); miss a day and the streak starts again. Any member can deliver; an order is paid once.
- **Market** (next to the store): the selling hall — sell eggs, milk, wood and stone, see the price board and the farm's trade log (who bought, sold, built or upgraded what).
- **Farm storage** (end of the walkway): store the logs and stones you collect (chopping trees, rockfalls, crates) — logs become 🪵 wood. It also sets how much the farm can hold: level 1 holds 60 of each egg, 30 of each milk, 500 feed / wood / stone. **Upgrade to level 2** (₹600 · 80 wood · 40 stone) for twice as much and a bigger storehouse. Two players pressing Upgrade at once upgrade it only once.
- **While nobody plays:** fed animals keep producing until their feed runs out. When anyone opens the world, the server works out what happened since, using its own clock, for up to a week of absence. Goods stop at the storage limit, so sell before it fills up.
- **Safe for a group:** every purchase, sale, feeding, build, gate and upgrade is checked by the server against the shared money and goods. Two members buying at the same moment can't spend the same money; a double click or a retry after a lost connection never does anything twice.
- **The bag and the order slip:** two floating buttons (under the map on phones, bottom-right on computers). The **bag** shows the farm's money on its badge (a dot means animals are hungry or eggs are waiting) and opens the **Farm Notebook** (**N**) — a spiral notebook listing the money, feed, produce, wood and stone, the animals, your rod and worms, the fish and the team's materials. The **order slip** (**O**) is a paper copy of today's order, so you don't have to walk back to the Market: what you already have enough of is ticked and crossed out, what's still missing stays on top with how many more you need; its badge counts the missing items (a green tick when everything is ready to deliver). Horse rental requests are on it too. The **Zombie Trail menu** (start screen and Esc menu) is a riveted survival plate: hazard tape, a dripping toxic-green title, a mission briefing, blood-orange *Play solo* and army-green co-op buttons, the keys as a *field manual* and the *survival rules* as a short list. The farm's **popups** (Farm Store, Market, Fish Market, plots, shelters, troughs, storage) and the small plot panel use the same look: a barn-red sign header, cream paper, a farmer speech bubble, menu cards, and a shelter's numbers as tiles (animals, eggs ready, next egg, fed for, feed) above one row per animal. The **start menu's Farm World tab** uses the same signboard look: your saved worlds as cards (code, your name, members, who's playing, **Play**), then one form at a time for another world — **Create**, **Join with invite** or **Log in** (an invite link or a world code in the address opens the right one). The **Esc menu** is a farm signboard: the world's name, code (copy button) and last save on a barn-red sign; **Back to the farm**, Sound / Music / Full screen; *Your farm* at a glance (money, animals, eggs and milk per hour, feed — red when animals are hungry); the *Farmhands* (owner / host badges, playing or offline, Remove); Invite a friend, Mic and Sync; log out / delete; and the farm's keys. Animals walk around their pens the same way on every player's screen.
- **No gun in Farm World:** there are no zombies on the farm, so the shotgun button and **G** are left out. The health bar only shows when you're hurt.

### Fishing

A stone path with lanterns leads from behind the Fish Market north through the jungle to **three wooden docks** on the river. Fish swim around the docks and jump now and then.

- **Worms:** 10 for ₹1 at the Fish Market. Each cast puts one worm on the hook (an escaped fish keeps it). No worms, no fishing.
- **Fishing:** walk to the end of a dock — **E – Start Fishing**. Your character casts; wait and watch the float. Not every cast gets a bite.
- **The tug of war:** when a fish bites (*“A fish has bitten! Pull now!”*) hold **S** (phones: the **PULL** button). Then the fish takes turns: while it **fights**, let go — pulling raises the line tension and at 100 % the line snaps. When it's **tired**, hold S until the pull is reeled in. Small fish need 2–3 pulls, medium 4–5, large 6–8. While you fish, one soft line of white text says what's happening (*“Waiting for a fish bite…”*, *“It's fighting — let go!”*), with a slim tension bar and the pulls while a fish is on the line — nothing else covers the water. Your rod and worms are in the Farm Notebook. Miss a tired spell too often and the line goes slack — *“The fish escaped! Try again.”*
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

### Sonpur village

Behind the Market and the Fish Market lies **Sonpur**, a small village to walk around (no shops or people yet). A dirt lane leads in from behind the Market past the village sign; the fishing path is the main street and runs through the village to the docks, and lanes branch off east and west.

- **The square:** a paved square on the main street with a covered well in the middle, benches round it, a fruit stall with a striped awning, lamps, pots and barrels. The **village hall** with its bell turret stands on its north side.
- **18 houses, all different:** red-tile, thatch, blue and brown roofs (gable, hip, saltbox, pyramid and round cone roofs); walls of logs, stone blocks, boards, timber frame, mud and plaster; one and two storeys, stone foundations, porches with steps, balconies, chimneys, side annexes, round mud huts and a stone tower house. Windows (square, arched, shuttered, round, barred), doors and window boxes vary, and some doors have a lantern.
- **A garden for every house:** a stepping-stone path from the door to the lane and two beds — white and yellow flowers, sunflowers, cabbages, tomatoes and carrots, bushes or fruit trees, some in neat rows, some wild — behind a picket fence, a wooden fence, a low stone wall or a hedge, with flower pots by the door and a bench or a water barrel.
- **Animals:** six houses keep animals in a small fenced pen beside the house — chicken coops on stilts, goat lean-tos, an open cow shed, a horse shelter, each with feed and water troughs. They are the farm's own animals and move the same way (pecking hens, grazing goats that butt heads, a cow, a horse), but they belong to the village: you can't feed them or collect anything.
- **Around the houses:** wood piles, carts, haystacks, clotheslines, cooking fires, sheds, tables with stools, pots, street lamps along the lanes, and trees between the houses. You bump into the houses, the animal pens, the well, the stall, lamps, carts, sheds, haystacks and trees; you can walk into the gardens.
- **At night** the house windows glow, the lanterns and street lamps come on and the cooking fires flicker, with the same shared India-time clock as the rest of Farm World.
- **On the map:** the lanes, the square and every house (in its roof colour) are drawn on the minimap and the full map, with a marker for Sonpur.
- Everything is placed the same way for every player: the layout comes from fixed rules (`js/village/layout.js`), so nothing is sent over the network.

### Day and night (real India time)

Farm World follows the **real time in India (IST)**. The sun's position comes from the date, the time and the world's place on Earth (the Maikal hills of central India), so sunrise and sunset move with the seasons — in early November about 6:10 AM and 5:25 PM, in June about 5:20 AM and 6:50 PM. The time is on the top bar, with a sunrise, sun, sunset or moon icon.

- **Morning:** soft golden light from the east, long shadows to the west, a warm horizon.
- **Day / afternoon:** a bright blue sky; the sun moves across it, and the shadows turn and shorten toward midday.
- **Evening:** orange and pink light from the west, long shadows to the east, the sky darkening.
- **Night:** stars and a moon, cool moonlight. Lamps come on one by one from sunset and go off after sunrise: lanterns at the Farm Store, the Market and the Fish Market, lit windows (all of Sonpur's houses too), the village lamps and cooking fires, lamps at every pen gate and shelter, street lamps along the walkway and the fish path, and flickering **torches** (flambeaux) at the farm's sign, the walkway, the Market, the Fish Market, the trailhead and the camp. Inside the Farm Store the ceiling lamps light the room.
- **Together:** everyone in a world sees the same sky — it uses the farm server's clock (the same one the animals use), not each computer's clock, and nothing extra is sent over the network. Opening the game later shows the right time of day at once.

**Sounds and wildlife** (`js/ambience.js`, `js/birds.js`, all synthesized — no audio files): at night a cricket chorus with single crickets close by, toads trilling (more near the river) and now and then a distant owl; in the morning lots of birdsong, fewer birds later in the day. Two or three birds circle high over you and a few sit on the tops of nearby jungle trees (now and then one flies to another tree); they roost at night. Near the river you hear the water; at the docks while fishing the water laps, little bubbles rise and fish splash as they jump. Footsteps are soft: grass, gravel on the road, hollow knocks on the docks and the RV floor. Walk up to the pens and the hens cluck (“buk-buk… ba-gawk!”) and the goats bleat — from where the animals are, louder the closer you get, right away when you arrive and then now and then (more when several are close; hens mostly sleep at night). Inside the RV the outside sounds are muffled. The RV itself sounds like a big diesel van: the starter cranks, then a deep, low rumble that rises with speed and load.

**Farm music** (`js/music.js`, synthesized): a gentle country tune — finger-picked "boom-chick" guitar under a whistled melody, a banjo-like pluck the second time round, then the guitar alone for a while, with a soft shaker in the daytime; at night it plays quieter, guitar only. It follows Sound on / off and has its own **Music on / off** button in the Esc menu (Farm World only, remembered on this device).

Zombie Trail keeps its zombie nights (the campaign decides when it is dark); they now have stars, a moon and lit torches too.

The settings are at the top of `js/day-night.js` (`DAY_NIGHT`): the time zone (`Asia/Kolkata`), latitude / longitude, fixed sunrise / sunset times as a fallback (`solar: 'fixed'`), and weather hooks for later (cloud cover, fog). **Testing other times** (only on your own computer — `localhost`): add `?time=17:30` to the address (optionally `&date=2026-06-21` and `&speed=60` to run the clock 60× faster), or call `__game.dayNight.setTime('22:00')` in the console (`setTime(null)` goes back to the real time). It changes only the light on that screen, never the farm's clock.

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
| G | weapon out / away (shotgun / cannon; not in Farm World) | V | chase / cockpit view |
| F / click | shoot / use item / punch | E | get out (when slow) |
| E (hold) | interact / climb towers & walls / revive a teammate | Q | walk to the back |
| X | carry a teammate / pack up gear | | |

Farm World: **N** farm notebook, **O** order slip, **R** parks the RV back in front of the Farm Store. Opening a world puts the RV on the road right in front of the Farm Store, with you standing outside it.

Leaving a Zombie Trail game: **Esc → Exit to main menu** (tap twice). Solo and the host save first and the start screen offers **Continue**; when the host leaves, the friends carry on solo; a guest just leaves the room.

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
- `js/terrain.js`, `js/world.js`, `js/obstacles.js` – map, jungle, road blocks. The ground is painted by the terrain's shader from the world position: a bright stylised meadow of soft, roughly hexagonal patches in close lime shades (a touch darker in places), and light tan dirt patches plus small spots of bare soil with frayed edges — no texture and no seams. `js/grass.js` grows wild flowers around the player — white daisies and yellow flowers with chunky flat petals and broad leaves at the base, lit softly with a gentle daylight glow, swaying, pressed down around your feet — in little groups (never on dirt, roads, river banks, cliffs, farm pens, paths, rocks, bushes or tree trunks); how far they reach follows the graphics quality. Pebbles, grey faceted rocks with little stones beside them (you bump into the bigger ones) and round bright bushes are scattered as instanced meshes (half as many on phones)
- `js/day-night.js` – day and night: the clock (IST), the sun's position, sky, stars and moon, fog, clouds, sunlight / moonlight and shadows, and the lamps (halos, torch flames and smoke, the few real lights that follow the player)
- `js/bridge.js`, `js/bridgeEditor.js`, `js/materials.js` – bridge physics, designer, materials
- `js/rv.js`, `js/rvModel.js`, `js/rvInterior.js`, `js/rvDims.js` – the RV
- `js/player.js`, `js/character.js`, `js/camera.js` – player, animation, cameras
- `js/items.js`, `js/inventory.js`, `js/gear.js`, `js/drone.js` – items, storages, item use, drone
- `js/survival.js` – the campaign: day/night schedule, stages (siege, giants), health, down / revive / carry / elimination, scores, RV damage + repair
- `js/zombies.js`, `js/giants.js` – zombie and giant AI + instanced drawing, boulders
- `js/structures.js`, `js/designer.js` – towers and castle walls (build, climb, damage, repair) and their workbench designer
- `js/combat.js` – shotgun and cannon
- `js/minimap.js` – minimap and full map. The full map (**M**, or tap the minimap) opens zoomed in on you with the mouse free: scroll (or pinch) to zoom, drag to move, double-click to zoom in, buttons for zoom / centre on me / whole map, a scale bar; the first time it opens a sharper map with every tree's crown is painted in the background. Overlapping labels are left out; Farm World adds the Farm Store, Market and Farm, and Sonpur village (lanes, square and houses)
- `js/icons.js` – the game's icons (small SVG pictures for items, animals, places and the HUD); emoji written anywhere in the page are swapped for these icons, so no emoji is ever shown
- `js/flora.js` – the trees, bushes, plants, rocks and broken wood, built from code in a stylised low-poly look: broadleaf trees with layered, drooping lime leaf pads and red-brown branching trunks, a big canopy tree, round layered trees, a few dead trees, curved palms, jagged tiered pines and cypresses in the highlands, round lime bushes, leafy undergrowth, rounded grey / bluish rocks, standing stones, a few red rocks, pebble groups, cut stumps with roots and broken fallen logs (the trail's fallen trees and rockfalls too). Which look a tree gets comes from its position, so every tree stands exactly where it always did
- `js/grass.js` – wild flowers (white and yellow) around the player
- `js/music.js` – Farm World's music
- `js/farm/animals.js` – how goats and chickens move: steps, head butting, eating and drinking, pecking, hops
- `js/ambience.js`, `js/birds.js` – the jungle's sounds (crickets, toads, birdsong, the river, bubbles, fish jumps, footsteps) and the birds in the trees and the sky
- `js/app.js`, `sw.js`, `manifest.webmanifest`, `icons/` – installable app: service worker (offline cache), install button / iOS hint, full screen, wake lock, back button
- `js/farm/` – Farm World: server address (`config.js`), API calls (`api.js`), logins kept on this device (`logins.js`), the session that hosts / joins / saves / hands over the world (`farm.js`), start-menu screens (`menu.js`), Esc-menu members panel (`panel.js`); the farm: plot / store layout (`layout.js`), small props (`props.js`), models (`models.js`), the farmer (`npc.js`), farm in the world + animals + gates (`farmland.js`), shared money, goods and production timers (`economy.js`), store / market / storage / plot / shelter / feeding popups, the production panel (`farmui.js`), the floating bag / order-slip buttons, the Farm Notebook and the Order Slip (`notebook.js`)
- `js/village/` – Sonpur village (Farm World): where it is, its lanes and how the houses are placed along them (`layout.js`), the 18 houses and the hall (`houses.js`), the gardens and garden plants (`gardens.js`), the animal pens (`animals.js`), the well, carts, haystacks, clotheslines, fires, sheds, the stall and other props (`props.js`), and building it all into the world (`index.js`)
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
- Sonpur village is built once when you enter Farm World and merged into a few meshes per 32 m area (one per material), with the garden plants and trees as instanced meshes: about 40 extra draw calls and 200k triangles in view. Phones grow fewer garden flowers, and the garden flowers are a lighter model than the wild ones.
- Day and night cost almost nothing: the sky, stars and moon are a few draw calls, all lamp halos are one instanced mesh, all torch flames another and their smoke a third. About 70 lamps share a small pool of real lights (2 on Low, 4 on Medium, 6 on High) that follow the lamps nearest to you; nothing is created while playing, and sunlight shadows aren't drawn while the sun and moon are both below the horizon.
