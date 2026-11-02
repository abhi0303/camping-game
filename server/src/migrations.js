// Database migrations, applied in order and recorded in schema_migrations.
// Never edit a migration that has run on the real database: add a new one instead.
// Run with `npm run migrate` (DATABASE_URL in the environment) or POST /v1/admin/migrate.

export const MIGRATIONS = [
  {
    id: 1,
    name: 'rooms_members_invites',
    sql: `
CREATE TABLE rooms (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{6}$'),
  name           TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 32),
  world          JSONB,                                  -- shared world snapshot saved by the host
  world_rev      INTEGER NOT NULL DEFAULT 0,             -- +1 on every saved snapshot
  world_saved_at TIMESTAMPTZ,
  host_member_id UUID,                                   -- who hosts the live (PeerJS) session now
  host_peer      TEXT,                                   -- the host's PeerJS id for this session
  host_epoch     INTEGER NOT NULL DEFAULT 0,             -- +1 every time a new host takes over
  host_since     TIMESTAMPTZ,
  host_seen_at   TIMESTAMPTZ,                            -- last host heartbeat
  online         UUID[] NOT NULL DEFAULT '{}',           -- members in the live session (from the host)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_played_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE room_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seat         SMALLINT NOT NULL CHECK (seat BETWEEN 0 AND 3),     -- 4 seats = at most 4 members
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 16),
  pin_salt     TEXT NOT NULL,
  pin_hash     TEXT NOT NULL,
  is_owner     BOOLEAN NOT NULL DEFAULT false,
  failed_pins  SMALLINT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  UNIQUE (room_id, seat)
);
CREATE UNIQUE INDEX room_members_name_key ON room_members (room_id, lower(name));
CREATE UNIQUE INDEX room_members_one_owner ON room_members (room_id) WHERE is_owner;
ALTER TABLE rooms ADD CONSTRAINT rooms_host_member_fk FOREIGN KEY (host_member_id) REFERENCES room_members(id) ON DELETE SET NULL;

CREATE TABLE member_tokens (
  token_hash   TEXT PRIMARY KEY,                       -- sha-256 of the login token (the token itself is never stored)
  member_id    UUID NOT NULL REFERENCES room_members(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX member_tokens_member_idx ON member_tokens (member_id);

CREATE TABLE room_invites (
  code_hash  TEXT PRIMARY KEY,                         -- keyed hash of the invite code
  room_id    UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  created_by UUID REFERENCES room_members(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_by    UUID REFERENCES room_members(id) ON DELETE SET NULL,
  used_at    TIMESTAMPTZ
);
CREATE INDEX room_invites_room_idx ON room_invites (room_id);
`,
  },
  {
    id: 2,
    name: 'farm_economy_animals',
    sql: `
-- the world's shared money, and how far animal production has been counted (database clock)
ALTER TABLE rooms
  ADD COLUMN money       BIGINT NOT NULL DEFAULT 500 CHECK (money >= 0),
  ADD COLUMN econ_rev    INTEGER NOT NULL DEFAULT 0,          -- +1 on every economy change (clients compare)
  ADD COLUMN produced_at TIMESTAMPTZ NOT NULL DEFAULT now(),  -- production is settled up to this time
  ADD COLUMN feed_eaten  DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (feed_eaten >= 0 AND feed_eaten < 1);  -- part of the next feed unit already eaten

-- prices and rules (change rows here to balance the economy; no code change needed)
CREATE TABLE catalog (
  item       TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('animal', 'good', 'building')),
  name       TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT '',
  buy_price  INTEGER CHECK (buy_price > 0),       -- NULL = can't be bought
  sell_price INTEGER CHECK (sell_price > 0),      -- NULL = can't be sold
  data       JSONB NOT NULL DEFAULT '{}',
  sort       SMALLINT NOT NULL DEFAULT 0
);
INSERT INTO catalog (item, kind, name, icon, buy_price, sell_price, data, sort) VALUES
  ('chicken',   'animal',   'Chicken',    '🐔', 40,  NULL, '{"feed": 0.25, "product": "egg", "rate": 0.5, "shelter": "coop"}', 1),
  ('goat',      'animal',   'Goat',       '🐐', 150, NULL, '{"feed": 0.5, "product": "goat_milk", "rate": 0.25, "shelter": "goat_shed"}', 2),
  ('cow',       'animal',   'Cow',        '🐄', 400, NULL, '{"feed": 1.0, "product": "cow_milk", "rate": 0.5, "shelter": "barn"}', 3),
  ('horse',     'animal',   'Horse',      '🐴', 600, NULL, '{"feed": 0.75, "shelter": "stable"}', 4),
  ('feed',      'good',     'Animal feed','🌾', 2,   NULL, '{"cap": 500}', 10),
  ('egg',       'good',     'Eggs',       '🥚', NULL, 6,   '{"cap": 60}', 11),
  ('goat_milk', 'good',     'Goat milk',  '🥛', NULL, 30,  '{"cap": 30}', 12),
  ('cow_milk',  'good',     'Cow milk',   '🍼', NULL, 25,  '{"cap": 30}', 13),
  ('wood',      'good',     'Wood',       '🪵', 6,   3,    '{"cap": 500}', 14),
  ('stone',     'good',     'Stone',      '🪨', 8,   4,    '{"cap": 500}', 15),
  ('coop',      'building', 'Chicken coop','🏠', 100, NULL, '{"wood": 20, "stone": 0, "capacity": 6, "animal": "chicken"}', 20),
  ('goat_shed', 'building', 'Goat shed',  '🛖', 250, NULL, '{"wood": 40, "stone": 0, "capacity": 4, "animal": "goat"}', 21),
  ('barn',      'building', 'Cow barn',   '🏚', 500, NULL, '{"wood": 60, "stone": 20, "capacity": 3, "animal": "cow"}', 22),
  ('stable',    'building', 'Horse stable','🐎', 600, NULL, '{"wood": 60, "stone": 20, "capacity": 2, "animal": "horse"}', 23);

CREATE TABLE inventory (
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  item    TEXT NOT NULL REFERENCES catalog(item),
  qty     BIGINT NOT NULL DEFAULT 0 CHECK (qty >= 0),
  PRIMARY KEY (room_id, item)
);

CREATE TABLE buildings (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id  UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  type     TEXT NOT NULL REFERENCES catalog(item),
  plot     SMALLINT NOT NULL CHECK (plot >= 0),
  level    SMALLINT NOT NULL DEFAULT 1,
  x        REAL NOT NULL,
  z        REAL NOT NULL,
  yaw      REAL NOT NULL DEFAULT 0,
  built_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, plot)
);

CREATE TABLE animals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id            UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  type               TEXT NOT NULL REFERENCES catalog(item),
  shelter_id         UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  health             REAL NOT NULL DEFAULT 100 CHECK (health BETWEEN 0 AND 100),
  hunger             REAL NOT NULL DEFAULT 0 CHECK (hunger BETWEEN 0 AND 100),
  progress           DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (progress >= 0),   -- part of the next product
  born_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_fed_at        TIMESTAMPTZ,
  last_production_at TIMESTAMPTZ
);
CREATE INDEX animals_room_idx ON animals (room_id);
CREATE INDEX buildings_room_idx ON buildings (room_id);

-- every purchase / sale / build / deposit; request_id makes retries safe (the same request never runs twice)
CREATE TABLE room_transactions (
  id          BIGSERIAL PRIMARY KEY,
  room_id     UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  member_id   UUID REFERENCES room_members(id) ON DELETE SET NULL,
  request_id  TEXT NOT NULL,
  kind        TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}',
  money_delta BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, request_id)
);
CREATE INDEX room_transactions_room_time_idx ON room_transactions (room_id, created_at DESC);
`,
  },
];

const LOCK_ID = 727001;   // advisory lock: two migrate runs never overlap

// pool: anything with connect() -> client.query() (node-postgres or Neon)
export async function migrate(pool, log = () => {}) {
  const c = await pool.connect();
  const applied = [];
  try {
    await c.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const done = new Set((await c.query('SELECT id FROM schema_migrations')).rows.map(r => r.id));
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      log(`applying migration ${m.id} ${m.name}`);
      try {
        await c.query('BEGIN');
        await c.query(m.sql);
        await c.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [m.id, m.name]);
        await c.query('COMMIT');
        applied.push(m.id);
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      }
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    c.release();
  }
  return applied;
}
