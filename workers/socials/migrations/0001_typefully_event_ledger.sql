CREATE TABLE IF NOT EXISTS typefully_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  known_event INTEGER NOT NULL DEFAULT 0 CHECK (known_event IN (0, 1)),
  draft_id TEXT,
  social_set_id TEXT,
  draft_status TEXT,
  event_timestamp INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_typefully_events_draft
  ON typefully_webhook_events (draft_id, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_typefully_events_type
  ON typefully_webhook_events (event_type, event_timestamp DESC);
