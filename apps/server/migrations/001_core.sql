CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  weight_kg DOUBLE PRECISION,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_links (
  channel TEXT NOT NULL,
  external_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (channel, external_id),
  UNIQUE (user_id, channel)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS nutrition_goals (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  kcal DOUBLE PRECISION,
  protein DOUBLE PRECISION,
  carbs DOUBLE PRECISION,
  fat DOUBLE PRECISION,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bind_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bind_codes_expiry ON bind_codes(expires_at);
CREATE TABLE IF NOT EXISTS bind_attempts (
  channel TEXT NOT NULL,
  external_id TEXT NOT NULL,
  window_at TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  PRIMARY KEY (channel, external_id)
);
CREATE TABLE IF NOT EXISTS raw_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  external_id TEXT NOT NULL,
  message_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  meta_json TEXT NOT NULL,
  source_sent_at TEXT,
  received_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL,
  reply TEXT,
  UNIQUE (channel, external_id, message_key)
);
CREATE INDEX IF NOT EXISTS raw_sender ON raw_messages(channel,external_id,status);
CREATE INDEX IF NOT EXISTS raw_user ON raw_messages(user_id,received_at);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  raw_message_id TEXT NOT NULL UNIQUE REFERENCES raw_messages(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  bytes_b64 TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS media_expiry ON media(expires_at);
CREATE TABLE IF NOT EXISTS media_gc (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_jobs (
  id TEXT PRIMARY KEY,
  raw_message_id TEXT NOT NULL UNIQUE REFERENCES raw_messages(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  available_at TEXT NOT NULL,
  lease_until TEXT,
  lease_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_ready ON ai_jobs(status,available_at,lease_until);
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  raw_message_id TEXT REFERENCES raw_messages(id) ON DELETE CASCADE,
  raw_index INTEGER,
  recurring_parent TEXT UNIQUE REFERENCES records(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('diet','workout','memo','todo')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  note TEXT NOT NULL,
  status TEXT NOT NULL,
  data_json TEXT NOT NULL,
  event_date TEXT NOT NULL,
  timezone TEXT NOT NULL,
  confidence DOUBLE PRECISION,
  source TEXT NOT NULL,
  ai_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (raw_message_id,raw_index)
);
CREATE INDEX IF NOT EXISTS records_user_date ON records(user_id,event_date DESC,created_at DESC);
CREATE INDEX IF NOT EXISTS records_user_type_date ON records(user_id,type,event_date DESC);
CREATE TABLE IF NOT EXISTS daily_summaries (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  todo_count INTEGER NOT NULL,
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id,local_date)
);
