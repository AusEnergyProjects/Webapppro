const STATE_TABLE = "surge_model_usage_state";
const STATE_JSON_MAX_CHARS = 131_072;
const MAX_CAS_ATTEMPTS = 16;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const REQUEST_IDEMPOTENCY_MS = 10 * MINUTE_MS;

export const SURGE_USAGE_GUARD_ENV = {
  secret: "SURGE_USAGE_GUARD_SECRET",
  clientMinuteLimit: "SURGE_CLIENT_MINUTE_LIMIT",
  clientDailyLimit: "SURGE_CLIENT_DAILY_LIMIT",
  networkMinuteLimit: "SURGE_NETWORK_MINUTE_LIMIT",
  networkDailyLimit: "SURGE_NETWORK_DAILY_LIMIT",
  globalMinuteLimit: "SURGE_GLOBAL_MINUTE_LIMIT",
  globalInFlightLimit: "SURGE_GLOBAL_INFLIGHT_LIMIT",
  globalDailyMicroUsdLimit: "SURGE_GLOBAL_DAILY_MICRO_USD",
  inFlightLeaseMs: "SURGE_IN_FLIGHT_LEASE_MS",
} as const;

export const SURGE_USAGE_GUARD_DEFAULTS = {
  clientMinuteLimit: 6,
  clientDailyLimit: 30,
  networkMinuteLimit: 60,
  networkDailyLimit: 600,
  globalMinuteLimit: 20,
  globalInFlightLimit: 5,
  globalDailyMicroUsdLimit: 2_000_000,
  inFlightLeaseMs: 30_000,
  requestIdempotencyMs: REQUEST_IDEMPOTENCY_MS,
} as const;

type SurgeUsageEnvironment = Record<string, string | undefined>;

type SurgeUsageConfiguration = {
  secret: string;
  clientMinuteLimit: number;
  clientDailyLimit: number;
  networkMinuteLimit: number;
  networkDailyLimit: number;
  globalMinuteLimit: number;
  globalInFlightLimit: number;
  globalDailyMicroUsdLimit: number;
  inFlightLeaseMs: number;
};

type CounterState = {
  kind: "counter";
  minuteStart: number;
  minuteCount: number;
  dayStart: number;
  dayCount: number;
};

type GlobalLease = {
  hash: string;
  expiresAt: number;
};

type GlobalRequest = {
  hash: string;
  expiresAt: number;
};

type GlobalState = {
  kind: "global";
  minuteStart: number;
  minuteCount: number;
  dayStart: number;
  dailyReservedMicroUsd: number;
  leases: GlobalLease[];
  requests: GlobalRequest[];
};

type UsageRow = {
  state_json: string;
  version: number;
};

export type SurgeUsageDenialReason =
  | "configuration"
  | "invalid_identity"
  | "invalid_estimate"
  | "duplicate_request"
  | "client_minute"
  | "client_day"
  | "network_minute"
  | "network_day"
  | "global_minute"
  | "global_in_flight"
  | "global_daily_budget"
  | "unavailable";

export type SurgeUsageAdmission = {
  allowed: true;
  reservedMicroUsd: number;
  release: () => Promise<void>;
};

export type SurgeUsageDenial = {
  allowed: false;
  reason: SurgeUsageDenialReason;
  retryAfterSeconds?: number;
};

export type SurgeUsageReservation = SurgeUsageAdmission | SurgeUsageDenial;

export type SharedSurgeUsageGuardOptions = {
  env?: SurgeUsageEnvironment;
  getDatabase?: () => D1Database;
  now?: () => number;
  randomUUID?: () => string;
};

type CounterLimits = {
  minute: number;
  day: number;
  minuteReason: SurgeUsageDenialReason;
  dayReason: SurgeUsageDenialReason;
};

type StateWrite = {
  state: CounterState | GlobalState;
  version: number | null;
};

function positiveInteger(
  env: SurgeUsageEnvironment,
  key: string,
  fallback: number,
  required: boolean,
) {
  const source = env[key];
  if (source === undefined || source === "") return required ? null : fallback;
  if (!/^[1-9]\d*$/.test(source)) return null;
  const value = Number(source);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function usageConfiguration(env: SurgeUsageEnvironment): SurgeUsageConfiguration | null {
  const secret = env[SURGE_USAGE_GUARD_ENV.secret];
  if (typeof secret !== "string" || secret.length < 32) return null;
  const production = env.NODE_ENV !== "development" && env.NODE_ENV !== "test";
  const clientMinuteLimit = positiveInteger(
    env,
    SURGE_USAGE_GUARD_ENV.clientMinuteLimit,
    SURGE_USAGE_GUARD_DEFAULTS.clientMinuteLimit,
    production,
  );
  const clientDailyLimit = positiveInteger(
    env,
    SURGE_USAGE_GUARD_ENV.clientDailyLimit,
    SURGE_USAGE_GUARD_DEFAULTS.clientDailyLimit,
    production,
  );
  const networkMinuteLimit = positiveInteger(
    env,
    SURGE_USAGE_GUARD_ENV.networkMinuteLimit,
    SURGE_USAGE_GUARD_DEFAULTS.networkMinuteLimit,
    production,
  );
  const networkDailyLimit = positiveInteger(
    env,
    SURGE_USAGE_GUARD_ENV.networkDailyLimit,
    SURGE_USAGE_GUARD_DEFAULTS.networkDailyLimit,
    production,
  );
  const globalMinuteLimit = positiveInteger(
    env,
    SURGE_USAGE_GUARD_ENV.globalMinuteLimit,
    SURGE_USAGE_GUARD_DEFAULTS.globalMinuteLimit,
    production,
  );
  const globalInFlightLimit = positiveInteger(
    env,
    SURGE_USAGE_GUARD_ENV.globalInFlightLimit,
    SURGE_USAGE_GUARD_DEFAULTS.globalInFlightLimit,
    production,
  );
  const globalDailyMicroUsdLimit = positiveInteger(
    env,
    SURGE_USAGE_GUARD_ENV.globalDailyMicroUsdLimit,
    SURGE_USAGE_GUARD_DEFAULTS.globalDailyMicroUsdLimit,
    production,
  );
  const inFlightLeaseMs = positiveInteger(
    env,
    SURGE_USAGE_GUARD_ENV.inFlightLeaseMs,
    SURGE_USAGE_GUARD_DEFAULTS.inFlightLeaseMs,
    false,
  );
  if (
    clientMinuteLimit === null
    || clientDailyLimit === null
    || networkMinuteLimit === null
    || networkDailyLimit === null
    || globalMinuteLimit === null
    || globalInFlightLimit === null
    || globalDailyMicroUsdLimit === null
    || inFlightLeaseMs === null
  ) return null;
  return {
    secret,
    clientMinuteLimit,
    clientDailyLimit,
    networkMinuteLimit,
    networkDailyLimit,
    globalMinuteLimit,
    globalInFlightLimit,
    globalDailyMicroUsdLimit,
    inFlightLeaseMs,
  };
}

function fixedMinuteStart(now: number) {
  return Math.floor(now / MINUTE_MS) * MINUTE_MS;
}

function fixedDayStart(now: number) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function retryAfter(periodStart: number, periodMs: number, now: number) {
  return Math.max(1, Math.ceil((periodStart + periodMs - now) / 1_000));
}

function safeCount(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function safeTimestamp(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseCounterState(value: string): CounterState | null {
  if (value.length > STATE_JSON_MAX_CHARS) return null;
  try {
    const source = record(JSON.parse(value));
    if (!source || source.kind !== "counter") return null;
    const minuteStart = safeTimestamp(source.minuteStart);
    const minuteCount = safeCount(source.minuteCount);
    const dayStart = safeTimestamp(source.dayStart);
    const dayCount = safeCount(source.dayCount);
    if (minuteStart === null || minuteCount === null || dayStart === null || dayCount === null) return null;
    return { kind: "counter", minuteStart, minuteCount, dayStart, dayCount };
  } catch {
    return null;
  }
}

function hashEntry(value: unknown): value is { hash: string; expiresAt: number } {
  const source = record(value);
  return Boolean(
    source
    && typeof source.hash === "string"
    && /^[0-9a-f]{64}$/.test(source.hash)
    && safeTimestamp(source.expiresAt) !== null,
  );
}

function parseGlobalState(value: string): GlobalState | null {
  if (value.length > STATE_JSON_MAX_CHARS) return null;
  try {
    const source = record(JSON.parse(value));
    if (!source || source.kind !== "global") return null;
    const minuteStart = safeTimestamp(source.minuteStart);
    const minuteCount = safeCount(source.minuteCount);
    const dayStart = safeTimestamp(source.dayStart);
    const dailyReservedMicroUsd = safeCount(source.dailyReservedMicroUsd);
    if (
      minuteStart === null
      || minuteCount === null
      || dayStart === null
      || dailyReservedMicroUsd === null
      || !Array.isArray(source.leases)
      || !source.leases.every(hashEntry)
      || !Array.isArray(source.requests)
      || !source.requests.every(hashEntry)
    ) return null;
    return {
      kind: "global",
      minuteStart,
      minuteCount,
      dayStart,
      dailyReservedMicroUsd,
      leases: source.leases.map((entry) => ({ hash: entry.hash, expiresAt: entry.expiresAt })),
      requests: source.requests.map((entry) => ({ hash: entry.hash, expiresAt: entry.expiresAt })),
    };
  } catch {
    return null;
  }
}

function initialCounterState(now: number): CounterState {
  return {
    kind: "counter",
    minuteStart: fixedMinuteStart(now),
    minuteCount: 0,
    dayStart: fixedDayStart(now),
    dayCount: 0,
  };
}

function initialGlobalState(now: number): GlobalState {
  return {
    kind: "global",
    minuteStart: fixedMinuteStart(now),
    minuteCount: 0,
    dayStart: fixedDayStart(now),
    dailyReservedMicroUsd: 0,
    leases: [],
    requests: [],
  };
}

function normalizedCounterState(state: CounterState, now: number): CounterState {
  const minuteStart = fixedMinuteStart(now);
  const dayStart = fixedDayStart(now);
  return {
    ...state,
    minuteStart,
    minuteCount: state.minuteStart === minuteStart ? state.minuteCount : 0,
    dayStart,
    dayCount: state.dayStart === dayStart ? state.dayCount : 0,
  };
}

function normalizedGlobalState(state: GlobalState, now: number): GlobalState {
  const minuteStart = fixedMinuteStart(now);
  const dayStart = fixedDayStart(now);
  return {
    ...state,
    minuteStart,
    minuteCount: state.minuteStart === minuteStart ? state.minuteCount : 0,
    dayStart,
    dailyReservedMicroUsd: state.dayStart === dayStart ? state.dailyReservedMicroUsd : 0,
    leases: state.leases.filter((lease) => lease.expiresAt > now),
    requests: state.requests.filter((request) => request.expiresAt > now),
  };
}

function serializedState(value: CounterState | GlobalState) {
  const result = JSON.stringify(value);
  if (result.length < 2 || result.length > STATE_JSON_MAX_CHARS) throw new Error("SURGE_USAGE_STATE_LIMIT");
  return result;
}

async function readState(database: D1Database, scopeHash: string): Promise<UsageRow | null> {
  const row = await database.prepare(
    `SELECT state_json, version FROM ${STATE_TABLE} WHERE scope_hash = ?`,
  ).bind(scopeHash).first<UsageRow>();
  if (!row) return null;
  if (
    typeof row.state_json !== "string"
    || !Number.isSafeInteger(row.version)
    || row.version < 0
  ) throw new Error("SURGE_USAGE_STATE_INVALID");
  return row;
}

async function writeState(database: D1Database, scopeHash: string, write: StateWrite, now: number) {
  const stateJson = serializedState(write.state);
  const result = write.version === null
    ? await database.prepare(`
        INSERT OR IGNORE INTO ${STATE_TABLE}
        (scope_hash, state_json, version, updated_at)
        VALUES (?, ?, 0, ?)
      `).bind(scopeHash, stateJson, now).run()
    : await database.prepare(`
        UPDATE ${STATE_TABLE}
        SET state_json = ?, version = version + 1, updated_at = ?
        WHERE scope_hash = ? AND version = ?
      `).bind(stateJson, now, scopeHash, write.version).run();
  return result.meta?.changes === 1;
}

async function incrementCounter(
  database: D1Database,
  scopeHash: string,
  limits: CounterLimits,
  now: number,
): Promise<SurgeUsageDenial | null> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const row = await readState(database, scopeHash);
    const parsed = row ? parseCounterState(row.state_json) : initialCounterState(now);
    if (!parsed) throw new Error("SURGE_USAGE_STATE_INVALID");
    const state = normalizedCounterState(parsed, now);
    if (state.minuteCount >= limits.minute) {
      return {
        allowed: false,
        reason: limits.minuteReason,
        retryAfterSeconds: retryAfter(state.minuteStart, MINUTE_MS, now),
      };
    }
    if (state.dayCount >= limits.day) {
      return {
        allowed: false,
        reason: limits.dayReason,
        retryAfterSeconds: retryAfter(state.dayStart, DAY_MS, now),
      };
    }
    const next: CounterState = {
      ...state,
      minuteCount: state.minuteCount + 1,
      dayCount: state.dayCount + 1,
    };
    if (await writeState(database, scopeHash, { state: next, version: row?.version ?? null }, now)) {
      return null;
    }
  }
  throw new Error("SURGE_USAGE_CAS_EXHAUSTED");
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createSharedSurgeUsageGuard({
  env = process.env,
  getDatabase,
  now = Date.now,
  randomUUID = () => crypto.randomUUID(),
}: SharedSurgeUsageGuardOptions = {}) {
  const configuration = usageConfiguration(env);
  let signingKey: Promise<CryptoKey> | null = null;

  async function hashIdentifier(kind: string, value: string) {
    if (!configuration) throw new Error("SURGE_USAGE_CONFIGURATION");
    signingKey ||= crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(configuration.secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      await signingKey,
      new TextEncoder().encode(`${kind}\u0000${value}`),
    );
    return bytesToHex(new Uint8Array(signature));
  }

  async function releaseLease(database: D1Database, globalScopeHash: string, leaseHash: string) {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const currentTime = now();
      if (!Number.isSafeInteger(currentTime) || currentTime < 0) return;
      const row = await readState(database, globalScopeHash);
      if (!row) return;
      const state = parseGlobalState(row.state_json);
      if (!state) return;
      if (!state.leases.some((lease) => lease.hash === leaseHash)) return;
      const next: GlobalState = {
        ...state,
        leases: state.leases.filter((lease) => lease.hash !== leaseHash),
      };
      if (await writeState(database, globalScopeHash, { state: next, version: row.version }, currentTime)) return;
    }
  }

  async function reserveGlobal(
    database: D1Database,
    globalScopeHash: string,
    requestHash: string,
    leaseHash: string,
    currentTime: number,
    estimatedMicroUsd: number,
  ): Promise<SurgeUsageReservation> {
    if (!configuration) return { allowed: false, reason: "configuration" };
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const row = await readState(database, globalScopeHash);
      const parsed = row ? parseGlobalState(row.state_json) : initialGlobalState(currentTime);
      if (!parsed) throw new Error("SURGE_USAGE_STATE_INVALID");
      const state = normalizedGlobalState(parsed, currentTime);
      const duplicate = state.requests.find((request) => request.hash === requestHash);
      if (duplicate) {
        return {
          allowed: false,
          reason: "duplicate_request",
          retryAfterSeconds: Math.max(1, Math.ceil((duplicate.expiresAt - currentTime) / 1_000)),
        };
      }
      if (state.minuteCount >= configuration.globalMinuteLimit) {
        return {
          allowed: false,
          reason: "global_minute",
          retryAfterSeconds: retryAfter(state.minuteStart, MINUTE_MS, currentTime),
        };
      }
      if (state.leases.length >= configuration.globalInFlightLimit) {
        const earliestExpiry = Math.min(...state.leases.map((lease) => lease.expiresAt));
        return {
          allowed: false,
          reason: "global_in_flight",
          retryAfterSeconds: Math.max(1, Math.ceil((earliestExpiry - currentTime) / 1_000)),
        };
      }
      if (
        state.dailyReservedMicroUsd > configuration.globalDailyMicroUsdLimit
          - estimatedMicroUsd
      ) {
        return {
          allowed: false,
          reason: "global_daily_budget",
          retryAfterSeconds: retryAfter(state.dayStart, DAY_MS, currentTime),
        };
      }
      const next: GlobalState = {
        ...state,
        minuteCount: state.minuteCount + 1,
        dailyReservedMicroUsd: state.dailyReservedMicroUsd + estimatedMicroUsd,
        leases: [...state.leases, {
          hash: leaseHash,
          expiresAt: currentTime + configuration.inFlightLeaseMs,
        }],
        requests: [...state.requests, {
          hash: requestHash,
          expiresAt: currentTime + REQUEST_IDEMPOTENCY_MS,
        }],
      };
      if (await writeState(database, globalScopeHash, { state: next, version: row?.version ?? null }, currentTime)) {
        let released = false;
        return {
          allowed: true,
          reservedMicroUsd: estimatedMicroUsd,
          async release() {
            if (released) return;
            released = true;
            await releaseLease(database, globalScopeHash, leaseHash).catch(() => undefined);
          },
        };
      }
    }
    throw new Error("SURGE_USAGE_CAS_EXHAUSTED");
  }

  return {
    mode: configuration && typeof getDatabase === "function" ? "shared" as const : "unavailable" as const,
    async reserve({
      clientKey,
      networkKey,
      requestKey,
      estimatedMicroUsd,
    }: {
      clientKey: string;
      networkKey: string;
      requestKey: string;
      estimatedMicroUsd: number;
    }): Promise<SurgeUsageReservation> {
      if (!configuration) return { allowed: false, reason: "configuration" };
      if (typeof getDatabase !== "function") return { allowed: false, reason: "unavailable" };
      if (
        typeof clientKey !== "string"
        || !/^[0-9a-f]{64}$/.test(clientKey)
        || typeof networkKey !== "string"
        || !/^[0-9a-f]{64}$/.test(networkKey)
        || typeof requestKey !== "string"
        || !/^[A-Za-z0-9:_-]{16,80}$/.test(requestKey)
      ) return { allowed: false, reason: "invalid_identity" };
      if (
        !Number.isSafeInteger(estimatedMicroUsd)
        || estimatedMicroUsd <= 0
        || estimatedMicroUsd > configuration.globalDailyMicroUsdLimit
      ) return { allowed: false, reason: "invalid_estimate" };
      const currentTime = now();
      if (!Number.isSafeInteger(currentTime) || currentTime < 0) {
        return { allowed: false, reason: "unavailable" };
      }
      try {
        const database = getDatabase();
        if (!database) return { allowed: false, reason: "unavailable" };
        const [clientScopeHash, networkScopeHash, globalScopeHash, requestHash, leaseHash] = await Promise.all([
          hashIdentifier("scope-client", clientKey),
          hashIdentifier("scope-network", networkKey),
          hashIdentifier("scope-global", "surge-model-usage-v1"),
          hashIdentifier("request", requestKey),
          hashIdentifier("lease", `${randomUUID()}\u0000${currentTime}`),
        ]);
        const clientDenial = await incrementCounter(database, clientScopeHash, {
          minute: configuration.clientMinuteLimit,
          day: configuration.clientDailyLimit,
          minuteReason: "client_minute",
          dayReason: "client_day",
        }, currentTime);
        if (clientDenial) return clientDenial;
        const networkDenial = await incrementCounter(database, networkScopeHash, {
          minute: configuration.networkMinuteLimit,
          day: configuration.networkDailyLimit,
          minuteReason: "network_minute",
          dayReason: "network_day",
        }, currentTime);
        if (networkDenial) return networkDenial;
        return await reserveGlobal(
          database,
          globalScopeHash,
          requestHash,
          leaseHash,
          currentTime,
          estimatedMicroUsd,
        );
      } catch {
        return { allowed: false, reason: "unavailable" };
      }
    },
  };
}
