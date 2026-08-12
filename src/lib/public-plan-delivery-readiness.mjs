export const PUBLIC_PLAN_READINESS_OBJECT_KEY =
  "__aea_system__/readiness/must-remain-absent-831c91cc-408e-40da-9a7e-674ccb548628";

const QUEUES = [
  {
    name: "durable_intake",
    columns: `SELECT id, source_reference, submission_fingerprint,
      payload_object_key, status, opportunity_id, attempts, next_attempt_at,
      created_at, updated_at FROM public_plan_lead_intakes LIMIT 0`,
    indexes: [
      "public_plan_lead_intakes_source_idx",
      "public_plan_lead_intakes_payload_idx",
      "public_plan_lead_intakes_status_idx",
    ],
  },
  {
    name: "customer_email_outbox",
    columns: `SELECT id, intake_id, source_reference, status, attempts,
      next_attempt_at, recipient_email_hash, idempotency_key,
      attachment_object_key, created_at, updated_at
      FROM public_plan_customer_email_deliveries LIMIT 0`,
    indexes: [
      "public_plan_customer_email_intake_idx",
      "public_plan_customer_email_source_idx",
      "public_plan_customer_email_idempotency_idx",
      "public_plan_customer_email_status_idx",
    ],
  },
  {
    name: "internal_relay_outbox",
    columns: `SELECT id, intake_id, source_reference, status, attempts,
      next_attempt_at, idempotency_key, created_at, updated_at
      FROM public_plan_internal_relay_deliveries LIMIT 0`,
    indexes: [
      "public_plan_internal_relay_intake_idx",
      "public_plan_internal_relay_source_idx",
      "public_plan_internal_relay_idempotency_idx",
      "public_plan_internal_relay_status_idx",
    ],
  },
];

const REQUIRED_INDEXES = QUEUES.flatMap((queue) => queue.indexes);

function clean(value, maximum = 1000) {
  return String(value || "").trim().slice(0, maximum);
}

export function publicPlanInternalRelayConfigured(runtime = process.env) {
  const secret = clean(runtime.AEA_LEAD_WEBHOOK_SIGNING_SECRET, 10_000);
  try {
    const url = new URL(clean(runtime.AEA_LEAD_WEBHOOK_URL));
    return url.protocol === "https:" && secret.length >= 32;
  } catch {
    return false;
  }
}

function check(name, ok, evidence, blocking = true) {
  return { name, ok, blocking, evidence };
}

async function indexNames(database) {
  const placeholders = REQUIRED_INDEXES.map(() => "?").join(", ");
  const result = await database.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (${placeholders})`,
  ).bind(...REQUIRED_INDEXES).all();
  return new Set((result.results || []).map((row) => clean(row.name, 120)));
}

export async function readPublicPlanDeliveryReadiness({
  database,
  bucket,
  customerEmailConfigured,
  internalRelayConfigured,
}) {
  const [indexes, ...capabilities] = await Promise.allSettled([
    indexNames(database),
    ...QUEUES.map((queue) => database.prepare(queue.columns).all()),
    bucket.head(PUBLIC_PLAN_READINESS_OBJECT_KEY),
  ]);

  const foundIndexes = indexes.status === "fulfilled" ? indexes.value : new Set();
  const checks = QUEUES.map((queue, index) => {
    const columnsReadable = capabilities[index]?.status === "fulfilled";
    const requiredIndexesPresent = queue.indexes.every((name) => foundIndexes.has(name));
    return check(
      queue.name,
      columnsReadable && requiredIndexesPresent,
      columnsReadable && requiredIndexesPresent
        ? "required_columns_and_indexes_readable"
        : "required_schema_unavailable",
    );
  });

  const payloadCapability = capabilities[QUEUES.length];
  const payloadReadable = payloadCapability?.status === "fulfilled"
    && payloadCapability.value === null;
  checks.push(check(
    "private_payload_store",
    payloadReadable,
    payloadReadable
      ? "reserved_absent_key_head_completed"
      : "binding_read_unavailable",
  ));
  checks.push(check(
    "customer_email_configuration",
    customerEmailConfigured === true,
    customerEmailConfigured === true
      ? "provider_configuration_present"
      : "provider_configuration_missing",
  ));
  checks.push(check(
    "internal_relay_configuration",
    internalRelayConfigured === true,
    internalRelayConfigured === true
      ? "relay_configuration_present"
      : "relay_configuration_missing",
    false,
  ));

  return {
    ok: checks.every((entry) => !entry.blocking || entry.ok),
    checks,
    schedulerExecutionVerified: false,
    providerDeliveryVerified: false,
  };
}
