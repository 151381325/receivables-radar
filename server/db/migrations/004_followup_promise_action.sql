ALTER TABLE follow_ups ADD COLUMN promise_action text NOT NULL DEFAULT 'keep'
  CHECK (promise_action IN ('keep', 'set', 'clear'));
UPDATE follow_ups SET promise_action = 'set' WHERE promise_date IS NOT NULL;
-- Imported events share the transaction timestamp; retain insertion order.
ALTER TABLE follow_ups ADD COLUMN recorded_order bigint GENERATED ALWAYS AS IDENTITY;
