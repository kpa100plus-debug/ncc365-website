CREATE TABLE IF NOT EXISTS payment_provider_transactions (
  payment_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider = 'toss'),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  provider_order_id TEXT NOT NULL UNIQUE,
  provider_payment_key TEXT UNIQUE,
  provider_status TEXT NOT NULL DEFAULT 'READY',
  method TEXT,
  receipt_url TEXT,
  requested_at TEXT NOT NULL,
  approved_at TEXT,
  cancelled_at TEXT,
  last_synced_at TEXT,
  FOREIGN KEY (payment_id) REFERENCES payments(id)
);

CREATE INDEX IF NOT EXISTS idx_provider_transactions_status
  ON payment_provider_transactions(provider, environment, provider_status, requested_at DESC);

CREATE TABLE IF NOT EXISTS payment_provider_events (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'toss'),
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  provider_status TEXT,
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  details TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  result TEXT NOT NULL CHECK (result IN ('received', 'processed', 'ignored', 'failed')),
  FOREIGN KEY (payment_id) REFERENCES payments(id)
);

CREATE INDEX IF NOT EXISTS idx_provider_events_payment_received
  ON payment_provider_events(payment_id, received_at DESC);
