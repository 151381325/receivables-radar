CREATE TABLE payment_correction_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receivable_id text NOT NULL,
  payment_id text NOT NULL,
  original_payment jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, receivable_id) REFERENCES receivables(user_id, id) ON DELETE CASCADE
);
CREATE INDEX payment_correction_events_user_idx ON payment_correction_events(user_id, created_at DESC);
