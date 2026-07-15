export async function nextTradeWorkNumber(
  db: D1Database,
  firebaseUid: string,
  prefix: "JOB" | "FUL",
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
