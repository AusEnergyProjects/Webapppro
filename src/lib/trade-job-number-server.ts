export async function nextTradeWorkNumber(
  db: D1Database,
  firebaseUid: string,
  prefix: "JOB" | "FUL" | "PO" | "WTY",
  now: string,
) {
  const row = await db.prepare(`INSERT INTO trade_crm_counters
    (firebase_uid, counter_key, last_value, updated_at) VALUES (?, ?, 1, ?)
    ON CONFLICT(firebase_uid, counter_key) DO UPDATE SET
      last_value = last_value + 1, updated_at = excluded.updated_at
    RETURNING last_value`)
    .bind(firebaseUid, prefix.toLowerCase(), now)
    .first<{ last_value: number }>();
  const value = Number(row?.last_value || 0);
  if (!value) throw new Error("JOB_NUMBER_UNAVAILABLE");
  return `${prefix}-${String(value).padStart(6, "0")}`;
}

const TLINK_JOB_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const TLINK_JOB_CODE_LENGTH = 7;
const TLINK_OPAQUE_JOB_MARKER = "X";
const TLINK_JOB_SPACE = 2 ** 32;

function opaqueTlinkJobValue(sequence: number) {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > TLINK_JOB_SPACE) {
    throw new Error("JOB_NUMBER_UNAVAILABLE");
  }

  // Every operation is a permutation over 32 bits. The global counter therefore
  // remains the collision-safe allocator without exposing its sequential value.
  let value = (sequence + 0x6d2b79f5) >>> 0;
  value = (value ^ (value >>> 16)) >>> 0;
  value = Math.imul(value, 0x21f0aaad) >>> 0;
  value = (value ^ (value >>> 15)) >>> 0;
  value = Math.imul(value, 0x735a2d97) >>> 0;
  return (value ^ (value >>> 15)) >>> 0;
}

export function formatTlinkJobNumber(sequence: number) {
  let value = opaqueTlinkJobValue(sequence);
  let code = "";
  for (let index = 0; index < TLINK_JOB_CODE_LENGTH; index += 1) {
    code = TLINK_JOB_ALPHABET[value % 32] + code;
    value = Math.floor(value / 32);
  }
  // The marker keeps every future reference disjoint from historic TLJ-######## values.
  return `TLJ-${TLINK_OPAQUE_JOB_MARKER}${code}`;
}

export async function nextTlinkJobNumber(db: D1Database, now: string) {
  const row = await db.prepare(`INSERT INTO trade_crm_counters
    (firebase_uid, counter_key, last_value, updated_at) VALUES ('__tlink_global__', 'job', 1, ?)
    ON CONFLICT(firebase_uid, counter_key) DO UPDATE SET
      last_value = last_value + 1, updated_at = excluded.updated_at
    RETURNING last_value`)
    .bind(now)
    .first<{ last_value: number }>();
  const value = Number(row?.last_value || 0);
  if (!value) throw new Error("JOB_NUMBER_UNAVAILABLE");
  return formatTlinkJobNumber(value);
}

export async function reserveTlinkJobNumbers(db: D1Database, count: number, now: string) {
  const requested = Math.max(0, Math.min(500, Math.floor(count)));
  if (!requested) return [];
  const row = await db.prepare(`INSERT INTO trade_crm_counters
    (firebase_uid, counter_key, last_value, updated_at) VALUES ('__tlink_global__', 'job', ?, ?)
    ON CONFLICT(firebase_uid, counter_key) DO UPDATE SET
      last_value = last_value + excluded.last_value, updated_at = excluded.updated_at
    RETURNING last_value`)
    .bind(requested, now)
    .first<{ last_value: number }>();
  const lastValue = Number(row?.last_value || 0);
  if (lastValue < requested) throw new Error("JOB_NUMBER_UNAVAILABLE");
  const firstValue = lastValue - requested + 1;
  return Array.from({ length: requested }, (_, index) => formatTlinkJobNumber(firstValue + index));
}

export async function reserveTradeWorkNumbers(
  db: D1Database,
  firebaseUid: string,
  prefix: "JOB" | "FUL" | "PO" | "WTY",
  count: number,
  now: string,
) {
  const requested = Math.max(0, Math.min(500, Math.floor(count)));
  if (!requested) return [];
  const row = await db.prepare(`INSERT INTO trade_crm_counters
    (firebase_uid, counter_key, last_value, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(firebase_uid, counter_key) DO UPDATE SET
      last_value = last_value + excluded.last_value, updated_at = excluded.updated_at
    RETURNING last_value`)
    .bind(firebaseUid, prefix.toLowerCase(), requested, now)
    .first<{ last_value: number }>();
  const lastValue = Number(row?.last_value || 0);
  if (lastValue < requested) throw new Error("JOB_NUMBER_UNAVAILABLE");
  const firstValue = lastValue - requested + 1;
  return Array.from({ length: requested }, (_, index) =>
    `${prefix}-${String(firstValue + index).padStart(6, "0")}`,
  );
}
