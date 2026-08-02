"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  CreditexVeuJobAuditWorkspace,
  type CreditexJobAuditDetail,
  type JobWorkspaceSection,
} from "./CreditexVeuJobAuditWorkspace";
import { CreditexManualJobAuditWorkspace } from "./CreditexManualJobAuditWorkspace";
import {
  DATAFORCE_JOB_CSV_HEADERS,
  exportDataforceJobCsv,
  projectCreditexJobToDataforceRecord,
  validateDataforceJobCsv,
  type DataforceJobCsvHeader,
  type DataforceJobCsvRecord,
  type DataforceJobCsvValidation,
} from "@/lib/creditex-dataforce-job-csv";
import {
  GOVERNMENT_ACTIVITY_CALCULATION_METHODS,
  GOVERNMENT_CALCULATION_METHOD_SUMMARY,
  GOVERNMENT_PROGRAM_SUBMISSION_ROUTES,
  governmentActivityCalculationMethods,
  governmentCalculationSourceWindows,
} from "@/lib/australian-certificate-calculation-catalogue";
import {
  GOVERNMENT_PROGRAM_TEMPLATES,
} from "@/lib/australian-government-program-catalogue";
import { CreditexManualEvidenceLab } from "./CreditexManualEvidenceLab";
import styles from "./CreditexVeuPilotWorkspace.module.css";

type Api = (
  path: string,
  init?: RequestInit,
) => Promise<Record<string, unknown>>;

type PilotJob = {
  id: string;
  workOrderId: string;
  caseNumber: string;
  jobNumber: string;
  activityTemplateId: string;
  activityKey: string;
  registryActivityCode: string;
  specificationPart: string;
  title: string;
  serviceCategory: string;
  productCategory: string;
  scenarioCode: string;
  scenario: string;
  catalogueState: string;
  activityDate: string;
  recordMode: string;
  ruleStatus: string;
  lookupStatus: string;
  evidenceStatus: string;
  calculatorStatus: string;
  connectorStatus: string;
  reviewStatus: string;
  createdAt: string;
  updatedAt: string;
  work: {
    workType: string;
    sourceType: string;
    sourceReference: string;
    stage: string;
    priority: string;
    scheduledStart: string;
    scheduledEnd: string;
    assigneeLabel: string;
  };
  crm: {
    customerSource: string;
    pipelineStage: string;
    buildingType: string;
    customerReference: string;
    tags: string[];
    estimatedValueCents: number;
    quotedValueCents: number;
    invoicedValueCents: number;
    paidValueCents: number;
    quoteStatus: string;
    invoiceStatus: string;
  };
  appointment: {
    id: string;
    appointmentType: string;
    startsAt: string;
    endsAt: string;
    status: string;
  };
  customer: {
    id: string;
    customerNumber: string;
    customerType: string;
    firstName: string;
    lastName: string;
    businessName: string;
    businessNumber: string;
    email: string;
    phone: string;
  };
  site: {
    id: string;
    siteLabel: string;
    addressLine1: string;
    addressLine2: string;
    suburb: string;
    state: string;
    postcode: string;
  };
  installer: {
    id: string;
    companyCode: string;
    businessName: string;
  };
  technician: {
    id: string;
    technicianCode: string;
    displayName: string;
  };
};

type PilotSnapshot = {
  configured: boolean;
  confirmationPhrase: string;
  archiveConfirmationPhrase?: string;
  previousRun?: {
    id: string;
    name: string;
    seedVersion: string;
    recordMode: string;
    status: string;
    activityCatalogueSha256: string;
    sourceManifestSha256: string;
    activatedAt: string;
    archivedAt: string;
    updatedAt: string;
  } | null;
  run?: {
    id: string;
    name: string;
    seedVersion: string;
    recordMode: string;
    status: string;
    activityCatalogueSha256: string;
    sourceManifestSha256: string;
    activatedAt: string;
    updatedAt: string;
  };
  targets: {
    installers: number;
    technicians: number;
    jobs: number;
    techniciansPerInstaller: number;
    jobsPerTechnician: number;
    activityFamilies: number;
  };
  counts?: {
    installers: number;
    technicians: number;
    jobs: number;
    activities: number;
    sources: number;
    hashedSources: number;
    controlOptions: number;
    calculatorContracts: number;
    evidenceContracts: number;
    regulatedCases: number;
  };
  priorities: Array<{
    key: string;
    number: number;
    title: string;
    status: string;
    complete: boolean;
    boundary: string;
  }>;
  sources?: Array<{
    sourceKey: string;
    sourceKind: string;
    title: string;
    officialSourceUrl: string;
    officialVersion: string;
    effectiveFrom: string;
    effectiveTo: string;
    officialSourceSha256: string;
    hashStatus: string;
    verificationStatus: string;
    sourcePriority: number;
    capturedAt: string;
  }>;
  currentSourcePack?: {
    packId: string;
    programCode: string;
    jurisdiction: string;
    governingVersion: string;
    effectiveFrom: string;
    activityScope: string;
    custodyState: string;
    bindingState: string;
    independentApprovalState: string;
    activationEnabled: boolean;
    certificateCreationEnabled: boolean;
    externalSubmissionEnabled: boolean;
    sources: Array<{
      sourceKey: string;
      sourceKind: string;
      title: string;
      officialSourceUrl: string;
      officialVersion: string;
      effectiveFrom: string;
      effectiveTo: string;
      officialSourceSha256: string;
      hashStatus: string;
      sourcePriority: number;
      verificationStatus: string;
      bytesRetained: boolean;
    }>;
  };
  controls?: Record<string, Array<{
    code: string;
    label: string;
    liveLookupEnabled: boolean;
  }>>;
  evidenceContracts?: Array<{
    requirementCode: string;
    title: string;
    evidenceKind: string;
    captureTiming: string;
    originalRequired: boolean;
    metadataRequired: boolean;
    gpsRequired: boolean;
    minimumCount: number;
    maximumCount: number;
    allowedContentTypes: string[];
    contractScope: string;
    governmentRequirementStatus: string;
    sourceKey: string;
  }>;
  calculatorSummary?: {
    total: number;
    verified: number;
    reconciledVectors: number;
    executionEnabled: boolean;
    outputUnit: string;
  };
  connectors?: Array<{
    connectorCode: string;
    mappingVersion: string;
    mode: string;
    status: string;
    itemCount: number;
    acceptedCount: number;
    rejectedCount: number;
    unmatchedCount: number;
    duplicateCount: number;
    artifactSha256: string;
    externalSubmissionEnabled: boolean;
    updatedAt: string;
  }>;
  installers?: Array<{
    id: string;
    installerSlot: number;
    companyCode: string;
    businessName: string;
    status: string;
    technicianCount: number;
    jobCount: number;
  }>;
  technicians?: Array<{
    id: string;
    installerId: string;
    technicianSlot: number;
    technicianCode: string;
    displayName: string;
    status: string;
    jobCount: number;
  }>;
  activities?: Array<{
    activityTemplateId: string;
    registryActivityCode: string;
    specificationPart: string;
    title: string;
    serviceCategory: string;
    catalogueState: string;
    jobCount: number;
    verifiedJobCount: number;
  }>;
  jobs?: PilotJob[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
  events?: Array<{
    eventType: string;
    summary: string;
    createdAt: string;
  }>;
  filters: {
    reviewStatuses: string[];
    evidenceStatuses: string[];
    lookupStatuses: string[];
    ruleStatuses: string[];
    calculatorStatuses: string[];
    connectorStatuses: string[];
    workStages: string[];
    workTypes: string[];
    priorities: string[];
    appointmentTypes: string[];
    appointmentStatuses: string[];
    customerTypes: string[];
    serviceCategories: string[];
    productCategories: string[];
    postcodes: string[];
    tags: string[];
    dateFields: string[];
    sortColumns: string[];
    pageSizes: number[];
  };
  boundaries?: {
    regulatedCasesCreated: number;
    firebaseTestUsersCreated: number;
    customerEmailsOrPhonesCreated: number;
    evidenceObjectsCreated: number;
    certificateLotsCreated: number;
    tradesCreated: number;
    settlementsCreated: number;
    externalSubmissionEnabled: boolean;
    fieldLoginStatus: string;
  };
};

type PilotSortKey =
  | "appointmentId"
  | "jobNumber"
  | "caseNumber"
  | "reviewStatus"
  | "evidenceStatus"
  | "workType"
  | "scheduledStart"
  | "scheduledEnd"
  | "connectorStatus"
  | "activityDate"
  | "technician"
  | "technicianCode"
  | "installer"
  | "installerCode"
  | "customer"
  | "companyName"
  | "customerNumber"
  | "phone"
  | "email"
  | "address"
  | "suburb"
  | "state"
  | "postcode"
  | "registryActivityCode"
  | "specificationPart"
  | "activityTitle"
  | "serviceCategory"
  | "productCategory"
  | "scenario"
  | "ruleStatus"
  | "lookupStatus"
  | "calculatorStatus"
  | "workStage"
  | "priority"
  | "appointmentType"
  | "appointmentStatus"
  | "pipelineStage"
  | "quoteStatus"
  | "invoiceStatus"
  | "createdAt"
  | "updatedAt";

type RegisterSortKey =
  | "appId"
  | "jobId"
  | "status"
  | "subStatus"
  | "type"
  | "workType"
  | "scheduledDatetime"
  | "balance"
  | "certificates"
  | "submission"
  | "invoiced"
  | "fieldWorker"
  | "agent"
  | "client"
  | "customer"
  | "companyName"
  | "extCustRef"
  | "phone"
  | "mobile"
  | "email"
  | "address"
  | "suburb"
  | "postcode";

type SyntheticRegisterFacet = {
  value: string;
  label: string;
  count: number;
  parentValue?: string;
};

type SyntheticRegisterRow = {
  rowKey: string;
  source: "veu_pilot" | "manual_evidence";
  sourceId: string;
  recordMode: "synthetic_test";
  programCode: string;
  activityTemplateId: string;
  installerId: string;
  technicianId: string;
  status: string;
  revision: number;
  updatedAt: string;
  cells: DataforceJobCsvRecord;
};

type SyntheticRegister = {
  contractVersion: "dataforce-jobs-v1";
  headers: DataforceJobCsvHeader[];
  rows: SyntheticRegisterRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };
  facets: {
    sources: SyntheticRegisterFacet[];
    programs: SyntheticRegisterFacet[];
    activities: SyntheticRegisterFacet[];
    installers: SyntheticRegisterFacet[];
    technicians: SyntheticRegisterFacet[];
    statuses: SyntheticRegisterFacet[];
    postcodes: SyntheticRegisterFacet[];
  };
  boundaries: {
    recordMode: "synthetic_test";
    accessMode: "read_only";
    regulatedWrites: 0;
    externalSubmissionEnabled: false;
  };
};

type PilotColumn = {
  key: string;
  label: DataforceJobCsvHeader;
  sortKey: RegisterSortKey;
  description?: string;
};

const DATAFORCE_JOB_COLUMN_CONFIG = {
  "App Id": { key: "appointmentId", sortKey: "appId" },
  "Job Id": { key: "jobNumber", sortKey: "jobId" },
  "Status": { key: "reviewStatus", sortKey: "status" },
  "SubStatus": {
    key: "legacySubStatus",
    sortKey: "subStatus",
    description: "Dataforce SubStatus semantics are not yet mapped.",
  },
  "Type": {
    key: "legacyType",
    sortKey: "type",
    description: "Dataforce Type semantics are not yet mapped.",
  },
  "Work Type": { key: "workType", sortKey: "workType" },
  "Scheduled Datetime": {
    key: "scheduledStart",
    sortKey: "scheduledDatetime",
  },
  "Balance": {
    key: "legacyBalance",
    sortKey: "balance",
    description: "Dataforce Balance semantics require a field dictionary.",
  },
  "Certificates (VEECs)": {
    key: "certificates",
    sortKey: "certificates",
    description: "Only regulator-issued quantities may appear here.",
  },
  "Submission": { key: "connectorStatus", sortKey: "submission" },
  "Invoiced": { key: "invoiceStatus", sortKey: "invoiced" },
  "Field Worker": { key: "technician", sortKey: "fieldWorker" },
  "Agent": {
    key: "agent",
    sortKey: "agent",
    description: "No authoritative pilot agent relationship is stored.",
  },
  "Client": {
    key: "client",
    sortKey: "client",
    description: "No authoritative pilot client relationship is stored.",
  },
  "Customer": { key: "customer", sortKey: "customer" },
  "Company Name": { key: "companyName", sortKey: "companyName" },
  "Ext Cust Ref": {
    key: "customerNumber",
    sortKey: "extCustRef",
    description: "TLink customer number is shown; legacy equivalence is pending.",
  },
  "Phone": { key: "phone", sortKey: "phone" },
  "Mobile": {
    key: "mobile",
    sortKey: "mobile",
    description: "TLink does not yet store a separate mobile field.",
  },
  "Email": { key: "email", sortKey: "email" },
  "Address": { key: "address", sortKey: "address" },
  "Suburb": { key: "suburb", sortKey: "suburb" },
  "Postcode": { key: "postcode", sortKey: "postcode" },
} as const satisfies Record<
  DataforceJobCsvHeader,
  Omit<PilotColumn, "label">
>;

const PILOT_JOB_COLUMNS: readonly PilotColumn[] =
  DATAFORCE_JOB_CSV_HEADERS.map((label) => ({
    label,
    ...DATAFORCE_JOB_COLUMN_CONFIG[label],
  }));
const PILOT_VISIBLE_SORTABLE_COLUMN_COUNT = PILOT_JOB_COLUMNS.filter(
  (column) => Boolean(column.sortKey),
).length;

type Filters = {
  source: "" | "veu_pilot" | "manual_evidence";
  programCode: string;
  installerId: string;
  technicianId: string;
  activityTemplateId: string;
  status: string;
  postcode: string;
  sortBy: RegisterSortKey;
  sortDirection: "asc" | "desc";
  query: string;
  page: number;
  pageSize: 25 | 50 | 100 | 300;
  // Legacy VEU-only filter fields remain optional for the existing pilot
  // projection. The unified register exposes only fields that have an
  // authoritative value across its synthetic sources.
  reviewStatus?: string;
  evidenceStatus?: string;
  lookupStatus?: string;
  ruleStatus?: string;
  calculatorStatus?: string;
  connectorStatus?: string;
  workStage?: string;
  workType?: string;
  priority?: string;
  appointmentType?: string;
  appointmentStatus?: string;
  customerType?: string;
  serviceCategory?: string;
  productCategory?: string;
  tag?: string;
  dateField?: "activityDate" | "scheduledStart" | "createdAt" | "updatedAt";
  dateFrom?: string;
  dateTo?: string;
};

const EMPTY_FILTERS: Filters = {
  source: "",
  programCode: "",
  installerId: "",
  technicianId: "",
  activityTemplateId: "",
  status: "",
  postcode: "",
  sortBy: "jobId",
  sortDirection: "asc",
  query: "",
  page: 0,
  pageSize: 300,
};

function activeFilterCount(filters: Filters) {
  const ignored = new Set([
    "sortBy",
    "sortDirection",
    "page",
    "pageSize",
  ]);
  return Object.entries(filters).filter(
    ([key, value]) => !ignored.has(key) && value !== "",
  ).length;
}

const PANELS = [
  ["overview", "Pilot control"],
  ["jobs", "Jobs"],
  ["sources", "Sources"],
  ["lookups", "Lookups"],
  ["evidence", "Evidence"],
  ["calculators", "Calculators"],
  ["connectors", "Connectors"],
] as const;

type Panel = typeof PANELS[number][0];

type ContextMenuState = {
  jobId: string;
  x: number;
  y: number;
};

type DataforceImportDraft = {
  fileName: string;
  csv: string;
  validation: DataforceJobCsvValidation | null;
};

type GovernanceDecisionSummary = {
  decision: string;
};

type FieldAcceptanceSummary = {
  status: string;
  physicalCustodyAccepted: boolean;
};

type FoundationReadiness = {
  sourceDecisions: GovernanceDecisionSummary[] | null;
  lookupDecisions: GovernanceDecisionSummary[] | null;
  fieldAcceptances: FieldAcceptanceSummary[] | null;
  loading: "sources" | "lookups" | "evidence" | "";
  error: string;
};

type StcEstimateForm = {
  technology:
    | "solar_pv"
    | "small_wind"
    | "small_hydro"
    | "solar_water_heater"
    | "air_source_heat_pump"
    | "solar_battery";
  effectiveDate: string;
  ratedCapacityKw: string;
  zoneRating: "1.622" | "1.536" | "1.382" | "1.185";
  resourceAvailability: "default" | "site_assessed";
  resourceHoursPerYear: string;
  deemingYears: string;
  registeredTenYearStcs: string;
  nominalCapacityKwh: string;
  usableCapacityKwh: string;
};

type StcEstimateResult = {
  technology: StcEstimateForm["technology"];
  formulaKey: string;
  formulaVersion: string;
  officialSourceUrl: string;
  officialSourceTitle: string;
  effectiveDate: string;
  trace: Array<{
    key: string;
    label: string;
    input: string;
    operation: string;
    output: string;
    unit: string;
  }>;
  output: {
    quantity: string;
    unit: "STC";
  };
  status: "estimate_only_registry_reconciliation_required";
  certificateActionEnabled: false;
  receiptHash: string;
  operatorMessage: string;
};

type CalculationCoverageReadiness = {
  reviewedOn: string;
  readOnly: true;
  certificateActionsEnabled: false;
  coverage: {
    contract: string;
    programs: number;
    activities: number;
    estimateExecutable: number;
    certificateActionsEnabled: number;
    blockedOrNonExecutable: number;
    coverageSha256: string;
    stateCounts: Array<{ state: string; count: number }>;
  };
};

type InterchangeReadiness = {
  contract: string;
  reviewedOn: string;
  readOnly: true;
  dryRunOnly: true;
  externalSubmissionEnabled: false;
  counts: {
    adapters: number;
    ready: number;
    blocked: number;
    serializersAvailable: number;
    externalSubmissionEnabled: number;
  };
  adapters: Array<{
    adapterKey: string;
    programCode: string;
    pathway: string;
    status: "blocked";
    blockReason: string;
    schemaState: string;
    officialSourceUrl?: string;
    publicRegistryUrl?: string;
    version?: string;
    scheme?: string;
    kind?: string;
    maximumRecords?: number;
    serializerAvailable: false;
    externalSubmissionEnabled: false;
  }>;
};

const EMPTY_FOUNDATION_READINESS: FoundationReadiness = {
  sourceDecisions: null,
  lookupDecisions: null,
  fieldAcceptances: null,
  loading: "",
  error: "",
};

const EMPTY_DATAFORCE_IMPORT: DataforceImportDraft = {
  fileName: "",
  csv: "",
  validation: null,
};

const EMPTY_STC_ESTIMATE_FORM: StcEstimateForm = {
  technology: "solar_pv",
  effectiveDate: "2026-08-02",
  ratedCapacityKw: "6.6",
  zoneRating: "1.382",
  resourceAvailability: "default",
  resourceHoursPerYear: "2001",
  deemingYears: "5",
  registeredTenYearStcs: "30",
  nominalCapacityKwh: "20",
  usableCapacityKwh: "18",
};

const JOB_CONTEXT_ITEMS: ReadonlyArray<{
  label: string;
  section: JobWorkspaceSection;
}> = [
  { label: "Job Summary", section: "job_summary" },
  { label: "Job Appointments", section: "job_appointments" },
  { label: "Job Actions", section: "job_actions" },
  { label: "Job Questions", section: "job_questions" },
  { label: "Job Quote/Invoice", section: "job_quote_invoice" },
  { label: "Job Calculations", section: "job_calculations" },
  { label: "Job Transactions", section: "job_transactions" },
  { label: "Job Files", section: "job_files" },
  { label: "Job Issues", section: "job_issues" },
  { label: "Job Emails", section: "job_emails" },
  { label: "Job History", section: "job_history" },
];

const APPOINTMENT_CONTEXT_ITEMS: ReadonlyArray<{
  label: string;
  section: JobWorkspaceSection;
}> = [
  { label: "Appointment Summary", section: "appointment_summary" },
  { label: "Appointment Actions", section: "appointment_actions" },
  { label: "Appointment Questions", section: "appointment_questions" },
  {
    label: "Appointment Certificate Submissions",
    section: "appointment_certificate_submissions",
  },
  {
    label: "Appointment Decommissioning Summary",
    section: "appointment_decommissioning",
  },
  {
    label: "Appointment Correspondence",
    section: "appointment_correspondence",
  },
  { label: "Appointment Audit", section: "appointment_audit" },
  { label: "Appointment History", section: "appointment_history" },
];

function readable(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

const DATE_ONLY_FORMAT = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function dateOnly(value: string) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return DATE_ONLY_FORMAT.format(date);
}

function shortHash(value: string) {
  if (!value) return "Hash pending";
  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

function progress(value: number, target: number) {
  if (!target) return 0;
  return Math.min(100, Math.round((value / target) * 100));
}

function dateTime(value: string) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return DATE_TIME_FORMAT.format(date);
}

function present(value: string, fallback = "Not recorded") {
  return value.trim() || fallback;
}

function spreadsheetSafeClipboardCell(value: unknown) {
  const flattened = String(value ?? "")
    .replace(/[\t\r\n\u2028\u2029]+/g, " ");
  const formulaCandidate = flattened.replace(/^[\s\uFEFF\u200B]+/, "");
  return /^[=+\-@]/.test(formulaCandidate)
    ? `'${flattened}`
    : flattened;
}

function dataforceClipboardText(
  record: DataforceJobCsvRecord,
  includeHeaders: boolean,
) {
  const values = DATAFORCE_JOB_CSV_HEADERS.map(
    (header) => spreadsheetSafeClipboardCell(record[header]),
  );
  return includeHeaders
    ? [
        DATAFORCE_JOB_CSV_HEADERS.map(spreadsheetSafeClipboardCell)
          .join("\t"),
        values.join("\t"),
      ].join("\n")
    : values.join("\t");
}

function customerName(job: PilotJob) {
  return present(
    [job.customer.firstName, job.customer.lastName].filter(Boolean).join(" "),
    "Not collected",
  );
}

function sortState(
  column: PilotColumn,
  filters: Filters,
): "ascending" | "descending" | "none" {
  if (!column.sortKey || column.sortKey !== filters.sortBy) return "none";
  return filters.sortDirection === "asc" ? "ascending" : "descending";
}

function PilotSortHeader({
  column,
  filters,
  open,
  onToggle,
  onClose,
  onSort,
}: {
  column: PilotColumn;
  filters: Filters;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSort: (sortBy: RegisterSortKey, sortDirection: "asc" | "desc") => void;
}) {
  const state = sortState(column, filters);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function closeAndRestoreFocus() {
    onClose();
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <th
      scope="col"
      data-column={column.key}
      aria-sort={state === "none" ? undefined : state}
      title={column.description || column.label}
    >
      <div
        className={styles.sortMenu}
        data-sort-menu={column.key}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !open) return;
          event.preventDefault();
          closeAndRestoreFocus();
        }}
      >
        <button
          ref={triggerRef}
          type="button"
          className={styles.sortMenuTrigger}
          aria-label={
            column.sortKey
              ? `Sort ${column.label}`
              : `${column.label} mapping information`
          }
          aria-expanded={open}
          aria-controls={`pilot-sort-options-${column.key}`}
          onClick={onToggle}
        >
          <span>{column.label}</span>
          <b aria-hidden="true">
            {!column.sortKey
              ? "Info"
              : state === "ascending"
              ? "A-Z"
              : state === "descending"
              ? "Z-A"
              : "Sort"}
          </b>
        </button>
        {open && (
          <div
            id={`pilot-sort-options-${column.key}`}
            role="group"
            aria-label={`${column.label} column options`}
          >
            {column.sortKey ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onSort(column.sortKey!, "asc");
                    closeAndRestoreFocus();
                  }}
                >
                  Sort ascending
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSort(column.sortKey!, "desc");
                    closeAndRestoreFocus();
                  }}
                >
                  Sort descending
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSort("jobId", "asc");
                    closeAndRestoreFocus();
                  }}
                >
                  Clear sort
                </button>
              </>
            ) : (
              <p>{column.description || "This column is not sortable."}</p>
            )}
          </div>
        )}
      </div>
    </th>
  );
}

function pilotJobCellValue(columnKey: string, job: PilotJob) {
  switch (columnKey) {
    case "appointmentId":
      return present(job.appointment.id);
    case "jobNumber":
      return present(job.jobNumber);
    case "reviewStatus":
      return readable(job.reviewStatus);
    case "legacySubStatus":
    case "legacyType":
    case "legacyBalance":
    case "agent":
    case "client":
    case "mobile":
      return "Mapping required";
    case "workType":
      return readable(job.work.workType);
    case "scheduledStart":
      return dateTime(job.appointment.startsAt);
    case "certificates":
      return "Blocked: no issued VEECs";
    case "connectorStatus":
      return readable(job.connectorStatus);
    case "technician":
      return present(job.technician.displayName);
    case "technicianCode":
      return present(job.technician.technicianCode);
    case "installer":
      return present(job.installer.businessName);
    case "installerCode":
      return present(job.installer.companyCode);
    case "customer":
      return customerName(job);
    case "companyName":
      return present(job.customer.businessName, "Not applicable");
    case "customerNumber":
      return present(job.customer.customerNumber);
    case "phone":
      return present(job.customer.phone, "Not collected (test)");
    case "email":
      return present(job.customer.email, "Not collected (test)");
    case "address":
      return present(
        [job.site.addressLine1, job.site.addressLine2]
          .filter(Boolean)
          .join(", "),
      );
    case "suburb":
      return present(job.site.suburb);
    case "postcode":
      return present(job.site.postcode);
    case "caseNumber":
      return job.caseNumber;
    case "state":
      return present(job.site.state);
    case "registryActivityCode":
      return job.registryActivityCode;
    case "specificationPart":
      return present(job.specificationPart);
    case "activityTitle":
      return job.title;
    case "serviceCategory":
      return readable(job.serviceCategory);
    case "productCategory":
      return readable(job.productCategory);
    case "scenario":
      return present(
        [job.scenarioCode, job.scenario].filter(Boolean).join(" | "),
      );
    case "activityDate":
      return dateOnly(job.activityDate);
    case "ruleStatus":
      return readable(job.ruleStatus);
    case "lookupStatus":
      return readable(job.lookupStatus);
    case "evidenceStatus":
      return readable(job.evidenceStatus);
    case "calculatorStatus":
      return readable(job.calculatorStatus);
    case "workStage":
      return readable(job.work.stage);
    case "priority":
      return readable(job.work.priority);
    case "appointmentType":
      return readable(job.appointment.appointmentType);
    case "appointmentStatus":
      return readable(job.appointment.status);
    case "pipelineStage":
      return readable(job.crm.pipelineStage);
    case "quoteStatus":
      return readable(job.crm.quoteStatus);
    case "invoiceStatus":
      return readable(job.crm.invoiceStatus);
    case "recordMode":
      return readable(job.recordMode);
    case "createdAt":
      return dateTime(job.createdAt);
    case "updatedAt":
      return dateTime(job.updatedAt);
    default:
      return "Not recorded";
  }
}

function projectPilotJobToDataforceRecord(job: PilotJob) {
  const overrides = Object.fromEntries(
    PILOT_JOB_COLUMNS.map((column) => [
      column.label,
      pilotJobCellValue(column.key, job),
    ]),
  ) as DataforceJobCsvRecord;
  return projectCreditexJobToDataforceRecord(job, overrides);
}

function SyntheticRegisterCell({
  column,
  row,
  onOpen,
  onOpenMenu,
}: {
  column: PilotColumn;
  row: SyntheticRegisterRow;
  onOpen: (button: HTMLButtonElement) => void;
  onOpenMenu: (button: HTMLButtonElement) => void;
}) {
  const value = row.cells[column.label] || "";
  if (column.label === "App Id") {
    return (
      <span className={styles.appIdCell}>
        <button
          className={styles.rowActionButton}
          type="button"
          aria-label={`Open actions for ${row.cells["Job Id"] || "job"}`}
          aria-haspopup="menu"
          onClick={(event) => onOpenMenu(event.currentTarget)}
        >
          ...
        </button>
        <span title={value || "Not recorded"}>{value || "-"}</span>
      </span>
    );
  }
  if (column.label === "Job Id") {
    return (
      <button
        className={styles.jobLink}
        type="button"
        onClick={(event) => onOpen(event.currentTarget)}
      >
        {value || row.sourceId}
      </button>
    );
  }
  const statusTone =
    /blocked|not checked|not started|not staged|dry run/i.test(value)
      ? "blocked"
      : /changes required|in review|in progress|field testing/i.test(value)
      ? "attention"
      : /verified|complete|reconciled|passed|ready for audit/i.test(value)
      ? "ready"
      : "neutral";
  const statusColumn = [
    "Status",
    "SubStatus",
    "Submission",
    "Invoiced",
    "Certificates (VEECs)",
  ].includes(column.label);
  return (
    <span
      className={statusColumn ? styles.statusCell : undefined}
      data-tone={statusColumn ? statusTone : undefined}
      title={value || "Not recorded"}
    >
      {value || "-"}
    </span>
  );
}

function PilotJobContextMenu({
  state,
  job,
  onOpen,
  onCopyRow,
  onCopySelection,
  onPrint,
  onClose,
}: {
  state: ContextMenuState;
  job: PilotJob;
  onOpen: (section: JobWorkspaceSection) => void;
  onCopyRow: () => void;
  onCopySelection: () => void;
  onPrint: (previewOnly: boolean) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const menu = menuRef.current;
    menu?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    function handlePointer(event: MouseEvent) {
      if (!menu?.contains(event.target as Node)) onClose();
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (
        event.key === "ArrowDown"
        || event.key === "ArrowUp"
        || event.key === "Home"
        || event.key === "End"
      ) {
        const items = Array.from(
          menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || [],
        ).filter((item) => item.offsetParent !== null && !item.disabled);
        if (!items.length) return;
        event.preventDefault();
        const activeIndex = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const nextIndex = event.key === "Home"
          ? 0
          : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowUp"
          ? (activeIndex <= 0 ? items.length - 1 : activeIndex - 1)
          : (activeIndex + 1) % items.length;
        items[nextIndex]?.focus();
      }
    }
    window.addEventListener("mousedown", handlePointer);
    window.addEventListener("keydown", handleKey);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", handlePointer);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className={styles.contextMenu}
      role="menu"
      aria-label={`Actions for ${job.jobNumber}`}
      style={{
        left: Math.min(state.x, Math.max(8, window.innerWidth - 528)),
        top: Math.min(state.y, Math.max(8, window.innerHeight - 448)),
      }}
    >
      <button type="button" role="menuitem" onClick={() => onOpen("customer_details")}>
        Customer Details
      </button>
      <div className={styles.contextSubmenu}>
        <button type="button" role="menuitem" aria-haspopup="menu">
          Job <span aria-hidden="true">&gt;</span>
        </button>
        <div role="menu" aria-label="Job actions">
          {JOB_CONTEXT_ITEMS.map((item) => (
            <button
              key={item.section}
              type="button"
              role="menuitem"
              onClick={() => onOpen(item.section)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.contextSubmenu}>
        <button type="button" role="menuitem" aria-haspopup="menu">
          Appointment <span aria-hidden="true">&gt;</span>
        </button>
        <div role="menu" aria-label="Appointment actions">
          {APPOINTMENT_CONTEXT_ITEMS.map((item) => (
            <button
              key={item.section}
              type="button"
              role="menuitem"
              onClick={() => onOpen(item.section)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <hr />
      <button type="button" role="menuitem" onClick={onCopyRow}>
        Copy Row
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onCopySelection}
        title="Copy the selected row values without headings."
      >
        Copy Selection
      </button>
      <button type="button" role="menuitem" onClick={() => onPrint(false)}>
        Print
      </button>
      <button type="button" role="menuitem" onClick={() => onPrint(true)}>
        Print Preview
      </button>
    </div>
  );
}

function ManualJobContextMenu({
  state,
  row,
  onOpen,
  onCopyRow,
  onCopySelection,
  onClose,
}: {
  state: ContextMenuState;
  row: SyntheticRegisterRow;
  onOpen: () => void;
  onCopyRow: () => void;
  onCopySelection: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const menu = menuRef.current;
    menu?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    function handlePointer(event: MouseEvent) {
      if (!menu?.contains(event.target as Node)) onClose();
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("mousedown", handlePointer);
    window.addEventListener("keydown", handleKey);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", handlePointer);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  return (
    <div
      ref={menuRef}
      className={styles.contextMenu}
      role="menu"
      aria-label={`Actions for ${row.cells["Job Id"] || "manual job"}`}
      style={{
        left: Math.min(state.x, Math.max(8, window.innerWidth - 360)),
        top: Math.min(state.y, Math.max(8, window.innerHeight - 260)),
      }}
    >
      <button type="button" role="menuitem" onClick={onOpen}>
        Open complete audit record
      </button>
      <button type="button" role="menuitem" onClick={onOpen}>
        Evidence checklist and captures
      </button>
      <button type="button" role="menuitem" onClick={onOpen}>
        Job history
      </button>
      <hr />
      <button type="button" role="menuitem" onClick={onCopyRow}>
        Copy Row
      </button>
      <button type="button" role="menuitem" onClick={onCopySelection}>
        Copy Selection
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          window.print();
        }}
      >
        Print
      </button>
    </div>
  );
}

function AdvancedRegisterFilters({
  register,
  filters,
  busy,
  onChange,
  onApply,
  onClear,
  onClose,
}: {
  register: SyntheticRegister;
  filters: Filters;
  busy: boolean;
  onChange: (next: Partial<Filters>) => void;
  onApply: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  const visibleActivities = register.facets.activities.filter(
    (option) => !filters.programCode
      || option.parentValue === filters.programCode,
  );
  const visibleInstallers = register.facets.installers.filter(
    (option) => !filters.source || option.parentValue === filters.source,
  );
  const visibleTechnicians = register.facets.technicians.filter(
    (option) => !filters.installerId
      || option.parentValue === filters.installerId,
  );

  useEffect(() => {
    const drawer = drawerRef.current;
    if (!drawer) return;
    const drawerElement = drawer;
    const focusableSelector =
      'button:not([disabled]), select:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    const focusHandle = window.setTimeout(() => {
      const focusable = Array.from(
        drawerElement.querySelectorAll<HTMLElement>(focusableSelector),
      );
      (focusable[0] || drawerElement).focus();
    }, 0);
    function trapFocus(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const items = Array.from(
        drawerElement.querySelectorAll<HTMLElement>(focusableSelector),
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    drawerElement.addEventListener("keydown", trapFocus);
    return () => {
      window.clearTimeout(focusHandle);
      drawerElement.removeEventListener("keydown", trapFocus);
    };
  }, []);

  return (
    <aside
      ref={drawerRef}
      className={styles.advancedFilters}
      role="dialog"
      aria-modal="true"
      aria-labelledby="creditex-advanced-register-filters-title"
      tabIndex={-1}
    >
      <header>
        <div>
          <span>ADVANCED SEARCH</span>
          <h3 id="creditex-advanced-register-filters-title">
            All synthetic jobs
          </h3>
        </div>
        <button
          className={styles.closeFilters}
          type="button"
          onClick={onClose}
          aria-label="Close advanced filters"
        >
          x
        </button>
      </header>

      <p className={styles.filterBoundary}>
        Every option is populated from stored job data. Blank legacy fields
        are not guessed, and regulated bulk actions remain disabled.
      </p>

      <section className={styles.quickFilters}>
        <div className={styles.quickFilterHeading}>
          <strong>Quick filters</strong>
          <small>Search every populated Dataforce-compatible field.</small>
        </div>
        <label className={styles.quickFilterWide}>
          Search jobs
          <input
            type="search"
            value={filters.query}
            placeholder="Job, customer, installer, address or activity"
            onChange={(event) => onChange({ query: event.target.value })}
          />
        </label>
        <label>
          Record source
          <select
            value={filters.source}
            onChange={(event) =>
              onChange({
                source: event.target.value as Filters["source"],
                installerId: "",
                technicianId: "",
              })}
          >
            <option value="">All synthetic sources</option>
            {register.facets.sources.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({option.count})
              </option>
            ))}
          </select>
        </label>
        <label>
          Program
          <select
            value={filters.programCode}
            onChange={(event) =>
              onChange({
                programCode: event.target.value,
                activityTemplateId: "",
              })}
          >
            <option value="">All programs</option>
            {register.facets.programs.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({option.count})
              </option>
            ))}
          </select>
        </label>
        <label className={styles.quickFilterWide}>
          Program activity
          <select
            value={filters.activityTemplateId}
            onChange={(event) =>
              onChange({ activityTemplateId: event.target.value })}
          >
            <option value="">All activities</option>
            {visibleActivities.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({option.count})
              </option>
            ))}
          </select>
        </label>
      </section>

      <details>
        <summary>Work &amp; personnel</summary>
        <div>
          <label>
            Installer company
            <select
              value={filters.installerId}
              onChange={(event) =>
                onChange({
                  installerId: event.target.value,
                  technicianId: "",
                })}
            >
              <option value="">All installers</option>
              {visibleInstallers.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.count})
                </option>
              ))}
            </select>
          </label>
          <label>
            Field technician
            <select
              value={filters.technicianId}
              onChange={(event) =>
                onChange({ technicianId: event.target.value })}
            >
              <option value="">All technicians</option>
              {visibleTechnicians.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.count})
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>

      <details>
        <summary>Status &amp; location</summary>
        <div>
          <label>
            Job status
            <select
              value={filters.status}
              onChange={(event) => onChange({ status: event.target.value })}
            >
              <option value="">All job states</option>
              {register.facets.statuses.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.count})
                </option>
              ))}
            </select>
          </label>
          <label>
            Postcode
            <select
              value={filters.postcode}
              onChange={(event) => onChange({ postcode: event.target.value })}
            >
              <option value="">All postcodes</option>
              {register.facets.postcodes.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.count})
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>

      <details>
        <summary>Display</summary>
        <div>
          <label>
            Rows per page
            <select
              value={filters.pageSize}
              onChange={(event) =>
                onChange({
                  pageSize: Number(event.target.value) as Filters["pageSize"],
                })}
            >
              {[25, 50, 100, 300].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
        </div>
      </details>

      <div className={styles.filterActions}>
        <button type="button" disabled={busy} onClick={onApply}>
          Search
        </button>
        <button type="button" disabled={busy} onClick={onClear}>
          Clear
        </button>
      </div>
    </aside>
  );
}

export function CreditexVeuPilotWorkspace({
  api,
  role,
}: {
  api: Api;
  role: "admin" | "case_manager" | "reviewer" | "auditor";
}) {
  const [snapshot, setSnapshot] = useState<PilotSnapshot | null>(null);
  const [register, setRegister] = useState<SyntheticRegister | null>(null);
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [panel, setPanel] = useState<Panel>("overview");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [recordSection, setRecordSection] =
    useState<JobWorkspaceSection>("appointment_summary");
  const [recordOpen, setRecordOpen] = useState(false);
  const [jobDetail, setJobDetail] = useState<CreditexJobAuditDetail | null>(
    null,
  );
  const [jobDetailBusy, setJobDetailBusy] = useState(false);
  const [jobDetailError, setJobDetailError] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openSortColumn, setOpenSortColumn] = useState("");
  const [density, setDensity] = useState<"compact" | "comfortable">("compact");
  const [confirmation, setConfirmation] = useState("");
  const [archiveConfirmation, setArchiveConfirmation] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [provisionProgress, setProvisionProgress] = useState("");
  const [dataforceImportOpen, setDataforceImportOpen] = useState(false);
  const [dataforceImport, setDataforceImport] =
    useState<DataforceImportDraft>(EMPTY_DATAFORCE_IMPORT);
  const [foundationReadiness, setFoundationReadiness] =
    useState<FoundationReadiness>(EMPTY_FOUNDATION_READINESS);
  const [calculationProgramCode, setCalculationProgramCode] = useState("SRES");
  const [stcEstimateForm, setStcEstimateForm] =
    useState<StcEstimateForm>(EMPTY_STC_ESTIMATE_FORM);
  const [stcEstimate, setStcEstimate] =
    useState<StcEstimateResult | null>(null);
  const [stcEstimateBusy, setStcEstimateBusy] = useState(false);
  const [stcEstimateError, setStcEstimateError] = useState("");
  const [calculationReadiness, setCalculationReadiness] =
    useState<CalculationCoverageReadiness | null>(null);
  const [interchangeReadiness, setInterchangeReadiness] =
    useState<InterchangeReadiness | null>(null);
  const [readinessError, setReadinessError] = useState("");
  const stcMaximumDeemingYears = String(
    Math.min(
      5,
      Math.max(
        1,
        2031 - Number(stcEstimateForm.effectiveDate.slice(0, 4) || 2030),
      ),
    ),
  );
  const requestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const initialPanelRef = useRef(false);
  const filterToggleRef = useRef<HTMLButtonElement>(null);
  const dataforceFileRef = useRef<HTMLInputElement>(null);
  const dataforceImportDialogRef = useRef<HTMLDialogElement>(null);
  const lastRecordTriggerRef = useRef<HTMLElement | null>(null);

  const registerQuery = useMemo(() => {
    const params = new URLSearchParams({
      page: String(filters.page),
      pageSize: String(filters.pageSize),
      sortBy: filters.sortBy,
      sortDirection: filters.sortDirection,
    });
    if (filters.source) params.set("source", filters.source);
    if (filters.programCode) params.set("programCode", filters.programCode);
    if (filters.installerId)
      params.set("installerId", filters.installerId);
    if (filters.technicianId)
      params.set("technicianId", filters.technicianId);
    if (filters.activityTemplateId)
      params.set("activityTemplateId", filters.activityTemplateId);
    if (filters.status) params.set("status", filters.status);
    if (filters.postcode) params.set("postcode", filters.postcode);
    if (filters.query) params.set("query", filters.query);
    return params.toString();
  }, [filters]);

  const pilotQuery = useMemo(() => {
    const pilotSort: Record<RegisterSortKey, PilotSortKey> = {
      appId: "appointmentId",
      jobId: "jobNumber",
      status: "reviewStatus",
      subStatus: "jobNumber",
      type: "jobNumber",
      workType: "workType",
      scheduledDatetime: "scheduledStart",
      balance: "jobNumber",
      certificates: "jobNumber",
      submission: "connectorStatus",
      invoiced: "invoiceStatus",
      fieldWorker: "technician",
      agent: "jobNumber",
      client: "jobNumber",
      customer: "customer",
      companyName: "companyName",
      extCustRef: "customerNumber",
      phone: "phone",
      mobile: "jobNumber",
      email: "email",
      address: "address",
      suburb: "suburb",
      postcode: "postcode",
    };
    const params = new URLSearchParams({
      page: String(filters.page),
      pageSize: String(filters.pageSize),
      sortBy: pilotSort[filters.sortBy],
      sortDirection: filters.sortDirection,
    });
    if (filters.installerId)
      params.set("installerId", filters.installerId);
    if (filters.technicianId)
      params.set("technicianId", filters.technicianId);
    if (filters.activityTemplateId)
      params.set("activityTemplateId", filters.activityTemplateId);
    if (filters.status) params.set("reviewStatus", filters.status);
    if (filters.postcode) params.set("postcode", filters.postcode);
    if (filters.query) params.set("q", filters.query);
    return params.toString();
  }, [filters]);

  const load = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setBusy((current) => current || "load");
    setError("");
    try {
      const [pilotResult, registerResult] = await Promise.all([
        api(`/api/creditex/pilot?${pilotQuery}`),
        api(`/api/creditex/synthetic-job-register?${registerQuery}`),
      ]);
      if (requestId !== requestRef.current) return;
      const nextSnapshot = pilotResult.pilot as PilotSnapshot;
      const nextRegister = registerResult.register as SyntheticRegister;
      setSnapshot(nextSnapshot);
      setRegister(nextRegister);
      if (!initialPanelRef.current) {
        initialPanelRef.current = true;
        if (
          nextSnapshot.run?.status === "active"
          || nextRegister.pagination.total > 0
        ) {
          setPanel("jobs");
        }
      }
    } catch (requestError) {
      if (requestId !== requestRef.current) return;
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The synthetic compliance workspace could not be loaded.",
      );
    } finally {
      if (requestId === requestRef.current) {
        setBusy((current) => current === "load" ? "" : current);
      }
    }
  }, [api, pilotQuery, registerQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const configuration = panel === "sources"
      ? {
          key: "sources" as const,
          path: "/api/creditex/official-sources/reviews",
          resultKey: "decisions",
        }
      : panel === "lookups"
      ? {
          key: "lookups" as const,
          path: "/api/creditex/operational-lookups/reviews",
          resultKey: "decisions",
        }
      : panel === "evidence"
      ? {
          key: "evidence" as const,
          path: "/api/creditex/field-custody-acceptance",
          resultKey: "acceptances",
        }
      : null;
    if (!configuration) return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (!active) return;
      setFoundationReadiness((current) => ({
        ...current,
        loading: configuration.key,
        error: "",
      }));
      void api(configuration.path)
        .then((result) => {
          if (!active) return;
          const records = Array.isArray(result[configuration.resultKey])
            ? result[configuration.resultKey]
            : [];
          setFoundationReadiness((current) => ({
            ...current,
            ...(configuration.key === "sources"
              ? { sourceDecisions: records as GovernanceDecisionSummary[] }
              : configuration.key === "lookups"
              ? { lookupDecisions: records as GovernanceDecisionSummary[] }
              : { fieldAcceptances: records as FieldAcceptanceSummary[] }),
            loading: "",
            error: "",
          }));
        })
        .catch((readinessError) => {
          if (!active) return;
          setFoundationReadiness((current) => ({
            ...current,
            loading: "",
            error: readinessError instanceof Error
              ? readinessError.message
              : "Governed foundation status is unavailable.",
          }));
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [api, panel]);

  useEffect(() => {
    const path = panel === "calculators"
      ? "/api/creditex/calculation-coverage"
      : panel === "connectors"
      ? "/api/creditex/interchange-readiness"
      : "";
    if (!path) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setReadinessError("");
      void api(path)
        .then((result) => {
          if (!active) return;
          if (panel === "calculators") {
            setCalculationReadiness(
              result.readiness as CalculationCoverageReadiness,
            );
          } else {
            setInterchangeReadiness(
              result.readiness as InterchangeReadiness,
            );
          }
        })
        .catch((readinessLoadError) => {
          if (!active) return;
          setReadinessError(
            readinessLoadError instanceof Error
              ? readinessLoadError.message
              : "Readiness status is temporarily unavailable.",
          );
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [api, panel]);

  useEffect(() => {
    if (!openSortColumn) return;

    function closeSortMenuOnOutsidePointer(event: PointerEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-sort-menu]")) return;
      setOpenSortColumn("");
    }

    document.addEventListener(
      "pointerdown",
      closeSortMenuOnOutsidePointer,
      true,
    );
    return () =>
      document.removeEventListener(
        "pointerdown",
        closeSortMenuOnOutsidePointer,
        true,
      );
  }, [openSortColumn]);

  const selectedRegisterRow = useMemo(
    () => register?.rows.find((row) => row.rowKey === selectedJobId) || null,
    [register?.rows, selectedJobId],
  );
  const selectedJob = useMemo(
    () => selectedRegisterRow?.source === "veu_pilot"
      ? snapshot?.jobs?.find(
        (job) => job.id === selectedRegisterRow.sourceId,
      ) || null
      : null,
    [selectedRegisterRow, snapshot?.jobs],
  );
  const contextRow = useMemo(
    () =>
      register?.rows.find((row) => row.rowKey === contextMenu?.jobId) || null,
    [contextMenu?.jobId, register?.rows],
  );
  const contextJob = useMemo(
    () => contextRow?.source === "veu_pilot"
      ? snapshot?.jobs?.find((job) => job.id === contextRow.sourceId) || null
      : null,
    [contextRow, snapshot?.jobs],
  );
  const appliedFilterCount = useMemo(
    () => activeFilterCount(filters),
    [filters],
  );
  const selectedCalculationMethods = useMemo(
    () => governmentActivityCalculationMethods(calculationProgramCode),
    [calculationProgramCode],
  );
  const selectedCalculationWindows = useMemo(
    () => governmentCalculationSourceWindows(calculationProgramCode),
    [calculationProgramCode],
  );
  const selectedSubmissionRoute = useMemo(
    () =>
      GOVERNMENT_PROGRAM_SUBMISSION_ROUTES.find(
        (route) => route.programCode === calculationProgramCode,
      ) || GOVERNMENT_PROGRAM_SUBMISSION_ROUTES[0],
    [calculationProgramCode],
  );

  async function runAction(body: Record<string, unknown>) {
    return api("/api/creditex/pilot", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async function calculateStcEstimate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStcEstimateBusy(true);
    setStcEstimateError("");
    setStcEstimate(null);
    const common = stcEstimateForm.technology === "solar_battery"
      ? {
          technology: stcEstimateForm.technology,
          certificationDate: stcEstimateForm.effectiveDate,
        }
      : {
          technology: stcEstimateForm.technology,
          installationDate: stcEstimateForm.effectiveDate,
        };
    const payload = stcEstimateForm.technology === "solar_battery"
      ? {
          ...common,
          claimScope: "new_system",
          nominalCapacityKwh: stcEstimateForm.nominalCapacityKwh,
          usableCapacityKwh: stcEstimateForm.usableCapacityKwh,
        }
      : stcEstimateForm.technology === "solar_water_heater"
          || stcEstimateForm.technology === "air_source_heat_pump"
        ? {
            ...common,
            registeredTenYearStcs:
              stcEstimateForm.registeredTenYearStcs,
          }
        : stcEstimateForm.technology === "small_wind"
            || stcEstimateForm.technology === "small_hydro"
          ? {
              ...common,
              ratedCapacityKw: stcEstimateForm.ratedCapacityKw,
              resourceAvailability: stcEstimateForm.resourceAvailability,
              ...(stcEstimateForm.resourceAvailability === "site_assessed"
                ? {
                    resourceHoursPerYear:
                      stcEstimateForm.resourceHoursPerYear,
                  }
                : {}),
              deemingYears: stcEstimateForm.deemingYears,
            }
        : {
            ...common,
            ratedCapacityKw: stcEstimateForm.ratedCapacityKw,
            zoneRating: stcEstimateForm.zoneRating,
          };
    try {
      const result = await api("/api/creditex/stc-estimates", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setStcEstimate(result.estimate as StcEstimateResult);
    } catch (estimateError) {
      setStcEstimateError(
        estimateError instanceof Error
          ? estimateError.message
          : "The STC estimate could not be completed safely.",
      );
    } finally {
      setStcEstimateBusy(false);
    }
  }

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    window.setTimeout(() => lastRecordTriggerRef.current?.focus(), 0);
  }, []);

  const closeFilters = useCallback(() => {
    setFiltersOpen(false);
    window.setTimeout(() => filterToggleRef.current?.focus(), 0);
  }, []);

  const loadJobDetail = useCallback(async (jobId: string) => {
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    setJobDetailBusy(true);
    setJobDetailError("");
    try {
      const result = await api(
        `/api/creditex/pilot?jobId=${encodeURIComponent(jobId)}`,
      );
      if (detailRequestRef.current !== requestId) return;
      const workspace = result.workspace as CreditexJobAuditDetail;
      setJobDetail(workspace);
      return workspace;
    } catch (detailError) {
      if (detailRequestRef.current !== requestId) return;
      setJobDetailError(
        detailError instanceof Error
          ? detailError.message
          : "The complete synthetic job record could not be loaded.",
      );
    } finally {
      if (detailRequestRef.current === requestId) setJobDetailBusy(false);
    }
  }, [api]);

  useEffect(() => {
    if (!filtersOpen) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeFilters();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [closeFilters, filtersOpen]);

  useEffect(() => {
    if (!dataforceImportOpen) return;
    const dialog = dataforceImportDialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setDataforceImportOpen(false);
        setDataforceImport(EMPTY_DATAFORCE_IMPORT);
        if (dataforceFileRef.current) dataforceFileRef.current.value = "";
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      if (dialog?.open) dialog.close();
    };
  }, [dataforceImportOpen]);

  function openRecord(
    job: PilotJob,
    section: JobWorkspaceSection,
    trigger?: HTMLElement | null,
  ) {
    if (trigger) lastRecordTriggerRef.current = trigger;
    const rowKey = register?.rows.find(
      (row) => row.source === "veu_pilot" && row.sourceId === job.id,
    )?.rowKey || `veu_pilot:${job.id}`;
    setJobDetail(null);
    setJobDetailError("");
    setSelectedJobId(rowKey);
    setRecordSection(section);
    setRecordOpen(true);
    setContextMenu(null);
    return loadJobDetail(job.id);
  }

  function openRegisterRecord(
    row: SyntheticRegisterRow,
    section: JobWorkspaceSection = "appointment_summary",
    trigger?: HTMLElement | null,
  ) {
    if (trigger) lastRecordTriggerRef.current = trigger;
    if (row.source === "manual_evidence") {
      setJobDetail(null);
      setJobDetailError("");
      setSelectedJobId(row.rowKey);
      setRecordSection(section);
      setRecordOpen(true);
      setContextMenu(null);
      return;
    }
    const pilotJob = snapshot?.jobs?.find((job) => job.id === row.sourceId);
    if (!pilotJob) {
      setError(
        "This VEU pilot row changed before its audit record opened. Refresh and try again.",
      );
      return;
    }
    return openRecord(pilotJob, section, trigger);
  }

  const closeRecord = useCallback(() => {
    detailRequestRef.current += 1;
    setJobDetailBusy(false);
    setJobDetailError("");
    setJobDetail(null);
    setRecordOpen(false);
    setSelectedJobId("");
    window.setTimeout(() => lastRecordTriggerRef.current?.focus(), 0);
  }, []);

  function openRegisterContextMenu(
    row: SyntheticRegisterRow,
    x: number,
    y: number,
    trigger?: HTMLElement | null,
  ) {
    if (trigger) lastRecordTriggerRef.current = trigger;
    setSelectedJobId(row.rowKey);
    setRecordOpen(false);
    setContextMenu({
      jobId: row.rowKey,
      x: Math.max(8, x),
      y: Math.max(8, y),
    });
  }

  async function copyJobRow(
    job: PilotJob,
    includeHeaders: boolean,
  ) {
    const record = projectPilotJobToDataforceRecord(job);
    const content = dataforceClipboardText(record, includeHeaders);
    try {
      await navigator.clipboard.writeText(content);
      setNotice(
        includeHeaders
          ? `${job.jobNumber} row headings and values were copied safely.`
          : `${job.jobNumber} selected values were copied safely.`,
      );
    } catch {
      setError("Browser clipboard access was denied. Nothing was copied.");
    } finally {
      closeContextMenu();
    }
  }

  async function copyRegisterRow(
    row: SyntheticRegisterRow,
    includeHeaders: boolean,
  ) {
    const content = dataforceClipboardText(row.cells, includeHeaders);
    try {
      await navigator.clipboard.writeText(content);
      const jobLabel = row.cells["Job Id"] || "Job";
      setNotice(
        includeHeaders
          ? `${jobLabel} row headings and values were copied safely.`
          : `${jobLabel} selected values were copied safely.`,
      );
    } catch {
      setError("Browser clipboard access was denied. Nothing was copied.");
    } finally {
      closeContextMenu();
    }
  }

  async function downloadDataforceCsv() {
    const expectedTotal = register?.pagination.total || 0;
    if (expectedTotal <= 0) return;
    if (expectedTotal > 20_000) {
      setError(
        "Narrow the advanced search to 20,000 jobs or fewer before exporting.",
      );
      return;
    }

    setBusy("dataforce-export");
    setError("");
    setNotice("");
    try {
      const params = new URLSearchParams(registerQuery);
      params.set("pageSize", "300");
      const rowsById = new Map<string, SyntheticRegisterRow>();
      let page = 0;
      let pageCount = 1;
      do {
        params.set("page", String(page));
        const result = await api(
          `/api/creditex/synthetic-job-register?${params.toString()}`,
        );
        const pageRegister = result.register as SyntheticRegister;
        for (const row of pageRegister.rows) {
          rowsById.set(row.rowKey, row);
        }
        pageCount = Math.max(1, pageRegister.pagination.pageCount || 1);
        page += 1;
      } while (page < pageCount);

      const rows = Array.from(rowsById.values());
      if (rows.length !== expectedTotal) {
        throw new Error(
          "The job register changed during export. Refresh and download again.",
        );
      }
      const csv = exportDataforceJobCsv(
        rows.map((row) => row.cells),
        { includeBom: true },
      );
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download =
        `creditex-synthetic-jobs-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(
        `Downloaded ${rows.length} matching jobs in the exact 23-column Dataforce layout.`,
      );
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "The Dataforce-compatible CSV could not be downloaded.",
      );
    } finally {
      setBusy("");
    }
  }

  function closeDataforceImport() {
    setDataforceImportOpen(false);
    setDataforceImport(EMPTY_DATAFORCE_IMPORT);
    if (dataforceFileRef.current) dataforceFileRef.current.value = "";
  }

  async function inspectDataforceFile(file: File | undefined) {
    setError("");
    setNotice("");
    setDataforceImport(EMPTY_DATAFORCE_IMPORT);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Choose a Dataforce CSV no larger than 5 MB.");
      return;
    }
    try {
      const csv = await file.text();
      const validation = validateDataforceJobCsv(csv);
      setDataforceImport({
        fileName: file.name,
        csv,
        validation,
      });
    } catch {
      setError(
        "The selected file could not be read as a Dataforce job CSV.",
      );
    }
  }

  async function stageDataforceImport() {
    const validation = dataforceImport.validation;
    if (
      !validation?.valid
      || validation.summary.totalRows > 2_500
      || !dataforceImport.csv
    ) {
      return;
    }
    setBusy("dataforce-import");
    setError("");
    setNotice("");
    try {
      const result = await api("/api/creditex/dataforce", {
        method: "POST",
        body: JSON.stringify({
          action: "stage_import",
          fileName: dataforceImport.fileName,
          csv: dataforceImport.csv,
        }),
      });
      const batch = result.batch as {
        rowCount?: number;
        reused?: boolean;
      } | undefined;
      const rowCount =
        batch?.rowCount ?? validation.summary.acceptedRows;
      closeDataforceImport();
      setNotice(
        batch?.reused
          ? `This ${rowCount}-row Dataforce export was already staged. No duplicate jobs were created.`
          : `Staged ${rowCount} Dataforce rows for mapping review. No regulated jobs, cases or certificates were created.`,
      );
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "The Dataforce CSV could not be staged.",
      );
    } finally {
      setBusy("");
    }
  }

  async function openPrint(job: PilotJob, previewOnly: boolean) {
    const detail = await openRecord(job, "print_preview");
    if (previewOnly || !detail) return;
    await new Promise<void>((resolve) =>
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => resolve()),
      ),
    );
    window.print();
  }

  async function provisionPilot() {
    if (!snapshot || role !== "admin") return;
    setBusy("provision");
    setError("");
    setNotice("");
    try {
      await runAction({
        action: "start",
        confirmation,
      });
      for (let cohort = 1; cohort <= 31; cohort += 1) {
        setProvisionProgress(
          `Provisioning technician cohort ${Math.min(cohort, 30)} of 30`,
        );
        const response = await runAction({ action: "provision_next" });
        const result = response.result as { complete?: boolean };
        if (result.complete) break;
      }
      setProvisionProgress("Validating the 300-job dry-run manifest");
      await runAction({ action: "finalise" });
      setConfirmation("");
      setProvisionProgress("");
      setNotice(
        "Created 10 synthetic installers, 30 assignment-only technicians and 300 VEU pilot jobs with a validated dry-run manifest.",
      );
      setFilters(EMPTY_FILTERS);
      setDraftFilters(EMPTY_FILTERS);
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "The synthetic pilot could not be provisioned.",
      );
    } finally {
      setBusy("");
      setProvisionProgress("");
    }
  }

  async function resumePilot() {
    setBusy("provision");
    setError("");
    setNotice("");
    try {
      for (let cohort = 1; cohort <= 31; cohort += 1) {
        setProvisionProgress(
          `Reconciling technician cohort ${Math.min(cohort, 30)} of 30`,
        );
        const response = await runAction({ action: "provision_next" });
        const result = response.result as { complete?: boolean };
        if (result.complete) break;
      }
      setProvisionProgress("Validating the 300-job dry-run manifest");
      await runAction({ action: "finalise" });
      setNotice(
        "The synthetic pilot is fully provisioned and its activation manifest is validated.",
      );
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "The synthetic pilot could not be resumed.",
      );
    } finally {
      setBusy("");
      setProvisionProgress("");
    }
  }

  async function archivePreviousPilot() {
    if (
      !snapshot?.previousRun
      || snapshot.previousRun.status === "archived"
      || role !== "admin"
    ) {
      return;
    }
    setBusy("archive");
    setError("");
    setNotice("");
    try {
      await runAction({
        action: "archive",
        confirmation: archiveConfirmation,
      });
      setArchiveConfirmation("");
      setNotice(
        "The previous synthetic VEU seed was deactivated. The current seed can now be created.",
      );
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "The previous synthetic pilot could not be archived.",
      );
    } finally {
      setBusy("");
    }
  }

  async function saveJob(
    job: PilotJob,
    next: {
      reviewStatus: string;
      evidenceStatus: string;
      lookupStatus: string;
    },
  ) {
    setBusy(`job:${job.id}`);
    setError("");
    setNotice("");
    try {
      await runAction({
        action: "update_job",
        jobId: job.id,
        expectedUpdatedAt: job.updatedAt,
        ...next,
      });
      setNotice(`${job.jobNumber} synthetic workflow status was audited.`);
      await load();
      if (
        recordOpen
        && selectedRegisterRow?.source === "veu_pilot"
        && selectedRegisterRow.sourceId === job.id
      ) {
        await loadJobDetail(job.id);
      }
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "The synthetic job status could not be updated.",
      );
    } finally {
      setBusy("");
    }
  }

  if (!snapshot || !register) {
    return (
      <section className={styles.workspace} aria-label="VEU pilot">
        <div className={styles.loading}>
          {error || "Loading the controlled VEU pilot..."}
        </div>
      </section>
    );
  }

  const counts = snapshot.counts || {
    installers: 0,
    technicians: 0,
    jobs: 0,
    activities: 0,
    sources: 0,
    hashedSources: 0,
    controlOptions: 0,
    calculatorContracts: 0,
    evidenceContracts: 0,
    regulatedCases: 0,
  };
  const isProvisioning =
    snapshot.configured && snapshot.run?.status === "provisioning";

  return (
    <section
      className={styles.workspace}
      aria-label="VEU synthetic pilot"
      data-panel={panel}
    >
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>CONTROLLED TEST ENVIRONMENT</span>
          <h2>Creditex VEU workflow pilot</h2>
          <p>
            Exercise every VEU activity family across synthetic installer
            records, field assignments and Creditex compliance workflow
            structure. Physical field capture is not enabled. These records
            can never become regulated cases, certificates, registry
            submissions, trades or settlements.
          </p>
        </div>
        <div className={styles.mode}>
          <span>Record mode</span>
          <strong>Synthetic test only</strong>
          <small>
            {snapshot.run
              ? `${readable(snapshot.run.status)} | ${snapshot.run.seedVersion}`
              : "Not created"}
          </small>
        </div>
      </header>

      <nav
        className={styles.panelTabs}
        aria-label="VEU pilot workspaces"
        role="tablist"
        inert={filtersOpen}
      >
        {PANELS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`creditex-veu-pilot-tab-${key}`}
            aria-controls="creditex-veu-pilot-panel"
            aria-selected={panel === key}
            tabIndex={panel === key ? 0 : -1}
            data-selected={panel === key}
            onClick={() => setPanel(key)}
            onKeyDown={(event) => {
              const currentIndex = PANELS.findIndex(([candidate]) =>
                candidate === key);
              const nextIndex = event.key === "ArrowRight"
                ? (currentIndex + 1) % PANELS.length
                : event.key === "ArrowLeft"
                ? (currentIndex - 1 + PANELS.length) % PANELS.length
                : event.key === "Home"
                ? 0
                : event.key === "End"
                ? PANELS.length - 1
                : -1;
              if (nextIndex < 0) return;
              event.preventDefault();
              const nextPanel = PANELS[nextIndex][0];
              setPanel(nextPanel);
              window.requestAnimationFrame(() =>
                document.getElementById(
                  `creditex-veu-pilot-tab-${nextPanel}`,
                )?.focus());
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      <div
        id="creditex-veu-pilot-panel"
        className={styles.panelViewport}
        data-panel={panel}
        role="tabpanel"
        aria-labelledby={`creditex-veu-pilot-tab-${panel}`}
      >
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {provisionProgress && (
        <p className={styles.progressNotice} role="status">
          {provisionProgress}
        </p>
      )}

      {panel === "overview" && (
        <>
          <section className={styles.metrics} aria-label="Pilot population">
            {[
              ["Installers", counts.installers, snapshot.targets.installers],
              [
                "Field technicians",
                counts.technicians,
                snapshot.targets.technicians,
              ],
              ["VEU jobs", counts.jobs, snapshot.targets.jobs],
              [
                "Activity families",
                counts.activities,
                snapshot.targets.activityFamilies,
              ],
            ].map(([label, value, target]) => (
              <article key={String(label)}>
                <span>{label}</span>
                <strong>{value} / {target}</strong>
                <div>
                  <i
                    style={{
                      width: `${progress(Number(value), Number(target))}%`,
                    }}
                  />
                </div>
              </article>
            ))}
          </section>

          {!snapshot.configured
            && role === "admin"
            && snapshot.previousRun
            && snapshot.previousRun.status !== "archived"
            && (
              <section className={styles.createPanel}>
                <div>
                  <span>RULE VERSION CHANGE</span>
                  <h3>Archive the previous synthetic seed first</h3>
                  <p>
                    {snapshot.previousRun.seedVersion} remains{" "}
                    {readable(snapshot.previousRun.status)}. It is retained for
                    audit, but must be deactivated before the current
                    government-source seed can create a separate dataset.
                  </p>
                </div>
                <label>
                  Exact confirmation
                  <input
                    value={archiveConfirmation}
                    onChange={(event) =>
                      setArchiveConfirmation(event.target.value)}
                    placeholder={snapshot.archiveConfirmationPhrase}
                  />
                </label>
                <button
                  type="button"
                  disabled={
                    Boolean(busy)
                    || archiveConfirmation
                      !== snapshot.archiveConfirmationPhrase
                  }
                  onClick={() => void archivePreviousPilot()}
                >
                  Archive previous test seed
                </button>
              </section>
            )}

          {!snapshot.configured
            && role === "admin"
            && (!snapshot.previousRun
              || snapshot.previousRun.status === "archived")
            && (
            <section className={styles.createPanel}>
              <div>
                <span>ONE CONTROLLED DATASET</span>
                <h3>Create the 10 x 3 x 10 VEU pilot</h3>
                <p>
                  This creates 10 clearly marked synthetic installer companies,
                  three assignment-only technicians per company and ten jobs
                  per technician. It creates no Firebase field identities and
                  no real customer contact details.
                </p>
              </div>
              <label>
                Exact confirmation
                <input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder={snapshot.confirmationPhrase}
                />
              </label>
              <button
                type="button"
                disabled={
                  Boolean(busy)
                  || confirmation !== snapshot.confirmationPhrase
                }
                onClick={() => void provisionPilot()}
              >
                Create and validate pilot
              </button>
            </section>
            )}

          {isProvisioning && role === "admin" && (
            <section className={styles.createPanel}>
              <div>
                <span>RESUMABLE PROVISIONING</span>
                <h3>Continue from the last complete technician cohort</h3>
                <p>
                  Each cohort contains one assignment-only technician and ten
                  jobs. Existing rows are compared and never replaced.
                </p>
              </div>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void resumePilot()}
              >
                Resume and validate
              </button>
            </section>
          )}

          <section className={styles.priorities}>
            {snapshot.priorities.map((priority) => (
              <article key={priority.key}>
                <span>{String(priority.number).padStart(2, "0")}</span>
                <div>
                  <h3>{priority.title}</h3>
                  <strong data-complete={priority.complete}>
                    {readable(priority.status)}
                  </strong>
                  <p>{priority.boundary}</p>
                </div>
              </article>
            ))}
          </section>

          <section className={styles.safety}>
            <div>
              <span>STRUCTURAL SAFETY CHECK</span>
              <h3>No test data can escape into live certificate operations</h3>
              <p>
                The database rejects any regulated compliance case or
                submission item linked to a synthetic pilot work order.
              </p>
            </div>
            <dl>
              <div>
                <dt>Regulated cases</dt>
                <dd>{snapshot.boundaries?.regulatedCasesCreated ?? 0}</dd>
              </div>
              <div>
                <dt>Firebase test users</dt>
                <dd>{snapshot.boundaries?.firebaseTestUsersCreated ?? 0}</dd>
              </div>
              <div>
                <dt>Certificates</dt>
                <dd>{snapshot.boundaries?.certificateLotsCreated ?? 0}</dd>
              </div>
              <div>
                <dt>External submission</dt>
                <dd>
                  {snapshot.boundaries?.externalSubmissionEnabled
                    ? "Enabled"
                    : "Blocked"}
                </dd>
              </div>
            </dl>
            <small>
              {snapshot.boundaries?.fieldLoginStatus
                || "Field login remains blocked until authorised test identities and devices exist."}
            </small>
          </section>

          <section className={styles.audit}>
            <div className={styles.sectionHeading}>
              <span>APPEND-ONLY HISTORY</span>
              <h3>Latest pilot control events</h3>
            </div>
            <div>
              {(snapshot.events || []).map((event, index) => (
                <article key={`${event.eventType}:${event.createdAt}:${index}`}>
                  <span>{dateOnly(event.createdAt)}</span>
                  <strong>{readable(event.eventType)}</strong>
                  <p>{event.summary}</p>
                </article>
              ))}
              {!snapshot.events?.length && <p>No pilot events yet.</p>}
            </div>
          </section>
        </>
      )}

      {panel === "jobs" && (
        <section className={styles.jobWorkspace} data-density={density}>
          <div className={styles.jobRegister} inert={filtersOpen}>
            <header>
              <div>
                <span>SYNTHETIC COMPLIANCE JOB REGISTER</span>
                <h3>
                  {register.rows.length} shown of{" "}
                  {register.pagination.total} matching jobs
                </h3>
                <p>
                  Double-click a job for its complete audit workspace.
                  Right-click for customer, job and appointment actions.
                </p>
              </div>
              <div className={styles.registerTools}>
                <label className={styles.densityControl}>
                  <span>Density</span>
                  <select
                    aria-label="Job row density"
                    value={density}
                    onChange={(event) =>
                      setDensity(
                        event.target.value as "compact" | "comfortable",
                      )}
                  >
                    <option value="compact">Compact</option>
                    <option value="comfortable">Comfortable</option>
                  </select>
                </label>
                <form
                  className={styles.registerSearch}
                  role="search"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const registerQuery = draftFilters.query.trim();
                    const next = {
                      ...filters,
                      query: registerQuery,
                      page: 0,
                    };
                    setFilters(next);
                    setDraftFilters((current) => ({
                      ...current,
                      query: registerQuery,
                      page: 0,
                    }));
                    setOpenSortColumn("");
                    setRecordOpen(false);
                    setSelectedJobId("");
                  }}
                >
                  <input
                    type="search"
                    aria-label="Search all populated job data"
                    value={draftFilters.query}
                    placeholder="Search all populated job data"
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        query: event.target.value,
                      }))}
                  />
                  <button type="submit" aria-label="Search all job fields">
                    <span className={styles.fullButtonLabel}>Search</span>
                    <span
                      className={styles.compactButtonLabel}
                      aria-hidden="true"
                    >
                      Go
                    </span>
                  </button>
                </form>
                <button
                  type="button"
                  aria-label="Refresh jobs"
                  disabled={Boolean(busy)}
                  onClick={() => void load()}
                >
                  <span className={styles.fullButtonLabel}>Refresh</span>
                  <span
                    className={styles.compactButtonLabel}
                    aria-hidden="true"
                  >
                    Reload
                  </span>
                </button>
                <button
                  ref={filterToggleRef}
                  type="button"
                  className={styles.filterToggle}
                  aria-label="Advanced search"
                  aria-expanded={filtersOpen}
                  aria-controls="creditex-veu-advanced-filters"
                  onClick={() => {
                    setOpenSortColumn("");
                    setFiltersOpen((current) => !current);
                  }}
                >
                  <span className={styles.fullButtonLabel}>
                    Advanced search
                  </span>
                  <span className={styles.compactButtonLabel}>
                    Filters
                  </span>
                  {appliedFilterCount > 0 && (
                    <b aria-label={`${appliedFilterCount} active filters`}>
                      {appliedFilterCount}
                    </b>
                  )}
                </button>
              </div>
            </header>

            <div className={styles.tableViewport}>
              <table className={styles.jobTable}>
                <caption>
                  Creditex synthetic compliance job register in the exact
                  23-column Dataforce layout. Every returned job is one row.
                </caption>
                <thead>
                  <tr>
                    {PILOT_JOB_COLUMNS.map((column) => (
                      <PilotSortHeader
                        key={column.key}
                        column={column}
                        filters={filters}
                        open={openSortColumn === column.key}
                        onToggle={() =>
                          setOpenSortColumn((current) =>
                            current === column.key ? "" : column.key)}
                        onClose={() => setOpenSortColumn("")}
                        onSort={(sortBy, sortDirection) => {
                          const next = {
                            ...filters,
                            sortBy,
                            sortDirection,
                            page: 0,
                          };
                          setFilters(next);
                          setDraftFilters((current) => ({
                            ...current,
                            sortBy,
                            sortDirection,
                            page: 0,
                          }));
                          setRecordOpen(false);
                          setSelectedJobId("");
                        }}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {register.rows.map((row) => (
                    <tr
                      key={row.rowKey}
                      data-selected={selectedJobId === row.rowKey}
                      aria-selected={selectedJobId === row.rowKey}
                      tabIndex={0}
                      onClick={(event) => {
                        if (
                          (event.target as Element).closest(
                            "button, a, input, select, textarea, [role='menu']",
                          )
                        ) {
                          return;
                        }
                        setSelectedJobId(row.rowKey);
                        setRecordOpen(false);
                      }}
                      onDoubleClick={(event) => {
                        if (
                          (event.target as Element).closest(
                            "button, a, input, select, textarea, [role='menu']",
                          )
                        ) {
                          return;
                        }
                        void openRegisterRecord(
                          row,
                          "appointment_summary",
                          event.currentTarget,
                        );
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        openRegisterContextMenu(
                          row,
                          event.clientX,
                          event.clientY,
                          event.currentTarget,
                        );
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void openRegisterRecord(
                            row,
                            "appointment_summary",
                            event.currentTarget,
                          );
                        }
                        if (
                          event.key === "ContextMenu"
                          || (event.shiftKey && event.key === "F10")
                        ) {
                          event.preventDefault();
                          const rect =
                            event.currentTarget.getBoundingClientRect();
                          openRegisterContextMenu(
                            row,
                            rect.left + 28,
                            rect.top + 24,
                            event.currentTarget,
                          );
                        }
                      }}
                    >
                      {PILOT_JOB_COLUMNS.map((column) => (
                        <td key={column.key} data-column={column.key}>
                          <SyntheticRegisterCell
                            column={column}
                            row={row}
                            onOpen={(button) =>
                              void openRegisterRecord(
                                row,
                                "appointment_summary",
                                button,
                              )}
                            onOpenMenu={(button) => {
                              const rect = button.getBoundingClientRect();
                              openRegisterContextMenu(
                                row,
                                rect.left,
                                rect.bottom + 4,
                                button,
                              );
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                  {!register.rows.length && (
                    <tr>
                      <td
                        className={styles.empty}
                        colSpan={PILOT_JOB_COLUMNS.length}
                      >
                        No synthetic jobs match the applied filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <footer className={styles.registerFooter}>
              <span>
                Records {register.rows.length} |{" "}
                {PILOT_JOB_COLUMNS.length} Dataforce columns |{" "}
                {PILOT_VISIBLE_SORTABLE_COLUMN_COUNT} sortable
              </span>
              {(role === "admin" || role === "case_manager") && (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setError("");
                    setNotice("");
                    setDataforceImportOpen(true);
                  }}
                >
                  Import CSV
                </button>
              )}
              <button
                type="button"
                disabled={
                  Boolean(busy)
                  || register.pagination.total <= 0
                }
                onClick={() => void downloadDataforceCsv()}
              >
                {busy === "dataforce-export"
                  ? "Preparing CSV..."
                  : "Download CSV"}
              </button>
              <button
                type="button"
                disabled={!register.pagination.hasPreviousPage}
                onClick={() => {
                  const next = {
                    ...filters,
                    page: Math.max(0, filters.page - 1),
                  };
                  setFilters(next);
                  setDraftFilters(next);
                  setRecordOpen(false);
                  setSelectedJobId("");
                }}
              >
                Previous
              </button>
              <span>
                Page {register.pagination.page + 1} of{" "}
                {Math.max(1, register.pagination.pageCount)}
              </span>
              <button
                type="button"
                disabled={
                  !register.pagination.hasNextPage
                }
                onClick={() => {
                  const next = { ...filters, page: filters.page + 1 };
                  setFilters(next);
                  setDraftFilters(next);
                  setRecordOpen(false);
                  setSelectedJobId("");
                }}
              >
                Next
              </button>
            </footer>
          </div>

          {dataforceImportOpen && (
            <dialog
              ref={dataforceImportDialogRef}
              className={styles.importDialog}
              aria-labelledby="dataforce-import-title"
              onCancel={(event) => {
                event.preventDefault();
                closeDataforceImport();
              }}
            >
              <header>
                <div>
                  <span>CONTROLLED LEGACY INTAKE</span>
                  <h3 id="dataforce-import-title">
                    Stage a Dataforce job export
                  </h3>
                </div>
                <button
                  type="button"
                  aria-label="Close Dataforce import"
                  onClick={closeDataforceImport}
                >
                  Close
                </button>
              </header>
              <p>
                Select the unedited job CSV downloaded from Dataforce. TLink
                checks the exact 23-column layout before retaining it for
                mapping review.
              </p>
              <label className={styles.importFile}>
                Dataforce CSV
                <input
                  ref={dataforceFileRef}
                  type="file"
                  accept=".csv,text/csv"
                  autoFocus
                  disabled={Boolean(busy)}
                  onChange={(event) =>
                    void inspectDataforceFile(event.target.files?.[0])}
                />
                <small>Maximum 5 MB and 2,500 job rows per batch.</small>
              </label>

              {dataforceImport.validation && (
                <div
                  className={styles.importValidation}
                  data-valid={
                    dataforceImport.validation.valid
                    && dataforceImport.validation.summary.totalRows <= 2_500
                  }
                >
                  <strong>
                    {dataforceImport.validation.valid
                      ? `${dataforceImport.validation.summary.acceptedRows} rows match the Dataforce contract`
                      : "This file does not match the Dataforce contract"}
                  </strong>
                  <span>
                    {dataforceImport.validation.summary.rejectedRows} rejected
                    {" | "}
                    {dataforceImport.validation.summary.duplicateRows} duplicate
                  </span>
                  {dataforceImport.validation.summary.totalRows > 2_500 && (
                    <p>
                      Split this export into batches of 2,500 jobs or fewer.
                    </p>
                  )}
                  {dataforceImport.validation.issues.length > 0 && (
                    <ul>
                      {dataforceImport.validation.issues
                        .slice(0, 5)
                        .map((issue, index) => (
                          <li
                            key={[
                              issue.code,
                              issue.rowNumber || 0,
                              issue.columnNumber || 0,
                              index,
                            ].join(":")}
                          >
                            {issue.rowNumber
                              ? `Row ${issue.rowNumber}: `
                              : ""}
                            {issue.message}
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              )}

              <div className={styles.importBoundary}>
                <strong>Staging only</strong>
                <span>
                  Importing does not create a customer, job, compliance case,
                  certificate, registry submission or trade. Unmapped
                  Dataforce values remain quarantined until Creditex approves
                  the field dictionary.
                </span>
              </div>
              <footer>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={closeDataforceImport}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    Boolean(busy)
                    || !dataforceImport.validation?.valid
                    || dataforceImport.validation.summary.totalRows > 2_500
                  }
                  onClick={() => void stageDataforceImport()}
                >
                  {busy === "dataforce-import"
                    ? "Staging..."
                    : "Stage for mapping review"}
                </button>
              </footer>
            </dialog>
          )}

          {filtersOpen && (
            <button
              className={styles.filterBackdrop}
              type="button"
              aria-label="Close advanced filters"
              onClick={closeFilters}
            />
          )}
          <div
            id="creditex-veu-advanced-filters"
            className={styles.filterDrawer}
            data-open={filtersOpen}
            aria-hidden={!filtersOpen}
          >
            {filtersOpen && (
              <AdvancedRegisterFilters
                register={register}
                filters={draftFilters}
                busy={Boolean(busy)}
                onChange={(next) =>
                  setDraftFilters((current) => ({ ...current, ...next }))}
                onApply={() => {
                  setFilters({ ...draftFilters, page: 0 });
                  setRecordOpen(false);
                  setSelectedJobId("");
                  closeFilters();
                }}
                onClear={() => {
                  setDraftFilters(EMPTY_FILTERS);
                  setFilters(EMPTY_FILTERS);
                  setRecordOpen(false);
                  setSelectedJobId("");
                }}
                onClose={closeFilters}
              />
            )}
          </div>

          {contextMenu && contextJob && (
            <PilotJobContextMenu
              state={contextMenu}
              job={contextJob}
              onOpen={(section) => void openRecord(contextJob, section)}
              onCopyRow={() => void copyJobRow(contextJob, true)}
              onCopySelection={() => void copyJobRow(contextJob, false)}
              onPrint={(previewOnly) => void openPrint(contextJob, previewOnly)}
              onClose={closeContextMenu}
            />
          )}
          {contextMenu && contextRow?.source === "manual_evidence" && (
            <ManualJobContextMenu
              state={contextMenu}
              row={contextRow}
              onOpen={() => openRegisterRecord(contextRow)}
              onCopyRow={() => void copyRegisterRow(contextRow, true)}
              onCopySelection={() =>
                void copyRegisterRow(contextRow, false)}
              onClose={closeContextMenu}
            />
          )}
        </section>
      )}

      {recordOpen && selectedJob && (
        <CreditexVeuJobAuditWorkspace
          key={[
            selectedJob.id,
            selectedJob.reviewStatus,
            selectedJob.evidenceStatus,
            selectedJob.lookupStatus,
            selectedJob.updatedAt,
          ].join(":")}
          job={selectedJob}
          section={recordSection}
          role={role}
          busy={busy === `job:${selectedJob.id}`}
          options={snapshot.filters}
          priorities={jobDetail?.priorities || snapshot.priorities}
          detail={jobDetail}
          detailBusy={jobDetailBusy}
          detailError={jobDetailError}
          onSectionChange={setRecordSection}
          onClose={closeRecord}
          onSave={(next) => void saveJob(selectedJob, next)}
          onPrint={() => window.print()}
        />
      )}
      {recordOpen && selectedRegisterRow?.source === "manual_evidence" && (
        <CreditexManualJobAuditWorkspace
          api={api}
          jobId={selectedRegisterRow.sourceId}
          role={role}
          onClose={closeRecord}
        />
      )}

      {panel === "sources" && (
        <section className={styles.dataPanel}>
          <div className={styles.sectionHeading}>
            <span>PRIORITY 01</span>
            <h3>Current VEU source pack</h3>
            <p>
              This program-wide pack covers every catalogued VEU activity
              family. Exact custody, binding and independent approval remain
              separate gates, so no rule, certificate quantity or submission
              is activated from research data.
            </p>
          </div>
          {snapshot.currentSourcePack && (
            <section className={styles.sourcePackSummary}>
              <article>
                <span>Pack</span>
                <strong>{snapshot.currentSourcePack.packId}</strong>
              </article>
              <article>
                <span>Controlling version</span>
                <strong>{snapshot.currentSourcePack.governingVersion}</strong>
              </article>
              <article>
                <span>Independent approval</span>
                <strong>
                  {readable(
                    snapshot.currentSourcePack.independentApprovalState,
                  )}
                </strong>
              </article>
              <article>
                <span>Activation</span>
                <strong>
                  {snapshot.currentSourcePack.activationEnabled
                    ? "Enabled"
                    : "Blocked"}
                </strong>
              </article>
              <article>
                <span>Append-only review ledger</span>
                <strong>
                  {foundationReadiness.loading === "sources"
                    ? "Loading"
                    : `${foundationReadiness.sourceDecisions?.length || 0} decisions`}
                </strong>
              </article>
              <article>
                <span>Approval entries</span>
                <strong>
                  {foundationReadiness.sourceDecisions?.filter(
                    (decision) => decision.decision === "approved",
                  ).length || 0}
                </strong>
              </article>
            </section>
          )}
          {foundationReadiness.error && panel === "sources" && (
            <p className={styles.error}>{foundationReadiness.error}</p>
          )}
          <div className={styles.sourceRows}>
            {(snapshot.currentSourcePack?.sources || snapshot.sources || [])
              .map((source) => (
              <article key={source.sourceKey}>
                <span>{source.sourcePriority}</span>
                <div>
                  <h4>{source.title}</h4>
                  <p>
                    {source.officialVersion || "Live source"}
                    {source.effectiveFrom
                      ? ` | Effective ${source.effectiveFrom}`
                      : ""}
                  </p>
                  <small>
                    {readable(source.hashStatus)} |{" "}
                    {readable(source.verificationStatus)}
                  </small>
                  <code>{shortHash(source.officialSourceSha256)}</code>
                </div>
                <a
                  href={source.officialSourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open official source
                </a>
              </article>
              ))}
          </div>
        </section>
      )}

      {panel === "lookups" && (
        <section className={styles.dataPanel}>
          <div className={styles.sectionHeading}>
            <span>PRIORITY 02</span>
            <h3>Controlled operational lookup values</h3>
            <p>
              Every operator choice is a controlled dropdown. Live regulator
              and licence sources are disabled, so no job can be marked
              verified from a local assertion.
            </p>
          </div>
          <section className={styles.sourcePackSummary}>
            <article>
              <span>Governance bridge</span>
              <strong>Append-only</strong>
            </article>
            <article>
              <span>Recorded decisions</span>
              <strong>
                {foundationReadiness.loading === "lookups"
                  ? "Loading"
                  : foundationReadiness.lookupDecisions?.length || 0}
              </strong>
            </article>
            <article>
              <span>Approval entries</span>
              <strong>
                {foundationReadiness.lookupDecisions?.filter(
                  (decision) => decision.decision === "approved",
                ).length || 0}
              </strong>
            </article>
            <article>
              <span>Eligibility activation</span>
              <strong>Blocked by default</strong>
            </article>
          </section>
          {foundationReadiness.error && panel === "lookups" && (
            <p className={styles.error}>{foundationReadiness.error}</p>
          )}
          <div className={styles.controlGrid}>
            {Object.entries(snapshot.controls || {}).map(
              ([controlType, options]) => (
                <article key={controlType}>
                  <h4>{readable(controlType)}</h4>
                  <select aria-label={readable(controlType)} defaultValue="">
                    <option value="">Choose a controlled value</option>
                    {options.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <small>
                    Live lookup:{" "}
                    {options.some((option) => option.liveLookupEnabled)
                      ? "Enabled"
                      : "Blocked pending authorised source"}
                  </small>
                </article>
              ),
            )}
          </div>
        </section>
      )}

      {panel === "evidence" && (
        <section className={`${styles.dataPanel} ${styles.manualEvidencePanel}`}>
          <section className={styles.custodyLedgerPanel}>
            <div className={styles.sectionHeading}>
              <span>PHYSICAL CUSTODY ACCEPTANCE</span>
              <h3>Original evidence transport boundary</h3>
              <p>
                Physical-device runs prove whether original bytes, metadata,
                GPS and custody survive the field path. The editable manual
                forms below configure synthetic installer testing; they do not
                replace this independent acceptance ledger.
              </p>
            </div>
            <section className={styles.sourcePackSummary}>
              <article>
                <span>Acceptance ledger</span>
                <strong>Available</strong>
              </article>
              <article>
                <span>Recorded physical runs</span>
                <strong>
                  {foundationReadiness.loading === "evidence"
                    ? "Loading"
                    : foundationReadiness.fieldAcceptances?.length || 0}
                </strong>
              </article>
              <article>
                <span>Passed custody runs</span>
                <strong>
                  {foundationReadiness.fieldAcceptances?.filter(
                    (acceptance) => (
                      acceptance.status === "passed"
                      && acceptance.physicalCustodyAccepted
                    ),
                  ).length || 0}
                </strong>
              </article>
              <article>
                <span>Unrecorded result</span>
                <strong>Never treated as passed</strong>
              </article>
            </section>
            {foundationReadiness.error && (
              <p className={styles.error}>{foundationReadiness.error}</p>
            )}
            <details>
              <summary>View physical capture test contract</summary>
              <div className={styles.evidenceGrid}>
                {(snapshot.evidenceContracts || []).map((requirement) => (
                  <article key={requirement.requirementCode}>
                    <span>{readable(requirement.captureTiming)}</span>
                    <h4>{requirement.title}</h4>
                    <p>
                      {readable(requirement.evidenceKind)} |{" "}
                      {requirement.minimumCount} to{" "}
                      {requirement.maximumCount} files
                    </p>
                    <ul>
                      <li>
                        Original bytes:{" "}
                        {requirement.originalRequired
                          ? "Required"
                          : "Not required"}
                      </li>
                      <li>
                        Metadata:{" "}
                        {requirement.metadataRequired
                          ? "Required"
                          : "Not required"}
                      </li>
                      <li>
                        GPS: {requirement.gpsRequired
                          ? "Required"
                          : "Not required"}
                      </li>
                    </ul>
                    <small>
                      Government status:{" "}
                      {readable(requirement.governmentRequirementStatus)}
                    </small>
                  </article>
                ))}
              </div>
            </details>
          </section>
          <CreditexManualEvidenceLab api={api} role={role} />
        </section>
      )}

      {panel === "calculators" && (
        <section className={styles.dataPanel}>
          <div className={styles.sectionHeading}>
            <span>PRIORITY 04</span>
            <h3>National certificate calculation workspace</h3>
            <p>
              Every controlled activity has one explicit calculation path.
              STC estimates are available for the supported SRES technologies;
              VEU, NSW and other schemes stay blocked wherever an effective
              rule, lookup or independently approved formula is unresolved.
            </p>
          </div>
          <section className={styles.calculatorSummary}>
            <article>
              <span>Programs covered</span>
              <strong>
                {calculationReadiness?.coverage.programs
                  ?? GOVERNMENT_PROGRAM_TEMPLATES.length}
              </strong>
            </article>
            <article>
              <span>Activity templates</span>
              <strong>
                {calculationReadiness?.coverage.activities
                  ?? GOVERNMENT_ACTIVITY_CALCULATION_METHODS.length}
              </strong>
            </article>
            <article>
              <span>Executable estimates</span>
              <strong>
                {calculationReadiness?.coverage.estimateExecutable
                  ?? GOVERNMENT_CALCULATION_METHOD_SUMMARY.find(
                    (summary) => summary.state === "estimate_available",
                  )?.count
                  ?? 0}
              </strong>
            </article>
            <article>
              <span>Blocked or non-executable</span>
              <strong>
                {calculationReadiness?.coverage.blockedOrNonExecutable
                  ?? "Checking"}
              </strong>
            </article>
            <article>
              <span>Certificate actions</span>
              <strong>
                {calculationReadiness?.coverage.certificateActionsEnabled
                  ?? 0} enabled
              </strong>
            </article>
          </section>
          {readinessError && (
            <p className={styles.error}>{readinessError}</p>
          )}
          {calculationReadiness && (
            <section className={styles.readinessLedger}>
              <div>
                <span>COVERAGE REGRESSION</span>
                <strong>
                  All {calculationReadiness.coverage.activities} templates
                  deterministically accounted for
                </strong>
                <code>{calculationReadiness.coverage.coverageSha256}</code>
              </div>
              <div>
                {calculationReadiness.coverage.stateCounts.map((state) => (
                  <span key={state.state}>
                    {readable(state.state)} <b>{state.count}</b>
                  </span>
                ))}
              </div>
            </section>
          )}

          <div className={styles.calculationWorkspace}>
            <section
              className={styles.stcEstimator}
              aria-labelledby="stc-estimator-title"
            >
              <header>
                <div>
                  <span>SRES | DETERMINISTIC ESTIMATE</span>
                  <h4 id="stc-estimator-title">Estimate STCs</h4>
                  <p>
                    Controlled 2026 to 2030 arithmetic with exact decimal inputs,
                    a complete trace and final whole-certificate rounding.
                  </p>
                </div>
                <strong>REC Registry check required</strong>
              </header>
              <form
                className={styles.estimatorForm}
                onSubmit={calculateStcEstimate}
              >
                <label>
                  Technology
                  <select
                    value={stcEstimateForm.technology}
                    onChange={(event) => {
                      const technology =
                        event.target.value as StcEstimateForm["technology"];
                      setStcEstimate(null);
                      setStcEstimateError("");
                      setStcEstimateForm((current) => ({
                        ...current,
                        technology,
                        resourceAvailability: "default",
                        resourceHoursPerYear:
                          technology === "small_hydro"
                            ? "4001"
                            : technology === "small_wind"
                              ? "2001"
                              : current.resourceHoursPerYear,
                        deemingYears: stcMaximumDeemingYears,
                      }));
                    }}
                  >
                    <option value="solar_pv">Small-scale solar PV</option>
                    <option value="small_wind">Small wind system</option>
                    <option value="small_hydro">Small hydro system</option>
                    <option value="solar_water_heater">
                      Registered solar water heater
                    </option>
                    <option value="air_source_heat_pump">
                      Registered air-source heat pump
                    </option>
                    <option value="solar_battery">
                      Eligible new solar battery
                    </option>
                  </select>
                </label>
                <label>
                  {stcEstimateForm.technology === "solar_battery"
                    ? "Safety certification date"
                    : "Installation date"}
                  <input
                    type="date"
                    min="2026-01-01"
                    max="2030-12-31"
                    required
                    value={stcEstimateForm.effectiveDate}
                    onChange={(event) =>
                      setStcEstimateForm((current) => ({
                        ...current,
                        effectiveDate: event.target.value,
                        deemingYears: String(
                          Math.min(
                            5,
                            Math.max(
                              1,
                              2031
                                - Number(
                                  event.target.value.slice(0, 4) || 2030,
                                ),
                            ),
                          ),
                        ),
                      }))}
                  />
                </label>

                {stcEstimateForm.technology === "solar_battery" ? (
                  <>
                    <label>
                      Claim scope
                      <select value="new_system" disabled>
                        <option value="new_system">
                          New eligible battery system
                        </option>
                      </select>
                    </label>
                    <label>
                      Nominal capacity (kWh)
                      <input
                        inputMode="decimal"
                        required
                        value={stcEstimateForm.nominalCapacityKwh}
                        onChange={(event) =>
                          setStcEstimateForm((current) => ({
                            ...current,
                            nominalCapacityKwh: event.target.value,
                          }))}
                      />
                    </label>
                    <label>
                      Usable capacity (kWh)
                      <input
                        inputMode="decimal"
                        required
                        value={stcEstimateForm.usableCapacityKwh}
                        onChange={(event) =>
                          setStcEstimateForm((current) => ({
                            ...current,
                            usableCapacityKwh: event.target.value,
                          }))}
                      />
                    </label>
                  </>
                ) : stcEstimateForm.technology === "solar_water_heater"
                    || stcEstimateForm.technology
                      === "air_source_heat_pump" ? (
                  <label>
                    Current register 10-year STCs
                    <input
                      inputMode="numeric"
                      required
                      value={stcEstimateForm.registeredTenYearStcs}
                      onChange={(event) =>
                        setStcEstimateForm((current) => ({
                          ...current,
                          registeredTenYearStcs: event.target.value,
                        }))}
                    />
                    <small>
                      Use the value for the exact model and zone in the current
                      CER register.
                    </small>
                  </label>
                ) : stcEstimateForm.technology === "small_wind"
                    || stcEstimateForm.technology === "small_hydro" ? (
                  <>
                    <label>
                      Rated capacity (kW)
                      <input
                        inputMode="decimal"
                        required
                        value={stcEstimateForm.ratedCapacityKw}
                        onChange={(event) =>
                          setStcEstimateForm((current) => ({
                            ...current,
                            ratedCapacityKw: event.target.value,
                          }))}
                      />
                      <small>
                        Maximum 10 kW for wind or 6.4 kW for hydro.
                      </small>
                    </label>
                    <label>
                      Resource availability
                      <select
                        value={stcEstimateForm.resourceAvailability}
                        onChange={(event) =>
                          setStcEstimateForm((current) => ({
                            ...current,
                            resourceAvailability:
                              event.target
                                .value as StcEstimateForm["resourceAvailability"],
                          }))}
                      >
                        <option value="default">
                          Government default |{" "}
                          {stcEstimateForm.technology === "small_wind"
                            ? "2,000"
                            : "4,000"}{" "}
                          hours
                        </option>
                        <option value="site_assessed">
                          Site-assessed hours | audit required
                        </option>
                      </select>
                    </label>
                    {stcEstimateForm.resourceAvailability
                      === "site_assessed" && (
                      <label>
                        Assessed hours per year
                        <input
                          inputMode="numeric"
                          required
                          value={stcEstimateForm.resourceHoursPerYear}
                          onChange={(event) =>
                            setStcEstimateForm((current) => ({
                              ...current,
                              resourceHoursPerYear: event.target.value,
                            }))}
                        />
                        <small>
                          Must exceed the government default and retain the
                          required site-specific audit.
                        </small>
                      </label>
                    )}
                    <label>
                      Certificate period
                      <select
                        value={stcEstimateForm.deemingYears}
                        onChange={(event) =>
                          setStcEstimateForm((current) => ({
                            ...current,
                            deemingYears: event.target.value,
                          }))}
                      >
                        <option value="1">1 year</option>
                        {stcMaximumDeemingYears !== "1" && (
                          <option value={stcMaximumDeemingYears}>
                            {stcMaximumDeemingYears} years | maximum
                          </option>
                        )}
                      </select>
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      Rated capacity (kW)
                      <input
                        inputMode="decimal"
                        required
                        value={stcEstimateForm.ratedCapacityKw}
                        onChange={(event) =>
                          setStcEstimateForm((current) => ({
                            ...current,
                            ratedCapacityKw: event.target.value,
                          }))}
                      />
                    </label>
                    <label>
                      Official postcode zone rating
                      <select
                        value={stcEstimateForm.zoneRating}
                        onChange={(event) =>
                          setStcEstimateForm((current) => ({
                            ...current,
                            zoneRating:
                              event.target.value as StcEstimateForm["zoneRating"],
                          }))}
                      >
                        <option value="1.622">Zone 1 | 1.622</option>
                        <option value="1.536">Zone 2 | 1.536</option>
                        <option value="1.382">Zone 3 | 1.382</option>
                        <option value="1.185">Zone 4 | 1.185</option>
                      </select>
                    </label>
                  </>
                )}
                <button type="submit" disabled={stcEstimateBusy}>
                  {stcEstimateBusy ? "Calculating..." : "Calculate estimate"}
                </button>
              </form>
              {stcEstimateError && (
                <p className={styles.error}>{stcEstimateError}</p>
              )}
              {stcEstimate && (
                <section
                  className={styles.estimateResult}
                  aria-live="polite"
                >
                  <header>
                    <div>
                      <span>Estimated quantity</span>
                      <strong>
                        {stcEstimate.output.quantity}{" "}
                        {stcEstimate.output.unit}
                      </strong>
                    </div>
                    <b>Estimate only</b>
                  </header>
                  <ol>
                    {stcEstimate.trace.map((step) => (
                      <li key={step.key}>
                        <div>
                          <strong>{step.label}</strong>
                          <span>{step.operation}</span>
                        </div>
                        <b>{step.output} {step.unit}</b>
                      </li>
                    ))}
                  </ol>
                  <p>{stcEstimate.operatorMessage}</p>
                  <footer>
                    <a
                      href={stcEstimate.officialSourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open official source
                    </a>
                    <code title={stcEstimate.receiptHash}>
                      Receipt {stcEstimate.receiptHash.slice(0, 22)}...
                    </code>
                  </footer>
                </section>
              )}
            </section>

            <section
              className={styles.methodBrowser}
              aria-labelledby="calculation-method-title"
            >
              <header>
                <div>
                  <span>ALL AUSTRALIAN PATHWAYS</span>
                  <h4 id="calculation-method-title">
                    Activity calculation readiness
                  </h4>
                </div>
                <label>
                  Program
                  <select
                    value={calculationProgramCode}
                    onChange={(event) =>
                      setCalculationProgramCode(event.target.value)}
                  >
                    {GOVERNMENT_PROGRAM_TEMPLATES.map((program) => (
                      <option
                        key={program.programCode}
                        value={program.programCode}
                      >
                        {program.jurisdiction} | {program.programCode} |{" "}
                        {program.name}
                      </option>
                    ))}
                  </select>
                </label>
              </header>
              {selectedCalculationWindows.length > 0 && (
                <div className={styles.sourceWindows}>
                  {selectedCalculationWindows.map((window) => (
                    <article key={window.sourceKey}>
                      <div>
                        <strong>{window.version}</strong>
                        <span>
                          {window.effectiveFrom}
                          {window.effectiveTo
                            ? ` to ${window.effectiveTo}`
                            : " onward"}
                        </span>
                      </div>
                      <p>{window.scope}</p>
                      <a
                        href={window.officialSourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Source
                      </a>
                    </article>
                  ))}
                </div>
              )}
              <div className={styles.methodRows}>
                {selectedCalculationMethods.map((method) => (
                  <article key={method.activityTemplateId}>
                    <strong>{method.registryActivityCode}</strong>
                    <div>
                      <span>{method.activityTitle}</span>
                      <small>
                        {readable(method.catalogueState)} activity.{" "}
                        {method.operatorMessage}
                      </small>
                    </div>
                    <b data-state={method.state}>
                      {readable(method.state)}
                    </b>
                    <em>{method.unit === "none" ? "No certificate" : method.unit}</em>
                  </article>
                ))}
              </div>
              <p className={styles.calculationBoundary}>
                No public national calculation API exists. TLink uses
                effective-dated government sources and deterministic local
                estimates, then reconciles through each authorised registry,
                calculator or submission channel.
              </p>
            </section>
          </div>
        </section>
      )}

      {panel === "connectors" && (
        <section className={styles.dataPanel}>
          <div className={styles.sectionHeading}>
            <span>PRIORITY 05</span>
            <h3>Registry dry-run and legacy cutover boundary</h3>
            <p>
              The pilot produces a deterministic 300-item manifest and
              validates its structure against its own source cohort. It records
              zero regulator acceptances because no regulator request is sent,
              and no staged Dataforce or Runabout row can create a customer,
              job, regulated case, certificate, submission, trade or
              settlement.
            </p>
          </div>
          {readinessError && (
            <p className={styles.error}>{readinessError}</p>
          )}
          {interchangeReadiness && (
            <>
              <section className={styles.calculatorSummary}>
                <article>
                  <span>Blocked adapter descriptors</span>
                  <strong>{interchangeReadiness.counts.adapters}</strong>
                </article>
                <article>
                  <span>Ready</span>
                  <strong>{interchangeReadiness.counts.ready}</strong>
                </article>
                <article>
                  <span>Blocked safely</span>
                  <strong>{interchangeReadiness.counts.blocked}</strong>
                </article>
                <article>
                  <span>Serializers available</span>
                  <strong>
                    {interchangeReadiness.counts.serializersAvailable}
                  </strong>
                </article>
                <article>
                  <span>External sends</span>
                  <strong>
                    {interchangeReadiness.counts.externalSubmissionEnabled}
                  </strong>
                </article>
              </section>
              <section className={styles.interchangeAdapters}>
                {interchangeReadiness.adapters.map((adapter) => (
                  <article key={adapter.adapterKey}>
                    <header>
                      <div>
                        <span>{adapter.programCode}</span>
                        <h4>
                          {adapter.scheme || adapter.kind
                            ? `${adapter.scheme || adapter.kind} | `
                            : ""}
                          {readable(adapter.pathway)}
                        </h4>
                      </div>
                      <b>Blocked</b>
                    </header>
                    <p>{adapter.blockReason}</p>
                    <dl>
                      <div>
                        <dt>Descriptor</dt>
                        <dd>{adapter.adapterKey}</dd>
                      </div>
                      <div>
                        <dt>Schema</dt>
                        <dd>{readable(adapter.schemaState)}</dd>
                      </div>
                      <div>
                        <dt>Serializer</dt>
                        <dd>Unavailable</dd>
                      </div>
                      <div>
                        <dt>External send</dt>
                        <dd>Disabled</dd>
                      </div>
                    </dl>
                    {(adapter.officialSourceUrl
                      || adapter.publicRegistryUrl) && (
                      <a
                        href={
                          adapter.officialSourceUrl
                          || adapter.publicRegistryUrl
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open official source
                      </a>
                    )}
                  </article>
                ))}
              </section>
            </>
          )}
          <div className={styles.connectorGrid}>
            {(snapshot.connectors || []).map((connector) => (
              <article key={`${connector.connectorCode}:${connector.mappingVersion}`}>
                <span>{readable(connector.mode)}</span>
                <h4>{connector.connectorCode}</h4>
                <p>
                  {connector.itemCount} items |{" "}
                  {connector.acceptedCount} regulator acceptances |{" "}
                  {connector.rejectedCount} rejected |{" "}
                  {connector.unmatchedCount} unmatched
                </p>
                <code>{connector.artifactSha256}</code>
                <strong>
                  External submission:{" "}
                  {connector.externalSubmissionEnabled
                    ? "Enabled"
                    : "Blocked"}
                </strong>
              </article>
            ))}
            {!snapshot.connectors?.length && (
              <p className={styles.empty}>
                The connector dry-run appears after all 300 jobs validate.
              </p>
            )}
          </div>
          {selectedSubmissionRoute && (
            <section className={styles.submissionRoute}>
              <header>
                <div>
                  <span>NATIONAL CHANNEL MAP</span>
                  <h4>Controlled submission boundary</h4>
                  <p>
                    Every program has an explicit transport or administrative
                    route. None can submit externally from this pilot.
                  </p>
                </div>
                <label>
                  Program
                  <select
                    value={calculationProgramCode}
                    onChange={(event) =>
                      setCalculationProgramCode(event.target.value)}
                  >
                    {GOVERNMENT_PROGRAM_TEMPLATES.map((program) => (
                      <option
                        key={program.programCode}
                        value={program.programCode}
                      >
                        {program.programCode} | {program.name}
                      </option>
                    ))}
                  </select>
                </label>
              </header>
              <article>
                <div>
                  <span>{selectedSubmissionRoute.programCode}</span>
                  <strong>{selectedSubmissionRoute.programName}</strong>
                </div>
                <div>
                  <span>Channel</span>
                  <strong>{selectedSubmissionRoute.channel}</strong>
                </div>
                <div>
                  <span>Adapter boundary</span>
                  <strong>
                    {readable(selectedSubmissionRoute.adapterBoundary)}
                  </strong>
                </div>
                <div>
                  <span>Contract state</span>
                  <strong>
                    {readable(selectedSubmissionRoute.routeState)}
                  </strong>
                </div>
                <p>{selectedSubmissionRoute.operatorMessage}</p>
                <b>External submission blocked</b>
              </article>
            </section>
          )}
          <div className={styles.cutoverGrid}>
            <article>
              <span>DATAFORCE</span>
              <h4>Exact staged-row binding available</h4>
              <p>
                Dry runs can derive certificate quantity from an exact,
                hash-checked staged Dataforce row. An independently approved
                mapping is required and the result remains non-evidentiary.
              </p>
            </article>
            <article>
              <span>RUNABOUT</span>
              <h4>Capture contract required</h4>
              <p>
                Authorised export, device behaviour, offline rules, evidence
                mapping and representative physical-device acceptance are
                still required.
              </p>
            </article>
            <article>
              <span>REGISTRY</span>
              <h4>External transport remains blocked</h4>
              <p>
                No certificate creation, submission, trade or settlement is
                enabled until a written registry contract and accepted sandbox
                result exist.
              </p>
            </article>
          </div>
        </section>
      )}

      </div>
    </section>
  );
}
