-- Reserve a single external attempt before any provider call. Uncertain attempts
-- cannot be retried or replaced through the manual submission path.
CREATE TABLE compliance_output_dispatch_intents (
  id text PRIMARY KEY NOT NULL,
  organisation_id text NOT NULL,
  packet_id text NOT NULL,
  packet_sha256 text NOT NULL,
  adapter_id text NOT NULL,
  requested_by_uid text NOT NULL,
  status text NOT NULL CHECK (status IN ('dispatching', 'uncertain', 'completed')),
  started_at text NOT NULL CHECK (datetime(started_at) IS NOT NULL),
  finished_at text NOT NULL DEFAULT '',
  adapter_receipt_id text NOT NULL DEFAULT '',
  failure_code text NOT NULL DEFAULT '',
  CHECK (length(id) > 0 AND length(organisation_id) > 0 AND length(packet_id) > 0
    AND length(adapter_id) > 0 AND length(requested_by_uid) > 0),
  CHECK (length(packet_sha256) = 71 AND substr(packet_sha256, 1, 7) = 'sha256:'
    AND substr(packet_sha256, 8) NOT GLOB '*[^0-9a-f]*'),
  CHECK ((status = 'dispatching' AND finished_at = '' AND adapter_receipt_id = '' AND failure_code = '')
    OR (status = 'uncertain' AND datetime(finished_at) >= datetime(started_at)
      AND adapter_receipt_id = '' AND length(failure_code) > 0)
    OR (status = 'completed' AND datetime(finished_at) >= datetime(started_at)
      AND length(adapter_receipt_id) > 0 AND failure_code = ''))
);
CREATE UNIQUE INDEX compliance_output_dispatch_packet_idx
  ON compliance_output_dispatch_intents (organisation_id, packet_id);

-- Dispatch guards are installed by creditex-work-pack-schema-guards.ts through
-- prepared statements, which preserve complete trigger bodies on Sites.
