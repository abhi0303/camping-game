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
| `POST /v1/rooms/:code/farm` | member | one action with a `requestId`: `buy {item, qty}`, `sell {item, qty}`, `build {type, plot}`, `deposit {items: {wood, stone}}` |
| `GET /v1/rooms/:code/farm/history` | member | the last 30 purchases / sales / builds, with who did them |
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
- **Production is counted lazily.** Whenever the farm is read or changed, the time since `rooms.produced_at` is simulated in steps of up to an hour (at most a week), and `produced_at` moves forward in the same transaction, so the same time is never counted twice. Each step:
  - animals eat from the shared feed;
  - fed animals heal and make goods, scaled by their health;
  - unfed animals get hungry, then weak (never below 10 health);
  - goods stop at the store's limit.
- **Balancing:** change `buy_price`, `sell_price` or the `data` JSON (feed per hour, rate, capacity, limits) in the `catalog` table. No deploy is needed.
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
