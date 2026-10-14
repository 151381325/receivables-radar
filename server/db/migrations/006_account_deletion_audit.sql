-- Keep administrative event metadata without retaining a deleted account reference.
ALTER TABLE admin_actions ALTER COLUMN actor_user_id DROP NOT NULL;
ALTER TABLE admin_actions ALTER COLUMN target_user_id DROP NOT NULL;
ALTER TABLE admin_actions DROP CONSTRAINT admin_actions_actor_user_id_fkey;
ALTER TABLE admin_actions DROP CONSTRAINT admin_actions_target_user_id_fkey;
ALTER TABLE admin_actions ADD CONSTRAINT admin_actions_actor_user_id_fkey
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE admin_actions ADD CONSTRAINT admin_actions_target_user_id_fkey
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL;
