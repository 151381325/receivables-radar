CREATE TABLE admin_actions (
  id bigserial PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  target_user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK (action IN ('disable_user', 'enable_user')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_actions_target_created_idx
  ON admin_actions(target_user_id, created_at DESC);
