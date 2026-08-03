CREATE TABLE trade_crm_write_guards (
  id text PRIMARY KEY NOT NULL,
  firebase_uid text NOT NULL,
  operation_id text NOT NULL,
  step_number integer NOT NULL,
  verified integer NOT NULL,
  created_at text NOT NULL,
  CONSTRAINT trade_crm_write_guard_identity_check CHECK (
    trim(firebase_uid) <> ''
    AND trim(operation_id) <> ''
    AND step_number > 0
  ),
  CONSTRAINT trade_crm_write_guard_verified_check CHECK (verified = 1),
  CONSTRAINT trade_crm_write_guard_time_check CHECK (
    datetime(created_at) IS NOT NULL
  )
);

CREATE UNIQUE INDEX trade_crm_write_guards_operation_step_idx
  ON trade_crm_write_guards (operation_id, step_number);

CREATE INDEX trade_crm_write_guards_owner_time_idx
  ON trade_crm_write_guards (firebase_uid, created_at, id);
