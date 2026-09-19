-- NULL retains the business's service regions for existing members.
-- Explicit selections are validated against current business regions on save.
ALTER TABLE trade_team_members ADD COLUMN service_states TEXT DEFAULT NULL
  CONSTRAINT trade_team_members_service_states_check CHECK(service_states IS NULL OR (json_valid(service_states)
    AND json_type(service_states)='array' AND json_array_length(service_states) BETWEEN 1 AND 8));
