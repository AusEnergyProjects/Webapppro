export type CreditexCalculatorReadAccessType = "compliance" | "installer";

export type CreditexCalculatorRouteErrorDescriptor = Readonly<{
  status: 401 | 503;
  code:
    | "AUTH_REQUIRED"
    | "CREDITEX_SCHEMA_GUARDS_INSTALLING"
    | "CREDITEX_SCHEMA_GUARD_REVIEW_REQUIRED";
  error: string;
  headers?: Readonly<Record<string, string>>;
}>;

type JsonRecord = Record<string, unknown>;

const INSTALLING_SCHEMA_PREFIXES = [
  "CREDITEX_SCHEMA_GUARDS_INSTALLING:",
  "CREDITEX_PRODUCT_REGISTRY_SCHEMA_GUARDS_INSTALLING:",
] as const;

const REVIEW_REQUIRED_SCHEMA_PREFIXES = [
  "CREDITEX_SCHEMA_GUARD_MISMATCH:",
  "CREDITEX_SCHEMA_GUARDS_UNAVAILABLE:",
  "CREDITEX_SCHEMA_MIGRATIONS_REQUIRED:",
  "CREDITEX_PRODUCT_REGISTRY_SCHEMA_GUARD_MISMATCH:",
  "CREDITEX_PRODUCT_REGISTRY_SCHEMA_GUARDS_UNAVAILABLE:",
  "CREDITEX_PRODUCT_REGISTRY_MIGRATIONS_REQUIRED:",
] as const;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function errorCode(error: unknown) {
  if (typeof error === "string") return error;
  const value = record(error);
  if (typeof value?.code === "string") return value.code;
  return error instanceof Error ? error.message : "";
}

export function describeCreditexCalculatorRouteError(
  error: unknown,
): CreditexCalculatorRouteErrorDescriptor | null {
  const code = errorCode(error);
  if (code === "AUTH_REQUIRED") {
    return {
      status: 401,
      code: "AUTH_REQUIRED",
      error: "Sign in to continue.",
    };
  }
  if (INSTALLING_SCHEMA_PREFIXES.some((prefix) => code.startsWith(prefix))) {
    return {
      status: 503,
      code: "CREDITEX_SCHEMA_GUARDS_INSTALLING",
      error: "Preparing the governed Creditex calculator.",
      headers: { "Retry-After": "1" },
    };
  }
  if (
    REVIEW_REQUIRED_SCHEMA_PREFIXES.some((prefix) => code.startsWith(prefix))
  ) {
    return {
      status: 503,
      code: "CREDITEX_SCHEMA_GUARD_REVIEW_REQUIRED",
      error:
        "Creditex calculator integrity controls need a governed upgrade before this request can continue.",
    };
  }
  return null;
}

function projectedLastAttempt(value: unknown) {
  const attempt = record(value);
  if (!attempt) return null;
  return {
    status: attempt.status,
    checkedAt: attempt.checkedAt,
    message: attempt.status === "failed"
      ? "The last controlled registry refresh did not complete."
      : "",
  };
}

function projectedSresSnapshot(value: unknown) {
  const snapshot = record(value);
  if (!snapshot) return null;
  return {
    id: snapshot.id,
    sourceSha256: snapshot.sourceSha256,
    recordCount: snapshot.recordCount,
    activatedAt: snapshot.activatedAt,
  };
}

function projectedRegistryStatus(value: unknown) {
  const status = record(value);
  if (!status) return value;
  const projected: JsonRecord = {
    registryCode: status.registryCode,
    status: status.status,
    freshnessWindowHours: status.freshnessWindowHours,
    lastCheckedAt: status.lastCheckedAt,
    lastAttempt: projectedLastAttempt(status.lastAttempt),
  };
  if (Object.hasOwn(status, "snapshot")) {
    projected.snapshot = projectedSresSnapshot(status.snapshot);
  } else {
    projected.snapshotId = status.snapshotId;
    projected.sourceSha256 = status.sourceSha256;
    projected.recordCount = status.recordCount;
  }
  return projected;
}

export function projectCreditexCalculatorReadResponse<
  TResponse extends JsonRecord,
>(
  accessType: CreditexCalculatorReadAccessType,
  response: TResponse,
): TResponse {
  if (accessType === "compliance") return response;
  const projected: JsonRecord = { ...response };
  if (Object.hasOwn(response, "registry")) {
    projected.registry = projectedRegistryStatus(response.registry);
  }
  if (Array.isArray(response.registries)) {
    projected.registries = response.registries.map(projectedRegistryStatus);
  }
  return projected as TResponse;
}
