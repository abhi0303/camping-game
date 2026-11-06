# Farm World server

A small API for the game's **Farm World** mode. It runs as a **Cloudflare Worker** and keeps everything in **NeonDB** (PostgreSQL). The game itself stays on GitHub Pages.

The browser never talks to the database: only this Worker does, with the database password kept in Worker secrets.

What it stores:
- **Worlds** (rooms), each with a 6-character code and a saved world snapshot.
- **The farm:** shared money, goods, shelters, animals, and every purchase, sale and build (`room_transactions`). Prices and rules live in the `catalog` table.
- **Members:** up to 4 per world. Each has a name and a PIN, and the first one is the owner.
- **Logins:** one per device, stored as hashes.
- **Invites:** one use, valid for 72 hours.
- **Live session:** who is hosting right now (their PeerJS id) and who is online.

## API

| Endpoint | Who | What |
|---|---|---|
| `GET /v1/health` | anyone | server + database check |
| `POST /v1/rooms` | anyone | create a world: `{ name, pin, world }` → `{ token, room, member }` |
| `POST /v1/rooms/:code/login` | anyone | `{ name, pin }` → `{ token, room, member }`; 5 wrong PINs lock that member for 15 min |
| `POST /v1/rooms/:code/invites` | owner | one-time invite code (while the world has fewer than 4 members) |
| `GET /v1/rooms/:code/invites/:invite` | anyone | preview an invite (world name, member count) |
| `POST /v1/rooms/:code/join` | anyone | `{ invite, name, pin }` → become a member |
| `GET /v1/rooms/:code` | member | world info, members (with online state), who hosts |
| `DELETE /v1/rooms/:code/members/:id` | owner | remove a member (their logins end) |
| `POST /v1/rooms/:code/logout` | member | end this device's login |
| `DELETE /v1/rooms/:code` | owner | delete the world, `{ confirm: "<world name>" }` |
| `POST /v1/rooms/:code/session` | member | open the world: `role: host` (+ saved world) or `role: guest` (+ host's PeerJS id + join ticket) |
| `POST /v1/rooms/:code/heartbeat` | host | every 15 s: online members + world snapshot when it changed; `release: true` when leaving |
| `POST /v1/rooms/:code/verify` | host | check a joining player's ticket |
| `GET /v1/rooms/:code/farm` | member | the farm: money, goods, shelters, animals, catalog (counts production up to now first) |
| `POST /v1/rooms/:code/farm` | member | one action with a `requestId`: `buy {item, qty, shelter?}`, `sell {item, qty}`, `build {type, plot}`, `deposit {items: {wood, stone}}`, `feed {shelter, count \| all}`, `upgrade {target: 'storage', level}`, `gate {shelter, open}`, `collect {shelter}`, `cast {spot}`, `reel {cast, log}`, `rod {level}`, `order {order}`, `rent {offer}`, `sellhorse {animal}`, `catch {theft}`, `dog {op: 'buy' \| 'feed' \| 'train', dog?, food?, level?}`, `seen {}`, `field {op: 'buy' \| 'sowstart' \| 'sow' \| 'water' \| 'harvest' \| 'scarecrow', slot, crop?, level?}`, `outfit {op: 'buy' \| 'wear' \| 'off', item?}` |
| `GET /v1/rooms/:code/farm/history` | member | the last 30 purchases / sales / builds / feedings / upgrades, with who did them |
| `POST /v1/admin/migrate` | admin secret | apply database migrations |

Members send `Authorization: Bearer <token>`. Errors look like `{ "error": { "code": "members_full", "message": "…" } }`.

### Who hosts the live game

The first member to open a world hosts it. The others join that host over PeerJS. A new host takes over when:
- the host leaves (it hands the world over as the page closes), or
- its heartbeat stops for 35 s, or
- a player who lost the host can't find it on the PeerJS server any more. A brand-new host gets 10 s to come online first.

Opening the world on a second device moves your own session there. All timing uses the database clock, never the player's device.

### The farm economy

- **One farm per world.** Every action runs in one transaction with the world's row locked (`SELECT … FOR UPDATE`). That means two purchases at the same time are handled one after the other, and `money` can never go below zero (a `CHECK` constraint backs this up).
- **Retries are safe.** Every action carries a `requestId`; a retried id returns the first result instead of running again (`UNIQUE (room_id, request_id)`).
- **Feeding is explicit.** Each animal has `fed_until`. A `feed` action costs `feedCost` feed per animal and moves its `fed_until` `feedHours` later (from now, or from its current time if still fed; at most 24 h ahead). With too little feed, only the hungriest animals that the feed covers are fed.
- **Production is counted lazily.** Whenever the farm is read or changed, the time since `rooms.produced_at` is simulated in steps of up to an hour (at most a week), and `produced_at` moves forward in the same transaction, so the same time is never counted twice. Each step:
  - animals produce only while fed (`fed_until`), scaled by their health, and heal;
  - an animal hungry for more than a day gets weak (never below 10 health);
  - goods stop at the storage limit (catalog `cap` × the storage level's multiplier);
  - chickens (catalog `nest`) lay into their own nest box (`animals.ready`) instead; a full nest stops that chicken. `collect {shelter}` moves the eggs into storage (up to its limit) — with the row locked, two players collecting at once never get the same egg.
- **Chicken timings** (minutes per egg, feeding minutes, feed per feeding, nest size) come from [`src/animals.js`](src/animals.js), applied over the catalog rows when the catalog is read. Changing them needs a deploy; prices stay in the catalog table.
- **Unlocks:** `rooms.total_earned` counts money from sales; an animal with `unlock` in its catalog data can only be bought once the farm has earned that much.
- **Storage upgrades:** the `storage` catalog row lists the levels (`mult`, cost in money / wood / stone). The client asks for a specific level, so two players upgrading at once upgrade once (the second gets `already_upgraded`).
- **Gates:** `buildings.gate_open` keeps each pen's gate open or closed for everyone.
- **Balancing:** change `buy_price`, `sell_price` or the `data` JSON (feed cost, feeding hours, rate, capacity, limits, unlocks, storage levels) in the `catalog` table. No deploy is needed.
- **Fishing** ([`src/fishing.js`](src/fishing.js), rules shared with the game in [`../js/fishing/sim.js`](../js/fishing/sim.js)): `cast` takes a worm and rolls what bites from the member's rod (`room_members.rod_level`), stored in `fishing_casts` with `bite_at`. `reel` gets the player's pull / release log, replays it through the same challenge and only adds the fish if it lands — and not sooner than the time since `bite_at` allows (1.5 s slack), within 3 minutes. A cast is reeled once (`status` leaves `open` under a row lock). `rod {level}` buys the next level with the farm money (catalog `rod.levels`).
- **Orders** ([`src/orders.js`](src/orders.js), settings in `ORDERS` at its top): made lazily when the farm is read — today's first order (India-time day, `farm_orders.day`), and after each delivery the next one with `available_at` 30–60 minutes later, at most 3 a day. Contents come from the farm's animals (their products, a few hours of output, at most half the storage limit) and the fish the members' rods catch; the pay is fixed at creation (value + 10 %). `order {order}` checks the goods, takes them, pays, and updates `rooms.order_streak` / `order_streak_day` (the first delivery of a day counts; every 5th day in a row adds ₹200). Yesterday's open orders become `expired`.
- **Horses** ([`src/horses.js`](src/horses.js), settings in `HORSES`): catalog rows `horse_*` (colour, `foal` / `buy` prices, `rent` per 2 h, `grow` levels an hour). `buy {item, qty, age: 'foal'}` buys babies (Level 1); `animals.level` grows with `progress` while fed (in `simulate()`), up to 10. Rental requests (`horse_rentals`) are made lazily when the farm is read, at most one open at a time and one every 60–120 minutes (`rooms.next_rental_at`), only while there are free Level 10 horses. `rent {offer}` pays the farm, marks the horses `rented_until` (fed until then) and picks the asked-for colour, or the plainest horses for "any"; `sellhorse {animal}` sells one at its level's price (not while it is out on rent).
- **Crop fields, scarecrows and outfits** ([`src/fields.js`](src/fields.js), migration 9): six fields (`farm_fields`, slots 0–5) by the windmill, bought once (catalog `field`, ₹500). A field goes `empty` → `sowing` (`field {op: 'sowstart'}`: needs a seed bag of the crop in storage; records who and when) → `sown` (`sow`: the same member, at least `sowS − 1.5` s later; uses 1 bag) → `growing` (`water`: costs the crop's `water` rupees; ready `growH` hours later) → `harvest` (into storage up to the limit; the rest waits in the field) → `empty`. Crops are catalog rows `crop_<id>` (`seed`, `product`, `sowS`, `water`, `growH`, `yield`) — wheat: ₹10 a bag of 100 seeds, ₹20 to water, 2 h, 500 wheat. The harvest is decided at the first harvest by the field's scarecrow then (catalog `scarecrow`: no scarecrow 70–90 % of the yield, level 1 (₹500) 80–90 %, level 2 (₹800) 100 %). Wheat's storage limit grows by `capStep` (1000, 1500, 2000…) instead of the storage multiplier. Outfits (catalog kind `outfit`, `farmer_outfit` ₹1000) belong to the member who bought them (`room_members.outfits`, `outfit` = the one worn); the game shows the worn one to everyone.
- **Thieves and guard dogs** ([`src/thieves.js`](src/thieves.js), settings in `THIEVES`): when more than `threshold` (40) eggs wait in the nests, `rooms.thief_due_at` is set 8–25 minutes ahead; if the eggs are still there at that moment a raid happens (at most 3 a day — 2 / 1 with the best dog on duty at level 2 / 3 — and 90 minutes apart). It's worked out inside `settle()`, hour by hour through the time since the farm was last opened (so raids happen while nobody plays too), with the world's row locked. A raid (`farm_thefts`) takes 30–80 % of the waiting eggs from the fullest coop, minus what the dogs on duty save (catalog `guard_dog.levels[].cut`: 40 %, 70 %, 95–100 %; several dogs multiply). It is `live` from `at` to `escape_at` (sneaking up, stealing, running away, about 70 s): `catch {theft}` during that time gives the eggs back with 10 % more (into the storage, the rest back into the nests), once. After that it is `stolen` (or `scared` when the dogs saved everything). Guard dogs (`farm_dogs`, at most 2): `dog {op: 'buy'}` (₹1000, arrives on duty for 4 h), `dog {op: 'feed', dog, food: 'bone' | 'dog_treat'}` (a bone +4 h, a treat +24 h from the farm storage, at most 48 h ahead), `dog {op: 'train', dog, level}` (₹1500 to level 2, ₹2000 to level 3, in order). `seen {}` marks the theft reports read for this member (`room_members.thefts_seen_at`; the game shows the unread ones when you come back).
- **Logs and stones from the world** are reported by the players and can't be checked by the server. Deposits are limited to 50 of each per request and 150 per member per minute.

## Set up and deploy

You need a free Cloudflare account and the Neon connection string.

```bash
cd server
npm install
npx wrangler login                        # or set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
```

Set the secrets. Each command asks for the value; nothing is written to the repo.

```bash
npx wrangler secret put DATABASE_URL      # postgresql://…neon.tech/neondb?sslmode=require
```

```bash
npx wrangler secret put SERVER_SECRET     # a long random string
```

```bash
npx wrangler secret put ADMIN_SECRET      # another long random string
```

Deploy. It prints the address, like `https://rv-van-api.<you>.workers.dev`.

```bash
npx wrangler deploy
```

The database tables are created (and later updated) by the first request after a deploy; a database lock makes sure only one instance does it. To do it by hand anyway, replace the URL and secret with yours:

```bash
curl -X POST https://rv-van-api.<you>.workers.dev/v1/admin/migrate -H "Authorization: Bearer <ADMIN_SECRET>"
```

**Updating the server later:** pull the new code, then deploy again (from the `server` folder). The new tables appear on their own.

```bash
git pull && npx wrangler deploy
```

Finally, put the Worker address in `js/farm/config.js` (`DEPLOYED`) and push. The game shows "Farm World is not switched on yet" until that address is set.

Migrations live in `src/migrations.js`. Never change one that has already run; add a new one. `DATABASE_URL=… npm run migrate` applies them from your own computer too.

## Develop and test locally

You need a local Postgres.

```bash
npm test                                   # TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres
```

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5432/rvfarm npm run dev    # API on http://127.0.0.1:8787
```

Then open the game from `localhost` with `?api=http://127.0.0.1:8787`. That override only works on pages opened from your own computer.

To run the real Neon driver inside Cloudflare's local runtime against a plain Postgres:
1. Start `node scripts/local-wsproxy.mjs 8899`.
2. Put `DATABASE_URL=…?sslmode=disable` and `NEON_LOCAL_WSPROXY=127.0.0.1:8899/v1` in `.dev.vars`.
3. Run `npx wrangler dev`.
4. Run the tests against it with `TEST_API_URL=http://127.0.0.1:8787 TEST_DB_URL=… npm test`.

## Limits (free plans)

- **Cloudflare Workers free:** 100,000 requests a day and about 10 ms of CPU per request. A world being played uses about 4 requests a minute.
- **Neon free:**
  - The database sleeps after about 5 minutes without use. The first request after that takes about a second longer.
  - Storage is 0.5 GB, and compute hours each month are limited.
- **Rate limits:** login, join and create are rate-limited per IP address, best effort in each Worker's memory. PINs are properly protected by the lockout after 5 wrong tries.
- **The world snapshot comes from the host's browser.** The server checks its shape and size and who may send it, but it can't check every detail of the world. Money and goods will be validated on the server when the economy is added.
