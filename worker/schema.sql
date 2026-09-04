-- =====================================================================
-- THE CATALOGUE, ON DISK
--
-- D1 is SQLite, so this is plain SQLite and it is tested against a real
-- one rather than a mock.
--
-- Two decisions are worth explaining, because both are the difference
-- between a catalogue that survives contact with people and one that
-- does not.
--
-- FIRST: a play is a ROW, not a counter. `UPDATE levels SET plays =
-- plays + 1` is one line and it is wrong twice over - a dropped
-- connection double-counts on retry, and one person with a loop counts
-- as a thousand. Plays are rows keyed on a client-generated op id, so
-- sending the same one twice does nothing, and UNIQUE(level_id,
-- player_id, day) means a player contributes at most one play per level
-- per day however many times they open it. `levels.plays` is a total
-- kept in step with those rows, so the sort does not have to count them.
--
-- SECOND: the body of a level lives in its own table. The catalogue
-- listing reads name, stars and play counts for fifty levels at a time
-- and never wants the two kilobytes of cellar attached to each one.
-- Splitting them keeps the listing narrow and means the row a browse
-- reads stays small enough to be cheap.
-- =====================================================================

CREATE TABLE IF NOT EXISTS levels (
  -- a proper uuid, made on the machine that built the level, so a
  -- cellar has the same name for itself everywhere it ever goes -
  -- in the vault, in a pasted code, and here
  id          TEXT PRIMARY KEY,
  owner       TEXT NOT NULL,          -- the author's player id (a key thumbprint)
  owner_key   TEXT NOT NULL,          -- their public key, so edits can be checked
  name        TEXT NOT NULL,
  -- the name with its case and spacing taken out, which is what
  -- uniqueness is actually judged on: "The Long Drop" and "the  long
  -- drop" are the same name to everybody except a database
  name_key    TEXT NOT NULL,
  author_name TEXT,                   -- claimed, and unique - see authors
  author_uuid TEXT,                   -- who made it, as the catalogue says it
  thumb       TEXT,                   -- a small picture of the cellar
  cellar      INTEGER NOT NULL,       -- which depth it is pitched at
  state       TEXT NOT NULL DEFAULT 'private',   -- private | public | hidden
  ever_public INTEGER NOT NULL DEFAULT 0,        -- latches on, never clears
  created     INTEGER NOT NULL,
  edited      INTEGER NOT NULL,
  plays       INTEGER NOT NULL DEFAULT 0,
  rating_sum  INTEGER NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  -- the shrunk average the board is ordered on, kept in step on every
  -- rating so that browsing never has to compute it
  rank_score  REAL NOT NULL DEFAULT 3.5
);

-- the cellar itself, kept away from the listing
CREATE TABLE IF NOT EXISTS level_bodies (
  level_id TEXT PRIMARY KEY,
  body     TEXT NOT NULL,
  FOREIGN KEY (level_id) REFERENCES levels(id) ON DELETE CASCADE
);

-- one row per play that counts. op_id makes a retry harmless; the
-- UNIQUE makes a loop pointless.
CREATE TABLE IF NOT EXISTS plays (
  op_id     TEXT PRIMARY KEY,
  level_id  TEXT NOT NULL,
  player_id TEXT NOT NULL,
  day       TEXT NOT NULL,
  at        INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS plays_one_a_day
  ON plays (level_id, player_id, day);
CREATE INDEX IF NOT EXISTS plays_by_player ON plays (player_id, level_id);

-- one rating per player per level, changeable
CREATE TABLE IF NOT EXISTS ratings (
  level_id  TEXT NOT NULL,
  player_id TEXT NOT NULL,
  score     INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  at        INTEGER NOT NULL,
  PRIMARY KEY (level_id, player_id)
);

-- who has paid. Keyed on a hash of the email Stripe collected, because
-- that is the only thing a player can still produce after they have
-- lost the device they bought it on.
CREATE TABLE IF NOT EXISTS entitlements (
  email_hash TEXT PRIMARY KEY,
  source     TEXT NOT NULL,           -- 'stripe' | 'beta' | 'gift'
  reference  TEXT,                    -- the Stripe session, for support
  at         INTEGER NOT NULL
);

-- and which devices have claimed it. One purchase, several machines -
-- that is a feature, not a leak: it is how somebody moves to a new
-- laptop without an account.
CREATE TABLE IF NOT EXISTS claims (
  player_id  TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL,
  at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS claims_by_email ON claims (email_hash);

-- Single-use, short-lived, and the thing that stops a captured request
-- being replayed for ever. Signed requests sign one of these.
CREATE TABLE IF NOT EXISTS nonces (
  nonce   TEXT PRIMARY KEY,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS nonces_expiry ON nonces (expires);

-- the orders the board can be asked for, both of them keyset-friendly
CREATE INDEX IF NOT EXISTS levels_by_stars
  ON levels (state, rank_score DESC, plays DESC, created DESC, id);
CREATE INDEX IF NOT EXISTS levels_by_plays
  ON levels (state, plays DESC, rank_score DESC, created DESC, id);
CREATE INDEX IF NOT EXISTS levels_by_owner ON levels (owner);
-- two levels may not share a name. Only levels that have been out in
-- public are in here, so a private draft can be called anything.
CREATE UNIQUE INDEX IF NOT EXISTS levels_one_name ON levels (name_key)
  WHERE ever_public = 1;

-- ---------------------------------------------------------------------
-- WHAT PEOPLE CALL THEMSELVES
--
-- Not an account: there is still no password and nothing to log into.
-- It is a name claimed by a key, first come first served, and it is
-- required before anything of yours goes out in public - a catalogue
-- where every level is by "anonymous" tells a player nothing, and a
-- catalogue where anybody can be anybody is worse than that.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS authors (
  name_key  TEXT PRIMARY KEY,         -- lowercased, spaces squeezed
  name      TEXT NOT NULL,            -- as they typed it
  player_id TEXT NOT NULL,            -- the thumbprint of their signing key
  -- The name the catalogue knows them by, made once and never changed.
  -- Not the same thing as player_id, deliberately: that is derived from
  -- their key, so it would change under them if they ever had to
  -- replace one, and it is the same string they sign with. This is a
  -- plain uuid that means nothing and gives nothing away, and it is
  -- what a published level points at.
  uuid      TEXT NOT NULL,
  at        INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS authors_uuid ON authors (uuid);
CREATE UNIQUE INDEX IF NOT EXISTS authors_one_each ON authors (player_id);

-- ---------------------------------------------------------------------
-- CREDITS
--
-- Only the two kinds that other people's behaviour decides live here.
-- What a player earns by playing is counted on their own machine,
-- because the game runs with no network - and cheating that only cheats
-- yourself out of a single-player game. Royalties and podium bonuses are
-- different: they are other people's plays, so a client cannot be asked
-- what it is owed.
--
-- What was BOUGHT is not stored per player at all; it is worked out from
-- the purchases attached to the address it was bought with. That way a
-- purchase followed to a second machine cannot be granted twice, because
-- it is never granted - only counted.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallets (
  player_id TEXT PRIMARY KEY,
  royalties INTEGER NOT NULL DEFAULT 0,
  podium    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchases (
  session_id TEXT PRIMARY KEY,      -- Stripe's, so a repeated webhook is a no-op
  email_hash TEXT NOT NULL,
  credits    INTEGER NOT NULL DEFAULT 0,
  at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS purchases_by_email ON purchases (email_hash);

-- One row per place per month, ever. The primary key is what makes
-- closing a month safe to do twice - and it will be done twice, because
-- whoever opens the game first is what triggers it.
CREATE TABLE IF NOT EXISTS podium_awards (
  period    TEXT NOT NULL,          -- YYYY-MM
  place     TEXT NOT NULL,          -- gold | silver | bronze
  level_id  TEXT NOT NULL,
  player_id TEXT NOT NULL,
  plays     INTEGER NOT NULL,
  amount    INTEGER NOT NULL,
  at        INTEGER NOT NULL,
  PRIMARY KEY (period, place)
);
CREATE INDEX IF NOT EXISTS podium_by_player ON podium_awards (player_id);
