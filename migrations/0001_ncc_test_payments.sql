CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  order_receipt TEXT NOT NULL,
  member_uid TEXT NOT NULL,
  member_email TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 1),
  paid_amount INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  refunded_amount INTEGER NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'KRW' CHECK (currency = 'KRW'),
  status TEXT NOT NULL CHECK (status IN ('ready', 'paid', 'partially_refunded', 'refunded', 'cancelled')),
  test_mode INTEGER NOT NULL DEFAULT 1 CHECK (test_mode = 1),
  idempotency_key TEXT UNIQUE,
  last_operation_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (refunded_amount <= paid_amount),
  CHECK (paid_amount <= amount)
);

CREATE INDEX IF NOT EXISTS idx_payments_member_created
  ON payments(member_uid, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_status_created
  ON payments(status, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('prepared', 'reopened', 'paid', 'failed_simulation', 'cancelled', 'refunded')),
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  actor_uid TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (payment_id) REFERENCES payments(id)
);

CREATE INDEX IF NOT EXISTS idx_payment_events_payment_created
  ON payment_events(payment_id, created_at DESC);
