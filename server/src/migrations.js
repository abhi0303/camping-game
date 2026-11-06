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
  {
    id: 3,
    name: 'feeding_varieties_storage',
    sql: `
-- plot rows are now 21 m apart (they were 14 m with 13 m deep plots: the two rows' gates and signs met)
UPDATE buildings SET z = CASE WHEN plot < 4 THEN -189 ELSE -168 END;

-- feeding: an animal is fed until a time (each feeding = feedHours); nothing is eaten automatically any more
ALTER TABLE animals ADD COLUMN fed_until TIMESTAMPTZ;
UPDATE animals SET fed_until = now() + interval '2 hours';
UPDATE rooms SET feed_eaten = 0;

-- each pen has a gate that players open and close (shared by everyone in the room)
ALTER TABLE buildings ADD COLUMN gate_open BOOLEAN NOT NULL DEFAULT false;

-- money earned from sales (unlocks premium animals) and the farm storage level (raises the storage limits)
ALTER TABLE rooms
  ADD COLUMN total_earned  BIGINT NOT NULL DEFAULT 0 CHECK (total_earned >= 0),
  ADD COLUMN storage_level SMALLINT NOT NULL DEFAULT 1 CHECK (storage_level >= 1);
UPDATE rooms r SET total_earned = COALESCE((SELECT sum(t.money_delta) FROM room_transactions t WHERE t.room_id = r.id AND t.kind = 'sell'), 0);

ALTER TABLE catalog DROP CONSTRAINT catalog_kind_check;
ALTER TABLE catalog ADD CONSTRAINT catalog_kind_check CHECK (kind IN ('animal', 'good', 'building', 'upgrade'));
UPDATE catalog SET name = 'Chicken', data = '{"feedCost": 1, "feedHours": 2, "product": "egg", "rate": 0.5, "shelter": "coop", "variety": "Regular"}', sort = 1 WHERE item = 'chicken';
UPDATE catalog SET data = '{"feedCost": 2, "feedHours": 2, "product": "goat_milk", "rate": 0.25, "shelter": "goat_shed"}', sort = 4 WHERE item = 'goat';
UPDATE catalog SET data = '{"feedCost": 3, "feedHours": 2, "product": "cow_milk", "rate": 0.5, "shelter": "barn"}', sort = 5 WHERE item = 'cow';
UPDATE catalog SET data = '{"feedCost": 2, "feedHours": 2, "shelter": "stable"}', sort = 6 WHERE item = 'horse';
UPDATE catalog SET name = 'Eggs', sort = 11 WHERE item = 'egg';
UPDATE catalog SET sort = 14 WHERE item = 'goat_milk';
UPDATE catalog SET sort = 15 WHERE item = 'cow_milk';
UPDATE catalog SET sort = 16 WHERE item = 'wood';
UPDATE catalog SET sort = 17 WHERE item = 'stone';
INSERT INTO catalog (item, kind, name, icon, buy_price, sell_price, data, sort) VALUES
  ('chicken_brown', 'animal', 'Brown Desi chicken', '🐓', 180, NULL, '{"feedCost": 1, "feedHours": 2, "product": "egg_brown", "rate": 0.5, "shelter": "coop", "variety": "Brown Desi", "unlock": 300}', 2),
  ('chicken_dark',  'animal', 'Dark Desi chicken',  '🐦‍⬛', 450, NULL, '{"feedCost": 1, "feedHours": 2, "product": "egg_dark", "rate": 0.4, "shelter": "coop", "variety": "Dark Desi", "unlock": 1500}', 3),
  ('egg_brown', 'good', 'Brown Desi eggs', '🟤', NULL, 14, '{"cap": 60}', 12),
  ('egg_dark',  'good', 'Dark Desi eggs',  '⚫', NULL, 35, '{"cap": 60}', 13),
  ('storage', 'upgrade', 'Farm storage', '📦', NULL, NULL,
   '{"levels": [{"level": 1, "mult": 1}, {"level": 2, "mult": 2, "money": 600, "wood": 80, "stone": 40}]}', 30);
`,
  },
  {
    id: 4,
    name: 'egg_every_hour',
    sql: `
-- every chicken (white, Brown Desi, Dark Desi) lays one egg per hour while fed (was one per 2 h / 2.5 h)
UPDATE catalog SET data = data || '{"rate": 1}' WHERE item IN ('chicken', 'chicken_brown', 'chicken_dark');
`,
  },
  {
    id: 5,
    name: 'fast_eggs_nests_fishing',
    sql: `
-- chickens now lay every 5 / 7 / 9 minutes (Regular White / Brown Desi / Black; the timings live in
-- server/src/animals.js). Each chicken keeps its eggs in its own nest box until a player collects them.
ALTER TABLE animals ADD COLUMN ready INTEGER NOT NULL DEFAULT 0 CHECK (ready >= 0);
UPDATE catalog SET name = 'Regular White chicken', data = data || '{"variety": "Regular White"}' WHERE item = 'chicken';
UPDATE catalog SET data = data || '{"variety": "Brown Desi"}' WHERE item = 'chicken_brown';
UPDATE catalog SET name = 'Black chicken', data = data || '{"variety": "Black"}' WHERE item = 'chicken_dark';
-- many more eggs, so each one is worth less (a premium chicken still earns more per place in the coop).
-- Eggs already in a farm's storage keep their value: the price drop is paid out to that farm once.
UPDATE rooms r SET money = r.money + v.pay FROM (
  SELECT i.room_id, sum(i.qty * GREATEST(0, c.sell_price - n.price))::bigint AS pay
  FROM inventory i JOIN catalog c ON c.item = i.item JOIN (VALUES ('egg', 1), ('egg_brown', 3), ('egg_dark', 7)) AS n(item, price) ON n.item = i.item
  GROUP BY i.room_id) v
WHERE v.room_id = r.id AND v.pay > 0;
UPDATE catalog SET name = 'White eggs', sell_price = 1 WHERE item = 'egg';
UPDATE catalog SET sell_price = 3 WHERE item = 'egg_brown';
UPDATE catalog SET name = 'Black chicken eggs', sell_price = 7 WHERE item = 'egg_dark';

-- fishing: worms (sold 10 for ₹1), three fish, and a rod per member (Level 1 to start, upgrades for sale).
-- Fish prices: active fishing earns ~₹400/h with the Basic rod and ~₹950/h with the Fibre rod (a good start,
-- but a full farm of chickens earns more, without anyone playing)
ALTER TABLE catalog DROP CONSTRAINT catalog_kind_check;
ALTER TABLE catalog ADD CONSTRAINT catalog_kind_check CHECK (kind IN ('animal', 'good', 'building', 'upgrade', 'gear'));
INSERT INTO catalog (item, kind, name, icon, buy_price, sell_price, data, sort) VALUES
  ('worms',       'good', 'Worms',              '🪱', NULL, NULL, '{"cap": 500}', 24),
  ('worm_pack',   'good', 'Worms (10 per pack)','🪱', 1,    NULL, '{"pack": {"item": "worms", "n": 10}}', 25),
  ('fish_small',  'good', 'Small fish',         '🐟', NULL, 2,    '{"cap": 40, "size": "small"}', 26),
  ('fish_medium', 'good', 'Medium fish',        '🐠', NULL, 5,   '{"cap": 40, "size": "medium"}', 27),
  ('fish_large',  'good', 'Large fish',         '🎏', NULL, 14,   '{"cap": 20, "size": "large"}', 28),
  ('rod', 'gear', 'Fishing rod', '🎣', NULL, NULL, '{"levels": [{"level": 1, "price": 0}, {"level": 2, "price": 150}, {"level": 3, "price": 500}]}', 32);
ALTER TABLE room_members ADD COLUMN rod_level SMALLINT NOT NULL DEFAULT 1 CHECK (rod_level BETWEEN 1 AND 3);

-- every cast: what the server rolled for it, and how it ended (a cast pays out at most once)
CREATE TABLE fishing_casts (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id   UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES room_members(id) ON DELETE CASCADE,
  spot      SMALLINT NOT NULL,
  rod       SMALLINT NOT NULL,
  fish      TEXT REFERENCES catalog(item),          -- NULL: nothing bites
  weight    REAL NOT NULL DEFAULT 0,
  seed      INTEGER NOT NULL,
  pulls     SMALLINT NOT NULL DEFAULT 0,
  cast_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  bite_at   TIMESTAMPTZ,
  status    TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'caught', 'escaped', 'lost')),
  ended_at  TIMESTAMPTZ
);
CREATE INDEX fishing_casts_room_idx ON fishing_casts (room_id, status);
CREATE INDEX fishing_casts_member_idx ON fishing_casts (member_id, status);
`,
  },
  {
    id: 6,
    name: 'market_orders',
    sql: `
-- Market orders: up to 3 a day (India time), one at a time; what each asks for and pays is fixed when it is made
CREATE TABLE farm_orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  day          DATE NOT NULL,                       -- the India-time day it belongs to (it ends at midnight IST)
  n            SMALLINT NOT NULL CHECK (n BETWEEN 1 AND 9),
  customer     TEXT NOT NULL,
  items        JSONB NOT NULL,                      -- [{ item, qty }]
  pay          INTEGER NOT NULL CHECK (pay > 0),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'expired')),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at      TIMESTAMPTZ,
  done_by      UUID REFERENCES room_members(id) ON DELETE SET NULL,
  UNIQUE (room_id, day, n)
);
-- days in a row with at least one delivered order (a bonus every 5th day)
ALTER TABLE rooms ADD COLUMN order_streak INTEGER NOT NULL DEFAULT 0, ADD COLUMN order_streak_day DATE;
`,
  },
  {
    id: 7,
    name: 'horses_levels_rentals',
    sql: `
-- horses in six colours: bought as a baby (data.foal, Level 1) or grown (buy_price, Level 10); a fed horse grows
-- a level every 2 hours (data.grow levels an hour); Level 10 horses are rented out for data.rent per 2 hours
ALTER TABLE animals ADD COLUMN level SMALLINT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 10), ADD COLUMN rented_until TIMESTAMPTZ;
INSERT INTO catalog (item, kind, name, icon, buy_price, sell_price, data, sort) VALUES
  ('horse_bay',      'animal', 'Bay horse',      '🐎', 600,  NULL, '{"shelter": "stable", "feedCost": 2, "feedHours": 2, "grow": 0.5, "maxLevel": 10, "foal": 150, "rent": 50, "variety": "Bay", "tier": "Common", "coat": "#7a4a2a"}', 6),
  ('horse_chestnut', 'animal', 'Chestnut horse', '🐎', 600,  NULL, '{"shelter": "stable", "feedCost": 2, "feedHours": 2, "grow": 0.5, "maxLevel": 10, "foal": 150, "rent": 50, "variety": "Chestnut", "tier": "Common", "coat": "#a0522d"}', 7),
  ('horse_black',    'animal', 'Black horse',    '🐎', 800,  NULL, '{"shelter": "stable", "feedCost": 2, "feedHours": 2, "grow": 0.5, "maxLevel": 10, "foal": 220, "rent": 65, "variety": "Black", "tier": "Uncommon", "coat": "#24211f"}', 8),
  ('horse_white',    'animal', 'White horse',    '🐎', 800,  NULL, '{"shelter": "stable", "feedCost": 2, "feedHours": 2, "grow": 0.5, "maxLevel": 10, "foal": 220, "rent": 65, "variety": "White", "tier": "Uncommon", "coat": "#e6e2da"}', 9),
  ('horse_palomino', 'animal', 'Golden horse',   '🐎', 1100, NULL, '{"shelter": "stable", "feedCost": 2, "feedHours": 2, "grow": 0.5, "maxLevel": 10, "foal": 320, "rent": 85, "variety": "Golden (Palomino)", "tier": "Rare", "coat": "#d9a646"}', 10),
  ('horse_pinto',    'animal', 'Spotted horse',  '🐎', 1100, NULL, '{"shelter": "stable", "feedCost": 2, "feedHours": 2, "grow": 0.5, "maxLevel": 10, "foal": 320, "rent": 85, "variety": "Spotted (Pinto)", "tier": "Rare", "coat": "#f0ece4"}', 11);
-- horses bought before are grown bay horses; a stable now holds 4 (babies need room too)
UPDATE animals SET type = 'horse_bay', level = 10 WHERE type = 'horse';
UPDATE catalog SET data = data || '{"capacity": 4, "animal": "horse_bay"}' WHERE item = 'stable';
DELETE FROM catalog WHERE item = 'horse';

-- rental requests: an offer waits for a player to hand the horses over; then they are away until returns_at
ALTER TABLE rooms ADD COLUMN next_rental_at TIMESTAMPTZ;
CREATE TABLE horse_rentals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  renter      TEXT NOT NULL,
  purpose     TEXT NOT NULL,
  horses      SMALLINT NOT NULL CHECK (horses BETWEEN 1 AND 4),
  variety     TEXT,                                  -- a certain colour (catalog item), or NULL: any horse
  hours       SMALLINT NOT NULL CHECK (hours BETWEEN 1 AND 24),
  pay         INTEGER NOT NULL CHECK (pay > 0),
  status      TEXT NOT NULL DEFAULT 'offer' CHECK (status IN ('offer', 'active', 'done', 'expired')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  returns_at  TIMESTAMPTZ,
  horse_ids   UUID[],
  accepted_by UUID REFERENCES room_members(id) ON DELETE SET NULL
);
CREATE INDEX horse_rentals_room_idx ON horse_rentals (room_id, status);
`,
  },
  {
    id: 8,
    name: 'thieves_guard_dogs',
    sql: `
-- thieves come for eggs left waiting in the nests (server/src/thieves.js); guard dogs (at most 2) keep them off
ALTER TABLE catalog DROP CONSTRAINT catalog_kind_check;
ALTER TABLE catalog ADD CONSTRAINT catalog_kind_check CHECK (kind IN ('animal', 'good', 'building', 'upgrade', 'gear', 'dog'));
INSERT INTO catalog (item, kind, name, icon, buy_price, sell_price, data, sort) VALUES
  ('bone',      'good', 'Dog bones',  '🦴', 5,    NULL, '{"cap": 200, "dogHours": 4}', 12),
  ('dog_treat', 'good', 'Dog treats', '🍖', 25,   NULL, '{"cap": 60, "dogHours": 24}', 13),
  ('guard_dog', 'dog',  'Guard dog',  '🐕', 1000, NULL, '{"max": 2, "hours": 4, "breed": "German Shepherd", "levels": [{"level": 1, "cut": [0.4, 0.4], "raids": 3}, {"level": 2, "cost": 1500, "cut": [0.7, 0.7], "raids": 2}, {"level": 3, "cost": 2000, "cut": [0.95, 1], "raids": 1}]}', 40);
CREATE TABLE farm_dogs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  slot       SMALLINT NOT NULL CHECK (slot IN (0, 1)),
  level      SMALLINT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 3),
  fed_until  TIMESTAMPTZ,                              -- on duty until then
  bought_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, slot)
);
CREATE TABLE farm_thefts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  day        DATE NOT NULL,                            -- the India-time day of the raid
  at         TIMESTAMPTZ NOT NULL,                     -- the thief comes out of the jungle
  steal_at   TIMESTAMPTZ NOT NULL,                     -- reaches the coop and takes the eggs
  escape_at  TIMESTAMPTZ NOT NULL,                     -- gone for good unless caught before
  shelter_id UUID,                                     -- the coop he goes for
  wanted     INTEGER NOT NULL CHECK (wanted >= 0),     -- eggs he meant to take
  taken      JSONB NOT NULL,                           -- { egg: n, ... } what he took
  saved      INTEGER NOT NULL DEFAULT 0,               -- eggs the dogs saved
  dog_level  SMALLINT NOT NULL DEFAULT 0,              -- the best dog on duty (0: none)
  dogs       SMALLINT NOT NULL DEFAULT 0,              -- dogs on duty
  status     TEXT NOT NULL CHECK (status IN ('live', 'stolen', 'caught', 'scared')),
  seed       INTEGER NOT NULL,                         -- his way in and out (the same on every screen)
  caught_by  UUID REFERENCES room_members(id) ON DELETE SET NULL,
  caught_at  TIMESTAMPTZ
);
CREATE INDEX farm_thefts_room_idx ON farm_thefts (room_id, at);
ALTER TABLE rooms ADD COLUMN thief_due_at TIMESTAMPTZ;           -- a thief has noticed the eggs and comes then
ALTER TABLE room_members ADD COLUMN thefts_seen_at TIMESTAMPTZ;  -- this member has read the theft reports up to then
`,
  },
  {
    id: 9,
    name: 'wheat_fields_scarecrows_outfits',
    sql: `
-- six crop fields by the windmill (server/src/fields.js), wheat to start with; scarecrows keep the birds off;
-- outfits for the players
ALTER TABLE catalog DROP CONSTRAINT catalog_kind_check;
ALTER TABLE catalog ADD CONSTRAINT catalog_kind_check CHECK (kind IN ('animal', 'good', 'building', 'upgrade', 'gear', 'dog', 'field', 'crop', 'outfit'));
INSERT INTO catalog (item, kind, name, icon, buy_price, sell_price, data, sort) VALUES
  ('field',         'field',  'Farm field',            '🏞', 500,  NULL, '{"crops": ["wheat"]}', 50),
  ('wheat_seeds',   'good',   'Wheat seed bags',       '🫘', 10,   NULL, '{"cap": 30, "seeds": 100, "crop": "wheat"}', 51),
  ('wheat',         'good',   'Wheat',                 '🌾', NULL, NULL, '{"cap": 1000, "capStep": 500}', 52),
  ('crop_wheat',    'crop',   'Wheat',                 '🌾', NULL, NULL, '{"seed": "wheat_seeds", "product": "wheat", "sowS": 10, "water": 20, "growH": 2, "yield": 500}', 53),
  ('scarecrow',     'gear',   'Scarecrow',             '🎃', 500,  NULL, '{"none": [0.7, 0.9], "levels": [{"level": 1, "share": [0.8, 0.9]}, {"level": 2, "cost": 800, "share": [1, 1]}]}', 54),
  ('farmer_outfit', 'outfit', 'Farmer outfit',         '👒', 1000, NULL, '{"look": "straw hat and denim overalls"}', 55);
CREATE TABLE farm_fields (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id        UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  slot           SMALLINT NOT NULL CHECK (slot BETWEEN 0 AND 5),
  crop           TEXT,                                 -- what's in it (catalog crop_<crop>), NULL when empty
  stage          TEXT NOT NULL DEFAULT 'empty' CHECK (stage IN ('empty', 'sowing', 'sown', 'growing')),
  sow_started_at TIMESTAMPTZ,
  sow_by         UUID REFERENCES room_members(id) ON DELETE SET NULL,
  sown_at        TIMESTAMPTZ,
  watered_at     TIMESTAMPTZ,
  ready_at       TIMESTAMPTZ,                          -- growing: ripe from then
  yield          INTEGER,                              -- decided at the first harvest (after the birds)
  harvested      INTEGER NOT NULL DEFAULT 0,           -- taken so far (the rest waits for room in the storage)
  scarecrow      SMALLINT NOT NULL DEFAULT 0 CHECK (scarecrow BETWEEN 0 AND 2),
  bought_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, slot)
);
ALTER TABLE room_members ADD COLUMN outfits TEXT[] NOT NULL DEFAULT '{}', ADD COLUMN outfit TEXT;
`,
  },
  {
    id: 10,
    name: 'member_invite_permission',
    sql: `
-- the owner can let other members invite friends (and hand the world over: is_owner moves, one owner per world)
ALTER TABLE room_members ADD COLUMN can_invite BOOLEAN NOT NULL DEFAULT false;
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
