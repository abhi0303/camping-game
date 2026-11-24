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
- **Invite friends:** Esc menu → **➕ Invite a friend** (the owner, and any member the owner lets invite) makes a one-time invite, valid for 72 hours. **Copy** copies a message with the link *and* two codes: the **world code** and the **invite code**. Your friend can either:
  - open the link in the browser, pick a name and a PIN; or
  - in the installed app (which can't open links): **Farm World → New here? Join with an invite**, type the world code and invite code (or paste the whole message), a name and a PIN.

  Either way they are a member from then on and log in later with world code + name + PIN. A world has at most **4 members**; knowing the world code alone doesn't let anyone in.
- **Play any time:** any member opens the world, from the saved list (*▶ Play*) or with *Open a world you belong to* (code + name + PIN, also on a new device). Any 1–4 members can play together; offline members keep their place.
- **Members vs. online:** the Esc menu shows both, e.g. *Members 4/4 · Online 2/4*, with who is playing now and when the others were last seen.
- **Who hosts:** the first member to open the world hosts the live game; the others join them. If the host leaves or their browser crashes, one of the remaining players takes over automatically and play goes on.
- **Saving:** the host saves the world every ~25 s when something changed, right after important events (objectives, checkpoints, the bridge) and when the page closes. If the server can't be reached, the game keeps going and saves once it's back.
- **Owner tools (Esc menu → Farmhands → Manage next to a member):** **Can invite friends** — a switch that lets that member invite new friends too (they get the *Invite a friend* button and the **I** key; a *can invite* badge shows it), and off again; **Make owner** — hand the world over (tap twice to confirm): they become the owner with all the owner tools, and you stay a member who can still invite friends (the new owner can change that, or hand it back); **Remove** — frees their place and ends their logins. The owner can also delete the world (type its name to confirm). Everyone can *Log out on this device*.
- No zombies, nights, siege or giants in Farm World. You clear the same trail, rebuild the bridge and explore — and run a farm.
- **The goal card** (top left) always tells you what to do next, from what your farm already has: first anything that needs doing **now** (hungry animals, full nests, a thief who has noticed the eggs, a guard dog asleep from hunger, a full storage), then the **next goal** with how many of the farm's 16 steps are done — coop → chickens → feeding → selling eggs → a guard dog → goats → a full coop → a bigger storage → fishing → a cow → a horse → training the dog → a second dog → Sonpur and its football. Steps done in a different order are skipped, and every player sees the same. With the farm grown, it moves on to clearing the trail and exploring the north. Its arrow on the map points the way. The **controls card** (bottom left) folds to a small *Controls · Tab* tab by itself after a while — **Tab** (or a click) opens and folds it.

### The farm

The farm is in a clearing just east of the trailhead (follow the **FARM** sign by the road). Everything on it belongs to the whole group: one shared money balance (💰, starts at ₹500), one store of goods, the same shelters and animals for every member, online or not.

The main road splits it in two: **the farm** (plots and storage) on one side, **the Farm Store and the Market** on the other.

- **Plots:** 8 plots in two rows along a walkway, each with its own wooden signboard by its gate. Walk up to a plot sign to build a shelter on it:

  | Shelter | Cost | Holds (level 1 → 5) | From farm level |
  |---|---|---|---|
  | 🏠 Chicken coop | ₹150 · 20 wood | 6 → 14 chickens (any kind) | 1 |
  | 🛖 Goat shed | ₹400 · 40 wood | 4 → 8 goats | 2 |
  | 🏚 Cow barn | ₹900 · 60 wood · 20 stone | 3 → 7 cows | 4 |
  | 🐎 Horse stable | ₹1200 · 80 wood · 30 stone | 4 → 8 horses | 5 |

  Every shelter has **five levels** (its panel: **Upgrade**): each one holds more animals and makes them produce a little more (+5 / 10 / 20 / 30 %). The higher levels cost more money, wood and stone, levels 4 and 5 gold coins too, and each needs a higher farm level (see *Farm level* below).
- **Pens and gates:** every shelter has a fenced pen with a dirt yard, a feed trough and a water trough. Press **E** at the gate to open or close it — a closed gate blocks the way, everyone sees it move, and it stays as you left it.
- **Feeding:** animals only eat when you feed them. Open the gate, walk to the feed trough and press **E**: **Feed all** or **Feed selected** (the hungriest first). One feeding costs 1 🌾 feed per chicken (2 per goat or horse, 3 per brown cow, 4 per black & white or black cow) and keeps it fed — and producing — for **2 hours** (you can feed up to a day ahead). With too little feed only some animals get fed. New animals arrive fed for 2 hours.
- **Production panel:** stand at a plot to see its numbers live — total animals, **next egg / milk in**, **feed due in**, feeding duration and what's in storage. When nobody is fed it says **Production Paused – Feed Required**. The timers come from the server's time stamps.
- **Chickens:** every chicken has its own egg timer and its own nest box. Eggs wait in the nest (up to 24 per chicken) until someone **collects** them — at the nest boxes in the pen (**E**) or with **Collect** in the coop's panel. A full nest stops that chicken laying, so an untended farm never piles up endless eggs.

  | Chicken | Price | Lays (while fed) | Egg price | Unlocks |
  |---|---|---|---|---|
  | 🐔 Regular White | ₹60 | 1 egg every **12 min** | ₹1 | from the start |
  | 🐓 Brown Desi | ₹250 | 1 brown egg every **15 min** | ₹3 | farm level 3 |
  | 🐦‍⬛ Black | ₹600 | 1 black egg every **20 min** | ₹8 | farm level 6 |
  | 🐔 Golden hen | **30 gold** | 1 golden egg every **30 min** | ₹30 | farm level 10 |

  The timings live in one file, [`server/src/animals.js`](server/src/animals.js). A Regular White pays for itself in about 15 hours of feeding, a Brown Desi in about 23 and a Black in about 26 — but the rarer hens earn the most per place in the coop. **Care levels:** every hour an animal is fed counts; after 6 / 20 / 48 / 100 hours it reaches care level 2 / 3 / 4 / 5 and makes 10 / 20 / 35 / 50 % more (shown on each animal in its shelter's panel). The **Chicken Farm panel** (stand at the coop, or open it from its sign) shows the varieties, **Next Egg In** (the shortest timer, ticking every second), the eggs ready to collect, the feeding left and the feed needed, in colours: 🟢 laying · 🟡 an egg is seconds away · 🔵 eggs ready · 🔴 feed required. The coop's panel also lists every chicken with its own timer.

  Each kind has its own look, and its eggs are kept separately. 🐐 Goats (₹300, farm level 2; a brown fat-tailed breed with a pale face and floppy ears) give goat milk (₹30, one every 2 hours), three kinds of 🐄 cows give milk, one every 2 hours: the **brown cow** — the common one (₹800, farm level 4; cow milk ₹60), the **black & white cow** (₹2,500 **and 6 gold coins**, farm level 6; B&W cow milk ₹90) and the **black cow** (₹4,500 **and 15 gold coins**, farm level 8; black cow milk ₹130; it eats 4 feed per feeding like the black & white one). A dearer cow earns more for its place in the barn but takes longer to pay off (the brown cow in about 30 fed hours, black & white about 74, black about 96). Every cow bought before there were three is a brown cow.
- **Horses:** six colours, each with its own look. Buy a **baby** (Level 1) or a **grown** horse (Level 10):

  | Colour | Baby | Grown | Rent (per 2 h) | Sells for (Level 1 → 10) |
  |---|---|---|---|---|
  | Bay, Chestnut (common) | ₹150 | ₹600 | ₹50 | ₹105 → ₹480 |
  | Black, White (uncommon) | ₹220 | ₹800 | ₹65 | ₹154 → ₹640 |
  | Golden (Palomino), Spotted (Pinto) (rare) | ₹320 | ₹1,100 | ₹85 | ₹224 → ₹880 |

  A fed horse grows **one level every 2 hours** (2 feed per feeding) up to **Level 10** — about 18 hours of feeding; a hungry one stops growing. Babies are small and grow bigger with each level. **Sell** a horse at any level from the stable's panel (older and rarer horses sell for more). **Rent out** Level 10 horses: now and then (about every 1–2 hours) a customer asks at the Market's Orders tab for 1 or 2 horses for 1–4 hours — any colour at the common rate, or a certain colour for that colour's rate + 20 %. A request waits about an hour for a player to **hand the horses over**; the farm is paid at once, the horses leave the pen and come back by themselves when the time is up (looked after by the renter).
- **The animals:** every animal is a textured model baked into the game's flat-coloured low-poly look (see *Credits*). The hens: the white hen, the brown desi hen and the black rooster (dark, with a green sheen and a long curved tail); the golden hen is the white one in gold. The horses: the bay (brown, black mane, tail and legs), the black and the chestnut (red-brown, white blaze and socks); the white, golden and spotted horses are the black and chestnut ones recoloured (the spotted one gets big white patches). A baby horse is the same horse, smaller, growing with its level. The cows: the brown cow (red-brown and white patches, a white face, a long tail), the black & white cow (Holstein patches, small horns, a pink udder) and the black cow (a dark coat, a cream face, curved horns); the goat is a fat-tailed sheep. Each is one piece, so the game gives it its moving parts itself (`js/farm/polyRig.js`): every point is tagged by where it is — the legs below where they leave the body (and their knees), the neck and head forward of the shoulder (a horse's head also nods back at the poll), a hen's wings at its sides, the tail where it hangs free of the rump.
- **How they move:** goats, chickens, cows and horses walk with real steps — legs swinging from the hips (cows' and horses' knees bend as each hoof comes forward), and a step is as long as the hooves really move, so they never slide: walking slowly, the steps get shorter. Cows and horses walk one leg after another (a hind leg, the front leg on that side, then the other two), nodding with each step. Walking and stopping come in an uneven rhythm, never the same twice. On a slope an animal stands tipped with the ground under its feet, so no hoof hangs in the air. When a pen (or the goat field by the store) has two or more goats, the same two always butt heads: they walk up to each other, back off, rear up and clash (you hear the heads clack), 10 s of fighting, 10 s rest, 5 s of fighting, 10 s rest, again and again. The other goats walk between the feed trough and the water trough and eat or drink there with their noses in the trough; standing about, a goat grazes with its neck right down, looks up now and then, and its fat tail wobbles as it walks. Cows and horses wander slowly, stop to graze (a horse's neck goes down and the head tips back so the nose reaches the grass, a cow's neck bends down from the shoulders until its nose is in the grass, for a while, nodding as they crop it, then comes up to look about) and swish their tails, with a quick flick now and then. Now and then — 2 to 30 seconds apart, at random — a horse **rears up on its hind legs**, front legs folded and pawing the air, its head high, for about three seconds; it stops where it is for it and then catches up with its walk. Hens walk in short bursts with quick steps and a bobbing head, and do everything else at random moments: tap the ground with the beak (single pecks, two or three in a row, now and then while walking too, leaning into each one), hop up a little with a flap of the wings, or just stretch and flap them. It all comes from the shared clock, so every player sees the same (`js/farm/animals.js`).
- **Health:** an animal left hungry for a day gets weak (it never dies). Fed again it recovers.
- **Farm Store** (across the road): talk to the farmer behind the counter (**E**). His menu: purchase animals, sell farm products, purchase animal feed (₹2), farming supplies (coming with crop fields) and construction materials (🪵 wood ₹6, 🪨 stone ₹8). You can walk inside.
- **Fish Market** (east of the Market, set back from the road; follow the 🐟 sign): a Chinese junk run aground — its hull, three masts with batten sails, flags and red paper lanterns — with a red supply store in front of it under green-tiled roofs, on a plank deck with a jetty, bamboo poles, crates, jars and an anchor on its chain (the *Shipwrecked Chinese Supply Store* model, see *Credits*). The fisherman stands in the store behind its stall window, under the *FISH MARKET* sign; walk onto the deck and talk to him (**E**) to buy worms, buy or upgrade your fishing rod, sell fish and see the farm's fish collection. See [Fishing](#fishing) below.
- **Customer orders** (the **Orders** tab at the Market, or the farmer's menu; look for the 📜 ORDERS sign): customers ask for a mix of what your farm can make — eggs, milk and the fish your rods catch, sized to your farm — and pay **25 % more** than the normal price (and never less for a busy Market). One order at a time: after you deliver one (everything at once, from the farm storage), the next arrives 30–60 minutes later, up to **3 a day**. A day ends at **midnight India time** for everyone in the world. Deliver at least one order a day for **5 days in a row** and get a **₹200 bonus** on the 5th day (again on the 10th, 15th…); miss a day and the streak starts again. Any member can deliver; an order is paid once.
- **Market** (next to the store): the selling hall — sell eggs, milk, wood, stone and gold coins (today's prices: selling a lot at once lowers them, see *Farm level* below), see the price board and the farm's trade log (who bought, sold, built or upgraded what).
- **Farm storage** (end of the walkway): store the logs and stones you collect (chopping trees, rockfalls, crates) — logs become 🪵 wood. It also sets how much the farm can hold: level 1 holds 60 of each egg, 30 of each milk, 500 feed / wood / stone. **Upgrade** it level by level up to **level 8** (10× level 1): level 2 ₹600 · 80 wood · 40 stone, level 3 ₹2,000 (farm level 4), level 4 ₹5,000 and 5 gold (farm level 6) … level 8 ₹60,000 and 80 gold (farm level 20). Two players pressing Upgrade at once upgrade it only once.
- **While nobody plays:** fed animals keep producing until their feed runs out. When anyone opens the world, the server works out what happened since, using its own clock, for up to a week of absence. Goods stop at the storage limit, so sell before it fills up.
- **Safe for a group:** every purchase, sale, feeding, build, gate and upgrade is checked by the server against the shared money and goods. Two members buying at the same moment can't spend the same money; a double click or a retry after a lost connection never does anything twice.
- **The bag and the order slip:** two floating buttons (under the map on phones, bottom-right on computers). The **bag** shows the farm's money on its badge (a dot means animals are hungry or eggs are waiting) and opens the **Farm Notebook** (**N**) — a spiral notebook listing the money, feed, produce, wood and stone, the animals, your rod and worms, the fish and the team's materials. The **order slip** (**O**) is a paper copy of today's order, so you don't have to walk back to the Market: what you already have enough of is ticked and crossed out, what's still missing stays on top with how many more you need; its badge counts the missing items (a green tick when everything is ready to deliver). Horse rental requests are on it too. The **Zombie Trail menu** (start screen and Esc menu) is a riveted survival plate: hazard tape, a dripping toxic-green title, a mission briefing, blood-orange *Play solo* and army-green co-op buttons, the keys as a *field manual* and the *survival rules* as a short list. The farm's **popups** (Farm Store, Market, Fish Market, plots, shelters, troughs, storage) and the small plot panel use the same look: a barn-red sign header, cream paper, a farmer speech bubble, menu cards, and a shelter's numbers as tiles (animals, eggs ready, next egg, fed for, feed) above one row per animal. The **start menu's Farm World tab** uses the same signboard look: your saved worlds as cards (code, your name, members, who's playing, **Play**), then one form at a time for another world — **Create**, **Join with invite** or **Log in** (an invite link or a world code in the address opens the right one). The **Esc menu** is a farm signboard: the world's name, code (copy button) and last save on a barn-red sign; **Back to the farm**, Sound / Music / Full screen; *Your farm* at a glance (money, animals, eggs and milk per hour, feed — red when animals are hungry); the *Farmhands* (owner / host badges, playing or offline, Remove); Invite a friend, Mic and Sync; log out / delete; and the farm's keys. Animals walk around their pens the same way on every player's screen.
- **No gun in Farm World:** there are no zombies on the farm, so the shotgun button and **G** are left out. The health bar only shows when you're hurt.

### Farm level, XP and missions

The farm has a **level** (⭐ in the top bar: the level and an XP bar; click it, or *Farm level* in the Farm Store). The rules are in [`js/farm/progression.js`](js/farm/progression.js), shared with the server.

- **XP:** almost everything the farm does earns XP — selling (1 XP per ₹20), customer orders (25 XP and more), collecting eggs, feeding, catching fish, harvesting wheat, making flour, gold from the mine, building and upgrading, buying animals, renting horses. A small "+XP" rises from the chip after an action.
- **Missions:** each level has 2–3 missions as well (collect eggs, earn money at the Market, deliver orders, catch fish, feed the animals, get milk, harvest wheat, make flour, collect gold, upgrade something, rent horses, have so many animals) — the first levels teach the farm, later ones are picked for what the farm has, sized to the level and counted from when the level began.
- **Level up:** with the XP and every mission done the chip glows and the goal card says so; a player presses **Level up** for the reward (₹150 × the new level, and gold coins from level 2) and the next level's missions. Leftover XP carries over. Every level asks a bit more XP than the last (100, 303, 580 … 3981 at level 10 … 12068 at level 20) — they never run out.
- **What levels unlock:** the panel shows what the next level opens — Goats and goat sheds (2), Brown Desi hens and the first fields (3), cows and the storage's level 3 (4), horses (5), Black hens, the black & white cow and manured soil (6), the black cow and the gold mine's level 5 (8), the golden hen and rich soil (10), and every shed's next levels on the way. A world from before the farm level started at the level its sales had earned (at most 12).
- **The Market's demand:** selling a lot of one thing at once lowers its price (each one a little cheaper, down to 35 %); it comes back by half every 3 hours. The Market shows today's price. **Customer orders always pay the full price and 25 % more**, so they're the best buyers.
- **Gold coins** have plenty of uses now: the flour machine and the machines' upgrades, sheds' and the storage's higher levels, improving a field's soil, **ripening a field at once** (1 coin for every 20 minutes still to grow), the black & white cow (₹2,500 and 6 gold) and the black cow (₹4,500 and 15 gold), the golden hen (30 gold), and selling them at the Market (₹90 each, less when you sell many at once).

### The big windmills

On the open meadow east of the road, between the farm and the river, stands a tall Dutch smock windmill (about 18 m to the cap, the sails reaching 26 m), on the map as *Windmill*: an octagonal two-storey base of cream plaster with timber corner posts on a stone footing — an arched door with a fanlight, arched windows and small windows, a ladder up the side — a railed gallery all round on V-shaped struts, a boarded storey with shuttered windows, the tall tapering smock of weatherboards with blue-grey corner trims flaring out at the bottom, a rounded grey ribbed cap, the tail pole with its struts, and four big lattice sails (two orange-red, two blue-grey) that turn slowly — the same for every player, from the shared clock. Its windows light up at night. You bump into the base. **Climb up:** at the foot of the ladder press **E** — you climb up and step onto the gallery through a gap in the railing; walk all the way round it (the railing keeps you from falling) and take in the view over the fields and the farm; press **E** at the gap to climb back down.

Its twin stands beside the goat field across the road from the Farm Store, with Sonpur behind it (where a little wooden windmill used to be), its sails toward the road — the same mill, ladder and gallery.

### Wheat fields

Round the big windmill are **six fenced fields** of plowed earth, each with a signboard at its gate (*FIELD 3 · FOR SALE · ₹500*, *Needs water*, *Ripe in 1h 12m*, *READY TO HARVEST*). Press **E** at a field for its panel.

- **Buy a field** — it's the farm's for good. Each one costs more than the last and comes with a higher farm level: ₹500 and ₹800 (farm level 3), ₹1,500 (5), ₹2,500 (7), ₹4,000 (9), ₹6,000 (12). **Improve its soil** from the field's panel: *manured soil* (₹1,500 and 3 gold, farm level 6) gives 25 % more wheat, *irrigated rich soil* (₹4,000 and 10 gold, farm level 10) 50 % more and grows a quarter faster. A growing field can be **ripened at once with gold** (1 coin for every 20 minutes left). **You can tell your fields from far away:** a field for sale is rough, unplowed grassy land with weeds, wild flowers and stones, its sign bare wood with a red *FOR SALE* band. Once bought it's plowed, its sign is painted green with gold trim, and it gets an **arch over the gate** with your farm's name on a green board (*FARMING CULTURE ✦ FIELD 4 ✦*) and two **lanterns** hanging from the arch that light up at night (confetti when you buy it). Your fields are also on the big map (**M**).
- **Seeds:** one **bag of 100 wheat seeds (₹10)** sows a whole field — at the Farm Store (*Fields, seeds & scarecrows*) or from the field's panel.
- **Sow:** press *Start sowing*, then **walk all over the field scattering the seeds** — hold **Space** (or **F** / the mouse; the **SOW** button on a phone) while you walk. Seeds fly from your hand and show in the soil where you've been; after **10 seconds** of sowing the field is sown (the server checks it took that long).
- **Water** it (₹20) — the earth turns dark and wet — and the wheat grows on the shared clock for **2 hours** (also while nobody plays): seeds → little shoots → half grown → tall and golden, swaying in the wind.
- **Harvest:** about **500 wheat**, into the farm storage, which holds **1000 wheat** at level 1, 1500 at level 2 and so on; what doesn't fit waits in the field. Wheat will be used for more later.
- **Crows** come down and peck at a field without a scarecrow: a harvest is only **350–450 wheat**. A **scarecrow (₹500)** — a pumpkin head under a pointed hat, a brown coat, straw hands, two crows on its arms — keeps most of them off (**400–450**); dressed up to **level 2 (₹800)** — a red patched coat, a rope belt, a bigger hat — every grain is yours (**500**). Buy them at a field or at the Farm Store.
- **Farmer outfit (₹1000, Farm Store → Clothes):** a wide straw hat, a work shirt and long denim overalls with the legs turned up. It's yours once bought (with the farm's money); put it on or take it off any time, and everyone sees you in it.
- More crops (vegetables…) come later: a crop is a catalog entry on the server plus its models in `js/farm/crops.js`.

### Gold coins, the gold mine and the flour machine

**Gold coins** are the farm's second money (next to the rupees, which don't change): shared by every member, made by the gold mine (and level-up rewards), and spent on the machines, the higher levels of the sheds and the storage, fields' soil, ripening a field at once and the golden hen — or sold at the Market (see *Farm level*). The mine has a **level 5** too (*Deep shaft*: a coin every 20 minutes of the night, 50 gold, farm level 8). The farm panels and the Farm Notebook show the farm's gold.

- **The gold mine** (south of the windmill, *Gold mine* on the map): a rocky outcrop with a timber-framed tunnel and a GOLD MINE sign, a mine cart on rails, an ore conveyor, crates, barrels, gems, a pickaxe, a dynamite plunger and a lantern — and the blue mining machine on a steel platform with a coin box in front. Every farm has it at level 1. It **runs by itself from 7 PM to 4 AM (India time)** and never by day (it's noisy): the stones and pulleys turn, the machine shakes, sparks fly, smoke puffs, the beacon flashes, the cart rolls in and out of the tunnel and ore rides the conveyor; at 4 AM it all winds down. No fuel, feed or anything else. It makes **1 gold coin every 120 / 90 / 60 / 30 minutes** of running at level 1 / 2 / 3 / 4 (about 4.5 / 6 / 9 / 18 a night); unfinished work at 4 AM carries on the next night. Coins wait in the box (you see them pile up) — press **E**: the panel shows its status, the night shift on a 24-hour bar with *now* marked, the progress and the time to the next coin, the coins waiting; **Collect** (the coins fly to you) and **Upgrade** (level 2: 5 gold — a bigger hopper and motor; level 3: 12 — a second grinding stage and a cyclone separator; level 4: 25 — a bigger chamber with gold bands, an exhaust stack, a gold funnel). Each level is a visibly bigger machine.
- **The flour machine** ("Aata Chakki", across the road from the Farm Store, *Flour mill* on the map): a plank platform under a tin lean-to with wheat sheaves and sacks on one side and a pallet for flour sacks on the other. **Buy it once for 10 gold** — one for the whole farm. It turns wheat from the farm storage into **packets of wheat flour (10 kg each)**, a separate item in the storage (500 packets at storage level 1, +500 a level) that sells at the Market (₹2 a packet).
  - **Level 1 — traditional stone mill:** put wheat in (by tens), then **turn the millstone by hand**: hold **Space** (or **F** / the mouse; **TURN** on a phone) — your player leans on the handle and turns, the stone goes round, flour dust falls. One turn takes **15 seconds** and grinds up to 100 wheat. **10 wheat → 2 packets**; it takes at most **500 wheat an hour**.
  - **Level 2 — electric (5 gold):** a motor, a belt, an automatic hopper and a chute: it **grinds by itself**, **10 wheat → 3 packets**, 500 wheat an hour.
  - **Level 3 — industrial (10 gold):** a steel frame, a closed grinding chamber, a bigger hopper — **1000 wheat an hour**.
  - **Level 4 — advanced (18 gold):** two motors, a little silo, two chutes — **1000 wheat every 30 minutes**.
  - **Level 5 — high-capacity (30 gold):** twin grinding chambers, three output pipes, big bins, a control panel — **2000 wheat every 30 minutes**.
  - The machine takes at most its capacity per window (hour or half hour, by the India-time clock); when it's full the panel says when it takes more again. Wheat in the machine is never lost: it waits until it's ground. Packets wait in the tray (sacks pile up on the pallet) until someone collects them.
- **Getting there:** the mine pays for itself quickly — the flour machine after about two nights, the mine's level 2 after one; everything at top level after about two weeks of nights.
- **Fair for everyone:** the farm server works it all out from its own clock (also while nobody plays), with the world locked for each action, so two players can never collect the same coins, buy the machine twice or spend the same gold; a repeated tap or a reconnect never counts twice.

### Thieves and guard dogs

- **Thieves come for eggs left in the nests.** When more than **40 eggs** are waiting in the nest boxes, a thief notices — the game warns you (*“a thief has noticed them! Collect them soon”*) — and comes **8–25 minutes later**, unless the eggs have been collected by then. He takes as many as he needs: a random 30–80 % of the waiting eggs, from the coop with the most. At most **3 thieves a day**, 90 minutes apart. Everything is decided by the farm server, also while nobody is playing.
- **Playing when he comes:** an alarm and a red banner — *“Thief! He is sneaking up to your chicken coop (plot 2)”* — and a thief marker on the map. You see him (a white-and-black striped shirt, a black beanie and eye mask, a brown sack) come out of the jungle behind the coop, crouch at its back wall filling his sack, then run off behind the coops into the trees (about 70 seconds in all). Every player in the world sees the same thief.
- **Catching him — the net:** run after him; within 14 m a meter shows a needle sweeping across a bar with a **very thin green mark**. Press **F** (or click; the big red **NET** button on a phone) when the needle is on the mark. Throw on the run — standing still the mark is half as wide. **Three throws** per thief: a hit sends the spinning net over his head, it opens, drops round him and pulls tight — he's caught, and the eggs come back **with 10 % extra** (into the storage; what doesn't fit goes back into the nests). Three misses and he puts on speed and is gone. If another player catches him, everyone sees him trapped.
- **Not playing:** the eggs are gone. When you come back, a report comes first — *“While you were away: 2 thieves came…”* — with each raid's time, the eggs taken, what your dog saved, or who caught him.
- **Guard dogs** (Farm Store → *Guard dogs*): German Shepherds, **₹1000** each, **2 at most**. A dog guards only while it's **on duty** — fed with a **bone** (₹5, 4 hours) or a **treat** (₹25, a whole day — cheaper than six bones); both are under *Buy feed* and in the Farm Notebook. A new dog arrives on duty for 4 hours; a hungry dog sleeps in front of its kennel at the west end of the walkway. On duty they patrol the walkway, and when a thief comes they run to his coop and bark at him. **Feed a dog at its kennel:** walk up to the kennel and press **E** — its panel shows whether it's on duty (and how long) or asleep, **Give a bone / Give a treat**, **Buy 1** right there when the storage is out, and training. The fed dog runs to its bowl, lies down and chews (everyone sees it), then goes back to its patrol.
  - **Level 1** — a young dog: cute and friendly, tongue out, tail always wagging. Saves **40 %** of what a thief takes.
  - **Level 2** (training **₹1500**) — a spiked collar; stands strict and focused. Saves **70 %**, and thieves come at most **twice a day**.
  - **Level 3** (training **₹2000**) — a golden collar and a black tactical vest; brows down, teeth showing, well trained. Saves **95–100 %**, and a thief comes at most **once a day**.
  - With two dogs on duty both count (two level-1 dogs save 64 %). If the dogs save everything, the thief runs off with nothing.

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

Behind the Market and the Fish Market lies **Sonpur**, a small village where 27 people live their everyday lives (see *Sonpur's villagers* below). A dirt lane leads in from behind the Market past the village sign; the fishing path is the main street and runs through the village to the docks, and lanes branch off east and west.

- **The square:** a paved square on the main street with a well in the middle (a round wall of bevelled blue-grey stones in staggered courses, timber posts with gable trusses, a roof of overlapping clay tiles, a winch with the rope and bucket, a crank), benches round it, a fruit stall with a striped awning, lamps, pots and barrels. The **village hall** with its bell turret stands on its north side.
- **19 houses, all different:** red-tile, thatch, blue and brown roofs (gable, hip, saltbox, pyramid and round cone roofs); walls of logs, stone blocks, boards, timber frame, mud and plaster; one and two storeys, stone foundations, porches with steps, balconies, chimneys, side annexes, round mud huts and a stone tower house. Windows (square, arched, shuttered, round, barred), doors and window boxes vary, and some doors have a lantern.
- **The ivy cottage (Lata Kutir):** an L-shaped storybook cottage — a steep gable front of rough cream stone round an arched stone doorway, the gable above in dusty-pink plaster with dark timbers, an attic window and heavy barge boards; a lower side wing with a timber band, windows, a slatted vent and a round window in its gable; both roofs covered in big rounded clay tiles; ivy climbing the gable, along the wall top and down the corners; a hanging flower basket, a thin chimney pipe, a raised vegetable bed with tomatoes on stakes, lettuces and clay pots, a spade and a pitchfork against the wall, and a tan picket fence.
- **Name plates:** every house has a carved wooden name board on a post at its garden gate, facing the lane: the house's name (Sharma Niwas, Lata Kutir, Shanti Niwas…) and its number — **01, 02 … counted out from the square**, then **S** (one floor) or **D** (two floors), e.g. *SHARMA NIWAS · 03/D*. The village hall's says *PANCHAYAT BHAWAN*. They're readable at night too. The game keeps a list of these addresses (with each gate and door), and `village.findHouse(3 | '03/D' | 'Sharma Niwas')` finds a house — for missions that send you to a house.
- **A garden for every house:** a stepping-stone path from the door to the lane and two beds — white and yellow flowers, sunflowers, cabbages, tomatoes and carrots, bushes or fruit trees, some in neat rows, some wild — behind a picket fence, a wooden fence, a low stone wall or a hedge, with flower pots by the door and a bench or a water barrel.
- **Animals:** six houses keep animals in a small fenced pen beside the house — chicken coops on stilts, goat lean-tos, an open cow shed, a horse shelter, each with feed and water troughs. They are the farm's own animals and move the same way (pecking hens that flap now and then, goats that eat at the troughs and butt heads, a cow and a horse that wander, lower their heads to graze and swish their tails), but they belong to the village: you can't feed them or collect anything — the villagers do.
- **Around the houses:** wood piles, four-wheeled farm wagons (spoked wheels with iron tyres, slatted sides on stakes, long shafts; loaded with hay, crates, or barrels under a canvas with a lantern), haystacks, clotheslines, cooking fires, sheds, tables with stools, pots, street lamps along the lanes, and trees between the houses. You bump into the houses, the animal pens, the well, the stall, lamps, carts, sheds, haystacks, benches and trees; you can walk into the gardens.
- **Steps and porches are solid:** walk up the front steps of any house onto its porch or its stone foundation (and the plinth of the round huts), and back down again.
- **Sit anywhere:** every bench (on the square, in the gardens, by the green), charpai and table stool has **Sit on the bench** (E) — sit and take in the view; E again to get up. The garden benches face out over the garden and the lane, not at the house. A seat a villager is using is taken.
- **At night** the house windows glow, the lanterns and street lamps come on and the cooking fires flicker, with the same shared India-time clock as the rest of Farm World.
- **The carrot farm and the archway house:** across the docks path from Poly View Farm, facing the path, two more homes from models (see *Credits*), each on levelled ground with a dirt path from the docks path to its door. The **carrot farm** (*Viking Carrot Farm*): a timber house with a steep teal-tiled roof and crossed gable beams on its own patch of grass and flowers, carrot beds behind, baskets and a spilled bucket of carrots, a wood stump with an axe, a sheep at the fence, rabbits, crows on the roof and a round shield by the door; its windows glow at night. The **archway house** (*Medieval Toon House*): a tall half-timbered tower house with a slate roof, a chimney and a weathervane, a wing on stilts and a balcony, and an annex with a stone **archway you can walk through** (the path runs on through it), with a lantern on an iron bracket that lights up at night. Both are solid, and both are on the map.
- **Poly View Farm:** at the village's edge, west of the path to the fishing docks, stands a whole farmstead — the *Low Poly Farm V2* model (see *Credits*): a big red barn with a sweeping roof, a cupola and a rooster weathervane, its doors open and a horse looking out of a side window; a porch along one side with two benches, a door and a lantern; a fenced yard with an arch over the gate (*POLY VIEW FARM*, with a skull on top), a windmill, pines, a raised bed of corn and one of pumpkins with a scarecrow between them, a green tractor, hay bales and rocks. A dirt lane leads from the docks path through the gate (a lamp beside it) to the barn. Three cows (one of each kind), three pigs (one a piglet) and three hens live in the yard: the cows wander and graze, the pigs root about with quick nods and twitching tails, the hens peck. Walk in through the gate, look round the yard and **sit on the porch benches** (E). The barn, the fence, the beds, the tractor and the rest are solid; the ground under the farm is levelled. It's on the full map as *Poly View Farm*.
- **On the map:** the lanes, the square and every house (in its roof colour) are drawn on the minimap and the full map, with a marker for Sonpur.
- Everything is placed the same way for every player: the layout comes from fixed rules (`js/village/layout.js`), so nothing is sent over the network.

### Sonpur's villagers

**27 people** live in Sonpur — 13 adults (one of them the night watchman), 6 old people and 8 children — each in one of the houses, each with a look of their own (skin, height and build, hair, clothes: kurtas, shirts, dhotis, saris and blouses, frocks and shorts, vests, scarves, turbans, caps, straw hats, veils; grey hair, moustaches, beards and glasses on the old, some with walking sticks) and a role: farmers, animal keepers, woodcutters, a water carrier, people looking after the house, the fruit seller at the stall, and the chowkidar (night watchman).

- **Adults** water and hoe the vegetable beds, weed, pick fruit, feed the hens from a bowl of grain, look after the goats, the cow and the horse (some carry hay on their heads), pull water from the well and carry it home (a bucket, or a clay pot on the head), chop firewood and carry the bundle home on the shoulder, fork hay, hang out washing, cook at the outdoor hearths, sweep the garden path, shop at the stall and carry the basket home, visit each other's gates, walk round the village, sit outside with a glass of tea. The seller keeps the stall in the morning and the late afternoon and talks with whoever comes to buy.
- **Children** play **football** on the village green at the north-west end of the village (a low wooden fence with a gate, goals at both ends, light chalk lines and a centre circle, benches for watchers): 3–5 of them, two or three matches a day. The ball is kicked, rolls and slows down — it never jumps from child to child; the nearest child runs to it and plays it on (passes, dribbles, shots that go in, go wide or get stopped), a goal gets a cheer and a kick back to the middle, and now and then they stop for a breather. They also play tag (one runs, one chases; when caught they swap and run the other way), sit in a ring playing a clapping game, hop, run round, sit together, watch the football and walk places in pairs.
- **Old people** sit on the square's benches, on garden benches and on the **charpais** (rope cots) put out beside some houses, talk on a bench together, walk slowly (a stoop, short steps, a stick), and come to watch the children play.
- **Together:** people meet on a lane, at a garden gate or on the square, stop, turn to each other and chat, taking turns to talk (hands moving, heads nodding) — three at a time on the square in the evening; old people sit side by side and talk; children play together. Meetings happen now and then, not all the time.
- **Their day** follows India time (IST): up with the sun; gardens, animals, water and sweeping in the early morning; work round the houses; lunch indoors around midday, then rest; work, visits and games in the afternoon; walking, cooking, the last feed and gatherings in the evening; then home — the children first (from about 6:40 PM), then the old, then the adults — until by about 9:30 PM everyone is indoors except the watchman. People go in and out of their houses through the day.
- **The night watchman** (a turban, a woollen shawl, a lathi): from about 7:30 PM to 5:30 AM he walks the whole village with a lit hurricane lantern — its glow lights the lane round him — along every lane to its end and back, past the square and the green, about 20 minutes a round. At each lane end he stops, holds the lantern up, looks round, taps his stick and blows his whistle, and calls *“Jaagte raho!”* (stay alert) if you're close. He sleeps through the morning and is about the village in the afternoon. His round depends only on the clock, so it carries on unbroken past midnight and every player sees him in the same place.
- **How they move:** the steps come from the distance really walked (no sliding); children run with long strides, old people walk slowly; they turn smoothly (with small steps when turning on the spot), sit down and get up, squat to weed, raise a hoe, swing an axe, kick a ball. They follow the lanes and garden paths (a waypoint graph that keeps clear of houses, gardens, pens and props), keep to the left on the lanes, step round each other and round players, look at you when you come close, and you can't walk through them.
- **The same for everyone:** what everybody does all day is planned from the day number, and where they are comes from the shared clock (the one the animals and the sky use), so all the players in a world see the same village — and nothing is sent over the network for it.

### Football on the village green

- **Walk onto the green** and press **E — Play football**. On your own the match starts at once: **you and a village keeper (Blue)** against **two village kids — a forward and a keeper (Red)**.
- **With friends online** you pick the teams first: *you and a friend vs the village kids*, *you vs a friend* (each with a village kid in goal), *two of you vs one friend and a village keeper*, *you alone vs two friends*, or two against two with four players. Two a side: a village kid takes every place nobody plays, and a kid who plays with one player keeps goal.
- **Playing:** run onto the ball to dribble it, **F** (or click) to **shoot** the way you face, **E** to **pass** to your team-mate, **Q** to leave. On a phone: **KICK**, **PASS** and the leave button.
- **The match:** three minutes, kick-off from the centre spot; the ball rolls and slows down, bounces, comes off the posts, the bar and the fence and ends up in the net. A goal stops play — *GOAL!*, a cheer from the watchers — and everyone goes back for a kick-off by the team that let it in. A referee's whistle starts and ends it; the scoreboard shows the score and the clock.
- **The village kids** play properly: the keeper stays on his line, follows the ball, comes out for a slow ball and clears or rolls it to his team-mate (a hard shot sometimes beats him); the forward chases the ball, dribbles it up the pitch and shoots. The kids in the match wear their team's colour, and a ring of the team's colour shows everyone's side.
- **Watchers:** old people sit on the benches by the green and turn their heads to follow the ball; other children stand along the fence and watch.
- **Multiplayer:** the player who starts the match runs it (the ball and the kids are worked out on their screen and sent to the others 15 times a second); the others send their kicks to them. If they leave, the match ends; if you leave, a village kid takes your place.

### Day and night (real India time)

Farm World follows the **real time in India (IST)**. The sun's position comes from the date, the time and the world's place on Earth (the Maikal hills of central India), so sunrise and sunset move with the seasons — in early November about 6:10 AM and 5:25 PM, in June about 5:20 AM and 6:50 PM. The time is on the top bar, with a sunrise, sun, sunset or moon icon.

- **Morning:** soft golden light from the east, long shadows to the west, a warm horizon.
- **Day / afternoon:** a bright blue sky; the sun moves across it, and the shadows turn and shorten toward midday.
- **Evening:** orange and pink light from the west, long shadows to the east, the sky darkening.
- **Night:** stars and a moon, cool moonlight. Lamps come on one by one from sunset and go off after sunrise: lanterns at the Farm Store, the Market and the Fish Market, lit windows (all of Sonpur's houses too), the village lamps and cooking fires, the night watchman's lantern going round the village, lamps at every pen gate and shelter, street lamps along the walkway and the fish path, and flickering **torches** (flambeaux) at the farm's sign, the walkway, the Market, the Fish Market, the trailhead and the camp. Inside the Farm Store the ceiling lamps light the room.
- **Together:** everyone in a world sees the same sky — it uses the farm server's clock (the same one the animals use), not each computer's clock, and nothing extra is sent over the network. Opening the game later shows the right time of day at once.

**Sounds and wildlife** (`js/ambience.js`, `js/birds.js`, all synthesized — no audio files): at night a cricket chorus with single crickets close by, toads trilling (more near the river) and now and then a distant owl; in the morning lots of birdsong, fewer birds later in the day. Two or three birds circle high over you and a few sit on the tops of nearby jungle trees (now and then one flies to another tree); they roost at night. Near the river you hear the water; at the docks while fishing the water laps, little bubbles rise and fish splash as they jump. Footsteps are soft: grass, gravel on the road, hollow knocks on the docks and the RV floor. Walk up to the pens and the hens cluck (“buk-buk… ba-gawk!”) and the goats bleat — from where the animals are, louder the closer you get, right away when you arrive and then now and then (more when several are close; hens mostly sleep at night). Inside the RV the outside sounds are muffled. The RV itself sounds like a big diesel van: the starter cranks, then a deep, low rumble that rises with speed and load.

**Farm music** (`js/music.js`, synthesized): a gentle country tune — finger-picked "boom-chick" guitar under a whistled melody, a banjo-like pluck the second time round, then the guitar alone for a while, with a soft shaker in the daytime; at night it plays quieter, guitar only. It follows Sound on / off and has its own **Music on / off** button in the Esc menu (Farm World only, remembered on this device).

Zombie Trail keeps its zombie nights (the campaign decides when it is dark); they now have stars, a moon and lit torches too.

The settings are at the top of `js/day-night.js` (`DAY_NIGHT`): the time zone (`Asia/Kolkata`), latitude / longitude, fixed sunrise / sunset times as a fallback (`solar: 'fixed'`), and the weather inputs (clouds, fog, haze, lightning, gloom) that the real weather sets. **Testing other times** (only on your own computer — `localhost`): add `?time=17:30` to the address (optionally `&date=2026-06-21` and `&speed=60` to run the clock 60× faster), or call `__game.dayNight.setTime('22:00')` in the console (`setTime(null)` goes back to the real time). It changes only the light on that screen, never the farm's clock.

### Real weather and air quality

Farm World shows the **real weather and air quality where the weather leader is** — the same for everyone in the world. The time of day still follows India (above); the weather only adds clouds, rain, fog, haze, wind and thunder on top of it.

- **The weather leader** is the first player to join the live game. Their game asks once: *Bring your real weather to the farm?* — **Use my location** (the browser asks for permission; once allowed, it's used without asking again), **Choose a city** (search by name), or **Not now** (the farm keeps its weather and isn't asked again). If location is turned off in the browser, the city search opens instead. Other players never see the location — only the leader's name, or the city's name if one was picked. The leader can change it any time from the weather panel.
- **When the leader leaves**, they keep the job for 2 minutes (the game's reconnect window — a reload or a dropped connection doesn't change anything). After that the player who joined next takes over automatically and is asked for their place; until they share it, the last weather stays.
- **What you see:** sunny, partly cloudy (drifting low-poly clouds), overcast (grey sky, dimmer softer light), rain and heavy rain (falling rain, darker clouds, the ground darkening and puddles filling on roads and flat ground, rings on the puddles, rain sounds), thunderstorms (lightning bolts, the sky flashing, thunder a few seconds later — the same flashes for everyone), fog (shorter view, soft light) and wind (trees, bushes and grass sway harder, leaves fly on a strong wind, the wind's sound rises and falls). Snow is not shown for now (a snowy place shows as overcast).
- **Air quality (AQI)** makes the air hazy: a dusty yellow-brown veil and a dimmer, warmer sun that grows with the AQI category — Good (clear), Satisfactory (very slight), Moderate (visible haze), Poor, Very Poor, Severe (heavy haze, much shorter view). The AQI is **India's National AQI (CPCB)**, worked out from the pollutant levels (PM2.5, PM10, NO₂, SO₂, O₃, CO). Haze and weather fog are separate: the stronger one decides how far you see, the weaker only adds a little. No air-quality data → no haze (nothing is made up).
- **On screen:** a chip in the top bar (icon, temperature, AQI in its category colour); tap it for the details — condition, feels-like, humidity, wind, clouds, rain, visibility, sunrise / sunset there, AQI with its category and PM2.5 / PM10, where the weather comes from, when it was updated. A short message when the leader changes, the weather turns (rain starts, the sky clears…) or the AQI category changes.
- **How often:** the farm server asks the weather service at most once an hour per world (one request for all four players), and only while someone is playing. When the service is down the last weather stays (marked in the panel) and it tries again after 2, 4, 8 … minutes.
- **Data:** weather by [Open-Meteo.com](https://open-meteo.com) (CC BY 4.0), air quality from Copernicus CAMS through Open-Meteo (model data, so it can differ from a nearby monitoring station).

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
- `js/terrain.js`, `js/world.js`, `js/obstacles.js` – map, jungle, road blocks. The ground is painted by the terrain's shader from the world position: the grass is the *Generic grass* texture (`models/floor/generic_grass/game-grass.jpg`, see *Credits*; one tile every 4.5 m), and it never visibly repeats — each spot takes the texture at one of eight offsets chosen by a slow noise, blended into the next, with a broad light / dark variation over it; then light tan dirt patches plus small spots of bare soil with frayed edges, the village's lanes and square — no seams. The **road** is painted on the ground too, with the *Rocky Ground* gravel texture (`models/floor/rocky_ground_tile_texture/game-rock.jpg`, see *Credits*; one tile every 3 m, repeated the same way) and two faint wheel tracks: every ground corner carries its signed distance to the road's middle, so the road's edge is a smooth, gently waving blend into a trodden verge — no zig-zag along the ground's triangles. Until the textures have loaded the grass is the old painted meadow (soft, roughly hexagonal patches in close lime shades) and the road packed earth. `js/grass.js` grows wild flowers around the player — white daisies and yellow flowers with chunky flat petals and broad leaves at the base, lit softly with a gentle daylight glow, swaying, pressed down around your feet — in little groups (never on dirt, roads, river banks, cliffs, farm pens, paths, rocks, bushes or tree trunks); how far they reach follows the graphics quality. Pebbles, grey faceted rocks with little stones beside them (you bump into the bigger ones) and round bright bushes are scattered as instanced meshes (half as many on phones)
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
- `js/farm/progression.js` – the farm's long game, shared with the server: the farm level (XP per level, rewards, XP and counters per action), the missions, animals' care levels, sheds' levels, the Market's demand (`server/src/progress.js` keeps each world's level, XP and missions)
- `js/farm/` – Farm World: server address (`config.js`), API calls (`api.js`), logins kept on this device (`logins.js`), the session that hosts / joins / saves / hands over the world (`farm.js`), start-menu screens (`menu.js`), Esc-menu members panel (`panel.js`); the farm: plot / store layout (`layout.js`), small props (`props.js`), models (`models.js`), the farmer (`npc.js`), farm in the world + animals + gates (`farmland.js`), shared money, goods and production timers (`economy.js`), store / market / storage / plot / shelter / feeding popups, the production panel (`farmui.js`), the floating bag / order-slip buttons, the Farm Notebook and the Order Slip (`notebook.js`)
- `js/village/` – Sonpur village (Farm World): where it is, its lanes and how the houses are placed along them (`layout.js`), the houses and the hall (`houses.js`), the ivy cottage (`cottage.js`), Poly View Farm (`farmstead.js`), the carrot farm and the archway house (`modelHomes.js`), the gardens and garden plants (`gardens.js`), the animal pens (`animals.js`), the well, carts, haystacks, clotheslines, fires, sheds, the stall and other props (`props.js`), and building it all into the world (`index.js`); the villagers: their bodies, clothes and looks, posed on the graphics card (`characters.js`), their poses — walking, running, sitting, talking, working (`animations.js`), the waypoint graph (`navigation.js`), the day's timetable (`schedule.js`), the things they do together and the football (`interactions.js`), planning everybody's day and moving them each frame (`ai.js`), and the football matches you play (`football.js`)
- `js/farm/machines/` – the industrial machines: the rules and arithmetic shared with the server (`machineProduction.js`), the models (`machineModels.js`), the gold mine (`mining.js`) and the flour mill (`flour.js`) in the world, the manager — prompts, hand-turning, particles, sounds (`machines.js`) — and their panels (`machineUI.js`); the server side is `server/src/machines.js`
- `js/weather/` – Farm World's real weather: the rules shared with the server (`rules.js`: conditions, what each looks like, India AQI from pollutants, haze per AQI category, refresh settings), the effects (`effects.js`: drifting clouds, GPU rain, puddles and wet ground, lightning, wind, fog and haze), keeping in step with the server and the other players, and the leader's location (`sync.js`), the chip, panel and questions (`ui.js`); the server side is `server/src/weather.js`
- `js/farm/fields.js`, `js/farm/crops.js`, `js/farm/scarecrow.js` – the six crop fields by the windmill (plowed ground, fences, signs, sowing, watering, crows), the crops and their growth stages, the scarecrows and crows; the server side is `server/src/fields.js`
- `js/farm/dutchmill.js` – the big Dutch windmill (one on the meadow east of the road, its twin by the goat field; their sails turn with the shared clock, you can climb onto the gallery)
- `js/farm/guide.js` – the goal card in Farm World: what needs doing now, and the farm's next step
- `js/farm/thieves.js`, `js/farm/dogs.js` – thieves (the thief on his way, the alarm and banner, the net meter and throw, the trap, the report when you come back) and guard dogs (three looks by level, kennels, patrols, barking at a thief); the server decides both (`server/src/thieves.js`)
- `js/fishing/` – fishing: the challenge rules shared with the server (`sim.js`), rods / fish / docks models (`models.js`), the Fish Market (the ship model, its deck, walls and fisherman), the docks, path and water life in the world (`area.js`), the mini-game, HUD and other players' lines (`fishing.js`), the Fish Market screens (`marketui.js`) and their 3D pictures (`thumbs.js`)
- `js/baked.js` – loading a textured model baked by `tools/bake-textured.mjs` (`models/<name>/game.bin` and its `game-<k>.jpg` textures): one mesh per material, drawn with the game's lighting, windows that glow brighter at night (`dayNight.addGlow`). `tools/bake-textured.mjs` makes them from each model's glTF (`node tools/bake-textured.mjs [name]`): turned, scaled and moved into the game's frame, unwanted parts left out (the ship's island, water ring and sky disc), positions, normals and texture coordinates as 16-bit / 8-bit numbers, the textures made smaller with macOS `sips` (and the ground's grass and road textures in `floor/`) — the Fish Market's ship is 1.3 MB instead of 13 MB
- `models/low_poly_farm_v2/` – the *Low Poly Farm V2* model (glTF, its colour palette, its licence) and `farmstead.bin`, its farm baked for the game; `js/farm/polyAnimals.js` – its pig, baked; `js/farm/polyRig.js` – unpacking the model animals and giving them moving legs, neck and tail. `tools/bake-polyfarm.mjs` makes the two baked files from the model (`node tools/bake-polyfarm.mjs`): every triangle gets the palette colour under it, positions are stored as 16-bit numbers (777 KB instead of the model's 4.5 MB), the ground slab and the animals are left out of the farm (the animals are live), and the gate's leaf is swung right open so you can walk in
- `models/low_poly_fat-tailed_sheep_3d_model/`, `models/cows/`, `models/horses/`, `models/chickens/` – the goat's, cows', horses' and hens' models (glTF, their textures, their licences); `js/farm/goatModel.js` (100 KB), `cowModels.js` (300 KB), `horseModels.js` (300 KB) and `chickenModels.js` (110 KB) – baked from them, unpacked and rigged by `js/farm/polyRig.js` (legs and knees, a neck that bends down to graze or peck, a hen's wings, the tail; the recoloured coats in `VARIANTS`). `tools/bake-animals.mjs` makes them (`npm i --no-save meshoptimizer@0.21.0`, then `node tools/bake-animals.mjs [goat|cows|horses|chickens]`): the meshes placed by their nodes (a skinned mesh posed by its skeleton), the textures' seams joined, simplified (4,000 triangles for the goat, cows and horses, 1,400–1,600 for the hens — the rooster from 86,334), every triangle given the colour under it (averaged in linear light), turned to face +z and scaled (the horses 2 m to the ears, the hens 0.55–0.62 m)
- `server/` – the Farm World server (Cloudflare Worker + NeonDB): API, migrations, tests, setup and deploy steps in [`server/README.md`](server/README.md)

## Performance

- The jungle is drawn with instanced meshes split into chunks of about 78 m: chunks off the screen are skipped, and so are chunks wholly beyond the fog (they would only be drawn in the fog's colour). Farm World's cleared trees are taken out of the lists, not just hidden. A typical Farm World frame is about 1 million triangles (it was 1.8 million) in ~400 draw calls; Sonpur's meshes are skipped the same way from far off.
- Frame rate is capped (60, or 30 on Low). With no keys or mouse for 25 s the game drops to 15 fps (Zombie Trail solo) or 30 fps (Farm World, alone), and to 30 fps while the window is behind another app — unless friends are in the world or a football match is on. It stops rendering while paused or while the bridge designer is open.
- All zombies together are drawn with 7 instanced meshes, so 20 zombies cost about the same as one. At most 24 are around at once.
- Network traffic is small: player snapshots only carry players that changed (plus a full one each second), 10 zombie snapshots per second, and RV / bridge updates only while they move. Voice uses one small audio link per pair of players (Opus), and sends silence while your mic is off.
- Slow links don't fall behind: when a link has a lot of data waiting, position and state snapshots for it are skipped (the next one replaces them) instead of piling up, and network timers run on real time, so a slow phone still sends its updates on time.
- Voice links check themselves: a link whose network path stays down, or that brings no sound while that player's mic is on, is remade. In each pair only one player rings, so the other one asks over the game connection when it has no working link.
- Quality menu (top-right): **Low** (no shadows, shorter view distance, 30 fps), **Medium**, **High**.
- Sonpur's 27 villagers are two instanced meshes (adults, children) posed on the graphics card, plus the ball and the watchman's lantern (a lamp that moves: its halo and one of the pool's real lights follow it): about 5 extra draw calls with shadows (3 on phones). Their whole day is planned once (about 30 ms, again at midnight); each frame costs well under a millisecond, poses far away are worked out less often, and nothing is done for them when nobody is near the village.
- The Fish Market's ship (24k triangles, one 2048 px texture), the carrot farm (57k triangles, two 1024 px textures) and the archway house (1k triangles) are a few meshes each, fetched when Farm World opens and skipped from far off.
- The ground's grass and the road's gravel are one 1024 px texture each (570 KB and 404 KB, fetched once); a ground pixel reads one of them twice (both only along the road's edge). The road has no mesh of its own any more.
- Poly View Farm is one mesh of 40k triangles (one draw call, skipped from far off like the village's); its file is fetched when Farm World opens and drawn when it arrives — nothing waits for it.
- Sonpur village is built once when you enter Farm World and merged into a few meshes per 32 m area (one per material), with the garden plants and trees as instanced meshes: about 40 extra draw calls and 200k triangles in view. Phones grow fewer garden flowers, and the garden flowers are a lighter model than the wild ones.
- Day and night cost almost nothing: the sky, stars and moon are a few draw calls, all lamp halos are one instanced mesh, all torch flames another and their smoke a third. About 70 lamps share a small pool of real lights (2 on Low, 4 on Medium, 6 on High) that follow the lamps nearest to you; nothing is created while playing, and sunlight shadows aren't drawn while the sun and moon are both below the horizon.

## Credits

- **The road's gravel:** This work is based on "Rocky Ground| Tile Texture" (https://sketchfab.com/3d-models/rocky-ground-tile-texture-bedc7b5b9b304406a39ea936439fc937) by CATholic (https://sketchfab.com/CATholic) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Changes: only its colour texture is used, made smaller, repeated over the road without showing the repeat.
- **The ground's grass:** This work is based on "Generic grass" (https://sketchfab.com/3d-models/generic-grass-58f3852680bb428b942a45410c0c4bcf) by Aartee (https://sketchfab.com/Aartee) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Changes: only its colour texture is used, made smaller, repeated over the ground without showing the repeat.
- **The Fish Market:** This work is based on "DAE Villages | Shipwrecked Chinese Supply Store" (https://sketchfab.com/3d-models/dae-villages-shipwrecked-chinese-supply-store-af2da248227c4dac96fc2570e58e26da) by kennethtzh (https://sketchfab.com/kennethtzh) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Changes: baked into the game's own format with smaller textures, its island, water and sky disc left out.
- **The carrot farm:** This work is based on "Viking Carrot Farm" (https://sketchfab.com/3d-models/viking-carrot-farm-a5f9fd422a3a4ee58ed1b1c3db7dafb7) by Tom Verbeeck (https://sketchfab.com/VerbeeckTom) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Changes: baked into the game's own format with smaller textures.
- **The archway house:** This work is based on "Medieval Toon House" (https://sketchfab.com/3d-models/medieval-toon-house-b8954be2359c43958c381a0972452319) by guillemvilah (https://sketchfab.com/guillemvilah) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Changes: baked into the game's own format, turned and scaled.
- **The bay horse:** This work is based on "Low poly Horse Brown Colour 3d Model Free" (https://sketchfab.com/3d-models/low-poly-horse-brown-colour-3d-model-free-9073d1dfc345495a88ef84eed4d2a9e5) by iRahulRajput (https://sketchfab.com/rt699448) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Changes: simplified to 4,000 triangles, its texture baked into a colour per triangle, scaled, and given moving legs, a neck, a head and a tail.
- **The black horse (and the white one):** This work is based on "Horse free download" (https://sketchfab.com/3d-models/horse-free-download-9b77bb7542354b10bb7b4c6a25866724) by pgonarg (https://sketchfab.com/pgonarg) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Changes: simplified to 4,000 triangles, its textures baked into a colour per triangle, scaled, given moving parts; recoloured grey-white for the white horse.
- **The chestnut horse (and the golden and spotted ones):** This work is based on "Horse" (https://sketchfab.com/3d-models/horse-86d47bdcd5ab41238ba44547e4d21f9c) by kenchoo (https://sketchfab.com/kenchoo) licensed under **CC-BY-NC-SA-4.0** (http://creativecommons.org/licenses/by-nc-sa/4.0/) — non-commercial use only, and the baked copy of it in `js/farm/horseModels.js` is shared under the same licence. Changes: posed by its skeleton, simplified to 4,000 triangles, its texture baked into a colour per triangle, scaled, given moving parts (the game's own, not the model's animation); recoloured gold and with white patches for the golden and spotted horses.
- **The white hen (and the golden one):** This work is based on "fantasy chicken animation" (https://sketchfab.com/3d-models/fantasy-chicken-animation-f2b473b72a4048f7b45bc116a00547a3) by hino (https://sketchfab.com/Slava251114) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Changes: posed by its skeleton, simplified to 1,400 triangles, its texture baked into a colour per triangle, scaled, given moving legs, neck and wings; recoloured gold for the golden hen.
- **The desi hen:** This work is based on "Chicken Rig" (https://sketchfab.com/3d-models/chicken-rig-b92464211274439b955700e3aa5c321f) by FourthGreen (https://sketchfab.com/FourthGreen) licensed under **CC-BY-NC-4.0** (http://creativecommons.org/licenses/by-nc/4.0/) — non-commercial use only. Changes: posed by its skeleton, its texture baked into a colour per triangle, scaled, given moving legs, neck and wings.
- **The black rooster:** This work is based on "GA Free_551_Majestic Rooster" (https://sketchfab.com/3d-models/ga-free-551-majestic-rooster-d49b48eb00194101a3b110d1c533c77a) by Galaxy Abundant (https://sketchfab.com/galaxyabundant) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Changes: simplified from 86,334 to 1,600 triangles, its texture baked into a colour per triangle, scaled, given moving legs, neck and wings.
- **The goat:** This work is based on "Low poly Fat-tailed sheep 3d model" (https://sketchfab.com/3d-models/low-poly-fat-tailed-sheep-3d-model-26ffe611e5da46c1a353947058d4a8ca) by iRahulRajput (https://sketchfab.com/rt699448) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Changes: simplified to 4,000 triangles, its texture baked into a colour per triangle, scaled, and given moving legs, a neck and a tail; it is the farm's goat.
- **The brown cow:** This work is based on "Cow" (https://sketchfab.com/3d-models/cow-99d333e3b4e4470a8d7d38436489c001) by Josué Boisvert (https://sketchfab.com/JosueBoisvert) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Changes: simplified to 4,000 triangles, its texture baked into a colour per triangle, scaled, and given moving legs, a neck and a tail.
- **The black & white cow:** This work is based on "Cow Idle" (https://sketchfab.com/3d-models/cow-idle-16493ce34a4f41a6ba7b7d31032317c1) by kenchoo (https://sketchfab.com/kenchoo) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Changes: its standing pose simplified to 4,000 triangles, its texture baked into a colour per triangle, scaled, and given moving legs, a neck and a tail (the game's own, not the model's animation).
- **The black cow:** This work is based on "Cow Skin" (https://sketchfab.com/3d-models/cow-skin-f79f2bc987f94c9ead02a36844e7c48b) by GSCreations (https://sketchfab.com/gscreations2508) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Changes: simplified to 4,000 triangles, its textures baked into a colour per triangle, scaled, and given moving legs, a neck and a tail.
- **Poly View Farm and the pig:** This work is based on "Low Poly Farm V2" (https://sketchfab.com/3d-models/low-poly-farm-v2-0e91a96ca6ee44569cf94972e30b5be4) by EdwinRC (https://sketchfab.com/Edwin3D) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Changes: baked into the game's own format, the ground slab and the animals taken out of the farm, the gate swung open, and the pig given moving legs, a neck and a tail.
