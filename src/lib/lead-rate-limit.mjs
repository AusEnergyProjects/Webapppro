import { createHmac } from "node:crypto";
import { getStore } from "@netlify/blobs";

export const LEAD_RATE_LIMIT = 5;
export const LEAD_RATE_WINDOW_MS = 60 * 60 * 1000;

const STORE_NAME = "aea-lead-rate-limit";
const SECRET_MIN_LENGTH = 32;
const MAX_WRITE_ATTEMPTS = 12;

function retryAfterSeconds(timestamps, now) {
  const earliest = Math.min(...timestamps);
  return Math.max(1, Math.ceil((earliest + LEAD_RATE_WINDOW_MS - now) / 1000));
}

function obscureClientKey(key, secret) {
  return createHmac("sha256", secret).update(key).digest("hex").slice(0, 40);
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
  getStoreImpl = getStore,
} = {}) {
  let memoryLimiter;

  return {
    mode: env.NETLIFY === "true" ? "shared" : "memory",
    async check(clientKey) {
      if (env.NETLIFY !== "true") {
        memoryLimiter ||= createMemoryLeadRateLimiter({ now });
        return memoryLimiter.check(clientKey);
      }

      const secret = env.AEA_LEAD_RATE_LIMIT_SECRET;
      if (typeof secret !== "string" || secret.length < SECRET_MIN_LENGTH) {
        return { allowed: false, unavailable: true };
      }

      const currentTime = now();
      const clientHash = obscureClientKey(clientKey, secret);
      const recordKey = `v1/${clientHash}`;

      try {
        const store = getStoreImpl({ name: STORE_NAME, consistency: "strong" });

        for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
          const record = await store.getWithMetadata(recordKey, { type: "json" });
          const timestamps = record?.data?.timestamps ?? [];
          if (!validTimestamps(timestamps)) return { allowed: false, unavailable: true };
          if (record && typeof record.etag !== "string") return { allowed: false, unavailable: true };

          const recent = timestamps.filter((time) => currentTime - time < LEAD_RATE_WINDOW_MS);
          if (recent.length >= LEAD_RATE_LIMIT) {
            return {
              allowed: false,
              retryAfterSeconds: retryAfterSeconds(recent, currentTime),
            };
          }

          const nextRecord = { timestamps: [...recent, currentTime] };
          const write = record
            ? await store.setJSON(recordKey, nextRecord, { onlyIfMatch: record.etag })
            : await store.setJSON(recordKey, nextRecord, { onlyIfNew: true });

          if (write.modified) return { allowed: true };
        }

        return { allowed: false, unavailable: true };
      } catch {
        return { allowed: false, unavailable: true };
      }
    },
  };
}
