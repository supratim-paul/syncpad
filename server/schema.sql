CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('code','notes')),
  language text NOT NULL DEFAULT 'javascript',
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_code text UNIQUE NOT NULL,
  state bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS room_members (
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'editor' CHECK (role IN ('owner','editor')),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS room_members_user ON room_members(user_id);

CREATE TABLE IF NOT EXISTS room_history (
  id bigserial PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  state bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS room_history_room ON room_history(room_id, id DESC);

-- Refresh-token rotation grace window (parallel tabs / retried requests must not log the user out).
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS replaced_at timestamptz;
CREATE INDEX IF NOT EXISTS refresh_tokens_user ON refresh_tokens(user_id);
