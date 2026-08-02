"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CreditexVeuJobAuditWorkspace,
  type CreditexJobAuditDetail,
  type JobWorkspaceSection,
} from "./CreditexVeuJobAuditWorkspace";
import {
  exportDataforceJobCsv,
  projectCreditexJobToDataforceRecord,
  validateDataforceJobCsv,
  type DataforceJobCsvValidation,
} from "@/lib/creditex-dataforce-job-csv";
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

const PILOT_SORT_KEYS = [
  "appointmentId",
  "jobNumber",
  "caseNumber",
  "reviewStatus",
  "evidenceStatus",
  "workType",
  "scheduledStart",
  "scheduledEnd",
  "connectorStatus",
  "activityDate",
  "technician",
  "technicianCode",
  "installer",
  "installerCode",
  "customer",
  "companyName",
  "customerNumber",
  "phone",
  "email",
  "address",
  "suburb",
  "state",
  "postcode",
  "registryActivityCode",
  "specificationPart",
  "activityTitle",
  "serviceCategory",
  "productCategory",
  "scenario",
  "ruleStatus",
  "lookupStatus",
  "calculatorStatus",
  "workStage",
  "priority",
  "appointmentType",
  "appointmentStatus",
  "pipelineStage",
  "quoteStatus",
  "invoiceStatus",
  "createdAt",
  "updatedAt",
] as const;
type PilotSortKey = typeof PILOT_SORT_KEYS[number];

type PilotColumn = {
  key: string;
  label: string;
  sortKey?: PilotSortKey;
  description?: string;
};

const PILOT_JOB_COLUMNS: readonly PilotColumn[] = [
  { key: "actions", label: "Row" },
  { key: "appointmentId", label: "App Id", sortKey: "appointmentId" },
  { key: "jobNumber", label: "Job Id", sortKey: "jobNumber" },
  { key: "reviewStatus", label: "Status", sortKey: "reviewStatus" },
  {
    key: "legacySubStatus",
    label: "SubStatus",
    description: "Dataforce SubStatus semantics are not yet mapped.",
  },
  {
    key: "legacyType",
    label: "Type",
    description: "Dataforce Type semantics are not yet mapped.",
  },
  { key: "workType", label: "Work Type", sortKey: "workType" },
  {
    key: "scheduledStart",
    label: "Scheduled Datetime",
    sortKey: "scheduledStart",
  },
  {
    key: "legacyBalance",
    label: "Balance",
    description: "Dataforce Balance semantics require a field dictionary.",
  },
  {
    key: "certificates",
    label: "Certificates (VEECs)",
    description: "Only regulator-issued quantities may appear here.",
  },
  { key: "connectorStatus", label: "Submission", sortKey: "connectorStatus" },
  { key: "invoiceStatus", label: "Invoiced", sortKey: "invoiceStatus" },
  { key: "technician", label: "Field Worker", sortKey: "technician" },
  {
    key: "agent",
    label: "Agent",
    description: "No authoritative pilot agent relationship is stored.",
  },
  {
    key: "client",
    label: "Client",
    description: "No authoritative pilot client relationship is stored.",
  },
  { key: "customer", label: "Customer", sortKey: "customer" },
  { key: "companyName", label: "Company Name", sortKey: "companyName" },
  {
    key: "customerNumber",
    label: "Ext Cust Ref",
    sortKey: "customerNumber",
    description: "TLink customer number is shown; legacy equivalence is pending.",
  },
  { key: "phone", label: "Phone", sortKey: "phone" },
  {
    key: "mobile",
    label: "Mobile",
    description: "TLink does not yet store a separate mobile field.",
  },
  { key: "email", label: "Email", sortKey: "email" },
  { key: "address", label: "Address", sortKey: "address" },
  { key: "suburb", label: "Suburb", sortKey: "suburb" },
  { key: "postcode", label: "Postcode", sortKey: "postcode" },
  {
    key: "technicianCode",
    label: "Field Worker Code",
    sortKey: "technicianCode",
  },
  { key: "installer", label: "TLink Installer", sortKey: "installer" },
  {
    key: "installerCode",
    label: "Installer Code",
    sortKey: "installerCode",
  },
  { key: "caseNumber", label: "TLink Case", sortKey: "caseNumber" },
  { key: "state", label: "State", sortKey: "state" },
  {
    key: "registryActivityCode",
    label: "VEU Activity",
    sortKey: "registryActivityCode",
  },
  {
    key: "specificationPart",
    label: "Specification Part",
    sortKey: "specificationPart",
  },
  { key: "activityTitle", label: "Activity Title", sortKey: "activityTitle" },
  {
    key: "serviceCategory",
    label: "Service Category",
    sortKey: "serviceCategory",
  },
  {
    key: "productCategory",
    label: "Product Category",
    sortKey: "productCategory",
  },
  { key: "scenario", label: "Scenario", sortKey: "scenario" },
  { key: "activityDate", label: "Activity Date", sortKey: "activityDate" },
  { key: "ruleStatus", label: "Rules", sortKey: "ruleStatus" },
  { key: "lookupStatus", label: "Lookups", sortKey: "lookupStatus" },
  { key: "evidenceStatus", label: "Evidence", sortKey: "evidenceStatus" },
  {
    key: "calculatorStatus",
    label: "Calculator",
    sortKey: "calculatorStatus",
  },
  { key: "workStage", label: "Job Stage", sortKey: "workStage" },
  { key: "priority", label: "Priority", sortKey: "priority" },
  {
    key: "appointmentType",
    label: "Appointment Type",
    sortKey: "appointmentType",
  },
  {
    key: "appointmentStatus",
    label: "Appointment Status",
    sortKey: "appointmentStatus",
  },
  {
    key: "pipelineStage",
    label: "Pipeline Stage",
    sortKey: "pipelineStage",
  },
  { key: "quoteStatus", label: "Quote Status", sortKey: "quoteStatus" },
  { key: "recordMode", label: "Record Mode" },
  { key: "createdAt", label: "Created", sortKey: "createdAt" },
  { key: "updatedAt", label: "Updated", sortKey: "updatedAt" },
] as const;

type Filters = {
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
  dateField: "activityDate" | "scheduledStart" | "createdAt" | "updatedAt";
  dateFrom: string;
  dateTo: string;
  sortBy: PilotSortKey;
  sortDirection: "asc" | "desc";
  query: string;
  page: number;
  pageSize: 25 | 50 | 100 | 300;
};

const EMPTY_FILTERS: Filters = {
  installerId: "",
  technicianId: "",
  activityTemplateId: "",
  reviewStatus: "",
  evidenceStatus: "",
  lookupStatus: "",
  ruleStatus: "",
  calculatorStatus: "",
  connectorStatus: "",
  workStage: "",
  workType: "",
  priority: "",
  appointmentType: "",
  appointmentStatus: "",
  customerType: "",
  serviceCategory: "",
  productCategory: "",
  postcode: "",
  tag: "",
  dateField: "activityDate",
  dateFrom: "",
  dateTo: "",
  sortBy: "jobNumber",
  sortDirection: "asc",
  query: "",
  page: 0,
  pageSize: 300,
};

function activeFilterCount(filters: Filters) {
  const ignored = new Set([
    "dateField",
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
  onSort: (sortBy: PilotSortKey, sortDirection: "asc" | "desc") => void;
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
              ? "⌄"
              : state === "ascending"
              ? "▲"
              : state === "descending"
              ? "▼"
              : "↕"}
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
                    onSort("jobNumber", "asc");
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

const PILOT_STATUS_COLUMN_KEYS = new Set([
  "reviewStatus",
  "connectorStatus",
  "ruleStatus",
  "lookupStatus",
  "evidenceStatus",
  "calculatorStatus",
  "workStage",
  "appointmentStatus",
]);
const PILOT_MAPPING_COLUMN_KEYS = new Set([
  "legacySubStatus",
  "legacyType",
  "legacyBalance",
  "certificates",
  "agent",
  "client",
  "mobile",
]);

function pilotJobCellValue(columnKey: string, job: PilotJob) {
  switch (columnKey) {
    case "appointmentId":
      return present(job.appointment.id);
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

function PilotJobCell({
  column,
  job,
  onOpen,
  onOpenMenu,
}: {
  column: PilotColumn;
  job: PilotJob;
  onOpen: (button: HTMLButtonElement) => void;
  onOpenMenu: (button: HTMLButtonElement) => void;
}) {
  if (column.key === "actions") {
    return (
      <button
        className={styles.rowActionButton}
        type="button"
        aria-label={`Open actions for ${job.jobNumber}`}
        aria-haspopup="menu"
        onClick={(event) => onOpenMenu(event.currentTarget)}
      >
        ⋮
      </button>
    );
  }
  if (column.key === "jobNumber") {
    return (
      <button
        className={styles.jobLink}
        type="button"
        onClick={(event) => onOpen(event.currentTarget)}
      >
        {job.jobNumber}
      </button>
    );
  }
  const value = pilotJobCellValue(column.key, job);
  const statusTone =
    /blocked|not checked|not started|not staged|dry run/i.test(value)
      ? "blocked"
      : /changes required|in review|in progress/i.test(value)
      ? "attention"
      : /verified|complete|reconciled/i.test(value)
      ? "ready"
      : "neutral";
  return (
    <span
      className={
        PILOT_STATUS_COLUMN_KEYS.has(column.key)
          ? styles.statusCell
          : PILOT_MAPPING_COLUMN_KEYS.has(column.key)
          ? styles.mappingCell
          : undefined
      }
      data-tone={
        PILOT_STATUS_COLUMN_KEYS.has(column.key) ? statusTone : undefined
      }
      title={value}
    >
      {value}
    </span>
  );
}

function PilotJobContextMenu({
  state,
  job,
  onOpen,
  onCopyRow,
  onPrint,
  onClose,
}: {
  state: ContextMenuState;
  job: PilotJob;
  onOpen: (section: JobWorkspaceSection) => void;
  onCopyRow: () => void;
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
          Job <span aria-hidden="true">›</span>
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
          Appointment <span aria-hidden="true">›</span>
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
        disabled
        aria-disabled="true"
        title="Copy Selection is unavailable until a cell range is selected."
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

function AdvancedPilotFilters({
  snapshot,
  filters,
  technicians,
  busy,
  onChange,
  onApply,
  onClear,
  onClose,
}: {
  snapshot: PilotSnapshot;
  filters: Filters;
  technicians: NonNullable<PilotSnapshot["technicians"]>;
  busy: boolean;
  onChange: (next: Partial<Filters>) => void;
  onApply: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const drawerRef = useRef<HTMLElement>(null);

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

    function keepFocusInside(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const current = Array.from(
        drawerElement.querySelectorAll<HTMLElement>(focusableSelector),
      );
      if (!current.length) {
        event.preventDefault();
        return;
      }
      const first = current[0];
      const last = current[current.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    drawerElement.addEventListener("keydown", keepFocusInside);
    return () => {
      window.clearTimeout(focusHandle);
      drawerElement.removeEventListener("keydown", keepFocusInside);
    };
  }, []);

  return (
    <aside
      ref={drawerRef}
      className={styles.advancedFilters}
      role="dialog"
      aria-modal="true"
      aria-labelledby="creditex-advanced-filters-title"
      tabIndex={-1}
    >
      <header>
        <div>
          <span>ADVANCED SEARCH</span>
          <h3 id="creditex-advanced-filters-title">All VEU jobs</h3>
        </div>
        <button
          className={styles.closeFilters}
          type="button"
          onClick={onClose}
          aria-label="Close advanced filters"
        >
          ×
        </button>
      </header>

      <p className={styles.filterBoundary}>
        Jobs only. Regulated bulk actions remain blocked for test records.
      </p>

      <section
        className={styles.quickFilters}
        aria-labelledby="creditex-quick-filters-title"
      >
        <div className={styles.quickFilterHeading}>
          <strong id="creditex-quick-filters-title">Quick filters</strong>
          <small>Filter this job register without leaving the workspace.</small>
        </div>
        <label className={styles.quickFilterWide}>
          Search jobs
          <input
            type="search"
            value={filters.query}
            placeholder="Job, customer, address or activity"
            onChange={(event) => onChange({ query: event.target.value })}
          />
        </label>
        <label className={styles.quickFilterWide}>
          Installer company
          <select
            value={filters.installerId}
            onChange={(event) =>
              onChange({
                installerId: event.target.value,
                technicianId: "",
              })}
          >
            <option value="">All test installers</option>
            {(snapshot.installers || []).map((installer) => (
              <option key={installer.id} value={installer.id}>
                {installer.companyCode} | {installer.businessName}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.quickFilterWide}>
          VEU activity
          <select
            value={filters.activityTemplateId}
            onChange={(event) =>
              onChange({ activityTemplateId: event.target.value })}
          >
            <option value="">All activity families</option>
            {(snapshot.activities || []).map((activity) => (
              <option
                key={activity.activityTemplateId}
                value={activity.activityTemplateId}
              >
                {activity.registryActivityCode} | {activity.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Review
          <select
            value={filters.reviewStatus}
            onChange={(event) => onChange({ reviewStatus: event.target.value })}
          >
            <option value="">All review states</option>
            {snapshot.filters.reviewStatuses.map((option) => (
              <option key={option} value={option}>{readable(option)}</option>
            ))}
          </select>
        </label>
        <label>
          Evidence
          <select
            value={filters.evidenceStatus}
            onChange={(event) =>
              onChange({ evidenceStatus: event.target.value })}
          >
            <option value="">All evidence states</option>
            {snapshot.filters.evidenceStatuses.map((option) => (
              <option key={option} value={option}>{readable(option)}</option>
            ))}
          </select>
        </label>
      </section>

      <details>
        <summary>Date filters</summary>
        <div>
          <label>
            Date field
            <select
              value={filters.dateField}
              onChange={(event) =>
                onChange({
                  dateField: event.target.value as Filters["dateField"],
                })}
            >
              <option value="activityDate">Activity date</option>
              <option value="scheduledStart">Scheduled date</option>
              <option value="createdAt">Created date</option>
              <option value="updatedAt">Updated date</option>
            </select>
          </label>
          <label>
            From
            <input
              type="date"
              value={filters.dateFrom}
              data-date-range-group="creditex-veu-pilot-jobs"
              data-date-range-role="start"
              onChange={(event) => onChange({ dateFrom: event.target.value })}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={filters.dateTo}
              data-date-range-group="creditex-veu-pilot-jobs"
              data-date-range-role="end"
              onChange={(event) => onChange({ dateTo: event.target.value })}
            />
          </label>
        </div>
      </details>

      <details>
        <summary>Status filters</summary>
        <div>
          {[
            ["lookupStatus", "Lookup", snapshot.filters.lookupStatuses],
            ["ruleStatus", "Rules", snapshot.filters.ruleStatuses],
            [
              "calculatorStatus",
              "Calculator",
              snapshot.filters.calculatorStatuses,
            ],
            [
              "connectorStatus",
              "Submission",
              snapshot.filters.connectorStatuses,
            ],
          ].map(([key, label, options]) => (
            <label key={String(key)}>
              {String(label)}
              <select
                value={String(filters[key as keyof Filters] || "")}
                onChange={(event) =>
                  onChange({
                    [String(key)]: event.target.value,
                  } as Partial<Filters>)}
              >
                <option value="">All {String(label).toLowerCase()} states</option>
                {(options as string[]).map((option) => (
                  <option key={option} value={option}>{readable(option)}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </details>

      <details>
        <summary>Work &amp; personnel</summary>
        <div>
          <label>
            Work type
            <select
              value={filters.workType}
              onChange={(event) => onChange({ workType: event.target.value })}
            >
              <option value="">All work types</option>
              {snapshot.filters.workTypes.map((option) => (
                <option key={option} value={option}>{readable(option)}</option>
              ))}
            </select>
          </label>
          <label>
            Service category
            <select
              value={filters.serviceCategory}
              onChange={(event) =>
                onChange({ serviceCategory: event.target.value })}
            >
              <option value="">All service categories</option>
              {snapshot.filters.serviceCategories.map((option) => (
                <option key={option} value={option}>{readable(option)}</option>
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
              <option value="">All test technicians</option>
              {technicians.map((technician) => (
                <option key={technician.id} value={technician.id}>
                  {technician.technicianCode} | {technician.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select
              value={filters.priority}
              onChange={(event) => onChange({ priority: event.target.value })}
            >
              <option value="">All priorities</option>
              {snapshot.filters.priorities.map((option) => (
                <option key={option} value={option}>{readable(option)}</option>
              ))}
            </select>
          </label>
        </div>
      </details>

      <details>
        <summary>Client &amp; agent</summary>
        <div>
          <label>
            Client
            <select value="" disabled>
              <option value="">Mapping required</option>
            </select>
          </label>
          <label>
            Agent
            <select value="" disabled>
              <option value="">Mapping required</option>
            </select>
          </label>
          <small>
            These relationships will not be guessed from installer or program
            data.
          </small>
        </div>
      </details>

      <details>
        <summary>Customer &amp; address</summary>
        <div>
          <label>
            Customer type
            <select
              value={filters.customerType}
              onChange={(event) =>
                onChange({ customerType: event.target.value })}
            >
              <option value="">All customer types</option>
              {snapshot.filters.customerTypes.map((option) => (
                <option key={option} value={option}>{readable(option)}</option>
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
              {snapshot.filters.postcodes.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
        </div>
      </details>

      <details>
        <summary>Job filters</summary>
        <div>
          <label>
            Job stage
            <select
              value={filters.workStage}
              onChange={(event) => onChange({ workStage: event.target.value })}
            >
              <option value="">All job stages</option>
              {snapshot.filters.workStages.map((option) => (
                <option key={option} value={option}>{readable(option)}</option>
              ))}
            </select>
          </label>
        </div>
      </details>

      <details>
        <summary>Appointment filters</summary>
        <div>
          <label>
            Appointment type
            <select
              value={filters.appointmentType}
              onChange={(event) =>
                onChange({ appointmentType: event.target.value })}
            >
              <option value="">All appointment types</option>
              {snapshot.filters.appointmentTypes.map((option) => (
                <option key={option} value={option}>{readable(option)}</option>
              ))}
            </select>
          </label>
          <label>
            Appointment status
            <select
              value={filters.appointmentStatus}
              onChange={(event) =>
                onChange({ appointmentStatus: event.target.value })}
            >
              <option value="">All appointment states</option>
              {snapshot.filters.appointmentStatuses.map((option) => (
                <option key={option} value={option}>{readable(option)}</option>
              ))}
            </select>
          </label>
        </div>
      </details>

      <details>
        <summary>Tag filters</summary>
        <div>
          <label>
            Job tag
            <select
              value={filters.tag}
              onChange={(event) => onChange({ tag: event.target.value })}
            >
              <option value="">All tags</option>
              {snapshot.filters.tags.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
        </div>
      </details>

      <details>
        <summary>Product filters</summary>
        <div>
          <label>
            Product category
            <select
              value={filters.productCategory}
              onChange={(event) =>
                onChange({ productCategory: event.target.value })}
            >
              <option value="">All product categories</option>
              {snapshot.filters.productCategories.map((option) => (
                <option key={option} value={option}>{readable(option)}</option>
              ))}
            </select>
          </label>
        </div>
      </details>

      <details>
        <summary>Audit filters</summary>
        <div>
          <label>
            Certificate audit
            <select value="" disabled>
              <option value="">Blocked: no issued certificates</option>
            </select>
          </label>
          <small>
            Rule, lookup, evidence, calculator and submission states are
            available under Status filters.
          </small>
        </div>
      </details>

      <details>
        <summary>Other filters</summary>
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
              {snapshot.filters.pageSizes.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
        </div>
      </details>

      <details>
        <summary>Custom quick filters</summary>
        <div>
          <label>
            Saved filter
            <select value="" disabled>
              <option value="">Saved views are not enabled yet</option>
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
  const requestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const initialPanelRef = useRef(false);
  const filterToggleRef = useRef<HTMLButtonElement>(null);
  const dataforceFileRef = useRef<HTMLInputElement>(null);
  const dataforceImportDialogRef = useRef<HTMLDialogElement>(null);
  const lastRecordTriggerRef = useRef<HTMLElement | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(filters.page),
      pageSize: String(filters.pageSize),
    });
    if (filters.installerId)
      params.set("installerId", filters.installerId);
    if (filters.technicianId)
      params.set("technicianId", filters.technicianId);
    if (filters.activityTemplateId)
      params.set("activityTemplateId", filters.activityTemplateId);
    if (filters.reviewStatus)
      params.set("reviewStatus", filters.reviewStatus);
    if (filters.evidenceStatus)
      params.set("evidenceStatus", filters.evidenceStatus);
    if (filters.lookupStatus)
      params.set("lookupStatus", filters.lookupStatus);
    if (filters.ruleStatus) params.set("ruleStatus", filters.ruleStatus);
    if (filters.calculatorStatus)
      params.set("calculatorStatus", filters.calculatorStatus);
    if (filters.connectorStatus)
      params.set("connectorStatus", filters.connectorStatus);
    if (filters.workStage) params.set("workStage", filters.workStage);
    if (filters.workType) params.set("workType", filters.workType);
    if (filters.priority) params.set("priority", filters.priority);
    if (filters.appointmentType)
      params.set("appointmentType", filters.appointmentType);
    if (filters.appointmentStatus)
      params.set("appointmentStatus", filters.appointmentStatus);
    if (filters.customerType)
      params.set("customerType", filters.customerType);
    if (filters.serviceCategory)
      params.set("serviceCategory", filters.serviceCategory);
    if (filters.productCategory)
      params.set("productCategory", filters.productCategory);
    if (filters.postcode) params.set("postcode", filters.postcode);
    if (filters.tag) params.set("tag", filters.tag);
    params.set("dateField", filters.dateField);
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
    params.set("sortBy", filters.sortBy);
    params.set("sortDirection", filters.sortDirection);
    if (filters.query) params.set("q", filters.query);
    return params.toString();
  }, [filters]);

  const load = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setBusy((current) => current || "load");
    setError("");
    try {
      const result = await api(`/api/creditex/pilot?${query}`);
      if (requestId !== requestRef.current) return;
      const nextSnapshot = result.pilot as PilotSnapshot;
      setSnapshot(nextSnapshot);
      if (!initialPanelRef.current) {
        initialPanelRef.current = true;
        if (nextSnapshot.run?.status === "active") setPanel("jobs");
      }
    } catch (requestError) {
      if (requestId !== requestRef.current) return;
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The synthetic VEU pilot could not be loaded.",
      );
    } finally {
      if (requestId === requestRef.current) {
        setBusy((current) => current === "load" ? "" : current);
      }
    }
  }, [api, query]);

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

  const selectedJob = useMemo(
    () => snapshot?.jobs?.find((job) => job.id === selectedJobId) || null,
    [selectedJobId, snapshot?.jobs],
  );
  const contextJob = useMemo(
    () => snapshot?.jobs?.find((job) => job.id === contextMenu?.jobId) || null,
    [contextMenu?.jobId, snapshot?.jobs],
  );
  const appliedFilterCount = useMemo(
    () => activeFilterCount(filters),
    [filters],
  );
  const visibleTechnicians = useMemo(
    () => (snapshot?.technicians || []).filter(
      (technician) =>
        !draftFilters.installerId
        || technician.installerId === draftFilters.installerId,
    ),
    [draftFilters.installerId, snapshot?.technicians],
  );

  async function runAction(body: Record<string, unknown>) {
    return api("/api/creditex/pilot", {
      method: "POST",
      body: JSON.stringify(body),
    });
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
    setJobDetail(null);
    setJobDetailError("");
    setSelectedJobId(job.id);
    setRecordSection(section);
    setRecordOpen(true);
    setContextMenu(null);
    return loadJobDetail(job.id);
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

  function openContextMenu(
    job: PilotJob,
    x: number,
    y: number,
    trigger?: HTMLElement | null,
  ) {
    if (trigger) lastRecordTriggerRef.current = trigger;
    setSelectedJobId(job.id);
    setRecordOpen(false);
    setContextMenu({ jobId: job.id, x: Math.max(8, x), y: Math.max(8, y) });
  }

  async function copyJobRow(job: PilotJob) {
    const values = PILOT_JOB_COLUMNS
      .filter((column) => column.key !== "actions")
      .map((column) => pilotJobCellValue(column.key, job));
    const content = [
      PILOT_JOB_COLUMNS
        .filter((column) => column.key !== "actions")
        .map((column) => column.label)
        .join("\t"),
      values.join("\t"),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(content);
      setNotice(`${job.jobNumber} row headings and values were copied.`);
    } catch {
      setError("Browser clipboard access was denied. Nothing was copied.");
    } finally {
      closeContextMenu();
    }
  }

  async function downloadDataforceCsv() {
    const expectedTotal = snapshot?.pagination?.total || 0;
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
      const params = new URLSearchParams(query);
      params.set("pageSize", "300");
      const jobsById = new Map<string, PilotJob>();
      let page = 0;
      let pageCount = 1;
      do {
        params.set("page", String(page));
        const result = await api(
          `/api/creditex/pilot?${params.toString()}`,
        );
        const pageSnapshot = result.pilot as PilotSnapshot;
        for (const job of pageSnapshot.jobs || []) {
          jobsById.set(job.id, job);
        }
        pageCount = Math.max(1, pageSnapshot.pagination?.pageCount || 1);
        page += 1;
      } while (page < pageCount);

      const jobs = Array.from(jobsById.values());
      if (jobs.length !== expectedTotal) {
        throw new Error(
          "The job register changed during export. Refresh and download again.",
        );
      }
      const csv = exportDataforceJobCsv(
        jobs.map((job) => projectCreditexJobToDataforceRecord(job, {
          "App Id": job.appointment.id,
          "Job Id": job.jobNumber,
          "Status": pilotJobCellValue("reviewStatus", job),
          "SubStatus": pilotJobCellValue("legacySubStatus", job),
          "Type": pilotJobCellValue("legacyType", job),
          "Work Type": pilotJobCellValue("workType", job),
          "Scheduled Datetime": pilotJobCellValue("scheduledStart", job),
          "Balance": pilotJobCellValue("legacyBalance", job),
          "Certificates (VEECs)": pilotJobCellValue("certificates", job),
          "Submission": pilotJobCellValue("connectorStatus", job),
          "Invoiced": pilotJobCellValue("invoiceStatus", job),
          "Field Worker": pilotJobCellValue("technician", job),
          "Agent": pilotJobCellValue("agent", job),
          "Client": pilotJobCellValue("client", job),
          "Customer": pilotJobCellValue("customer", job),
          "Company Name": pilotJobCellValue("companyName", job),
          "Ext Cust Ref": pilotJobCellValue("customerNumber", job),
          "Phone": pilotJobCellValue("phone", job),
          "Mobile": pilotJobCellValue("mobile", job),
          "Email": pilotJobCellValue("email", job),
          "Address": pilotJobCellValue("address", job),
          "Suburb": pilotJobCellValue("suburb", job),
          "Postcode": pilotJobCellValue("postcode", job),
        })),
        { includeBom: true },
      );
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download =
        `creditex-veu-jobs-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(
        `Downloaded ${jobs.length} matching jobs in the exact 23-column Dataforce layout.`,
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
      if (recordOpen && selectedJobId === job.id) {
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

  if (!snapshot) {
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
                <span>VEU TEST JOB REGISTER</span>
                <h3>
                  {(snapshot.jobs || []).length} shown of{" "}
                  {snapshot.pagination?.total || 0} matching jobs
                </h3>
                <p>
                  Double-click a job for its complete audit workspace.
                  Right-click for customer, job and appointment actions.
                </p>
              </div>
              <div className={styles.registerTools}>
                <label>
                  Density
                  <select
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
                  <button type="submit">Search</button>
                </form>
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
                  Filters
                  {appliedFilterCount > 0 && (
                    <b aria-label={`${appliedFilterCount} active filters`}>
                      {appliedFilterCount}
                    </b>
                  )}
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void load()}
                >
                  Refresh
                </button>
              </div>
            </header>

            <div className={styles.tableViewport}>
              <table className={styles.jobTable}>
                <caption>
                  Creditex synthetic VEU compliance job register. Every
                  returned job is represented by one row.
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
                  {(snapshot.jobs || []).map((job) => (
                    <tr
                      key={job.id}
                      data-selected={selectedJobId === job.id}
                      aria-selected={selectedJobId === job.id}
                      tabIndex={0}
                      onClick={(event) => {
                        if (
                          (event.target as Element).closest(
                            "button, a, input, select, textarea, [role='menu']",
                          )
                        ) {
                          return;
                        }
                        setSelectedJobId(job.id);
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
                        void openRecord(
                          job,
                          "appointment_summary",
                          event.currentTarget,
                        );
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        openContextMenu(
                          job,
                          event.clientX,
                          event.clientY,
                          event.currentTarget,
                        );
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void openRecord(
                            job,
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
                          openContextMenu(
                            job,
                            rect.left + 28,
                            rect.top + 24,
                            event.currentTarget,
                          );
                        }
                      }}
                    >
                      {PILOT_JOB_COLUMNS.map((column) => (
                        <td key={column.key}>
                          <PilotJobCell
                            column={column}
                            job={job}
                            onOpen={(button) =>
                              void openRecord(
                                job,
                                "appointment_summary",
                                button,
                              )}
                            onOpenMenu={(button) => {
                              const rect = button.getBoundingClientRect();
                              openContextMenu(
                                job,
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
                  {!snapshot.jobs?.length && (
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
                Records {(snapshot.jobs || []).length} |{" "}
                {PILOT_JOB_COLUMNS.length - 1} columns |{" "}
                {PILOT_SORT_KEYS.length} sortable
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
                  || (snapshot.pagination?.total || 0) <= 0
                }
                onClick={() => void downloadDataforceCsv()}
              >
                {busy === "dataforce-export"
                  ? "Preparing CSV..."
                  : "Download CSV"}
              </button>
              <button
                type="button"
                disabled={(snapshot.pagination?.page || 0) <= 0}
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
                Page {(snapshot.pagination?.page || 0) + 1} of{" "}
                {Math.max(1, snapshot.pagination?.pageCount || 1)}
              </span>
              <button
                type="button"
                disabled={
                  (snapshot.pagination?.page || 0) + 1
                  >= (snapshot.pagination?.pageCount || 0)
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
              <AdvancedPilotFilters
                snapshot={snapshot}
                filters={draftFilters}
                technicians={visibleTechnicians}
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
              onCopyRow={() => void copyJobRow(contextJob)}
              onPrint={(previewOnly) => void openPrint(contextJob, previewOnly)}
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
        <section className={styles.dataPanel}>
          <div className={styles.sectionHeading}>
            <span>PRIORITY 03</span>
            <h3>Original evidence transport test contract</h3>
            <p>
              These slots test capture timing, exact original bytes, EXIF,
              location and custody. They are not presented as a complete
              government evidence policy for any VEU activity.
            </p>
          </div>
          <section className={styles.sourcePackSummary}>
            <article>
              <span>Physical acceptance ledger</span>
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
          {foundationReadiness.error && panel === "evidence" && (
            <p className={styles.error}>{foundationReadiness.error}</p>
          )}
          <div className={styles.evidenceGrid}>
            {(snapshot.evidenceContracts || []).map((requirement) => (
              <article key={requirement.requirementCode}>
                <span>{readable(requirement.captureTiming)}</span>
                <h4>{requirement.title}</h4>
                <p>
                  {readable(requirement.evidenceKind)} |{" "}
                  {requirement.minimumCount} to {requirement.maximumCount} files
                </p>
                <ul>
                  <li>
                    Original bytes:{" "}
                    {requirement.originalRequired ? "Required" : "Not required"}
                  </li>
                  <li>
                    Metadata:{" "}
                    {requirement.metadataRequired ? "Required" : "Not required"}
                  </li>
                  <li>
                    GPS: {requirement.gpsRequired ? "Required" : "Not required"}
                  </li>
                </ul>
                <small>
                  Government status:{" "}
                  {readable(requirement.governmentRequirementStatus)}
                </small>
              </article>
            ))}
          </div>
        </section>
      )}

      {panel === "calculators" && (
        <section className={styles.dataPanel}>
          <div className={styles.sectionHeading}>
            <span>PRIORITY 04</span>
            <h3>Typed VEEC calculator contracts</h3>
            <p>
              All activity families have a versionable typed boundary. Formula
              execution remains disabled until official tables, units, caps,
              rounding and independent golden vectors reconcile.
            </p>
          </div>
          <section className={styles.calculatorSummary}>
            <article>
              <span>Execution engine</span>
              <strong>Deterministic v2 exact decimal</strong>
            </article>
            <article>
              <span>Typed contracts</span>
              <strong>{snapshot.calculatorSummary?.total || 0}</strong>
            </article>
            <article>
              <span>Verified formulas</span>
              <strong>{snapshot.calculatorSummary?.verified || 0}</strong>
            </article>
            <article>
              <span>Reconciled vectors</span>
              <strong>
                {snapshot.calculatorSummary?.reconciledVectors || 0}
              </strong>
            </article>
            <article>
              <span>Execution</span>
              <strong>
                {snapshot.calculatorSummary?.executionEnabled
                  ? "Enabled"
                  : "Blocked"}
                </strong>
            </article>
            <article>
              <span>Official VEU formulas loaded</span>
              <strong>0</strong>
            </article>
          </section>
          <div className={styles.activityTable}>
            {(snapshot.activities || []).map((activity) => (
              <article key={activity.activityTemplateId}>
                <strong>{activity.registryActivityCode}</strong>
                <span>{activity.title}</span>
                <small>{readable(activity.catalogueState)}</small>
                <b>Formula blocked</b>
              </article>
            ))}
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
