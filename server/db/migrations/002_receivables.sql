CREATE TABLE receivables (
  id text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_name text NOT NULL,
  project_name text NOT NULL,
  total_amount_fen bigint NOT NULL CHECK (total_amount_fen > 0),
  invoice_sent boolean NOT NULL DEFAULT false,
  due_date date NOT NULL,
  next_follow_up_date date,
  paused boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, id)
);

CREATE INDEX receivables_active_user_idx ON receivables(user_id, deleted_at, updated_at DESC);

CREATE TABLE payments (
  id text NOT NULL,
  receivable_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_fen bigint NOT NULL CHECK (amount_fen > 0),
  paid_at date NOT NULL,
  method text NOT NULL,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, receivable_id, id),
  FOREIGN KEY (user_id, receivable_id) REFERENCES receivables(user_id, id) ON DELETE CASCADE
);

CREATE INDEX payments_receivable_idx ON payments(user_id, receivable_id, paid_at, created_at);

CREATE TABLE follow_ups (
  id text NOT NULL,
  receivable_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_at date NOT NULL,
  result text NOT NULL,
  promise_date date,
  next_follow_up_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, receivable_id, id),
  FOREIGN KEY (user_id, receivable_id) REFERENCES receivables(user_id, id) ON DELETE CASCADE
);

CREATE INDEX follow_ups_receivable_idx ON follow_ups(user_id, receivable_id, followed_at, created_at);
