import type { ComplianceIdentity } from "./compliance-access-server";
import {
  CREDITEX_VEU_PILOT_ACTIVITIES,
  CREDITEX_VEU_PILOT_CONFIRMATION,
  CREDITEX_VEU_PILOT_CONTROL_OPTIONS,
  CREDITEX_VEU_PILOT_EVIDENCE_CONTRACTS,
  CREDITEX_VEU_PILOT_INSTALLER_COUNT,
  CREDITEX_VEU_PILOT_JOBS_PER_TECHNICIAN,
  CREDITEX_VEU_PILOT_JOB_COUNT,
  CREDITEX_VEU_PILOT_SEED_VERSION,
  CREDITEX_VEU_PILOT_SOURCES,
  CREDITEX_VEU_PILOT_TECHNICIANS_PER_INSTALLER,
  calculatorInputSchema,
  calculatorOutputSchema,
} from "./creditex-veu-pilot-contract";

const PILOT_PAGE_SIZES = new Set([25, 50, 100, 300]);
const REVIEW_STATUSES = new Set([
  "test_ready",
  "in_review",
  "changes_required",
  "test_complete",
  "archived",
]);
const EVIDENCE_STATUSES = new Set([
  "not_started",
  "in_progress",
  "transport_complete",
  "changes_required",
]);
const LOOKUP_STATUSES = new Set(["not_checked", "blocked", "verified"]);
const RULE_STATUSES = new Set([
  "blocked_pending_independent_review",
  "verified",
]);
const CALCULATOR_STATUSES = new Set([
  "blocked_unverified_formula",
  "verified",
]);
const CONNECTOR_STATUSES = new Set([
  "not_staged",
  "dry_run_staged",
  "dry_run_reconciled",
]);
const WORK_STAGES = new Set([
  "backlog",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
]);
const WORK_PRIORITIES = new Set(["low", "standard", "high", "urgent"]);
const APPOINTMENT_TYPES = new Set([
  "installation",
  "site_visit",
  "assessment",
  "service",
]);
const APPOINTMENT_STATUSES = new Set([
  "scheduled",
  "travelling",
  "arrived",
  "in_progress",
  "completed",
  "cancelled",
]);
const CUSTOMER_TYPES = new Set(["residential", "business"]);
const SERVICE_CATEGORIES: Set<string> = new Set(
  CREDITEX_VEU_PILOT_ACTIVITIES.map((activity) => activity.serviceCategory),
);
const PRODUCT_CATEGORIES: Set<string> = new Set(
  CREDITEX_VEU_PILOT_ACTIVITIES
    .map((activity) => activity.productCategory)
    .filter(Boolean),
);
const PILOT_DATE_FIELDS = {
  activityDate: "job.activity_date",
  scheduledStart: "appointment.starts_at",
  createdAt: "job.created_at",
  updatedAt: "job.updated_at",
} as const;
const PILOT_SORT_COLUMNS = {
  appointmentId: "appointment.id",
  jobNumber: "job.job_number",
  caseNumber: "job.case_number",
  reviewStatus: "job.review_status",
  evidenceStatus: "job.evidence_status",
  workType: "work.work_type",
  scheduledStart: "appointment.starts_at",
  scheduledEnd: "appointment.ends_at",
  connectorStatus: "job.connector_status",
  activityDate: "job.activity_date",
  technician: "technician.display_name",
  technicianCode: "technician.technician_code",
  installer: "installer.business_name",
  installerCode: "installer.company_code",
  customer: "customer.last_name",
  companyName: "customer.business_name",
  customerNumber: "customer.customer_number",
  phone: "customer.phone",
  email: "customer.email",
  address: "site.address_line_1",
  suburb: "site.suburb",
  state: "site.address_state",
  postcode: "site.postcode",
  registryActivityCode: "job.registry_activity_code",
  specificationPart: "job.specification_part",
  activityTitle: "job.title",
  serviceCategory: "job.service_category",
  productCategory: "job.product_category",
  scenario: "job.scenario",
  ruleStatus: "job.rule_status",
  lookupStatus: "job.lookup_status",
  calculatorStatus: "job.calculator_status",
  workStage: "work.stage",
  priority: "work.priority",
  appointmentType: "appointment.appointment_type",
  appointmentStatus: "appointment.status",
  pipelineStage: "detail.pipeline_stage",
  quoteStatus: "detail.quote_status",
  invoiceStatus: "detail.invoice_status",
  createdAt: "job.created_at",
  updatedAt: "job.updated_at",
} as const;
type PilotSortKey = keyof typeof PILOT_SORT_COLUMNS;
type PilotDateField = keyof typeof PILOT_DATE_FIELDS;

type PilotRunRow = {
  id: string;
  organisation_id: string;
  program_code: string;
  name: string;
  seed_version: string;
  record_mode: string;
  status: string;
  installer_target: number;
  technicians_per_installer: number;
  jobs_per_technician: number;
  activity_catalogue_sha256: string;
  source_manifest_sha256: string;
  rule_import_status: string;
  lookup_status: string;
  evidence_status: string;
  calculator_status: string;
  connector_status: string;
  created_by_uid: string;
  created_at: string;
  activated_at: string;
  archived_at: string;
  updated_at: string;
};

export type CreditexPilotFilters = {
  installerId: string;
  technicianId: string;
  activityTemplateId: string;
  reviewStatus: string;
  evidenceStatus: string;
  lookupStatus: string;
  ruleStatus: string;
  calculatorStatus: string;
  connectorStatus: string;
  workStage: string;
  workType: string;
  priority: string;
  appointmentType: string;
  appointmentStatus: string;
  customerType: string;
  serviceCategory: string;
  productCategory: string;
  postcode: string;
  tag: string;
  dateField: PilotDateField;
  dateFrom: string;
  dateTo: string;
  sortBy: PilotSortKey;
  sortDirection: "asc" | "desc";
  query: string;
  page: number;
  pageSize: 25 | 50 | 100 | 300;
};

export class CreditexVeuPilotError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function textValue(value: unknown, maximum = 160) {
  return String(value || "").trim().slice(0, maximum);
}

function integerValue(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : 0;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function pilotRunId(organisationId: string) {
  return [
    "creditex-veu-pilot",
    CREDITEX_VEU_PILOT_SEED_VERSION,
    organisationId,
  ].join(":");
}

function padded(value: number) {
  return String(value).padStart(2, "0");
}

function activityDate(globalJobIndex: number) {
  const date = new Date(Date.UTC(2026, 7, 4 + (globalJobIndex % 90)));
  return date.toISOString().slice(0, 10);
}

function scheduledAt(date: string, hour: number) {
  const offset = date >= "2026-10-04" ? "+11:00" : "+10:00";
  return `${date}T${String(hour).padStart(2, "0")}:00:00${offset}`;
}

function metadata(value: unknown) {
  return canonicalJson(value);
}

function insertRows(
  database: D1Database,
  tableName: string,
  columnNames: readonly string[],
  rows: readonly (readonly unknown[])[],
): D1PreparedStatement[] {
  const identifiers = [tableName, ...columnNames];
  if (
    !rows.length
    || !columnNames.length
    || identifiers.some((identifier) => !/^[a-z][a-z0-9_]*$/.test(identifier))
    || rows.some((row) => row.length !== columnNames.length)
  ) {
    throw new Error("CREDITEX_PILOT_INSERT_CONTRACT_INVALID");
  }
  const columns = columnNames.map((column) => `\`${column}\``).join(", ");
  const rowPlaceholders = `(${columnNames.map(() => "?").join(", ")})`;
  const rowsPerStatement = Math.max(1, Math.floor(100 / columnNames.length));
  const statements: D1PreparedStatement[] = [];
  for (let offset = 0; offset < rows.length; offset += rowsPerStatement) {
    const rowChunk = rows.slice(offset, offset + rowsPerStatement);
    const placeholders = rowChunk.map(() => rowPlaceholders).join(", ");
    statements.push(database.prepare(
      `INSERT INTO \`${tableName}\` (${columns}) VALUES ${placeholders}`,
    ).bind(...rowChunk.flatMap((row) => Array.from(row))));
  }
  return statements;
}

function assertAdministrator(member: ComplianceIdentity) {
  if (member.role !== "admin") {
    throw new CreditexVeuPilotError(
      "CREDITEX_PILOT_ADMIN_REQUIRED",
      403,
      "Creditex administrator access is required for synthetic pilot control.",
    );
  }
}

function assertRecentAuthentication(member: ComplianceIdentity) {
  const nowSeconds = Math.floor(Date.now() / 1_000);
  if (
    !member.authTime
    || member.authTime > nowSeconds
    || nowSeconds - member.authTime > 60 * 60 * 2
  ) {
    throw new CreditexVeuPilotError(
      "CREDITEX_PILOT_RECENT_AUTH_REQUIRED",
      403,
      "Sign out and sign in again before creating or archiving synthetic pilot data.",
    );
  }
}

export function parseCreditexPilotFilters(
  searchParams: URLSearchParams,
): CreditexPilotFilters {
  const pageSize = integerValue(searchParams.get("pageSize")) || 50;
  const page = integerValue(searchParams.get("page"));
  if (!PILOT_PAGE_SIZES.has(pageSize) || page < 0) {
    throw new CreditexVeuPilotError(
      "CREDITEX_PILOT_FILTER_INVALID",
      400,
      "Choose a supported synthetic pilot page.",
    );
  }
  const reviewStatus = textValue(searchParams.get("reviewStatus"), 40);
  const evidenceStatus = textValue(searchParams.get("evidenceStatus"), 40);
  const lookupStatus = textValue(searchParams.get("lookupStatus"), 40);
  const ruleStatus = textValue(searchParams.get("ruleStatus"), 64);
  const calculatorStatus = textValue(
    searchParams.get("calculatorStatus"),
    64,
  );
  const connectorStatus = textValue(searchParams.get("connectorStatus"), 40);
  const workStage = textValue(searchParams.get("workStage"), 40);
  const workType = textValue(searchParams.get("workType"), 40);
  const priority = textValue(searchParams.get("priority"), 40);
  const appointmentType = textValue(searchParams.get("appointmentType"), 40);
  const appointmentStatus = textValue(
    searchParams.get("appointmentStatus"),
    40,
  );
  const customerType = textValue(searchParams.get("customerType"), 40);
  const serviceCategory = textValue(searchParams.get("serviceCategory"), 80);
  const productCategory = textValue(searchParams.get("productCategory"), 80);
  const dateField =
    textValue(searchParams.get("dateField"), 40) || "activityDate";
  const dateFrom = textValue(searchParams.get("dateFrom"), 10);
  const dateTo = textValue(searchParams.get("dateTo"), 10);
  const sortBy = textValue(searchParams.get("sortBy"), 40) || "jobNumber";
  const sortDirection =
    textValue(searchParams.get("sortDirection"), 4) || "asc";
  const validDate = (value: string) =>
    !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (
    (reviewStatus && !REVIEW_STATUSES.has(reviewStatus))
    || (evidenceStatus && !EVIDENCE_STATUSES.has(evidenceStatus))
    || (lookupStatus && !LOOKUP_STATUSES.has(lookupStatus))
    || (ruleStatus && !RULE_STATUSES.has(ruleStatus))
    || (calculatorStatus && !CALCULATOR_STATUSES.has(calculatorStatus))
    || (connectorStatus && !CONNECTOR_STATUSES.has(connectorStatus))
    || (workStage && !WORK_STAGES.has(workStage))
    || (workType && workType !== "job")
    || (priority && !WORK_PRIORITIES.has(priority))
    || (appointmentType && !APPOINTMENT_TYPES.has(appointmentType))
    || (appointmentStatus && !APPOINTMENT_STATUSES.has(appointmentStatus))
    || (customerType && !CUSTOMER_TYPES.has(customerType))
    || (serviceCategory && !SERVICE_CATEGORIES.has(serviceCategory))
    || (productCategory && !PRODUCT_CATEGORIES.has(productCategory))
    || !(dateField in PILOT_DATE_FIELDS)
    || !validDate(dateFrom)
    || !validDate(dateTo)
    || (dateFrom && dateTo && dateFrom > dateTo)
    || !(sortBy in PILOT_SORT_COLUMNS)
    || !["asc", "desc"].includes(sortDirection)
  ) {
    throw new CreditexVeuPilotError(
      "CREDITEX_PILOT_FILTER_INVALID",
      400,
      "Choose a controlled synthetic pilot filter value.",
    );
  }
  return {
    installerId: textValue(searchParams.get("installerId"), 160),
    technicianId: textValue(searchParams.get("technicianId"), 160),
    activityTemplateId: textValue(
      searchParams.get("activityTemplateId"),
      160,
    ),
    reviewStatus,
    evidenceStatus,
    lookupStatus,
    ruleStatus,
    calculatorStatus,
    connectorStatus,
    workStage,
    workType,
    priority,
    appointmentType,
    appointmentStatus,
    customerType,
    serviceCategory,
    productCategory,
    postcode: textValue(searchParams.get("postcode"), 12),
    tag: textValue(searchParams.get("tag"), 80),
    dateField: dateField as PilotDateField,
    dateFrom,
    dateTo,
    sortBy: sortBy as PilotSortKey,
    sortDirection: sortDirection as "asc" | "desc",
    query: textValue(searchParams.get("q"), 100),
    page,
    pageSize: pageSize as 25 | 50 | 100 | 300,
  };
}

async function expectedPilotHashes() {
  const activityCatalogueSha256 = await sha256Hex(canonicalJson(
    CREDITEX_VEU_PILOT_ACTIVITIES,
  ));
  const sourceManifestSha256 = await sha256Hex(canonicalJson(
    CREDITEX_VEU_PILOT_SOURCES,
  ));
  return { activityCatalogueSha256, sourceManifestSha256 };
}

async function currentPilotRun(
  database: D1Database,
  organisationId: string,
) {
  return database.prepare(`SELECT *
    FROM compliance_pilot_runs
    WHERE organisation_id = ? AND program_code = 'VEU'
      AND seed_version = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1`)
    .bind(organisationId, CREDITEX_VEU_PILOT_SEED_VERSION)
    .first<PilotRunRow>();
}

async function latestPilotRunAnySeed(
  database: D1Database,
  organisationId: string,
) {
  return database.prepare(`SELECT *
    FROM compliance_pilot_runs
    WHERE organisation_id = ? AND program_code = 'VEU'
    ORDER BY created_at DESC, id DESC
    LIMIT 1`)
    .bind(organisationId)
    .first<PilotRunRow>();
}

async function unarchivedPilotRunAnySeed(
  database: D1Database,
  organisationId: string,
) {
  return database.prepare(`SELECT *
    FROM compliance_pilot_runs
    WHERE organisation_id = ? AND program_code = 'VEU'
      AND status <> 'archived'
    ORDER BY created_at DESC, id DESC
    LIMIT 1`)
    .bind(organisationId)
    .first<PilotRunRow>();
}

async function assertRunContract(run: PilotRunRow) {
  const expected = await expectedPilotHashes();
  if (
    run.seed_version !== CREDITEX_VEU_PILOT_SEED_VERSION
    || run.record_mode !== "synthetic_test"
    || run.activity_catalogue_sha256 !== expected.activityCatalogueSha256
    || run.source_manifest_sha256 !== expected.sourceManifestSha256
  ) {
    throw new CreditexVeuPilotError(
      "CREDITEX_PILOT_RECONCILIATION_REQUIRED",
      409,
      "The existing synthetic pilot does not match the current immutable seed contract.",
    );
  }
  return expected;
}

function pilotTargets() {
  return {
    installers: CREDITEX_VEU_PILOT_INSTALLER_COUNT,
    technicians:
      CREDITEX_VEU_PILOT_INSTALLER_COUNT
      * CREDITEX_VEU_PILOT_TECHNICIANS_PER_INSTALLER,
    jobs: CREDITEX_VEU_PILOT_JOB_COUNT,
    techniciansPerInstaller: CREDITEX_VEU_PILOT_TECHNICIANS_PER_INSTALLER,
    jobsPerTechnician: CREDITEX_VEU_PILOT_JOBS_PER_TECHNICIAN,
    activityFamilies: CREDITEX_VEU_PILOT_ACTIVITIES.length,
  };
}

function pilotPriorities(run: PilotRunRow | null) {
  return [
    {
      key: "official_instruments",
      number: 1,
      title: "Official instrument import",
      status: run?.rule_import_status
        || "captured_pending_independent_review",
      complete: run?.rule_import_status === "independently_verified",
      boundary:
        "The current official hierarchy and known transition dates are captured. Publication stays blocked until exact retained bytes and every transcription are independently verified.",
    },
    {
      key: "controlled_lookups",
      number: 2,
      title: "Participant, licence and product lookups",
      status: run?.lookup_status || "contracts_ready_live_sources_blocked",
      complete: run?.lookup_status === "verified",
      boundary:
        "Controlled dropdown contracts are populated. Live regulator, licence, product, recall and suspension checks remain fail-closed until authorised connectors exist.",
    },
    {
      key: "original_evidence",
      number: 3,
      title: "Original evidence custody",
      status: run?.evidence_status
        || "transport_contract_ready_physical_acceptance_blocked",
      complete: run?.evidence_status === "verified",
      boundary:
        "Original-byte, metadata, GPS and timing test slots are defined. Government shot lists, signatures, platform attestation, representative devices, retention and restore remain blocked.",
    },
    {
      key: "calculator_contracts",
      number: 4,
      title: "Typed calculator outputs",
      status: run?.calculator_status
        || "typed_contract_ready_formula_blocked",
      complete: run?.calculator_status === "verified",
      boundary:
        "Every VEU activity family has a typed input and output contract. No quantity is calculated until official equations, tables, rounding and independent vectors reconcile.",
    },
    {
      key: "connector_cutover",
      number: 5,
      title: "Dry-run connector and legacy cutover",
      status: run?.connector_status || "dry_run_only",
      complete: run?.connector_status === "authorised",
      boundary:
        "The synthetic manifest is deterministic and locally validated. It records zero regulator acceptances. Live registry submission and Dataforce or Runabout cutover remain blocked pending authority, schemas and representative exports.",
    },
  ];
}

export async function startCreditexVeuPilot(
  database: D1Database,
  member: ComplianceIdentity,
  confirmation: unknown,
) {
  assertAdministrator(member);
  assertRecentAuthentication(member);
  if (textValue(confirmation, 80) !== CREDITEX_VEU_PILOT_CONFIRMATION) {
    throw new CreditexVeuPilotError(
      "CREDITEX_PILOT_CONFIRMATION_REQUIRED",
      400,
      `Type ${CREDITEX_VEU_PILOT_CONFIRMATION} exactly to create the isolated test dataset.`,
    );
  }
  const existing = await currentPilotRun(database, member.organisationId);
  if (existing) {
    await assertRunContract(existing);
    return { runId: existing.id, alreadyExists: true };
  }
  const previous = await unarchivedPilotRunAnySeed(
    database,
    member.organisationId,
  );
  if (previous) {
    throw new CreditexVeuPilotError(
      "CREDITEX_PILOT_PREVIOUS_SEED_ACTIVE",
      409,
      "Archive the previous synthetic VEU pilot before creating the current government-source seed.",
    );
  }
  const now = new Date().toISOString();
  const runId = pilotRunId(member.organisationId);
  const hashes = await expectedPilotHashes();
  const statements: D1PreparedStatement[] = [
    database.prepare(`INSERT INTO compliance_pilot_runs (
        id, organisation_id, program_code, name, seed_version, record_mode,
        status, installer_target, technicians_per_installer,
        jobs_per_technician, activity_catalogue_sha256,
        source_manifest_sha256, rule_import_status, lookup_status,
        evidence_status, calculator_status, connector_status,
        created_by_uid, created_at, activated_at, archived_at, updated_at
      ) VALUES (
        ?, ?, 'VEU', 'Creditex VEU synthetic workflow pilot', ?,
        'synthetic_test', 'provisioning', 10, 3, 10, ?, ?,
        'captured_pending_independent_review',
        'contracts_ready_live_sources_blocked',
        'transport_contract_ready_physical_acceptance_blocked',
        'typed_contract_ready_formula_blocked', 'dry_run_only',
        ?, ?, '', '', ?
      )`).bind(
      runId,
      member.organisationId,
      CREDITEX_VEU_PILOT_SEED_VERSION,
      hashes.activityCatalogueSha256,
      hashes.sourceManifestSha256,
      member.uid,
      now,
      now,
    ),
  ];
  statements.push(
    ...insertRows(
      database,
      "compliance_pilot_source_instruments",
      [
        "id",
        "pilot_run_id",
        "source_key",
        "source_kind",
        "title",
        "official_source_url",
        "official_version",
        "effective_from",
        "effective_to",
        "official_source_sha256",
        "hash_status",
        "verification_status",
        "source_priority",
        "captured_at",
        "verified_by_uid",
        "verified_at",
        "verification_note",
      ],
      CREDITEX_VEU_PILOT_SOURCES.map((source, index) => [
        `${runId}:source:${String(index + 1).padStart(2, "0")}`,
        runId,
        source.sourceKey,
        source.sourceKind,
        source.title,
        source.officialSourceUrl,
        source.officialVersion,
        source.effectiveFrom,
        source.effectiveTo,
        source.officialSourceSha256,
        source.hashStatus,
        "pending_independent_review",
        source.sourcePriority,
        now,
        "",
        "",
        "",
      ]),
    ),
    ...insertRows(
      database,
      "compliance_pilot_control_options",
      [
        "id",
        "pilot_run_id",
        "control_type",
        "option_code",
        "label",
        "option_order",
        "effective_from",
        "effective_to",
        "source_key",
        "live_lookup_enabled",
        "created_at",
      ],
      CREDITEX_VEU_PILOT_CONTROL_OPTIONS.map((option, index) => [
        `${runId}:control:${String(index + 1).padStart(3, "0")}`,
        runId,
        option.controlType,
        option.optionCode,
        option.label,
        option.optionOrder,
        "2026-08-01",
        "",
        option.sourceKey,
        0,
        now,
      ]),
    ),
    ...insertRows(
      database,
      "compliance_pilot_evidence_contracts",
      [
        "id",
        "pilot_run_id",
        "requirement_code",
        "title",
        "evidence_kind",
        "capture_timing",
        "original_required",
        "metadata_required",
        "gps_required",
        "minimum_count",
        "maximum_count",
        "allowed_content_types",
        "contract_scope",
        "government_requirement_status",
        "source_key",
        "option_order",
        "created_at",
      ],
      CREDITEX_VEU_PILOT_EVIDENCE_CONTRACTS.map(
        (requirement, index) => [
          `${runId}:evidence:${String(index + 1).padStart(2, "0")}`,
          runId,
          requirement.requirementCode,
          requirement.title,
          requirement.evidenceKind,
          requirement.captureTiming,
          requirement.originalRequired ? 1 : 0,
          requirement.metadataRequired ? 1 : 0,
          requirement.gpsRequired ? 1 : 0,
          requirement.minimumCount,
          requirement.maximumCount,
          metadata(requirement.allowedContentTypes),
          "transport_validation_only",
          "not_transcribed",
          requirement.sourceKey,
          index,
          now,
        ],
      ),
    ),
    ...insertRows(
      database,
      "compliance_pilot_calculator_contracts",
      [
        "id",
        "pilot_run_id",
        "activity_template_id",
        "registry_activity_code",
        "input_schema",
        "output_schema",
        "output_unit",
        "formula_status",
        "test_vector_status",
        "source_key",
        "created_at",
      ],
      CREDITEX_VEU_PILOT_ACTIVITIES.map((activity, index) => [
        `${runId}:calculator:${String(index + 1).padStart(2, "0")}`,
        runId,
        activity.templateId,
        activity.registryActivityCode,
        metadata(calculatorInputSchema(activity)),
        metadata(calculatorOutputSchema(activity)),
        "VEEC",
        "blocked_pending_independent_verification",
        "not_available",
        activity.templateId.startsWith("veu-pba")
          ? activity.templateId.includes("mv")
            ? "veu-measurement-verification-v8"
            : "veu-benchmark-rating-v2"
          : "veu-specifications-v25",
        now,
      ]),
    ),
  );
  statements.push(database.prepare(`INSERT INTO
      compliance_pilot_events (
        id, pilot_run_id, organisation_id, event_type, actor_uid,
        summary, metadata, created_at
      ) VALUES (?, ?, ?, 'pilot.created', ?,
        'Creditex administrator created the isolated VEU synthetic pilot contract.',
        ?, ?)`).bind(
    `${runId}:event:created`,
    runId,
    member.organisationId,
    member.uid,
    metadata({
      recordMode: "synthetic_test",
      targets: pilotTargets(),
      externalExecutionEnabled: false,
    }),
    now,
  ));
  await database.batch(statements);
  const created = await currentPilotRun(database, member.organisationId);
  if (!created) {
    throw new CreditexVeuPilotError(
      "CREDITEX_PILOT_CREATE_FAILED",
      500,
      "The synthetic VEU pilot contract was not created.",
    );
  }
  await assertRunContract(created);
  return { runId: created.id, alreadyExists: false };
}

async function provisionedCohorts(
  database: D1Database,
  runId: string,
) {
  const result = await database.prepare(`SELECT
      installer.installer_slot,
      technician.technician_slot,
      technician.id AS technician_id,
      COUNT(job.id) AS job_count
    FROM compliance_pilot_installers installer
    JOIN compliance_pilot_technicians technician
      ON technician.installer_id = installer.id
      AND technician.pilot_run_id = installer.pilot_run_id
    LEFT JOIN compliance_pilot_jobs job
      ON job.technician_id = technician.id
      AND job.pilot_run_id = technician.pilot_run_id
    WHERE installer.pilot_run_id = ?
    GROUP BY installer.installer_slot, technician.technician_slot,
      technician.id
    ORDER BY installer.installer_slot, technician.technician_slot`)
    .bind(runId)
    .all<{
      installer_slot: number;
      technician_slot: number;
      technician_id: string;
      job_count: number;
    }>();
  return result.results;
}

function nextPilotCohort(
  rows: Awaited<ReturnType<typeof provisionedCohorts>>,
) {
  const byKey = new Map(
    rows.map((row) => [
      `${row.installer_slot}:${row.technician_slot}`,
      row,
    ]),
  );
  for (
    let installerSlot = 1;
    installerSlot <= CREDITEX_VEU_PILOT_INSTALLER_COUNT;
    installerSlot += 1
  ) {
    for (
      let technicianSlot = 1;
      technicianSlot <= CREDITEX_VEU_PILOT_TECHNICIANS_PER_INSTALLER;
      technicianSlot += 1
    ) {
      const row = byKey.get(`${installerSlot}:${technicianSlot}`);
      if (!row) return { installerSlot, technicianSlot };
      if (Number(row.job_count) !== CREDITEX_VEU_PILOT_JOBS_PER_TECHNICIAN) {
        throw new CreditexVeuPilotError(
          "CREDITEX_PILOT_RECONCILIATION_REQUIRED",
          409,
          "A synthetic technician cohort is incomplete. No row was replaced.",
        );
      }
    }
  }
  return null;
}

export async function provisionNextCreditexVeuPilotCohort(
  database: D1Database,
  member: ComplianceIdentity,
) {
  assertAdministrator(member);
  const run = await currentPilotRun(database, member.organisationId);
  if (!run) {
    throw new CreditexVeuPilotError(
      "CREDITEX_PILOT_NOT_FOUND",
      404,
      "Create the synthetic VEU pilot contract before provisioning records.",
    );
  }
  await assertRunContract(run);
  if (run.status !== "provisioning") {
    return { runId: run.id, complete: true };
  }
  const cohort = nextPilotCohort(await provisionedCohorts(database, run.id));
  if (!cohort) return { runId: run.id, complete: true };

  const now = new Date().toISOString();
  const runToken = (await sha256Hex(run.id)).slice(0, 8).toUpperCase();
  const installerCode = `I${padded(cohort.installerSlot)}`;
  const technicianCode = `${installerCode}-T${padded(cohort.technicianSlot)}`;
  const installerId = `${run.id}:installer:${padded(cohort.installerSlot)}`;
  const installerUid =
    `${run.id}:installer-account:${padded(cohort.installerSlot)}`;
  const teamMemberId =
    `${run.id}:technician:${padded(cohort.installerSlot)}:${padded(
      cohort.technicianSlot,
    )}`;
  const technicianId = teamMemberId;
  const businessName =
    `[TEST] VEU Installer Company ${padded(cohort.installerSlot)}`;
  const technicianName =
    `[TEST] Field Technician ${padded(cohort.installerSlot)}.${padded(
      cohort.technicianSlot,
    )}`;
  const statements: D1PreparedStatement[] = [];
  if (cohort.technicianSlot === 1) {
    statements.push(
      database.prepare(`INSERT INTO trade_accounts (
        firebase_uid, email, business_name, abn, address_line_1, suburb,
        address_state, postcode, contact_name, phone, partner_type,
        business_website, service_states, capabilities, summary,
        account_status, verification_status, verified_abn,
        verification_review_id, verification_reviewed_at,
        verification_reviewed_by_uid, availability_status,
        service_base_postcode, service_radius_km, email_opportunities,
        email_weekly_summary, is_synthetic, settings_updated_at,
        consent_version, consent_at, created_at, updated_at
      ) VALUES (
        ?, ?, ?, '', 'SYNTHETIC TEST ACCOUNT', 'TEST ONLY', 'VIC', '3000',
        'Synthetic test record', '', 'installer', '', '["VIC"]',
        '["VEU synthetic workflow testing"]',
        'TEST DATA ONLY. Not a verified installer or regulator participant.',
        'active', 'under_review', '', '', '', '', 'paused', '3000', 1,
        0, 0, 1, ?, 'TEST_ONLY_NOT_A_LEGAL_CONSENT', ?, ?, ?
      )`).bind(
        installerUid,
        `pilot-${runToken.toLowerCase()}-installer-${
          padded(cohort.installerSlot)
        }@example.invalid`,
        businessName,
        now,
        now,
        now,
        now,
      ),
      database.prepare(`INSERT INTO compliance_pilot_installers (
        id, pilot_run_id, installer_slot, trade_account_uid, company_code,
        business_name, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'test_active', ?, ?)`).bind(
        installerId,
        run.id,
        cohort.installerSlot,
        installerUid,
        installerCode,
        businessName,
        now,
        now,
      ),
    );
  }
  statements.push(
    database.prepare(`INSERT INTO trade_team_members (
        id, owner_uid, member_uid, email, display_name, role, status,
        invited_at, accepted_at, last_active_at, created_at, updated_at
      ) VALUES (?, ?, '', '', ?, 'technician', 'active', ?, ?, '', ?, ?)`)
      .bind(
        teamMemberId,
        installerUid,
        technicianName,
        now,
        now,
        now,
        now,
      ),
    database.prepare(`INSERT INTO compliance_pilot_technicians (
        id, pilot_run_id, installer_id, technician_slot, team_member_id,
        technician_code, display_name, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'test_active', ?, ?)`).bind(
      technicianId,
      run.id,
      installerId,
      cohort.technicianSlot,
      teamMemberId,
      technicianCode,
      technicianName,
      now,
      now,
    ),
  );

  const customerRows: unknown[][] = [];
  const serviceSiteRows: unknown[][] = [];
  const workOrderRows: unknown[][] = [];
  const jobDetailRows: unknown[][] = [];
  const appointmentRows: unknown[][] = [];
  const workEventRows: unknown[][] = [];
  const pilotJobRows: unknown[][] = [];

  for (
    let jobSlot = 1;
    jobSlot <= CREDITEX_VEU_PILOT_JOBS_PER_TECHNICIAN;
    jobSlot += 1
  ) {
    const globalJobIndex =
      (cohort.installerSlot - 1)
      * CREDITEX_VEU_PILOT_TECHNICIANS_PER_INSTALLER
      * CREDITEX_VEU_PILOT_JOBS_PER_TECHNICIAN
      + (cohort.technicianSlot - 1)
      * CREDITEX_VEU_PILOT_JOBS_PER_TECHNICIAN
      + (jobSlot - 1);
    const activity =
      CREDITEX_VEU_PILOT_ACTIVITIES[
        globalJobIndex % CREDITEX_VEU_PILOT_ACTIVITIES.length
      ];
    const jobCode =
      `${installerCode}-T${padded(cohort.technicianSlot)}-J${padded(jobSlot)}`;
    const workOrderId = `${run.id}:work:${jobCode}`;
    const customerId = `${run.id}:customer:${jobCode}`;
    const siteId = `${run.id}:site:${jobCode}`;
    const jobDetailId = `${run.id}:job-detail:${jobCode}`;
    const appointmentId = `${run.id}:appointment:${jobCode}`;
    const pilotJobId = `${run.id}:pilot-job:${jobCode}`;
    const date = activityDate(globalJobIndex);
    const jobNumber = `TEST-VEU-${runToken}-${jobCode}`;
    const caseNumber = `PILOT-VEU-${runToken}-${jobCode}`;
    const title = `[TEST] ${activity.registryActivityCode} ${activity.title}`;
    customerRows.push([
      customerId,
      installerUid,
      `TEST-CUSTOMER-${jobCode}`,
      "residential",
      "[TEST]",
      `Customer ${jobCode}`,
      "",
      "",
      "",
      "",
      "SYNTHETIC TEST SITE - NOT A REAL ADDRESS",
      "",
      "TEST ONLY",
      "VIC",
      "3000",
      metadata(["synthetic_test", "VEU", run.id]),
      "Synthetic pilot record. No real person or site.",
      "active",
      now,
      now,
    ]);
    serviceSiteRows.push([
      siteId,
      installerUid,
      customerId,
      "Synthetic test site",
      "SYNTHETIC TEST SITE - NOT A REAL ADDRESS",
      "",
      "TEST ONLY",
      "VIC",
      "3000",
      "TEST DATA ONLY",
      "",
      "",
      1,
      "active",
      now,
      now,
    ]);
    workOrderRows.push([
      workOrderId,
      installerUid,
      "installer",
      "job",
      "synthetic_pilot",
      run.id,
      jobNumber,
      title,
      activity.serviceCategory,
      metadata([activity.serviceCategory]),
      "SYNTHETIC TEST SITE",
      "scheduled",
      "standard",
      scheduledAt(date, 9),
      scheduledAt(date, 11),
      teamMemberId,
      technicianName,
      1,
      "active",
      now,
      now,
    ]);
    jobDetailRows.push([
      jobDetailId,
      workOrderId,
      installerUid,
      customerId,
      siteId,
      "synthetic_pilot",
      "approved",
      "not_sure",
      `Synthetic ${activity.registryActivityCode} workflow test`,
      caseNumber,
      "Collect synthetic evidence and complete Creditex test review.",
      metadata([
        "synthetic_test",
        "VEU",
        activity.registryActivityCode,
        activity.catalogueState,
        run.id,
      ]),
      0,
      0,
      0,
      0,
      "accepted",
      "not_started",
      "",
      now,
      now,
    ]);
    appointmentRows.push([
      appointmentId,
      workOrderId,
      installerUid,
      "installation",
      title,
      scheduledAt(date, 9),
      scheduledAt(date, 11),
      teamMemberId,
      technicianName,
      "scheduled",
      "",
      "",
      "",
      "",
      "",
      "SYNTHETIC TEST APPOINTMENT",
      1,
      now,
      now,
    ]);
    workEventRows.push([
      `${run.id}:work-event:${jobCode}`,
      workOrderId,
      installerUid,
      "synthetic_pilot_job_created",
      "Created an isolated synthetic VEU workflow job.",
      now,
    ]);
    pilotJobRows.push([
      pilotJobId,
      run.id,
      installerId,
      technicianId,
      workOrderId,
      caseNumber,
      jobNumber,
      activity.templateId,
      activity.activityKey,
      activity.registryActivityCode,
      activity.specificationPart,
      activity.title,
      activity.serviceCategory,
      activity.productCategory,
      activity.scenarioCode,
      activity.scenario,
      activity.catalogueState,
      date,
      "synthetic_test",
      "blocked_pending_independent_review",
      "not_checked",
      "not_started",
      "blocked_unverified_formula",
      "not_staged",
      "test_ready",
      now,
      now,
    ]);
  }
  statements.push(
    ...insertRows(database, "trade_crm_customers", [
      "id", "firebase_uid", "customer_number", "customer_type", "first_name",
      "last_name", "business_name", "business_number", "email", "phone",
      "address_line_1", "address_line_2", "suburb", "address_state",
      "postcode", "tags", "private_notes", "record_status", "created_at",
      "updated_at",
    ], customerRows),
    ...insertRows(database, "trade_crm_service_sites", [
      "id", "firebase_uid", "customer_id", "site_label", "address_line_1",
      "address_line_2", "suburb", "address_state", "postcode",
      "access_instructions", "parking_instructions", "hazard_notes",
      "is_primary", "record_status", "created_at", "updated_at",
    ], serviceSiteRows),
    ...insertRows(database, "trade_work_orders", [
      "id", "firebase_uid", "partner_type", "work_type", "source_type",
      "source_reference", "work_number", "title", "service_category",
      "service_categories", "site_area", "stage", "priority",
      "scheduled_start", "scheduled_end", "assignee_member_id",
      "assignee_label", "revision", "record_status", "created_at",
      "updated_at",
    ], workOrderRows),
    ...insertRows(database, "trade_crm_job_details", [
      "id", "work_order_id", "firebase_uid", "crm_customer_id",
      "service_site_id", "customer_source", "pipeline_stage", "building_type",
      "description", "customer_reference", "next_action", "tags",
      "estimated_value_cents", "quoted_value_cents", "invoiced_value_cents",
      "paid_value_cents", "quote_status", "invoice_status", "payment_due_at",
      "created_at", "updated_at",
    ], jobDetailRows),
    ...insertRows(database, "trade_crm_appointments", [
      "id", "work_order_id", "firebase_uid", "appointment_type", "title",
      "starts_at", "ends_at", "assignee_member_id", "assignee_label",
      "status", "travel_started_at", "arrived_at", "work_started_at",
      "completed_at", "last_transition_by_uid", "notes", "revision",
      "created_at", "updated_at",
    ], appointmentRows),
    ...insertRows(database, "trade_work_order_events", [
      "id", "work_order_id", "firebase_uid", "event_type", "summary",
      "created_at",
    ], workEventRows),
    ...insertRows(database, "compliance_pilot_jobs", [
      "id", "pilot_run_id", "installer_id", "technician_id", "work_order_id",
      "case_number", "job_number", "activity_template_id", "activity_key",
      "registry_activity_code", "specification_part", "title",
      "service_category", "product_category", "scenario_code", "scenario",
      "catalogue_state", "activity_date", "record_mode", "rule_status",
      "lookup_status", "evidence_status", "calculator_status",
      "connector_status", "review_status", "created_at", "updated_at",
    ], pilotJobRows),
  );
  statements.push(database.prepare(`INSERT INTO
      compliance_pilot_events (
        id, pilot_run_id, organisation_id, event_type, actor_uid,
        summary, metadata, created_at
      ) VALUES (?, ?, ?, 'pilot.cohort_provisioned', ?,
        'Provisioned one synthetic installer technician cohort and ten jobs.',
        ?, ?)`).bind(
    `${run.id}:event:cohort:${installerCode}:${cohort.technicianSlot}`,
    run.id,
    member.organisationId,
    member.uid,
    metadata({
      installerSlot: cohort.installerSlot,
      technicianSlot: cohort.technicianSlot,
      jobs: CREDITEX_VEU_PILOT_JOBS_PER_TECHNICIAN,
    }),
    now,
  ));
  await database.batch(statements);

  const cohortCheck = await database.prepare(`SELECT
      COUNT(DISTINCT installer.id) AS installers,
      COUNT(DISTINCT technician.id) AS technicians,
      COUNT(DISTINCT job.id) AS jobs
    FROM compliance_pilot_installers installer
    JOIN compliance_pilot_technicians technician
      ON technician.installer_id = installer.id
      AND technician.pilot_run_id = installer.pilot_run_id
    LEFT JOIN compliance_pilot_jobs job
      ON job.technician_id = technician.id
      AND job.pilot_run_id = technician.pilot_run_id
    WHERE installer.pilot_run_id = ?
      AND installer.installer_slot = ?
      AND technician.technician_slot = ?`)
    .bind(run.id, cohort.installerSlot, cohort.technicianSlot)
    .first<{ installers: number; technicians: number; jobs: number }>();
  if (
    Number(cohortCheck?.installers) !== 1
    || Number(cohortCheck?.technicians) !== 1
    || Number(cohortCheck?.jobs)
      !== CREDITEX_VEU_PILOT_JOBS_PER_TECHNICIAN
  ) {
    throw new CreditexVeuPilotError(
      "CREDITEX_PILOT_RECONCILIATION_REQUIRED",
      409,
      "The synthetic cohort did not reconcile to one installer, one technician and ten jobs.",
    );
  }
  return {
    runId: run.id,
    complete: false,
    provisioned: {
      installerSlot: cohort.installerSlot,
      technicianSlot: cohort.technicianSlot,
      jobs: CREDITEX_VEU_PILOT_JOBS_PER_TECHNICIAN,
    },
  };
}

async function pilotCounts(database: D1Database, runId: string) {
  const counts = await database.prepare(`SELECT
      (SELECT COUNT(*) FROM compliance_pilot_installers
        WHERE pilot_run_id = ?) AS installers,
      (SELECT COUNT(*) FROM compliance_pilot_technicians
        WHERE pilot_run_id = ?) AS technicians,
      (SELECT COUNT(*) FROM compliance_pilot_jobs
        WHERE pilot_run_id = ?) AS jobs,
      (SELECT COUNT(DISTINCT activity_template_id)
        FROM compliance_pilot_jobs WHERE pilot_run_id = ?) AS activities,
      (SELECT COUNT(*) FROM compliance_pilot_source_instruments
        WHERE pilot_run_id = ?) AS sources,
      (SELECT COUNT(*) FROM compliance_pilot_source_instruments
        WHERE pilot_run_id = ? AND official_source_sha256 <> '') AS hashed_sources,
      (SELECT COUNT(*) FROM compliance_pilot_control_options
        WHERE pilot_run_id = ?) AS control_options,
      (SELECT COUNT(*) FROM compliance_pilot_calculator_contracts
        WHERE pilot_run_id = ?) AS calculator_contracts,
      (SELECT COUNT(*) FROM compliance_pilot_evidence_contracts
        WHERE pilot_run_id = ?) AS evidence_contracts,
      (SELECT COUNT(*) FROM compliance_cases
        WHERE work_order_id IN (
          SELECT work_order_id FROM compliance_pilot_jobs
          WHERE pilot_run_id = ?
        )) AS regulated_cases`)
    .bind(
      runId,
      runId,
      runId,
      runId,
      runId,
      runId,
      runId,
      runId,
      runId,
      runId,
    )
    .first<Record<string, number>>();
  return {
    installers: Number(counts?.installers || 0),
    technicians: Number(counts?.technicians || 0),
    jobs: Number(counts?.jobs || 0),
    activities: Number(counts?.activities || 0),
    sources: Number(counts?.sources || 0),
    hashedSources: Number(counts?.hashed_sources || 0),
    controlOptions: Number(counts?.control_options || 0),
    calculatorContracts: Number(counts?.calculator_contracts || 0),
    evidenceContracts: Number(counts?.evidence_contracts || 0),
    regulatedCases: Number(counts?.regulated_cases || 0),
  };
}

export async function finaliseCreditexVeuPilot(
  database: D1Database,
  member: ComplianceIdentity,
) {
  assertAdministrator(member);
  const run = await currentPilotRun(database, member.organisationId);
  if (!run) {
    throw new CreditexVeuPilotError(
      "CREDITEX_PILOT_NOT_FOUND",
      404,
      "The synthetic VEU pilot has not been created.",
    );
  }
  await assertRunContract(run);
  if (run.status === "archived") {
    throw new CreditexVeuPilotError(
      "CREDITEX_PILOT_ARCHIVED",
      409,
      "The archived synthetic VEU pilot cannot be finalised or reactivated.",
    );
  }
  const counts = await pilotCounts(database, run.id);
  const targets = pilotTargets();
  if (
    counts.installers !== targets.installers
    || counts.technicians !== targets.technicians
    || counts.jobs !== targets.jobs
    || counts.activities !== targets.activityFamilies
    || counts.sources !== CREDITEX_VEU_PILOT_SOURCES.length
    || counts.hashedSources !== CREDITEX_VEU_PILOT_SOURCES.filter(
      (source) => Boolean(source.officialSourceSha256),
    ).length
    || counts.controlOptions !== CREDITEX_VEU_PILOT_CONTROL_OPTIONS.length
    || counts.calculatorContracts !== targets.activityFamilies
    || counts.evidenceContracts
      !== CREDITEX_VEU_PILOT_EVIDENCE_CONTRACTS.length
    || counts.regulatedCases !== 0
  ) {
    throw new CreditexVeuPilotError(
      "CREDITEX_PILOT_RECONCILIATION_REQUIRED",
      409,
      "The pilot cannot activate until the source, control, evidence, calculator, 10-installer, 30-technician, 300-job, all-activity and zero-regulated-case contracts reconcile.",
    );
  }
  if (run.status === "active") {
    const existingArtifact = await database.prepare(`SELECT artifact_sha256,
        item_count, status, external_submission_enabled
      FROM compliance_pilot_connector_runs
      WHERE pilot_run_id = ?
        AND connector_code = 'VEU_REGISTRY_SYNTHETIC'
        AND mapping_version = 'v1'
      LIMIT 1`)
      .bind(run.id)
      .first<{
        artifact_sha256: string;
        item_count: number;
        status: string;
        external_submission_enabled: number;
      }>();
    if (
      !existingArtifact
      || Number(existingArtifact.item_count) !== CREDITEX_VEU_PILOT_JOB_COUNT
      || existingArtifact.status !== "validated"
      || Number(existingArtifact.external_submission_enabled) !== 0
    ) {
      throw new CreditexVeuPilotError(
        "CREDITEX_PILOT_RECONCILIATION_REQUIRED",
        409,
        "The active pilot does not have its immutable validated activation manifest.",
      );
    }
    return {
      runId: run.id,
      counts,
      artifactSha256: existingArtifact.artifact_sha256,
      alreadyFinalised: true,
      regulatorAcceptedCount: 0,
      externalSubmissionEnabled: false,
    };
  }
  const jobs = await database.prepare(`SELECT
      job_number, case_number, activity_template_id, registry_activity_code,
      specification_part, activity_date
    FROM compliance_pilot_jobs
    WHERE pilot_run_id = ?
    ORDER BY job_number`)
    .bind(run.id)
    .all<Record<string, unknown>>();
  const manifest = {
    schemaVersion: "creditex-veu-synthetic-dry-run-v2",
    pilotRunId: run.id,
    programCode: "VEU",
    recordMode: "synthetic_test",
    sourceManifestSha256: run.source_manifest_sha256,
    activityCatalogueSha256: run.activity_catalogue_sha256,
    externalSubmissionEnabled: false,
    validation: {
      kind: "deterministic_immutable_population_check",
      expectedItems: CREDITEX_VEU_PILOT_JOB_COUNT,
      regulatorResponseReceived: false,
    },
    legacyCutover: {
      dataforce: "blocked_pending_authorised_export_and_field_dictionary",
      runabout: "blocked_pending_authorised_export_and_capture_contract",
    },
    items: jobs.results.map((job) => ({
      jobNumber: job.job_number,
      caseNumber: job.case_number,
      activityTemplateId: job.activity_template_id,
      registryActivityCode: job.registry_activity_code,
      specificationPart: job.specification_part,
      activityDate: job.activity_date,
    })),
  };
  const artifactManifest = canonicalJson(manifest);
  const artifactSha256 = await sha256Hex(artifactManifest);
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(`INSERT INTO compliance_pilot_connector_runs (
        id, pilot_run_id, connector_code, mapping_version, mode, status,
        item_count, accepted_count, rejected_count, unmatched_count,
        duplicate_count, artifact_sha256, artifact_manifest,
        external_submission_enabled, created_by_uid, created_at, updated_at
      ) VALUES (
        ?, ?, 'VEU_REGISTRY_SYNTHETIC', 'v1', 'dry_run', 'validated',
        ?, 0, 0, 0, 0, ?, ?, 0, ?, ?, ?
      )`).bind(
      `${run.id}:connector:veu-registry-synthetic:v1`,
      run.id,
      CREDITEX_VEU_PILOT_JOB_COUNT,
      artifactSha256,
      artifactManifest,
      member.uid,
      now,
      now,
    ),
    database.prepare(`UPDATE compliance_pilot_jobs
      SET connector_status = 'dry_run_staged', updated_at = ?
      WHERE pilot_run_id = ? AND connector_status = 'not_staged'`)
      .bind(now, run.id),
    database.prepare(`UPDATE compliance_pilot_runs
      SET status = 'active',
        activated_at = CASE WHEN activated_at = '' THEN ? ELSE activated_at END,
        updated_at = ?
      WHERE id = ? AND status IN ('provisioning', 'active')`)
      .bind(now, now, run.id),
    database.prepare(`INSERT INTO compliance_pilot_events (
        id, pilot_run_id, organisation_id, event_type, actor_uid,
        summary, metadata, created_at
      ) VALUES (?, ?, ?, 'pilot.activated', ?,
        'Activated the isolated VEU pilot after deterministic count and dry-run artifact validation.',
        ?, ?)`).bind(
      `${run.id}:event:activated`,
      run.id,
      member.organisationId,
      member.uid,
      metadata({
        counts,
        artifactSha256,
        externalSubmissionEnabled: false,
        regulatorResponseReceived: false,
      }),
      now,
    ),
  ]);
  return {
    runId: run.id,
    counts,
    artifactSha256,
    alreadyFinalised: false,
    regulatorAcceptedCount: 0,
    externalSubmissionEnabled: false,
  };
}

export async function updateCreditexVeuPilotJob(
  database: D1Database,
  member: ComplianceIdentity,
  body: Record<string, unknown>,
) {
  if (!["admin", "case_manager", "reviewer"].includes(member.role)) {
    throw new CreditexVeuPilotError(
      "CREDITEX_PILOT_REVIEW_ROLE_REQUIRED",
      403,
      "This compliance role is read-only for synthetic pilot review.",
    );
  }
  const run = await currentPilotRun(database, member.organisationId);
  if (!run || run.status === "archived") {
    throw new CreditexVeuPilotError(
      "CREDITEX_PILOT_NOT_ACTIVE",
      409,
      "The synthetic VEU pilot is not active.",
    );
  }
  await assertRunContract(run);
  const jobId = textValue(body.jobId, 200);
  const expectedUpdatedAt = textValue(body.expectedUpdatedAt, 80);
  const reviewStatus = textValue(body.reviewStatus, 40);
  const evidenceStatus = textValue(body.evidenceStatus, 40);
  const lookupStatus = textValue(body.lookupStatus, 40);
  if (
    !jobId
    || !expectedUpdatedAt
    || !REVIEW_STATUSES.has(reviewStatus)
    || !EVIDENCE_STATUSES.has(evidenceStatus)
    || !LOOKUP_STATUSES.has(lookupStatus)
  ) {
    throw new CreditexVeuPilotError(
      "CREDITEX_PILOT_JOB_INVALID",
      400,
      "Choose controlled pilot review, evidence and lookup statuses.",
    );
  }
  const current = await database.prepare(`SELECT id, review_status,
      evidence_status, lookup_status, updated_at
    FROM compliance_pilot_jobs
    WHERE id = ? AND pilot_run_id = ?`)
    .bind(jobId, run.id)
    .first<{
      id: string;
      review_status: string;
      evidence_status: string;
      lookup_status: string;
      updated_at: string;
    }>();
  if (!current) {
    throw new CreditexVeuPilotError(
      "CREDITEX_PILOT_JOB_NOT_FOUND",
      404,
      "The synthetic pilot job was not found.",
    );
  }
  if (
    lookupStatus === "verified"
    || reviewStatus === "test_complete"
    || reviewStatus === "archived"
  ) {
    throw new CreditexVeuPilotError(
      "CREDITEX_PILOT_VERIFICATION_BLOCKED",
      409,
      "Authoritative lookup verification, completed compliance review and archive state cannot be asserted through an individual synthetic job update.",
    );
  }
  if (current.updated_at !== expectedUpdatedAt) {
    throw new CreditexVeuPilotError(
      "CREDITEX_PILOT_JOB_CHANGED",
      409,
      "This synthetic job changed after it was opened. Refresh before saving.",
    );
  }
  if (
    current.review_status === reviewStatus
    && current.evidence_status === evidenceStatus
    && current.lookup_status === lookupStatus
  ) {
    return {
      jobId,
      reviewStatus,
      evidenceStatus,
      lookupStatus,
      unchanged: true,
    };
  }
  const now = new Date().toISOString();
  const [updateResult] = await database.batch([
    database.prepare(`UPDATE compliance_pilot_jobs
      SET review_status = ?, evidence_status = ?, lookup_status = ?,
        updated_at = ?
      WHERE id = ? AND pilot_run_id = ? AND updated_at = ?
        AND EXISTS (
          SELECT 1 FROM compliance_pilot_runs pilot_run
          WHERE pilot_run.id = compliance_pilot_jobs.pilot_run_id
            AND pilot_run.status <> 'archived'
        )`)
      .bind(
        reviewStatus,
        evidenceStatus,
        lookupStatus,
        now,
        jobId,
        run.id,
        expectedUpdatedAt,
      ),
    database.prepare(`INSERT INTO compliance_pilot_events (
        id, pilot_run_id, organisation_id, event_type, actor_uid,
        summary, metadata, created_at
      ) SELECT ?, ?, ?, 'pilot.job_status_changed', ?,
        'Updated controlled synthetic pilot job workflow states.', ?, ?
      WHERE EXISTS (
        SELECT 1 FROM compliance_pilot_jobs
        WHERE id = ? AND pilot_run_id = ? AND updated_at = ?
      )`)
      .bind(
        crypto.randomUUID(),
        run.id,
        member.organisationId,
        member.uid,
        metadata({
          jobId,
          before: {
            reviewStatus: current.review_status,
            evidenceStatus: current.evidence_status,
            lookupStatus: current.lookup_status,
          },
          after: { reviewStatus, evidenceStatus, lookupStatus },
        }),
        now,
        jobId,
        run.id,
        now,
      ),
  ]);
  if (Number(updateResult.meta?.changes || 0) !== 1) {
    throw new CreditexVeuPilotError(
      "CREDITEX_PILOT_JOB_CHANGED",
      409,
      "This synthetic job changed or was archived before saving. Refresh before retrying.",
    );
  }
  return { jobId, reviewStatus, evidenceStatus, lookupStatus };
}

export async function archiveCreditexVeuPilot(
  database: D1Database,
  member: ComplianceIdentity,
  confirmation: unknown,
) {
  assertAdministrator(member);
  assertRecentAuthentication(member);
  if (
    textValue(confirmation, 80)
      !== "ARCHIVE SYNTHETIC VEU PILOT"
  ) {
    throw new CreditexVeuPilotError(
      "CREDITEX_PILOT_ARCHIVE_CONFIRMATION_REQUIRED",
      400,
      "Type ARCHIVE SYNTHETIC VEU PILOT exactly to deactivate the test dataset.",
    );
  }
  const run = await unarchivedPilotRunAnySeed(
    database,
    member.organisationId,
  ) || await latestPilotRunAnySeed(database, member.organisationId);
  if (!run) {
    throw new CreditexVeuPilotError(
      "CREDITEX_PILOT_NOT_FOUND",
      404,
      "The synthetic VEU pilot was not found.",
    );
  }
  if (run.status === "archived") return { runId: run.id, archived: true };
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(`UPDATE trade_accounts
      SET account_status = 'closed', availability_status = 'paused',
        updated_at = ?
      WHERE firebase_uid IN (
        SELECT trade_account_uid FROM compliance_pilot_installers
        WHERE pilot_run_id = ?
      ) AND is_synthetic = 1`).bind(now, run.id),
    database.prepare(`UPDATE trade_team_members
      SET status = 'suspended', updated_at = ?
      WHERE id IN (
        SELECT team_member_id FROM compliance_pilot_technicians
        WHERE pilot_run_id = ?
      )`).bind(now, run.id),
    database.prepare(`UPDATE trade_crm_customers
      SET record_status = 'archived', updated_at = ?
      WHERE id IN (
        SELECT job_detail.crm_customer_id
        FROM trade_crm_job_details job_detail
        JOIN compliance_pilot_jobs pilot_job
          ON pilot_job.work_order_id = job_detail.work_order_id
        WHERE pilot_job.pilot_run_id = ?
      )`).bind(now, run.id),
    database.prepare(`UPDATE trade_crm_service_sites
      SET record_status = 'archived', updated_at = ?
      WHERE id IN (
        SELECT job_detail.service_site_id
        FROM trade_crm_job_details job_detail
        JOIN compliance_pilot_jobs pilot_job
          ON pilot_job.work_order_id = job_detail.work_order_id
        WHERE pilot_job.pilot_run_id = ?
      )`).bind(now, run.id),
    database.prepare(`UPDATE trade_work_orders
      SET stage = 'cancelled', record_status = 'archived', updated_at = ?
      WHERE source_type = 'synthetic_pilot' AND source_reference = ?`)
      .bind(now, run.id),
    database.prepare(`UPDATE trade_crm_appointments
      SET status = 'cancelled', updated_at = ?
      WHERE work_order_id IN (
        SELECT work_order_id FROM compliance_pilot_jobs
        WHERE pilot_run_id = ?
      )`).bind(now, run.id),
    database.prepare(`UPDATE compliance_pilot_jobs
      SET review_status = 'archived', updated_at = ?
      WHERE pilot_run_id = ?`).bind(now, run.id),
    database.prepare(`UPDATE compliance_pilot_installers
      SET status = 'archived', updated_at = ?
      WHERE pilot_run_id = ?`).bind(now, run.id),
    database.prepare(`UPDATE compliance_pilot_technicians
      SET status = 'archived', updated_at = ?
      WHERE pilot_run_id = ?`).bind(now, run.id),
    database.prepare(`UPDATE compliance_pilot_runs
      SET status = 'archived', archived_at = ?, updated_at = ?
      WHERE id = ? AND status <> 'archived'`).bind(now, now, run.id),
    database.prepare(`INSERT INTO compliance_pilot_events (
        id, pilot_run_id, organisation_id, event_type, actor_uid,
        summary, metadata, created_at
      ) VALUES (?, ?, ?, 'pilot.archived', ?,
        'Archived the synthetic VEU pilot without deleting its audit history.',
        '{"hardDelete":false}', ?)`).bind(
      `${run.id}:event:archived`,
      run.id,
      member.organisationId,
      member.uid,
      now,
    ),
  ]);
  return { runId: run.id, archived: true };
}

function projectionRun(run: PilotRunRow) {
  return {
    id: run.id,
    programCode: run.program_code,
    name: run.name,
    seedVersion: run.seed_version,
    recordMode: run.record_mode,
    status: run.status,
    activityCatalogueSha256: run.activity_catalogue_sha256,
    sourceManifestSha256: run.source_manifest_sha256,
    ruleImportStatus: run.rule_import_status,
    lookupStatus: run.lookup_status,
    evidenceStatus: run.evidence_status,
    calculatorStatus: run.calculator_status,
    connectorStatus: run.connector_status,
    createdAt: run.created_at,
    activatedAt: run.activated_at,
    archivedAt: run.archived_at,
    updatedAt: run.updated_at,
  };
}

export async function loadCreditexVeuPilotDashboard(
  database: D1Database,
  member: ComplianceIdentity,
  filters: CreditexPilotFilters,
) {
  const run = await currentPilotRun(database, member.organisationId);
  if (!run) {
    const previousRun = await latestPilotRunAnySeed(
      database,
      member.organisationId,
    );
    return {
      configured: false,
      confirmationPhrase: CREDITEX_VEU_PILOT_CONFIRMATION,
      archiveConfirmationPhrase: "ARCHIVE SYNTHETIC VEU PILOT",
      previousRun: previousRun ? projectionRun(previousRun) : null,
      targets: pilotTargets(),
      activities: CREDITEX_VEU_PILOT_ACTIVITIES,
      priorities: pilotPriorities(null),
      filters: {
        reviewStatuses: Array.from(REVIEW_STATUSES),
        evidenceStatuses: Array.from(EVIDENCE_STATUSES),
        lookupStatuses: Array.from(LOOKUP_STATUSES),
        ruleStatuses: Array.from(RULE_STATUSES),
        calculatorStatuses: Array.from(CALCULATOR_STATUSES),
        connectorStatuses: Array.from(CONNECTOR_STATUSES),
        workStages: Array.from(WORK_STAGES),
        workTypes: ["job"],
        priorities: Array.from(WORK_PRIORITIES),
        appointmentTypes: Array.from(APPOINTMENT_TYPES),
        appointmentStatuses: Array.from(APPOINTMENT_STATUSES),
        customerTypes: Array.from(CUSTOMER_TYPES),
        serviceCategories: Array.from(SERVICE_CATEGORIES),
        productCategories: Array.from(PRODUCT_CATEGORIES),
        postcodes: ["3000"],
        tags: ["synthetic_test", "VEU"],
        dateFields: Object.keys(PILOT_DATE_FIELDS),
        sortColumns: Object.keys(PILOT_SORT_COLUMNS),
        pageSizes: Array.from(PILOT_PAGE_SIZES),
      },
    };
  }
  await assertRunContract(run);
  const bindings: unknown[] = [run.id];
  const conditions = ["job.pilot_run_id = ?"];
  if (filters.installerId) {
    conditions.push("job.installer_id = ?");
    bindings.push(filters.installerId);
  }
  if (filters.technicianId) {
    conditions.push("job.technician_id = ?");
    bindings.push(filters.technicianId);
  }
  if (filters.activityTemplateId) {
    conditions.push("job.activity_template_id = ?");
    bindings.push(filters.activityTemplateId);
  }
  if (filters.reviewStatus) {
    conditions.push("job.review_status = ?");
    bindings.push(filters.reviewStatus);
  }
  if (filters.evidenceStatus) {
    conditions.push("job.evidence_status = ?");
    bindings.push(filters.evidenceStatus);
  }
  if (filters.lookupStatus) {
    conditions.push("job.lookup_status = ?");
    bindings.push(filters.lookupStatus);
  }
  if (filters.ruleStatus) {
    conditions.push("job.rule_status = ?");
    bindings.push(filters.ruleStatus);
  }
  if (filters.calculatorStatus) {
    conditions.push("job.calculator_status = ?");
    bindings.push(filters.calculatorStatus);
  }
  if (filters.connectorStatus) {
    conditions.push("job.connector_status = ?");
    bindings.push(filters.connectorStatus);
  }
  if (filters.workStage) {
    conditions.push("work.stage = ?");
    bindings.push(filters.workStage);
  }
  if (filters.workType) {
    conditions.push("work.work_type = ?");
    bindings.push(filters.workType);
  }
  if (filters.priority) {
    conditions.push("work.priority = ?");
    bindings.push(filters.priority);
  }
  if (filters.appointmentType) {
    conditions.push("appointment.appointment_type = ?");
    bindings.push(filters.appointmentType);
  }
  if (filters.appointmentStatus) {
    conditions.push("appointment.status = ?");
    bindings.push(filters.appointmentStatus);
  }
  if (filters.customerType) {
    conditions.push("customer.customer_type = ?");
    bindings.push(filters.customerType);
  }
  if (filters.serviceCategory) {
    conditions.push("job.service_category = ?");
    bindings.push(filters.serviceCategory);
  }
  if (filters.productCategory) {
    conditions.push("job.product_category = ?");
    bindings.push(filters.productCategory);
  }
  if (filters.postcode) {
    conditions.push("site.postcode = ?");
    bindings.push(filters.postcode);
  }
  if (filters.tag) {
    conditions.push("detail.tags LIKE ? ESCAPE '\\'");
    const escapedTag = filters.tag
      .replaceAll("\\", "\\\\")
      .replaceAll("%", "\\%")
      .replaceAll("_", "\\_");
    bindings.push(`%${escapedTag}%`);
  }
  const dateExpression = PILOT_DATE_FIELDS[filters.dateField];
  if (filters.dateFrom) {
    conditions.push(`substr(${dateExpression}, 1, 10) >= ?`);
    bindings.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conditions.push(`substr(${dateExpression}, 1, 10) <= ?`);
    bindings.push(filters.dateTo);
  }
  if (filters.query) {
    conditions.push(`(
      job.job_number LIKE ? ESCAPE '\\'
      OR job.case_number LIKE ? ESCAPE '\\'
      OR job.registry_activity_code LIKE ? ESCAPE '\\'
      OR job.title LIKE ? ESCAPE '\\'
      OR installer.business_name LIKE ? ESCAPE '\\'
      OR technician.display_name LIKE ? ESCAPE '\\'
      OR customer.customer_number LIKE ? ESCAPE '\\'
      OR customer.first_name LIKE ? ESCAPE '\\'
      OR customer.last_name LIKE ? ESCAPE '\\'
      OR detail.customer_reference LIKE ? ESCAPE '\\'
      OR site.address_line_1 LIKE ? ESCAPE '\\'
      OR site.postcode LIKE ? ESCAPE '\\'
    )`);
    const escaped = filters.query
      .replaceAll("\\", "\\\\")
      .replaceAll("%", "\\%")
      .replaceAll("_", "\\_");
    for (let index = 0; index < 12; index += 1) {
      bindings.push(`%${escaped}%`);
    }
  }
  const whereSql = conditions.join(" AND ");
  const pilotJobJoins = `FROM compliance_pilot_jobs job
      JOIN compliance_pilot_installers installer
        ON installer.id = job.installer_id
        AND installer.pilot_run_id = job.pilot_run_id
      JOIN compliance_pilot_technicians technician
        ON technician.id = job.technician_id
        AND technician.pilot_run_id = job.pilot_run_id
      JOIN trade_work_orders work
        ON work.id = job.work_order_id
        AND work.firebase_uid = installer.trade_account_uid
        AND work.source_type = 'synthetic_pilot'
        AND work.source_reference = job.pilot_run_id
      LEFT JOIN trade_crm_job_details detail
        ON detail.work_order_id = work.id
        AND detail.firebase_uid = work.firebase_uid
      LEFT JOIN trade_crm_customers customer
        ON customer.id = detail.crm_customer_id
        AND customer.firebase_uid = work.firebase_uid
        AND customer.record_status = 'active'
      LEFT JOIN trade_crm_service_sites site
        ON site.id = detail.service_site_id
        AND site.firebase_uid = work.firebase_uid
        AND site.record_status = 'active'
      LEFT JOIN trade_crm_appointments appointment
        ON appointment.id = (
          SELECT candidate.id
          FROM trade_crm_appointments candidate
          WHERE candidate.work_order_id = work.id
            AND candidate.firebase_uid = work.firebase_uid
          ORDER BY candidate.starts_at DESC, candidate.id DESC
          LIMIT 1
        )`;
  const sortExpression = PILOT_SORT_COLUMNS[filters.sortBy];
  const sortDirection = filters.sortDirection === "desc" ? "DESC" : "ASC";
  const countBindings = [...bindings];
  const listBindings = [
    ...bindings,
    filters.pageSize,
    filters.page * filters.pageSize,
  ];
  const [
    counts,
    sources,
    controls,
    evidenceContracts,
    calculatorSummary,
    connectors,
  ] = await Promise.all([
    pilotCounts(database, run.id),
    database.prepare(`SELECT source_key, source_kind, title,
        official_source_url, official_version, effective_from, effective_to,
        official_source_sha256, hash_status, verification_status,
        source_priority, captured_at
      FROM compliance_pilot_source_instruments
      WHERE pilot_run_id = ?
      ORDER BY source_priority, source_key`).bind(run.id).all(),
    database.prepare(`SELECT control_type, option_code, label, option_order,
        effective_from, effective_to, source_key, live_lookup_enabled
      FROM compliance_pilot_control_options
      WHERE pilot_run_id = ?
      ORDER BY control_type, option_order`).bind(run.id).all(),
    database.prepare(`SELECT requirement_code, title, evidence_kind,
        capture_timing, original_required, metadata_required, gps_required,
        minimum_count, maximum_count, allowed_content_types, contract_scope,
        government_requirement_status, source_key, option_order
      FROM compliance_pilot_evidence_contracts
      WHERE pilot_run_id = ?
      ORDER BY option_order`).bind(run.id).all(),
    database.prepare(`SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN formula_status = 'verified' THEN 1 ELSE 0 END)
          AS verified,
        SUM(CASE WHEN test_vector_status = 'reconciled' THEN 1 ELSE 0 END)
          AS reconciled_vectors
      FROM compliance_pilot_calculator_contracts
      WHERE pilot_run_id = ?`).bind(run.id).first(),
    database.prepare(`SELECT connector_code, mapping_version, mode, status,
        item_count, accepted_count, rejected_count, unmatched_count,
        duplicate_count, artifact_sha256, external_submission_enabled,
        created_at, updated_at
      FROM compliance_pilot_connector_runs
      WHERE pilot_run_id = ?
      ORDER BY created_at DESC`).bind(run.id).all(),
  ]);
  const [
    installers,
    technicians,
    activities,
    totalRow,
    jobs,
    events,
  ] = await Promise.all([
    database.prepare(`SELECT installer.id, installer.installer_slot,
        installer.company_code, installer.business_name, installer.status,
        COUNT(DISTINCT technician.id) AS technician_count,
        COUNT(DISTINCT job.id) AS job_count
      FROM compliance_pilot_installers installer
      LEFT JOIN compliance_pilot_technicians technician
        ON technician.installer_id = installer.id
        AND technician.pilot_run_id = installer.pilot_run_id
      LEFT JOIN compliance_pilot_jobs job
        ON job.installer_id = installer.id
        AND job.pilot_run_id = installer.pilot_run_id
      WHERE installer.pilot_run_id = ?
      GROUP BY installer.id, installer.installer_slot,
        installer.company_code, installer.business_name, installer.status
      ORDER BY installer.installer_slot`).bind(run.id).all(),
    database.prepare(`SELECT technician.id, technician.installer_id,
        technician.technician_slot, technician.technician_code,
        technician.display_name, technician.status, COUNT(job.id) AS job_count
      FROM compliance_pilot_technicians technician
      LEFT JOIN compliance_pilot_jobs job
        ON job.technician_id = technician.id
        AND job.pilot_run_id = technician.pilot_run_id
      WHERE technician.pilot_run_id = ?
      GROUP BY technician.id, technician.installer_id,
        technician.technician_slot, technician.technician_code,
        technician.display_name, technician.status
      ORDER BY technician.installer_id, technician.technician_slot`)
      .bind(run.id).all(),
    database.prepare(`SELECT activity_template_id, registry_activity_code,
        specification_part, title, service_category, catalogue_state,
        COUNT(*) AS job_count,
        SUM(CASE WHEN rule_status = 'verified' THEN 1 ELSE 0 END)
          AS verified_job_count
      FROM compliance_pilot_jobs
      WHERE pilot_run_id = ?
      GROUP BY activity_template_id, registry_activity_code,
        specification_part, title, service_category, catalogue_state
      ORDER BY
        CASE WHEN registry_activity_code GLOB '[0-9]*'
          THEN CAST(registry_activity_code AS INTEGER) ELSE 999 END,
        registry_activity_code`).bind(run.id).all(),
    database.prepare(`SELECT COUNT(*) AS total
      ${pilotJobJoins}
      WHERE ${whereSql}`).bind(...countBindings).first<{ total: number }>(),
    database.prepare(`SELECT job.id, job.work_order_id, job.case_number,
        job.job_number, job.activity_template_id, job.activity_key,
        job.registry_activity_code, job.specification_part, job.title,
        job.service_category, job.product_category, job.scenario_code,
        job.scenario, job.catalogue_state, job.activity_date, job.record_mode,
        job.rule_status, job.lookup_status, job.evidence_status,
        job.calculator_status, job.connector_status, job.review_status,
        job.created_at, job.updated_at,
        installer.id AS installer_id, installer.company_code,
        installer.business_name, technician.id AS technician_id,
        technician.technician_code, technician.display_name,
        work.work_type, work.source_type, work.source_reference,
        work.stage AS work_stage, work.priority,
        work.scheduled_start, work.scheduled_end,
        work.assignee_label,
        detail.customer_source, detail.pipeline_stage, detail.building_type,
        detail.customer_reference, detail.tags,
        detail.estimated_value_cents, detail.quoted_value_cents,
        detail.invoiced_value_cents, detail.paid_value_cents,
        detail.quote_status, detail.invoice_status,
        appointment.id AS appointment_id,
        appointment.appointment_type, appointment.starts_at,
        appointment.ends_at, appointment.status AS appointment_status,
        customer.id AS customer_id, customer.customer_number,
        customer.customer_type, customer.first_name, customer.last_name,
        customer.business_name AS customer_business_name,
        customer.business_number, customer.email, customer.phone,
        site.id AS service_site_id, site.site_label,
        site.address_line_1, site.address_line_2, site.suburb,
        site.address_state, site.postcode
      ${pilotJobJoins}
      WHERE ${whereSql}
      ORDER BY
        CASE WHEN ${sortExpression} IS NULL OR ${sortExpression} = ''
          THEN 1 ELSE 0 END,
        ${sortExpression} COLLATE NOCASE ${sortDirection},
        job.job_number COLLATE NOCASE ASC,
        job.id ASC
      LIMIT ? OFFSET ?`).bind(...listBindings).all(),
    database.prepare(`SELECT event_type, actor_uid, summary, metadata,
        created_at
      FROM compliance_pilot_events
      WHERE pilot_run_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 30`).bind(run.id).all(),
  ]);
  const total = Number(totalRow?.total || 0);
  const controlGroups = Object.fromEntries(
    Array.from(new Set(
      controls.results.map((row) => String(row.control_type)),
    )).map((controlType) => [
      controlType,
      controls.results
        .filter((row) => String(row.control_type) === controlType)
        .map((row) => ({
          code: String(row.option_code),
          label: String(row.label),
          order: Number(row.option_order),
          effectiveFrom: String(row.effective_from),
          effectiveTo: String(row.effective_to || ""),
          sourceKey: String(row.source_key),
          liveLookupEnabled: Number(row.live_lookup_enabled) === 1,
        })),
    ]),
  );
  return {
    configured: true,
    confirmationPhrase: CREDITEX_VEU_PILOT_CONFIRMATION,
    run: projectionRun(run),
    targets: pilotTargets(),
    counts,
    priorities: pilotPriorities(run),
    sources: sources.results.map((row) => ({
      sourceKey: String(row.source_key),
      sourceKind: String(row.source_kind),
      title: String(row.title),
      officialSourceUrl: String(row.official_source_url),
      officialVersion: String(row.official_version || ""),
      effectiveFrom: String(row.effective_from || ""),
      effectiveTo: String(row.effective_to || ""),
      officialSourceSha256: String(row.official_source_sha256 || ""),
      hashStatus: String(row.hash_status),
      verificationStatus: String(row.verification_status),
      sourcePriority: Number(row.source_priority),
      capturedAt: String(row.captured_at),
    })),
    controls: controlGroups,
    evidenceContracts: evidenceContracts.results.map((row) => ({
      requirementCode: String(row.requirement_code),
      title: String(row.title),
      evidenceKind: String(row.evidence_kind),
      captureTiming: String(row.capture_timing),
      originalRequired: Number(row.original_required) === 1,
      metadataRequired: Number(row.metadata_required) === 1,
      gpsRequired: Number(row.gps_required) === 1,
      minimumCount: Number(row.minimum_count),
      maximumCount: Number(row.maximum_count),
      allowedContentTypes: JSON.parse(
        String(row.allowed_content_types || "[]"),
      ) as unknown,
      contractScope: String(row.contract_scope),
      governmentRequirementStatus: String(
        row.government_requirement_status,
      ),
      sourceKey: String(row.source_key),
    })),
    calculatorSummary: {
      total: Number(calculatorSummary?.total || 0),
      verified: Number(calculatorSummary?.verified || 0),
      reconciledVectors: Number(
        calculatorSummary?.reconciled_vectors || 0,
      ),
      executionEnabled: false,
      outputUnit: "VEEC",
    },
    connectors: connectors.results.map((row) => ({
      connectorCode: String(row.connector_code),
      mappingVersion: String(row.mapping_version),
      mode: String(row.mode),
      status: String(row.status),
      itemCount: Number(row.item_count),
      acceptedCount: Number(row.accepted_count),
      rejectedCount: Number(row.rejected_count),
      unmatchedCount: Number(row.unmatched_count),
      duplicateCount: Number(row.duplicate_count),
      artifactSha256: String(row.artifact_sha256),
      externalSubmissionEnabled:
        Number(row.external_submission_enabled) === 1,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    })),
    installers: installers.results.map((row) => ({
      id: String(row.id),
      installerSlot: Number(row.installer_slot),
      companyCode: String(row.company_code),
      businessName: String(row.business_name),
      status: String(row.status),
      technicianCount: Number(row.technician_count),
      jobCount: Number(row.job_count),
    })),
    technicians: technicians.results.map((row) => ({
      id: String(row.id),
      installerId: String(row.installer_id),
      technicianSlot: Number(row.technician_slot),
      technicianCode: String(row.technician_code),
      displayName: String(row.display_name),
      status: String(row.status),
      jobCount: Number(row.job_count),
    })),
    activities: activities.results.map((row) => ({
      activityTemplateId: String(row.activity_template_id),
      registryActivityCode: String(row.registry_activity_code),
      specificationPart: String(row.specification_part || ""),
      title: String(row.title),
      serviceCategory: String(row.service_category),
      catalogueState: String(row.catalogue_state),
      jobCount: Number(row.job_count),
      verifiedJobCount: Number(row.verified_job_count),
    })),
    jobs: jobs.results.map((row) => ({
      id: String(row.id),
      workOrderId: String(row.work_order_id),
      caseNumber: String(row.case_number),
      jobNumber: String(row.job_number),
      activityTemplateId: String(row.activity_template_id),
      activityKey: String(row.activity_key),
      registryActivityCode: String(row.registry_activity_code),
      specificationPart: String(row.specification_part || ""),
      title: String(row.title),
      serviceCategory: String(row.service_category),
      productCategory: String(row.product_category || ""),
      scenarioCode: String(row.scenario_code || ""),
      scenario: String(row.scenario || ""),
      catalogueState: String(row.catalogue_state),
      activityDate: String(row.activity_date),
      recordMode: String(row.record_mode),
      ruleStatus: String(row.rule_status),
      lookupStatus: String(row.lookup_status),
      evidenceStatus: String(row.evidence_status),
      calculatorStatus: String(row.calculator_status),
      connectorStatus: String(row.connector_status),
      reviewStatus: String(row.review_status),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      work: {
        workType: String(row.work_type || ""),
        sourceType: String(row.source_type || ""),
        sourceReference: String(row.source_reference || ""),
        stage: String(row.work_stage || ""),
        priority: String(row.priority || ""),
        scheduledStart: String(row.scheduled_start || ""),
        scheduledEnd: String(row.scheduled_end || ""),
        assigneeLabel: String(row.assignee_label || ""),
      },
      crm: {
        customerSource: String(row.customer_source || ""),
        pipelineStage: String(row.pipeline_stage || ""),
        buildingType: String(row.building_type || ""),
        customerReference: String(row.customer_reference || ""),
        tags: JSON.parse(String(row.tags || "[]")) as unknown,
        estimatedValueCents: Number(row.estimated_value_cents || 0),
        quotedValueCents: Number(row.quoted_value_cents || 0),
        invoicedValueCents: Number(row.invoiced_value_cents || 0),
        paidValueCents: Number(row.paid_value_cents || 0),
        quoteStatus: String(row.quote_status || ""),
        invoiceStatus: String(row.invoice_status || ""),
      },
      appointment: {
        id: String(row.appointment_id || ""),
        appointmentType: String(row.appointment_type || ""),
        startsAt: String(row.starts_at || ""),
        endsAt: String(row.ends_at || ""),
        status: String(row.appointment_status || ""),
      },
      customer: {
        id: String(row.customer_id || ""),
        customerNumber: String(row.customer_number || ""),
        customerType: String(row.customer_type || ""),
        firstName: String(row.first_name || ""),
        lastName: String(row.last_name || ""),
        businessName: String(row.customer_business_name || ""),
        businessNumber: String(row.business_number || ""),
        email: String(row.email || ""),
        phone: String(row.phone || ""),
      },
      site: {
        id: String(row.service_site_id || ""),
        siteLabel: String(row.site_label || ""),
        addressLine1: String(row.address_line_1 || ""),
        addressLine2: String(row.address_line_2 || ""),
        suburb: String(row.suburb || ""),
        state: String(row.address_state || ""),
        postcode: String(row.postcode || ""),
      },
      installer: {
        id: String(row.installer_id),
        companyCode: String(row.company_code),
        businessName: String(row.business_name),
      },
      technician: {
        id: String(row.technician_id),
        technicianCode: String(row.technician_code),
        displayName: String(row.display_name),
      },
    })),
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      pageCount: Math.ceil(total / filters.pageSize),
    },
    events: events.results.map((row) => ({
      eventType: String(row.event_type),
      actorUid: String(row.actor_uid),
      summary: String(row.summary),
      metadata: JSON.parse(String(row.metadata || "{}")) as unknown,
      createdAt: String(row.created_at),
    })),
    filters: {
      reviewStatuses: Array.from(REVIEW_STATUSES),
      evidenceStatuses: Array.from(EVIDENCE_STATUSES),
      lookupStatuses: Array.from(LOOKUP_STATUSES),
      ruleStatuses: Array.from(RULE_STATUSES),
      calculatorStatuses: Array.from(CALCULATOR_STATUSES),
      connectorStatuses: Array.from(CONNECTOR_STATUSES),
      workStages: Array.from(WORK_STAGES),
      workTypes: ["job"],
      priorities: Array.from(WORK_PRIORITIES),
      appointmentTypes: Array.from(APPOINTMENT_TYPES),
      appointmentStatuses: Array.from(APPOINTMENT_STATUSES),
      customerTypes: Array.from(CUSTOMER_TYPES),
      serviceCategories: Array.from(SERVICE_CATEGORIES),
      productCategories: Array.from(PRODUCT_CATEGORIES),
      postcodes: ["3000"],
      tags: ["synthetic_test", "VEU"],
      dateFields: Object.keys(PILOT_DATE_FIELDS),
      sortColumns: Object.keys(PILOT_SORT_COLUMNS),
      pageSizes: Array.from(PILOT_PAGE_SIZES),
    },
    boundaries: {
      regulatedCasesCreated: counts.regulatedCases,
      firebaseTestUsersCreated: 0,
      customerEmailsOrPhonesCreated: 0,
      evidenceObjectsCreated: 0,
      certificateLotsCreated: 0,
      tradesCreated: 0,
      settlementsCreated: 0,
      externalSubmissionEnabled: false,
      fieldLoginStatus:
        "Blocked. Assignment-only technicians have no Firebase identity.",
    },
  };
}
