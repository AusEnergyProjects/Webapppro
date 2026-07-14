export const LEAD_RATE_LIMIT = 5;
export const LEAD_RATE_WINDOW_MS = 60 * 60 * 1000;

const SECRET_MIN_LENGTH = 32;
const MAX_WRITE_ATTEMPTS = 12;

function retryAfterSeconds(timestamps, now) {
  const earliest = Math.min(...timestamps);
  return Math.max(1, Math.ceil((earliest + LEAD_RATE_WINDOW_MS - now) / 1000));
}

async function obscureClientKey(key, secret) {
  const encoder = new TextEncoder();
  const signingKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", signingKey, encoder.encode(key));
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
}

function validTimestamps(value) {
  return Array.isArray(value)
    && value.every((timestamp) => Number.isFinite(timestamp) && timestamp >= 0);
}

export function createMemoryLeadRateLimiter({ now = Date.now } = {}) {
  const buckets = new Map();
  return {
    mode: "memory",
    async check(key) {
      const currentTime = now();
      const recent = (buckets.get(key) || []).filter((time) => currentTime - time < LEAD_RATE_WINDOW_MS);
      if (recent.length >= LEAD_RATE_LIMIT) {
        buckets.set(key, recent);
        return { allowed: false, retryAfterSeconds: retryAfterSeconds(recent, currentTime) };
      }
      recent.push(currentTime);
      buckets.set(key, recent);
      return { allowed: true };
    },
  };
}

export function createSharedLeadRateLimiter({
  env = process.env,
  now = Date.now,
  getDatabase,
} = {}) {
  let memoryLimiter;
  let sharedChecks = 0;
  const shared = typeof getDatabase === "function" && env.NODE_ENV !== "development";

  return {
    mode: shared ? "shared" : "memory",
    async check(clientKey) {
      if (!shared) {
        memoryLimiter ||= createMemoryLeadRateLimiter({ now });
        return memoryLimiter.check(clientKey);
      }

      const secret = env.AEA_LEAD_RATE_LIMIT_SECRET;
      if (typeof secret !== "string" || secret.length < SECRET_MIN_LENGTH) {
        return { allowed: false, unavailable: true };
      }

      const currentTime = now();

      try {
        const clientHash = await obscureClientKey(clientKey, secret);
        const database = getDatabase();

        for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
          const record = await database.prepare(
            "SELECT timestamps, version FROM lead_rate_limits WHERE client_hash = ?",
          ).bind(clientHash).first();
          let timestamps = [];
          if (record) {
            try {
              timestamps = JSON.parse(record.timestamps);
            } catch {
              return { allowed: false, unavailable: true };
            }
          }
          if (!validTimestamps(timestamps)) return { allowed: false, unavailable: true };

          const recent = timestamps.filter((time) => currentTime - time < LEAD_RATE_WINDOW_MS);
          if (recent.length >= LEAD_RATE_LIMIT) {
            return {
              allowed: false,
              retryAfterSeconds: retryAfterSeconds(recent, currentTime),
            };
          }

          const nextTimestamps = JSON.stringify([...recent, currentTime]);
          const write = record
            ? await database.prepare(`
                UPDATE lead_rate_limits
                SET timestamps = ?, version = version + 1, updated_at = ?
                WHERE client_hash = ? AND version = ?
              `).bind(nextTimestamps, currentTime, clientHash, record.version).run()
            : await database.prepare(`
                INSERT OR IGNORE INTO lead_rate_limits
                (client_hash, timestamps, version, updated_at)
                VALUES (?, ?, 0, ?)
              `).bind(clientHash, nextTimestamps, currentTime).run();

          if (write.meta?.changes === 1) {
            sharedChecks += 1;
            if (sharedChecks % 100 === 0) {
              await database.prepare(
                "DELETE FROM lead_rate_limits WHERE updated_at < ?",
              ).bind(currentTime - (LEAD_RATE_WINDOW_MS * 2)).run().catch(() => undefined);
            }
            return { allowed: true };
          }
        }

        return { allowed: false, unavailable: true };
      } catch {
        return { allowed: false, unavailable: true };
      }
    },
  };
}
