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
