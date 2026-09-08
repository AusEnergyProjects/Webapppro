import {
  deriveTradeJobLifecycle,
  deriveTradeJobLifecycleStatus,
  TRADE_JOB_LIFECYCLE_STATUSES,
  type TradeJobAuditOutcome,
  type TradeJobLifecycleInput,
} from "./trade-job-lifecycle.ts";

export const JOB_REGISTER_OPERATIONAL_STATUSES = TRADE_JOB_LIFECYCLE_STATUSES;

export type JobRegisterOperationalStatus =
  typeof JOB_REGISTER_OPERATIONAL_STATUSES[number];

export const JOB_REGISTER_COLUMN_KEYS = [
  "jobId",
  "actions",
  "firstName",
  "lastName",
  "contactNumber",
  "email",
  "streetAddress",
  "postcode",
  "suburb",
  "state",
  "assignedWorker",
  "scheduleDate",
  "createdDate",
  "operationalStatus",
  "quoteTotalExGst",
  "stc",
  "veec",
  "esc",
  "otherCertificates",
  "service",
] as const;

export type JobRegisterCertificates = {
  state: "pending" | "recorded";
  stc: number;
  veec: number;
  esc: number;
  other: number;
};

export type JobRegisterRecord = {
  jobId: string;
  firstName: string;
  lastName: string;
  contactNumber: string;
  email: string;
  streetAddress: string;
  postcode: string;
  suburb: string;
  state: string;
  assignedWorker: string;
  scheduleDate: string;
  createdDate: string;
  operationalStatus: JobRegisterOperationalStatus;
  auditOutcome: TradeJobAuditOutcome | null;
  quoteTotalExGstCents: number | null;
  certificates: JobRegisterCertificates;
  service: string;
  quoteStatus: string;
  updatedAt: string;
};

export type JobRegisterProjectionInput = {
  jobId: unknown;
  firstName?: unknown;
  lastName?: unknown;
  contactNumber?: unknown;
  email?: unknown;
  addressLine1?: unknown;
  addressLine2?: unknown;
  postcode?: unknown;
  suburb?: unknown;
  state?: unknown;
  assigneeMemberId?: unknown;
  assignedWorker?: unknown;
  scheduleDate?: unknown;
  createdAt?: unknown;
  workStage?: unknown;
  pipelineStage?: unknown;
  hasProgress?: unknown;
  auditOutcome?: unknown;
  certificates?: Partial<Record<"stc" | "veec" | "esc" | "other", unknown>>;
  service?: unknown;
  quoteStatus?: unknown;
  quoteTotalExGstCents?: unknown;
  updatedAt?: unknown;
  canViewCustomer: boolean;
};

export const JOB_REGISTER_CUSTOMER_CONTEXT_SQL = "w.source_type <> 'opportunity' AND COALESCE(d.customer_source, '') <> 'platform_private'";

export function protectedJobCustomerText(expression: string) {
  return `CASE WHEN ${JOB_REGISTER_CUSTOMER_CONTEXT_SQL} THEN COALESCE(${expression}, '') ELSE '' END`;
}

const text = (value: unknown) => String(value || "").trim();

function count(value: unknown) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

export function deriveJobRegisterOperationalStatus(input: TradeJobLifecycleInput): JobRegisterOperationalStatus {
  return deriveTradeJobLifecycleStatus(input);
}

export function projectJobRegisterRecord(input: JobRegisterProjectionInput): JobRegisterRecord {
  const certificates: JobRegisterCertificates = {
    state: "pending",
    stc: count(input.certificates?.stc),
    veec: count(input.certificates?.veec),
    esc: count(input.certificates?.esc),
    other: count(input.certificates?.other),
  };
  const certifiedQuantity = certificates.stc + certificates.veec + certificates.esc + certificates.other;
  if (certifiedQuantity > 0) certificates.state = "recorded";
  const customer = input.canViewCustomer;
  const lifecycle = deriveTradeJobLifecycle({
    workStage: input.workStage,
    pipelineStage: input.pipelineStage,
    scheduleDate: input.scheduleDate,
    hasProgress: input.hasProgress,
    auditOutcome: input.auditOutcome,
  });
  return {
    jobId: text(input.jobId),
    firstName: customer ? text(input.firstName) : "",
    lastName: customer ? text(input.lastName) : "",
    contactNumber: customer ? text(input.contactNumber) : "",
    email: customer ? text(input.email) : "",
    streetAddress: customer
      ? [text(input.addressLine1), text(input.addressLine2)].filter(Boolean).join(", ")
      : "",
    postcode: customer ? text(input.postcode) : "",
    suburb: customer ? text(input.suburb) : "",
    state: customer ? text(input.state).toUpperCase() : "",
    assignedWorker: text(input.assigneeMemberId) ? text(input.assignedWorker) || "Assigned" : "Unassigned",
    scheduleDate: text(input.scheduleDate),
    createdDate: text(input.createdAt),
    operationalStatus: lifecycle.status,
    auditOutcome: lifecycle.auditOutcome,
    quoteTotalExGstCents: input.quoteTotalExGstCents === null || input.quoteTotalExGstCents === undefined
      ? null
      : Math.max(0, Math.round(Number(input.quoteTotalExGstCents) || 0)),
    certificates,
    service: text(input.service),
    quoteStatus: text(input.quoteStatus),
    updatedAt: text(input.updatedAt),
  };
}
