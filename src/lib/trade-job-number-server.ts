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
