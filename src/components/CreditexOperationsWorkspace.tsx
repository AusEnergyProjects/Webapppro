"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { firebaseAuth } from "@/lib/firebase-client";
import styles from "./CreditexOperationsWorkspace.module.css";

type ComplianceRole = "admin" | "case_manager" | "reviewer" | "auditor";

type WorkspaceSession = {
  email: string;
  displayName: string;
  role: ComplianceRole;
  organisation: {
    code: string;
    legalName: string;
    tradingName: string;
  };
};

type ActivitySummary = {
  programName: string;
  activityKey: string;
  registryActivityCode: string;
  title: string;
  version: number;
  specificationPart: string;
  productCategory: string;
  scenarioCode: string;
  scenario: string;
  effectiveFrom: string;
  effectiveTo: string;
  officialSourceVersion: string;
};

type SeedCase = {
  caseId?: string;
  caseNumber: string;
  jobNumber: string;
  installerBusiness: string;
  jurisdiction: string;
  activityDate: string;
  activity: ActivitySummary;
  evidenceStatus: string;
  workflowStatus: string;
  createdAt: string;
  updatedAt: string;
};

type OperationCase = SeedCase & {
  id: string;
  programId: string;
  activityVersionId: string;
  revision: number;
  detailsLoaded: boolean;
  participantId: string;
  assignedTo: string;
  priority: string;
  nextAction: string;
  prerequisites: string[];
  blockers: string[];
  evidence: OperationEvidence[];
  findings: OperationFinding[];
  tasks: OperationTask[];
  assignments: OperationAssignment[];
  equipment: OperationEquipment[];
  decisions: OperationDecision[];
  decisionRequests: OperationDecisionRequest[];
  calculationRuns: OperationCalculationRun[];
  batchItems: OperationBatchItem[];
  events: OperationEvent[];
  privateDetails: OperationPrivateDetails | null;
};

type OperationPrivateDetails = {
  access: JsonRecord;
  job: JsonRecord;
  installer: JsonRecord;
  customer: JsonRecord | null;
  customerContacts: JsonRecord[];
  serviceSite: JsonRecord | null;
  appointments: JsonRecord[];
};

type OperationEvidence = {
  id: string;
  requirementCode: string;
  title: string;
  evidenceType: string;
  timing: string;
  status: string;
  originalRequired: boolean | null;
  metadataRequired: boolean | null;
  gpsRequired: boolean | null;
  receivedAt: string;
};

type EvidenceViewerFacts = {
  receivedAt: string;
  observedAt: string;
  source: string;
  gpsState: string;
  latitude: string;
  longitude: string;
  accuracyMetres: string;
  locationMocked: string;
  metadataState: string;
  originalState: string;
  integrityState: string;
};

type EvidenceViewer = {
  evidenceId: string;
  evidenceLabel: string;
  contentType: string;
  objectUrl: string;
  receiptId: string;
  facts: EvidenceViewerFacts;
};

type OperationAssignment = {
  id: string;
  role: string;
  status: string;
  displayName: string;
  memberRole: string;
  assignedAt: string;
  releasedAt: string;
};

type OperationFinding = {
  id: string;
  code: string;
  severity: string;
  description: string;
  status: string;
  raisedAt: string;
};

type OperationTask = {
  id: string;
  caseId: string;
  caseNumber: string;
  type: string;
  title: string;
  detail: string;
  priority: string;
  status: string;
  assignee: string;
  dueAt: string;
  updatedAt: string;
};

type OperationParticipant = {
  id: string;
  type: string;
  externalReference: string;
  legalName: string;
  tradingName: string;
  abn: string;
  contactEmail: string;
  status: string;
  effectiveFrom: string;
  effectiveTo: string;
};

type OperationEquipment = {
  id: string;
  caseId: string;
  caseNumber: string;
  recordType: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  productRegistry: string;
  productReference: string;
  quantity: number;
  status: string;
  recordedAt: string;
};

type OperationDecision = {
  id: string;
  type: string;
  outcome: string;
  caseRevision: number;
  primaryReviewer: string;
  secondaryReviewer: string;
  decidedAt: string;
};

type OperationDecisionRequest = {
  id: string;
  type: string;
  outcome: string;
  status: string;
  caseRevision: number;
  primaryReviewer: string;
  secondaryReviewer: string;
  basisRecorded: boolean;
  createdAt: string;
  reviewedAt: string;
};

type OperationCalculationRun = {
  id: string;
  calculatorKey: string;
  version: number;
  outputType: string;
  caseRevision: number;
  status: string;
  blockedReason: string;
  runAt: string;
  verifiedAt: string;
};

type OperationBatchItem = {
  id: string;
  batchId: string;
  batchNumber: string;
  caseRevision: number;
  status: string;
  externalReference: string;
  createdAt: string;
  updatedAt: string;
};

type OperationEvent = {
  id: string;
  type: string;
  actorType: string;
  actor: string;
  summary: string;
  createdAt: string;
};

type SubmissionBatch = {
  id: string;
  batchNumber: string;
  programName: string;
  format: string;
  status: string;
  caseCount: number;
  quantity: number;
  externalReference: string;
  updatedAt: string;
};

type CertificateLot = {
  id: string;
  certificateType: string;
  registryReference: string;
  quantity: number;
  status: string;
  vintageFrom: string;
  vintageTo: string;
};

type TradeRecord = {
  id: string;
  certificateType: string;
  counterpartyReference: string;
  quantity: number;
  unitPriceCents: number;
  status: string;
  tradeDate: string;
};

type SettlementRecord = {
  id: string;
  tradeId: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
  dueDate: string;
  status: string;
  settledAt: string;
};

type CalculatorSummary = {
  id: string;
  title: string;
  activityKey: string;
  outputType: string;
  version: number;
  approvalState: string;
  testVectorCount: number;
  passedVectorCount: number;
};

type EvidencePolicySummary = {
  id: string;
  activityKey: string;
  version: number;
  publishState: string;
  requirementsComplete: boolean;
  officialSourceTitle: string;
  officialSourceVersion: string;
  officialSourceCheckedAt: string;
};

type WorkspaceProgram = {
  programId: string;
  programCode: string;
  programName: string;
  schemeKind: string;
  jurisdiction: string;
  administeringBody: string;
  publishState: string;
  caseCount: number;
  activityVersionCount: number;
};

type WorkspaceActivity = {
  activityVersionId: string;
  programId: string;
  programCode: string;
  programName: string;
  activityKey: string;
  version: number;
  title: string;
  serviceCategory: string;
  registryActivityCode: string;
  specificationPart: string;
  productCategory: string;
  scenarioCode: string;
  scenario: string;
  jurisdiction: string;
  effectiveFrom: string;
  effectiveTo: string;
  publishState: string;
  calculationApprovalState: string;
  caseCount: number;
};

type WorkspaceFacet = {
  available: boolean;
  reason: string;
  mode: string;
  options: unknown[];
};

type OperationsFilterState = {
  program: string;
  activity: string;
  lifecycleStatus: string;
  evidenceStatus: string;
  customer: string;
  address: string;
  installer: string;
  workType: string;
  serviceCategory: string;
  createdBy: string;
  createdByType: string;
  fieldWorker: string;
  identifier: string;
  customerType: string;
  jobSource: string;
  workStage: string;
  pipelineStage: string;
  priority: string;
  issueStatus: string;
  appointmentStatus: string;
  appointmentType: string;
  auditState: string;
  certificateStatus: string;
  batchStatus: string;
  submissionStatus: string;
  quoteStatus: string;
  invoiceStatus: string;
  product: string;
  productCategory: string;
  tags: string;
  tagMatch: string;
  installedFrom: string;
  installedTo: string;
  appointmentFrom: string;
  appointmentTo: string;
  pageSize: "25" | "50" | "100";
};

type OperationsSnapshot = {
  loaded: boolean;
  counts: Record<string, number>;
  cases: OperationCase[];
  selectedCase: OperationCase | null;
  tasks: OperationTask[];
  participants: OperationParticipant[];
  equipment: OperationEquipment[];
  submissions: SubmissionBatch[];
  certificates: CertificateLot[];
  trades: TradeRecord[];
  settlements: SettlementRecord[];
  calculators: CalculatorSummary[];
  evidencePolicies: EvidencePolicySummary[];
  reports: Record<string, number>;
  workspace: {
    programs: WorkspaceProgram[];
    activities: WorkspaceActivity[];
    facets: Record<string, WorkspaceFacet>;
    total: number;
    hasNext: boolean;
  };
};

type AccessMember = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  lastLoginAt: string;
};

type AccessInvitation = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
};

type AccessSnapshot = {
  loaded: boolean;
  ownerEmail: string;
  members: AccessMember[];
  invitations: AccessInvitation[];
};

type WorkspaceArea =
  | "queue"
  | "review"
  | "tasks"
  | "participants"
  | "stock"
  | "submissions"
  | "certificates"
  | "reports"
  | "rules"
  | "access";

type CreditexOperationsWorkspaceProps = {
  session: WorkspaceSession;
  seedCases: SeedCase[];
  seedPagination: {
    pageSize: number;
    hasNext: boolean;
    nextCursor: string;
  };
  seedStatus: string;
  seedStatusOptions: readonly string[];
  seedLoadNextLabel: string;
  seedBusy: boolean;
  onSeedStatusChange: (status: string) => void;
  onRefreshSeedCases: () => void;
  onLoadNextSeedCases: () => void;
  onOpenActivityRules: () => void;
};

type JsonRecord = Record<string, unknown>;

const AREAS: Array<{
  id: WorkspaceArea;
  label: string;
  shortLabel: string;
}> = [
  { id: "queue", label: "Work queue", shortLabel: "Queue" },
  { id: "review", label: "Case review / Audit centre", shortLabel: "Review" },
  { id: "tasks", label: "Tasks", shortLabel: "Tasks" },
  { id: "participants", label: "Participants", shortLabel: "People" },
  {
    id: "stock",
    label: "Stock & decommissioning",
    shortLabel: "Stock",
  },
  {
    id: "submissions",
    label: "Submissions & reconciliation",
    shortLabel: "Submit",
  },
  {
    id: "certificates",
    label: "Certificates & settlement",
    shortLabel: "Certificates",
  },
  { id: "reports", label: "Reports", shortLabel: "Reports" },
  { id: "rules", label: "Activity rules", shortLabel: "Rules" },
  { id: "access", label: "Access", shortLabel: "Access" },
];

const EMPTY_OPERATIONS: OperationsSnapshot = {
  loaded: false,
  counts: {},
  cases: [],
  selectedCase: null,
  tasks: [],
  participants: [],
  equipment: [],
  submissions: [],
  certificates: [],
  trades: [],
  settlements: [],
  calculators: [],
  evidencePolicies: [],
  reports: {},
  workspace: {
    programs: [],
    activities: [],
    facets: {},
    total: 0,
    hasNext: false,
  },
};

const EMPTY_FILTERS: OperationsFilterState = {
  program: "",
  activity: "",
  lifecycleStatus: "",
  evidenceStatus: "",
  customer: "",
  address: "",
  installer: "",
  workType: "",
  serviceCategory: "",
  createdBy: "",
  createdByType: "",
  fieldWorker: "",
  identifier: "",
  customerType: "",
  jobSource: "",
  workStage: "",
  pipelineStage: "",
  priority: "",
  issueStatus: "",
  appointmentStatus: "",
  appointmentType: "",
  auditState: "",
  certificateStatus: "",
  batchStatus: "",
  submissionStatus: "",
  quoteStatus: "",
  invoiceStatus: "",
  product: "",
  productCategory: "",
  tags: "",
  tagMatch: "",
  installedFrom: "",
  installedTo: "",
  appointmentFrom: "",
  appointmentTo: "",
  pageSize: "50",
};

const EMPTY_ACCESS: AccessSnapshot = {
  loaded: false,
  ownerEmail: "info@ausenergyassessments.com",
  members: [],
  invitations: [],
};

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function first(source: JsonRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function text(source: JsonRecord, keys: string[], fallback = "") {
  const value = first(source, keys);
  if (value === undefined) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function numberValue(source: JsonRecord, keys: string[], fallback = 0) {
  const value = first(source, keys);
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanValue(source: JsonRecord, keys: string[]) {
  const value = first(source, keys);
  return value === true || value === 1 || value === "1";
}

function optionalBooleanValue(source: JsonRecord, keys: string[]) {
  const value = first(source, keys);
  if (value === undefined) return null;
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return null;
}

function stringList(source: JsonRecord, keys: string[]) {
  const value = first(source, keys);
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function readable(value: string) {
  if (!value) return "Not recorded";
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateOnly(value: string) {
  if (!value) return "Not recorded";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-AU", { dateStyle: "medium" });
}

function dateTime(value: string) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-AU", {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function money(cents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(cents / 100);
}

function requirementFlag(value: boolean | null) {
  if (value === null) return "Unknown";
  return value ? "Required" : "Not required";
}

function parseActivity(value: unknown): ActivitySummary {
  const source = record(value);
  return {
    programName: text(source, ["programName", "program_name"]),
    activityKey: text(source, ["activityKey", "activity_key"]),
    registryActivityCode: text(source, [
      "registryActivityCode",
      "registry_activity_code",
    ]),
    title: text(source, ["title", "activityTitle", "activity_title"]),
    version: numberValue(source, ["version", "activityVersion"], 0),
    specificationPart: text(source, [
      "specificationPart",
      "specification_part",
    ]),
    productCategory: text(source, ["productCategory", "product_category"]),
    scenarioCode: text(source, ["scenarioCode", "scenario_code"]),
    scenario: text(source, ["scenario"]),
    effectiveFrom: text(source, ["effectiveFrom", "effective_from"]),
    effectiveTo: text(source, ["effectiveTo", "effective_to"]),
    officialSourceVersion: text(source, [
      "officialSourceVersion",
      "official_source_version",
    ]),
  };
}

function parsePrivateDetails(value: unknown): OperationPrivateDetails | null {
  const source = record(value);
  if (!Object.keys(source).length) return null;
  return {
    access: record(first(source, ["access"])),
    job: record(first(source, ["job"])),
    installer: record(first(source, ["installer"])),
    customer: first(source, ["customer"])
      ? record(first(source, ["customer"]))
      : null,
    customerContacts: records(first(source, [
      "customerContacts",
      "customer_contacts",
    ])),
    serviceSite: first(source, ["serviceSite", "service_site"])
      ? record(first(source, ["serviceSite", "service_site"]))
      : null,
    appointments: records(first(source, ["appointments"])),
  };
}

function parseEvidence(value: unknown): OperationEvidence {
  const source = record(value);
  return {
    id: text(source, ["id"]),
    requirementCode: text(source, [
      "requirementCode",
      "requirement_code",
      "requirementId",
      "requirement_id",
    ]),
    title: text(source, ["title", "requirementTitle", "requirement_title"]),
    evidenceType: text(source, ["evidenceType", "evidence_type"]),
    timing: text(source, ["timing", "captureTiming", "capture_timing"]),
    status: text(source, ["status"]),
    originalRequired: optionalBooleanValue(source, [
      "originalRequired",
      "original_required",
    ]),
    metadataRequired: optionalBooleanValue(source, [
      "metadataRequired",
      "metadata_required",
    ]),
    gpsRequired: optionalBooleanValue(source, ["gpsRequired", "gps_required"]),
    receivedAt: text(source, ["receivedAt", "received_at"]),
  };
}

function parseAssignment(value: unknown): OperationAssignment {
  const source = record(value);
  return {
    id: text(source, ["id"]),
    role: text(source, ["assignmentRole", "assignment_role"]),
    status: text(source, ["status"]),
    displayName: text(source, ["displayName", "display_name"]),
    memberRole: text(source, ["role", "memberRole", "member_role"]),
    assignedAt: text(source, ["assignedAt", "assigned_at"]),
    releasedAt: text(source, ["releasedAt", "released_at"]),
  };
}

function parseFinding(value: unknown): OperationFinding {
  const source = record(value);
  return {
    id: text(source, ["id"]),
    code: text(source, ["code", "findingCode", "finding_code"]),
    severity: text(source, ["severity"]),
    description: text(source, ["description"]),
    status: text(source, ["status"]),
    raisedAt: text(source, ["raisedAt", "raised_at"]),
  };
}

function parseTask(value: unknown): OperationTask {
  const source = record(value);
  return {
    id: text(source, ["id"]),
    caseId: text(source, ["caseId", "case_id"]),
    caseNumber: text(source, ["caseNumber", "case_number"]),
    type: text(source, ["type", "taskType", "task_type"]),
    title: text(source, ["title"]),
    detail: text(source, ["detail"]),
    priority: text(source, ["priority"]),
    status: text(source, ["status"]),
    assignee: text(source, [
      "assignee",
      "assigneeName",
      "assignee_name",
      "assigneeUserId",
      "assignee_user_id",
    ]),
    dueAt: text(source, ["dueAt", "due_at"]),
    updatedAt: text(source, ["updatedAt", "updated_at"]),
  };
}

function parseEquipment(value: unknown): OperationEquipment {
  const source = record(value);
  return {
    id: text(source, ["id"]),
    caseId: text(source, ["caseId", "case_id"]),
    caseNumber: text(source, ["caseNumber", "case_number"]),
    recordType: text(source, ["recordType", "record_type"]),
    manufacturer: text(source, ["manufacturer"]),
    model: text(source, ["model"]),
    serialNumber: text(source, ["serialNumber", "serial_number"]),
    productRegistry: text(source, ["productRegistry", "product_registry"]),
    productReference: text(source, [
      "productReference",
      "product_reference",
    ]),
    quantity: numberValue(source, ["quantity"], 0),
    status: text(source, ["status"]),
    recordedAt: text(source, ["recordedAt", "recorded_at"]),
  };
}

function parseDecision(value: unknown): OperationDecision {
  const source = record(value);
  return {
    id: text(source, ["id"]),
    type: text(source, ["type", "decisionType", "decision_type"]),
    outcome: text(source, ["outcome"]),
    caseRevision: numberValue(source, ["caseRevision", "case_revision"]),
    primaryReviewer: text(source, [
      "primaryReviewer",
      "primary_reviewer",
      "primaryReviewerUid",
      "primary_reviewer_uid",
    ]),
    secondaryReviewer: text(source, [
      "secondaryReviewer",
      "secondary_reviewer",
      "secondaryReviewerUid",
      "secondary_reviewer_uid",
    ]),
    decidedAt: text(source, ["decidedAt", "decided_at"]),
  };
}

function parseDecisionRequest(value: unknown): OperationDecisionRequest {
  const source = record(value);
  return {
    id: text(source, ["id"]),
    type: text(source, ["type", "decisionType", "decision_type"]),
    outcome: text(source, ["outcome"]),
    status: text(source, ["status"]),
    caseRevision: numberValue(source, ["caseRevision", "case_revision"]),
    primaryReviewer: text(source, [
      "primaryReviewer",
      "primary_reviewer",
    ]),
    secondaryReviewer: text(source, [
      "secondaryReviewer",
      "secondary_reviewer",
    ]),
    basisRecorded: booleanValue(source, ["basisRecorded", "basis_recorded"]),
    createdAt: text(source, ["createdAt", "created_at"]),
    reviewedAt: text(source, ["reviewedAt", "reviewed_at"]),
  };
}

function parseCalculationRun(value: unknown): OperationCalculationRun {
  const source = record(value);
  return {
    id: text(source, ["id"]),
    calculatorKey: text(source, ["calculatorKey", "calculator_key"]),
    version: numberValue(source, ["version"]),
    outputType: text(source, ["outputType", "output_type"]),
    caseRevision: numberValue(source, ["caseRevision", "case_revision"]),
    status: text(source, ["status"]),
    blockedReason: text(source, ["blockedReason", "blocked_reason"]),
    runAt: text(source, ["runAt", "run_at"]),
    verifiedAt: text(source, ["verifiedAt", "verified_at"]),
  };
}

function parseBatchItem(value: unknown): OperationBatchItem {
  const source = record(value);
  return {
    id: text(source, ["id"]),
    batchId: text(source, ["batchId", "batch_id"]),
    batchNumber: text(source, ["batchNumber", "batch_number"]),
    caseRevision: numberValue(source, ["caseRevision", "case_revision"]),
    status: text(source, ["status"]),
    externalReference: text(source, [
      "externalReference",
      "external_reference",
    ]),
    createdAt: text(source, ["createdAt", "created_at"]),
    updatedAt: text(source, ["updatedAt", "updated_at"]),
  };
}

function parseEvent(value: unknown): OperationEvent {
  const source = record(value);
  return {
    id: text(source, ["id"]),
    type: text(source, ["type", "eventType", "event_type"]),
    actorType: text(source, ["actorType", "actor_type"]),
    actor: text(source, [
      "actor",
      "actorName",
      "actor_name",
      "actorUid",
      "actor_uid",
    ]),
    summary: text(source, ["summary"]),
    createdAt: text(source, ["createdAt", "created_at"]),
  };
}

function parseCase(value: unknown): OperationCase {
  const source = record(value);
  const details = record(first(source, ["details", "caseDetails", "case_details"]));
  const combined = { ...source, ...details };
  return {
    id: text(combined, ["id", "caseId", "case_id"]),
    programId: text(combined, ["programId", "program_id"]),
    activityVersionId: text(combined, [
      "activityVersionId",
      "activity_version_id",
    ]),
    revision: numberValue(combined, ["revision"]),
    detailsLoaded: booleanValue(combined, [
      "detailsLoaded",
      "details_loaded",
    ]),
    caseNumber: text(combined, ["caseNumber", "case_number"]),
    jobNumber: text(combined, ["jobNumber", "job_number"]),
    installerBusiness: text(combined, [
      "installerBusiness",
      "installer_business",
    ]),
    jurisdiction: text(combined, ["jurisdiction", "siteJurisdiction"]),
    activityDate: text(combined, ["activityDate", "activity_date"]),
    activity: parseActivity(
      first(combined, [
        "activity",
        "activitySnapshot",
        "activity_snapshot",
      ]) ?? combined,
    ),
    evidenceStatus: text(combined, ["evidenceStatus", "evidence_status"]),
    workflowStatus: text(combined, [
      "workflowStatus",
      "workflow_status",
      "lifecycleStatus",
      "lifecycle_status",
      "status",
    ]),
    createdAt: text(combined, ["createdAt", "created_at"]),
    updatedAt: text(combined, ["updatedAt", "updated_at"]),
    participantId: text(combined, ["participantId", "participant_id"]),
    assignedTo: text(combined, [
      "assignedTo",
      "assigned_to",
      "assigneeName",
      "assignee_name",
    ]),
    priority: text(combined, ["priority"]),
    nextAction: text(combined, ["nextAction", "next_action"]),
    prerequisites: stringList(combined, ["prerequisites"]),
    blockers: stringList(combined, ["blockers"]),
    evidence: records(first(combined, [
      "evidence",
      "evidenceItems",
      "evidence_items",
    ])).map(parseEvidence),
    findings: records(first(combined, ["findings"])).map(parseFinding),
    tasks: records(first(combined, ["tasks"])).map(parseTask),
    assignments: records(first(combined, ["assignments"])).map(parseAssignment),
    equipment: records(first(combined, [
      "equipment",
      "equipmentRecords",
      "equipment_records",
    ])).map(parseEquipment),
    decisions: records(first(combined, ["decisions"])).map(parseDecision),
    decisionRequests: records(first(combined, [
      "decisionRequests",
      "decision_requests",
    ])).map(parseDecisionRequest),
    calculationRuns: records(first(combined, [
      "calculationRuns",
      "calculation_runs",
    ])).map(parseCalculationRun),
    batchItems: records(first(combined, [
      "batchItems",
      "batch_items",
    ])).map(parseBatchItem),
    events: records(first(combined, [
      "events",
      "caseEvents",
      "case_events",
    ])).map(parseEvent),
    privateDetails: parsePrivateDetails(first(combined, [
      "privateDetails",
      "private_details",
    ])),
  };
}

function seedCase(value: SeedCase): OperationCase {
  return {
    ...value,
    id: value.caseId || "",
    programId: "",
    activityVersionId: "",
    revision: 0,
    detailsLoaded: false,
    participantId: "",
    assignedTo: "",
    priority: "",
    nextAction: "",
    prerequisites: [],
    blockers: [],
    evidence: [],
    findings: [],
    tasks: [],
    assignments: [],
    equipment: [],
    decisions: [],
    decisionRequests: [],
    calculationRuns: [],
    batchItems: [],
    events: [],
    privateDetails: null,
  };
}

function parseOperations(value: unknown): OperationsSnapshot {
  const root = record(value);
  const source = record(first(root, ["operations", "workspace", "dashboard"]));
  const actual = Object.keys(source).length ? source : root;
  const workspace = record(first(actual, ["workspace"]));
  const queues = record(first(actual, ["queues"]));
  const rawCounts = record(first(actual, ["counts", "summary"]));
  const counts = Object.fromEntries(
    Object.entries(rawCounts)
      .map(([key, item]) => [key, Number(item)])
      .filter((entry): entry is [string, number] => Number.isFinite(entry[1])),
  );
  const selectedValue = first(actual, [
    "selectedCase",
    "selected_case",
    "caseDetail",
    "case_detail",
    "case",
  ]);
  const selectedCase = selectedValue
      ? parseCase({
        ...record(selectedValue),
        detailsLoaded: true,
        assignments: first(actual, ["assignments"]),
        tasks: first(actual, ["tasks"]),
        evidence: first(actual, ["evidence"]),
        findings: first(actual, ["findings"]),
        equipment: first(actual, ["equipment"]),
        decisions: first(actual, ["decisions"]),
        decisionRequests: first(actual, [
          "decisionRequests",
          "decision_requests",
        ]),
        calculationRuns: first(actual, [
          "calculationRuns",
          "calculation_runs",
        ]),
        batchItems: first(actual, ["batchItems", "batch_items"]),
        events: first(actual, ["caseEvents", "case_events", "events"]),
        privateDetails: first(actual, ["privateDetails", "private_details"]),
      })
    : null;
  return {
    loaded: true,
    counts,
    cases: records(
      first(actual, [
        "cases",
        "workQueue",
        "work_queue",
        "queue",
      ]) ?? first(workspace, ["cases"]),
    ).map(parseCase),
    selectedCase,
    tasks: records(
      first(actual, ["tasks"]) ?? first(queues, ["tasks"]),
    ).map(parseTask),
    participants: records(
      first(actual, ["participants"]) ?? first(queues, ["participants"]),
    ).map((item) => ({
      id: text(item, ["id"]),
      type: text(item, ["type", "participantType", "participant_type"]),
      externalReference: text(item, [
        "externalReference",
        "external_reference",
      ]),
      legalName: text(item, ["legalName", "legal_name"]),
      tradingName: text(item, ["tradingName", "trading_name"]),
      abn: text(item, ["abn"]),
      contactEmail: text(item, ["contactEmail", "contact_email"]),
      status: text(item, ["status"]),
      effectiveFrom: text(item, ["effectiveFrom", "effective_from"]),
      effectiveTo: text(item, ["effectiveTo", "effective_to"]),
    })),
    equipment: records(first(actual, [
      "equipment",
      "equipmentRecords",
      "equipment_records",
    ])).map(parseEquipment),
    submissions: records(
      first(actual, [
        "submissions",
        "submissionBatches",
        "submission_batches",
      ]) ?? first(queues, ["batches"]),
    ).map((item) => ({
      id: text(item, ["id"]),
      batchNumber: text(item, ["batchNumber", "batch_number"]),
      programName: text(item, [
        "programName",
        "program_name",
        "programCode",
        "program_code",
      ]),
      format: text(item, ["format"]),
      status: text(item, ["status"]),
      caseCount: numberValue(item, ["caseCount", "case_count"]),
      quantity: numberValue(item, [
        "quantity",
        "certificateQuantity",
        "certificate_quantity",
      ]),
      externalReference: text(item, [
        "externalReference",
        "external_reference",
      ]),
      updatedAt: text(item, ["updatedAt", "updated_at"]),
    })),
    certificates: records(
      first(actual, [
        "certificates",
        "certificateLots",
        "certificate_lots",
      ]) ?? first(queues, ["certificateLots", "certificate_lots"]),
    ).map((item) => ({
      id: text(item, ["id"]),
      certificateType: text(item, [
        "certificateType",
        "certificate_type",
      ]),
      registryReference: text(item, [
        "registryReference",
        "registry_reference",
        "registryLotReference",
        "registry_lot_reference",
      ]),
      quantity: numberValue(item, ["quantity"]),
      status: text(item, ["status"]),
      vintageFrom: text(item, ["vintageFrom", "vintage_from"]),
      vintageTo: text(item, ["vintageTo", "vintage_to"]),
    })),
    trades: records(
      first(actual, ["trades"]) ?? first(queues, ["trades"]),
    ).map((item) => ({
      id: text(item, ["id"]),
      certificateType: text(item, [
        "certificateType",
        "certificate_type",
      ]),
      counterpartyReference: text(item, [
        "counterpartyReference",
        "counterparty_reference",
      ]),
      quantity: numberValue(item, ["quantity"]),
      unitPriceCents: numberValue(item, [
        "unitPriceCents",
        "unit_price_cents",
      ]),
      status: text(item, ["status"]),
      tradeDate: text(item, ["tradeDate", "trade_date"]),
    })),
    settlements: records(
      first(actual, ["settlements"]) ?? first(queues, ["settlements"]),
    ).map((item) => ({
      id: text(item, ["id"]),
      tradeId: text(item, ["tradeId", "trade_id"]),
      grossCents: numberValue(item, ["grossCents", "gross_cents"]),
      feeCents: numberValue(item, ["feeCents", "fee_cents"]),
      netCents: numberValue(item, ["netCents", "net_cents"]),
      dueDate: text(item, ["dueDate", "due_date"]),
      status: text(item, ["status"]),
      settledAt: text(item, ["settledAt", "settled_at"]),
    })),
    calculators: records(first(actual, [
      "calculators",
      "calculatorVersions",
      "calculator_versions",
    ])).map((item) => ({
      id: text(item, ["id"]),
      title: text(item, ["title", "calculatorKey", "calculator_key"]),
      activityKey: text(item, [
        "activityKey",
        "activity_key",
        "caseNumber",
        "case_number",
      ]),
      outputType: text(item, ["outputType", "output_type"]),
      version: numberValue(item, ["version"]),
      approvalState: text(item, [
        "approvalState",
        "approval_state",
        "status",
      ]),
      testVectorCount: numberValue(item, [
        "testVectorCount",
        "test_vector_count",
      ]),
      passedVectorCount: numberValue(item, [
        "passedVectorCount",
        "passed_vector_count",
      ]),
    })),
    evidencePolicies: records(
      first(actual, [
        "evidencePolicies",
        "evidence_policies",
      ]) ?? first(queues, ["evidencePolicies", "evidence_policies"]),
    ).map((item) => ({
      id: text(item, ["id"]),
      activityKey: text(item, ["activityKey", "activity_key"]),
      version: numberValue(item, ["version"]),
      publishState: text(item, ["publishState", "publish_state"]),
      requirementsComplete: booleanValue(item, [
        "requirementsComplete",
        "requirements_complete",
      ]),
      officialSourceTitle: text(item, [
        "officialSourceTitle",
        "official_source_title",
      ]),
      officialSourceVersion: text(item, [
        "officialSourceVersion",
        "official_source_version",
      ]),
      officialSourceCheckedAt: text(item, [
        "officialSourceCheckedAt",
        "official_source_checked_at",
      ]),
    })),
    reports: Object.fromEntries(
      Object.entries(record(first(actual, ["reports"])))
        .map(([key, item]) => [key, Number(item)])
        .filter((entry): entry is [string, number] => Number.isFinite(entry[1])),
    ),
    workspace: {
      programs: records(first(workspace, ["programs"])).map((item) => ({
        programId: text(item, ["programId", "program_id"]),
        programCode: text(item, ["programCode", "program_code"]),
        programName: text(item, ["programName", "program_name", "name"]),
        schemeKind: text(item, ["schemeKind", "scheme_kind"]),
        jurisdiction: text(item, ["jurisdiction"]),
        administeringBody: text(item, [
          "administeringBody",
          "administering_body",
        ]),
        publishState: text(item, ["publishState", "publish_state"]),
        caseCount: numberValue(item, ["caseCount", "case_count"]),
        activityVersionCount: numberValue(item, [
          "activityVersionCount",
          "activity_version_count",
        ]),
      })),
      activities: records(first(workspace, ["activities"])).map((item) => ({
        activityVersionId: text(item, [
          "activityVersionId",
          "activity_version_id",
        ]),
        programId: text(item, ["programId", "program_id"]),
        programCode: text(item, ["programCode", "program_code"]),
        programName: text(item, ["programName", "program_name"]),
        activityKey: text(item, ["activityKey", "activity_key"]),
        version: numberValue(item, ["version"]),
        title: text(item, ["title"]),
        serviceCategory: text(item, ["serviceCategory", "service_category"]),
        registryActivityCode: text(item, [
          "registryActivityCode",
          "registry_activity_code",
        ]),
        specificationPart: text(item, [
          "specificationPart",
          "specification_part",
        ]),
        productCategory: text(item, [
          "productCategory",
          "product_category",
        ]),
        scenarioCode: text(item, ["scenarioCode", "scenario_code"]),
        scenario: text(item, ["scenario"]),
        jurisdiction: text(item, ["jurisdiction"]),
        effectiveFrom: text(item, ["effectiveFrom", "effective_from"]),
        effectiveTo: text(item, ["effectiveTo", "effective_to"]),
        publishState: text(item, ["publishState", "publish_state"]),
        calculationApprovalState: text(item, [
          "calculationApprovalState",
          "calculation_approval_state",
        ]),
        caseCount: numberValue(item, ["caseCount", "case_count"]),
      })),
      facets: Object.fromEntries(
        Object.entries(record(first(workspace, ["facets"]))).map(
          ([key, value]) => {
            const facet = record(value);
            const options = first(facet, ["options"]);
            return [key, {
              available: booleanValue(facet, ["available"]),
              reason: text(facet, ["reason"]),
              mode: text(facet, ["mode"]),
              options: Array.isArray(options) ? options : [],
            }];
          },
        ),
      ),
      total: numberValue(
        record(first(workspace, ["pagination"])),
        ["total"],
      ),
      hasNext: booleanValue(
        record(first(workspace, ["pagination"])),
        ["hasNext", "has_next"],
      ),
    },
  };
}

function filterQuery(filters: OperationsFilterState) {
  const params = new URLSearchParams();
  const values: Array<[string, string]> = [
    ["program", filters.program],
    ["activity", filters.activity],
    ["status", filters.lifecycleStatus],
    ["evidenceStatus", filters.evidenceStatus],
    ["customer", filters.customer],
    ["address", filters.address],
    ["installer", filters.installer],
    ["workType", filters.workType],
    ["serviceCategory", filters.serviceCategory],
    ["createdBy", filters.createdBy],
    ["createdByType", filters.createdByType],
    ["fieldWorker", filters.fieldWorker],
    ["identifier", filters.identifier],
    ["customerType", filters.customerType],
    ["jobSource", filters.jobSource],
    ["workStage", filters.workStage],
    ["pipelineStage", filters.pipelineStage],
    ["priority", filters.priority],
    ["issueStatus", filters.issueStatus],
    ["appointmentStatus", filters.appointmentStatus],
    ["appointmentType", filters.appointmentType],
    ["auditState", filters.auditState],
    ["certificateState", filters.certificateStatus],
    ["batchState", filters.batchStatus],
    ["submissionStatus", filters.submissionStatus],
    ["quoteStatus", filters.quoteStatus],
    ["invoiceStatus", filters.invoiceStatus],
    ["product", filters.product],
    ["productCategory", filters.productCategory],
    ["tag", filters.tags],
    ["tagMatch", filters.tagMatch],
    ["installedFrom", filters.installedFrom],
    ["installedTo", filters.installedTo],
    ["appointmentFrom", filters.appointmentFrom],
    ["appointmentTo", filters.appointmentTo],
    ["pageSize", filters.pageSize],
  ];
  for (const [key, value] of values) {
    const normal = value.trim();
    if (normal) params.set(key, normal);
  }
  return params.toString();
}

function facetOptions(facet: WorkspaceFacet | undefined) {
  return (facet?.options || [])
    .map((value) => {
      if (typeof value === "string") {
        return { value, label: readable(value), count: 0 };
      }
      const item = record(value);
      const optionValue = text(item, [
        "value",
        "id",
        "code",
        "status",
      ]);
      return {
        value: optionValue,
        label: text(item, ["label", "name"], readable(optionValue)),
        count: numberValue(item, ["total", "count"]),
      };
    })
    .filter((item) => item.value);
}

function activeFilterCount(filters: OperationsFilterState) {
  return Object.entries(filters)
    .filter(([key, value]) => key !== "pageSize" && Boolean(value.trim()))
    .length;
}

function parseAccess(value: unknown): AccessSnapshot {
  const root = record(value);
  const sourceCandidate = record(first(root, ["access", "workspace"]));
  const source = Object.keys(sourceCandidate).length ? sourceCandidate : root;
  return {
    loaded: true,
    ownerEmail: text(source, [
      "ownerEmail",
      "owner_email",
      "initialOwnerEmail",
      "initial_owner_email",
    ], "info@ausenergyassessments.com"),
    members: records(first(source, ["members", "users"])).map((item) => ({
      id: text(item, ["id", "membershipId", "membership_id"]),
      email: text(item, ["email"]),
      displayName: text(item, ["displayName", "display_name"]),
      role: text(item, ["role"]),
      status: text(item, ["status"]),
      lastLoginAt: text(item, ["lastLoginAt", "last_login_at"]),
    })),
    invitations: records(first(source, ["invitations"])).map((item) => ({
      id: text(item, ["id"]),
      email: text(item, ["email"]),
      displayName: text(item, ["displayName", "display_name"]),
      role: text(item, ["role"]),
      status: text(item, ["status"]),
      expiresAt: text(item, ["expiresAt", "expires_at"]),
      createdAt: text(item, ["createdAt", "created_at"]),
    })),
  };
}

async function authenticatedJson(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const activeUser = firebaseAuth.currentUser;
  if (!activeUser) throw new Error("Sign in to continue.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await activeUser.getIdToken()}`);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    cache: "no-store",
  });
  const responseText = await response.text();
  let result: unknown = {};
  if (responseText) {
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error(
        "The operations service returned an unreadable response. Refresh and try again.",
      );
    }
  }
  const body = record(result);
  if (!response.ok || body.ok === false) {
    throw new Error(
      text(body, ["error"], `The operations request failed (${response.status}).`),
    );
  }
  return result;
}

function metric(
  snapshot: OperationsSnapshot,
  keys: string[],
  fallback: number,
) {
  for (const key of keys) {
    if (snapshot.counts[key] !== undefined) return snapshot.counts[key];
  }
  return fallback;
}

function nextCaseAction(item: OperationCase) {
  if (item.nextAction) return item.nextAction;
  if (!item.detailsLoaded) {
    return "Load the case workspace before relying on findings, evidence or decision records.";
  }
  const openFinding = item.findings.find((finding) => finding.status === "open");
  if (openFinding) {
    return `Resolve ${openFinding.code || "the open compliance finding"} before the case advances.`;
  }
  const openTask = item.tasks.find((task) =>
    ["open", "in_progress", "blocked"].includes(task.status)
  );
  if (openTask) return `Complete or resolve task: ${openTask.title}.`;
  if (!["complete", "accepted", "verified"].includes(item.evidenceStatus)) {
    return `Review the recorded evidence state: ${readable(item.evidenceStatus)}.`;
  }
  if (!item.decisions.length) {
    return "Record the required compliance decision after confirming the complete evidence policy.";
  }
  return "No further local action has been recorded.";
}

function observedPrerequisites(item: OperationCase) {
  if (item.prerequisites.length) return item.prerequisites;
  if (!item.detailsLoaded) {
    return [
      "Detailed case records have not loaded. No finding, evidence or decision absence is implied.",
    ];
  }
  const activityRecorded = Boolean(
    item.activity.activityKey
    || item.activity.registryActivityCode
    || item.activity.title,
  );
  return [
    `Governed activity snapshot: ${activityRecorded ? "recorded" : "missing"}.`,
    `Activity date: ${item.activityDate ? dateOnly(item.activityDate) : "missing"}.`,
    `Evidence state: ${readable(item.evidenceStatus)}.`,
    `Open findings returned: ${
      item.findings.filter((finding) => finding.status === "open").length
    }.`,
  ];
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className={styles.empty}>{children}</div>;
}

function UnavailableState({ children }: { children: React.ReactNode }) {
  return <p className={styles.unavailable}>{children}</p>;
}

function StatusPill({ value }: { value: string }) {
  return (
    <span className={styles.statusPill} data-status={value || "unknown"}>
      {readable(value)}
    </span>
  );
}

function DisabledAction({
  children,
  reason,
}: {
  children: React.ReactNode;
  reason: string;
}) {
  const reasonId = useId();
  return (
    <span className={styles.disabledActionWrap}>
      <button
        className={styles.disabledAction}
        type="button"
        disabled
        aria-describedby={reasonId}
      >
        {children}
      </button>
      <span className={styles.disabledReason} id={reasonId}>
        {reason}
      </span>
    </span>
  );
}

type FilterOption = {
  value: string;
  label: string;
  count?: number;
};

function FilterSelect({
  label,
  value,
  options,
  onChange,
  allLabel = "All",
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  allLabel?: string;
}) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
            {option.count ? ` (${option.count})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterInput({
  label,
  value,
  onChange,
  type = "search",
  placeholder = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "search" | "date";
  placeholder?: string;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function UnavailableFilter({
  label,
  facet,
}: {
  label: string;
  facet?: WorkspaceFacet;
}) {
  return (
    <div className={styles.unavailableFilter}>
      <span>{label}</span>
      <small>
        {facet?.reason
          || "No authoritative TLink field is currently available for this filter."}
      </small>
    </div>
  );
}

function AdvancedFilters({
  filters,
  workspace,
  loading,
  onChange,
  onApply,
  onClear,
}: {
  filters: OperationsFilterState;
  workspace: OperationsSnapshot["workspace"];
  loading: boolean;
  onChange: (key: keyof OperationsFilterState, value: string) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  const options = (key: string) => facetOptions(workspace.facets[key]);
  const staticOptions = (...values: string[]) =>
    values.map((value) => ({ value, label: readable(value) }));
  const activities = workspace.activities.filter(
    (activity) => !filters.program || activity.programId === filters.program,
  );
  return (
    <section
      className={styles.advancedFilters}
      aria-labelledby="creditex-advanced-filter-title"
    >
      <div className={styles.advancedFilterHeader}>
        <div>
          <span className={styles.kicker}>Dataforce-parity search</span>
          <h4 id="creditex-advanced-filter-title">Advanced case filters</h4>
          <p>
            Search the organisation-wide compliance workspace. Customer and
            exact address matches are evaluated server-side and remain hidden
            from the default result list.
          </p>
        </div>
        <div className={styles.filterActions}>
          <button type="button" onClick={onClear}>Clear</button>
          <button
            className={styles.primaryAction}
            type="button"
            disabled={loading}
            onClick={onApply}
          >
            {loading ? "Applying..." : "Apply filters"}
          </button>
        </div>
      </div>

      <div className={styles.filterAccordion}>
        <details open>
          <summary>Status filters</summary>
          <div className={styles.filterFields}>
            <FilterSelect
              label="Case lifecycle"
              value={filters.lifecycleStatus}
              options={options("lifecycleStatus")}
              onChange={(value) => onChange("lifecycleStatus", value)}
            />
            <FilterSelect
              label="Evidence status"
              value={filters.evidenceStatus}
              options={options("evidenceStatus")}
              onChange={(value) => onChange("evidenceStatus", value)}
            />
            <FilterSelect
              label="Submission status"
              value={filters.submissionStatus}
              options={options("submissionStatus")}
              onChange={(value) => onChange("submissionStatus", value)}
            />
            <FilterSelect
              label="Certificate status"
              value={filters.certificateStatus}
              options={options("certificateState")}
              onChange={(value) => onChange("certificateStatus", value)}
            />
            <FilterSelect
              label="Batch status"
              value={filters.batchStatus}
              options={options("batchState")}
              onChange={(value) => onChange("batchStatus", value)}
            />
            <FilterSelect
              label="Quotation status"
              value={filters.quoteStatus}
              options={options("quoteStatus")}
              onChange={(value) => onChange("quoteStatus", value)}
            />
            <FilterSelect
              label="Invoice status"
              value={filters.invoiceStatus}
              options={options("invoiceStatus")}
              onChange={(value) => onChange("invoiceStatus", value)}
            />
            <div className={styles.filterSuggestions}>
              <span>Invoicing &amp; submission filters</span>
              <small>
                Quotation, invoice, submission, batch and certificate states
                can be combined in this group.
              </small>
            </div>
            <UnavailableFilter
              label="Sub status"
              facet={workspace.facets.subStatus}
            />
            <UnavailableFilter
              label="Claim state"
              facet={workspace.facets.claimState}
            />
          </div>
        </details>

        <details>
          <summary>Work &amp; personnel</summary>
          <div className={styles.filterFields}>
            <FilterSelect
              label="Work type"
              value={filters.workType}
              options={options("workType")}
              onChange={(value) => onChange("workType", value)}
            />
            <FilterSelect
              label="Service category"
              value={filters.serviceCategory}
              options={options("serviceCategory")}
              onChange={(value) => onChange("serviceCategory", value)}
            />
            <FilterInput
              label="Installer business"
              value={filters.installer}
              placeholder="Business or installer"
              onChange={(value) => onChange("installer", value)}
            />
            <FilterInput
              label="Field worker"
              value={filters.fieldWorker}
              placeholder="Assigned field worker"
              onChange={(value) => onChange("fieldWorker", value)}
            />
            <FilterInput
              label="Created by"
              value={filters.createdBy}
              placeholder="Name or identity"
              onChange={(value) => onChange("createdBy", value)}
            />
            <FilterSelect
              label="Creator type"
              value={filters.createdByType}
              options={staticOptions("installer", "compliance", "platform")}
              onChange={(value) => onChange("createdByType", value)}
            />
            <FilterSelect
              label="Priority"
              value={filters.priority}
              options={options("priority")}
              onChange={(value) => onChange("priority", value)}
            />
          </div>
        </details>

        <details>
          <summary>Client &amp; agent</summary>
          <div className={styles.filterFields}>
            <FilterSelect
              label="Program / scheme"
              value={filters.program}
              options={workspace.programs.map((program) => ({
                value: program.programId,
                label: `${program.programCode || program.jurisdiction} · ${
                  program.programName
                }`,
                count: program.caseCount,
              }))}
              onChange={(value) => onChange("program", value)}
            />
            <UnavailableFilter
              label="Client"
              facet={workspace.facets.client}
            />
            <UnavailableFilter
              label="Agent"
              facet={workspace.facets.agent}
            />
            <UnavailableFilter
              label="Participant"
              facet={workspace.facets.participant}
            />
          </div>
        </details>

        <details>
          <summary>Customer &amp; address</summary>
          <div className={styles.filterFields}>
            <FilterSelect
              label="Customer type"
              value={filters.customerType}
              options={options("customerType")}
              onChange={(value) => onChange("customerType", value)}
            />
            <FilterInput
              label="Customer"
              value={filters.customer}
              placeholder="Name, business, email or phone"
              onChange={(value) => onChange("customer", value)}
            />
            <FilterInput
              label="Property address"
              value={filters.address}
              placeholder="Street, suburb, state or postcode"
              onChange={(value) => onChange("address", value)}
            />
          </div>
        </details>

        <details>
          <summary>Job filters</summary>
          <div className={styles.filterFields}>
            <FilterInput
              label="Case / job identifier"
              value={filters.identifier}
              placeholder="Case, job or work order"
              onChange={(value) => onChange("identifier", value)}
            />
            <FilterSelect
              label="Job source"
              value={filters.jobSource}
              options={options("jobSource")}
              onChange={(value) => onChange("jobSource", value)}
            />
            <FilterSelect
              label="Work stage"
              value={filters.workStage}
              options={options("workStage")}
              onChange={(value) => onChange("workStage", value)}
            />
            <FilterSelect
              label="Pipeline stage"
              value={filters.pipelineStage}
              options={options("pipelineStage")}
              onChange={(value) => onChange("pipelineStage", value)}
            />
            <FilterSelect
              label="Issue status"
              value={filters.issueStatus}
              options={options("issueStatus")}
              onChange={(value) => onChange("issueStatus", value)}
            />
            <FilterInput
              label="Installed from"
              type="date"
              value={filters.installedFrom}
              onChange={(value) => onChange("installedFrom", value)}
            />
            <FilterInput
              label="Installed to"
              type="date"
              value={filters.installedTo}
              onChange={(value) => onChange("installedTo", value)}
            />
          </div>
        </details>

        <details>
          <summary>Appointment filters</summary>
          <div className={styles.filterFields}>
            <FilterSelect
              label="Appointment type"
              value={filters.appointmentType}
              options={options("appointmentType")}
              onChange={(value) => onChange("appointmentType", value)}
            />
            <FilterInput
              label="Appointment status"
              value={filters.appointmentStatus}
              placeholder="Scheduled, completed..."
              onChange={(value) => onChange("appointmentStatus", value)}
            />
            <FilterInput
              label="Appointment from"
              type="date"
              value={filters.appointmentFrom}
              onChange={(value) => onChange("appointmentFrom", value)}
            />
            <FilterInput
              label="Appointment to"
              type="date"
              value={filters.appointmentTo}
              onChange={(value) => onChange("appointmentTo", value)}
            />
            <UnavailableFilter
              label="Appointment outcome"
              facet={workspace.facets.appointmentOutcome}
            />
            <UnavailableFilter
              label="Other appointment filters"
              facet={workspace.facets.appointmentOtherFilters}
            />
          </div>
        </details>

        <details>
          <summary>Tag filters</summary>
          <div className={styles.filterFields}>
            <FilterInput
              label="Tags"
              value={filters.tags}
              placeholder="Comma-separated tags"
              onChange={(value) => onChange("tags", value)}
            />
            <FilterSelect
              label="Tag match"
              value={filters.tagMatch}
              allLabel="Any selected tag"
              options={staticOptions("any", "all")}
              onChange={(value) => onChange("tagMatch", value)}
            />
            {options("tags").length > 0 && (
              <div className={styles.filterSuggestions}>
                <span>Available tags</span>
                <small>
                  {options("tags").map((option) => option.label).join(", ")}
                </small>
              </div>
            )}
          </div>
        </details>

        <details>
          <summary>Product filters</summary>
          <div className={styles.filterFields}>
            <FilterSelect
              label="Activity"
              value={filters.activity}
              options={activities.map((activity) => ({
                value: activity.activityVersionId,
                label: `${
                  activity.registryActivityCode || activity.activityKey
                } · ${activity.title} · v${activity.version}`,
                count: activity.caseCount,
              }))}
              onChange={(value) => onChange("activity", value)}
            />
            <FilterSelect
              label="Product category"
              value={filters.productCategory}
              options={options("productCategory")}
              onChange={(value) => onChange("productCategory", value)}
            />
            <FilterInput
              label="Product / equipment"
              value={filters.product}
              placeholder="Manufacturer, model, serial or registry"
              onChange={(value) => onChange("product", value)}
            />
            <UnavailableFilter
              label="Product type"
              facet={workspace.facets.productType}
            />
          </div>
        </details>

        <details>
          <summary>Audit filters</summary>
          <div className={styles.filterFields}>
            <FilterSelect
              label="Audit state"
              value={filters.auditState}
              options={options("auditState")}
              onChange={(value) => onChange("auditState", value)}
            />
            <UnavailableFilter
              label="Completed / not completed"
              facet={workspace.facets.auditCompletion}
            />
          </div>
        </details>

        <details>
          <summary>Other filters</summary>
          <div className={styles.filterFields}>
            <FilterSelect
              label="Rows per page"
              value={filters.pageSize}
              allLabel="50 rows"
              options={staticOptions("25", "50", "100")}
              onChange={(value) => onChange(
                "pageSize",
                (value || "50") as OperationsFilterState["pageSize"],
              )}
            />
            <UnavailableFilter
              label="Additional columns"
              facet={workspace.facets.additionalColumns}
            />
            <UnavailableFilter
              label="Other Dataforce filters"
              facet={workspace.facets.otherFilters}
            />
          </div>
        </details>
      </div>
    </section>
  );
}

export function CreditexOperationsWorkspace({
  session,
  seedCases,
  seedPagination,
  seedStatus,
  seedLoadNextLabel,
  seedBusy,
  onRefreshSeedCases,
  onLoadNextSeedCases,
  onOpenActivityRules,
}: CreditexOperationsWorkspaceProps) {
  const [area, setArea] = useState<WorkspaceArea>("queue");
  const [operations, setOperations] =
    useState<OperationsSnapshot>(EMPTY_OPERATIONS);
  const [access, setAccess] = useState<AccessSnapshot>(EMPTY_ACCESS);
  const [selectedCaseKey, setSelectedCaseKey] = useState("");
  const [query, setQuery] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [draftFilters, setDraftFilters] =
    useState<OperationsFilterState>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] =
    useState<OperationsFilterState>(EMPTY_FILTERS);
  const [loadingOperations, setLoadingOperations] = useState(true);
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [operationsError, setOperationsError] = useState("");
  const [accessError, setAccessError] = useState("");
  const [operationBusy, setOperationBusy] = useState("");
  const [operationNotice, setOperationNotice] = useState("");
  const [operationActionError, setOperationActionError] = useState("");
  const [evidenceViewer, setEvidenceViewer] =
    useState<EvidenceViewer | null>(null);
  const [evidenceViewerBusy, setEvidenceViewerBusy] = useState("");
  const [evidenceViewerError, setEvidenceViewerError] = useState("");
  const [evidenceAccessReceipts, setEvidenceAccessReceipts] =
    useState<Record<string, string>>({});
  const [taskForm, setTaskForm] = useState({
    taskType: "review",
    title: "",
    detail: "",
    priority: "normal",
  });
  const [assignmentForm, setAssignmentForm] = useState({
    complianceUserId: "",
    assignmentRole: "primary_reviewer",
  });
  const [findingForm, setFindingForm] = useState({
    evidenceId: "",
    requirementId: "",
    findingCode: "",
    severity: "minor",
    description: "",
  });
  const [resolutionForm, setResolutionForm] = useState({
    findingId: "",
    resolutionNote: "",
  });
  const [evidenceReviewForm, setEvidenceReviewForm] = useState({
    evidenceId: "",
    status: "under_review",
    reviewNote: "",
  });
  const [decisionForm, setDecisionForm] = useState({
    decisionType: "evidence_complete",
    basis: "",
    confirmed: false,
  });
  const [participantForm, setParticipantForm] = useState({
    participantType: "installer",
    externalReference: "",
    legalName: "",
    tradingName: "",
    abn: "",
    contactEmail: "",
  });
  const [abilityForm, setAbilityForm] = useState({
    participantId: "",
    abilityCode: "",
    abilityRole: "",
    effectiveFrom: "",
    effectiveTo: "",
    evidenceReference: "",
  });
  const [equipmentForm, setEquipmentForm] = useState({
    recordType: "installed",
    status: "installed",
    manufacturer: "",
    model: "",
    serialNumber: "",
    productRegistry: "",
    productReference: "",
    quantity: "1",
    evidenceReference: "",
  });
  const [batchForm, setBatchForm] = useState({
    batchNumber: "",
    externalReference: "",
    format: "manual",
  });
  const [stageBatchId, setStageBatchId] = useState("");

  const loadOperations = useCallback(async (caseId = "") => {
    setLoadingOperations(true);
    setOperationsError("");
    try {
      const operationFilters = filterQuery(appliedFilters);
      const queryString = caseId
        ? `?caseId=${encodeURIComponent(caseId)}`
        : operationFilters
          ? `?${operationFilters}`
          : "";
      const result = await authenticatedJson(
        `/api/creditex/operations${queryString}`,
      );
      const parsed = parseOperations(result);
      setOperations((current) =>
        caseId
          ? {
              ...current,
              loaded: true,
              selectedCase: parsed.selectedCase,
            }
          : parsed
      );
    } catch (error) {
      setOperationsError(
        error instanceof Error
          ? error.message
          : "The operational workspace could not be loaded.",
      );
    } finally {
      setLoadingOperations(false);
    }
  }, [appliedFilters]);

  const loadAccess = useCallback(async () => {
    if (session.role !== "admin") return;
    setLoadingAccess(true);
    setAccessError("");
    try {
      setAccess(parseAccess(await authenticatedJson("/api/creditex/access")));
    } catch (error) {
      setAccessError(
        error instanceof Error
          ? error.message
          : "Access records could not be loaded.",
      );
    } finally {
      setLoadingAccess(false);
    }
  }, [session.role]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadOperations();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadOperations]);

  useEffect(() => {
    if (area !== "access") return;
    if (access.loaded) return;
    const timeout = window.setTimeout(() => {
      void loadAccess();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [access.loaded, area, loadAccess]);

  const operationalCases = operations.loaded
    ? operations.cases
    : seedCases.map(seedCase);
  useEffect(() => {
    const currentExists = operationalCases.some(
      (item) => item.id === selectedCaseKey || item.caseNumber === selectedCaseKey,
    );
    const firstCase = operationalCases[0];
    if (!firstCase?.id) {
      if (!selectedCaseKey && !operations.selectedCase) return;
      const timeout = window.setTimeout(() => {
        setSelectedCaseKey("");
        setOperations((current) => ({
          ...current,
          selectedCase: null,
        }));
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    if (selectedCaseKey && currentExists) return;
    const timeout = window.setTimeout(() => {
      setSelectedCaseKey(firstCase.id);
      void loadOperations(firstCase.id);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [
    loadOperations,
    operationalCases,
    operations.selectedCase,
    selectedCaseKey,
  ]);

  useEffect(() => {
    if (session.role !== "admin") return;
    const timeout = window.setTimeout(() => {
      void loadAccess();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadAccess, session.role]);

  useEffect(() => {
    const objectUrl = evidenceViewer?.objectUrl;
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [evidenceViewer?.objectUrl]);

  useEffect(() => {
    if (!evidenceViewer) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEvidenceViewer(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [evidenceViewer]);

  const selectedCase = useMemo(() => {
    const queueCase = operationalCases.find(
      (item) =>
        item.id === selectedCaseKey || item.caseNumber === selectedCaseKey,
    ) || operationalCases[0] || null;
    if (
      operations.selectedCase
      && (
        operations.selectedCase.id === selectedCaseKey
        || operations.selectedCase.caseNumber === selectedCaseKey
      )
    ) {
      return {
        ...(queueCase || operations.selectedCase),
        ...operations.selectedCase,
        jobNumber:
          operations.selectedCase.jobNumber || queueCase?.jobNumber || "",
        installerBusiness:
          operations.selectedCase.installerBusiness
          || queueCase?.installerBusiness
          || "",
        activity: {
          ...(queueCase?.activity || operations.selectedCase.activity),
          ...operations.selectedCase.activity,
        },
      };
    }
    return queueCase;
  }, [operationalCases, operations.selectedCase, selectedCaseKey]);

  const filteredCases = useMemo(() => {
    const normalQuery = query.trim().toLowerCase();
    return operationalCases.filter((item) => {
      if (
        !operations.loaded
        &&
        seedStatus !== "open"
        && seedStatus !== "all"
        && item.workflowStatus !== seedStatus
      ) return false;
      if (
        !operations.loaded
        &&
        seedStatus === "open"
        && ["accepted", "rejected", "closed"].includes(item.workflowStatus)
      ) return false;
      if (!normalQuery) return true;
      return [
        item.caseNumber,
        item.jobNumber,
        item.installerBusiness,
        item.jurisdiction,
        item.activity.programName,
        item.activity.registryActivityCode,
        item.activity.activityKey,
        item.activity.title,
      ].some((value) => value.toLowerCase().includes(normalQuery));
    });
  }, [operationalCases, operations.loaded, query, seedStatus]);

  function chooseCase(item: OperationCase, nextArea: WorkspaceArea = "review") {
    const key = item.id || item.caseNumber;
    setEvidenceViewer(null);
    setEvidenceViewerError("");
    setSelectedCaseKey(key);
    setArea(nextArea);
    if (item.id) void loadOperations(item.id);
  }

  async function refreshAll() {
    onRefreshSeedCases();
    await loadOperations();
    if (selectedCase?.id) await loadOperations(selectedCase.id);
    if (area === "access") await loadAccess();
  }

  function applyFilters(nextFilters = draftFilters) {
    setSelectedCaseKey("");
    setOperations((current) => ({ ...current, selectedCase: null }));
    setAppliedFilters(nextFilters);
    setDraftFilters(nextFilters);
    setArea("queue");
  }

  function clearFilters() {
    applyFilters(EMPTY_FILTERS);
  }

  function updateDraftFilter(
    key: keyof OperationsFilterState,
    value: string,
  ) {
    setDraftFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === "program" ? { activity: "" } : {}),
    }));
  }

  function chooseProgram(programId: string) {
    const nextFilters = {
      ...appliedFilters,
      program: programId,
      activity: "",
    };
    setShowAdvancedFilters(false);
    applyFilters(nextFilters);
  }

  async function runOperation(
    action: string,
    body: Record<string, unknown>,
    successMessage: string,
  ) {
    setOperationBusy(action);
    setOperationActionError("");
    setOperationNotice("");
    try {
      await authenticatedJson("/api/creditex/operations", {
        method: "POST",
        body: JSON.stringify({ action, ...body }),
      });
      setOperationNotice(successMessage);
      onRefreshSeedCases();
      await loadOperations();
      if (selectedCase?.id) await loadOperations(selectedCase.id);
      return true;
    } catch (error) {
      setOperationActionError(
        error instanceof Error
          ? error.message
          : "The local operation could not be completed.",
      );
      return false;
    } finally {
      setOperationBusy("");
    }
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCase?.id) {
      setOperationActionError(
        "The selected queue record does not include an operational case identifier. Refresh after the case workspace endpoint is available.",
      );
      return;
    }
    const created = await runOperation("create_task", {
      caseId: selectedCase.id,
      ...taskForm,
    }, "The local case task was created.");
    if (created) {
      setTaskForm({
        taskType: "review",
        title: "",
        detail: "",
        priority: "normal",
      });
    }
  }

  async function completeTask(taskId: string) {
    if (!window.confirm("Mark this compliance task complete?")) return;
    await runOperation(
      "complete_task",
      { taskId },
      "The task was marked complete.",
    );
  }

  async function assignCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCase?.id || !assignmentForm.complianceUserId) return;
    const created = await runOperation("assign_case", {
      caseId: selectedCase.id,
      ...assignmentForm,
    }, "The named case assignment was created.");
    if (created) {
      setAssignmentForm((current) => ({
        ...current,
        complianceUserId: "",
      }));
    }
  }

  async function releaseAssignment(assignmentId: string) {
    if (!window.confirm("Release this active case assignment?")) return;
    await runOperation(
      "release_case_assignment",
      { assignmentId },
      "The case assignment was released.",
    );
  }

  async function openEvidence(evidence: OperationEvidence) {
    if (!evidence.id) {
      setEvidenceViewerError(
        "This evidence row does not include an authorised viewer identifier.",
      );
      return;
    }
    const activeUser = firebaseAuth.currentUser;
    if (!activeUser) {
      setEvidenceViewerError("Sign in to open protected evidence.");
      return;
    }

    setEvidenceViewerBusy(evidence.id);
    setEvidenceViewerError("");
    try {
      const response = await fetch(
        `/api/creditex/evidence/${encodeURIComponent(evidence.id)}`,
        {
          headers: {
            Accept: "image/jpeg,image/png,image/webp,application/pdf",
            Authorization: `Bearer ${await activeUser.getIdToken()}`,
          },
          cache: "no-store",
        },
      );
      if (!response.ok) {
        const body = record(await response.json().catch(() => ({})));
        throw new Error(
          text(
            body,
            ["error"],
            `The evidence viewer request failed (${response.status}).`,
          ),
        );
      }

      const contentType = (response.headers.get("Content-Type") || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      if (
        ![
          "image/jpeg",
          "image/png",
          "image/webp",
          "application/pdf",
        ].includes(contentType)
      ) {
        throw new Error(
          "The evidence response is not a supported image or PDF.",
        );
      }
      const receiptId =
        response.headers.get("X-Creditex-Evidence-Receipt") || "";
      if (!receiptId) {
        throw new Error(
          "The evidence viewer did not return its required audit receipt.",
        );
      }
      const blob = await response.blob();
      if (!blob.size) {
        throw new Error("The stored evidence item was empty.");
      }
      const objectUrl = URL.createObjectURL(blob);
      const header = (name: string) => response.headers.get(name) || "";
      setEvidenceAccessReceipts((current) => ({
        ...current,
        [evidence.id]: receiptId,
      }));
      setEvidenceViewer({
        evidenceId: evidence.id,
        evidenceLabel:
          evidence.requirementCode || evidence.title || "Evidence item",
        contentType,
        objectUrl,
        receiptId,
        facts: {
          receivedAt: header("X-Creditex-Evidence-Received-At"),
          observedAt: header("X-Creditex-Evidence-Observed-At"),
          source: header("X-Creditex-Evidence-Source"),
          gpsState: header("X-Creditex-Evidence-Gps-State"),
          latitude: header("X-Creditex-Evidence-Latitude"),
          longitude: header("X-Creditex-Evidence-Longitude"),
          accuracyMetres: header(
            "X-Creditex-Evidence-Accuracy-Metres",
          ),
          locationMocked: header(
            "X-Creditex-Evidence-Location-Mocked",
          ),
          metadataState: header(
            "X-Creditex-Evidence-Metadata-State",
          ),
          originalState: header(
            "X-Creditex-Evidence-Original-State",
          ),
          integrityState: header(
            "X-Creditex-Evidence-Integrity",
          ),
        },
      });
    } catch (error) {
      setEvidenceViewerError(
        error instanceof Error
          ? error.message
          : "The evidence item could not be opened.",
      );
    } finally {
      setEvidenceViewerBusy("");
    }
  }

  async function createFinding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCase?.id) return;
    const created = await runOperation("create_finding", {
      caseId: selectedCase.id,
      ...findingForm,
    }, "The compliance finding was recorded.");
    if (created) {
      setFindingForm({
        evidenceId: "",
        requirementId: "",
        findingCode: "",
        severity: "minor",
        description: "",
      });
    }
  }

  async function resolveFinding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resolutionForm.findingId) return;
    const resolved = await runOperation("resolve_finding", resolutionForm,
      "The compliance finding was resolved with its recorded note.");
    if (resolved) {
      setResolutionForm({ findingId: "", resolutionNote: "" });
    }
  }

  async function reviewEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!evidenceReviewForm.evidenceId) return;
    const evidenceAccessReceiptId =
      evidenceAccessReceipts[evidenceReviewForm.evidenceId] || "";
    if (!evidenceAccessReceiptId) {
      setOperationActionError(
        "Open this exact evidence item in the audited viewer before recording its review outcome.",
      );
      return;
    }
    const reviewed = await runOperation(
      "review_evidence",
      { ...evidenceReviewForm, evidenceAccessReceiptId },
      "The evidence review outcome was recorded and the case evidence state was recalculated.",
    );
    if (reviewed) {
      setEvidenceReviewForm({
        evidenceId: "",
        status: "under_review",
        reviewNote: "",
      });
    }
  }

  async function requestDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !selectedCase?.id
      || !decisionForm.confirmed
      || decisionBlockReason
    ) return;
    const requiresDualControl = decisionForm.decisionType !== "evidence_complete";
    const requested = await runOperation("record_decision", {
      caseId: selectedCase.id,
      decisionType: decisionForm.decisionType,
      outcome: "approved",
      reviewerNote: decisionForm.basis.trim(),
    }, requiresDualControl
      ? `${readable(decisionForm.decisionType)} approval was requested from an independent second reviewer.`
      : "The evidence-complete decision was recorded for this exact case revision.");
    if (requested) {
      setDecisionForm({
        decisionType: decisionForm.decisionType === "evidence_complete"
          ? "eligibility"
          : decisionForm.decisionType,
        basis: "",
        confirmed: false,
      });
    }
  }

  async function approveDecisionRequest(request: OperationDecisionRequest) {
    if (!selectedCase || request.caseRevision !== selectedCase.revision) {
      setOperationActionError(
        "This request belongs to an earlier case revision and cannot be approved. Start a new review against the current revision.",
      );
      return;
    }
    if (!window.confirm(
      "Confirm that you are an independent second reviewer and approve this unchanged decision request?",
    )) return;
    const approved = await runOperation("record_decision", {
      caseId: selectedCase?.id,
      decisionRequestId: request.id,
      decisionType: request.type,
      outcome: request.outcome,
    }, "The independent secondary decision was recorded.");
    if (approved && request.type === "eligibility") {
      setDecisionForm((current) => ({
        ...current,
        decisionType: "ready_to_submit",
        basis: "",
        confirmed: false,
      }));
    }
  }

  async function createParticipant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await runOperation(
      "add_participant",
      participantForm,
      "The pending participant record was created.",
    );
    if (created) {
      setParticipantForm({
        participantType: "installer",
        externalReference: "",
        legalName: "",
        tradingName: "",
        abn: "",
        contactEmail: "",
      });
    }
  }

  async function createParticipantAbility(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !selectedCase?.programId
      || !selectedCase.activityVersionId
      || !abilityForm.participantId
    ) return;
    const created = await runOperation("add_participant_ability", {
      participantId: abilityForm.participantId,
      programId: selectedCase.programId,
      activityVersionId: selectedCase.activityVersionId,
      abilityCode: abilityForm.abilityCode,
      abilityRole: abilityForm.abilityRole,
      effectiveFrom: abilityForm.effectiveFrom,
      effectiveTo: abilityForm.effectiveTo,
      evidenceSnapshot: {
        sourceReference: abilityForm.evidenceReference.trim(),
        caseId: selectedCase.id,
        recordedThrough: "creditex_portal",
      },
    }, "The pending participant ability was recorded.");
    if (created) {
      setAbilityForm({
        participantId: "",
        abilityCode: "",
        abilityRole: "",
        effectiveFrom: "",
        effectiveTo: "",
        evidenceReference: "",
      });
    }
  }

  async function addEquipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCase?.id) return;
    const created = await runOperation("add_equipment", {
      caseId: selectedCase.id,
      recordType: equipmentForm.recordType,
      status: equipmentForm.status,
      manufacturer: equipmentForm.manufacturer,
      model: equipmentForm.model,
      serialNumber: equipmentForm.serialNumber,
      productRegistry: equipmentForm.productRegistry,
      productReference: equipmentForm.productReference,
      quantity: Number(equipmentForm.quantity),
      evidenceSnapshot: {
        sourceReference: equipmentForm.evidenceReference.trim(),
        caseRevision: selectedCase.revision,
        recordedThrough: "creditex_portal",
      },
    }, "The case equipment record was created.");
    if (created) {
      setEquipmentForm({
        recordType: "installed",
        status: "installed",
        manufacturer: "",
        model: "",
        serialNumber: "",
        productRegistry: "",
        productReference: "",
        quantity: "1",
        evidenceReference: "",
      });
    }
  }

  async function createDraftBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCase?.programId) return;
    const created = await runOperation("create_draft_batch", {
      programId: selectedCase.programId,
      ...batchForm,
    }, "The local draft submission batch was created.");
    if (created) {
      setBatchForm({
        batchNumber: "",
        externalReference: "",
        format: "manual",
      });
    }
  }

  async function stageSelectedCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCase?.id || !stageBatchId) return;
    const hasReadyDecision = selectedCase.decisions.some(
      (decision) =>
        decision.type === "ready_to_submit"
        && decision.outcome === "approved"
        && decision.caseRevision === selectedCase.revision,
    );
    const hasOpenFinding = selectedCase.findings.some(
      (finding) => finding.status === "open",
    );
    if (
      !hasReadyDecision
      || hasOpenFinding
      || selectedCase.workflowStatus !== "ready_for_submission"
    ) {
      setOperationActionError(
        "Staging requires the current case revision to be ready for submission, with its exact-revision approval and no open findings. The server revalidates the complete pinned evidence policy and applicable calculator contract.",
      );
      return;
    }
    const staged = await runOperation("stage_batch_item", {
      caseId: selectedCase.id,
      batchId: stageBatchId,
    }, "The current case revision was staged in the local draft batch.");
    if (staged) setStageBatchId("");
  }

  async function removeBatchItem(batchItemId: string) {
    if (!window.confirm("Remove this case revision from its local draft batch?")) {
      return;
    }
    await runOperation(
      "remove_batch_item",
      { batchItemId },
      "The case revision was removed from the local draft batch.",
    );
  }

  const canManageAssignments = ["admin", "case_manager"].includes(session.role);
  const canViewEvidence = ["admin", "reviewer", "auditor"].includes(
    session.role,
  );
  const canReviewCompliance = ["admin", "reviewer"].includes(
    session.role,
  );
  const canRecordDecision = ["admin", "reviewer"].includes(session.role);
  const canManageParticipants = ["admin", "case_manager"].includes(session.role);
  const canRecordEquipment = ["admin", "case_manager", "reviewer"].includes(
    session.role,
  );
  const canManageBatches = ["admin", "case_manager"].includes(session.role);
  const selectedReviewEvidence = selectedCase?.evidence.find(
    (evidence) => evidence.id === evidenceReviewForm.evidenceId,
  ) || null;
  const selectedEvidenceAccessReceipt = evidenceReviewForm.evidenceId
    ? evidenceAccessReceipts[evidenceReviewForm.evidenceId] || ""
    : "";
  const assignmentRoleMembers = access.members.filter((member) => {
    if (member.status !== "active") return false;
    const compatibleRoles: Record<string, string[]> = {
      case_manager: ["admin", "case_manager"],
      primary_reviewer: ["admin", "reviewer"],
      secondary_reviewer: ["admin", "reviewer"],
      auditor: ["admin", "auditor"],
    };
    return compatibleRoles[assignmentForm.assignmentRole]?.includes(member.role);
  });
  const displayedEquipment = selectedCase?.detailsLoaded
    ? selectedCase.equipment.map((item) => ({
        ...item,
        caseId: item.caseId || selectedCase.id,
        caseNumber: item.caseNumber || selectedCase.caseNumber,
      }))
    : [];
  const draftBatches = operations.submissions.filter(
    (batch) => batch.status === "draft",
  );
  const pendingDecisionRequests = selectedCase?.decisionRequests.filter(
    (request) => request.status === "pending",
  ) || [];
  const currentRevisionApprovedDecision = (decisionType: string) =>
    Boolean(selectedCase?.decisions.some(
      (decision) =>
        decision.type === decisionType
        && decision.outcome === "approved"
        && decision.caseRevision === selectedCase.revision,
    ));
  const caseHasEvidenceDecision = currentRevisionApprovedDecision(
    "evidence_complete",
  );
  const caseHasEligibilityDecision = currentRevisionApprovedDecision(
    "eligibility",
  );
  const caseHasReadyDecision = Boolean(selectedCase?.decisions.some(
    (decision) =>
      decision.type === "ready_to_submit"
      && decision.outcome === "approved"
      && decision.caseRevision === selectedCase.revision,
  ));
  const caseHasOpenFinding = Boolean(selectedCase?.findings.some(
    (finding) => finding.status === "open",
  ));
  const caseHasVerifiedCalculation = Boolean(selectedCase?.calculationRuns.some(
    (run) =>
      run.status === "verified"
      && run.caseRevision === selectedCase?.revision,
  ));
  const hasCurrentPendingDecision = (decisionType: string) =>
    pendingDecisionRequests.some(
      (request) =>
        request.type === decisionType
        && request.caseRevision === selectedCase?.revision,
    );
  const decisionAlreadyApproved =
    decisionForm.decisionType === "evidence_complete"
      ? caseHasEvidenceDecision
      : decisionForm.decisionType === "eligibility"
        ? caseHasEligibilityDecision
        : caseHasReadyDecision;
  const decisionBlockReason = !selectedCase?.detailsLoaded
    ? "Load a case workspace before recording a decision."
    : decisionAlreadyApproved
      ? "This decision is already approved for the current case revision."
      : hasCurrentPendingDecision(decisionForm.decisionType)
        ? "An independent review is already pending for this decision and case revision."
        : decisionForm.decisionType === "evidence_complete"
          && !["complete", "verified"].includes(selectedCase.evidenceStatus)
          ? "The case evidence state is not complete. The server also checks every requirement in the pinned published policy."
          : decisionForm.decisionType === "eligibility"
            && !caseHasEvidenceDecision
          ? "Approve evidence completeness for this exact case revision first."
          : decisionForm.decisionType === "ready_to_submit"
            && !caseHasEligibilityDecision
            ? "Complete independent eligibility approval for this exact case revision first."
            : caseHasOpenFinding
              ? "Resolve all open compliance findings before approval."
              : "";
  const canStageObservedCase = Boolean(
    selectedCase?.detailsLoaded
    && caseHasReadyDecision
    && !caseHasOpenFinding
    && selectedCase.workflowStatus === "ready_for_submission",
  );

  const openTaskCount = metric(
    operations,
    ["openTasks", "open_tasks", "tasksOpen"],
    operations.tasks.filter((item) =>
      ["open", "in_progress", "blocked"].includes(item.status)
    ).length,
  );
  const evidenceReviewCount = metric(
    operations,
    ["evidenceReview", "evidence_review", "evidenceAwaitingReview"],
    operationalCases.filter((item) =>
      ["received", "under_review", "in_review"].includes(item.evidenceStatus)
    ).length,
  );
  const openCaseCount = metric(
    operations,
    ["openCases", "open_cases", "casesOpen"],
    operationalCases.filter(
      (item) => !["accepted", "rejected", "closed"].includes(
        item.workflowStatus,
      ),
    ).length,
  );
  const submissionCount = metric(
    operations,
    ["submissionBatches", "submission_batches"],
    operations.submissions.length,
  );
  const activeFilters = activeFilterCount(appliedFilters);

  return (
    <section className={styles.workspace} aria-label="Creditex operations">
      <header className={styles.workspaceHeader}>
        <div>
          <span className={styles.eyebrow}>Creditex operations control</span>
          <h2>Every program, one governed review path</h2>
          <p>
            Program workspaces and every governed activity version feed one
            audited case, evidence, submission and certificate workflow.
          </p>
        </div>
        <button
          className={styles.refreshButton}
          type="button"
          disabled={loadingOperations || seedBusy}
          onClick={() => void refreshAll()}
        >
          {loadingOperations ? "Refreshing..." : "Refresh workspace"}
        </button>
      </header>

      {operationsError && (
        <p className={styles.error} role="alert">
          {operationsError} The protected case queue remains available below
          when its existing endpoint has loaded.
        </p>
      )}
      {operationNotice && (
        <p className={styles.success} role="status">{operationNotice}</p>
      )}
      {operationActionError && (
        <p className={styles.error} role="alert">{operationActionError}</p>
      )}
      {evidenceViewerError && (
        <p className={styles.error} role="alert">{evidenceViewerError}</p>
      )}
      {operations.loaded && (
        <p className={styles.warning} role="status">
          The case search returned {operations.workspace.total} matching{" "}
          {operations.workspace.total === 1 ? "case" : "cases"}; this page
          shows up to {appliedFilters.pageSize}. Other operational categories
          remain bounded lists, so an absent row never proves no record exists.
        </p>
      )}

      <div className={styles.summaryGrid} aria-label="Operational snapshot">
        <div>
          <span>Open cases</span>
          <strong>{openCaseCount}</strong>
          <small>Loaded paged case queue</small>
        </div>
        <div>
          <span>Evidence review</span>
          <strong>{evidenceReviewCount}</strong>
          <small>Observed in loaded cases</small>
        </div>
        <div>
          <span>Open tasks</span>
          <strong>{openTaskCount}</strong>
          <small>Up to 50 returned records</small>
        </div>
        <div>
          <span>Submission batches</span>
          <strong>{submissionCount}</strong>
          <small>All recorded batches</small>
        </div>
      </div>

      <div className={styles.layout}>
        <nav className={styles.areaNav} aria-label="Creditex work areas">
          {AREAS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={area === item.id ? "page" : undefined}
              onClick={() => {
                if (item.id === "rules" && session.role === "admin") {
                  onOpenActivityRules();
                  return;
                }
                setArea(item.id);
              }}
            >
              <span>{item.label}</span>
              <small>{item.shortLabel}</small>
            </button>
          ))}
        </nav>

        <div className={styles.areaContent}>
          {area === "queue" && (
            <section aria-labelledby="operations-queue-title">
              <div className={styles.sectionHeader}>
                <div>
                  <h3 id="operations-queue-title">Work queue</h3>
                  <p>
                    Privacy-minimised cases only. Select a case once, then
                    continue through its review workspace.
                  </p>
                </div>
                <div className={styles.filters}>
                  <label>
                    <span>Search loaded cases</span>
                    <input
                      type="search"
                      value={query}
                      placeholder="Case, job, installer or activity"
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  <button
                    className={styles.advancedFilterToggle}
                    type="button"
                    aria-expanded={showAdvancedFilters}
                    onClick={() => setShowAdvancedFilters((current) => !current)}
                  >
                    Advanced filters
                    {activeFilters ? ` (${activeFilters} active)` : ""}
                  </button>
                </div>
              </div>

              {showAdvancedFilters && (
                <AdvancedFilters
                  filters={draftFilters}
                  workspace={operations.workspace}
                  loading={loadingOperations}
                  onChange={updateDraftFilter}
                  onApply={() => applyFilters()}
                  onClear={clearFilters}
                />
              )}

              <div className={styles.queueContext} role="status">
                <span>
                  {appliedFilters.program
                    ? operations.workspace.programs.find(
                        (program) =>
                          program.programId === appliedFilters.program,
                      )?.programName || "Selected program"
                    : "All governed programs"}
                </span>
                <strong>
                  {operations.workspace.total} matching{" "}
                  {operations.workspace.total === 1 ? "case" : "cases"}
                </strong>
                {operations.workspace.hasNext && (
                  <small>
                    More results exist. Narrow the filters or increase rows per
                    page.
                  </small>
                )}
              </div>

              <div className={styles.caseWorkspace}>
                <div className={styles.queueList}>
                  {filteredCases.map((item) => (
                    <button
                      className={styles.queueItem}
                      data-selected={
                        selectedCase?.caseNumber === item.caseNumber
                      }
                      key={item.id || item.caseNumber}
                      type="button"
                      onClick={() => chooseCase(item)}
                    >
                      <span className={styles.queueTopline}>
                        <strong>{item.caseNumber}</strong>
                        <StatusPill value={item.workflowStatus} />
                      </span>
                      <span>{item.installerBusiness || "Installer not recorded"}</span>
                      <small>
                        {item.jobNumber || "No job number"} |{" "}
                        {item.activity.registryActivityCode
                          || item.activity.activityKey
                          || "Activity not recorded"}
                      </small>
                      <small>
                        Evidence: {readable(item.evidenceStatus)}
                      </small>
                    </button>
                  ))}
                  {!filteredCases.length && (
                    <EmptyState>
                      {query
                        ? "No loaded cases match this search."
                        : "No cases match this workflow status."}
                    </EmptyState>
                  )}
                  {seedPagination.hasNext && (
                    <button
                      className={styles.loadButton}
                      type="button"
                      disabled={seedBusy}
                      onClick={onLoadNextSeedCases}
                    >
                      {seedLoadNextLabel}
                    </button>
                  )}
                </div>

                <div className={styles.selectedCase}>
                  {selectedCase ? (
                    <CaseOverview
                      item={selectedCase}
                      onReview={() => {
                        if (selectedCase.detailsLoaded) {
                          setArea("review");
                        } else {
                          chooseCase(selectedCase, "review");
                        }
                      }}
                    />
                  ) : (
                    <EmptyState>
                      Select a case when work enters the compliance queue.
                    </EmptyState>
                  )}
                </div>
              </div>
            </section>
          )}

          {area === "review" && (
            <>
              <CaseReview
                item={selectedCase}
                loading={loadingOperations}
                canViewEvidence={canViewEvidence}
                evidenceAccessReceipts={evidenceAccessReceipts}
                openingEvidenceId={evidenceViewerBusy}
                onOpenEvidence={(evidence) => void openEvidence(evidence)}
              />
              {selectedCase?.detailsLoaded && (
                <section
                  className={styles.controlCentre}
                  aria-labelledby="creditex-local-controls-title"
                >
                  <SectionTitle
                    id="creditex-local-controls-title"
                    title="Local compliance controls"
                    description="Every action below records a local, audited workflow event. None submits to a registry or creates certificates."
                  />
                  <div className={styles.controlGrid}>
                    <section aria-labelledby="creditex-assignment-control">
                      <h4 id="creditex-assignment-control">Assignments</h4>
                      {canManageAssignments && session.role === "admin" ? (
                        <form className={styles.localForm} onSubmit={assignCase}>
                          <label>
                            Assignment role
                            <select
                              value={assignmentForm.assignmentRole}
                              onChange={(event) =>
                                setAssignmentForm({
                                  assignmentRole: event.target.value,
                                  complianceUserId: "",
                                })}
                            >
                              {[
                                "case_manager",
                                "primary_reviewer",
                                "secondary_reviewer",
                                "auditor",
                              ].map((value) => (
                                <option key={value} value={value}>
                                  {readable(value)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Named active member
                            <select
                              required
                              value={assignmentForm.complianceUserId}
                              onChange={(event) =>
                                setAssignmentForm((current) => ({
                                  ...current,
                                  complianceUserId: event.target.value,
                                }))}
                            >
                              <option value="">Choose a member</option>
                              {assignmentRoleMembers.map((member) => (
                                <option key={member.id} value={member.id}>
                                  {member.displayName || member.email}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            className={`${styles.primaryAction} ${styles.formWide}`}
                            type="submit"
                            disabled={
                              !assignmentForm.complianceUserId
                              || operationBusy === "assign_case"
                            }
                          >
                            Assign named member
                          </button>
                          {!assignmentRoleMembers.length && (
                            <p className={`${styles.formNote} ${styles.formWide}`}>
                              No compatible active members were returned by the
                              admin access API.
                            </p>
                          )}
                        </form>
                      ) : canManageAssignments ? (
                        <UnavailableState>
                          The case-manager role can create assignments, but the
                          current operations API does not return a
                          privacy-minimised list of assignable member IDs.
                        </UnavailableState>
                      ) : (
                        <UnavailableState>
                          Your role can view assignments but cannot change them.
                        </UnavailableState>
                      )}
                      <div className={styles.compactList}>
                        {selectedCase.assignments.map((assignment) => (
                          <article key={assignment.id}>
                            <span>
                              <strong>
                                {assignment.displayName || "Named member unavailable"}
                              </strong>
                              <StatusPill value={assignment.status} />
                            </span>
                            <p>
                              {readable(assignment.role)} | Member role{" "}
                              {readable(assignment.memberRole)}
                            </p>
                            <small>Assigned {dateTime(assignment.assignedAt)}</small>
                            {canManageAssignments
                              && assignment.status === "assigned" && (
                              <button
                                className={styles.inlineAction}
                                type="button"
                                disabled={
                                  operationBusy === "release_case_assignment"
                                }
                                onClick={() =>
                                  void releaseAssignment(assignment.id)}
                              >
                                Release assignment
                              </button>
                            )}
                          </article>
                        ))}
                        {!selectedCase.assignments.length && (
                          <UnavailableState>
                            No assignment records were returned for this case.
                          </UnavailableState>
                        )}
                      </div>
                    </section>

                    <section aria-labelledby="creditex-evidence-control">
                      <h4 id="creditex-evidence-control">Evidence review</h4>
                      {canReviewCompliance ? (
                        <form className={styles.localForm} onSubmit={reviewEvidence}>
                          <label>
                            Reviewable evidence record
                            <select
                              required
                              value={evidenceReviewForm.evidenceId}
                              onChange={(event) =>
                                setEvidenceReviewForm((current) => ({
                                  ...current,
                                  evidenceId: event.target.value,
                                }))}
                            >
                              <option value="">Choose evidence</option>
                              {selectedCase.evidence
                                .filter((item) =>
                                  ["received", "under_review"].includes(item.status))
                                .map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.requirementCode || item.id} |{" "}
                                    {readable(item.status)}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <button
                            className={`${styles.inlineAction} ${styles.formWide}`}
                            type="button"
                            disabled={
                              !selectedReviewEvidence
                              || evidenceViewerBusy === selectedReviewEvidence.id
                            }
                            onClick={() => {
                              if (selectedReviewEvidence) {
                                void openEvidence(selectedReviewEvidence);
                              }
                            }}
                          >
                            {selectedReviewEvidence
                                && evidenceViewerBusy === selectedReviewEvidence.id
                              ? "Opening audited evidence..."
                              : "Open selected evidence"}
                          </button>
                          <label>
                            Review outcome
                            <select
                              disabled={!selectedEvidenceAccessReceipt}
                              value={evidenceReviewForm.status}
                              onChange={(event) =>
                                setEvidenceReviewForm((current) => ({
                                  ...current,
                                  status: event.target.value,
                                }))}
                            >
                              {["under_review", "accepted", "rejected"].map(
                                (value) => (
                                  <option key={value} value={value}>
                                    {readable(value)}
                                  </option>
                                ),
                              )}
                            </select>
                          </label>
                          <label className={styles.formWide}>
                            Review note
                            <textarea
                              disabled={!selectedEvidenceAccessReceipt}
                              required={evidenceReviewForm.status !== "under_review"}
                              maxLength={4000}
                              value={evidenceReviewForm.reviewNote}
                              onChange={(event) =>
                                setEvidenceReviewForm((current) => ({
                                  ...current,
                                  reviewNote: event.target.value,
                                }))}
                              placeholder={
                                evidenceReviewForm.status === "under_review"
                                  ? "Optional note while review remains open"
                                  : "Required basis for acceptance or rejection"
                              }
                            />
                          </label>
                          <button
                            className={`${styles.primaryAction} ${styles.formWide}`}
                            type="submit"
                            aria-describedby="creditex-evidence-view-requirement"
                            disabled={
                              !evidenceReviewForm.evidenceId
                              || !selectedEvidenceAccessReceipt
                              || (
                                evidenceReviewForm.status !== "under_review"
                                && !evidenceReviewForm.reviewNote.trim()
                              )
                              || operationBusy === "review_evidence"
                            }
                          >
                            Record evidence review
                          </button>
                          <p
                            className={`${styles.formNote} ${styles.formWide}`}
                            id="creditex-evidence-view-requirement"
                          >
                            {selectedEvidenceAccessReceipt
                              ? `Audited view receipt retained for this evidence: ${selectedEvidenceAccessReceipt}.`
                              : "Open this exact evidence item in the audited viewer before any review control is enabled."}
                            {" "}This updates one evidence record only. It does
                            not mark the case evidence policy complete.
                          </p>
                        </form>
                      ) : (
                        <UnavailableState>
                          Your role can view authorised evidence state, but
                          auditors and case managers cannot record a review
                          outcome.
                        </UnavailableState>
                      )}
                    </section>

                    <section aria-labelledby="creditex-finding-control">
                      <h4 id="creditex-finding-control">Findings</h4>
                      {canReviewCompliance ? (
                        <>
                          <form className={styles.localForm} onSubmit={createFinding}>
                            <label>
                              Finding code
                              <input
                                required
                                maxLength={120}
                                value={findingForm.findingCode}
                                onChange={(event) =>
                                  setFindingForm((current) => ({
                                    ...current,
                                    findingCode: event.target.value,
                                  }))}
                              />
                            </label>
                            <label>
                              Severity
                              <select
                                value={findingForm.severity}
                                onChange={(event) =>
                                  setFindingForm((current) => ({
                                    ...current,
                                    severity: event.target.value,
                                  }))}
                              >
                                {["information", "minor", "major", "critical"].map(
                                  (value) => (
                                    <option key={value} value={value}>
                                      {readable(value)}
                                    </option>
                                  ),
                                )}
                              </select>
                            </label>
                            <label>
                              Linked evidence, optional
                              <select
                                value={findingForm.evidenceId}
                                onChange={(event) => {
                                  const evidence = selectedCase.evidence.find(
                                    (item) => item.id === event.target.value,
                                  );
                                  setFindingForm((current) => ({
                                    ...current,
                                    evidenceId: event.target.value,
                                    requirementId:
                                      evidence?.requirementCode || "",
                                  }));
                                }}
                              >
                                <option value="">Case-level finding</option>
                                {selectedCase.evidence.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.requirementCode || item.id}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className={styles.formWide}>
                              Finding description
                              <textarea
                                required
                                maxLength={4000}
                                value={findingForm.description}
                                onChange={(event) =>
                                  setFindingForm((current) => ({
                                    ...current,
                                    description: event.target.value,
                                  }))}
                              />
                            </label>
                            <button
                              className={`${styles.primaryAction} ${styles.formWide}`}
                              type="submit"
                              disabled={operationBusy === "create_finding"}
                            >
                              Record finding
                            </button>
                          </form>
                          <form className={styles.localForm} onSubmit={resolveFinding}>
                            <label>
                              Open finding
                              <select
                                required
                                value={resolutionForm.findingId}
                                onChange={(event) =>
                                  setResolutionForm((current) => ({
                                    ...current,
                                    findingId: event.target.value,
                                  }))}
                              >
                                <option value="">Choose a finding</option>
                                {selectedCase.findings
                                  .filter((item) => item.status === "open")
                                  .map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.code || item.id}
                                    </option>
                                  ))}
                              </select>
                            </label>
                            <label className={styles.formWide}>
                              Resolution note
                              <textarea
                                required
                                maxLength={4000}
                                value={resolutionForm.resolutionNote}
                                onChange={(event) =>
                                  setResolutionForm((current) => ({
                                    ...current,
                                    resolutionNote: event.target.value,
                                  }))}
                              />
                            </label>
                            <button
                              className={`${styles.primaryAction} ${styles.formWide}`}
                              type="submit"
                              disabled={
                                !resolutionForm.findingId
                                || operationBusy === "resolve_finding"
                              }
                            >
                              Resolve finding with note
                            </button>
                          </form>
                        </>
                      ) : (
                        <UnavailableState>
                          Your role can view findings but cannot create or
                          resolve them.
                        </UnavailableState>
                      )}
                    </section>

                    <section aria-labelledby="creditex-decision-control">
                      <h4 id="creditex-decision-control">
                        Governed compliance decisions
                      </h4>
                      <ol className={styles.gateList}>
                        <li data-ready={caseHasEvidenceDecision}>
                          Evidence complete, exact revision
                        </li>
                        <li data-ready={caseHasEligibilityDecision}>
                          Eligibility independently approved, exact revision
                        </li>
                        <li data-ready={caseHasReadyDecision}>
                          Ready to submit independently approved, exact revision
                        </li>
                      </ol>
                      {canRecordDecision ? (
                        <form
                          className={styles.localForm}
                          onSubmit={requestDecision}
                        >
                          <div className={`${styles.formIntro} ${styles.formWide}`}>
                            <strong>
                              {decisionForm.decisionType === "evidence_complete"
                                ? "Record evidence completeness"
                                : `Request ${readable(decisionForm.decisionType)} approval`}
                            </strong>
                            <p>
                              {decisionForm.decisionType === "evidence_complete"
                                ? "This records an immutable local decision for the current revision after the server validates every requirement in the pinned published evidence policy."
                                : "This records a pending local decision request. A different named reviewer must approve the unchanged request for this exact case revision."}
                            </p>
                          </div>
                          <label className={styles.formWide}>
                            Decision step
                            <select
                              value={decisionForm.decisionType}
                              onChange={(event) =>
                                setDecisionForm((current) => ({
                                  ...current,
                                  decisionType: event.target.value,
                                  confirmed: false,
                                }))}
                            >
                              <option value="evidence_complete">
                                Evidence complete
                              </option>
                              <option
                                value="eligibility"
                                disabled={!caseHasEvidenceDecision}
                              >
                                Eligibility
                              </option>
                              <option
                                value="ready_to_submit"
                                disabled={!caseHasEligibilityDecision}
                              >
                                Ready to submit
                              </option>
                            </select>
                          </label>
                          <label className={styles.formWide}>
                            Reviewer basis
                            <textarea
                              required
                              minLength={20}
                              maxLength={4000}
                              value={decisionForm.basis}
                              onChange={(event) =>
                                setDecisionForm((current) => ({
                                  ...current,
                                  basis: event.target.value,
                                }))}
                            />
                          </label>
                          <label className={`${styles.checkLabel} ${styles.formWide}`}>
                            <input
                              type="checkbox"
                              checked={decisionForm.confirmed}
                              onChange={(event) =>
                                setDecisionForm((current) => ({
                                  ...current,
                                  confirmed: event.target.checked,
                                }))}
                            />
                            I reviewed the applicable official activity and
                            evidence policy outside this summary response. This
                            request is not a regulator approval.
                          </label>
                          <button
                            className={`${styles.primaryAction} ${styles.formWide}`}
                            type="submit"
                            aria-describedby={decisionBlockReason
                              ? "creditex-decision-block-reason"
                              : undefined}
                            disabled={
                              !decisionForm.confirmed
                              || decisionForm.basis.trim().length < 20
                              || Boolean(decisionBlockReason)
                              || operationBusy === "record_decision"
                            }
                          >
                            {decisionForm.decisionType === "evidence_complete"
                              ? "Record evidence-complete decision"
                              : "Request independent approval"}
                          </button>
                          {decisionBlockReason && (
                            <p
                              id="creditex-decision-block-reason"
                              className={`${styles.formNote} ${styles.formWide}`}
                            >
                              {decisionBlockReason}
                            </p>
                          )}
                          {decisionForm.decisionType === "ready_to_submit"
                            && !decisionBlockReason && (
                            <p className={`${styles.formNote} ${styles.formWide}`}>
                              The server will revalidate the complete pinned
                              evidence policy, current-revision eligibility
                              approval and the applicable approved calculator.
                            </p>
                          )}
                        </form>
                      ) : (
                        <UnavailableState>
                          Only an administrator or reviewer can record a
                          compliance decision.
                        </UnavailableState>
                      )}
                      <div className={styles.compactList}>
                        {pendingDecisionRequests.map((request) => (
                          <article key={request.id}>
                            <span>
                              <strong>{readable(request.type)}</strong>
                              <StatusPill value={request.status} />
                            </span>
                            <p>
                              Proposed outcome {readable(request.outcome)} |
                              Primary reviewer{" "}
                              {request.primaryReviewer || "not returned"}
                            </p>
                            <small>
                              Basis {request.basisRecorded ? "recorded" : "missing"} |
                              Case revision {request.caseRevision || "not returned"} |
                              Requested {dateTime(request.createdAt)}
                            </small>
                            {canRecordDecision && (
                              request.caseRevision !== selectedCase.revision ? (
                                <p className={styles.inlineUnavailable}>
                                  Secondary approval unavailable because this
                                  request belongs to an earlier case revision.
                                </p>
                              ) : (
                                <button
                                  className={styles.inlineAction}
                                  type="button"
                                  disabled={operationBusy === "record_decision"}
                                  onClick={() =>
                                    void approveDecisionRequest(request)}
                                >
                                  Complete independent review
                                </button>
                              )
                            )}
                          </article>
                        ))}
                        {!pendingDecisionRequests.length && (
                          <UnavailableState>
                            No pending secondary decision requests were returned.
                          </UnavailableState>
                        )}
                      </div>
                    </section>
                  </div>
                </section>
              )}
            </>
          )}

          {area === "tasks" && (
            <section aria-labelledby="operations-tasks-title">
              <SectionTitle
                id="operations-tasks-title"
                title="Tasks"
                description="Case-linked evidence, review, correction, submission and reconciliation work."
              />
              <form className={styles.localForm} onSubmit={createTask}>
                <div className={styles.formIntro}>
                  <strong>Create a local case task</strong>
                  <p>
                    {selectedCase
                      ? `Selected case ${selectedCase.caseNumber}.`
                      : "Select a case in the work queue first."}
                  </p>
                </div>
                <label>
                  Task type
                  <select
                    value={taskForm.taskType}
                    onChange={(event) =>
                      setTaskForm((current) => ({
                        ...current,
                        taskType: event.target.value,
                      }))}
                  >
                    {[
                      "evidence",
                      "review",
                      "correction",
                      "submission",
                      "reconciliation",
                      "participant",
                      "general",
                    ].map((value) => (
                      <option key={value} value={value}>
                        {readable(value)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Priority
                  <select
                    value={taskForm.priority}
                    onChange={(event) =>
                      setTaskForm((current) => ({
                        ...current,
                        priority: event.target.value,
                      }))}
                  >
                    {["low", "normal", "high", "urgent"].map((value) => (
                      <option key={value} value={value}>
                        {readable(value)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.formWide}>
                  Task title
                  <input
                    required
                    maxLength={180}
                    value={taskForm.title}
                    onChange={(event) =>
                      setTaskForm((current) => ({
                        ...current,
                        title: event.target.value,
                      }))}
                  />
                </label>
                <label className={styles.formWide}>
                  Detail
                  <textarea
                    maxLength={2000}
                    value={taskForm.detail}
                    onChange={(event) =>
                      setTaskForm((current) => ({
                        ...current,
                        detail: event.target.value,
                      }))}
                  />
                </label>
                <button
                  className={`${styles.primaryAction} ${styles.formWide}`}
                  type="submit"
                  disabled={!selectedCase?.id || operationBusy === "create_task"}
                  title={!selectedCase?.id
                    ? "The selected queue record needs its operational case identifier."
                    : undefined}
                >
                  {operationBusy === "create_task"
                    ? "Creating task..."
                    : "Create case task"}
                </button>
              </form>
              <div className={styles.recordList}>
                {operations.tasks.map((task) => (
                  <article className={styles.recordCard} key={task.id}>
                    <div>
                      <span className={styles.kicker}>
                        {readable(task.type)} task
                      </span>
                      <h4>{task.title}</h4>
                      <p>{task.detail || "No further task detail recorded."}</p>
                    </div>
                    <dl>
                      <div>
                        <dt>Case</dt>
                        <dd>{task.caseNumber || task.caseId || "Not linked"}</dd>
                      </div>
                      <div>
                        <dt>Priority</dt>
                        <dd>{readable(task.priority)}</dd>
                      </div>
                      <div>
                        <dt>Due</dt>
                        <dd>{dateTime(task.dueAt)}</dd>
                      </div>
                    </dl>
                    <div className={styles.recordActions}>
                      <StatusPill value={task.status} />
                      {["open", "in_progress", "blocked"].includes(
                        task.status,
                      ) && (
                        <button
                          className={styles.inlineAction}
                          type="button"
                          disabled={operationBusy === "complete_task"}
                          onClick={() => void completeTask(task.id)}
                        >
                          Mark complete
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                {!operations.tasks.length && (
                  <EmptyState>
                    No operational tasks were returned for this organisation.
                  </EmptyState>
                )}
              </div>
            </section>
          )}

          {area === "participants" && (
            <section aria-labelledby="operations-participants-title">
              <SectionTitle
                id="operations-participants-title"
                title="Participants"
                description="Installer, retailer, aggregator, auditor, supplier and agent records."
              />
              {canManageParticipants ? (
                <div className={styles.controlGrid}>
                  <section aria-labelledby="creditex-participant-create-title">
                    <h4 id="creditex-participant-create-title">
                      Create pending participant
                    </h4>
                    <form className={styles.localForm} onSubmit={createParticipant}>
                      <label>
                        Participant type
                        <select
                          value={participantForm.participantType}
                          onChange={(event) =>
                            setParticipantForm((current) => ({
                              ...current,
                              participantType: event.target.value,
                            }))}
                        >
                          {[
                            "installer",
                            "retailer",
                            "aggregator",
                            "auditor",
                            "supplier",
                            "agent",
                          ].map((value) => (
                            <option key={value} value={value}>
                              {readable(value)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        External reference, optional
                        <input
                          maxLength={180}
                          value={participantForm.externalReference}
                          onChange={(event) =>
                            setParticipantForm((current) => ({
                              ...current,
                              externalReference: event.target.value,
                            }))}
                        />
                      </label>
                      <label>
                        Legal name
                        <input
                          required
                          maxLength={240}
                          value={participantForm.legalName}
                          onChange={(event) =>
                            setParticipantForm((current) => ({
                              ...current,
                              legalName: event.target.value,
                            }))}
                        />
                      </label>
                      <label>
                        Trading name, optional
                        <input
                          maxLength={240}
                          value={participantForm.tradingName}
                          onChange={(event) =>
                            setParticipantForm((current) => ({
                              ...current,
                              tradingName: event.target.value,
                            }))}
                        />
                      </label>
                      <label>
                        ABN, optional
                        <input
                          inputMode="numeric"
                          maxLength={20}
                          value={participantForm.abn}
                          onChange={(event) =>
                            setParticipantForm((current) => ({
                              ...current,
                              abn: event.target.value,
                            }))}
                        />
                      </label>
                      <label>
                        Contact email, optional
                        <input
                          type="email"
                          maxLength={320}
                          value={participantForm.contactEmail}
                          onChange={(event) =>
                            setParticipantForm((current) => ({
                              ...current,
                              contactEmail: event.target.value,
                            }))}
                        />
                      </label>
                      <button
                        className={`${styles.primaryAction} ${styles.formWide}`}
                        type="submit"
                        disabled={operationBusy === "add_participant"}
                      >
                        Create pending participant
                      </button>
                    </form>
                  </section>
                  <section aria-labelledby="creditex-ability-create-title">
                    <h4 id="creditex-ability-create-title">
                      Record pending participant ability
                    </h4>
                    <form
                      className={styles.localForm}
                      onSubmit={createParticipantAbility}
                    >
                      <label>
                        Participant
                        <select
                          required
                          value={abilityForm.participantId}
                          onChange={(event) =>
                            setAbilityForm((current) => ({
                              ...current,
                              participantId: event.target.value,
                            }))}
                        >
                          <option value="">Choose a participant</option>
                          {operations.participants.map((participant) => (
                            <option key={participant.id} value={participant.id}>
                              {participant.tradingName || participant.legalName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Ability code
                        <input
                          required
                          maxLength={160}
                          value={abilityForm.abilityCode}
                          onChange={(event) =>
                            setAbilityForm((current) => ({
                              ...current,
                              abilityCode: event.target.value,
                            }))}
                        />
                      </label>
                      <label>
                        Ability role
                        <input
                          required
                          maxLength={160}
                          value={abilityForm.abilityRole}
                          onChange={(event) =>
                            setAbilityForm((current) => ({
                              ...current,
                              abilityRole: event.target.value,
                            }))}
                        />
                      </label>
                      <label>
                        Effective from
                        <input
                          type="date"
                          required
                          data-date-range-group="creditex-ability-effective"
                          data-date-range-role="start"
                          value={abilityForm.effectiveFrom}
                          onChange={(event) =>
                            setAbilityForm((current) => ({
                              ...current,
                              effectiveFrom: event.target.value,
                            }))}
                        />
                      </label>
                      <label>
                        Effective to, optional
                        <input
                          type="date"
                          data-date-range-group="creditex-ability-effective"
                          data-date-range-role="end"
                          value={abilityForm.effectiveTo}
                          onChange={(event) =>
                            setAbilityForm((current) => ({
                              ...current,
                              effectiveTo: event.target.value,
                            }))}
                        />
                      </label>
                      <label className={styles.formWide}>
                        Ability evidence reference
                        <input
                          required
                          maxLength={500}
                          value={abilityForm.evidenceReference}
                          onChange={(event) =>
                            setAbilityForm((current) => ({
                              ...current,
                              evidenceReference: event.target.value,
                            }))}
                        />
                      </label>
                      <button
                        className={`${styles.primaryAction} ${styles.formWide}`}
                        type="submit"
                        disabled={
                          !selectedCase?.programId
                          || !selectedCase.activityVersionId
                          || !abilityForm.participantId
                          || operationBusy === "add_participant_ability"
                        }
                      >
                        Record pending ability
                      </button>
                      {(!selectedCase?.programId
                        || !selectedCase.activityVersionId) && (
                        <p className={`${styles.formNote} ${styles.formWide}`}>
                          Load a selected case to supply its governed program and
                          exact activity-version IDs.
                        </p>
                      )}
                    </form>
                  </section>
                </div>
              ) : (
                <UnavailableState>
                  Your role can view participant summaries but cannot create
                  participant or ability records.
                </UnavailableState>
              )}
              <div className={styles.recordList}>
                {operations.participants.map((participant) => (
                  <article className={styles.recordCard} key={participant.id}>
                    <div>
                      <span className={styles.kicker}>
                        {readable(participant.type)}
                      </span>
                      <h4>
                        {participant.tradingName || participant.legalName}
                      </h4>
                      <p>
                        {participant.legalName}
                        {participant.abn ? ` | ABN ${participant.abn}` : ""}
                      </p>
                      <p>
                        {participant.contactEmail
                          ? participant.contactEmail
                          : "Contact email is not included in this summary response"}
                      </p>
                    </div>
                    <dl>
                      <div>
                        <dt>Reference</dt>
                        <dd>{participant.externalReference || "Not recorded"}</dd>
                      </div>
                      <div>
                        <dt>Effective</dt>
                        <dd>
                          {participant.effectiveFrom
                            ? `${dateOnly(participant.effectiveFrom)} to `
                            : "Start date not included; end "}
                          {participant.effectiveTo
                            ? dateOnly(participant.effectiveTo)
                            : "not returned"}
                        </dd>
                      </div>
                    </dl>
                    <StatusPill value={participant.status} />
                  </article>
                ))}
                {!operations.participants.length && (
                  <EmptyState>
                    No participant records were returned. Participant
                    capabilities must be verified before activity work is
                    assigned.
                  </EmptyState>
                )}
              </div>
              <DisabledPanel
                title="Private participant import"
                reason="Dataforce, Runabout and private registry imports need an approved integration contract and field mapping."
                action="Import participant file"
              />
            </section>
          )}

          {area === "stock" && (
            <section aria-labelledby="operations-stock-title">
              <SectionTitle
                id="operations-stock-title"
                title="Stock & decommissioning"
                description="Installed, decommissioned and stock equipment remain linked to their case and evidence chain."
              />
              {canRecordEquipment ? (
                <form className={styles.localForm} onSubmit={addEquipment}>
                  <div className={`${styles.formIntro} ${styles.formWide}`}>
                    <strong>Record selected-case equipment</strong>
                    <p>
                      {selectedCase?.detailsLoaded
                        ? `Selected case ${selectedCase.caseNumber}.`
                        : "Load a case detail before recording equipment."}
                    </p>
                  </div>
                  <label>
                    Record type
                    <select
                      value={equipmentForm.recordType}
                      onChange={(event) =>
                        setEquipmentForm((current) => ({
                          ...current,
                          recordType: event.target.value,
                        }))}
                    >
                      {["installed", "decommissioned", "stock"].map((value) => (
                        <option key={value} value={value}>
                          {readable(value)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Equipment status
                    <select
                      value={equipmentForm.status}
                      onChange={(event) =>
                        setEquipmentForm((current) => ({
                          ...current,
                          status: event.target.value,
                        }))}
                    >
                      {[
                        "expected",
                        "received",
                        "installed",
                        "decommissioned",
                        "removed",
                        "returned",
                        "scrapped",
                      ].map((value) => (
                        <option key={value} value={value}>
                          {readable(value)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Manufacturer
                    <input
                      required
                      maxLength={180}
                      value={equipmentForm.manufacturer}
                      onChange={(event) =>
                        setEquipmentForm((current) => ({
                          ...current,
                          manufacturer: event.target.value,
                        }))}
                    />
                  </label>
                  <label>
                    Model
                    <input
                      required
                      maxLength={180}
                      value={equipmentForm.model}
                      onChange={(event) =>
                        setEquipmentForm((current) => ({
                          ...current,
                          model: event.target.value,
                        }))}
                    />
                  </label>
                  <label>
                    Serial number, optional
                    <input
                      maxLength={180}
                      value={equipmentForm.serialNumber}
                      onChange={(event) =>
                        setEquipmentForm((current) => ({
                          ...current,
                          serialNumber: event.target.value,
                        }))}
                    />
                  </label>
                  <label>
                    Quantity
                    <input
                      type="number"
                      min="1"
                      max="100000"
                      required
                      value={equipmentForm.quantity}
                      onChange={(event) =>
                        setEquipmentForm((current) => ({
                          ...current,
                          quantity: event.target.value,
                        }))}
                    />
                  </label>
                  <label>
                    Product registry, optional
                    <input
                      maxLength={180}
                      value={equipmentForm.productRegistry}
                      onChange={(event) =>
                        setEquipmentForm((current) => ({
                          ...current,
                          productRegistry: event.target.value,
                        }))}
                    />
                  </label>
                  <label>
                    Product reference, optional
                    <input
                      maxLength={180}
                      value={equipmentForm.productReference}
                      onChange={(event) =>
                        setEquipmentForm((current) => ({
                          ...current,
                          productReference: event.target.value,
                        }))}
                    />
                  </label>
                  <label className={styles.formWide}>
                    Evidence reference
                    <input
                      required
                      maxLength={500}
                      value={equipmentForm.evidenceReference}
                      onChange={(event) =>
                        setEquipmentForm((current) => ({
                          ...current,
                          evidenceReference: event.target.value,
                        }))}
                    />
                  </label>
                  <button
                    className={`${styles.primaryAction} ${styles.formWide}`}
                    type="submit"
                    disabled={
                      !selectedCase?.detailsLoaded
                      || operationBusy === "add_equipment"
                    }
                  >
                    Record equipment
                  </button>
                </form>
              ) : (
                <UnavailableState>
                  Your role can view equipment but cannot create equipment
                  records.
                </UnavailableState>
              )}
              <p className={styles.warning}>
                Equipment below is limited to the selected case. The dashboard
                API does not return an organisation-wide equipment queue.
              </p>
              <div className={styles.recordList}>
                {displayedEquipment.map((item) => (
                  <article className={styles.recordCard} key={item.id}>
                    <div>
                      <span className={styles.kicker}>
                        {readable(item.recordType)}
                      </span>
                      <h4>
                        {[item.manufacturer, item.model]
                          .filter(Boolean)
                          .join(" ") || "Equipment description not recorded"}
                      </h4>
                      <p>
                        Serial {item.serialNumber || "not recorded"} | Quantity{" "}
                        {item.quantity}
                      </p>
                      <p>
                        {item.productRegistry || "No product register recorded"}
                        {item.productReference
                          ? ` | ${item.productReference}`
                          : ""}
                      </p>
                    </div>
                    <dl>
                      <div>
                        <dt>Case</dt>
                        <dd>{item.caseNumber || item.caseId || "Not linked"}</dd>
                      </div>
                      <div>
                        <dt>Recorded</dt>
                        <dd>{dateTime(item.recordedAt)}</dd>
                      </div>
                    </dl>
                    <StatusPill value={item.status} />
                  </article>
                ))}
                {!displayedEquipment.length && (
                  <EmptyState>
                    No equipment records were returned for the selected case.
                  </EmptyState>
                )}
              </div>
            </section>
          )}

          {area === "submissions" && (
            <section aria-labelledby="operations-submissions-title">
              <SectionTitle
                id="operations-submissions-title"
                title="Submissions & reconciliation"
                description="Batch preparation, controlled export, regulator responses and reconciliation."
              />
              {canManageBatches ? (
                <div className={styles.controlGrid}>
                  <section aria-labelledby="creditex-batch-create-title">
                    <h4 id="creditex-batch-create-title">
                      Create local draft batch
                    </h4>
                    <form className={styles.localForm} onSubmit={createDraftBatch}>
                      <label>
                        Batch number
                        <input
                          required
                          maxLength={180}
                          value={batchForm.batchNumber}
                          onChange={(event) =>
                            setBatchForm((current) => ({
                              ...current,
                              batchNumber: event.target.value,
                            }))}
                        />
                      </label>
                      <label>
                        Local format
                        <select
                          value={batchForm.format}
                          onChange={(event) =>
                            setBatchForm((current) => ({
                              ...current,
                              format: event.target.value,
                            }))}
                        >
                          {["manual", "csv", "json"].map((value) => (
                            <option key={value} value={value}>
                              {readable(value)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={styles.formWide}>
                        External reference, optional
                        <input
                          maxLength={180}
                          value={batchForm.externalReference}
                          onChange={(event) =>
                            setBatchForm((current) => ({
                              ...current,
                              externalReference: event.target.value,
                            }))}
                        />
                      </label>
                      <button
                        className={`${styles.primaryAction} ${styles.formWide}`}
                        type="submit"
                        disabled={
                          !selectedCase?.programId
                          || operationBusy === "create_draft_batch"
                        }
                      >
                        Create local draft batch
                      </button>
                      {!selectedCase?.programId && (
                        <p className={`${styles.formNote} ${styles.formWide}`}>
                          Load a selected case to supply its governed program ID.
                        </p>
                      )}
                    </form>
                  </section>
                  <section aria-labelledby="creditex-batch-stage-title">
                    <h4 id="creditex-batch-stage-title">
                      Stage selected case revision
                    </h4>
                    <form
                      className={styles.localForm}
                      onSubmit={stageSelectedCase}
                    >
                      <label className={styles.formWide}>
                        Editable draft batch
                        <select
                          required
                          value={stageBatchId}
                          onChange={(event) => setStageBatchId(event.target.value)}
                        >
                          <option value="">Choose a draft batch</option>
                          {draftBatches.map((batch) => (
                            <option key={batch.id} value={batch.id}>
                              {batch.batchNumber || batch.id} |{" "}
                              {batch.programName || "Program not returned"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <ul className={`${styles.gateList} ${styles.formWide}`}>
                        <li data-ready={caseHasReadyDecision}>
                          Exact-revision ready-to-submit decision approved
                        </li>
                        <li
                          data-ready={
                            selectedCase?.workflowStatus === "ready_for_submission"
                          }
                        >
                          Case state is ready for submission
                        </li>
                        <li data-ready={!caseHasOpenFinding}>
                          No open findings returned
                        </li>
                      </ul>
                      <button
                        className={`${styles.primaryAction} ${styles.formWide}`}
                        type="submit"
                        aria-describedby={!canStageObservedCase
                          ? "creditex-stage-block-reason"
                          : undefined}
                        disabled={
                          !canStageObservedCase
                          || !stageBatchId
                          || operationBusy === "stage_batch_item"
                        }
                      >
                        Stage current case revision
                      </button>
                      {!canStageObservedCase && (
                        <p
                          id="creditex-stage-block-reason"
                          className={`${styles.formNote} ${styles.formWide}`}
                        >
                          Staging remains unavailable until every observed gate
                          above passes.
                        </p>
                      )}
                      <p className={`${styles.formNote} ${styles.formWide}`}>
                        The server revalidates every requirement in the pinned
                        published evidence policy, the exact-revision decision
                        sequence and the applicable calculator contract. A
                        calculation can be either verified or governed as not
                        applicable.
                        {caseHasVerifiedCalculation
                          ? " A verified calculation is returned for this revision."
                          : " No verified calculation is returned for this revision."}
                      </p>
                    </form>
                  </section>
                </div>
              ) : (
                <UnavailableState>
                  Your role can view local batches but cannot create, stage or
                  remove batch items.
                </UnavailableState>
              )}
              {selectedCase?.detailsLoaded && (
                <div className={styles.compactList}>
                  <h4 className={styles.subheading}>
                    Selected-case batch history
                  </h4>
                  {selectedCase.batchItems.map((item) => (
                    <article key={item.id}>
                      <span>
                        <strong>
                          {item.batchNumber || item.batchId || "Batch not returned"}
                        </strong>
                        <StatusPill value={item.status} />
                      </span>
                      <p>Case revision {item.caseRevision || "not returned"}</p>
                      <small>Updated {dateTime(item.updatedAt)}</small>
                      {canManageBatches && item.status === "staged" && (
                        <button
                          className={styles.inlineAction}
                          type="button"
                          disabled={operationBusy === "remove_batch_item"}
                          onClick={() => void removeBatchItem(item.id)}
                        >
                          Remove from draft batch
                        </button>
                      )}
                    </article>
                  ))}
                  {!selectedCase.batchItems.length && (
                    <UnavailableState>
                      No batch-item records were returned for the selected case.
                    </UnavailableState>
                  )}
                </div>
              )}
              <div className={styles.recordList}>
                {operations.submissions.map((batch) => (
                  <article className={styles.recordCard} key={batch.id}>
                    <div>
                      <span className={styles.kicker}>{batch.programName}</span>
                      <h4>{batch.batchNumber || "Unnumbered batch"}</h4>
                      <p>
                        {readable(batch.format)} format | {batch.caseCount} cases
                      </p>
                      <p>
                        Registry reference:{" "}
                        {batch.externalReference || "Not recorded"}
                      </p>
                    </div>
                    <dl>
                      <div>
                        <dt>Recorded quantity</dt>
                        <dd>{batch.quantity}</dd>
                      </div>
                      <div>
                        <dt>Updated</dt>
                        <dd>{dateTime(batch.updatedAt)}</dd>
                      </div>
                    </dl>
                    <StatusPill value={batch.status} />
                  </article>
                ))}
                {!operations.submissions.length && (
                  <EmptyState>
                    No submission batches were returned. No registry outcome is
                    implied.
                  </EmptyState>
                )}
              </div>
              <DisabledPanel
                title="External registry gateway"
                reason="Registry submission stays disabled until Creditex credentials, written authority, schema mapping and reconciliation controls are approved."
                action="Submit to registry"
              />
            </section>
          )}

          {area === "certificates" && (
            <section aria-labelledby="operations-certificates-title">
              <SectionTitle
                id="operations-certificates-title"
                title="Certificates & settlement"
                description="Registered lots, trades and settlements are separate operational states."
              />
              <div className={styles.splitColumns}>
                <div>
                  <h4 className={styles.subheading}>Certificate lots</h4>
                  <div className={styles.compactList}>
                    {operations.certificates.map((lot) => (
                      <article key={lot.id}>
                        <span>
                          <strong>
                            {lot.certificateType || "Certificate type not recorded"}
                          </strong>
                          <StatusPill value={lot.status} />
                        </span>
                        <p>
                          Quantity {lot.quantity} | Registry reference{" "}
                          {lot.registryReference || "not recorded"}
                        </p>
                        <small>
                          Vintage {lot.vintageFrom
                            ? dateOnly(lot.vintageFrom)
                            : "not recorded"} to{" "}
                          {lot.vintageTo
                            ? dateOnly(lot.vintageTo)
                            : "not recorded"}
                        </small>
                      </article>
                    ))}
                    {!operations.certificates.length && (
                      <EmptyState>No certificate lots were returned.</EmptyState>
                    )}
                  </div>
                </div>
                <div>
                  <h4 className={styles.subheading}>Trades & settlements</h4>
                  <div className={styles.compactList}>
                    {operations.trades.map((trade) => (
                      <article key={trade.id}>
                        <span>
                          <strong>
                            {trade.certificateType || "Certificate trade"}
                          </strong>
                          <StatusPill value={trade.status} />
                        </span>
                        <p>
                          {trade.quantity} at {money(trade.unitPriceCents)} each
                        </p>
                        <small>
                          {trade.counterpartyReference
                            || "Counterparty reference not recorded"}{" "}
                          | {dateOnly(trade.tradeDate)}
                        </small>
                      </article>
                    ))}
                    {operations.settlements.map((settlement) => (
                      <article key={settlement.id}>
                        <span>
                          <strong>Settlement {settlement.tradeId}</strong>
                          <StatusPill value={settlement.status} />
                        </span>
                        <p>
                          Gross {money(settlement.grossCents)} | Fee{" "}
                          {money(settlement.feeCents)} | Net{" "}
                          {money(settlement.netCents)}
                        </p>
                        <small>Due {dateOnly(settlement.dueDate)}</small>
                      </article>
                    ))}
                    {!operations.trades.length
                      && !operations.settlements.length && (
                      <EmptyState>
                        No trade or settlement records were returned.
                      </EmptyState>
                    )}
                  </div>
                </div>
              </div>
              <DisabledPanel
                title="External certificate trade execution"
                reason="Registry mutation, counterparty execution and settlement confirmation remain disabled until the governed external integrations and reconciliation controls are approved."
                action="Execute certificate trade"
              />
            </section>
          )}

          {area === "reports" && (
            <section aria-labelledby="operations-reports-title">
              <SectionTitle
                id="operations-reports-title"
                title="Reports"
                description="Operational measures come from the current protected workspace snapshot."
              />
              <div className={styles.reportGrid}>
                {[
                  ["Open cases", openCaseCount],
                  ["Evidence review", evidenceReviewCount],
                  ["Open tasks", openTaskCount],
                  ["Participants loaded", operations.participants.length],
                  ["Selected-case equipment", displayedEquipment.length],
                  ["Submission batches loaded", operations.submissions.length],
                  ["Certificate lots loaded", operations.certificates.length],
                  ["Settlements loaded", operations.settlements.length],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
                {Object.entries(operations.reports).map(([label, value]) => (
                  <div key={label}>
                    <span>{readable(label)}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <p className={styles.reportNote}>
                Loaded-list counts can be capped at 50. They are not regulator
                acceptance, certificate creation, trade or settlement outcomes.
              </p>
            </section>
          )}

          {area === "rules" && (
            <section aria-labelledby="operations-rules-title">
              <SectionTitle
                id="operations-rules-title"
                title="Activity rules"
                description="Effective-dated activities, evidence policies and independently approved calculators."
              />
              <div className={styles.ruleMetrics}>
                <div>
                  <span>Evidence policies</span>
                  <strong>
                    {metric(
                      operations,
                      ["evidence_policies"],
                      operations.evidencePolicies.length,
                    )}
                  </strong>
                </div>
                <div>
                  <span>Evidence requirements</span>
                  <strong>
                    {metric(operations, ["evidence_requirements"], 0)}
                  </strong>
                </div>
                <div>
                  <span>Calculator versions</span>
                  <strong>
                    {metric(operations, ["calculator_versions"], 0)}
                  </strong>
                </div>
                <div>
                  <span>Test vectors</span>
                  <strong>
                    {metric(operations, ["calculator_vectors"], 0)}
                  </strong>
                </div>
              </div>
              <div className={styles.recordList}>
                {operations.evidencePolicies.map((policy) => (
                  <article className={styles.recordCard} key={policy.id}>
                    <div>
                      <span className={styles.kicker}>
                        Evidence policy version {policy.version}
                      </span>
                      <h4>{policy.activityKey || "Activity not recorded"}</h4>
                      <p>
                        {policy.officialSourceTitle
                          || "Official source title not recorded"}
                      </p>
                      <p>
                        Source {policy.officialSourceVersion || "not versioned"} |
                        Checked {dateOnly(policy.officialSourceCheckedAt)}
                      </p>
                    </div>
                    <dl>
                      <div>
                        <dt>Requirements</dt>
                        <dd>
                          {policy.requirementsComplete
                            ? "Marked complete"
                            : "Not complete"}
                        </dd>
                      </div>
                    </dl>
                    <StatusPill value={policy.publishState} />
                  </article>
                ))}
                {!operations.evidencePolicies.length && (
                  <EmptyState>
                    No evidence policy versions were returned. A missing policy
                    or calculator never implies zero certificates or an
                    approved estimate.
                  </EmptyState>
                )}
              </div>
              <div className={styles.actionRow}>
                <DisabledAction reason="Only independently tested and dual-approved calculators may run.">
                  Run unapproved calculator
                </DisabledAction>
                {session.role === "admin" ? (
                  <button
                    className={styles.primaryAction}
                    type="button"
                    onClick={onOpenActivityRules}
                  >
                    Open governed activity editor
                  </button>
                ) : (
                  <DisabledAction reason="Only a Creditex administrator can govern activity versions.">
                    Open governed activity editor
                  </DisabledAction>
                )}
              </div>
            </section>
          )}

          {area === "access" && (
            <AccessView
              session={session}
              access={access}
              loading={loadingAccess}
              error={accessError}
              onRefresh={() => void loadAccess()}
            />
          )}
        </div>
      </div>
      <nav
        className={styles.programTabs}
        aria-label="Compliance program workspaces"
      >
        <button
          type="button"
          aria-current={!appliedFilters.program ? "page" : undefined}
          onClick={() => chooseProgram("")}
        >
          <span>Dashboard</span>
          <small>{operations.workspace.total} matching cases</small>
        </button>
        {operations.workspace.programs.map((program) => (
          <button
            key={program.programId}
            type="button"
            aria-current={
              appliedFilters.program === program.programId ? "page" : undefined
            }
            onClick={() => chooseProgram(program.programId)}
          >
            <span>
              {program.programCode || program.jurisdiction} ·{" "}
              {program.programName}
            </span>
            <small>
              {program.caseCount} cases · {program.activityVersionCount}{" "}
              activity versions
            </small>
          </button>
        ))}
        {!operations.workspace.programs.length && operations.loaded && (
          <span className={styles.programTabsEmpty}>
            Governed program tabs appear here after Creditex approves a
            source-pinned program record. No public research is auto-published.
          </span>
        )}
      </nav>
      {evidenceViewer && (
        <EvidenceViewerModal
          viewer={evidenceViewer}
          onClose={() => setEvidenceViewer(null)}
        />
      )}
    </section>
  );
}

function EvidenceViewerModal({
  viewer,
  onClose,
}: {
  viewer: EvidenceViewer;
  onClose: () => void;
}) {
  const location = viewer.facts.gpsState === "reported"
      && viewer.facts.latitude
      && viewer.facts.longitude
    ? `Reported ${
      [
        viewer.facts.latitude,
        viewer.facts.longitude,
        viewer.facts.accuracyMetres
          ? `${viewer.facts.accuracyMetres} m reported accuracy`
          : "",
      ].filter(Boolean).join(", ")
    }`
    : "Unknown";
  const mocked = viewer.facts.locationMocked === "true"
    ? "Reported yes"
    : viewer.facts.locationMocked === "false"
      ? "Reported no"
      : "Unknown";
  const metadata = viewer.facts.metadataState === "reported"
    ? "Reported available"
    : "Unknown";
  const original = viewer.facts.originalState === "preserved"
    ? "Reported preserved without app transformation"
    : viewer.facts.originalState === "not_preserved"
      ? "Reported not preserved"
      : "Unknown";
  const integrity = viewer.facts.integrityState === "recorded"
    ? "SHA-256 digest recorded, not reverified by this viewer"
    : "Unknown";

  return (
    <div
      className={styles.evidenceModalBackdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={styles.evidenceModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="creditex-evidence-viewer-title"
      >
        <header className={styles.evidenceModalHeader}>
          <div>
            <span className={styles.kicker}>Audited evidence viewer</span>
            <h3 id="creditex-evidence-viewer-title">
              {viewer.evidenceLabel}
            </h3>
            <p>
              Access receipt {viewer.receiptId}
            </p>
          </div>
          <button
            className={styles.modalClose}
            type="button"
            autoFocus
            onClick={onClose}
          >
            Close viewer
          </button>
        </header>
        <div className={styles.evidenceModalLayout}>
          <div className={styles.evidencePreview}>
            {viewer.contentType === "application/pdf" ? (
              <iframe
                src={viewer.objectUrl}
                title={`${viewer.evidenceLabel} protected PDF evidence`}
                sandbox=""
                referrerPolicy="no-referrer"
              />
            ) : (
              // The object URL contains the authenticated response body only.
              // No private storage key or original file name reaches the UI.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={viewer.objectUrl}
                alt={`${viewer.evidenceLabel} protected evidence preview`}
                draggable={false}
              />
            )}
          </div>
          <aside className={styles.evidenceFacts}>
            <h4>Recorded evidence facts</h4>
            <p>
              Capture facts are reported by the stored evidence envelope.
              Unknown means the viewer did not receive that fact. Opening the
              file does not independently verify the reported metadata.
            </p>
            <dl>
              <div>
                <dt>Source</dt>
                <dd>
                  {viewer.facts.source
                    ? `Reported ${readable(viewer.facts.source)}`
                    : "Unknown"}
                </dd>
              </div>
              <div>
                <dt>Received</dt>
                <dd>
                  {viewer.facts.receivedAt
                    ? `Reported ${dateTime(viewer.facts.receivedAt)}`
                    : "Unknown"}
                </dd>
              </div>
              <div>
                <dt>Capture time</dt>
                <dd>
                  {viewer.facts.observedAt
                    ? `Reported ${dateTime(viewer.facts.observedAt)}`
                    : "Unknown"}
                </dd>
              </div>
              <div>
                <dt>GPS</dt>
                <dd>{location}</dd>
              </div>
              <div>
                <dt>Mocked location flag</dt>
                <dd>{mocked}</dd>
              </div>
              <div>
                <dt>Capture metadata</dt>
                <dd>{metadata}</dd>
              </div>
              <div>
                <dt>Original preservation</dt>
                <dd>{original}</dd>
              </div>
              <div>
                <dt>Integrity record</dt>
                <dd>{integrity}</dd>
              </div>
            </dl>
          </aside>
        </div>
      </section>
    </div>
  );
}

function SectionTitle({
  id,
  title,
  description,
}: {
  id: string;
  title: string;
  description: string;
}) {
  return (
    <header className={styles.sectionHeader}>
      <div>
        <h3 id={id}>{title}</h3>
        <p>{description}</p>
      </div>
    </header>
  );
}

function CaseOverview({
  item,
  onReview,
}: {
  item: OperationCase;
  onReview?: () => void;
}) {
  const activityCode = item.activity.registryActivityCode
    || item.activity.activityKey
    || "Activity not recorded";
  return (
    <>
      <div className={styles.selectedTopline}>
        <div>
          <span className={styles.kicker}>Selected case</span>
          <h3>{item.caseNumber}</h3>
          <p>
            TLink job {item.jobNumber || "not recorded"} |{" "}
            {item.installerBusiness || "installer not recorded"}
          </p>
        </div>
        <StatusPill value={item.workflowStatus} />
      </div>
      <div className={styles.activitySummary}>
        <span>Governed activity</span>
        <strong>
          {activityCode}
          {item.activity.version ? ` | Version ${item.activity.version}` : ""}
        </strong>
        <p>
          {item.activity.title || "No activity title recorded"} |{" "}
          {item.activity.programName || "Program not recorded"}
        </p>
        <p>
          {item.jurisdiction || "Jurisdiction not recorded"} | Activity date{" "}
          {dateOnly(item.activityDate)}
        </p>
      </div>
      <div className={styles.nextAction}>
        <span>Next action</span>
        <strong>{nextCaseAction(item)}</strong>
      </div>
      <div className={styles.prerequisiteGrid}>
        <div>
          <h4>Recorded prerequisites</h4>
          <ul>
            {observedPrerequisites(item).map((value) => (
              <li key={value}>{value}</li>
            ))}
          </ul>
          {!item.prerequisites.length && (
            <p>
              These are observed case fields only, not the complete activity
              evidence policy.
            </p>
          )}
        </div>
        <div>
          <h4>Blockers</h4>
          {item.blockers.length ? (
            <ul>
              {item.blockers.map((value) => (
                <li key={value}>{value}</li>
              ))}
            </ul>
          ) : (
            <p>No structured blockers were returned.</p>
          )}
        </div>
      </div>
      {onReview && (
        <div className={styles.actionRow}>
          <button
            className={styles.primaryAction}
            type="button"
            onClick={onReview}
          >
            Continue case review
          </button>
          <DisabledAction reason="Open the detailed case review to select a specific authorised evidence item and create its immutable access receipt.">
            Open evidence viewer
          </DisabledAction>
        </div>
      )}
    </>
  );
}

function privateAddress(source: JsonRecord | null) {
  if (!source) return "Not recorded";
  return [
    text(source, ["addressLine1", "address_line_1"]),
    text(source, ["addressLine2", "address_line_2"]),
    text(source, ["suburb"]),
    text(source, ["state", "addressState", "address_state"]),
    text(source, ["postcode"]),
  ].filter(Boolean).join(", ") || "Not recorded";
}

function DetailValue({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children || "Not recorded"}</dd>
    </div>
  );
}

function PrivateCaseDetails({ details }: {
  details: OperationPrivateDetails | null;
}) {
  if (!details) {
    return (
      <EmptyState>
        Linked private job, installer, customer, service-site and appointment
        details were not returned for this case.
      </EmptyState>
    );
  }
  const { access, job, installer, customer, serviceSite, appointments } =
    details;
  const customerName = customer
    ? [
        text(customer, ["firstName", "first_name"]),
        text(customer, ["lastName", "last_name"]),
      ].filter(Boolean).join(" ")
    : "";
  const customerTags = customer ? stringList(customer, ["tags"]) : [];
  const jobTags = stringList(job, ["tags"]);
  const capabilities = stringList(installer, ["capabilities"]);
  const serviceStates = stringList(installer, [
    "serviceStates",
    "service_states",
  ]);
  const authorised = booleanValue(access, ["authorised"]);
  const audited = booleanValue(access, [
    "auditEventRecorded",
    "audit_event_recorded",
  ]);
  return (
    <section
      className={styles.privateDetails}
      aria-labelledby="creditex-private-details-title"
    >
      <div className={styles.privateAccessBanner}>
        <div>
          <span className={styles.kicker}>Purpose-bound private access</span>
          <h4 id="creditex-private-details-title">
            Customer, installer and job workspace
          </h4>
          <p>
            This information is excluded from the default queue and opened only
            for the selected compliance case.
          </p>
        </div>
        <div className={styles.privateAccessState}>
          <StatusPill value={authorised ? "authorised" : "unavailable"} />
          <span>{audited ? "Access audit recorded" : "Audit state unavailable"}</span>
          <small>
            Purpose: {readable(text(access, ["purpose"]))}
          </small>
        </div>
      </div>

      <div className={styles.privateDetailGrid}>
        <article>
          <h5>Installer</h5>
          <dl>
            <DetailValue label="Business">
              {text(installer, ["businessName", "business_name"])}
            </DetailValue>
            <DetailValue label="Contact">
              {text(installer, ["contactName", "contact_name"])}
            </DetailValue>
            <DetailValue label="Email">
              {text(installer, ["email"])}
            </DetailValue>
            <DetailValue label="Phone">
              {text(installer, ["phone"])}
            </DetailValue>
            <DetailValue label="ABN">
              {text(installer, ["verifiedAbn", "verified_abn", "abn"])}
            </DetailValue>
            <DetailValue label="ABN verification">
              {readable(text(installer, [
                "verificationStatus",
                "verification_status",
              ]))}
            </DetailValue>
            <DetailValue label="Address">
              {privateAddress(installer)}
            </DetailValue>
            <DetailValue label="Service states">
              {serviceStates.join(", ") || "Not recorded"}
            </DetailValue>
            <DetailValue label="Capabilities">
              {capabilities.join(", ") || "Not recorded"}
            </DetailValue>
          </dl>
        </article>

        <article>
          <h5>Customer</h5>
          {customer ? (
            <dl>
              <DetailValue label="Customer">
                {text(customer, ["businessName", "business_name"])
                  || customerName}
              </DetailValue>
              <DetailValue label="Customer number">
                {text(customer, ["customerNumber", "customer_number"])}
              </DetailValue>
              <DetailValue label="Type">
                {readable(text(customer, [
                  "customerType",
                  "customer_type",
                ]))}
              </DetailValue>
              <DetailValue label="Email">
                {text(customer, ["email"])}
              </DetailValue>
              <DetailValue label="Phone">
                {text(customer, ["phone"])}
              </DetailValue>
              <DetailValue label="Address">
                {privateAddress(customer)}
              </DetailValue>
              <DetailValue label="Tags">
                {customerTags.join(", ") || "Not recorded"}
              </DetailValue>
              <DetailValue label="Private notes">
                {text(customer, ["privateNotes", "private_notes"])}
              </DetailValue>
            </dl>
          ) : (
            <p>No linked CRM customer record was returned.</p>
          )}
          {details.customerContacts.length > 0 && (
            <div className={styles.privateSubList}>
              <strong>Additional contacts</strong>
              {details.customerContacts.map((contact) => (
                <p key={text(contact, ["id"])}>
                  {[
                    text(contact, ["firstName", "first_name"]),
                    text(contact, ["lastName", "last_name"]),
                  ].filter(Boolean).join(" ") || "Contact"} ·{" "}
                  {text(contact, ["roleLabel", "role_label"])
                    || "Role not recorded"} ·{" "}
                  {text(contact, ["email", "phone"]) || "No contact detail"}
                </p>
              ))}
            </div>
          )}
        </article>

        <article>
          <h5>Job</h5>
          <dl>
            <DetailValue label="Job number">
              {text(job, ["workNumber", "work_number"])}
            </DetailValue>
            <DetailValue label="Title">
              {text(job, ["title"])}
            </DetailValue>
            <DetailValue label="Service">
              {text(job, ["serviceCategory", "service_category"])}
            </DetailValue>
            <DetailValue label="Stage">
              {readable(text(job, ["stage"]))}
            </DetailValue>
            <DetailValue label="Pipeline">
              {readable(text(job, ["pipelineStage", "pipeline_stage"]))}
            </DetailValue>
            <DetailValue label="Priority">
              {readable(text(job, ["priority"]))}
            </DetailValue>
            <DetailValue label="Assignee">
              {text(job, ["assigneeLabel", "assignee_label"])}
            </DetailValue>
            <DetailValue label="Schedule">
              {`${dateTime(text(job, ["scheduledStart", "scheduled_start"]))} to ${
                dateTime(text(job, ["scheduledEnd", "scheduled_end"]))
              }`}
            </DetailValue>
            <DetailValue label="Next action">
              {text(job, ["nextAction", "next_action"])}
            </DetailValue>
            <DetailValue label="Description">
              {text(job, ["description"])}
            </DetailValue>
            <DetailValue label="Tags">
              {jobTags.join(", ") || "Not recorded"}
            </DetailValue>
          </dl>
        </article>

        <article>
          <h5>Commercial state</h5>
          <dl>
            <DetailValue label="Estimated">
              {money(numberValue(job, [
                "estimatedValueCents",
                "estimated_value_cents",
              ]))}
            </DetailValue>
            <DetailValue label="Quoted">
              {money(numberValue(job, [
                "quotedValueCents",
                "quoted_value_cents",
              ]))}
            </DetailValue>
            <DetailValue label="Invoiced">
              {money(numberValue(job, [
                "invoicedValueCents",
                "invoiced_value_cents",
              ]))}
            </DetailValue>
            <DetailValue label="Paid">
              {money(numberValue(job, [
                "paidValueCents",
                "paid_value_cents",
              ]))}
            </DetailValue>
            <DetailValue label="Quotation status">
              {readable(text(job, ["quoteStatus", "quote_status"]))}
            </DetailValue>
            <DetailValue label="Invoice status">
              {readable(text(job, ["invoiceStatus", "invoice_status"]))}
            </DetailValue>
            <DetailValue label="Payment due">
              {dateTime(text(job, ["paymentDueAt", "payment_due_at"]))}
            </DetailValue>
            <DetailValue label="Building type">
              {text(job, ["buildingType", "building_type"])}
            </DetailValue>
          </dl>
        </article>

        <article>
          <h5>Service site</h5>
          {serviceSite ? (
            <dl>
              <DetailValue label="Site">
                {text(serviceSite, ["label"])}
              </DetailValue>
              <DetailValue label="Exact address">
                {privateAddress(serviceSite)}
              </DetailValue>
              <DetailValue label="Access">
                {text(serviceSite, [
                  "accessInstructions",
                  "access_instructions",
                ])}
              </DetailValue>
              <DetailValue label="Parking">
                {text(serviceSite, [
                  "parkingInstructions",
                  "parking_instructions",
                ])}
              </DetailValue>
              <DetailValue label="Hazards">
                {text(serviceSite, ["hazardNotes", "hazard_notes"])}
              </DetailValue>
            </dl>
          ) : (
            <p>No linked service-site record was returned.</p>
          )}
        </article>

        <article>
          <h5>Appointments</h5>
          <div className={styles.privateSubList}>
            {appointments.map((appointment) => (
              <div key={text(appointment, ["id"])}>
                <span>
                  <strong>
                    {text(appointment, ["title"])
                      || readable(text(appointment, [
                        "appointmentType",
                        "appointment_type",
                      ]))}
                  </strong>
                  <StatusPill value={text(appointment, ["status"])} />
                </span>
                <p>
                  {dateTime(text(appointment, ["startsAt", "starts_at"]))} to{" "}
                  {dateTime(text(appointment, ["endsAt", "ends_at"]))}
                </p>
                <small>
                  {text(appointment, ["assigneeLabel", "assignee_label"])
                    || "Assignee not recorded"}
                  {" · "}
                  {text(appointment, ["notes"]) || "No notes"}
                </small>
              </div>
            ))}
            {!appointments.length && (
              <p>No linked appointments were returned.</p>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}

function CaseReview({
  item,
  loading,
  canViewEvidence,
  evidenceAccessReceipts,
  openingEvidenceId,
  onOpenEvidence,
}: {
  item: OperationCase | null;
  loading: boolean;
  canViewEvidence: boolean;
  evidenceAccessReceipts: Record<string, string>;
  openingEvidenceId: string;
  onOpenEvidence: (evidence: OperationEvidence) => void;
}) {
  if (loading && (!item || !item.detailsLoaded)) {
    return <EmptyState>Loading the selected case...</EmptyState>;
  }
  if (!item) {
    return (
      <EmptyState>
        Select a case from the work queue before opening the audit centre.
      </EmptyState>
    );
  }
  if (!item.detailsLoaded) {
    return (
      <EmptyState>
        Detailed case records are unavailable. No absence of evidence,
        findings, decisions, assignments or equipment is implied.
      </EmptyState>
    );
  }
  return (
    <section aria-labelledby="operations-review-title">
      <SectionTitle
        id="operations-review-title"
        title={`Case review / Audit centre | ${item.caseNumber}`}
        description="Evidence, findings, decisions, tasks and equipment stay in one case context."
      />
      <CaseOverview item={item} />
      <PrivateCaseDetails details={item.privateDetails} />
      <div className={styles.auditGrid}>
        <div>
          <h4>Evidence checklist</h4>
          <div className={styles.compactList}>
            {item.evidence.map((evidence) => (
              <article key={evidence.id || evidence.requirementCode}>
                <span>
                  <strong>
                    {evidence.requirementCode || evidence.title
                      || "Evidence requirement"}
                  </strong>
                  <StatusPill value={evidence.status} />
                </span>
                <p>
                  Evidence type{" "}
                  {evidence.evidenceType
                    ? readable(evidence.evidenceType)
                    : "Unknown (not returned by the case API)"} | Timing{" "}
                  {evidence.timing
                    ? readable(evidence.timing)
                    : "Unknown (not returned by the case API)"}
                </p>
                <small>
                  Original {requirementFlag(evidence.originalRequired)}
                  {" | "}Metadata {requirementFlag(evidence.metadataRequired)}
                  {" | "}GPS {requirementFlag(evidence.gpsRequired)}
                </small>
                {canViewEvidence ? (
                  <>
                    <button
                      className={styles.inlineAction}
                      type="button"
                      disabled={
                        !evidence.id || openingEvidenceId === evidence.id
                      }
                      onClick={() => onOpenEvidence(evidence)}
                    >
                      {openingEvidenceId === evidence.id
                        ? "Opening audited evidence..."
                        : "Open audited evidence"}
                    </button>
                    {evidenceAccessReceipts[evidence.id] && (
                      <small className={styles.receipt}>
                        Viewed this session | Receipt{" "}
                        {evidenceAccessReceipts[evidence.id]}
                      </small>
                    )}
                  </>
                ) : (
                  <small>
                    Evidence content is limited to administrators and actively
                    assigned reviewers or auditors.
                  </small>
                )}
              </article>
            ))}
            {!item.evidence.length && (
              <EmptyState>
                No structured evidence checklist was returned for this case.
              </EmptyState>
            )}
          </div>
        </div>
        <div>
          <h4>Findings</h4>
          <div className={styles.compactList}>
            {item.findings.map((finding) => (
              <article key={finding.id || finding.code}>
                <span>
                  <strong>{finding.code || "Compliance finding"}</strong>
                  <StatusPill value={finding.status} />
                </span>
                <p>{finding.description}</p>
                <small>
                  {readable(finding.severity)} | {dateTime(finding.raisedAt)}
                </small>
              </article>
            ))}
            {!item.findings.length && (
              <EmptyState>No findings were returned for this case.</EmptyState>
            )}
          </div>
        </div>
        <div>
          <h4>Case tasks</h4>
          <div className={styles.compactList}>
            {item.tasks.map((task) => (
              <article key={task.id}>
                <span>
                  <strong>{task.title}</strong>
                  <StatusPill value={task.status} />
                </span>
                <p>{task.detail || "No further detail recorded."}</p>
                <small>
                  {readable(task.priority)} | Due {dateTime(task.dueAt)}
                </small>
              </article>
            ))}
            {!item.tasks.length && (
              <EmptyState>No tasks were returned for this case.</EmptyState>
            )}
          </div>
        </div>
        <div>
          <h4>Immutable decisions</h4>
          <div className={styles.compactList}>
            {item.decisionRequests.map((request) => (
              <article key={request.id}>
                <span>
                  <strong>
                    {readable(request.status)} {readable(request.type)} request
                  </strong>
                  <StatusPill value={request.status} />
                </span>
                <p>
                  Proposed {readable(request.outcome)} | Primary reviewer{" "}
                  {request.primaryReviewer || "not returned"}
                </p>
                <small>
                  Basis {request.basisRecorded ? "recorded" : "missing"} |{" "}
                  Case revision {request.caseRevision || "not returned"} |{" "}
                  {dateTime(request.createdAt)}
                </small>
              </article>
            ))}
            {item.decisions.map((decision) => (
              <article key={decision.id}>
                <span>
                  <strong>{readable(decision.type)}</strong>
                  <StatusPill value={decision.outcome} />
                </span>
                <p>
                  Primary reviewer {decision.primaryReviewer || "not recorded"}
                </p>
                <small>
                  Secondary reviewer{" "}
                  {decision.secondaryReviewer || "not recorded"} |{" "}
                  Case revision {decision.caseRevision || "not returned"} |{" "}
                  {dateTime(decision.decidedAt)}
                </small>
              </article>
            ))}
            {!item.decisions.length && !item.decisionRequests.length && (
              <EmptyState>
                No compliance decisions were returned. No approval is implied.
              </EmptyState>
            )}
          </div>
        </div>
        <div>
          <h4>Equipment</h4>
          <div className={styles.compactList}>
            {item.equipment.map((equipment) => (
              <article key={equipment.id}>
                <span>
                  <strong>
                    {[equipment.manufacturer, equipment.model]
                      .filter(Boolean)
                      .join(" ") || "Equipment description not returned"}
                  </strong>
                  <StatusPill value={equipment.status} />
                </span>
                <p>
                  {readable(equipment.recordType)} | Serial{" "}
                  {equipment.serialNumber || "not returned"} | Quantity{" "}
                  {equipment.quantity}
                </p>
                <small>Recorded {dateTime(equipment.recordedAt)}</small>
              </article>
            ))}
            {!item.equipment.length && (
              <EmptyState>
                No equipment records were returned for this case.
              </EmptyState>
            )}
          </div>
        </div>
        <div>
          <h4>Calculation runs</h4>
          <div className={styles.compactList}>
            {item.calculationRuns.map((run) => (
              <article key={run.id}>
                <span>
                  <strong>
                    {run.calculatorKey || "Calculator key not returned"}
                    {run.version ? ` version ${run.version}` : ""}
                  </strong>
                  <StatusPill value={run.status} />
                </span>
                <p>
                  Output type {run.outputType || "not returned"}
                  {run.blockedReason ? ` | ${run.blockedReason}` : ""}
                </p>
                <small>
                  Run {dateTime(run.runAt)} | Verified{" "}
                  {dateTime(run.verifiedAt)}
                </small>
              </article>
            ))}
            {!item.calculationRuns.length && (
              <EmptyState>
                No calculation runs were returned. No certificate quantity is
                implied.
              </EmptyState>
            )}
          </div>
        </div>
        <div>
          <h4>Case history</h4>
          <div className={styles.compactList}>
            {item.events.map((event) => (
              <article key={event.id}>
                <span>
                  <strong>{readable(event.type)}</strong>
                  <small>{dateTime(event.createdAt)}</small>
                </span>
                <p>{event.summary || "No event summary recorded."}</p>
                <small>
                  {readable(event.actorType)} |{" "}
                  {event.actor || "Actor not recorded"}
                </small>
              </article>
            ))}
            {!item.events.length && (
              <EmptyState>No case history events were returned.</EmptyState>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function DisabledPanel({
  title,
  reason,
  action,
}: {
  title: string;
  reason: string;
  action: string;
}) {
  return (
    <aside className={styles.disabledPanel}>
      <div>
        <strong>{title}</strong>
        <p>{reason}</p>
      </div>
      <DisabledAction reason={reason}>{action}</DisabledAction>
    </aside>
  );
}

function AccessView({
  session,
  access,
  loading,
  error,
  onRefresh,
}: {
  session: WorkspaceSession;
  access: AccessSnapshot;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const [form, setForm] = useState({
    displayName: "",
    email: "",
    role: "reviewer",
  });
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [memberDrafts, setMemberDrafts] = useState<
    Record<string, { role: string; status: string }>
  >({});

  async function accessAction(
    action: string,
    body: Record<string, unknown>,
    successMessage: string,
  ) {
    setBusy(action);
    setActionError("");
    setNotice("");
    try {
      await authenticatedJson("/api/creditex/access", {
        method: "POST",
        body: JSON.stringify({ action, ...body }),
      });
      setNotice(successMessage);
      onRefresh();
      return true;
    } catch (actionFailure) {
      setActionError(
        actionFailure instanceof Error
          ? actionFailure.message
          : "The access action could not be completed.",
      );
      return false;
    } finally {
      setBusy("");
    }
  }

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await accessAction(
      "create_invitation",
      form,
      "The named invitation record was created. Email delivery is not connected, so no invitation email was sent.",
    );
    if (created) {
      setForm({ displayName: "", email: "", role: "reviewer" });
    }
  }

  async function updateMemberAccess(member: AccessMember) {
    const draft = memberDrafts[member.id] || {
      role: member.role,
      status: member.status,
    };
    if (
      !window.confirm(
        `Apply ${readable(draft.role)} and ${readable(draft.status)} access to ${member.displayName || member.email}?`,
      )
    ) return;
    const updated = await accessAction("update_member_access", {
      memberId: member.id,
      role: draft.role,
      status: draft.status,
    }, "The named member access record was updated.");
    if (updated) {
      setMemberDrafts((current) => {
        const next = { ...current };
        delete next[member.id];
        return next;
      });
    }
  }

  async function revokeInvitation(invitation: AccessInvitation) {
    if (!window.confirm(
      `Revoke the pending invitation for ${invitation.displayName || invitation.email}?`,
    )) return;
    await accessAction(
      "revoke_invitation",
      { invitationId: invitation.id },
      "The pending invitation was revoked.",
    );
  }

  return (
    <section aria-labelledby="operations-access-title">
      <div className={styles.sectionHeader}>
        <div>
          <h3 id="operations-access-title">Access</h3>
          <p>
            Verified Firebase identities and named Creditex memberships only.
          </p>
        </div>
        {session.role === "admin" && (
          <button
            className={styles.refreshButton}
            type="button"
            disabled={loading}
            onClick={onRefresh}
          >
            {loading ? "Refreshing..." : "Refresh access"}
          </button>
        )}
      </div>
      <div className={styles.accessPolicy}>
        <span>Initial owner invitation</span>
        <strong>
          {access.ownerEmail || "info@ausenergyassessments.com"}
        </strong>
        <p>
          This address establishes the first administrator. It is not a shared
          Creditex login. The administrator must invite each team member by
          their own verified email and assign the minimum role they need. Once
          at least two named administrators are active, suspend the bootstrap
          mailbox membership below.
        </p>
      </div>
      {session.role !== "admin" && (
        <EmptyState>
          Your {readable(session.role)} role can use operational work areas but
          cannot administer memberships or invitations.
        </EmptyState>
      )}
      {session.role === "admin" && error && (
        <p className={styles.error} role="alert">{error}</p>
      )}
      {session.role === "admin" && notice && (
        <p className={styles.success} role="status">{notice}</p>
      )}
      {session.role === "admin" && actionError && (
        <p className={styles.error} role="alert">{actionError}</p>
      )}
      {session.role === "admin" && (
        <form className={styles.localForm} onSubmit={createInvitation}>
          <div className={`${styles.formIntro} ${styles.formWide}`}>
            <strong>Invite a named team member</strong>
            <p>
              Enter one person&apos;s full name and individual verified email.
              Shared or role-based mailboxes are rejected by the access API.
            </p>
          </div>
          <label>
            Full name
            <input
              required
              maxLength={180}
              autoComplete="name"
              value={form.displayName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  displayName: event.target.value,
                }))}
            />
          </label>
          <label>
            Individual email
            <input
              required
              type="email"
              maxLength={320}
              autoComplete="email"
              value={form.email}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  email: event.target.value,
                }))}
            />
          </label>
          <label>
            Role
            <select
              value={form.role}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  role: event.target.value,
                }))}
            >
              <option value="case_manager">Case manager</option>
              <option value="reviewer">Reviewer</option>
              <option value="auditor">Auditor</option>
              <option value="admin">Administrator</option>
            </select>
          </label>
          <button
            className={styles.primaryAction}
            type="submit"
            disabled={busy === "create_invitation"}
          >
            {busy === "create_invitation"
              ? "Creating invitation..."
              : "Create named invitation"}
          </button>
        </form>
      )}
      {session.role === "admin" && (
        <div className={styles.splitColumns}>
          <div>
            <h4 className={styles.subheading}>Named members</h4>
            <div className={styles.compactList}>
              {access.members.map((member) => {
                const draft = memberDrafts[member.id] || {
                  role: member.role,
                  status: member.status,
                };
                const changed = draft.role !== member.role
                  || draft.status !== member.status;
                const bootstrapMailbox =
                  member.email.toLowerCase()
                  === "info@ausenergyassessments.com";
                return (
                  <article key={member.id}>
                    <span>
                      <strong>{member.displayName || member.email}</strong>
                      <StatusPill value={member.status} />
                    </span>
                    <p>{member.email} | {readable(member.role)}</p>
                    <small>
                      Last login {dateTime(member.lastLoginAt)}
                      {bootstrapMailbox ? " | Bootstrap mailbox membership" : ""}
                    </small>
                    <div className={styles.memberAccessControls}>
                      <label>
                        Role
                        <select
                          value={draft.role}
                          onChange={(event) =>
                            setMemberDrafts((current) => ({
                              ...current,
                              [member.id]: {
                                ...draft,
                                role: event.target.value,
                              },
                            }))}
                        >
                          <option value="case_manager">Case manager</option>
                          <option value="reviewer">Reviewer</option>
                          <option value="auditor">Auditor</option>
                          <option value="admin">Administrator</option>
                        </select>
                      </label>
                      <label>
                        Access state
                        <select
                          value={draft.status}
                          onChange={(event) =>
                            setMemberDrafts((current) => ({
                              ...current,
                              [member.id]: {
                                ...draft,
                                status: event.target.value,
                              },
                            }))}
                        >
                          <option value="active">Active</option>
                          <option value="suspended">Suspended</option>
                        </select>
                      </label>
                      <button
                        className={styles.inlineAction}
                        type="button"
                        disabled={!changed || busy === "update_member_access"}
                        onClick={() => void updateMemberAccess(member)}
                      >
                        Apply access change
                      </button>
                    </div>
                  </article>
                );
              })}
              {access.loaded && !access.members.length && (
                <EmptyState>No active member records were returned.</EmptyState>
              )}
              {!access.loaded && !loading && !error && (
                <EmptyState>Open this view to load access records.</EmptyState>
              )}
            </div>
          </div>
          <div>
            <h4 className={styles.subheading}>Invitations</h4>
            <div className={styles.compactList}>
              {access.invitations.map((invitation) => (
                <article key={invitation.id}>
                  <span>
                    <strong>{invitation.displayName || invitation.email}</strong>
                    <StatusPill value={invitation.status} />
                  </span>
                  <p>{invitation.email} | {readable(invitation.role)}</p>
                  <small>Expires {dateTime(invitation.expiresAt)}</small>
                  {invitation.status === "pending" && (
                    <button
                      className={styles.inlineAction}
                      type="button"
                      disabled={busy === "revoke_invitation"}
                      onClick={() =>
                        void revokeInvitation(invitation)}
                    >
                      Revoke invitation
                    </button>
                  )}
                </article>
              ))}
              {access.loaded && !access.invitations.length && (
                <EmptyState>No invitation records were returned.</EmptyState>
              )}
            </div>
          </div>
        </div>
      )}
      <DisabledPanel
        title="Private identity import"
        reason="Bulk access imports and shared credentials are not permitted. Named invitations must be created through an approved local access action."
        action="Import users"
      />
    </section>
  );
}
