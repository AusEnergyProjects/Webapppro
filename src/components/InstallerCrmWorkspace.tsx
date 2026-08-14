"use client";

import { type CSSProperties, FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import type { User } from "firebase/auth";
import { AccessibleMenu } from "./AccessibleMenu";
import { SearchableLookup, type SearchableLookupOption } from "./SearchableLookup";
import type { TLinkCommandTarget } from "./TLinkCommandCentre";
import { WorkspaceListControls, WorkspaceListPreferences } from "./WorkspaceListControls";
import { type NamedWorkspaceListView, WorkspaceSavedViews } from "./WorkspaceSavedViews";
import { downloadWorkspaceCsv, type WorkspaceTableColumn, WorkspaceTableTools } from "./WorkspaceTableTools";
import { appointmentDurationMinutes, durationLabel, nextAppointmentSlot, scheduleProposalKey, type ScheduleProposalValidation } from "@/lib/trade-schedule";
import type { ConvertedEnquiryJobSeed } from "./TradeEnquiryInbox";
import type { TradeTeamPermissions } from "./TradeTeamSettings";
import {
  DATAFORCE_JOB_CSV_HEADERS,
  exportDataforceJobCsv,
  type DataforceJobCsvRecord,
} from "@/lib/creditex-dataforce-job-csv";
import { JOB_REGISTER_COLUMN_KEYS, type JobRegisterRecord } from "@/lib/trade-crm-job-register";
import registerStyles from "./InstallerCrmJobRegister.module.css";
import {
  ENERGY_SERVICE_LABELS,
  ENERGY_SERVICE_OPTIONS,
} from "@/lib/energy-service-catalogue.mjs";

const TradeHandoverCentre = dynamic(() => import("./TradeHandoverCentre").then((module) => module.TradeHandoverCentre));
const TradeIntegrationCentre = dynamic(() => import("./TradeIntegrationCentre").then((module) => module.TradeIntegrationCentre));
const TradeCommercialHandoffPanel = dynamic(() => import("./TradeCommercialHandoffPanel").then((module) => module.TradeCommercialHandoffPanel));
const TradeComplianceIntake = dynamic(() => import("./TradeComplianceIntake").then((module) => module.TradeComplianceIntake));
const TradeFieldWorkPanel = dynamic(() => import("./TradeFieldWorkPanel").then((module) => module.TradeFieldWorkPanel));
const TradeJobFormsPanel = dynamic(() => import("./TradeJobFormsPanel").then((module) => module.TradeJobFormsPanel));
const TradeDataImportWorkspace = dynamic(() => import("./TradeDataImportWorkspace").then((module) => module.TradeDataImportWorkspace));
const TradeEnquiryInbox = dynamic(() => import("./TradeEnquiryInbox").then((module) => module.TradeEnquiryInbox));
const TradeAssetWorkspace = dynamic(() => import("./TradeAssetWorkspace").then((module) => module.TradeAssetWorkspace));
const TradeQuotePanel = dynamic(() => import("./TradeQuotePanel").then((module) => module.TradeQuotePanel));
const TradePhotoRequestPanel = dynamic(() => import("./TradePhotoRequestPanel").then((module) => module.TradePhotoRequestPanel));
const TradePhotoTemplateLibrary = dynamic(() => import("./TradePhotoTemplateLibrary").then((module) => module.TradePhotoTemplateLibrary));
const TradePriceBookWorkspace = dynamic(() => import("./TradePriceBookWorkspace").then((module) => module.TradePriceBookWorkspace));
const TradeJobReadinessPanel = dynamic(() => import("./TradeJobReadinessPanel").then((module) => module.TradeJobReadinessPanel));
const TradeNewJobForm = dynamic(() => import("./TradeNewJobForm").then((module) => module.TradeNewJobForm));
const TradeQuickInvoicePanel = dynamic(() => import("./TradeQuickInvoicePanel").then((module) => module.TradeQuickInvoicePanel));
const TradeScheduleWorkspace = dynamic(() => import("./TradeScheduleWorkspace").then((module) => module.TradeScheduleWorkspace));

type Customer = {
  id: string; customerNumber: string; customerType: string; displayName: string; firstName: string;
  lastName: string; businessName: string; email: string; phone: string; addressLine1: string;
  addressLine2: string; suburb: string; addressState: string; postcode: string; tags: string[];
  privateNotes: string; jobCount?: number; activeJobCount?: number; activities?: string[];
  latestJobNumber?: string; latestJobAt?: string; latestPipelineStage?: string; createdAt: string; updatedAt: string;
};
type CustomerContact = {
  id: string; customerId: string; firstName: string; lastName: string; roleLabel: string;
  email: string; phone: string; isPrimary: boolean; createdAt: string; updatedAt: string;
};
type SiteContact = { id: string; customerContactId: string; roleLabel: string; isPrimary: boolean; displayName: string; email: string; phone: string };
type ServiceSite = {
  id: string; customerId: string; siteLabel: string; addressLine1: string; addressLine2: string;
  suburb: string; addressState: string; postcode: string; accessInstructions: string;
  addressEntryMode: string; addressProvider: string; addressProviderReference: string; addressFormatted: string; addressVerifiedAt: string;
  parkingInstructions: string; hazardNotes: string; isPrimary: boolean; contacts: SiteContact[];
  createdAt: string; updatedAt: string;
};
type Task = { id: string; title: string; dueAt: string; status: "pending" | "done"; completedAt: string };
type Appointment = { id: string; appointmentType: string; title: string; startsAt: string; endsAt: string; assigneeMemberId: string; assigneeLabel: string; status: string; notes: string };
type Note = { id: string; noteType: "internal" | "issue"; body: string; issueStatus: string; createdAt: string; updatedAt: string };
type ComplianceCase = {
  id: string; caseNumber: string; activityDate: string; programCode: string; programName: string;
  activityKey: string; version: number; title: string; registryActivityCode: string; productCategory: string;
  scenarioCode: string; scenario: string; officialSourceUrl: string; officialSourceTitle: string;
  officialSourceVersion: string; status: string; evidenceStatus: string; createdAt: string; updatedAt: string;
};
type ComplianceIntent = {
  id: string; status: string; programTemplateId: string; activityTemplateId: string;
  programCode: string; programName: string; activityKey: string; registryActivityCode: string;
  activityTitle: string; serviceCategory: string; siteJurisdiction: string; plannedStart: string;
  catalogueReviewedOn: string; governanceState: string; governanceMessage: string;
  officialSourceUrl: string; complianceCaseId: string; createdAt: string; updatedAt: string;
};
type JobTemplate = {
  id: string; name: string; title: string; serviceCategory: string; priority: string;
  description: string; taskTitles: string[]; createdAt: string; updatedAt: string;
};
type TeamMember = { id: string; displayName: string; status: string; isOwner: boolean; isSelf?: boolean };
type AssigneeRoster = { page: number; pageSize: number; total: number; totalPages: number; search: string; capability: string };
type AppointmentCalendarSync = { connected: number; synced: number; failed: number };
type Job = {
  id: string; workNumber: string; title: string; serviceCategory: string; siteArea: string; stage: string;
  priority: string; scheduledStart: string; scheduledEnd: string; revision: number; assigneeMemberId: string; assigneeLabel: string; sourceType: string;
  customerSource: "trade_owned" | "public_lead_released" | "platform_private" | "internal"; crmCustomerId: string; serviceSiteId: string; pipelineStage: string; buildingType: string;
  description: string; customerReference: string; nextAction: string; tags: string[]; estimatedValueCents: number;
  quotedValueCents: number; invoicedValueCents: number; paidValueCents: number; quoteStatus: string; scheduleReady: boolean;
  invoiceStatus: string; paymentDueAt: string; handoverStatus: string; tasks: Task[];
  appointments: Appointment[]; notes: Note[]; complianceCases: ComplianceCase[]; complianceIntents: ComplianceIntent[]; complianceIntent: ComplianceIntent | null; customerDisplayName?: string; createdAt: string; updatedAt: string;
  dataforceRecord: DataforceJobCsvRecord;
  jobRegister: JobRegisterRecord;
};
type CrmResult = { ok?: boolean; customers?: Customer[]; jobs?: Job[]; templates?: JobTemplate[]; teamMembers?: TeamMember[]; teamAccess?: boolean; error?: string };
type DuplicateCandidate = { customerId: string; customerNumber: string; displayName: string; serviceSiteId: string; siteLabel: string; reasons: string[] };
type CreateJobResult = { ok?: boolean; id?: string; workNumber?: string; customerId?: string; serviceSiteId?: string; complianceIntentPlanned?: boolean; complianceIntentCount?: number; calendarSynced?: number; calendarFailed?: number; duplicateCandidates?: DuplicateCandidate[]; error?: string };
type IndexPagination = { page: number; pageSize: number; total: number; pageCount: number; hasNext?: boolean; nextCursor?: string };
type CrmIndexResult = { ok?: boolean; items?: Job[] | Customer[]; pagination?: IndexPagination; error?: string };
type CrmDetailResult = { ok?: boolean; job?: Job; customer?: Customer | null; contacts?: CustomerContact[]; sites?: ServiceSite[]; jobs?: Job[]; error?: string };
type ActivityJob = { id: string; workNumber: string; title: string };
type ActivityAppointment = Appointment & { job: ActivityJob };
type ActivityTask = Task & { job: ActivityJob };
type ActivityNote = Note & { job: ActivityJob };
type CrmMetrics = {
  openJobs: number; nextVisits: number; todayVisits: number; awaitingSchedule: number; overdueTasks: number; openIssues: number; waitingJobs: number;
  completedJobs: number; quotedCents: number; invoicedCents: number; paidCents: number; outstandingCents: number;
};
type WorkloadBucket = { weekStart: string; weekEnd: string; visits: number; bookedMinutes: number };
type CrmSummaryResult = { ok?: boolean; metrics?: CrmMetrics; workload?: WorkloadBucket[]; workStages?: Record<string, number>; upcomingAppointments?: ActivityAppointment[]; overdueTasks?: ActivityTask[]; openIssues?: ActivityNote[]; error?: string };
type CrmReportResult = { ok?: boolean; metrics?: CrmMetrics; pipeline?: Record<string, number>; error?: string };
type View = "today" | "enquiries" | "jobs" | "schedule" | "customers" | "pricebook" | "assets" | "templates" | "reports" | "import" | "integrations";
type JobTab = "summary" | "schedule" | "quote" | "field" | "invoice";
type JobDetailTab = JobTab | "forms" | "tasks" | "notes" | "handover";
type JobReturnTarget = { kind: "jobs" } | { kind: "customer"; customerId: string; customerName: string };

const serviceOptions = [
  ...ENERGY_SERVICE_OPTIONS,
  ["electrical", "Electrical services"], ["plumbing", "Plumbing services"],
  ["mounting-hardware", "Mounting and hardware"], ["controls", "Energy controls"],
] as const;
const serviceLabels: Record<string, string> = {
  ...ENERGY_SERVICE_LABELS,
  electrical: "Electrical services", plumbing: "Plumbing services",
  "mounting-hardware": "Mounting and hardware", controls: "Energy controls",
  "insulation-draughts": "Insulation and draught control",
};
const pipelineLabels: Record<string, string> = {
  enquiry: "Lead", qualifying: "Lead checking", quoting: "Quoted / quoting", approved: "Allocated / approved",
  scheduled: "Scheduled", in_progress: "Work underway", complete: "Completed", invoiced: "Invoiced",
  paid: "Paid", lost: "Not proceeding",
};
const workStageLabels: Record<string, string> = {
  backlog: "Planning", ready: "Ready to schedule", scheduled: "Scheduled", in_progress: "On site",
  blocked: "Waiting", completed: "Complete", cancelled: "Cancelled",
};
const appointmentLabels: Record<string, string> = {
  phone_call: "Phone call", site_visit: "Site visit", quote_review: "Quote review", installation: "Installation",
  service: "Service visit", admin: "Office task",
};

const dateLabel = (value: string, includeTime = false) => value
  ? new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleString("en-AU", includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" })
  : "Not set";
const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(cents / 100);
const registerMoney = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
const cents = (value: FormDataEntryValue | null) => Math.round(Math.max(0, Number(value || 0)) * 100);
const shortDateLabel = (value: string) => value
  ? new Date(`${value}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" })
  : "Not set";
const bookedTimeLabel = (minutes: number) => {
  const safeMinutes = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
};

type IndexColumn = WorkspaceTableColumn & { width: number };
const jobIndexColumns: IndexColumn[] = [
  { key: "jobId", label: "Job ID", width: 128 },
  { key: "actions", label: "Actions", width: 92 },
  { key: "firstName", label: "First name", width: 120 },
  { key: "lastName", label: "Last name", width: 120 },
  { key: "contactNumber", label: "Contact number", width: 138 },
  { key: "email", label: "Email", width: 210 },
  { key: "streetAddress", label: "Street address", width: 230 },
  { key: "postcode", label: "Postcode", width: 90 },
  { key: "suburb", label: "Suburb", width: 135 },
  { key: "state", label: "State", width: 70 },
  { key: "assignedWorker", label: "Assigned worker", width: 160 },
  { key: "scheduleDate", label: "Schedule date", width: 150 },
  { key: "operationalStatus", label: "Status", width: 105 },
  { key: "quoteTotalExGst", label: "Quote total ex GST", width: 145 },
  { key: "stc", label: "STC", width: 78 },
  { key: "veec", label: "VEEC", width: 78 },
  { key: "esc", label: "ESC", width: 78 },
  { key: "otherCertificates", label: "Other certs", width: 100 },
  { key: "service", label: "Activity", width: 190 },
];
const customerIndexColumns: IndexColumn[] = [
  { key: "customer", label: "Customer", width: 180 }, { key: "firstName", label: "First name", width: 105 },
  { key: "lastName", label: "Last name", width: 105 }, { key: "email", label: "Email", width: 200 },
  { key: "phone", label: "Phone", width: 120 }, { key: "suburb", label: "Suburb", width: 125 },
  { key: "postcode", label: "Postcode", width: 75 }, { key: "jobs", label: "Jobs", width: 60 },
  { key: "latestJob", label: "Latest job", width: 175 }, { key: "status", label: "Status", width: 120 },
];
const DATAFORCE_JOB_EXPORT_PAGE_SIZE = 100;
const DATAFORCE_JOB_EXPORT_MAX_ROWS = 5000;
type JobRegisterColumnKey = typeof JOB_REGISTER_COLUMN_KEYS[number];
const JOB_REGISTER_COLUMN_KEY_SET = new Set<string>(JOB_REGISTER_COLUMN_KEYS);
const JOB_REGISTER_DEFAULT_COLUMNS = [...JOB_REGISTER_COLUMN_KEYS];
const columnKeys = (columns: IndexColumn[]) => columns.map((column) => column.key);
function safeJobRegisterColumns(columns: unknown): JobRegisterColumnKey[] {
  if (!Array.isArray(columns) || columns.length === 0) return [...JOB_REGISTER_DEFAULT_COLUMNS];
  if (
    columns.some((key) => typeof key !== "string" || !JOB_REGISTER_COLUMN_KEY_SET.has(key))
    || new Set(columns).size !== columns.length
  ) {
    return [...JOB_REGISTER_DEFAULT_COLUMNS];
  }
  return [...columns] as JobRegisterColumnKey[];
}
function indexGridStyle(keys: readonly string[], columns: IndexColumn[]): CSSProperties {
  const visible = keys.map((key) => columns.find((column) => column.key === key)).filter((column): column is IndexColumn => Boolean(column));
  return { gridTemplateColumns: visible.map((column) => `${column.width}px`).join(" "), minWidth: visible.reduce((sum, column) => sum + column.width, 0) + Math.max(0, visible.length - 1) * 10 };
}

function phoneHref(value: string): string {
  const compact = value.trim().replace(/[^\d+]/g, "");
  return compact ? `tel:${compact}` : "";
}

function jobIndexCell(job: Job, key: string, onOpen: () => void, actionNode: ReactNode): ReactNode {
  const record = job.jobRegister;
  if (key === "actions") return actionNode;
  if (key === "jobId") return <button type="button" className="crm-index-open-button" onClick={onOpen} aria-label={`Open job ${record.jobId}`}><strong>{record.jobId}</strong></button>;
  if (key === "contactNumber") return record.contactNumber ? <a className="crm-index-phone-link" href={phoneHref(record.contactNumber)}>{record.contactNumber}</a> : <span>Not added</span>;
  if (key === "email") return record.email ? <a className="crm-index-email-link" href={`mailto:${record.email}`}>{record.email}</a> : <span>Not added</span>;
  if (key === "scheduleDate") return <span>{record.scheduleDate ? dateLabel(record.scheduleDate, true) : "Unassigned"}</span>;
  if (key === "operationalStatus") return <span className={`${registerStyles.status} ${registerStyles[record.operationalStatus]}`}>{record.operationalStatus}</span>;
  if (key === "quoteTotalExGst") return <span>{record.quoteTotalExGstCents === null ? (record.quoteStatus === "restricted" ? "Restricted" : "Not quoted") : registerMoney(record.quoteTotalExGstCents)}</span>;
  if (key === "stc" || key === "veec" || key === "esc") return <span title={record.certificates.state === "pending" ? "No authoritative issuance recorded" : undefined}>{record.certificates[key]}</span>;
  if (key === "otherCertificates") return <span title={record.certificates.state === "pending" ? "No authoritative issuance recorded" : undefined}>{record.certificates.other}</span>;
  const value = String(record[key as keyof JobRegisterRecord] || "");
  return <span title={value}>{value || "Not added"}</span>;
}

function customerIndexCell(customer: Customer, key: string, onOpen: () => void): ReactNode {
  if (key === "customer") return <button type="button" className="crm-index-open-button" onClick={onOpen} title={customer.displayName} aria-label={`Open customer ${customer.displayName}`}><strong>{customer.displayName}</strong></button>;
  if (key === "firstName") return <span title={customer.firstName}>{customer.firstName || "Not added"}</span>;
  if (key === "lastName") return <span title={customer.lastName}>{customer.lastName || "Not added"}</span>;
  if (key === "email") return customer.email ? <a className="crm-index-email-link" href={`mailto:${customer.email}`} title={`Email ${customer.email}`}>{customer.email}</a> : <span>Not added</span>;
  if (key === "phone") return customer.phone ? <a className="crm-index-phone-link" href={phoneHref(customer.phone)} title={`Call ${customer.phone}`}>{customer.phone}</a> : <span>Not added</span>;
  if (key === "suburb") return <span title={customer.suburb}>{customer.suburb || "Not added"}</span>;
  if (key === "postcode") return <span>{customer.postcode || "Not added"}</span>;
  if (key === "jobs") return <span>{customer.jobCount || 0}</span>;
  if (key === "latestJob") {
    const label = customer.latestJobNumber
      ? `${customer.latestJobNumber} | ${dateLabel(customer.latestJobAt || customer.updatedAt)}`
      : "No jobs";
    return <b title={label}>{label}</b>;
  }
  return <em>{customer.latestPipelineStage ? pipelineLabels[customer.latestPipelineStage] || customer.latestPipelineStage : "No status"}</em>;
}

export function InstallerCrmWorkspace({ user, teamAccess, staffPermissions, navigationTarget, onOpenSchedule, onViewChange, onOpenInvoices }: { user: User; teamAccess: boolean; staffPermissions?: TradeTeamPermissions; navigationTarget?: TLinkCommandTarget | null; onOpenSchedule?: (weekStart?: string) => void; onViewChange?: (view: View) => void; onOpenInvoices?: () => void }) {
  const [templates, setTemplates] = useState<JobTemplate[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [view, setView] = useState<View>(() => staffPermissions ? "jobs" : "today");
  const [scheduleWeekStart, setScheduleWeekStart] = useState("");
  const [priceBookView, setPriceBookView] = useState<"items" | "packets">("items");
  const [creating, setCreating] = useState<"" | "job" | "customer">("");
  const [newJobSeed, setNewJobSeed] = useState<ConvertedEnquiryJobSeed | null>(null);
  const [focusedJobId, setFocusedJobId] = useState("");
  const [focusedJobTab, setFocusedJobTab] = useState<JobTab>("summary");
  const [jobReturnTarget, setJobReturnTarget] = useState<JobReturnTarget>({ kind: "jobs" });
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [jobFilter, setJobFilter] = useState("all");
  const [jobLayout, setJobLayout] = useState<"list" | "board">("list");
  const [pipelineFocus, setPipelineFocus] = useState("");
  const [search, setSearch] = useState("");
  const [jobCustomer, setJobCustomer] = useState("");
  const [jobService, setJobService] = useState("");
  const [jobPipeline, setJobPipeline] = useState("");
  const [jobStage, setJobStage] = useState("");
  const [jobAssignee, setJobAssignee] = useState("");
  const [jobLocation, setJobLocation] = useState("");
  const [jobAppointmentId, setJobAppointmentId] = useState("");
  const [jobId, setJobId] = useState("");
  const [jobScheduledFrom, setJobScheduledFrom] = useState("");
  const [jobScheduledTo, setJobScheduledTo] = useState("");
  const [jobInvoiceStatus, setJobInvoiceStatus] = useState("");
  const [jobCustomerReference, setJobCustomerReference] = useState("");
  const [jobEmail, setJobEmail] = useState("");
  const [jobPhone, setJobPhone] = useState("");
  const [jobSuburb, setJobSuburb] = useState("");
  const [jobPostcode, setJobPostcode] = useState("");
  const [jobFirstName, setJobFirstName] = useState("");
  const [jobLastName, setJobLastName] = useState("");
  const [jobStreet, setJobStreet] = useState("");
  const [jobState, setJobState] = useState("");
  const [jobOperationalStatus, setJobOperationalStatus] = useState("");
  const [jobQuoteTotalMin, setJobQuoteTotalMin] = useState("");
  const [jobQuoteTotalMax, setJobQuoteTotalMax] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerFirstName, setCustomerFirstName] = useState("");
  const [customerLastName, setCustomerLastName] = useState("");
  const [customerBusinessName, setCustomerBusinessName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerStreet, setCustomerStreet] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerPostcode, setCustomerPostcode] = useState("");
  const [customerSuburb, setCustomerSuburb] = useState("");
  const [customerState, setCustomerState] = useState("");
  const [customerService, setCustomerService] = useState("");
  const [customerJobId, setCustomerJobId] = useState("");
  const [customerPipeline, setCustomerPipeline] = useState("");
  const [jobPage, setJobPage] = useState(1);
  const [jobPageSize, setJobPageSize] = useState(25);
  const [customerPage, setCustomerPage] = useState(1);
  const [customerPageSize, setCustomerPageSize] = useState(25);
  const [jobSort, setJobSort] = useState("updated-desc");
  const [customerSort, setCustomerSort] = useState("name-asc");
  const [indexedJobs, setIndexedJobs] = useState<Job[]>([]);
  const [indexedCustomers, setIndexedCustomers] = useState<Customer[]>([]);
  const [jobPagination, setJobPagination] = useState<IndexPagination>({ page: 1, pageSize: 25, total: 0, pageCount: 1 });
  const [customerPagination, setCustomerPagination] = useState<IndexPagination>({ page: 1, pageSize: 25, total: 0, pageCount: 1 });
  const jobCursors = useRef<string[]>([""]); const jobTotalReady = useRef(false);
  const customerCursors = useRef<string[]>([""]); const customerTotalReady = useRef(false);
  const [summary, setSummary] = useState<CrmSummaryResult>({});
  const [report, setReport] = useState<CrmReportResult>({});
  const [boardJobs, setBoardJobs] = useState<Record<string, Job[]>>({});
  const [boardCounts, setBoardCounts] = useState<Record<string, number>>({});
  const [selectedJobDetail, setSelectedJobDetail] = useState<Job | null>(null);
  const [focusedJobRefreshing, setFocusedJobRefreshing] = useState(false);
  const [selectedJobCustomer, setSelectedJobCustomer] = useState<Customer | null>(null);
  const [selectedJobSites, setSelectedJobSites] = useState<ServiceSite[]>([]);
  const [selectedCustomerDetail, setSelectedCustomerDetail] = useState<Customer | null>(null);
  const [selectedCustomerJobs, setSelectedCustomerJobs] = useState<Job[]>([]);
  const [selectedCustomerContacts, setSelectedCustomerContacts] = useState<CustomerContact[]>([]);
  const [selectedCustomerSites, setSelectedCustomerSites] = useState<ServiceSite[]>([]);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [indexLoading, setIndexLoading] = useState(false);
  const [jobExporting, setJobExporting] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [jobViewSaved, setJobViewSaved] = useState(false);
  const [customerViewSaved, setCustomerViewSaved] = useState(false);
  const [jobColumns, setJobColumns] = useState(() => [...JOB_REGISTER_DEFAULT_COLUMNS]);
  const [jobActionId, setJobActionId] = useState("");
  const [jobActionPosition, setJobActionPosition] = useState({ left: 8, top: 8 });
  const [customerColumns, setCustomerColumns] = useState(() => columnKeys(customerIndexColumns));
  const [jobPresets, setJobPresets] = useState<NamedWorkspaceListView[]>([]);
  const [customerPresets, setCustomerPresets] = useState<NamedWorkspaceListView[]>([]);
  const [activeJobPresetId, setActiveJobPresetId] = useState("");
  const [activeCustomerPresetId, setActiveCustomerPresetId] = useState("");
  const [viewBusy, setViewBusy] = useState(false);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const bootstrapStarted = useRef(false);
  const jobPreferencesLoaded = useRef(false);
  const customerPreferencesLoaded = useRef(false);
  const jobIndexRequested = useRef(false);
  const customerIndexRequested = useRef(false);
  const allowedViews = useMemo<View[]>(() => {
    if (!staffPermissions) return ["today", "enquiries", "jobs", "schedule", "customers", "pricebook", "assets", "templates", "reports", "import", "integrations"];
    const views: View[] = ["jobs"];
    if (staffPermissions.scheduleScope) views.push("schedule");
    if (staffPermissions.canViewCustomers && staffPermissions.canSearchCustomers) views.push("customers");
    if (staffPermissions.canViewPriceBook) views.push("pricebook");
    if (staffPermissions.canRunReports) views.push("reports");
    return views;
  }, [staffPermissions]);
  const canCreateCustomer = !staffPermissions || staffPermissions.canManageCustomers;
  const canCreateJob = !staffPermissions || staffPermissions.canCreateJobs;
  const canSearchCustomerFields = true;
  const canSearchCustomerDirectory = !staffPermissions || (staffPermissions.canViewCustomers && staffPermissions.canSearchCustomers);

  useEffect(() => {
    if (!jobActionId) return;
    const close = (event: globalThis.KeyboardEvent | PointerEvent) => {
      if (event instanceof globalThis.KeyboardEvent && event.key !== "Escape") return;
      const returnFocus = event instanceof globalThis.KeyboardEvent;
      const trigger = returnFocus
        ? [...document.querySelectorAll<HTMLButtonElement>("[data-job-action-trigger]")].find((button) => button.dataset.jobActionTrigger === jobActionId)
        : undefined;
      setJobActionId("");
      if (trigger) window.requestAnimationFrame(() => trigger.focus());
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => { document.removeEventListener("keydown", close); document.removeEventListener("pointerdown", close); };
  }, [jobActionId]);

  const load = useCallback(async () => {
    const token = await user.getIdToken();
    const response = await fetch("/api/trade-crm?mode=bootstrap", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as CrmResult;
    if (!response.ok || !result.ok) throw new Error(result.error || "The installer CRM could not be loaded.");
    setTemplates(result.templates || []);
    setTeamMembers(result.teamMembers || []);
  }, [user]);

  useEffect(() => {
    const needsBootstrap = creating === "job" || view === "jobs" || view === "templates" || Boolean(focusedJobId);
    if (!needsBootstrap || bootstrapStarted.current) return;
    bootstrapStarted.current = true;
    let active = true;
    void load().catch((error) => {
      bootstrapStarted.current = false;
      if (active) setStatus(error instanceof Error ? error.message : "The installer CRM tools could not be loaded.");
    });
    return () => { active = false; };
  }, [creating, focusedJobId, load, view]);

  useEffect(() => {
    const isJobs = view === "jobs";
    const isCustomers = view === "customers";
    if ((!isJobs && !isCustomers) || (isJobs ? jobPreferencesLoaded.current : customerPreferencesLoaded.current)) return;
    const loadedRef = isJobs ? jobPreferencesLoaded : customerPreferencesLoaded;
    if (staffPermissions) { loadedRef.current = true; return; }
    let active = true;
    let applied = false;
    const controller = new AbortController();
    const viewKey = isJobs ? "installer-jobs" : "installer-customers";
    void user.getIdToken().then(async (token) => {
      const response = await fetch(`/api/trade-list-views?view=${viewKey}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "The saved list view could not be loaded.");
      if (!active) return;
      const preferences = (result.preferences || {}) as Partial<WorkspaceListPreferences>;
      if (isJobs) {
        setSearch(preferences.search || ""); setJobFilter(preferences.filter || "all");
        setJobCustomer(preferences.customer || ""); setJobService(preferences.service || "");
        setJobPipeline(preferences.pipeline || ""); setJobStage(preferences.stage || ""); setJobAssignee(preferences.assignee || ""); setJobLocation(preferences.location || "");
        setJobAppointmentId(preferences.appointmentId || ""); setJobId(preferences.jobId || "");
        setJobScheduledFrom(preferences.scheduledFrom || ""); setJobScheduledTo(preferences.scheduledTo || "");
        setJobInvoiceStatus(preferences.invoiceStatus || ""); setJobCustomerReference(preferences.customerReference || "");
        setJobEmail(preferences.email || ""); setJobPhone(preferences.phone || ""); setJobSuburb(preferences.suburb || ""); setJobPostcode(preferences.postcode || "");
        setJobFirstName(preferences.firstName || ""); setJobLastName(preferences.lastName || ""); setJobStreet(preferences.street || ""); setJobState(preferences.state || "");
        setJobOperationalStatus(preferences.operationalStatus || ""); setJobQuoteTotalMin(preferences.quoteTotalMin || ""); setJobQuoteTotalMax(preferences.quoteTotalMax || "");
        setJobSort(preferences.sort || "updated-desc"); setJobPageSize(Number(preferences.pageSize) || 25);
        setJobColumns(safeJobRegisterColumns(preferences.jobColumnOrderVersion === 3 ? preferences.columns : undefined));
        setJobPresets((result.presets || []) as NamedWorkspaceListView[]); setJobViewSaved(Boolean(result.saved));
      } else {
        setCustomerSearch(preferences.search || ""); setCustomerFirstName(preferences.firstName || ""); setCustomerLastName(preferences.lastName || "");
        setCustomerBusinessName(preferences.businessName || ""); setCustomerEmail(preferences.email || ""); setCustomerStreet(preferences.street || "");
        setCustomerPhone(preferences.phone || ""); setCustomerPostcode(preferences.postcode || ""); setCustomerSuburb(preferences.suburb || "");
        setCustomerState(preferences.state || ""); setCustomerService(preferences.service || ""); setCustomerJobId(preferences.jobId || "");
        setCustomerPipeline(preferences.pipeline || ""); setCustomerSort(preferences.sort || "name-asc");
        setCustomerPageSize(Number(preferences.pageSize) || 25);
        setCustomerColumns(preferences.columns?.length ? preferences.columns : columnKeys(customerIndexColumns));
        setCustomerPresets((result.presets || []) as NamedWorkspaceListView[]); setCustomerViewSaved(Boolean(result.saved));
      }
      loadedRef.current = true;
      applied = true;
    }).catch((error) => {
      loadedRef.current = false;
      if (active && !controller.signal.aborted) setStatus(error instanceof Error ? error.message : "The saved list view could not be loaded.");
    });
    return () => { active = false; controller.abort(); if (!applied) loadedRef.current = false; };
  }, [staffPermissions, user, view]);

  const jobIndexParams = useCallback((page: number, pageSize: number, cursor = "", includeTotal = true) => {
    const params = new URLSearchParams({ mode: "index", resource: "jobs", service: jobService,
      pipeline: pipelineFocus || jobPipeline, stage: jobStage, assignee: jobAssignee, filter: "all", sort: jobSort,
      appointmentId: jobAppointmentId, jobId, scheduledFrom: jobScheduledFrom, scheduledTo: jobScheduledTo,
      page: String(page), pageSize: String(pageSize) });
    params.set("search", search); params.set("customer", jobCustomer); params.set("location", jobLocation);
    params.set("customerReference", jobCustomerReference); params.set("email", jobEmail); params.set("phone", jobPhone);
    params.set("suburb", jobSuburb); params.set("postcode", jobPostcode);
    params.set("firstName", jobFirstName); params.set("lastName", jobLastName); params.set("street", jobStreet); params.set("state", jobState);
    params.set("operationalStatus", jobOperationalStatus);
    if (!staffPermissions || staffPermissions.canViewQuotes) { params.set("quoteTotalMin", jobQuoteTotalMin); params.set("quoteTotalMax", jobQuoteTotalMax); }
    if (!staffPermissions || staffPermissions.canViewInvoices) params.set("invoiceStatus", jobInvoiceStatus);
    if (cursor) params.set("cursor", cursor);
    if (!includeTotal) params.set("total", "0");
    return params;
  }, [jobAppointmentId, jobAssignee, jobCustomer, jobCustomerReference, jobEmail, jobFirstName, jobId, jobInvoiceStatus, jobLastName, jobLocation, jobOperationalStatus, jobPhone, jobPipeline, jobPostcode, jobQuoteTotalMax, jobQuoteTotalMin, jobScheduledFrom, jobScheduledTo, jobService, jobSort, jobStage, jobState, jobStreet, jobSuburb, pipelineFocus, search, staffPermissions]);

  const loadJobIndex = useCallback(async (signal: AbortSignal) => {
    const token = await user.getIdToken();
    const cursor = jobCursors.current[jobPage - 1] || "";
    const params = jobIndexParams(jobPage, jobPageSize, cursor, !jobTotalReady.current);
    const response = await fetch(`/api/trade-crm?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal });
    const result = await response.json().catch(() => ({})) as CrmIndexResult;
    if (!response.ok || !result.ok) throw new Error(result.error || "The job list could not be loaded.");
    if (signal.aborted) return;
    const items = (result.items || []) as Job[];
    setIndexedJobs(items);
    setJobPagination((current) => {
      const next = { ...current, ...(result.pagination || {}), page: jobPage, pageSize: jobPageSize };
      if (typeof result.pagination?.total === "number") jobTotalReady.current = true;
      if (next.hasNext && next.nextCursor) jobCursors.current[jobPage] = next.nextCursor;
      jobCursors.current.length = Math.max(jobPage, next.hasNext ? jobPage + 1 : jobPage); return next;
    });
  }, [jobIndexParams, jobPage, jobPageSize, user]);

  const downloadAllFilteredJobs = useCallback(async () => {
    if (jobExporting) return;
    setJobExporting(true);
    setStatus("Preparing the complete filtered Dataforce job export...");
    try {
      const token = await user.getIdToken();
      const records: DataforceJobCsvRecord[] = [];
      const seenCursors = new Set<string>();
      const seenJobIds = new Set<string>();
      let page = 1;
      let cursor = "";
      let expectedTotal: number | null = null;

      while (true) {
        const params = jobIndexParams(page, DATAFORCE_JOB_EXPORT_PAGE_SIZE, cursor, page === 1);
        const response = await fetch(`/api/trade-crm?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const result = await response.json().catch(() => ({})) as CrmIndexResult;
        if (!response.ok || !result.ok) throw new Error(result.error || "The complete filtered job export could not be loaded.");
        if (!Array.isArray(result.items) || !result.pagination) {
          throw new Error("The complete filtered job export returned an invalid page.");
        }
        if (page === 1) {
          const total = result.pagination.total;
          if (!Number.isInteger(total) || Number(total) < 0) {
            throw new Error("TLink could not confirm the filtered job count. No CSV was created.");
          }
          expectedTotal = Number(total);
          if (expectedTotal > DATAFORCE_JOB_EXPORT_MAX_ROWS) {
            throw new Error(`This export contains ${expectedTotal} jobs. Narrow the filters to ${DATAFORCE_JOB_EXPORT_MAX_ROWS} jobs or fewer.`);
          }
        }

        for (const item of result.items as Job[]) {
          if (!item.id || seenJobIds.has(item.id)) {
            throw new Error("The filtered job export returned a duplicate job. No CSV was created.");
          }
          seenJobIds.add(item.id);
          const record = item.dataforceRecord;
          if (!record || DATAFORCE_JOB_CSV_HEADERS.some((header) => typeof record[header] !== "string")) {
            throw new Error("A filtered job did not match the Dataforce column contract. No CSV was created.");
          }
          records.push(record);
          if (records.length > DATAFORCE_JOB_EXPORT_MAX_ROWS) {
            throw new Error(`The export exceeded the ${DATAFORCE_JOB_EXPORT_MAX_ROWS} job safety limit. Narrow the filters and try again.`);
          }
        }

        if (!result.pagination.hasNext) break;
        const nextCursor = result.pagination.nextCursor || "";
        if (!nextCursor || seenCursors.has(nextCursor)) {
          throw new Error("The filtered job export could not advance safely. No CSV was created.");
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;
        page += 1;
      }

      if (expectedTotal === null || records.length !== expectedTotal) {
        throw new Error("The filtered job list changed during export. No CSV was created. Refresh the list and try again.");
      }
      const csv = exportDataforceJobCsv(records);
      const csvUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const download = document.createElement("a");
      download.href = csvUrl;
      download.download = "tlink-dataforce-compatible-jobs.csv";
      document.body.appendChild(download);
      download.click();
      download.remove();
      URL.revokeObjectURL(csvUrl);
      setStatus(`${records.length} filtered ${records.length === 1 ? "job" : "jobs"} downloaded in the exact Dataforce column order.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The complete filtered job export could not be created.");
    } finally {
      setJobExporting(false);
    }
  }, [jobExporting, jobIndexParams, user]);

  const loadCustomerIndex = useCallback(async (signal: AbortSignal) => {
    const token = await user.getIdToken();
    const params = new URLSearchParams({ mode: "index", resource: "customers", search: customerSearch, firstName: customerFirstName,
      lastName: customerLastName, businessName: customerBusinessName, email: customerEmail, street: customerStreet,
      phone: customerPhone, postcode: customerPostcode, suburb: customerSuburb, state: customerState, service: customerService,
      jobId: customerJobId, pipeline: customerPipeline, sort: customerSort, page: String(customerPage), pageSize: String(customerPageSize) });
    const cursor = customerCursors.current[customerPage - 1] || ""; if (cursor) params.set("cursor", cursor);
    if (customerTotalReady.current) params.set("total", "0");
    const response = await fetch(`/api/trade-crm?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal });
    const result = await response.json().catch(() => ({})) as CrmIndexResult;
    if (!response.ok || !result.ok) throw new Error(result.error || "The customer list could not be loaded.");
    if (signal.aborted) return;
    const items = (result.items || []) as Customer[];
    setIndexedCustomers(items);
    setCustomerPagination((current) => {
      const next = { ...current, ...(result.pagination || {}), page: customerPage, pageSize: customerPageSize };
      if (typeof result.pagination?.total === "number") customerTotalReady.current = true;
      if (next.hasNext && next.nextCursor) customerCursors.current[customerPage] = next.nextCursor;
      customerCursors.current.length = Math.max(customerPage, next.hasNext ? customerPage + 1 : customerPage); return next;
    });
  }, [customerBusinessName, customerEmail, customerFirstName, customerJobId, customerLastName, customerPage, customerPageSize, customerPhone, customerPipeline, customerPostcode, customerSearch, customerService, customerSort, customerState, customerStreet, customerSuburb, user]);

  useEffect(() => {
    jobCursors.current = [""]; jobTotalReady.current = false;
  }, [jobAppointmentId, jobAssignee, jobCustomer, jobCustomerReference, jobEmail, jobFilter, jobFirstName, jobId, jobInvoiceStatus, jobLastName, jobLocation, jobOperationalStatus, jobPageSize, jobPhone, jobPipeline, jobPostcode, jobQuoteTotalMax, jobQuoteTotalMin, jobScheduledFrom, jobScheduledTo, jobService, jobSort, jobStage, jobState, jobStreet, jobSuburb, pipelineFocus, search]);
  useEffect(() => {
    customerCursors.current = [""]; customerTotalReady.current = false;
  }, [customerBusinessName, customerEmail, customerFirstName, customerJobId, customerLastName, customerPageSize, customerPhone, customerPipeline, customerPostcode, customerSearch, customerService, customerSort, customerState, customerStreet, customerSuburb]);

  useEffect(() => {
    if (view !== "jobs" || creating === "job" || jobLayout !== "list" || focusedJobId) return;
    let active = true;
    const controller = new AbortController();
    const run = () => {
      if (active) setIndexLoading(true);
      void loadJobIndex(controller.signal).catch((error) => active && setStatus(error instanceof Error ? error.message : "The job list could not be loaded."))
        .finally(() => active && setIndexLoading(false));
    };
    const delay = jobIndexRequested.current ? 180 : 0;
    jobIndexRequested.current = true;
    const timer = delay ? window.setTimeout(run, delay) : 0;
    if (!delay) run();
    return () => { active = false; controller.abort(); if (timer) window.clearTimeout(timer); };
  }, [creating, focusedJobId, jobLayout, loadJobIndex, refreshNonce, view]);

  useEffect(() => {
    if (view !== "customers" || creating === "customer") return;
    let active = true;
    const controller = new AbortController();
    const run = () => {
      if (active) setIndexLoading(true);
      void loadCustomerIndex(controller.signal).catch((error) => active && setStatus(error instanceof Error ? error.message : "The customer list could not be loaded."))
        .finally(() => active && setIndexLoading(false));
    };
    const delay = customerIndexRequested.current ? 180 : 0;
    customerIndexRequested.current = true;
    const timer = delay ? window.setTimeout(run, delay) : 0;
    if (!delay) run();
    return () => { active = false; controller.abort(); if (timer) window.clearTimeout(timer); };
  }, [creating, loadCustomerIndex, refreshNonce, view]);

  useEffect(() => {
    if (view !== "jobs" || !focusedJobId) return;
    let active = true;
    const controller = new AbortController();
    void user.getIdToken().then((token) => fetch(`/api/trade-crm?mode=detail&resource=job&id=${encodeURIComponent(focusedJobId)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
    })).then(async (response) => {
      const result = await response.json().catch(() => ({})) as CrmDetailResult;
      if (!response.ok || !result.ok || !result.job) throw new Error(result.error || "The job record could not be loaded.");
      if (active) { setSelectedJobDetail(result.job); setSelectedJobCustomer(result.customer || null); setSelectedJobSites(result.sites || []); setFocusedJobRefreshing(false); }
    }).catch((error) => active && !controller.signal.aborted && setStatus(error instanceof Error ? error.message : "The job record could not be loaded."));
    return () => { active = false; controller.abort(); };
  }, [focusedJobId, refreshNonce, user, view]);

  useEffect(() => {
    if (view !== "jobs" || !focusedJobId) return;
    const refreshFocusedJob = (failClosed = false) => {
      if (document.visibilityState !== "visible") return;
      if (failClosed) setFocusedJobRefreshing(true);
      setRefreshNonce((value) => value + 1);
    };
    const handleFocus = () => refreshFocusedJob(true);
    const handleVisibilityChange = () => refreshFocusedJob(true);
    const interval = window.setInterval(() => refreshFocusedJob(), 30_000);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [focusedJobId, view]);

  useEffect(() => {
    if (view !== "customers" || !selectedCustomerId) return;
    let active = true;
    const controller = new AbortController();
    void user.getIdToken().then((token) => fetch(`/api/trade-crm?mode=detail&resource=customer&id=${encodeURIComponent(selectedCustomerId)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
    })).then(async (response) => {
      const result = await response.json().catch(() => ({})) as CrmDetailResult;
      if (!response.ok || !result.ok || !result.customer) throw new Error(result.error || "The customer record could not be loaded.");
      if (active) {
        setSelectedCustomerDetail(result.customer);
        setSelectedCustomerJobs(result.jobs || []);
        setSelectedCustomerContacts(result.contacts || []);
        setSelectedCustomerSites(result.sites || []);
      }
    }).catch((error) => active && !controller.signal.aborted && setStatus(error instanceof Error ? error.message : "The customer record could not be loaded."));
    return () => { active = false; controller.abort(); };
  }, [refreshNonce, selectedCustomerId, user, view]);

  useEffect(() => {
    if (view !== "today") return;
    let active = true;
    void user.getIdToken().then((token) => fetch("/api/trade-crm?mode=summary", {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    })).then(async (response) => {
      const result = await response.json().catch(() => ({})) as CrmSummaryResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "The workday summary could not be loaded.");
      if (active) setSummary(result);
    }).catch((error) => active && setStatus(error instanceof Error ? error.message : "The workday summary could not be loaded."));
    return () => { active = false; };
  }, [refreshNonce, user, view]);

  useEffect(() => {
    if (view !== "reports") return;
    let active = true;
    void user.getIdToken().then((token) => fetch("/api/trade-crm?mode=reports", {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    })).then(async (response) => {
      const result = await response.json().catch(() => ({})) as CrmReportResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "The business report could not be loaded.");
      if (active) setReport(result);
    }).catch((error) => active && setStatus(error instanceof Error ? error.message : "The business report could not be loaded."));
    return () => { active = false; };
  }, [refreshNonce, user, view]);

  useEffect(() => {
    if (view !== "jobs" || jobLayout !== "board") return;
    let active = true;
    const stages = ["enquiry", "qualifying", "quoting", "approved", "scheduled", "in_progress"];
    void user.getIdToken().then(async (token) => {
      const results = await Promise.all(stages.map(async (stage) => {
        const params = new URLSearchParams({ mode: "index", resource: "jobs", filter: "all", pipeline: stage, sort: "updated-desc", page: "1", pageSize: "25" });
        const response = await fetch(`/api/trade-crm?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const result = await response.json().catch(() => ({})) as CrmIndexResult;
        if (!response.ok || !result.ok) throw new Error(result.error || "The job board could not be loaded.");
        return [stage, (result.items || []) as Job[], result.pagination?.total || 0] as const;
      }));
      if (active) {
        setBoardJobs(Object.fromEntries(results.map(([stage, items]) => [stage, items])));
        setBoardCounts(Object.fromEntries(results.map(([stage, , total]) => [stage, total])));
      }
    }).catch((error) => active && setStatus(error instanceof Error ? error.message : "The job board could not be loaded."));
    return () => { active = false; };
  }, [jobLayout, refreshNonce, user, view]);

  useEffect(() => {
    onViewChange?.(view);
  }, [onViewChange, view]);

  useEffect(() => {
    if (!navigationTarget) return;
    const frame = window.requestAnimationFrame(() => {
      if (navigationTarget.kind === "job") {
        setCreating("");
        setSearch("");
        setJobReturnTarget({ kind: "jobs" });
        setFocusedJobRefreshing(true);
        setFocusedJobId(navigationTarget.id);
        setFocusedJobTab(navigationTarget.jobTab || "summary");
        setJobLayout("list");
        setView("jobs");
        setRefreshNonce((value) => value + 1);
      } else if (navigationTarget.kind === "customer") {
        setCreating("");
        setSelectedCustomerId(navigationTarget.id);
        setView("customers");
      } else if (navigationTarget.kind === "new-job" && canCreateJob) {
        setNewJobSeed(null);
        setView("jobs");
        setCreating("job");
      } else if (navigationTarget.kind === "new-customer" && canCreateCustomer) {
        setView("customers");
        setCreating("customer");
      } else if (navigationTarget.kind === "crm-view" && (
        navigationTarget.id === "jobs" || navigationTarget.id === "customers"
        || navigationTarget.id === "pricebook" || navigationTarget.id === "today"
        || navigationTarget.id === "schedule"
        || navigationTarget.id === "integrations"
      )) {
        if (navigationTarget.id === "schedule") {
          setScheduleWeekStart(
            /^\d{4}-\d{2}-\d{2}$/.test(navigationTarget.query)
              ? navigationTarget.query
              : "",
          );
        }
        setCreating("");
        setFocusedJobId("");
        setJobReturnTarget({ kind: "jobs" });
        if (allowedViews.includes(navigationTarget.id)) setView(navigationTarget.id);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [allowedViews, canCreateCustomer, canCreateJob, navigationTarget, teamAccess]);

  function openFocusedJob(id: string, tab: JobTab = "summary", returnTarget: JobReturnTarget = { kind: "jobs" }) {
    setCreating("");
    setJobReturnTarget(returnTarget);
    setFocusedJobId(id);
    setFocusedJobTab(tab);
    setJobLayout("list");
    setView("jobs");
  }

  function closeFocusedJob() {
    setFocusedJobId("");
    setSelectedJobDetail(null);
    if (jobReturnTarget.kind === "customer") {
      setSelectedCustomerId(jobReturnTarget.customerId);
      setView("customers");
    }
    setJobReturnTarget({ kind: "jobs" });
  }

  async function crmRequest(method: "POST" | "PATCH", body: Record<string, unknown>, busyKey: string, success: string) {
    setBusy(busyKey); setStatus("Saving your private business record...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-crm", {
        method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; calendarSync?: AppointmentCalendarSync };
      if (!response.ok || !result.ok) throw new Error(result.error || "The CRM update could not be saved.");
      const calendarFailed = Number(result.calendarSync?.failed || 0);
      await load(); setRefreshNonce((value) => value + 1);
      setStatus(calendarFailed
        ? `${success} Calendar sync needs another try. ${calendarFailed} ${calendarFailed === 1 ? "update was" : "updates were"} not completed.`
        : success);
      return true;
    } catch (error) { setStatus(error instanceof Error ? error.message : "The CRM update could not be saved."); return false; }
    finally { setBusy(""); }
  }

  async function bulkRequest(body: Record<string, unknown>, busyKey: string, success: string) {
    setBusy(busyKey); setStatus("Updating the selected records...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-crm", {
        method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "The selected records could not be updated.");
      setSelectedCustomerIds([]); setRefreshNonce((value) => value + 1); setStatus(success);
    } catch (error) { setStatus(error instanceof Error ? error.message : "The selected records could not be updated."); }
    finally { setBusy(""); }
  }

  const metrics: CrmMetrics = summary.metrics || { openJobs: 0, nextVisits: 0, todayVisits: 0, awaitingSchedule: 0, overdueTasks: 0, openIssues: 0, waitingJobs: 0, completedJobs: 0, quotedCents: 0, invoicedCents: 0, paidCents: 0, outstandingCents: 0 };
  const workload: Array<WorkloadBucket & { fallbackLabel?: string }> = summary.workload?.length === 4 ? summary.workload : Array.from({ length: 4 }, (_, index) => ({ weekStart: "", weekEnd: "", visits: 0, bookedMinutes: 0, fallbackLabel: index === 0 ? "This week" : `Week ${index + 1}` }));
  const workStages = (["backlog", "ready", "scheduled", "in_progress", "blocked"] as const).map((stage) => ({ stage, label: workStageLabels[stage], count: Number(summary.workStages?.[stage] || 0) }));
  const workloadMax = Math.max(1, ...workload.map((item) => item.bookedMinutes));
  const workStageMax = Math.max(1, ...workStages.map((item) => item.count));
  const upcomingAppointments = summary.upcomingAppointments || [];
  const overdueTasks = summary.overdueTasks || [];
  const openIssues = summary.openIssues || [];
  const reportMetrics = report.metrics || metrics;
  const pipelineCounts = report.pipeline || {};
  const pipelineTotal = Object.values(pipelineCounts).reduce((total, count) => total + count, 0);
  const jobGridStyle = indexGridStyle(jobColumns, jobIndexColumns);
  const customerGridStyle = indexGridStyle(customerColumns, customerIndexColumns);
  const jobRecordStyle: CSSProperties = { gridTemplateColumns: "minmax(0, 1fr)", minWidth: Number(jobGridStyle.minWidth || 0) };
  const customerRecordStyle: CSSProperties = { gridTemplateColumns: "30px minmax(0, 1fr)", minWidth: Number(customerGridStyle.minWidth || 0) + 40 };
  function openVisualSchedule(weekStart?: string) {
    if (onOpenSchedule) { onOpenSchedule(weekStart); return; }
    setScheduleWeekStart(weekStart || "");
    setView("schedule");
  }
  function openJobCustomerEditor(job: Job) {
    if (!job.crmCustomerId || job.customerSource === "platform_private") return;
    setJobActionId("");
    setFocusedJobId("");
    setSelectedJobDetail(null);
    setSelectedCustomerDetail(null);
    setSelectedCustomerId(job.crmCustomerId);
    setView("customers");
  }
  function openJobActions(event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, jobId: string) {
    if ("button" in event && event.button !== 2) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointer = "clientX" in event && event.clientX > 0;
    const requestedLeft = pointer ? event.clientX : rect.left + 12;
    const requestedTop = pointer ? event.clientY : rect.top + 36;
    setJobActionPosition({
      left: Math.max(8, Math.min(requestedLeft, window.innerWidth - 196)),
      top: Math.max(8, Math.min(requestedTop, window.innerHeight - 236)),
    });
    setJobActionId(jobId);
  }
  function jobActionMenu(job: Job) {
    const open = jobActionId === job.id;
    const selfMemberId = teamMembers.find((member) => member.isSelf)?.id || "";
    const canOpenScheduleAction = !staffPermissions || staffPermissions.canAssignJobs
      || staffPermissions.scheduleScope === "team" || job.assigneeMemberId === selfMemberId
      || job.appointments.some((appointment) => appointment.assigneeMemberId === selfMemberId);
    return <div className={registerStyles.actions} onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" data-job-action-trigger={job.id} className={registerStyles.actionTrigger} aria-label={`Actions for ${job.workNumber}`} aria-haspopup="menu" aria-expanded={open} onClick={(event) => {
        if (open) { setJobActionId(""); return; }
        const rect = event.currentTarget.getBoundingClientRect();
        setJobActionPosition({
          left: Math.max(8, Math.min(rect.right - 180, window.innerWidth - 196)),
          top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 236)),
        });
        setJobActionId(job.id);
      }}>Actions</button>
      {open && typeof document !== "undefined" && createPortal(<div className={registerStyles.actionMenu} style={jobActionPosition} role="menu" aria-label={`Actions for ${job.workNumber}`} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=\"menuitem\"]")];
        const current = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (current + 1) % items.length : (current - 1 + items.length) % items.length;
        items[next]?.focus();
      }}>
        <button autoFocus role="menuitem" type="button" onClick={() => { setJobActionId(""); openFocusedJob(job.id, "summary"); }}>View details</button>
        {(!staffPermissions || staffPermissions.canManageJobs) && <button role="menuitem" type="button" onClick={() => { setJobActionId(""); openFocusedJob(job.id, "summary"); }}>Edit details</button>}
        {(!staffPermissions || (staffPermissions.canViewCustomers && staffPermissions.canManageCustomers)) && job.customerSource !== "platform_private" && job.crmCustomerId && <button role="menuitem" type="button" onClick={() => openJobCustomerEditor(job)}>Edit customer</button>}
        {canOpenScheduleAction && <button role="menuitem" type="button" onClick={() => { setJobActionId(""); openFocusedJob(job.id, "schedule"); }}>Schedule job</button>}
      </div>, document.body)}
    </div>;
  }
  function openJobsForStage(stage: string) {
    setCreating(""); setFocusedJobId(""); setJobReturnTarget({ kind: "jobs" }); setJobFilter("active"); setJobStage(stage); setJobPage(1); setView("jobs");
  }
  function openOverdueWork() {
    if (overdueTasks[0]) { openFocusedJob(overdueTasks[0].job.id); return; }
    setCreating(""); setFocusedJobId(""); setJobReturnTarget({ kind: "jobs" }); setJobFilter("active"); setJobStage(""); setJobPage(1); setView("jobs");
  }
  function currentListPreferences(viewKey: "installer-jobs" | "installer-customers"): WorkspaceListPreferences {
    return viewKey === "installer-jobs"
      ? { search, customer: jobCustomer, service: jobService, pipeline: jobPipeline, stage: jobStage, assignee: jobAssignee, location: jobLocation,
        appointmentId: jobAppointmentId, jobId, scheduledFrom: jobScheduledFrom, scheduledTo: jobScheduledTo,
        invoiceStatus: jobInvoiceStatus, customerReference: jobCustomerReference, email: jobEmail, phone: jobPhone,
        suburb: jobSuburb, postcode: jobPostcode, firstName: jobFirstName, lastName: jobLastName, street: jobStreet,
        state: jobState, operationalStatus: jobOperationalStatus, quoteTotalMin: jobQuoteTotalMin, quoteTotalMax: jobQuoteTotalMax,
        filter: jobFilter, sort: jobSort, pageSize: jobPageSize, jobColumnOrderVersion: 3, columns: jobColumns }
      : { search: customerSearch, firstName: customerFirstName, lastName: customerLastName, businessName: customerBusinessName,
        email: customerEmail, street: customerStreet, phone: customerPhone, postcode: customerPostcode,
        suburb: customerSuburb, state: customerState, service: customerService, jobId: customerJobId,
        pipeline: customerPipeline, filter: "all", sort: customerSort, pageSize: customerPageSize, columns: customerColumns };
  }
  function applyListPreferences(viewKey: "installer-jobs" | "installer-customers", preferences: Partial<WorkspaceListPreferences>) {
    if (viewKey === "installer-jobs") {
      setSearch(preferences.search || ""); setJobCustomer(preferences.customer || ""); setJobService(preferences.service || "");
      setJobPipeline(preferences.pipeline || ""); setJobStage(preferences.stage || ""); setJobAssignee(preferences.assignee || ""); setJobLocation(preferences.location || "");
      setJobAppointmentId(preferences.appointmentId || ""); setJobId(preferences.jobId || "");
      setJobScheduledFrom(preferences.scheduledFrom || ""); setJobScheduledTo(preferences.scheduledTo || "");
      setJobInvoiceStatus(preferences.invoiceStatus || ""); setJobCustomerReference(preferences.customerReference || "");
      setJobEmail(preferences.email || ""); setJobPhone(preferences.phone || ""); setJobSuburb(preferences.suburb || ""); setJobPostcode(preferences.postcode || "");
      setJobFirstName(preferences.firstName || ""); setJobLastName(preferences.lastName || ""); setJobStreet(preferences.street || ""); setJobState(preferences.state || "");
      setJobOperationalStatus(preferences.operationalStatus || ""); setJobQuoteTotalMin(preferences.quoteTotalMin || ""); setJobQuoteTotalMax(preferences.quoteTotalMax || "");
      setJobFilter(preferences.filter || "all"); setJobSort(preferences.sort || "updated-desc"); setJobPageSize(Number(preferences.pageSize) || 25);
      setJobColumns(safeJobRegisterColumns(preferences.columns)); setJobPage(1);
      jobCursors.current = [""]; jobTotalReady.current = false;
      return;
    }
    setCustomerSearch(preferences.search || ""); setCustomerFirstName(preferences.firstName || ""); setCustomerLastName(preferences.lastName || "");
    setCustomerBusinessName(preferences.businessName || ""); setCustomerEmail(preferences.email || ""); setCustomerStreet(preferences.street || "");
    setCustomerPhone(preferences.phone || ""); setCustomerPostcode(preferences.postcode || ""); setCustomerSuburb(preferences.suburb || "");
    setCustomerState(preferences.state || ""); setCustomerService(preferences.service || ""); setCustomerJobId(preferences.jobId || "");
    setCustomerPipeline(preferences.pipeline || ""); setCustomerSort(preferences.sort || "name-asc"); setCustomerPageSize(Number(preferences.pageSize) || 25);
    setCustomerColumns(preferences.columns?.length ? preferences.columns : columnKeys(customerIndexColumns)); setCustomerPage(1); setSelectedCustomerIds([]);
    customerCursors.current = [""]; customerTotalReady.current = false;
  }
  async function updateListView(viewKey: "installer-jobs" | "installer-customers", method: "PATCH" | "DELETE") {
    setViewBusy(true);
    try {
      const token = await user.getIdToken();
      const body = currentListPreferences(viewKey);
      const response = await fetch(`/api/trade-list-views?view=${viewKey}`, {
        method, headers: { Authorization: `Bearer ${token}`, ...(method === "PATCH" ? { "Content-Type": "application/json" } : {}) },
        body: method === "PATCH" ? JSON.stringify(body) : undefined,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "The default list view could not be saved.");
      const preferences = (result.preferences || {}) as Partial<WorkspaceListPreferences>;
      if (viewKey === "installer-jobs") {
        if (method === "DELETE") applyListPreferences(viewKey, preferences);
        setJobViewSaved(method === "PATCH");
      } else {
        if (method === "DELETE") applyListPreferences(viewKey, preferences);
        setCustomerViewSaved(method === "PATCH");
      }
      setStatus(method === "PATCH" ? "Default list view saved." : "Default list view reset.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The default list view could not be saved."); }
    finally { setViewBusy(false); }
  }

  async function saveNamedView(viewKey: "installer-jobs" | "installer-customers", name: string, presetId = "") {
    setViewBusy(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/trade-list-views?view=${viewKey}${presetId ? `&preset=${encodeURIComponent(presetId)}` : ""}`, {
        method: presetId ? "PATCH" : "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, preferences: currentListPreferences(viewKey) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok || !result.preset) throw new Error(result.error || "The saved view could not be updated.");
      const preset = result.preset as NamedWorkspaceListView;
      if (viewKey === "installer-jobs") {
        setJobPresets((current) => [preset, ...current.filter((item) => item.id !== preset.id)]); setActiveJobPresetId(preset.id);
      } else {
        setCustomerPresets((current) => [preset, ...current.filter((item) => item.id !== preset.id)]); setActiveCustomerPresetId(preset.id);
      }
      setStatus(presetId ? "Saved view updated." : "Saved view created.");
      return true;
    } catch (error) { setStatus(error instanceof Error ? error.message : "The saved view could not be updated."); return false; }
    finally { setViewBusy(false); }
  }

  async function deleteNamedView(viewKey: "installer-jobs" | "installer-customers", presetId: string) {
    setViewBusy(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/trade-list-views?view=${viewKey}&preset=${encodeURIComponent(presetId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "The saved view could not be deleted.");
      if (viewKey === "installer-jobs") { setJobPresets((current) => current.filter((item) => item.id !== presetId)); setActiveJobPresetId(""); }
      else { setCustomerPresets((current) => current.filter((item) => item.id !== presetId)); setActiveCustomerPresetId(""); }
      setStatus("Saved view deleted.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The saved view could not be deleted."); }
    finally { setViewBusy(false); }
  }

  async function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const saved = await crmRequest("POST", {
      action: "create_customer", customerType: data.get("customerType"), firstName: data.get("firstName"),
      lastName: data.get("lastName"), businessName: data.get("businessName"), email: data.get("email"),
      phone: data.get("phone"), addressLine1: data.get("addressLine1"), addressLine2: data.get("addressLine2"), suburb: data.get("suburb"),
      addressState: data.get("addressState"), postcode: data.get("postcode"), tags: data.get("tags"),
    }, "create-customer", "Customer added to your private CRM.");
    if (saved) { form.reset(); setCreating(""); setView("customers"); }
  }

  async function createJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    setBusy("create-job"); setStatus("Creating the customer, service site and job together...");
    try {
      const token = await user.getIdToken();
      const body = Object.fromEntries(data);
      const response = await fetch("/api/trade-crm", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "create_scheduled_job", ...body }) });
      const result = await response.json().catch(() => ({})) as CreateJobResult;
      if (!response.ok || !result.ok) {
        const matches = result.duplicateCandidates?.map((item) => `${item.displayName} (${item.customerNumber}: ${item.reasons.join(", ")})`).join("; ");
        throw new Error(matches ? `${result.error} Matches: ${matches}.` : result.error || "The customer, service site and job were not created.");
      }
      await load(); setRefreshNonce((value) => value + 1);
      const calendarFailed = Number(result.calendarFailed || 0);
      const calendarSynced = Number(result.calendarSynced || 0);
      const creationResults = [
        `${result.workNumber || "Job"} created and scheduled in TLink.`,
        result.complianceIntentPlanned ? "The planned government activity is available to the assigned compliance team for setup review; no regulated case or certificate was created." : "",
        calendarSynced ? `${calendarSynced} connected calendar ${calendarSynced === 1 ? "item" : "items"} updated.` : "",
        calendarFailed ? `Calendar sync needs another try. ${calendarFailed} ${calendarFailed === 1 ? "update was" : "updates were"} not completed.` : "",
      ].filter(Boolean).join(" ");
      setStatus(creationResults);
      form.reset(); setNewJobSeed(null); setCreating(""); setView("jobs");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The customer, service site and job were not created."); }
    finally { setBusy(""); }
  }

  async function createTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const saved = await crmRequest("POST", {
      action: "create_template", name: data.get("name"), title: data.get("title"),
      serviceCategory: data.get("serviceCategory"), priority: data.get("priority"),
      description: data.get("description"), taskTitles: data.get("taskTitles"),
    }, "create-template", "Reusable job template saved.");
    if (saved) form.reset();
  }

  return <section id="business-hub" className="installer-crm" aria-labelledby="installer-crm-title">
    <header className="crm-hero">
      <div><span>Installer business workspace</span><h2 id="installer-crm-title">Run the day from one clear place</h2><p>Manage your own customers, jobs, visits, tasks, issues, quotes, invoices and handovers. Australian Energy Assessments customer identities remain protected.</p></div>
      {(canCreateJob || canCreateCustomer) && <div className="crm-primary-actions"><AccessibleMenu className="crm-quick-create" label="New">{(close) => <>{canCreateJob && <button role="menuitem" type="button" onClick={() => { setNewJobSeed(null); setView("jobs"); setCreating("job"); close(); }}>Job</button>}{canCreateCustomer && allowedViews.includes("customers") && <button role="menuitem" type="button" onClick={() => { setView("customers"); setCreating("customer"); close(); }}>Customer</button>}</>}</AccessibleMenu></div>}
    </header>
    <nav className="crm-nav" aria-label="Installer CRM">
      {allowedViews.map((item) => <button key={item} type="button" className={view === item ? "active" : ""} aria-current={view === item ? "page" : undefined} onClick={() => {
        if (item === "schedule") { openVisualSchedule(); return; }
        if (item === "pricebook") setPriceBookView("items");
        if (item === "jobs") { setFocusedJobId(""); setJobReturnTarget({ kind: "jobs" }); }
        if (item === "customers") { setSelectedCustomerId(""); setSelectedCustomerDetail(null); }
        setCreating(""); setView(item);
      }}>{item === "today" ? "My day" : item === "pricebook" ? "Price book" : item === "import" ? "Import data" : item[0].toUpperCase() + item.slice(1)}</button>)}
    </nav>
    <div className="crm-privacy-line"><strong>Clear privacy boundary</strong><span><b>Australian Energy Assessments protected:</b> reference and region only</span><span><b>Your customer:</b> contacts your business already owns</span></div>

    {view === "today" && <div className="crm-view crm-today">
      <section className="crm-metrics" aria-label="Workday shortcuts">
        <article><button type="button" onClick={() => openVisualSchedule()} aria-label={`Open today's ${metrics.todayVisits} scheduled visits`}><span>Today visits</span><strong>{metrics.todayVisits}</strong><small>Appointments today</small></button></article>
        <article className={metrics.awaitingSchedule ? "attention" : ""}><button type="button" onClick={() => openVisualSchedule()} aria-label={`Open schedule for ${metrics.awaitingSchedule} jobs awaiting a visit`}><span>Awaiting schedule</span><strong>{metrics.awaitingSchedule}</strong><small>Jobs without a future visit</small></button></article>
        <article className={metrics.overdueTasks ? "attention" : ""}><button type="button" onClick={openOverdueWork} aria-label={`Open ${metrics.overdueTasks} overdue tasks`}><span>Overdue tasks</span><strong>{metrics.overdueTasks}</strong><small>Tasks needing action</small></button></article>
        <article className={metrics.waitingJobs ? "attention" : ""}><button type="button" onClick={() => openJobsForStage("blocked")} aria-label={`Open ${metrics.waitingJobs} waiting jobs`}><span>Waiting jobs</span><strong>{metrics.waitingJobs}</strong><small>Jobs marked waiting</small></button></article>
      </section>
      <section className="crm-dashboard-insights" aria-label="Workload and work status">
        <article className="crm-dashboard-chart crm-workload-chart"><header><div><span>Four week outlook</span><h3>Booked work</h3></div><small>Monday to Sunday</small></header><ol className="crm-chart-list">{workload.map((item, index) => { const weekLabel = item.weekStart ? `${shortDateLabel(item.weekStart)} to ${shortDateLabel(item.weekEnd)}` : item.fallbackLabel || `Week ${index + 1}`; const timeLabel = bookedTimeLabel(item.bookedMinutes); return <li key={item.weekStart || index}><button type="button" className="crm-chart-row" onClick={() => openVisualSchedule(item.weekStart || undefined)} aria-label={`Open schedule for ${weekLabel}. ${item.visits} visits and ${timeLabel} booked.`}><span className="crm-chart-label"><strong>{weekLabel}</strong><small>{item.visits} {item.visits === 1 ? "visit" : "visits"}</small></span><meter className="crm-chart-bar" min={0} max={workloadMax} value={item.bookedMinutes}>{item.bookedMinutes}</meter><span className="crm-chart-value">{timeLabel} booked</span></button></li>; })}</ol></article>
        <article className="crm-dashboard-chart crm-work-status-chart"><header><div><span>Current jobs</span><h3>Work status</h3></div><small>{metrics.openJobs} open</small></header><ol className="crm-chart-list">{workStages.map((item) => <li key={item.stage}><button type="button" className="crm-chart-row" onClick={() => openJobsForStage(item.stage)} aria-label={`Open ${item.count} jobs with ${item.label} status`}><span className="crm-chart-label"><strong>{item.label}</strong><small>{item.count} {item.count === 1 ? "job" : "jobs"}</small></span><meter className="crm-chart-bar" min={0} max={workStageMax} value={item.count}>{item.count}</meter><span className="crm-chart-value">{item.count}</span></button></li>)}</ol></article>
      </section>
      <div className="crm-today-grid">
        <section className="crm-card"><header><div><span>Next up</span><h3>Schedule</h3></div><button type="button" onClick={() => openVisualSchedule()}>Open schedule</button></header>{upcomingAppointments.length ? <ol className="crm-agenda">{upcomingAppointments.slice(0, 6).map((item) => <li key={item.id}><time>{dateLabel(item.startsAt, true)}</time><button type="button" onClick={() => openFocusedJob(item.job.id)}><strong>{item.title}</strong><span>{item.job.workNumber} | {item.job.title}</span></button></li>)}</ol> : <div className="crm-empty"><strong>No upcoming visits</strong><span>Add an appointment from any job.</span></div>}</section>
        <section className="crm-card"><header><div><span>Attention</span><h3>Things to clear</h3></div></header>{!overdueTasks.length && !openIssues.length ? <div className="crm-empty"><strong>You are up to date</strong><span>No overdue tasks or open issues.</span></div> : <ul className="crm-attention-list">{overdueTasks.slice(0, 4).map((item) => <li key={item.id}><span>Overdue task</span><button type="button" onClick={() => openFocusedJob(item.job.id)}>{item.title}<small>{item.job.workNumber}</small></button></li>)}{openIssues.slice(0, 4).map((item) => <li key={item.id}><span>Open issue</span><button type="button" onClick={() => openFocusedJob(item.job.id)}>{item.body}<small>{item.job.workNumber}</small></button></li>)}</ul>}</section>
      </div>
      <nav className="crm-today-actions" aria-label="Quick actions"><button type="button" className="primary" onClick={() => { setNewJobSeed(null); setFocusedJobId(""); setView("jobs"); setCreating("job"); }}>New job</button><button type="button" onClick={() => openVisualSchedule()}>Schedule</button><button type="button" onClick={() => { setCreating(""); setView("customers"); }}>Customers</button><button type="button" onClick={() => { setPriceBookView("items"); setView("pricebook"); }}>Price book</button><button type="button" onClick={() => { setPriceBookView("packets"); setView("pricebook"); }}>Common jobs</button><button type="button" onClick={() => onOpenInvoices?.()} disabled={!onOpenInvoices}>Invoices</button></nav>
    </div>}
    {view === "enquiries" && <div className="crm-view"><TradeEnquiryInbox user={user} onConverted={async (seed) => { setRefreshNonce((value) => value + 1); setNewJobSeed(seed); setFocusedJobId(""); setView("jobs"); setCreating("job"); }} /></div>}

    {view === "jobs" && creating === "job" && <div className="crm-view crm-create-screen">
      <div className="crm-page-heading"><div><span>New job</span><h3>Create a clear work record</h3><p>Only the essentials are needed now. TLink assigns a private support reference after saving.</p></div><button type="button" className="crm-back-button" onClick={() => setCreating("")}>Back to all jobs</button></div>
      <section className="crm-create-card"><div className="crm-create-guidance"><strong>One guided setup</strong><p>Create the job once, plan the relevant certificate activity, schedule the visit and carry the same TLink ID into field capture and compliance review.</p></div><TradeNewJobForm key={newJobSeed?.sourceEnquiryId || "blank-job"} user={user} templates={templates} teamMembers={teamMembers} allowCustomerSearch={canSearchCustomerDirectory} canAssignJobs={!staffPermissions || staffPermissions.canAssignJobs} assignmentScope={staffPermissions?.jobScope || "team"} busy={busy === "create-job"} initial={newJobSeed || undefined} onSubmit={createJob} /></section>
    </div>}

    {view === "jobs" && creating !== "job" && focusedJobId && <div className="crm-view crm-job-workspace">
      <div className="crm-page-heading"><div><span>Job workspace</span><h3>{selectedJobDetail?.id === focusedJobId ? selectedJobDetail.workNumber : "Opening job"}</h3><p>Edit the job, schedule, quote, field record and invoice from one focused page.</p></div><button type="button" className="crm-back-button" onClick={closeFocusedJob}>{jobReturnTarget.kind === "customer" ? `Back to ${jobReturnTarget.customerName}` : "Back to all jobs"}</button></div>
      {selectedJobDetail?.id === focusedJobId ? <JobDetail key={`${selectedJobDetail.id}:${focusedJobTab}`} job={selectedJobDetail} customer={selectedJobCustomer || undefined} sites={selectedJobSites} user={user} busy={busy} refreshing={focusedJobRefreshing} teamMembers={teamMembers} permissions={staffPermissions} initialTab={focusedJobTab} onCrm={crmRequest} onWorkOrder={crmRequest} onOpenJob={(workOrderId) => openFocusedJob(workOrderId, "schedule")} onOpenPriceBook={() => { setPriceBookView("items"); setView("pricebook"); }} onOpenCustomer={(customerId) => { setFocusedJobId(""); setSelectedJobDetail(null); setSelectedCustomerId(customerId); setView("customers"); }} onOpenIntegrations={() => setView("integrations")} onReload={async () => { setFocusedJobRefreshing(true); setRefreshNonce((value) => value + 1); }} /> : <div className="crm-empty"><strong>Loading job...</strong><span>The full job record will open here.</span></div>}
    </div>}

    {view === "jobs" && creating !== "job" && !focusedJobId && <div className="crm-view">
      <div className="crm-page-heading"><div><span>Job management</span><h3>Jobs</h3><p>Find work by customer, reference, activity, installer, suburb or status. Open only the job you need.</p></div></div>
      <div className={`${registerStyles.toolbar} crm-job-toolbar`}>{canSearchCustomerFields && <label><span>Find a job</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setJobPage(1); }} placeholder="Name, number, email, address or job ID" /></label>}<label><span>Status</span><select value={jobOperationalStatus} onChange={(event) => { setJobOperationalStatus(event.target.value); setJobPage(1); }}><option value="">All statuses</option><option value="quoting">Quoting</option><option value="assigned">Assigned</option><option value="complete">Complete</option><option value="audited">Audited</option><option value="certified">Certified</option><option value="cancelled">Cancelled</option></select></label><label><span>Assigned worker</span><input value={jobAssignee} onChange={(event) => { setJobAssignee(event.target.value); setJobPage(1); }} placeholder="Any worker" /></label><label className="crm-index-sort"><span>Sort</span><select value={jobSort} onChange={(event) => { setJobSort(event.target.value); setJobPage(1); }}><option value="updated-desc">Recently updated</option><option value="number-asc">Job ID A to Z</option><option value="number-desc">Job ID Z to A</option><option value="first-name-asc">First name A to Z</option><option value="last-name-asc">Last name A to Z</option><option value="phone-asc">Contact number</option><option value="email-asc">Email</option><option value="street-asc">Street address</option><option value="postcode-asc">Postcode</option><option value="suburb-asc">Suburb</option><option value="state-asc">State</option><option value="assignee-asc">Assigned worker</option><option value="date-asc">Schedule date</option><option value="status-asc">Operational status</option>{(!staffPermissions || staffPermissions.canViewQuotes) && <><option value="quote-total-desc">Quote total high to low</option><option value="quote-total-asc">Quote total low to high</option></>}</select></label><div className="crm-layout-toggle" role="group" aria-label="Job layout"><button type="button" className={jobLayout === "list" ? "active" : ""} onClick={() => setJobLayout("list")}>Register</button><button type="button" className={jobLayout === "board" ? "active" : ""} onClick={() => { setPipelineFocus(""); setJobLayout("board"); }}>Board</button></div></div>
      {jobLayout === "list" && <details className="crm-granular-filters"><summary>Detailed job filters</summary><div>
        {canSearchCustomerFields && <><label><span>First name</span><input value={jobFirstName} onChange={(event) => { setJobFirstName(event.target.value); setJobPage(1); }} /></label><label><span>Last name</span><input value={jobLastName} onChange={(event) => { setJobLastName(event.target.value); setJobPage(1); }} /></label></>}
        <label><span>Activity</span><select value={jobService} onChange={(event) => { setJobService(event.target.value); setJobPage(1); }}><option value="">All activities</option>{serviceOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {canSearchCustomerFields && <label><span>Street address</span><input value={jobStreet} onChange={(event) => { setJobStreet(event.target.value); setJobPage(1); }} /></label>}
        <label><span>Job ID</span><input value={jobId} onChange={(event) => { setJobId(event.target.value); setJobPage(1); }} placeholder="TLink job reference" /></label>
        <label><span>Scheduled from</span><input type="date" value={jobScheduledFrom} data-date-range-group="installer-job-scheduled" data-date-range-role="start" onChange={(event) => { setJobScheduledFrom(event.target.value); setJobPage(1); }} /></label>
        <label><span>Scheduled to</span><input type="date" value={jobScheduledTo} data-date-range-group="installer-job-scheduled" data-date-range-role="end" onChange={(event) => { setJobScheduledTo(event.target.value); setJobPage(1); }} /></label>
        {canSearchCustomerFields && <><label><span>Email</span><input type="email" value={jobEmail} onChange={(event) => { setJobEmail(event.target.value); setJobPage(1); }} /></label><label><span>Contact number</span><input type="tel" inputMode="tel" value={jobPhone} onChange={(event) => { setJobPhone(event.target.value.replace(/[^\d+()\s-]/g, "")); setJobPage(1); }} /></label><label><span>Suburb</span><input value={jobSuburb} onChange={(event) => { setJobSuburb(event.target.value); setJobPage(1); }} /></label><label><span>Postcode</span><input inputMode="numeric" value={jobPostcode} onChange={(event) => { setJobPostcode(event.target.value.replace(/\D/g, "").slice(0, 4)); setJobPage(1); }} /></label><label><span>State</span><select value={jobState} onChange={(event) => { setJobState(event.target.value); setJobPage(1); }}><option value="">All states</option>{["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"].map((value) => <option key={value}>{value}</option>)}</select></label></>}
        {(!staffPermissions || staffPermissions.canViewQuotes) && <><label><span>Quote total ex GST from</span><input type="number" min="0" step="0.01" value={jobQuoteTotalMin} onChange={(event) => { setJobQuoteTotalMin(event.target.value); setJobPage(1); }} /></label><label><span>Quote total ex GST to</span><input type="number" min="0" step="0.01" value={jobQuoteTotalMax} onChange={(event) => { setJobQuoteTotalMax(event.target.value); setJobPage(1); }} /></label></>}
        <button type="button" onClick={() => { setSearch(""); setJobCustomer(""); setJobService(""); setJobPipeline(""); setJobStage(""); setJobAssignee(""); setJobLocation(""); setJobAppointmentId(""); setJobId(""); setJobScheduledFrom(""); setJobScheduledTo(""); setJobInvoiceStatus(""); setJobCustomerReference(""); setJobEmail(""); setJobPhone(""); setJobSuburb(""); setJobPostcode(""); setJobFirstName(""); setJobLastName(""); setJobStreet(""); setJobState(""); setJobOperationalStatus(""); setJobQuoteTotalMin(""); setJobQuoteTotalMax(""); setPipelineFocus(""); setJobPage(1); }}>Clear filters</button>
      </div></details>}
      {pipelineFocus && <div className="crm-filter-notice"><span>Showing {pipelineLabels[pipelineFocus] || pipelineFocus}</span><button type="button" onClick={() => setPipelineFocus("")}>Clear stage</button></div>}
      {jobLayout === "list" && <div className="crm-index-view-tools">{!staffPermissions && <WorkspaceSavedViews presets={jobPresets} activeId={activeJobPresetId} busy={viewBusy}
        onApply={(preset) => { applyListPreferences("installer-jobs", preset.preferences); setActiveJobPresetId(preset.id); setStatus(`${preset.name} view applied.`); }}
        onClear={() => setActiveJobPresetId("")}
        onCreate={(name) => saveNamedView("installer-jobs", name)} onRename={(id, name) => saveNamedView("installer-jobs", name, id)} onDelete={(id) => deleteNamedView("installer-jobs", id)} />}
        <WorkspaceTableTools columns={jobIndexColumns} visibleKeys={[...jobColumns]} onVisibleKeys={(keys) => { setJobColumns(safeJobRegisterColumns(keys)); setActiveJobPresetId(""); }} noun="jobs"
          exportDisabled={!jobPagination.total || indexLoading} exportBusy={jobExporting}
          exportLabel="Download all filtered jobs CSV" exportBusyLabel="Downloading all filtered jobs CSV..."
          onExport={() => void downloadAllFilteredJobs()} /></div>}
      {jobLayout === "list" && <WorkspaceListControls page={jobPagination.page} pageCount={jobPagination.pageCount} pageSize={jobPagination.pageSize} total={jobPagination.total} hasNext={jobPagination.hasNext} saved={jobViewSaved} busy={viewBusy || indexLoading}
        onPage={(page) => setJobPage(page)} onPageSize={(size) => { setJobPageSize(size); setJobPage(1); }} onSave={() => void updateListView("installer-jobs", "PATCH")} onReset={() => void updateListView("installer-jobs", "DELETE")} showViewActions={!staffPermissions} />}
      {jobLayout === "list" ? <div className="crm-jobs-layout">
        <section className={`${registerStyles.register} crm-job-list crm-record-table`} aria-label="Job results"><div className="crm-record-columns crm-dynamic-columns" style={jobRecordStyle} aria-hidden="true"><div className="crm-record-data-row" style={jobGridStyle}>{jobColumns.map((key) => <span key={key}>{jobIndexColumns.find((column) => column.key === key)?.label}</span>)}</div></div>{indexedJobs.length ? indexedJobs.map((job) => <article key={job.id} tabIndex={0} className={`${registerStyles.row} crm-row-open crm-record-data-row crm-index-row`} style={jobGridStyle} onContextMenu={(event) => openJobActions(event, job.id)} onKeyDown={(event) => { if ((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu") openJobActions(event, job.id); else if (event.key === "Enter") openFocusedJob(job.id); }} onDoubleClick={(event) => { if ((event.target as HTMLElement).closest("a, button, input, select, textarea")) return; openFocusedJob(job.id); }}>{jobColumns.map((key) => <span className="crm-index-cell" key={key}>{jobIndexCell(job, key, () => openFocusedJob(job.id), jobActionMenu(job))}</span>)}</article>) : <div className="crm-empty"><strong>{indexLoading ? "Loading jobs..." : "No matching jobs"}</strong><span>{indexLoading ? "Fetching this page securely." : "Try another search or filter."}</span></div>}</section>
      </div> : <div className="crm-pipeline-board">{[["enquiry", "New"], ["qualifying", "Checking"], ["quoting", "Quoting"], ["approved", "Approved"], ["scheduled", "Scheduled"], ["in_progress", "Underway"]].map(([stage, label]) => { const stageJobs = boardJobs[stage] || []; return <section key={stage}><header><button type="button" onClick={() => { setPipelineFocus(stage); setJobLayout("list"); }}>{label}</button><strong>{boardCounts[stage] || 0}</strong></header><div>{stageJobs.map((job) => <button type="button" key={job.id} onClick={() => openFocusedJob(job.id)}><span>{job.workNumber}</span><strong>{job.customerDisplayName || job.title}</strong><small>{serviceLabels[job.serviceCategory] || job.serviceCategory}</small><em>{job.nextAction || workStageLabels[job.stage] || job.stage}</em></button>)}{!stageJobs.length && <p>No jobs</p>}</div></section>; })}</div>}
    </div>}

    {view === "schedule" && <div className="crm-view crm-dispatch-view"><TradeScheduleWorkspace user={user} permissions={staffPermissions} initialWeekStart={scheduleWeekStart} onOpenJob={(id) => openFocusedJob(id)} onOpenQuote={(!staffPermissions || staffPermissions.canViewQuotes) ? (id) => openFocusedJob(id, "quote") : undefined} /></div>}

    {view === "customers" && creating === "customer" && <div className="crm-view crm-create-screen">
      <div className="crm-page-heading"><div><span>New direct customer</span><h3>Add a customer your business owns</h3><p>Contact details and the full service address remain private to your installer workspace.</p></div><button type="button" className="crm-back-button" onClick={() => setCreating("")}>Back to all customers</button></div>
      <section className="crm-create-card"><div className="crm-create-guidance"><strong>Privacy check</strong><p>Do not copy a person from an Australian Energy Assessments protected lead into this list. Australian Energy Assessments jobs remain redacted automatically.</p></div><CustomerForm busy={busy} onSubmit={createCustomer} /></section>
    </div>}

    {view === "customers" && creating !== "customer" && selectedCustomerId && <div className="crm-view crm-customer-focus">
      <div className="crm-page-heading"><div><span>Customer workspace</span><h3>{selectedCustomerDetail?.id === selectedCustomerId ? selectedCustomerDetail.displayName : "Opening customer"}</h3><p>Contact, service sites and linked jobs stay together without lengthening the customer directory.</p></div><button type="button" className="crm-back-button" onClick={() => { setSelectedCustomerId(""); setSelectedCustomerDetail(null); }}>Back to all customers</button></div>
      {selectedCustomerDetail?.id === selectedCustomerId ? <CustomerDetail key={`${selectedCustomerDetail.id}:${refreshNonce}`} user={user} customer={selectedCustomerDetail} contacts={selectedCustomerContacts} sites={selectedCustomerSites} jobs={selectedCustomerJobs} busy={busy} readOnly={Boolean(staffPermissions && !staffPermissions.canManageCustomers)} hideAssets={Boolean(staffPermissions)} onSave={crmRequest} onOpenJob={(id) => openFocusedJob(id, "summary", { kind: "customer", customerId: selectedCustomerDetail.id, customerName: selectedCustomerDetail.displayName })} /> : <div className="crm-empty"><strong>Loading customer...</strong><span>The private customer record will open here.</span></div>}
    </div>}

    {view === "customers" && creating !== "customer" && !selectedCustomerId && <div className="crm-view">
      <div className="crm-page-heading"><div><span>Contacts you own</span><h3>Your customers</h3><p>Search the customer index, then open only the record you need. Add customers from New. Australian Energy Assessments protected households never appear here.</p></div></div>
      <div className="crm-customer-toolbar"><label><span>Find a customer</span><input type="search" value={customerSearch} onChange={(event) => { setCustomerSearch(event.target.value); setCustomerPage(1); setSelectedCustomerIds([]); }} placeholder="Name, email, phone, suburb or reference" aria-label="Search customers" /></label><label className="crm-index-sort"><span>Sort customers</span><select value={customerSort} onChange={(event) => { setCustomerSort(event.target.value); setCustomerPage(1); setSelectedCustomerIds([]); }}><option value="name-asc">Name A to Z</option><option value="name-desc">Name Z to A</option><option value="updated-desc">Recently updated</option></select></label></div>
      <details className="crm-granular-filters"><summary>Detailed customer filters</summary><div>
        <label><span>First name</span><input value={customerFirstName} onChange={(event) => { setCustomerFirstName(event.target.value); setCustomerPage(1); }} placeholder="First name" /></label>
        <label><span>Last name</span><input value={customerLastName} onChange={(event) => { setCustomerLastName(event.target.value); setCustomerPage(1); }} placeholder="Last name" /></label>
        <label><span>Business</span><input value={customerBusinessName} onChange={(event) => { setCustomerBusinessName(event.target.value); setCustomerPage(1); }} placeholder="Business name" /></label>
        <label><span>Email</span><input type="email" value={customerEmail} onChange={(event) => { setCustomerEmail(event.target.value); setCustomerPage(1); }} placeholder="Email address" /></label>
        <label><span>Street address</span><input value={customerStreet} onChange={(event) => { setCustomerStreet(event.target.value); setCustomerPage(1); }} placeholder="Street or unit" /></label>
        <label><span>Contact number</span><input type="tel" value={customerPhone} onChange={(event) => { setCustomerPhone(event.target.value); setCustomerPage(1); }} placeholder="Phone number" /></label>
        <label><span>Postcode</span><input inputMode="numeric" value={customerPostcode} onChange={(event) => { setCustomerPostcode(event.target.value); setCustomerPage(1); }} placeholder="Postcode" /></label>
        <label><span>Suburb</span><input value={customerSuburb} onChange={(event) => { setCustomerSuburb(event.target.value); setCustomerPage(1); }} placeholder="Suburb" /></label>
        <label><span>State</span><select value={customerState} onChange={(event) => { setCustomerState(event.target.value); setCustomerPage(1); }}><option value="">All states</option>{["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"].map((state) => <option key={state}>{state}</option>)}</select></label>
        <label><span>Activity</span><select value={customerService} onChange={(event) => { setCustomerService(event.target.value); setCustomerPage(1); }}><option value="">All activities</option>{serviceOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Job reference</span><input value={customerJobId} onChange={(event) => { setCustomerJobId(event.target.value); setCustomerPage(1); }} placeholder="TLink reference" /></label>
        <label><span>Completion status</span><select value={customerPipeline} onChange={(event) => { setCustomerPipeline(event.target.value); setCustomerPage(1); }}><option value="">All statuses</option>{Object.entries(pipelineLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button type="button" onClick={() => { setCustomerSearch(""); setCustomerFirstName(""); setCustomerLastName(""); setCustomerBusinessName(""); setCustomerEmail(""); setCustomerStreet(""); setCustomerPhone(""); setCustomerPostcode(""); setCustomerSuburb(""); setCustomerState(""); setCustomerService(""); setCustomerJobId(""); setCustomerPipeline(""); setCustomerPage(1); }}>Clear detailed filters</button>
      </div></details>
      <div className="crm-index-view-tools">{!staffPermissions && <WorkspaceSavedViews presets={customerPresets} activeId={activeCustomerPresetId} busy={viewBusy}
        onApply={(preset) => { applyListPreferences("installer-customers", preset.preferences); setActiveCustomerPresetId(preset.id); setStatus(`${preset.name} view applied.`); }}
        onClear={() => setActiveCustomerPresetId("")}
        onCreate={(name) => saveNamedView("installer-customers", name)} onRename={(id, name) => saveNamedView("installer-customers", name, id)} onDelete={(id) => deleteNamedView("installer-customers", id)} />}
        <WorkspaceTableTools columns={customerIndexColumns} visibleKeys={customerColumns} onVisibleKeys={(keys) => { setCustomerColumns(keys); setActiveCustomerPresetId(""); }} noun="customers" exportDisabled={!indexedCustomers.length}
          onExport={() => downloadWorkspaceCsv("tlink-customers.csv", customerIndexColumns.filter((column) => customerColumns.includes(column.key)).sort((a, b) => customerColumns.indexOf(a.key) - customerColumns.indexOf(b.key)), indexedCustomers.map((customer) => ({ customer: customer.displayName, firstName: customer.firstName, lastName: customer.lastName, email: customer.email, phone: customer.phone, suburb: customer.suburb, postcode: customer.postcode, jobs: customer.jobCount || 0, latestJob: customer.latestJobNumber ? `${customer.latestJobNumber} | ${dateLabel(customer.latestJobAt || customer.updatedAt)}` : "No jobs", status: customer.latestPipelineStage ? pipelineLabels[customer.latestPipelineStage] || customer.latestPipelineStage : "No status" })))} /></div>
      <WorkspaceListControls page={customerPagination.page} pageCount={customerPagination.pageCount} pageSize={customerPagination.pageSize} total={customerPagination.total} hasNext={customerPagination.hasNext} saved={customerViewSaved} busy={viewBusy || indexLoading}
        onPage={(page) => { setCustomerPage(page); setSelectedCustomerIds([]); }} onPageSize={(size) => { setCustomerPageSize(size); setCustomerPage(1); setSelectedCustomerIds([]); }} onSave={() => void updateListView("installer-customers", "PATCH")} onReset={() => void updateListView("installer-customers", "DELETE")} showViewActions={!staffPermissions} />
      {selectedCustomerIds.length > 0 && <div className="crm-bulk-actions" role="region" aria-label="Selected customer actions"><strong>{selectedCustomerIds.length} customer{selectedCustomerIds.length === 1 ? "" : "s"} selected</strong><span>Only customers with no active jobs can be archived.</span><button type="button" disabled={busy === "bulk-customer-archive"} onClick={() => void bulkRequest({ action: "bulk_archive_customers", ids: selectedCustomerIds }, "bulk-customer-archive", "Selected customers archived.")}>{busy === "bulk-customer-archive" ? "Checking..." : "Archive selected"}</button><button type="button" className="secondary" onClick={() => setSelectedCustomerIds([])}>Clear</button></div>}
      <div className="crm-customers-layout"><section className="crm-customer-list crm-record-table" aria-label="Customer results"><div className="crm-record-columns crm-dynamic-columns" style={customerRecordStyle} aria-hidden="true"><span></span><div className="crm-record-data-row" style={customerGridStyle}>{customerColumns.map((key) => <span key={key}>{customerIndexColumns.find((column) => column.key === key)?.label}</span>)}</div></div>{indexedCustomers.length ? indexedCustomers.map((customer) => <article key={customer.id} style={customerRecordStyle}><label className="crm-row-select"><input type="checkbox" checked={selectedCustomerIds.includes(customer.id)} onChange={(event) => setSelectedCustomerIds((current) => event.target.checked ? [...current, customer.id] : current.filter((id) => id !== customer.id))} /><span className="sr-only">Select {customer.displayName}</span></label><div className="crm-record-data-row crm-index-row" style={customerGridStyle}>{customerColumns.map((key) => <span className="crm-index-cell" key={key}>{customerIndexCell(customer, key, () => setSelectedCustomerId(customer.id))}</span>)}</div></article>) : <div className="crm-empty"><strong>{indexLoading ? "Loading customers..." : "No direct customers in this view"}</strong><span>{indexLoading ? "Fetching this page securely." : "Change the search or add a customer from New."}</span></div>}</section></div>
    </div>}

    {view === "templates" && <div className="crm-view crm-template-view">
      <div className="crm-page-heading"><div><span>Repeatable quality</span><h3>Job templates</h3><p>Save the scope and checklist once, then start consistent jobs without rebuilding the same record in the office or field.</p></div><button type="button" className="crm-new-button" onClick={() => { setNewJobSeed(null); setView("jobs"); setCreating("job"); }}>Use a template</button></div>
      <div className="crm-template-layout">
        <section className="crm-card crm-template-create"><header><div><span>New reusable workflow</span><h3>Create a template</h3></div></header><form className="crm-form" onSubmit={createTemplate}><div className="crm-form-grid"><label><span>Template name</span><input name="name" required maxLength={100} placeholder="Standard heat pump install" /></label><label><span>Default job title</span><input name="title" maxLength={160} placeholder="Heat pump hot water installation" /></label><label><span>Work type</span><select name="serviceCategory">{serviceOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Priority</span><select name="priority"><option value="standard">Standard</option><option value="low">Low</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label className="wide"><span>Default scope and access notes</span><textarea name="description" maxLength={3000} rows={4} placeholder="The repeatable scope, exclusions and site preparation" /></label><label className="wide"><span>Checklist, one item per line</span><textarea name="taskTitles" maxLength={4200} rows={7} placeholder={"Confirm isolation and site safety\nRecord installed model and serial\nPhotograph completed work\nComplete customer handover"} /><small>Up to 24 clear tasks are copied into every job created from this template.</small></label></div><button className="btn" disabled={busy === "create-template"}>{busy === "create-template" ? "Saving..." : "Save template"}</button></form></section>
        <section className="crm-card crm-template-library"><header><div><span>Template library</span><h3>{templates.length} saved workflow{templates.length === 1 ? "" : "s"}</h3></div></header>{templates.length ? <div>{templates.map((template) => <article key={template.id}><div><span>{serviceLabels[template.serviceCategory] || template.serviceCategory}</span><strong>{template.name}</strong><p>{template.title || "Job title added when used"}</p><small>{template.taskTitles.length} checklist item{template.taskTitles.length === 1 ? "" : "s"} | {template.priority} priority</small></div><button type="button" disabled={busy === `template:${template.id}`} onClick={() => void crmRequest("PATCH", { action: "archive_template", templateId: template.id }, `template:${template.id}`, "Template archived.")}>Archive</button></article>)}</div> : <div className="crm-empty"><strong>No templates yet</strong><span>Create the first repeatable workflow for your most common job.</span></div>}</section>
      </div>
      <TradePhotoTemplateLibrary user={user} />
    </div>}

    {view === "reports" && <div className="crm-view">
      <div className="crm-page-heading"><div><span>Business snapshot</span><h3>Reports</h3><p>A simple operational view using the records in this workspace.</p></div></div>
      <section className="crm-metrics crm-report-metrics"><article><span>Quoted</span><strong>{money(reportMetrics.quotedCents)}</strong><small>Current job records</small></article><article><span>Invoiced</span><strong>{money(reportMetrics.invoicedCents)}</strong><small>Including paid invoices</small></article><article><span>Paid</span><strong>{money(reportMetrics.paidCents)}</strong><small>Recorded receipts</small></article><article className={reportMetrics.outstandingCents ? "attention" : ""}><span>Outstanding</span><strong>{money(reportMetrics.outstandingCents)}</strong><small>Still to collect</small></article></section>
      <div className="crm-report-grid"><section className="crm-card"><header><div><span>Sales flow</span><h3>Jobs by stage</h3></div></header><div className="crm-pipeline-report">{Object.entries(pipelineLabels).map(([stage, label]) => { const count = pipelineCounts[stage] || 0; return <div key={stage}><span>{label}</span><meter min="0" max={Math.max(1, pipelineTotal)} value={count} /><strong>{count}</strong></div>; })}</div></section><section className="crm-card"><header><div><span>Work health</span><h3>Operational checks</h3></div></header><dl className="crm-report-list"><div><dt>Open jobs</dt><dd>{reportMetrics.openJobs}</dd></div><div><dt>Jobs waiting</dt><dd>{reportMetrics.waitingJobs}</dd></div><div><dt>Open issues</dt><dd>{reportMetrics.openIssues}</dd></div><div><dt>Overdue tasks</dt><dd>{reportMetrics.overdueTasks}</dd></div><div><dt>Completed jobs</dt><dd>{reportMetrics.completedJobs}</dd></div></dl></section></div>
    </div>}
    {view === "import" && <div className="crm-view"><TradeDataImportWorkspace user={user} partnerType="installer" onImported={async () => { await load(); setRefreshNonce((value) => value + 1); }} /></div>}
    {view === "pricebook" && <div className="crm-view"><TradePriceBookWorkspace key={priceBookView} user={user} initialView={priceBookView} permissions={staffPermissions} /></div>}
    {view === "assets" && <div className="crm-view"><TradeAssetWorkspace user={user} /></div>}
    {view === "integrations" && <div className="crm-view"><TradeIntegrationCentre user={user} /></div>}
    {status && <p className="crm-status" role="status">{status}{status.includes("Calendar sync needs another try.") && <> <a href="/direct-trade/dashboard?workspace=schedule">Open Schedule and retry calendar sync</a>.</>}</p>}
  </section>;
}

function CustomerLookupSelect({ user, initialCustomer }: { user: User; initialCustomer?: Customer }) {
  const [selectedId, setSelectedId] = useState(initialCustomer?.id || "");
  const loadCustomers = useCallback(async (query: string, selected: string): Promise<SearchableLookupOption[]> => {
    const token = await user.getIdToken();
    if (selected && !query) {
      const response = await fetch(`/api/trade-crm?mode=detail&resource=customer&id=${encodeURIComponent(selected)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const result = await response.json() as CrmDetailResult; const customer = result.customer;
      return customer ? [{ id: customer.id, label: customer.displayName, secondary: [customer.customerNumber, customer.phone, customer.suburb, customer.postcode].filter(Boolean).join(" | ") }] : [];
    }
    const params = new URLSearchParams({ mode: "index", resource: "customers", search: query, sort: "name-asc", page: "1", pageSize: "25", total: "0" });
    const response = await fetch(`/api/trade-crm?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json() as CrmIndexResult;
    return ((result.items || []) as Customer[]).map((customer) => ({ id: customer.id, label: customer.displayName, secondary: [customer.customerNumber, customer.phone, customer.suburb, customer.postcode].filter(Boolean).join(" | ") }));
  }, [user]);
  return <fieldset className="crm-customer-lookup"><legend>Your customer, optional</legend><input type="hidden" name="crmCustomerId" value={selectedId} /><SearchableLookup label="Find and select a customer" value={selectedId} placeholder="Name, number, phone, suburb or postcode" load={loadCustomers} onChange={setSelectedId} /><small>Australian Energy Assessments protected leads enter automatically and cannot be linked to direct contact records.</small></fieldset>;
}

function CustomerForm({ busy, onSubmit }: { busy: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <form className="crm-form" onSubmit={onSubmit}><div className="crm-form-grid"><label><span>Customer type</span><select name="customerType"><option value="residential">Residential</option><option value="business">Business</option></select></label><label><span>First name</span><input name="firstName" maxLength={80} /></label><label><span>Last name</span><input name="lastName" maxLength={80} /></label><label><span>Business name</span><input name="businessName" maxLength={140} /></label><label><span>Email</span><input type="email" name="email" maxLength={180} /></label><label><span>Phone</span><input type="tel" name="phone" maxLength={40} /></label><label className="wide"><span>Street address</span><input name="addressLine1" maxLength={140} placeholder="Street number and name" /></label><label className="wide"><span>Address line 2</span><input name="addressLine2" maxLength={140} placeholder="Unit, level or building, optional" /></label><label><span>Suburb</span><input name="suburb" maxLength={80} /></label><label><span>State</span><select name="addressState" defaultValue=""><option value="">Select state</option>{["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"].map((state) => <option key={state}>{state}</option>)}</select></label><label><span>Postcode</span><input name="postcode" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" /></label><label><span>Tags</span><input name="tags" maxLength={300} placeholder="repeat customer, builder" /></label></div><p className="crm-form-note">Only add contacts who came directly to your business. Do not copy Australian Energy Assessments household details into this CRM.</p><button className="btn" disabled={busy === "create-customer"}>{busy === "create-customer" ? "Adding..." : "Add customer"}</button></form>;
}

function JobDetail({ job, customer, sites, user, busy, refreshing = false, teamMembers, permissions, initialTab = "summary", onCrm, onWorkOrder, onOpenJob, onOpenPriceBook, onOpenCustomer, onOpenIntegrations, onReload }: { job: Job; customer?: Customer; sites: ServiceSite[]; user: User; busy: string; refreshing?: boolean; teamMembers: TeamMember[]; permissions?: TradeTeamPermissions; initialTab?: JobTab; onCrm: (method: "POST" | "PATCH", body: Record<string, unknown>, key: string, success: string) => Promise<boolean>; onWorkOrder: (method: "POST" | "PATCH", body: Record<string, unknown>, key: string, success: string) => Promise<boolean>; onOpenJob: (workOrderId: string) => void; onOpenPriceBook: () => void; onOpenCustomer: (customerId: string) => void; onOpenIntegrations: () => void; onReload: () => Promise<void> }) {
  const activeJobAppointmentKey = job.appointments
    .filter((item) => ["scheduled", "en_route", "arrived", "in_progress"].includes(item.status))
    .map((item) => `${item.id}:${item.status}`)
    .sort()
    .join("|");
  const hasActiveJobAppointment = Boolean(activeJobAppointmentKey);
  const [tab, setTab] = useState<JobDetailTab>(initialTab);
  const [appointmentDuration, setAppointmentDuration] = useState(60);
  const [appointmentStartsAt, setAppointmentStartsAt] = useState(() => nextAppointmentSlot());
  const [bookingDraftState, setBookingDraftState] = useState(() => ({ appointmentKey: activeJobAppointmentKey, open: !hasActiveJobAppointment }));
  const [appointmentScheduleValidation, setAppointmentScheduleValidation] = useState<ScheduleProposalValidation>({ key: "", status: "loading", conflict: false });
  const [jobAssignees, setJobAssignees] = useState<TeamMember[]>([]);
  const [jobAssigneesLoading, setJobAssigneesLoading] = useState(false);
  const [jobScheduleRefreshNonce, setJobScheduleRefreshNonce] = useState(0);
  const [jobAssigneeDraft, setJobAssigneeDraft] = useState(() => ({ sourceAssigneeId: job.assigneeMemberId, value: job.assigneeMemberId }));
  const [assignmentStatus, setAssignmentStatus] = useState("");
  const [minimumStart] = useState(() => nextAppointmentSlot());
  const bookingDraftOpen = bookingDraftState.appointmentKey === activeJobAppointmentKey ? bookingDraftState.open : !hasActiveJobAppointment;
  const setBookingDraftOpen = (open: boolean) => setBookingDraftState({ appointmentKey: activeJobAppointmentKey, open });
  const jobAssigneeId = jobAssigneeDraft.sourceAssigneeId === job.assigneeMemberId ? jobAssigneeDraft.value : job.assigneeMemberId;
  const setJobAssigneeId = (value: string) => setJobAssigneeDraft({ sourceAssigneeId: job.assigneeMemberId, value });
  const isProtected = job.customerSource === "platform_private";
  const isReleasedLead = job.customerSource === "public_lead_released";
  const jobSite = sites.find((site) => site.id === job.serviceSiteId) || sites[0];
  const jobCustomerName = customer?.displayName || job.customerDisplayName || (isReleasedLead ? "Customer enquiry" : "No customer linked");
  const customerContactSummary = customer ? [customer.phone, customer.email].filter(Boolean).join(" | ") : "";
  const siteAddressSummary = jobSite
    ? [jobSite.addressLine1, jobSite.addressLine2, jobSite.suburb, jobSite.addressState, jobSite.postcode].filter(Boolean).join(", ")
    : "";
  const hasCustomerContext = Boolean(customerContactSummary || siteAddressSummary);
  const customerContextLabel = isReleasedLead ? "Customer-authorised lead" : customer ? "Your customer record" : "Internal job";
  const complianceCases = job.complianceCases || [];
  const complianceIntents = job.complianceIntents?.length ? job.complianceIntents : job.complianceIntent ? [job.complianceIntent] : [];
  const unlinkedComplianceIntents = complianceIntents.filter((intent) => !intent.complianceCaseId);
  const openIssues = job.notes.filter((note) => note.noteType === "issue" && note.issueStatus === "open").length;
  const canManageJobs = !permissions || permissions.canManageJobs;
  const canRescheduleJobs = !permissions || permissions.canRescheduleJobs;
  const canAssignJobs = !permissions || permissions.canAssignJobs;
  const canViewFieldEvidence = !permissions || permissions.canViewFieldEvidence;
  const canManageFieldEvidence = !permissions || permissions.canManageFieldEvidence;
  const canViewQuotes = !permissions || permissions.canViewQuotes;
  const canManageQuotes = !permissions || permissions.canManageQuotes;
  const canSendQuotes = !permissions || permissions.canSendQuotes;
  const canViewCustomerRecords = !permissions || permissions.canViewCustomers;
  const canManageCustomerRecords = !permissions || (permissions.canViewCustomers && permissions.canManageCustomers);
  const canSearchCustomerRecords = !permissions || (permissions.canViewCustomers && permissions.canSearchCustomers);
  const canViewInvoices = !permissions || permissions.canViewInvoices;
  const canManageInvoices = !permissions || permissions.canManageInvoices;
  async function saveSummary(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!canManageJobs) return; const data = new FormData(event.currentTarget); const update: Record<string, unknown> = { action: "update_job", workOrderId: job.id, expectedRevision: job.revision, serviceSiteId: data.get("serviceSiteId"), pipelineStage: data.get("pipelineStage"), stage: data.get("stage"), priority: data.get("priority"), buildingType: data.get("buildingType") }; if (canSearchCustomerRecords) update.crmCustomerId = data.get("crmCustomerId"); await onCrm("PATCH", update, `job:${job.id}`, "Job summary saved."); }
  async function saveNotes(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!canManageJobs) return; const data = new FormData(event.currentTarget); await onCrm("PATCH", { action: "update_job", workOrderId: job.id, expectedRevision: job.revision, description: data.get("description"), nextAction: data.get("nextAction"), tags: data.get("tags") }, `job-notes:${job.id}`, "Job notes saved."); }
  async function saveFinancials(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!canManageInvoices) return; const data = new FormData(event.currentTarget); await onCrm("PATCH", { action: "update_job", workOrderId: job.id, expectedRevision: job.revision, invoiceStatus: data.get("invoiceStatus"), estimatedValueCents: cents(data.get("estimatedValue")), invoicedValueCents: cents(data.get("invoicedValue")), paidValueCents: cents(data.get("paidValue")), paymentDueAt: data.get("paymentDueAt") }, `finance:${job.id}`, "Estimate and invoice summary saved."); }
  async function addTask(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!canManageJobs) return; const form = event.currentTarget; const data = new FormData(form); if (await onWorkOrder("POST", { action: "add_task", workOrderId: job.id, title: data.get("title"), dueAt: data.get("dueAt") }, `task:${job.id}`, "Task added.")) form.reset(); }
  async function addAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (refreshing || !canRescheduleJobs || !jobAssigneeId || busy === `appointment-new:${job.id}`
      || appointmentScheduleValidation.key !== scheduleProposalKey(appointmentStartsAt, appointmentDuration, jobAssigneeId)
      || appointmentScheduleValidation.status !== "clear") return;
    const form = event.currentTarget; const data = new FormData(form);
    if (await onCrm("POST", { action: "create_appointment", workOrderId: job.id,
      expectedRevision: job.revision,
      appointmentType: data.get("appointmentType"), startsAt: appointmentStartsAt,
      durationMinutes: appointmentDuration, assigneeMemberId: jobAssigneeId,
      notes: data.get("notes") }, `appointment-new:${job.id}`, "Appointment added.")) {
      form.reset(); setAppointmentDuration(60); setAppointmentStartsAt(nextAppointmentSlot());
      setBookingDraftOpen(false);
      setJobScheduleRefreshNonce((value) => value + 1);
    }
  }
  async function completeAppointment(appointmentId: string) {
    if (await onCrm("PATCH", { action: "update_appointment", appointmentId, status: "completed" },
      `appointment:${appointmentId}`, "Appointment marked complete.")) {
      setJobScheduleRefreshNonce((value) => value + 1);
    }
  }
  async function addNote(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!canManageJobs) return; const form = event.currentTarget; const data = new FormData(form); if (await onCrm("POST", { action: "create_note", workOrderId: job.id, noteType: data.get("noteType"), body: data.get("body") }, `note:${job.id}`, "Job note added.")) form.reset(); }
  const selfMember = teamMembers.find((member) => member.isSelf);
  const canViewTeamSchedule = !permissions || permissions.scheduleScope === "team";
  const jobReadyForScheduling = job.scheduleReady;
  const visibleJobAppointments = canViewTeamSchedule
    ? job.appointments
    : job.appointments.filter((appointment) => appointment.assigneeMemberId === selfMember?.id);
  const canViewJobSchedule = canViewTeamSchedule || job.assigneeMemberId === selfMember?.id || visibleJobAppointments.length > 0;
  const canOpenJobSchedule = !isProtected && (canAssignJobs || canViewJobSchedule);
  const canAddJobAppointment = jobReadyForScheduling && canRescheduleJobs && Boolean(jobAssigneeId) && (canViewTeamSchedule || jobAssigneeId === selfMember?.id);
  const canPrepareJobAppointment = jobReadyForScheduling && canRescheduleJobs && (canAssignJobs || canAddJobAppointment);
  const canStartJobScheduling = canPrepareJobAppointment;
  const canCompleteAppointment = (appointment: Appointment) => canRescheduleJobs
    && (canViewTeamSchedule || appointment.assigneeMemberId === selfMember?.id);
  const appointmentBusy = busy === `appointment-new:${job.id}`;
  const assignmentDirty = jobAssigneeId !== job.assigneeMemberId;
  const bookingProposalKey = scheduleProposalKey(appointmentStartsAt, appointmentDuration, jobAssigneeId);
  const bookingControlsBlocked = refreshing || appointmentBusy || jobAssigneesLoading;
  const bookingCalendarReady = appointmentScheduleValidation.key === bookingProposalKey && appointmentScheduleValidation.status === "clear";
  const bookingSubmitBlocked = bookingControlsBlocked || !bookingCalendarReady;
  const bookingButtonLabel = refreshing ? "Refreshing job..."
    : appointmentBusy ? "Adding..."
    : jobAssigneesLoading ? "Loading team..."
    : !jobAssigneeId ? "Choose a worker"
    : appointmentScheduleValidation.key !== bookingProposalKey || appointmentScheduleValidation.status === "loading" ? "Checking calendar..."
        : appointmentScheduleValidation.status === "load_error" ? "Calendar unavailable"
          : appointmentScheduleValidation.status === "not_visible" ? "Show selected booking first"
            : appointmentScheduleValidation.status === "assignee_unavailable" ? "Assign an active worker first"
            : appointmentScheduleValidation.conflict ? "Choose another time" : assignmentDirty ? "Assign and add appointment" : "Add appointment";
  const proposalStatusId = `job-schedule-proposal-status-${job.id}`;
  const handleProposalValidation = useCallback((validation: ScheduleProposalValidation) => {
    setAppointmentScheduleValidation((current) => current.key === validation.key
      && current.status === validation.status && current.conflict === validation.conflict ? current : validation);
  }, []);
  const handleScheduleProposalChange = useCallback((next: { startsAt: string; durationMinutes: number }) => {
    setAppointmentStartsAt(next.startsAt);
    setAppointmentDuration(next.durationMinutes);
  }, []);
  const allowedJobAssignees = [...jobAssignees, ...(job.assigneeMemberId ? [{ id: job.assigneeMemberId, displayName: job.assigneeLabel || "Current assignee", status: "active", isOwner: false }] : [])]
    .filter((member, index, values) => values.findIndex((candidate) => candidate.id === member.id) === index);
  const selectedJobAssignee = allowedJobAssignees.find((member) => member.id === jobAssigneeId);
  const selectedJobAssigneeLabel = selectedJobAssignee?.displayName || (jobAssigneeId === job.assigneeMemberId ? job.assigneeLabel : "Selected worker");
  const loadAllJobAssignees = useCallback(async () => {
    if (!canAssignJobs) return;
    setJobAssigneesLoading(true);
    setAssignmentStatus("");
    try {
      const token = await user.getIdToken();
      const firstParams = new URLSearchParams({ assigneePage: "1", assigneePageSize: "50", assigneeCapability: job.serviceCategory });
      const firstResponse = await fetch(`/api/trade-team?${firstParams}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const firstResult = await firstResponse.json().catch(() => ({})) as { assignees?: TeamMember[]; assigneeRoster?: AssigneeRoster; error?: string };
      if (!firstResponse.ok) throw new Error(firstResult.error || "Available team members could not be loaded.");
      const roster = firstResult.assigneeRoster;
      const combined = [...(firstResult.assignees || [])];
      for (let page = 2; page <= (roster?.totalPages || 1); page += 1) {
        const params = new URLSearchParams({ assigneePage: String(page), assigneePageSize: "50", assigneeCapability: job.serviceCategory });
        const response = await fetch(`/api/trade-team?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const result = await response.json().catch(() => ({})) as { assignees?: TeamMember[]; error?: string };
        if (!response.ok) throw new Error(result.error || "Available team members could not be loaded.");
        combined.push(...(result.assignees || []));
      }
      setJobAssignees(combined.filter((member, index) => combined.findIndex((candidate) => candidate.id === member.id) === index));
    } catch (error) {
      setJobAssignees([]);
      setAssignmentStatus(error instanceof Error ? error.message : "Available team members could not be loaded.");
    } finally {
      setJobAssigneesLoading(false);
    }
  }, [canAssignJobs, job.serviceCategory, user]);
  const mainTabs: Array<readonly [JobDetailTab, string]> = [["summary", "Overview"]];
  if (canOpenJobSchedule) mainTabs.push(["schedule", `Schedule (${visibleJobAppointments.length})`]);
  if (canViewQuotes) mainTabs.push(["quote", "Quote"]);
  if (canViewFieldEvidence) mainTabs.push(["field", "Field work"]);
  if (canViewInvoices) mainTabs.push(["invoice", "Invoice"]);
  const moreTabs: Array<readonly [JobDetailTab, string]> = [["tasks", `Tasks (${job.tasks.filter((task) => task.status === "pending").length})`], ["notes", `Notes${openIssues ? ` (${openIssues})` : ""}`]];
  if (canViewFieldEvidence) moreTabs.unshift(["forms", "Forms"]);
  if (!permissions && canManageFieldEvidence) moreTabs.push(["handover", "Handover"]);
  const allowedTabs = [...mainTabs, ...moreTabs].map(([value]) => value);
  const activeTab = allowedTabs.includes(tab) ? tab : "summary";
  const moreActive = moreTabs.some(([value]) => value === activeTab);
  useEffect(() => {
    if (!canAssignJobs || activeTab !== "schedule") return;
    const frame = window.requestAnimationFrame(() => void loadAllJobAssignees());
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, canAssignJobs, loadAllJobAssignees]);
  return <article className="crm-job-card"><header className="crm-job-card-header"><div><span>{job.workNumber}</span><h3>{job.title}</h3><small>{serviceLabels[job.serviceCategory] || job.serviceCategory}{job.siteArea ? ` | ${job.siteArea}` : ""}</small></div><div className="crm-job-header-actions"><strong>{pipelineLabels[job.pipelineStage] || job.pipelineStage}</strong><span className={isProtected ? "protected" : "owned"}>{isProtected ? "Australian Energy Assessments protected" : customer ? "Your customer" : "Internal"}</span>{canViewFieldEvidence && !isProtected && customer && <button type="button" className="crm-request-info-button" onClick={() => setTab("field")}>Request info</button>}</div></header>
    <nav className="crm-job-tabs" aria-label="Job card sections">{mainTabs.map(([value, label]) => <button key={value} type="button" className={activeTab === value ? "active" : ""} onClick={() => setTab(value)}>{label}</button>)}<AccessibleMenu className="crm-job-more" active={moreActive} label={moreActive ? activeTab[0].toUpperCase() + activeTab.slice(1) : "More"}>{(close) => moreTabs.map(([value, label]) => <button role="menuitem" key={value} type="button" className={activeTab === value ? "active" : ""} onClick={() => { setTab(value); close(); }}>{label}</button>)}</AccessibleMenu></nav>
    {activeTab === "summary" && <section className="crm-job-section crm-summary-workspace">
        <section className={registerStyles.detailSection} aria-labelledby={`job-information-${job.id}`}>
          <h4 id={`job-information-${job.id}`}>Job information</h4>
          <dl className={registerStyles.detailGrid}>
            <div><dt>Job ID</dt><dd>{job.workNumber}</dd></div>
            <div><dt>Status</dt><dd>{job.jobRegister?.operationalStatus ? job.jobRegister.operationalStatus[0].toUpperCase() + job.jobRegister.operationalStatus.slice(1) : pipelineLabels[job.pipelineStage] || job.pipelineStage}</dd></div>
            <div><dt>Work type</dt><dd>{serviceLabels[job.serviceCategory] || job.serviceCategory || "Not added"}</dd></div>
            <div><dt>Assigned worker</dt><dd>{job.assigneeLabel || "Unassigned"}</dd></div>
            <div><dt>Scheduled date</dt><dd>{job.scheduledStart ? dateLabel(job.scheduledStart, true) : "Unassigned"}</dd></div>
            <div><dt>Priority</dt><dd>{job.priority ? job.priority[0].toUpperCase() + job.priority.slice(1) : "Standard"}</dd></div>
          </dl>
        </section>
        <section className={`${registerStyles.detailSection} ${isProtected ? registerStyles.protectedCustomer : ""}`} aria-labelledby={`customer-information-${job.id}`}>
          <div className={registerStyles.detailHeading}><div><span>{customerContextLabel}</span><h4 id={`customer-information-${job.id}`}>Customer information</h4></div>{canManageCustomerRecords && !isProtected && customer?.id && <button type="button" onClick={() => onOpenCustomer(customer.id)}>Edit customer</button>}</div>
          {isProtected ? <div className="crm-customer-boundary protected"><span>Australian Energy Assessments protected customer</span><strong>Protected reference {job.customerReference || job.workNumber}</strong><p>Australian Energy Assessments manages the household relationship. Only the project scope, broad service region and protected reference are available until the customer authorises contact.</p></div> : customer ? <>
            <dl className={registerStyles.detailGrid}>
              <div><dt>First name</dt><dd>{customer.firstName || "Not added"}</dd></div>
              <div><dt>Last name</dt><dd>{customer.lastName || "Not added"}</dd></div>
              <div><dt>Contact number</dt><dd>{customer.phone ? <a href={phoneHref(customer.phone)}>{customer.phone}</a> : "Not added"}</dd></div>
              <div><dt>Email</dt><dd>{customer.email ? <a href={`mailto:${customer.email}`}>{customer.email}</a> : "Not added"}</dd></div>
              <div className={registerStyles.wideDetail}><dt>Street address</dt><dd>{[jobSite?.addressLine1 || customer.addressLine1, jobSite?.addressLine2 || customer.addressLine2].filter(Boolean).join(", ") || "Not added"}</dd></div>
              <div><dt>Suburb</dt><dd>{jobSite?.suburb || customer.suburb || "Not added"}</dd></div>
              <div><dt>State</dt><dd>{jobSite?.addressState || customer.addressState || "Not added"}</dd></div>
              <div><dt>Postcode</dt><dd>{jobSite?.postcode || customer.postcode || "Not added"}</dd></div>
            </dl>
            <p className={registerStyles.contextNote}>{isReleasedLead ? "This customer-authorised lead contains only the contact and property details disclosed to your business." : hasCustomerContext ? "This customer contacted your business directly." : "The customer is linked, but contact and address details have not been added."}</p>
          </> : <p className={registerStyles.contextNote}>No customer is linked to this internal job.</p>}
        </section>
      <form className="crm-form" onSubmit={saveSummary}><fieldset disabled={!canManageJobs} style={{ border: 0, margin: 0, minWidth: 0, padding: 0 }}>
        {complianceIntents.map((intent) => <section className="crm-job-compliance" key={intent.id}><header><div><span>Planned government activity</span><h4>{intent.programCode} | {intent.registryActivityCode || intent.activityKey} | {intent.activityTitle}</h4></div><strong>{intent.status === "case_linked" ? "Case linked" : "Setup required"}</strong></header><p>{intent.siteJurisdiction} | {serviceLabels[intent.serviceCategory] || intent.serviceCategory} | planned {dateLabel(intent.plannedStart, true)}</p><p>{intent.status === "case_linked" ? "This activity is linked to its compliance case." : "Confirm the governed activity, product, scenario and evidence requirements before work starts."}</p>{intent.officialSourceUrl && <a href={intent.officialSourceUrl} target="_blank" rel="noreferrer">Open official program source</a>}</section>)}
        <div className="crm-form-grid">{canSearchCustomerRecords && !isProtected && !isReleasedLead && <CustomerLookupSelect user={user} initialCustomer={customer} />}{!isProtected && !isReleasedLead && customer && <label><span>Authoritative service site</span><select name="serviceSiteId" defaultValue={job.serviceSiteId}><option value="">Choose later</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.siteLabel} | {[site.suburb, site.addressState, site.postcode].filter(Boolean).join(" ") || "Address not added"}</option>)}</select></label>}<label><span>Sales stage</span><select name="pipelineStage" defaultValue={job.pipelineStage}>{Object.entries(pipelineLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Work stage</span><select name="stage" defaultValue={job.stage}>{Object.entries(workStageLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Building type</span><select name="buildingType" defaultValue={job.buildingType || "not_sure"}>{[["house_townhouse", "House or townhouse"], ["apartment_unit", "Apartment or unit"], ["commercial_office", "Commercial or office"], ["retail_hospitality", "Retail or hospitality"], ["industrial_warehouse", "Industrial or warehouse"], ["institutional_community_health", "Institutional, community or health"], ["other", "Other"], ["not_sure", "Not sure"]].map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Priority</span><select name="priority" defaultValue={job.priority}><option value="low">Low</option><option value="standard">Standard</option><option value="high">High</option><option value="urgent">Urgent</option></select></label></div>
        {canManageJobs && <button className="btn" disabled={busy === `job:${job.id}`}>Save summary</button>}
      </fieldset></form>
      {!permissions && canManageFieldEvidence && unlinkedComplianceIntents.map((intent) => <TradeComplianceIntake key={intent.id} user={user} workOrderId={job.id} initialIntent={intent} onChanged={onReload} />)}
      {!permissions && canManageFieldEvidence && !isProtected && customer && complianceIntents.length === 0 && complianceCases.length === 0 && <TradeComplianceIntake user={user} workOrderId={job.id} onChanged={onReload} />}
      {complianceCases.length > 0 && <section className="crm-job-compliance"><header><div><span>Compliance intake</span><h4>{complianceCases.length} linked case{complianceCases.length === 1 ? "" : "s"}</h4></div><strong>Compliance review required</strong></header><div>{complianceCases.map((item) => <article key={item.id}><div><span>{item.caseNumber} | activity date {item.activityDate}</span><strong>{item.programCode} | {item.registryActivityCode || item.activityKey} | {item.title} | v{item.version}</strong><p>{[item.productCategory, item.scenarioCode ? `scenario ${item.scenarioCode}` : "", item.scenario].filter(Boolean).join(" | ")}</p></div><dl><div><dt>Case</dt><dd>{item.status.replaceAll("_", " ")}</dd></div><div><dt>Evidence</dt><dd>{item.evidenceStatus.replaceAll("_", " ")}</dd></div></dl>{item.officialSourceUrl && <a href={item.officialSourceUrl} target="_blank" rel="noreferrer">Open official {item.officialSourceVersion || item.officialSourceTitle || "activity"} source</a>}</article>)}</div><p>TLink has preserved the selected rule version for intake. This is not an eligibility decision, certificate calculation, evidence acceptance or rebate promise.</p></section>}
    </section>}
    {activeTab === "field" && canViewFieldEvidence && <section className="crm-job-section"><TradeFieldWorkPanel user={user} workOrderId={job.id} isProtected={isProtected} readOnly={!canManageFieldEvidence} canOpenHandover={!permissions} onNavigate={(next) => setTab(next)} onChanged={onReload} />{!permissions && canManageFieldEvidence && !isProtected && customer && <details className="crm-field-secondary"><summary>Customer photo request</summary><TradePhotoRequestPanel user={user} workOrderId={job.id} /></details>}{!permissions && canManageFieldEvidence && <details className="crm-field-secondary" id="field-work-plan"><summary>Work plan and actuals</summary><TradeJobReadinessPanel user={user} workOrderId={job.id} completionAction={false} onChanged={onReload} onOpenTeam={() => { const teamButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Team"); teamButton?.click(); }} /></details>}</section>}
    {activeTab === "forms" && canViewFieldEvidence && <section className="crm-job-section"><TradeJobFormsPanel user={user} workOrderId={job.id} readOnly={!canManageFieldEvidence} /></section>}
    {activeTab === "schedule" && canOpenJobSchedule && <section className="crm-job-section crm-job-schedule-workspace">
      <div className="crm-job-schedule-layout">
        <TradeScheduleWorkspace
          user={user}
          permissions={permissions}
          variant="job"
          initialWeekStart={appointmentStartsAt.slice(0, 10)}
          focusedMemberId={jobAssigneeId}
          proposal={bookingDraftOpen && canAddJobAppointment ? {
            startsAt: appointmentStartsAt,
            durationMinutes: appointmentDuration,
            assigneeMemberId: jobAssigneeId,
            assigneeLabel: selectedJobAssigneeLabel,
            title: `${job.workNumber} | ${job.title}`,
          } : undefined}
          refreshNonce={jobScheduleRefreshNonce}
          proposalStatusId={proposalStatusId}
          onProposalValidation={handleProposalValidation}
          onProposalChange={bookingDraftOpen && canAddJobAppointment && !refreshing ? handleScheduleProposalChange : undefined}
          onScheduleChanged={onReload}
          onOpenJob={onOpenJob}
        />
        <div className="crm-job-schedule-controls">
          <section className="crm-job-schedule-panel"><div className="crm-section-heading"><div><span>Appointments</span><h4>Assign and schedule</h4><p>Choose the worker and time together. TLink saves the assignment and appointment in one action.</p></div></div>{visibleJobAppointments.length ? <ol className="crm-job-appointments">{visibleJobAppointments.map((item) => <li key={item.id}><div><span>{appointmentLabels[item.appointmentType] || item.appointmentType}</span><strong>{item.title}</strong><small>{dateLabel(item.startsAt, true)} | {durationLabel(appointmentDurationMinutes(item.startsAt, item.endsAt))}{item.assigneeLabel ? ` | ${item.assigneeLabel}` : ""}</small>{item.notes && <p>{item.notes}</p>}</div>{canCompleteAppointment(item) && <button type="button" disabled={item.status !== "scheduled" || busy === `appointment:${item.id}`} onClick={() => void completeAppointment(item.id)}>{item.status === "scheduled" ? "Complete" : item.status.replaceAll("_", " ")}</button>}</li>)}</ol> : <div className="crm-empty"><strong>No appointments in your schedule</strong><span>{permissions?.scheduleScope === "own" ? "Only appointments assigned to you appear here." : "Choose the worker and time below."}</span></div>}
            {bookingDraftOpen && canPrepareJobAppointment && <form className="crm-job-booking-form" onSubmit={addAppointment}><fieldset disabled={bookingControlsBlocked} aria-describedby={proposalStatusId}><label><span>Assigned team member</span><select value={jobAssigneeId} disabled={!canAssignJobs || refreshing || jobAssigneesLoading || appointmentBusy} onChange={(event) => { setAssignmentStatus(""); setJobAssigneeId(event.target.value); }}><option value="">Choose worker</option>{jobAssigneeId && !allowedJobAssignees.some((member) => member.id === jobAssigneeId) && <option value={jobAssigneeId}>{job.assigneeLabel || "Current assignee"}</option>}{allowedJobAssignees.map((member) => <option value={member.id} key={member.id}>{member.displayName}{member.isSelf ? " (you)" : member.isOwner ? " (owner)" : ""}</option>)}</select></label><label><span>Appointment type</span><select name="appointmentType">{Object.entries(appointmentLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Start time</span><input type="datetime-local" min={minimumStart} step="900" required value={appointmentStartsAt} onChange={(event) => setAppointmentStartsAt(event.target.value)} /></label><label className="schedule-duration"><span>Duration <strong>{durationLabel(appointmentDuration)}</strong></span><input type="range" min="15" max="480" step="15" value={appointmentDuration} onChange={(event) => setAppointmentDuration(Number(event.target.value))} /></label><label><span>Visit notes</span><textarea name="notes" maxLength={1000} rows={3} placeholder="Access, preparation or visit notes" /></label><button className="btn" disabled={bookingSubmitBlocked}>{bookingButtonLabel}</button></fieldset></form>}
            {!bookingDraftOpen && canPrepareJobAppointment && <button type="button" className="btn crm-add-another-appointment" onClick={() => { setAppointmentStartsAt(nextAppointmentSlot()); setAppointmentDuration(60); setBookingDraftOpen(true); }}>Add another appointment</button>}
            {assignmentStatus && <p className="crm-status" role="status">{assignmentStatus}</p>}
            {!jobReadyForScheduling && isReleasedLead && <p className="crm-form-note">Wait for the customer to accept the current quote before adding an appointment.</p>}
            {jobReadyForScheduling && !canPrepareJobAppointment && job.assigneeMemberId && <p className="crm-form-note">Your schedule access does not allow booking this job for its current assignee.</p>}
          </section>
        </div>
      </div>
    </section>}
    {activeTab === "tasks" && <section className="crm-job-section"><div className="crm-section-heading"><div><span>Checklist</span><h4>What the team must complete</h4></div></div>{job.tasks.length ? <ul className="crm-task-list">{job.tasks.map((task) => <li key={task.id} className={task.status === "done" ? "done" : ""}><label><input type="checkbox" checked={task.status === "done"} disabled={!canManageJobs || busy === `task-toggle:${task.id}`} onChange={(event) => void onWorkOrder("PATCH", { action: "update_task", taskId: task.id, status: event.target.checked ? "done" : "pending" }, `task-toggle:${task.id}`, event.target.checked ? "Task completed." : "Task reopened.")} /><span>{task.title}</span></label><small>{task.dueAt ? `Due ${dateLabel(task.dueAt)}` : "No due date"}</small></li>)}</ul> : <div className="crm-empty"><strong>No tasks yet</strong><span>Add clear steps for the office or field team.</span></div>}{canManageJobs && <form className="crm-inline-form task" onSubmit={addTask}><input name="title" required maxLength={180} placeholder="Add a task" /><input type="date" name="dueAt" aria-label="Task due date" /><button disabled={busy === `task:${job.id}`}>Add task</button></form>}</section>}
    {activeTab === "quote" && <section className="crm-job-section"><TradeQuotePanel user={user} workOrderId={job.id} available={isReleasedLead || (!isProtected && Boolean(customer) && Boolean(job.serviceSiteId))} readOnly={!canManageQuotes} canSend={canSendQuotes} onOpenPriceBook={onOpenPriceBook} onOpenCustomer={canViewCustomerRecords ? onOpenCustomer : undefined} onScheduleJob={canStartJobScheduling && !isReleasedLead ? () => setTab("schedule") : undefined} onChanged={onReload} /></section>}
    {activeTab === "invoice" && <section className="crm-job-section"><TradeQuickInvoicePanel user={user} workOrderId={job.id} customerName={jobCustomerName} jobTitle={job.title} readOnly={!canManageInvoices} onOpenIntegrations={permissions ? undefined : onOpenIntegrations} onChanged={onReload} />{!permissions && <TradeCommercialHandoffPanel user={user} workOrderId={job.id} isProtected={isProtected} hasDirectCustomer={Boolean(customer)} customerName={jobCustomerName} jobTitle={`${job.workNumber} | ${job.title}`} onOpenIntegrations={onOpenIntegrations} onChanged={onReload} />}{canManageInvoices && <details className="crm-commercial-scope crm-manual-finance"><summary>Manual totals for work without a TLink quote</summary><form className="crm-form" onSubmit={saveFinancials}><div className="crm-section-heading"><div><span>Optional fallback</span><h4>Record outside invoice totals</h4><p>Only use this when the work did not follow the accepted quote and invoice preview above.</p></div></div><div className="crm-finance-summary"><article><span>Estimate</span><strong>{money(job.estimatedValueCents)}</strong></article><article><span>Quoted</span><strong>{money(job.quotedValueCents)}</strong></article><article><span>Invoiced</span><strong>{money(job.invoicedValueCents)}</strong></article><article><span>Paid</span><strong>{money(job.paidValueCents)}</strong></article></div><div className="crm-form-grid"><label><span>Estimate amount</span><input type="number" name="estimatedValue" min="0" step="0.01" defaultValue={(job.estimatedValueCents / 100).toFixed(2)} /></label><label><span>Invoice amount</span><input type="number" name="invoicedValue" min="0" step="0.01" defaultValue={(job.invoicedValueCents / 100).toFixed(2)} /></label><label><span>Amount paid</span><input type="number" name="paidValue" min="0" step="0.01" defaultValue={(job.paidValueCents / 100).toFixed(2)} /></label><label><span>Invoice status</span><select name="invoiceStatus" defaultValue={job.invoiceStatus}><option value="not_started">Not started</option><option value="draft">Draft</option><option value="issued">Issued</option><option value="part_paid">Part paid</option><option value="paid">Paid</option><option value="overdue">Overdue</option><option value="void">Void</option></select></label><label><span>Payment due</span><input type="date" name="paymentDueAt" defaultValue={job.paymentDueAt} /></label></div><button className="btn" disabled={busy === `finance:${job.id}`}>Save outside totals</button></form></details>}</section>}
    {activeTab === "notes" && <section className="crm-job-section"><div className="crm-section-heading"><div><span>Job notes</span><h4>Instructions, follow-up and internal history</h4><p>These records are private to your business and are not sent to the customer.</p></div></div><form className="crm-form crm-notes-summary" onSubmit={saveNotes}><fieldset disabled={!canManageJobs} style={{ border: 0, margin: 0, minWidth: 0, padding: 0 }}><div className="crm-form-grid"><label className="wide"><span>Next action</span><input name="nextAction" defaultValue={job.nextAction} maxLength={200} placeholder="What should happen next?" /></label><label className="wide"><span>Job description and instructions</span><textarea name="description" defaultValue={job.description} maxLength={3000} rows={4} /></label><label className="wide"><span>Tags</span><input name="tags" defaultValue={job.tags.join(", ")} maxLength={400} placeholder="heat pump, awaiting parts" /></label></div>{canManageJobs && <button className="btn" disabled={busy === `job-notes:${job.id}`}>Save job notes</button>}</fieldset></form>{canManageJobs && <form className="crm-inline-form note" onSubmit={addNote}><select name="noteType" aria-label="Record type"><option value="internal">Internal note</option><option value="issue">Issue to resolve</option></select><textarea name="body" required maxLength={4000} rows={3} aria-label="New note or issue" placeholder="Record a decision, update or problem" /><button disabled={busy === `note:${job.id}`}>Add record</button></form>}{job.notes.length ? <ol className="crm-notes-list">{job.notes.map((note) => <li key={note.id} className={note.noteType === "issue" ? `issue ${note.issueStatus}` : ""}><div><span>{note.noteType === "issue" ? `Issue | ${note.issueStatus}` : "Internal note"}</span><p>{note.body}</p><small>{dateLabel(note.createdAt, true)}</small></div>{canManageJobs && note.noteType === "issue" && <button type="button" disabled={busy === `issue:${note.id}`} onClick={() => void onCrm("PATCH", { action: "resolve_issue", noteId: note.id, issueStatus: note.issueStatus === "open" ? "resolved" : "open" }, `issue:${note.id}`, note.issueStatus === "open" ? "Issue resolved." : "Issue reopened.")}>{note.issueStatus === "open" ? "Resolve" : "Reopen"}</button>}</li>)}</ol> : <div className="crm-empty"><strong>No internal history yet</strong><span>Add notes as the job develops.</span></div>}</section>}
    {activeTab === "handover" && <section className="crm-job-section"><div className="crm-section-heading"><div><span>Completion records</span><h4>Installed products, documents and care</h4><p>Publish approved product and warranty records into the customer&apos;s free home account.</p></div></div><TradeHandoverCentre user={user} workOrderId={job.id} fullAccess /></section>}
  </article>;
}

function CustomerDetail({ user, customer, contacts, sites, jobs, busy, readOnly = false, hideAssets = false, onSave, onOpenJob }: {
  user: User; customer: Customer; contacts: CustomerContact[]; sites: ServiceSite[]; jobs: Job[]; busy: string; readOnly?: boolean; hideAssets?: boolean;
  onSave: (method: "POST" | "PATCH", body: Record<string, unknown>, key: string, success: string) => Promise<boolean>;
  onOpenJob: (id: string) => void;
}) {
  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    await onSave("PATCH", { action: "update_customer", customerId: customer.id, firstName: data.get("firstName"), lastName: data.get("lastName"), businessName: data.get("businessName"), email: data.get("email"), phone: data.get("phone"), addressLine1: data.get("addressLine1"), addressLine2: data.get("addressLine2"), suburb: data.get("suburb"), addressState: data.get("addressState"), postcode: data.get("postcode"), tags: data.get("tags"), privateNotes: data.get("privateNotes") }, `customer:${customer.id}`, "Customer account saved.");
  }
  async function createContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const saved = await onSave("POST", { action: "create_customer_contact", customerId: customer.id, firstName: data.get("firstName"), lastName: data.get("lastName"), roleLabel: data.get("roleLabel"), email: data.get("email"), phone: data.get("phone"), serviceSiteId: data.get("serviceSiteId") }, `contact-new:${customer.id}`, "Customer contact added.");
    if (saved) form.reset();
  }
  async function saveContact(event: FormEvent<HTMLFormElement>, contactId: string) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    await onSave("PATCH", { action: "update_customer_contact", customerId: customer.id, contactId, firstName: data.get("firstName"), lastName: data.get("lastName"), roleLabel: data.get("roleLabel"), email: data.get("email"), phone: data.get("phone") }, `contact:${contactId}`, "Customer contact saved.");
  }
  async function createSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const saved = await onSave("POST", { action: "create_service_site", customerId: customer.id, siteLabel: data.get("siteLabel"), addressLine1: data.get("addressLine1"), addressLine2: data.get("addressLine2"), suburb: data.get("suburb"), addressState: data.get("addressState"), postcode: data.get("postcode"), accessInstructions: data.get("accessInstructions"), parkingInstructions: data.get("parkingInstructions"), hazardNotes: data.get("hazardNotes"), customerContactId: data.get("customerContactId") }, `site-new:${customer.id}`, "Service site added.");
    if (saved) form.reset();
  }
  async function saveSite(event: FormEvent<HTMLFormElement>, site: ServiceSite) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const update: Record<string, unknown> = {
      action: "update_service_site",
      customerId: customer.id,
      serviceSiteId: site.id,
      siteLabel: data.get("siteLabel"),
      accessInstructions: data.get("accessInstructions"),
      parkingInstructions: data.get("parkingInstructions"),
      hazardNotes: data.get("hazardNotes"),
    };
    if (!site.isPrimary) {
      Object.assign(update, {
        addressLine1: data.get("addressLine1"),
        addressLine2: data.get("addressLine2"),
        suburb: data.get("suburb"),
        addressState: data.get("addressState"),
        postcode: data.get("postcode"),
      });
    }
    await onSave("PATCH", update, `site:${site.id}`, "Service site saved.");
  }
  async function linkContact(event: FormEvent<HTMLFormElement>, siteId: string) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const saved = await onSave("POST", { action: "link_site_contact", customerId: customer.id, serviceSiteId: siteId, customerContactId: data.get("customerContactId"), roleLabel: data.get("roleLabel") }, `site-contact:${siteId}`, "Service contact assigned.");
    if (saved) form.reset();
  }
  const primarySite = sites.find((site) => site.isPrimary);
  const additionalContacts = contacts.filter((contact) => !contact.isPrimary);
  const additionalSites = sites.filter((site) => !site.isPrimary);
  const customerKind = customer.customerType === "business" ? "Business customer" : "Residential customer";
  const serviceContactEditor = (site: ServiceSite) => {
    const availableContacts = contacts.filter((contact) => !site.contacts.some((assigned) => assigned.customerContactId === contact.id));
    return <div className={registerStyles.serviceContacts}>
      <strong>Service contacts</strong>
      {site.contacts.length ? <ul>{site.contacts.map((contact) => <li key={contact.id}><span>{contact.displayName}</span><small>{contact.roleLabel}{contact.phone ? ` | ${contact.phone}` : ""}</small></li>)}</ul> : <p>No service contact assigned.</p>}
      {!readOnly && availableContacts.length > 0 && <form className={registerStyles.linkContactForm} onSubmit={(event) => void linkContact(event, site.id)}>
        <label><span>Contact</span><select name="customerContactId" required defaultValue=""><option value="" disabled>Choose contact</option>{availableContacts.map((contact) => <option key={contact.id} value={contact.id}>{[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Customer contact"}</option>)}</select></label>
        <label><span>Site role</span><input name="roleLabel" placeholder="Owner, tenant, site manager" /></label>
        <button disabled={busy === `site-contact:${site.id}`}>{busy === `site-contact:${site.id}` ? "Assigning..." : "Assign"}</button>
      </form>}
    </div>;
  };

  return <section className={`crm-customer-detail ${registerStyles.customerEditor}`}><fieldset className={registerStyles.customerFieldset} disabled={readOnly}>
    <header><div><span>{customer.customerNumber}</span><h3>{customer.displayName}</h3><small>{customerKind} | {additionalContacts.length} additional contact{additionalContacts.length === 1 ? "" : "s"} | {sites.length} service site{sites.length === 1 ? "" : "s"}</small></div><div className="crm-customer-header-actions"><strong>Private installer record</strong><div className="crm-customer-contact-actions">{customer.phone && <a className="crm-customer-call-action" href={phoneHref(customer.phone)}>Call {customer.phone}</a>}{customer.email && <a className="crm-customer-email-action" href={`mailto:${customer.email}`}>Email customer</a>}</div></div></header>

    <details className={registerStyles.customerPanel} open>
      <summary><span><strong>Customer details</strong><small>Name, contact information and main address</small></span><b>{readOnly ? "View" : "Edit"}</b></summary>
      <div className={registerStyles.panelBody}>
        <form className={registerStyles.customerForm} onSubmit={saveAccount}>
          <div className={registerStyles.customerFormGrid}>
            <label><span>First name</span><input name="firstName" defaultValue={customer.firstName} maxLength={80} autoComplete="given-name" /></label>
            <label><span>Last name</span><input name="lastName" defaultValue={customer.lastName} maxLength={80} autoComplete="family-name" /></label>
            <label><span>Business name</span><input name="businessName" defaultValue={customer.businessName} maxLength={140} autoComplete="organization" /></label>
            <label className={registerStyles.spanTwo}><span>Email</span><input type="email" name="email" defaultValue={customer.email} maxLength={180} autoComplete="email" /></label>
            <label><span>Phone</span><input type="tel" name="phone" defaultValue={customer.phone} maxLength={40} inputMode="tel" autoComplete="tel" /></label>
            <label className={registerStyles.spanTwo}><span>Street address</span><input name="addressLine1" defaultValue={customer.addressLine1} autoComplete="address-line1" /></label>
            <label><span>Address line 2</span><input name="addressLine2" defaultValue={customer.addressLine2} autoComplete="address-line2" /></label>
            <label><span>Suburb</span><input name="suburb" defaultValue={customer.suburb} autoComplete="address-level2" /></label>
            <label><span>State</span><input name="addressState" defaultValue={customer.addressState} maxLength={20} autoComplete="address-level1" /></label>
            <label><span>Postcode</span><input name="postcode" defaultValue={customer.postcode} maxLength={12} inputMode="numeric" autoComplete="postal-code" /></label>
            <label className={registerStyles.wideField}><span>Tags</span><input name="tags" defaultValue={customer.tags.join(", ")} placeholder="VIP, property manager, preferred customer" /></label>
            <label className={registerStyles.wideField}><span>Private account notes</span><textarea name="privateNotes" defaultValue={customer.privateNotes} rows={4} maxLength={2000} /></label>
          </div>
          {!readOnly && <div className={registerStyles.formActions}><button disabled={busy === `customer:${customer.id}`}>{busy === `customer:${customer.id}` ? "Saving..." : "Save customer"}</button></div>}
        </form>
        <p className={registerStyles.recordDates}>Created {dateLabel(customer.createdAt)} | Last updated {dateLabel(customer.updatedAt, true)}</p>
      </div>
    </details>

    {primarySite && <details className={registerStyles.customerPanel}>
      <summary><span><strong>Main site instructions</strong><small>Access, parking and hazards for {primarySite.siteLabel}</small></span><b>Optional</b></summary>
      <div className={registerStyles.panelBody}>
        <form className={registerStyles.customerForm} onSubmit={(event) => void saveSite(event, primarySite)}>
          <div className={registerStyles.customerFormGrid}>
            <label><span>Site name</span><input name="siteLabel" defaultValue={primarySite.siteLabel} required maxLength={100} /></label>
            <label className={registerStyles.wideField}><span>Access instructions</span><textarea name="accessInstructions" defaultValue={primarySite.accessInstructions} rows={2} maxLength={2000} /></label>
            <label className={registerStyles.wideField}><span>Parking instructions</span><textarea name="parkingInstructions" defaultValue={primarySite.parkingInstructions} rows={2} maxLength={1000} /></label>
            <label className={registerStyles.wideField}><span>Hazards and controls</span><textarea name="hazardNotes" defaultValue={primarySite.hazardNotes} rows={3} maxLength={2000} placeholder="Record site hazards only. Confirm controls before work starts." /></label>
          </div>
          {!readOnly && <div className={registerStyles.formActions}><button disabled={busy === `site:${primarySite.id}`}>{busy === `site:${primarySite.id}` ? "Saving..." : "Save site instructions"}</button></div>}
        </form>
        {serviceContactEditor(primarySite)}
      </div>
    </details>}

    <details className={registerStyles.customerPanel}>
      <summary><span><strong>Additional contacts</strong><small>Billing, tenants and other people for this customer</small></span><b>{additionalContacts.length}</b></summary>
      <div className={registerStyles.panelBody}>
        {additionalContacts.length ? <div className={registerStyles.entityList}>{additionalContacts.map((contact) => <details key={contact.id} className={registerStyles.entityDetails}>
          <summary><span><strong>{[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Customer contact"}</strong><small>{contact.roleLabel || "Additional contact"}</small></span><em>{contact.phone || contact.email || "Open to edit"}</em></summary>
          <div className={registerStyles.entityBody}><form className={registerStyles.customerForm} onSubmit={(event) => void saveContact(event, contact.id)}><div className={registerStyles.customerFormGrid}>
            <label><span>First name</span><input name="firstName" defaultValue={contact.firstName} maxLength={80} /></label>
            <label><span>Last name</span><input name="lastName" defaultValue={contact.lastName} maxLength={80} /></label>
            <label><span>Role</span><input name="roleLabel" defaultValue={contact.roleLabel} maxLength={80} placeholder="Owner, accounts, tenant" /></label>
            <label className={registerStyles.spanTwo}><span>Email</span><input type="email" name="email" defaultValue={contact.email} maxLength={180} /></label>
            <label><span>Phone</span><input type="tel" name="phone" defaultValue={contact.phone} maxLength={40} inputMode="tel" /></label>
          </div>{!readOnly && <div className={registerStyles.formActions}><button disabled={busy === `contact:${contact.id}`}>{busy === `contact:${contact.id}` ? "Saving..." : "Save contact"}</button></div>}</form></div>
        </details>)}</div> : <p className={registerStyles.emptyMessage}>No additional contacts. The customer details above are the main contact record.</p>}
        {!readOnly && <details className={registerStyles.addPanel}><summary>Add contact</summary><div className={registerStyles.entityBody}><form className={registerStyles.customerForm} onSubmit={createContact}><div className={registerStyles.customerFormGrid}>
          <label><span>First name</span><input name="firstName" required maxLength={80} /></label><label><span>Last name</span><input name="lastName" maxLength={80} /></label><label><span>Role</span><input name="roleLabel" maxLength={80} placeholder="Owner, accounts, tenant" /></label><label className={registerStyles.spanTwo}><span>Email</span><input type="email" name="email" maxLength={180} /></label><label><span>Phone</span><input type="tel" name="phone" maxLength={40} inputMode="tel" /></label><label><span>Assign to site</span><select name="serviceSiteId"><option value="">Not yet</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.siteLabel}</option>)}</select></label>
        </div><div className={registerStyles.formActions}><button disabled={busy === `contact-new:${customer.id}`}>{busy === `contact-new:${customer.id}` ? "Adding..." : "Add contact"}</button></div></form></div></details>}
      </div>
    </details>

    <details className={registerStyles.customerPanel}>
      <summary><span><strong>Additional service sites</strong><small>Other properties with their own address and work instructions</small></span><b>{additionalSites.length}</b></summary>
      <div className={registerStyles.panelBody}>
        {additionalSites.length ? <div className={registerStyles.entityList}>{additionalSites.map((site) => <details key={site.id} className={registerStyles.entityDetails}>
          <summary><span><strong>{site.siteLabel}</strong><small>Additional service site</small></span><em>{[site.addressLine1, site.suburb, site.addressState, site.postcode].filter(Boolean).join(", ") || "Address not added"}</em></summary>
          <div className={registerStyles.entityBody}>
            <form className={registerStyles.customerForm} onSubmit={(event) => void saveSite(event, site)}><div className={registerStyles.customerFormGrid}>
              <label><span>Site name</span><input name="siteLabel" defaultValue={site.siteLabel} required maxLength={100} /></label>
              <label className={registerStyles.spanTwo}><span>Street address</span><input name="addressLine1" defaultValue={site.addressLine1} /></label>
              <label><span>Address line 2</span><input name="addressLine2" defaultValue={site.addressLine2} /></label>
              <label><span>Suburb</span><input name="suburb" defaultValue={site.suburb} /></label>
              <label><span>State</span><input name="addressState" defaultValue={site.addressState} maxLength={20} /></label>
              <label><span>Postcode</span><input name="postcode" defaultValue={site.postcode} maxLength={12} inputMode="numeric" /></label>
              <label className={registerStyles.wideField}><span>Access instructions</span><textarea name="accessInstructions" defaultValue={site.accessInstructions} rows={2} maxLength={2000} /></label>
              <label className={registerStyles.wideField}><span>Parking instructions</span><textarea name="parkingInstructions" defaultValue={site.parkingInstructions} rows={2} maxLength={1000} /></label>
              <label className={registerStyles.wideField}><span>Hazards and controls</span><textarea name="hazardNotes" defaultValue={site.hazardNotes} rows={3} maxLength={2000} placeholder="Record site hazards only. Confirm controls before work starts." /></label>
            </div>{!readOnly && <div className={registerStyles.formActions}><button disabled={busy === `site:${site.id}`}>{busy === `site:${site.id}` ? "Saving..." : "Save site"}</button></div>}</form>
            {serviceContactEditor(site)}
          </div>
        </details>)}</div> : <p className={registerStyles.emptyMessage}>No additional sites. The main address is saved in Customer details.</p>}
        {!readOnly && <details className={registerStyles.addPanel}><summary>Add service site</summary><div className={registerStyles.entityBody}><form className={registerStyles.customerForm} onSubmit={createSite}><div className={registerStyles.customerFormGrid}>
          <label><span>Site name</span><input name="siteLabel" required maxLength={100} placeholder="Warehouse, rental, northern office" /></label><label className={registerStyles.spanTwo}><span>Service contact</span><select name="customerContactId"><option value="">Not yet</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Customer contact"}</option>)}</select></label><label className={registerStyles.spanTwo}><span>Street address</span><input name="addressLine1" /></label><label><span>Address line 2</span><input name="addressLine2" /></label><label><span>Suburb</span><input name="suburb" /></label><label><span>State</span><input name="addressState" maxLength={20} /></label><label><span>Postcode</span><input name="postcode" maxLength={12} inputMode="numeric" /></label><label className={registerStyles.wideField}><span>Access instructions</span><textarea name="accessInstructions" rows={2} maxLength={2000} /></label><label className={registerStyles.wideField}><span>Parking instructions</span><textarea name="parkingInstructions" rows={2} maxLength={1000} /></label><label className={registerStyles.wideField}><span>Hazards and controls</span><textarea name="hazardNotes" rows={3} maxLength={2000} /></label>
        </div><div className={registerStyles.formActions}><button disabled={busy === `site-new:${customer.id}`}>{busy === `site-new:${customer.id}` ? "Adding..." : "Add service site"}</button></div></form></div></details>}
      </div>
    </details>

    <details className={registerStyles.customerPanel}>
      <summary><span><strong>Jobs</strong><small>Work linked to this customer</small></span><b>{jobs.length}</b></summary>
      <div className={registerStyles.panelBody}>{jobs.length ? <div className={registerStyles.customerJobs}>{jobs.map((job) => <button type="button" key={job.id} onClick={() => onOpenJob(job.id)}><span>{job.workNumber}</span><strong>{job.title}</strong><small>{sites.find((site) => site.id === job.serviceSiteId)?.siteLabel || "Site not selected"} | {pipelineLabels[job.pipelineStage] || job.pipelineStage} | {job.scheduledStart ? `Scheduled ${dateLabel(job.scheduledStart)}` : `Created ${dateLabel(job.createdAt)}`}</small></button>)}</div> : <p className={registerStyles.emptyMessage}>No jobs linked yet.</p>}</div>
    </details>
    {!readOnly && !hideAssets && <details className={registerStyles.customerPanel}>
      <summary><span><strong>Assets and history</strong><small>Installed products, warranties and the private customer timeline</small></span><b>Open</b></summary>
      <div className={registerStyles.assetPanel}><TradeAssetWorkspace user={user} customerId={customer.id} sites={sites} compact onOpenJob={onOpenJob} /></div>
    </details>}
  </fieldset></section>;
}
