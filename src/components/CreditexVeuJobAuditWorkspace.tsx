"use client";

import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./CreditexVeuJobAuditWorkspace.module.css";

export type JobWorkspaceSection =
  | "customer_details"
  | "customer_jobs"
  | "customer_files"
  | "customer_create_job"
  | "job_summary"
  | "job_appointments"
  | "job_actions"
  | "job_questions"
  | "job_quote_invoice"
  | "job_calculations"
  | "job_transactions"
  | "job_files"
  | "job_issues"
  | "job_emails"
  | "job_history"
  | "appointment_summary"
  | "appointment_actions"
  | "appointment_questions"
  | "appointment_certificate_submissions"
  | "appointment_decommissioning"
  | "appointment_correspondence"
  | "appointment_audit"
  | "appointment_history"
  | "print_preview";

export type CreditexJobAuditRole =
  | "admin"
  | "case_manager"
  | "reviewer"
  | "auditor";

export type CreditexJobAuditJob = {
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

export type CreditexJobAuditFilterOptions = {
  reviewStatuses: string[];
  evidenceStatuses: string[];
  lookupStatuses: string[];
  ruleStatuses?: string[];
  calculatorStatuses?: string[];
  connectorStatuses?: string[];
  workStages?: string[];
  workTypes?: string[];
  priorities?: string[];
  appointmentTypes?: string[];
  appointmentStatuses?: string[];
  customerTypes?: string[];
  serviceCategories?: string[];
  productCategories?: string[];
  postcodes?: string[];
  tags?: string[];
  dateFields?: string[];
  sortColumns?: string[];
  pageSizes?: number[];
};

export type CreditexJobAuditEvidenceContract = {
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
};

export type CreditexJobAuditPriority = {
  key: string;
  number: number;
  title: string;
  status: string;
  complete: boolean;
  boundary: string;
};

export type CreditexJobAuditEvent = {
  eventType: string;
  summary: string;
  createdAt: string;
  actorType?: string;
  actorUid?: string;
};

export type CreditexJobAuditDetailJob = {
  id: string;
  pilotRunId: string;
  workOrderId: string;
  caseNumber: string;
  jobNumber: string;
  activity: {
    templateId: string;
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
  };
  statuses: {
    review: string;
    evidence: string;
    rule: string;
    lookup: string;
    calculator: string;
    connector: string;
  };
  installer: {
    id: string;
    companyCode: string;
    businessName: string;
    status: string;
    email: string;
    abn: string;
    addressLine1: string;
    suburb: string;
    addressState: string;
    postcode: string;
    contactName: string;
    phone: string;
    partnerType: string;
    accountStatus: string;
    verificationStatus: string;
  };
  technician: {
    id: string;
    teamMemberId: string;
    technicianCode: string;
    displayName: string;
    status: string;
    teamStatus: string;
  };
  work: {
    workNumber: string;
    workType: string;
    sourceType: string;
    sourceReference: string;
    title: string;
    serviceCategory: string;
    serviceCategories: string[];
    siteArea: string;
    stage: string;
    priority: string;
    scheduledStart: string;
    scheduledEnd: string;
    assigneeMemberId: string;
    assigneeLabel: string;
    revision: number;
    recordStatus: string;
  };
  crm: {
    jobDetailId: string;
    customerSource: string;
    pipelineStage: string;
    buildingType: string;
    description: string;
    customerReference: string;
    nextAction: string;
    tags: string[];
    estimatedValueCents: number;
    quotedValueCents: number;
    invoicedValueCents: number;
    paidValueCents: number;
    quoteStatus: string;
    invoiceStatus: string;
    paymentDueAt: string;
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
    addressLine1: string;
    addressLine2: string;
    suburb: string;
    addressState: string;
    postcode: string;
    tags: string[];
    privateNotes: string;
  };
  site: {
    id: string;
    label: string;
    addressLine1: string;
    addressLine2: string;
    suburb: string;
    addressState: string;
    postcode: string;
    accessInstructions: string;
    parkingInstructions: string;
    hazardNotes: string;
    isPrimary: boolean;
  };
  recordMode: string;
  createdAt: string;
  updatedAt: string;
};

export type CreditexJobAuditAppointment = {
  id: string;
  appointmentType: string;
  title: string;
  startsAt: string;
  endsAt: string;
  assigneeMemberId: string;
  assigneeLabel: string;
  status: string;
  travelStartedAt: string;
  arrivedAt: string;
  workStartedAt: string;
  completedAt: string;
  notes: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type CreditexJobAuditAppointmentRevision = {
  id: string;
  appointmentId: string;
  revision: number;
  startsAt: string;
  endsAt: string;
  assigneeMemberId: string;
  assigneeLabel: string;
  changeSource: string;
  sourceReference: string;
  changedByUid: string;
  createdAt: string;
};

export type CreditexJobAuditRescheduleRequest = {
  id: string;
  appointmentId: string;
  customerId: string;
  status: string;
  preferredWindows: unknown[];
  reason: string;
  accessNotes: string;
  requestedAppointmentRevision: number;
  originalStartsAt: string;
  originalEndsAt: string;
  originalAssigneeMemberId: string;
  originalAssigneeLabel: string;
  proposedStartsAt: string;
  proposedEndsAt: string;
  proposedAssigneeMemberId: string;
  proposedAssigneeLabel: string;
  decisionNote: string;
  revision: number;
  requestedAt: string;
  decidedByUid: string;
  decidedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type CreditexJobAuditRescheduleEvent = {
  id: string;
  requestId: string;
  appointmentId: string;
  actorType: string;
  actorUid: string;
  eventType: string;
  summary: string;
  createdAt: string;
};

export type CreditexJobAuditDetail = {
  readOnly: boolean;
  job: CreditexJobAuditDetailJob;
  priorities: CreditexJobAuditPriority[];
  customerJobs: Array<{
    id: string;
    jobNumber: string;
    caseNumber: string;
    registryActivityCode: string;
    title: string;
    reviewStatus: string;
    evidenceStatus: string;
    activityDate: string;
    createdAt: string;
    updatedAt: string;
  }>;
  appointments: CreditexJobAuditAppointment[];
  appointmentAudit: {
    revisions: CreditexJobAuditAppointmentRevision[];
    rescheduleRequests: CreditexJobAuditRescheduleRequest[];
    rescheduleEvents: CreditexJobAuditRescheduleEvent[];
  };
  crm: {
    tasks: Array<{
      id: string;
      title: string;
      dueAt: string;
      status: string;
      completedAt: string;
      revision: number;
      createdAt: string;
      updatedAt: string;
    }>;
    events: Array<{
      id: string;
      eventType: string;
      summary: string;
      createdAt: string;
    }>;
    notes: Array<{
      id: string;
      noteType: string;
      body: string;
      issueStatus: string;
      createdAt: string;
      updatedAt: string;
    }>;
    forms: Array<{
      id: string;
      templateKey: string;
      templateVersion: number;
      templateName: string;
      jurisdiction: string;
      answersRecorded: boolean;
      status: string;
      revision: number;
      completedAt: string;
      createdAt: string;
      updatedAt: string;
    }>;
    media: Array<{
      id: string;
      category: string;
      fileName: string;
      contentType: string;
      sizeBytes: number;
      caption: string;
      source: string;
      metadataPresent: boolean;
      gpsPresent: boolean;
      originalHashPresent: boolean;
      createdAt: string;
      updatedAt: string;
    }>;
    quotes: Array<{
      id: string;
      quoteNumber: string;
      status: string;
      totalCents: number;
      validUntil: string;
      issuedAt: string;
      createdAt: string;
      updatedAt: string;
    }>;
    invoices: Array<{
      id: string;
      invoiceNumber: string;
      currency: string;
      lineItemCount: number;
      totalCents: number;
      dueAt: string;
      status: string;
      deliveryStatus: string;
      sentAt: string;
      createdAt: string;
      updatedAt: string;
    }>;
  };
  capabilities: Array<{
    key: string;
    group: string;
    label: string;
    available: boolean;
    count: number;
    readOnly: boolean;
    reason: string;
  }>;
  rules: {
    status: string;
    sources: Array<{
      sourceKey: string;
      title: string;
      officialSourceUrl: string;
      officialVersion: string;
      effectiveFrom: string;
      effectiveTo: string;
      hashStatus: string;
      verificationStatus: string;
    }>;
  };
  lookups: {
    status: string;
    options: Array<{
      controlType: string;
      optionCode: string;
      label: string;
      liveLookupEnabled: boolean;
      sourceKey: string;
    }>;
  };
  evidence: {
    status: string;
    collectedCount: number;
    pilotMediaCount: number;
    contracts: CreditexJobAuditEvidenceContract[];
  };
  calculator: {
    status: string;
    contract: {
      registryActivityCode: string;
      outputUnit: string;
      formulaStatus: string;
      testVectorStatus: string;
      sourceKey: string;
    } | null;
  };
  submission: {
    status: string;
    externalSubmissionEnabled: boolean;
    connectors: Array<{
      connectorCode: string;
      mappingVersion: string;
      mode: string;
      status: string;
      itemCount: number;
      acceptedCount: number;
      rejectedCount: number;
      unmatchedCount: number;
      duplicateCount: number;
      artifactHashPresent: boolean;
      externalSubmissionEnabled: boolean;
      updatedAt: string;
    }>;
  };
  boundaries: {
    syntheticOnly: boolean;
    regulatedCasesCreated: number;
    complianceEvidenceCreated: number;
    submissionItemsCreated: number;
    externalSubmissionEnabled: boolean;
  };
};

export type CreditexVeuJobAuditWorkspaceProps = {
  job: CreditexJobAuditJob;
  section: JobWorkspaceSection;
  role: CreditexJobAuditRole;
  busy: boolean;
  options: CreditexJobAuditFilterOptions;
  priorities: CreditexJobAuditPriority[];
  detail?: CreditexJobAuditDetail | null;
  detailBusy?: boolean;
  detailError?: string;
  onSectionChange: (section: JobWorkspaceSection) => void;
  onClose: () => void;
  onSave: (next: {
    reviewStatus: string;
    evidenceStatus: string;
    lookupStatus: string;
  }) => void | Promise<void>;
  onPrint: () => void;
};

type NavigationGroup = {
  label: string;
  items: Array<{ section: JobWorkspaceSection; label: string }>;
};

const NAVIGATION: NavigationGroup[] = [
  {
    label: "Customer",
    items: [
      { section: "customer_details", label: "Customer details" },
      { section: "customer_jobs", label: "Jobs for customer" },
      { section: "customer_files", label: "Customer files" },
      { section: "customer_create_job", label: "Create customer job" },
    ],
  },
  {
    label: "Job",
    items: [
      { section: "job_summary", label: "Job summary" },
      { section: "job_appointments", label: "Job appointments" },
      { section: "job_actions", label: "Job actions" },
      { section: "job_questions", label: "Job questions" },
      { section: "job_quote_invoice", label: "Quote and invoice" },
      { section: "job_calculations", label: "Calculations" },
      { section: "job_transactions", label: "Transactions and payments" },
      { section: "job_files", label: "Files and photos" },
      { section: "job_issues", label: "Issues" },
      { section: "job_emails", label: "Emails" },
      { section: "job_history", label: "Job history" },
    ],
  },
  {
    label: "Appointment",
    items: [
      { section: "appointment_summary", label: "Appointment summary" },
      { section: "appointment_actions", label: "Appointment actions" },
      { section: "appointment_questions", label: "Appointment questions" },
      {
        section: "appointment_certificate_submissions",
        label: "Certificate submissions",
      },
      {
        section: "appointment_decommissioning",
        label: "Decommissioning summary",
      },
      {
        section: "appointment_correspondence",
        label: "Correspondence",
      },
      { section: "appointment_audit", label: "Auditing" },
      { section: "appointment_history", label: "Appointment history" },
    ],
  },
  {
    label: "Output",
    items: [{ section: "print_preview", label: "Print preview" }],
  },
];

const SECTION_LABELS = Object.fromEntries(
  NAVIGATION.flatMap((group) =>
    group.items.map((item) => [item.section, item.label])),
) as Record<JobWorkspaceSection, string>;

function readable(value: string | null | undefined) {
  if (!value) return "Not captured";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fullName(job: CreditexJobAuditJob) {
  const name = [job.customer.firstName, job.customer.lastName]
    .filter(Boolean)
    .join(" ");
  return name || job.customer.businessName || "Synthetic customer";
}

function authoritativeName(job: CreditexJobAuditDetailJob) {
  const name = [job.customer.firstName, job.customer.lastName]
    .filter(Boolean)
    .join(" ");
  return name || job.customer.businessName || "Synthetic customer";
}

function authoritativeAddress(job: CreditexJobAuditDetailJob) {
  return [
    job.site.addressLine1,
    job.site.addressLine2,
    job.site.suburb,
    job.site.addressState,
    job.site.postcode,
  ].filter(Boolean).join(", ") || "Not captured in this synthetic run";
}

function detailMatchesJob(
  job: CreditexJobAuditJob,
  detail: CreditexJobAuditDetail | null | undefined,
) {
  return Boolean(
    detail
    && detail.job
    && detail.job.id === job.id
    && detail.job.workOrderId === job.workOrderId,
  );
}

function detailUnavailableReason({
  detailBusy,
  detailError,
}: {
  detailBusy?: boolean;
  detailError?: string;
}) {
  if (detailBusy) {
    return "The complete owner-scoped job record is still loading.";
  }
  if (detailError) {
    return `The complete owner-scoped job record could not be verified: ${detailError}`;
  }
  return "The complete owner-scoped job record has not loaded successfully.";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not captured in this synthetic run";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: value.includes("T") ? "short" : undefined,
    timeZone: "Australia/Melbourne",
  }).format(date);
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(cents / 100);
}

function Field({
  label,
  children,
  unavailable = false,
}: {
  label: string;
  children: ReactNode;
  unavailable?: boolean;
}) {
  return (
    <div className={styles.field}>
      <dt>{label}</dt>
      <dd data-unavailable={unavailable}>{children}</dd>
    </div>
  );
}

function FieldGrid({ children }: { children: ReactNode }) {
  return <dl className={styles.fieldGrid}>{children}</dl>;
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </header>
      <div className={styles.cardBody}>{children}</div>
    </section>
  );
}

function EmptyState({
  title,
  explanation,
}: {
  title: string;
  explanation: string;
}) {
  return (
    <div className={styles.emptyState}>
      <strong>{title}</strong>
      <p>{explanation}</p>
    </div>
  );
}

function DetailRequired({
  detailBusy,
  detailError,
}: {
  detailBusy?: boolean;
  detailError?: string;
}) {
  return (
    <SectionCard title="Authoritative job detail required">
      <EmptyState
        title={detailBusy ? "Loading full job detail" : "Full job detail unavailable"}
        explanation={detailUnavailableReason({ detailBusy, detailError })}
      />
    </SectionCard>
  );
}

function DisabledAction({
  label,
  reason,
}: {
  label: string;
  reason: string;
}) {
  return (
    <div className={styles.disabledAction}>
      <button type="button" disabled>{label}</button>
      <span>{reason}</span>
    </div>
  );
}

function StatusBadge({
  value,
  good = false,
}: {
  value: string;
  good?: boolean;
}) {
  return (
    <span className={styles.statusBadge} data-good={good}>
      {readable(value)}
    </span>
  );
}

function CustomerDetails({ job }: { job: CreditexJobAuditDetailJob }) {
  return (
    <>
      <SectionCard title="Customer details">
        <FieldGrid>
          <Field label="Customer number">{job.customer.customerNumber}</Field>
          <Field label="Customer type">{readable(job.customer.customerType)}</Field>
          <Field label="Customer name">{authoritativeName(job)}</Field>
          <Field label="Business name">{job.customer.businessName || "Not captured"}</Field>
          <Field label="Business number">{job.customer.businessNumber || "Not captured"}</Field>
          <Field label="Phone">{job.customer.phone}</Field>
          <Field label="Email">{job.customer.email}</Field>
          <Field label="Customer source">{readable(job.crm.customerSource)}</Field>
          <Field label="Customer tags">{job.customer.tags.join(", ") || "None"}</Field>
        </FieldGrid>
      </SectionCard>
      <SectionCard
        title="Private customer notes"
        description="Visible only to authorised compliance users inside this owner-scoped record."
      >
        <p className={styles.privateRecordNote}>
          {job.customer.privateNotes || "No private customer note captured"}
        </p>
      </SectionCard>
      <SectionCard title="Service address">
        <FieldGrid>
          <Field label="Site">{job.site.label}</Field>
          <Field label="Address">{authoritativeAddress(job)}</Field>
          <Field label="Suburb">{job.site.suburb}</Field>
          <Field label="State">{job.site.addressState}</Field>
          <Field label="Postcode">{job.site.postcode}</Field>
          <Field label="Building type">{readable(job.crm.buildingType)}</Field>
          <Field label="Access instructions">{job.site.accessInstructions || "Not captured"}</Field>
          <Field label="Parking instructions">{job.site.parkingInstructions || "Not captured"}</Field>
          <Field label="Hazard notes">{job.site.hazardNotes || "Not captured"}</Field>
        </FieldGrid>
      </SectionCard>
      <SectionCard title="Installer account">
        <FieldGrid>
          <Field label="Installer">{job.installer.businessName}</Field>
          <Field label="Company code">{job.installer.companyCode}</Field>
          <Field label="ABN">{job.installer.abn || "Not captured"}</Field>
          <Field label="Contact">{job.installer.contactName || "Not captured"}</Field>
          <Field label="Phone">{job.installer.phone || "Not captured"}</Field>
          <Field label="Email">{job.installer.email || "Not captured"}</Field>
          <Field label="Installer address line 1">
            {job.installer.addressLine1 || "Not captured"}
          </Field>
          <Field label="Installer suburb">{job.installer.suburb || "Not captured"}</Field>
          <Field label="Installer state">{job.installer.addressState || "Not captured"}</Field>
          <Field label="Installer postcode">{job.installer.postcode || "Not captured"}</Field>
          <Field label="Account status">{readable(job.installer.accountStatus)}</Field>
          <Field label="Verification">{readable(job.installer.verificationStatus)}</Field>
        </FieldGrid>
      </SectionCard>
    </>
  );
}

function CustomerJobs({
  detail,
  onSectionChange,
}: {
  detail: CreditexJobAuditDetail;
  onSectionChange: (section: JobWorkspaceSection) => void;
}) {
  return (
    <SectionCard
      title="Jobs for customer"
      description="Owner-scoped jobs returned by the authoritative customer relationship."
    >
      {detail.customerJobs.length ? <div className={styles.tableScroll}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Activity</th>
              <th>Review</th>
              <th>Evidence</th>
              <th>Activity date</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {detail.customerJobs.map((candidate) => (
              <tr key={candidate.id} data-current={candidate.id === detail.job.id}>
                <td>{candidate.jobNumber}</td>
                <td>{candidate.registryActivityCode} | {candidate.title}</td>
                <td><StatusBadge value={candidate.reviewStatus} /></td>
                <td><StatusBadge value={candidate.evidenceStatus} /></td>
                <td>{formatDate(candidate.activityDate)}</td>
                <td>
                  {candidate.id === detail.job.id ? (
                    <button
                      type="button"
                      className={styles.textButton}
                      onClick={() => onSectionChange("job_summary")}
                    >
                      View current job
                    </button>
                  ) : (
                    <span>Open from register</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div> : (
        <EmptyState
          title="No customer-linked jobs returned"
          explanation="The authoritative detail response did not return a customer-linked job."
        />
      )}
    </SectionCard>
  );
}

function JobSummary({ job }: { job: CreditexJobAuditDetailJob }) {
  return (
    <>
      <SectionCard title="Job summary">
        <FieldGrid>
          <Field label="Job ID">{job.jobNumber}</Field>
          <Field label="Case ID">{job.caseNumber}</Field>
          <Field label="Work order ID">{job.workOrderId}</Field>
          <Field label="Status">{readable(job.work.stage)}</Field>
          <Field label="Priority">{readable(job.work.priority)}</Field>
          <Field label="Work type">{readable(job.work.workType)}</Field>
          <Field label="Assigned to">{job.work.assigneeLabel}</Field>
          <Field label="Installer">{job.installer.businessName}</Field>
          <Field label="Field technician">{job.technician.displayName}</Field>
          <Field label="Pipeline stage">{readable(job.crm.pipelineStage)}</Field>
          <Field label="CRM description">{job.crm.description || "Not captured"}</Field>
          <Field label="Next action">{job.crm.nextAction || "Not captured"}</Field>
          <Field label="Work revision">{job.work.revision}</Field>
          <Field label="Work record status">{readable(job.work.recordStatus)}</Field>
          <Field label="Created">{formatDate(job.createdAt)}</Field>
          <Field label="Last updated">{formatDate(job.updatedAt)}</Field>
        </FieldGrid>
      </SectionCard>
      <SectionCard title="VEU activity">
        <FieldGrid>
          <Field label="Registry activity">{job.activity.registryActivityCode}</Field>
          <Field label="Activity title">{job.activity.title}</Field>
          <Field label="Specification part">
            {job.activity.specificationPart || "Specialist method"}
          </Field>
          <Field label="Scenario">{job.activity.scenario || job.activity.scenarioCode}</Field>
          <Field label="Service category">{job.activity.serviceCategory}</Field>
          <Field label="Product category">{job.activity.productCategory}</Field>
          <Field label="Activity date">{formatDate(job.activity.activityDate)}</Field>
          <Field label="Catalogue state">{readable(job.activity.catalogueState)}</Field>
        </FieldGrid>
      </SectionCard>
      <SectionCard title="References">
        <FieldGrid>
          <Field label="Source type">{readable(job.work.sourceType)}</Field>
          <Field label="Source reference">{job.work.sourceReference}</Field>
          <Field label="Customer reference">{job.crm.customerReference}</Field>
          <Field label="Record mode">{readable(job.recordMode)}</Field>
          <Field label="Tags">{job.crm.tags.join(", ") || "None"}</Field>
          <Field label="External appointment reference" unavailable>
            Not captured in this synthetic run
          </Field>
        </FieldGrid>
      </SectionCard>
    </>
  );
}

function AppointmentSummary({
  job,
  appointment,
}: {
  job: CreditexJobAuditDetailJob;
  appointment: CreditexJobAuditAppointment;
}) {
  const [mode, setMode] = useState<"combined" | "details" | "comments">(
    "combined",
  );
  return (
    <>
      <div
        className={styles.summaryToolbar}
        role="group"
        aria-label="Appointment summary view"
      >
        {[
          ["combined", "Combined view"],
          ["details", "Appointment details"],
          ["comments", "Comments summary"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() =>
              setMode(value as "combined" | "details" | "comments")}
          >
            {label}
          </button>
        ))}
      </div>
      {(mode === "combined" || mode === "details") && (
        <>
      <SectionCard title="Completion">
        <FieldGrid>
          <Field label="Completion status">
            {readable(appointment.status)}
          </Field>
          <Field label="Completion sub-status" unavailable>
            Dataforce equivalence is not mapped
          </Field>
        </FieldGrid>
      </SectionCard>
      <SectionCard title="Assignment details">
        <FieldGrid>
          <Field label="Assigned to">{appointment.assigneeLabel || job.work.assigneeLabel}</Field>
          <Field label="Work type">{readable(job.work.workType)}</Field>
          <Field label="Appointment ID">{appointment.id}</Field>
          <Field label="Appointment type">{readable(appointment.appointmentType)}</Field>
          <Field label="Appointment title">{appointment.title}</Field>
          <Field label="Revision">{appointment.revision}</Field>
        </FieldGrid>
      </SectionCard>
      <SectionCard title="Customer information">
        <FieldGrid>
          <Field label="Customer name">{authoritativeName(job)}</Field>
          <Field label="Phone">{job.customer.phone}</Field>
          <Field label="Company">{job.customer.businessName || "Not captured"}</Field>
          <Field label="Address">{authoritativeAddress(job)}</Field>
          <Field label="Postcode">{job.site.postcode}</Field>
        </FieldGrid>
      </SectionCard>
      <SectionCard title="Scheduling information">
        <FieldGrid>
          <Field label="Scheduled date and time">{formatDate(appointment.startsAt)}</Field>
          <Field label="Scheduled end">{formatDate(appointment.endsAt)}</Field>
          <Field label="Travel started">{formatDate(appointment.travelStartedAt)}</Field>
          <Field label="Arrived">{formatDate(appointment.arrivedAt)}</Field>
          <Field label="Work started">{formatDate(appointment.workStartedAt)}</Field>
          <Field label="Actual completed date">{formatDate(appointment.completedAt)}</Field>
          <Field label="Last record update">{formatDate(appointment.updatedAt)}</Field>
          <Field label="Activity date">{formatDate(job.activity.activityDate)}</Field>
          <Field label="Compliant" unavailable>Not determined in this synthetic run</Field>
          <Field label="Appointment status">{readable(appointment.status)}</Field>
        </FieldGrid>
      </SectionCard>
      <SectionCard title="Reference information">
        <FieldGrid>
          <Field label="Created by">{job.technician.displayName}</Field>
          <Field label="External job ID">{job.work.sourceReference}</Field>
          <Field label="External appointment reference" unavailable>
            Not captured in this synthetic run
          </Field>
          <Field label="Verification call" unavailable>Not captured in this synthetic run</Field>
        </FieldGrid>
      </SectionCard>
      <SectionCard title="Appointment details">
        <FieldGrid>
          <Field label="Hazard notes">{job.site.hazardNotes || "Not captured"}</Field>
          <Field label="Appointment outcome" unavailable>Not captured in this synthetic run</Field>
          <Field label="Appointment tags" unavailable>Not captured in this synthetic run</Field>
          <Field label="Paperwork status" unavailable>Not captured in this synthetic run</Field>
          <Field label="Job tags">{job.crm.tags.join(", ") || "None"}</Field>
        </FieldGrid>
      </SectionCard>
      <SectionCard title="Quotation and submission information">
        <FieldGrid>
          <Field label="Quotation status">{readable(job.crm.quoteStatus)}</Field>
          <Field label="Calculations (install)">
            {readable(job.statuses.calculator)}
          </Field>
          <Field label="Recycling receipt(s)" unavailable>
            Not mapped in this synthetic run
          </Field>
          <Field label="Submission eligibility" unavailable>
            Not determined
          </Field>
        </FieldGrid>
      </SectionCard>
      <SectionCard title="Invoice information">
        <FieldGrid>
          <Field label="Invoice eligibility" unavailable>
            Not determined
          </Field>
          <Field label="Client invoice eligibility" unavailable>
            Not determined
          </Field>
          <Field label="Invoice status">{readable(job.crm.invoiceStatus)}</Field>
          <Field label="Paid">{formatCurrency(job.crm.paidValueCents)}</Field>
        </FieldGrid>
      </SectionCard>
      <SectionCard title="Job instructions">
        <EmptyState
          title="No job instructions captured"
          explanation="This deterministic synthetic run contains no customer or installer instruction record."
        />
      </SectionCard>
        </>
      )}
      {(mode === "combined" || mode === "comments") && (
        <SectionCard title="Comments summary">
          {appointment.notes ? (
            <p className={styles.recordText}>{appointment.notes}</p>
          ) : (
            <EmptyState
              title="No appointment notes captured"
              explanation="The authoritative appointment record contains no notes."
            />
          )}
        </SectionCard>
      )}
    </>
  );
}

function AppointmentSelector({
  appointments,
  selectedAppointmentId,
  onChange,
}: {
  appointments: CreditexJobAuditAppointment[];
  selectedAppointmentId: string;
  onChange: (appointmentId: string) => void;
}) {
  if (!appointments.length) return null;
  return (
    <div className={styles.appointmentSelector}>
      <label htmlFor="creditex-audit-appointment">
        Appointment
        <select
          id="creditex-audit-appointment"
          value={selectedAppointmentId}
          onChange={(event) => onChange(event.target.value)}
        >
          {appointments.map((appointment) => (
            <option key={appointment.id} value={appointment.id}>
              {appointment.id} | {readable(appointment.appointmentType)} |{" "}
              {formatDate(appointment.startsAt)}
            </option>
          ))}
        </select>
      </label>
      <span>{appointments.length} linked appointment{appointments.length === 1 ? "" : "s"}</span>
    </div>
  );
}

function AppointmentScheduleAudit({
  detail,
  appointment,
}: {
  detail: CreditexJobAuditDetail;
  appointment: CreditexJobAuditAppointment;
}) {
  const revisions = detail.appointmentAudit.revisions.filter(
    (revision) => revision.appointmentId === appointment.id,
  );
  const requests = detail.appointmentAudit.rescheduleRequests.filter(
    (request) => request.appointmentId === appointment.id,
  );
  const scheduleEvents = detail.appointmentAudit.rescheduleEvents.filter(
    (event) => event.appointmentId === appointment.id,
  );
  const total = revisions.length + requests.length + scheduleEvents.length;

  if (!total) {
    return (
      <SectionCard title="Appointment schedule audit">
        <EmptyState
          title="No schedule audit records returned"
          explanation="The authoritative detail response contains no revision, reschedule request or reschedule event for the selected appointment."
        />
      </SectionCard>
    );
  }

  return (
    <>
      <SectionCard
        title={`Schedule revisions (${revisions.length})`}
        description="Immutable appointment schedule revisions returned for the selected appointment."
      >
        {revisions.length ? (
          <div className={styles.tableScroll}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Revision</th>
                  <th>Starts</th>
                  <th>Ends</th>
                  <th>Assigned to</th>
                  <th>Change source</th>
                  <th>Source reference</th>
                  <th>Changed by UID</th>
                  <th>Recorded</th>
                </tr>
              </thead>
              <tbody>
                {revisions.map((revision) => (
                  <tr key={revision.id}>
                    <td>{revision.revision}</td>
                    <td>{formatDate(revision.startsAt)}</td>
                    <td>{formatDate(revision.endsAt)}</td>
                    <td>{revision.assigneeLabel || "Unassigned"}</td>
                    <td>{readable(revision.changeSource)}</td>
                    <td>{revision.sourceReference || "Not captured"}</td>
                    <td>{revision.changedByUid || "Not captured"}</td>
                    <td>{formatDate(revision.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No schedule revisions returned"
            explanation="The selected appointment has no immutable revision record in this synthetic run."
          />
        )}
      </SectionCard>
      <SectionCard
        title={`Reschedule requests (${requests.length})`}
        description="Customer-linked schedule requests returned for the selected appointment."
      >
        {requests.length ? (
          <div className={styles.tableScroll}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Original start</th>
                  <th>Proposed start</th>
                  <th>Reason</th>
                  <th>Access notes</th>
                  <th>Decision note</th>
                  <th>Decided by UID</th>
                  <th>Requested</th>
                  <th>Decided</th>
                  <th>Revision</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td><StatusBadge value={request.status} /></td>
                    <td>{formatDate(request.originalStartsAt)}</td>
                    <td>{formatDate(request.proposedStartsAt)}</td>
                    <td>{request.reason || "Not captured"}</td>
                    <td>{request.accessNotes || "Not captured"}</td>
                    <td>{request.decisionNote || "Not captured"}</td>
                    <td>{request.decidedByUid || "Not decided"}</td>
                    <td>{formatDate(request.requestedAt)}</td>
                    <td>{formatDate(request.decidedAt)}</td>
                    <td>{request.revision}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No reschedule requests returned"
            explanation="The selected appointment has no customer reschedule request."
          />
        )}
      </SectionCard>
      <PilotEvents events={scheduleEvents} context="appointment" />
    </>
  );
}

function FilesAndPhotos({
  evidenceContracts,
  media,
  detailBusy,
  detailError,
}: {
  evidenceContracts: CreditexJobAuditEvidenceContract[];
  media: CreditexJobAuditDetail["crm"]["media"] | null;
  detailBusy?: boolean;
  detailError?: string;
}) {
  if (!media) {
    return (
      <DetailRequired detailBusy={detailBusy} detailError={detailError} />
    );
  }
  const originalCount = media.filter((item) => item.originalHashPresent).length;
  const metadataCount = media.filter((item) => item.metadataPresent).length;
  return (
    <>
      <section className={styles.captureSummary}>
        <div>
          <span>Captured originals</span>
          <strong>{originalCount}</strong>
        </div>
        <div>
          <span>Metadata present</span>
          <strong>{metadataCount}</strong>
        </div>
        <div>
          <span>Expected requirements</span>
          <strong>{evidenceContracts.length}</strong>
        </div>
        <p>
          {media.length
            ? "Pilot media records are read-only. A hash flag confirms only that a stored SHA-256 value is present, not that government evidence has been accepted."
            : "This synthetic run contains evidence contracts only. It contains no uploaded files, original image bytes, EXIF metadata, GPS coordinates, signatures or government evidence."}
        </p>
      </section>
      <SectionCard
        title="File list"
        description="Owner-scoped pilot media. File bytes and download actions are not exposed by this read-only workspace."
      >
        {media.length ? (
          <div className={styles.tableScroll}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Source</th>
                  <th>Metadata</th>
                  <th>GPS</th>
                  <th>Original hash</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {media.map((item) => (
                  <tr key={item.id}>
                    <td>{item.fileName}</td>
                    <td>{readable(item.category)}</td>
                    <td>{item.contentType}</td>
                    <td>{item.sizeBytes.toLocaleString("en-AU")} bytes</td>
                    <td>{readable(item.source)}</td>
                    <td>{item.metadataPresent ? "Present" : "Absent"}</td>
                    <td>{item.gpsPresent ? "Present" : "Absent"}</td>
                    <td>{item.originalHashPresent ? "Present" : "Absent"}</td>
                    <td>{formatDate(item.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="0 captured files"
            explanation="No owner-scoped job media exists for this synthetic job."
          />
        )}
      </SectionCard>
      <SectionCard
        title="Expected evidence requirements"
        description="Requirements shown here are pilot contracts. Their government status remains visible in each row."
      >
        {evidenceContracts.length ? (
          <div className={styles.tableScroll}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Requirement</th>
                  <th>Kind</th>
                  <th>Timing</th>
                  <th>Count</th>
                  <th>Original</th>
                  <th>Metadata</th>
                  <th>GPS</th>
                  <th>Source status</th>
                  <th>Captured</th>
                </tr>
              </thead>
              <tbody>
                {evidenceContracts.map((contract) => (
                  <tr key={contract.requirementCode}>
                    <td>
                      <strong>{contract.title}</strong>
                      <small>{contract.requirementCode}</small>
                    </td>
                    <td>{readable(contract.evidenceKind)}</td>
                    <td>{readable(contract.captureTiming)}</td>
                    <td>{contract.minimumCount} to {contract.maximumCount}</td>
                    <td>{contract.originalRequired ? "Required" : "Not specified"}</td>
                    <td>{contract.metadataRequired ? "Required" : "Not specified"}</td>
                    <td>{contract.gpsRequired ? "Required" : "Not specified"}</td>
                    <td><StatusBadge value={contract.governmentRequirementStatus} /></td>
                    <td><strong className={styles.zero}>Not mapped to contract</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No evidence contract mapped"
            explanation="No evidence requirement can be inferred for this job. Evidence capture and submission remain blocked."
          />
        )}
      </SectionCard>
      <DisabledAction
        label="Upload evidence"
        reason="Disabled until real field capture preserves original bytes and required metadata."
      />
    </>
  );
}

function AuditWorkflow({
  job,
  role,
  busy,
  options,
  detail,
  detailBusy,
  detailError,
  onSave,
}: Pick<
  CreditexVeuJobAuditWorkspaceProps,
  | "job"
  | "role"
  | "busy"
  | "options"
  | "detail"
  | "detailBusy"
  | "detailError"
  | "onSave"
>) {
  const detailReady = detailMatchesJob(job, detail)
    && !detailBusy
    && !detailError;
  const authoritativeStatuses = detailReady ? detail?.job.statuses : null;
  const authoritativeReviewStatus = authoritativeStatuses?.review;
  const authoritativeEvidenceStatus = authoritativeStatuses?.evidence;
  const authoritativeLookupStatus = authoritativeStatuses?.lookup;
  const [reviewStatus, setReviewStatus] = useState(
    authoritativeReviewStatus || job.reviewStatus,
  );
  const [evidenceStatus, setEvidenceStatus] = useState(
    authoritativeEvidenceStatus || job.evidenceStatus,
  );
  const [lookupStatus, setLookupStatus] = useState(
    authoritativeLookupStatus || job.lookupStatus,
  );

  const writable = ["admin", "case_manager", "reviewer"].includes(role);
  const writeBlocked = !writable || busy || !detailReady;
  const writeReason = !writable
    ? "Your role has read-only access to controlled audit state."
    : !detailReady
      ? detailUnavailableReason({ detailBusy, detailError })
      : busy
        ? "The controlled audit state is currently saving."
        : "";
  return (
    <>
      <SectionCard
        title="Controlled audit state"
        description="These controls update synthetic workflow state only. They cannot create regulated cases or certificates."
      >
        <div className={styles.statusEditor}>
          <label>
            Review
            <select
              value={reviewStatus}
              disabled={writeBlocked}
              onChange={(event) => setReviewStatus(event.target.value)}
            >
              {options.reviewStatuses
                .filter((status) => status !== "test_complete" && status !== "archived")
                .map((status) => (
                  <option key={status} value={status}>{readable(status)}</option>
                ))}
            </select>
          </label>
          <label>
            Evidence transport
            <select
              value={evidenceStatus}
              disabled={writeBlocked}
              onChange={(event) => setEvidenceStatus(event.target.value)}
            >
              {options.evidenceStatuses.map((status) => (
                <option key={status} value={status}>{readable(status)}</option>
              ))}
            </select>
          </label>
          <label>
            Authoritative lookups
            <select
              value={lookupStatus}
              disabled={writeBlocked}
              onChange={(event) => setLookupStatus(event.target.value)}
            >
              {options.lookupStatuses
                .filter((status) => status !== "verified")
                .map((status) => (
                  <option key={status} value={status}>{readable(status)}</option>
                ))}
            </select>
          </label>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={writeBlocked}
            title={writeReason || undefined}
            onClick={() => onSave({ reviewStatus, evidenceStatus, lookupStatus })}
          >
            {busy ? "Saving..." : "Save audited test state"}
          </button>
          {writeReason && (
            <p className={styles.permissionNote}>
              {writeReason}
            </p>
          )}
        </div>
      </SectionCard>
      <SectionCard title="Hard compliance gates">
        <div className={styles.gateGrid}>
          <div><span>Government rule</span><StatusBadge value={authoritativeStatuses?.rule || "detail unavailable"} /></div>
          <div><span>Evidence originals</span><StatusBadge value={authoritativeStatuses?.evidence || "detail unavailable"} /></div>
          <div><span>Authoritative lookup</span><StatusBadge value={authoritativeStatuses?.lookup || "detail unavailable"} /></div>
          <div><span>Certificate calculator</span><StatusBadge value={authoritativeStatuses?.calculator || "detail unavailable"} /></div>
          <div><span>Registry connector</span><StatusBadge value={authoritativeStatuses?.connector || "detail unavailable"} /></div>
        </div>
      </SectionCard>
      <DisabledAction
        label="Force compliant"
        reason="No operator can bypass government rules, required evidence, authoritative lookups or calculator verification."
      />
    </>
  );
}

function PilotEvents({
  events,
  context,
}: {
  events: CreditexJobAuditEvent[];
  context: "job" | "appointment";
}) {
  return (
    <SectionCard
      title={context === "job" ? "Job record events" : "Appointment events"}
      description={
        context === "job"
          ? "Owner-scoped CRM events returned for this job."
          : "Owner-scoped schedule events returned for the selected appointment."
      }
    >
      {events.length ? (
        <ol className={styles.timeline}>
          {events.map((event, index) => (
            <li key={`${event.eventType}-${event.createdAt}-${index}`}>
              <time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time>
              <strong>{readable(event.eventType)}</strong>
              <p>
                {event.summary}
                {event.actorUid && (
                  <small className={styles.eventProvenance}>
                    Actor {readable(event.actorType)} | UID {event.actorUid}
                  </small>
                )}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          title={context === "job" ? "No job events returned" : "No appointment events returned"}
          explanation="The authoritative detail response contains no event at this scope."
        />
      )}
    </SectionCard>
  );
}

function PrintPreview({
  job,
  detail,
  detailBusy,
  detailError,
  onPrint,
}: {
  job: CreditexJobAuditJob;
  detail?: CreditexJobAuditDetail | null;
  detailBusy?: boolean;
  detailError?: string;
  onPrint: () => void;
}) {
  const detailReady = detailMatchesJob(job, detail)
    && !detailBusy
    && !detailError;
  const authoritativeJob = detailReady ? detail?.job : null;
  const media = detailReady ? detail?.crm.media : null;
  const originalCount = media
    ? media.filter((item) => item.originalHashPresent).length
    : null;
  const printBlockedReason = detailReady
    ? ""
    : detailUnavailableReason({ detailBusy, detailError });
  return (
    <div className={styles.printPreview}>
      <div className={styles.printToolbar}>
        <p>
          {detailReady
            ? "Preview uses confirmed owner-scoped synthetic record data."
            : printBlockedReason}
        </p>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!detailReady}
          title={printBlockedReason || undefined}
          onClick={onPrint}
        >
          Print summary
        </button>
      </div>
      <article className={styles.printSheet}>
        <header>
          <p>TLink Creditex compliance</p>
          <h2>Synthetic job audit summary</h2>
          <span>Not a certificate, submission or compliance approval</span>
        </header>
        <FieldGrid>
          <Field label="Job ID">{authoritativeJob?.jobNumber || job.jobNumber}</Field>
          <Field label="Case ID">{authoritativeJob?.caseNumber || job.caseNumber}</Field>
          <Field label="Customer">
            {authoritativeJob ? authoritativeName(authoritativeJob) : "Awaiting authoritative detail"}
          </Field>
          <Field label="Address">
            {authoritativeJob ? authoritativeAddress(authoritativeJob) : "Awaiting authoritative detail"}
          </Field>
          <Field label="Installer">
            {authoritativeJob?.installer.businessName || "Awaiting authoritative detail"}
          </Field>
          <Field label="Technician">
            {authoritativeJob?.technician.displayName || "Awaiting authoritative detail"}
          </Field>
          <Field label="Activity">
            {authoritativeJob
              ? `${authoritativeJob.activity.registryActivityCode} | ${authoritativeJob.activity.title}`
              : "Awaiting authoritative detail"}
          </Field>
          <Field label="Activity date">
            {authoritativeJob
              ? formatDate(authoritativeJob.activity.activityDate)
              : "Awaiting authoritative detail"}
          </Field>
          <Field label="Review">
            {authoritativeJob
              ? readable(authoritativeJob.statuses.review)
              : "Awaiting authoritative detail"}
          </Field>
          <Field label="Evidence">
            {authoritativeJob && originalCount !== null
              ? `${readable(authoritativeJob.statuses.evidence)} | ${originalCount} media records with an original hash flag`
              : "Awaiting authoritative detail"}
          </Field>
          <Field label="Media records">
            {media ? media.length : "Awaiting authoritative detail"}
          </Field>
          <Field label="Rule">
            {authoritativeJob
              ? readable(authoritativeJob.statuses.rule)
              : "Awaiting authoritative detail"}
          </Field>
          <Field label="Lookup">
            {authoritativeJob
              ? readable(authoritativeJob.statuses.lookup)
              : "Awaiting authoritative detail"}
          </Field>
          <Field label="Calculator">
            {authoritativeJob
              ? readable(authoritativeJob.statuses.calculator)
              : "Awaiting authoritative detail"}
          </Field>
          <Field label="Connector">
            {authoritativeJob
              ? readable(authoritativeJob.statuses.connector)
              : "Awaiting authoritative detail"}
          </Field>
          <Field label="Expected evidence contracts">
            {detailReady ? detail?.evidence.contracts.length : "Awaiting authoritative detail"}
          </Field>
          <Field label="Generated from">Synthetic pilot record</Field>
        </FieldGrid>
      </article>
    </div>
  );
}

function SectionContent({
  section,
  job,
  role,
  busy,
  options,
  detail,
  detailBusy,
  detailError,
  selectedAppointment,
  onAppointmentChange,
  onSectionChange,
  onSave,
  onPrint,
}: Omit<
  CreditexVeuJobAuditWorkspaceProps,
  "priorities" | "boundaries" | "onClose"
> & {
  selectedAppointment: CreditexJobAuditAppointment | null;
  onAppointmentChange: (appointmentId: string) => void;
}) {
  const authoritativeDetail =
    detailMatchesJob(job, detail) && !detailBusy && !detailError
      ? detail as CreditexJobAuditDetail
      : null;
  const detailRequired = section !== "customer_create_job"
    && section !== "print_preview"
    && section !== "appointment_audit";

  if (detailRequired && !authoritativeDetail) {
    return (
      <DetailRequired detailBusy={detailBusy} detailError={detailError} />
    );
  }

  switch (section) {
    case "customer_details":
      return <CustomerDetails job={authoritativeDetail!.job} />;
    case "customer_jobs":
      return (
        <CustomerJobs
          detail={authoritativeDetail!}
          onSectionChange={onSectionChange}
        />
      );
    case "customer_files":
      return (
        <>
          <SectionCard title="Customer files">
            <EmptyState
              title="0 customer files captured"
              explanation="This synthetic run does not contain identity documents, customer forms, correspondence or signatures."
            />
          </SectionCard>
          <DisabledAction
            label="Upload customer file"
            reason="Customer file upload is disabled in the synthetic pilot."
          />
        </>
      );
    case "customer_create_job":
      return (
        <SectionCard title="Create customer job">
          <EmptyState
            title="Customer job creation is disabled"
            explanation="The pilot record set is deterministic. Creating customer jobs would break the controlled synthetic boundary."
          />
          <DisabledAction
            label="Create job"
            reason="Return to the installer workflow when authorised job creation is enabled."
          />
        </SectionCard>
      );
    case "job_summary":
      return <JobSummary job={authoritativeDetail!.job} />;
    case "job_appointments":
      return (
        <SectionCard title="Job appointments">
          {authoritativeDetail!.appointments.length ? <div className={styles.tableScroll}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Appointment ID</th>
                  <th>Type</th>
                  <th>Starts</th>
                  <th>Ends</th>
                  <th>Status</th>
                  <th>Assigned to</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {authoritativeDetail!.appointments.map((appointment) => (
                  <tr key={appointment.id}>
                    <td>{appointment.id}</td>
                    <td>{readable(appointment.appointmentType)}</td>
                    <td>{formatDate(appointment.startsAt)}</td>
                    <td>{formatDate(appointment.endsAt)}</td>
                    <td><StatusBadge value={appointment.status} /></td>
                    <td>{appointment.assigneeLabel || authoritativeDetail!.job.work.assigneeLabel}</td>
                    <td>
                      <button
                        type="button"
                        className={styles.textButton}
                        onClick={() => {
                          onAppointmentChange(appointment.id);
                          onSectionChange("appointment_summary");
                        }}
                      >
                        Open appointment
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div> : (
            <EmptyState
              title="No appointments returned"
              explanation="The authoritative owner-scoped job detail contains no appointment."
            />
          )}
        </SectionCard>
      );
    case "job_actions":
      return (
        <SectionCard title="Job actions">
          {authoritativeDetail!.crm.tasks.length ? (
            <div className={styles.tableScroll}>
              <table className={styles.dataTable}>
                <thead><tr><th>Action</th><th>Status</th><th>Due</th><th>Completed</th><th>Revision</th></tr></thead>
                <tbody>
                  {authoritativeDetail!.crm.tasks.map((task) => (
                    <tr key={task.id}>
                      <td>{task.title}</td>
                      <td><StatusBadge value={task.status} /></td>
                      <td>{formatDate(task.dueAt)}</td>
                      <td>{formatDate(task.completedAt)}</td>
                      <td>{task.revision}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No job actions returned"
              explanation="The authoritative detail response contains no task for this job."
            />
          )}
        </SectionCard>
      );
    case "job_questions":
      return (
        <SectionCard title="Job questions">
          {authoritativeDetail!.crm.forms.length ? (
            <div className={styles.tableScroll}>
              <table className={styles.dataTable}>
                <thead><tr><th>Form</th><th>Version</th><th>Jurisdiction</th><th>Status</th><th>Answers</th><th>Completed</th></tr></thead>
                <tbody>
                  {authoritativeDetail!.crm.forms.map((form) => (
                    <tr key={form.id}>
                      <td>{form.templateName}</td>
                      <td>{form.templateVersion}</td>
                      <td>{form.jurisdiction}</td>
                      <td><StatusBadge value={form.status} /></td>
                      <td>{form.answersRecorded ? "Recorded" : "None"}</td>
                      <td>{formatDate(form.completedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No job questionnaire responses returned"
              explanation="The authoritative detail response contains no job form."
            />
          )}
        </SectionCard>
      );
    case "job_quote_invoice":
      return (
        <>
          <SectionCard title="Quote and invoice">
            <FieldGrid>
              <Field label="Estimate">{formatCurrency(authoritativeDetail!.job.crm.estimatedValueCents)}</Field>
              <Field label="Quoted">{formatCurrency(authoritativeDetail!.job.crm.quotedValueCents)}</Field>
              <Field label="Quote status">{readable(authoritativeDetail!.job.crm.quoteStatus)}</Field>
              <Field label="Invoiced">{formatCurrency(authoritativeDetail!.job.crm.invoicedValueCents)}</Field>
              <Field label="Invoice status">{readable(authoritativeDetail!.job.crm.invoiceStatus)}</Field>
              <Field label="Paid">{formatCurrency(authoritativeDetail!.job.crm.paidValueCents)}</Field>
            </FieldGrid>
            {(authoritativeDetail!.crm.quotes.length || authoritativeDetail!.crm.invoices.length) ? (
              <div className={styles.splitTables}>
                <div className={styles.tableScroll}>
                  <table className={styles.dataTable}>
                    <thead><tr><th>Quote</th><th>Status</th><th>Total</th><th>Valid until</th></tr></thead>
                    <tbody>
                      {authoritativeDetail!.crm.quotes.map((quote) => (
                        <tr key={quote.id}>
                          <td>{quote.quoteNumber}</td>
                          <td>{readable(quote.status)}</td>
                          <td>{formatCurrency(quote.totalCents)}</td>
                          <td>{formatDate(quote.validUntil)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={styles.tableScroll}>
                  <table className={styles.dataTable}>
                    <thead><tr><th>Invoice</th><th>Status</th><th>Delivery</th><th>Total</th><th>Due</th></tr></thead>
                    <tbody>
                      {authoritativeDetail!.crm.invoices.map((invoice) => (
                        <tr key={invoice.id}>
                          <td>{invoice.invoiceNumber}</td>
                          <td>{readable(invoice.status)}</td>
                          <td>{readable(invoice.deliveryStatus)}</td>
                          <td>{formatCurrency(invoice.totalCents)}</td>
                          <td>{formatDate(invoice.dueAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </SectionCard>
          <DisabledAction
            label="Issue invoice"
            reason="Financial mutations are disabled in the compliance pilot."
          />
        </>
      );
    case "job_calculations":
      return (
        <SectionCard title="Certificate calculations">
          <FieldGrid>
            <Field label="Calculator status">{readable(authoritativeDetail!.calculator.status)}</Field>
            <Field label="Certificate quantity" unavailable>Not calculated in this synthetic run</Field>
            <Field label="Calculation method" unavailable>Not verified in this synthetic run</Field>
            <Field label="Golden vector result" unavailable>Not reconciled for this job</Field>
            <Field label="Output unit">
              {authoritativeDetail!.calculator.contract?.outputUnit || "Not verified"}
            </Field>
            <Field label="Formula source">
              {authoritativeDetail!.calculator.contract?.sourceKey || "Not verified"}
            </Field>
          </FieldGrid>
          <DisabledAction
            label="Calculate certificates"
            reason="Execution remains blocked until the official method and test vectors are independently verified."
          />
        </SectionCard>
      );
    case "job_transactions":
      return (
        <>
          <SectionCard title="Transactions and payments">
            <EmptyState
              title="0 transactions"
              explanation={
                authoritativeDetail!.capabilities.find(
                  (capability) => capability.key === "job_transactions",
                )?.reason
                || "No authoritative transaction or payment record is linked to this synthetic job."
              }
            />
          </SectionCard>
          <DisabledAction
            label="Create payment"
            reason="Payments, trades and settlements are outside the synthetic pilot boundary."
          />
        </>
      );
    case "job_files":
      return (
        <FilesAndPhotos
          evidenceContracts={authoritativeDetail!.evidence.contracts}
          media={authoritativeDetail!.crm.media}
          detailBusy={detailBusy}
          detailError={detailError}
        />
      );
    case "job_issues":
      return (
        <SectionCard title="Issues">
          <div className={styles.issueList}>
            <div><strong>Government rule verification</strong><StatusBadge value={authoritativeDetail!.job.statuses.rule} /></div>
            <div><strong>Original evidence capture</strong><StatusBadge value={authoritativeDetail!.job.statuses.evidence} /></div>
            <div><strong>Authoritative product and participant lookup</strong><StatusBadge value={authoritativeDetail!.job.statuses.lookup} /></div>
            <div><strong>Certificate calculation</strong><StatusBadge value={authoritativeDetail!.job.statuses.calculator} /></div>
            <div><strong>Registry connector</strong><StatusBadge value={authoritativeDetail!.job.statuses.connector} /></div>
            {authoritativeDetail!.crm.notes
              .filter((note) => note.issueStatus !== "not_applicable")
              .map((note) => (
                <div key={note.id}>
                  <strong>{note.body}</strong>
                  <StatusBadge value={note.issueStatus} />
                </div>
              ))}
          </div>
        </SectionCard>
      );
    case "job_emails":
      return (
        <>
          <SectionCard title="Emails">
            <EmptyState
              title="0 emails"
              explanation={
                authoritativeDetail!.capabilities.find(
                  (capability) => capability.key === "job_emails",
                )?.reason
                || "No authoritative email domain is linked to this synthetic job."
              }
            />
          </SectionCard>
          <DisabledAction
            label="Send email"
            reason="Outbound communication is disabled in the synthetic pilot."
          />
        </>
      );
    case "job_history":
      return (
        <PilotEvents
          events={authoritativeDetail!.crm.events}
          context="job"
        />
      );
    case "appointment_summary":
      return selectedAppointment ? (
        <AppointmentSummary
          job={authoritativeDetail!.job}
          appointment={selectedAppointment}
        />
      ) : (
        <SectionCard title="Appointment summary">
          <EmptyState
            title="No appointment returned"
            explanation="The authoritative owner-scoped job detail contains no appointment."
          />
        </SectionCard>
      );
    case "appointment_actions":
      return selectedAppointment ? (
        <AppointmentScheduleAudit
          detail={authoritativeDetail!}
          appointment={selectedAppointment}
        />
      ) : (
        <SectionCard title="Appointment actions">
          <EmptyState
            title="No appointment returned"
            explanation="No schedule action can be resolved without an authoritative linked appointment."
          />
        </SectionCard>
      );
    case "appointment_questions":
      return (
        <SectionCard title="Appointment questions">
          <EmptyState
            title="No appointment-specific question domain"
            explanation={
              authoritativeDetail!.capabilities.find(
                (capability) => capability.key === "appointment_questions",
              )?.reason
              || "No authoritative appointment-specific question domain is stored."
            }
          />
        </SectionCard>
      );
    case "appointment_certificate_submissions":
      return (
        <>
          <SectionCard title="Certificate submissions">
            <EmptyState
              title="0 certificate submissions"
              explanation={
                selectedAppointment
                  ? `No certificate lot, registry submission or external reference exists for appointment ${selectedAppointment.id}.`
                  : "No authoritative linked appointment was returned."
              }
            />
          </SectionCard>
          <DisabledAction
            label="Submit certificates"
            reason="External submission is fail-closed until every government rule, evidence, lookup and calculator gate passes."
          />
          {authoritativeDetail!.submission.connectors.length ? (
            <SectionCard title="Dry-run connector reconciliation">
              <div className={styles.tableScroll}>
                <table className={styles.dataTable}>
                  <thead><tr><th>Connector</th><th>Mode</th><th>Status</th><th>Items</th><th>Accepted</th><th>Rejected</th><th>Unmatched</th><th>External send</th></tr></thead>
                  <tbody>
                    {authoritativeDetail!.submission.connectors.map((connector) => (
                      <tr key={`${connector.connectorCode}:${connector.mappingVersion}`}>
                        <td>{connector.connectorCode}</td>
                        <td>{readable(connector.mode)}</td>
                        <td>{readable(connector.status)}</td>
                        <td>{connector.itemCount}</td>
                        <td>{connector.acceptedCount}</td>
                        <td>{connector.rejectedCount}</td>
                        <td>{connector.unmatchedCount}</td>
                        <td>{connector.externalSubmissionEnabled ? "Enabled" : "Blocked"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          ) : null}
          <DisabledAction
            label="Force submit"
            reason="Force submission is never available."
          />
        </>
      );
    case "appointment_decommissioning":
      return (
        <SectionCard title="Decommissioning summary">
          <FieldGrid>
            <Field label="Existing equipment type" unavailable>Not captured in this synthetic run</Field>
            <Field label="Serial number" unavailable>Not captured in this synthetic run</Field>
            <Field label="Decommissioning method" unavailable>Not captured in this synthetic run</Field>
            <Field label="Disposal evidence" unavailable>Not mapped to this appointment</Field>
            <Field label="Technician declaration" unavailable>Not captured in this synthetic run</Field>
          </FieldGrid>
        </SectionCard>
      );
    case "appointment_correspondence":
      return (
        <>
          <SectionCard title="Correspondence">
            <EmptyState
              title="No appointment correspondence domain"
              explanation={
                authoritativeDetail!.capabilities.find(
                  (capability) => capability.key === "appointment_correspondence",
                )?.reason
                || "No authoritative appointment-correspondence domain is stored."
              }
            />
          </SectionCard>
          <DisabledAction
            label="Send correspondence"
            reason="Outbound communication is disabled in the synthetic pilot."
          />
        </>
      );
    case "appointment_audit":
      return (
        <>
          <AuditWorkflow
            key={[
              authoritativeDetail?.job.id || "unloaded",
              authoritativeDetail?.job.statuses.review || job.reviewStatus,
              authoritativeDetail?.job.statuses.evidence || job.evidenceStatus,
              authoritativeDetail?.job.statuses.lookup || job.lookupStatus,
            ].join(":")}
            job={job}
            role={role}
            busy={busy}
            options={options}
            detail={authoritativeDetail}
            detailBusy={detailBusy}
            detailError={detailError}
            onSave={onSave}
          />
          {authoritativeDetail && selectedAppointment && (
            <AppointmentScheduleAudit
              detail={authoritativeDetail}
              appointment={selectedAppointment}
            />
          )}
        </>
      );
    case "appointment_history":
      return selectedAppointment ? (
        <AppointmentScheduleAudit
          detail={authoritativeDetail!}
          appointment={selectedAppointment}
        />
      ) : (
        <SectionCard title="Appointment history">
          <EmptyState
            title="No appointment returned"
            explanation="No authoritative appointment history can be resolved for this job."
          />
        </SectionCard>
      );
    case "print_preview":
      return (
        <PrintPreview
          job={job}
          detail={detail}
          detailBusy={detailBusy}
          detailError={detailError}
          onPrint={onPrint}
        />
      );
  }
}

function ComplianceRail({
  job,
  priorities,
  detail,
}: {
  job: CreditexJobAuditJob;
  priorities: CreditexJobAuditPriority[];
  detail?: CreditexJobAuditDetail | null;
}) {
  const statuses = detail?.job.statuses;
  const gates = [
    ["Rule", statuses?.rule || job.ruleStatus],
    ["Evidence", statuses?.evidence || job.evidenceStatus],
    ["Lookup", statuses?.lookup || job.lookupStatus],
    ["Calculator", statuses?.calculator || job.calculatorStatus],
    ["Connector", statuses?.connector || job.connectorStatus],
  ];
  return (
    <>
      <section className={styles.railSection}>
        <h2>Compliance status</h2>
        <div className={styles.railGates}>
          {gates.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <StatusBadge value={value} />
            </div>
          ))}
        </div>
      </section>
      <section className={styles.railSection}>
        <h2>Program controls</h2>
        <ol className={styles.priorityList}>
          {priorities.map((priority) => (
            <li key={priority.key}>
              <span>{priority.number}</span>
              <div>
                <strong>{priority.title}</strong>
                <small>{readable(priority.status)}</small>
              </div>
            </li>
          ))}
        </ol>
      </section>
      {detail && (
        <section className={styles.railSection}>
          <h2>Record capability map</h2>
          <div className={styles.capabilityList}>
            {detail.capabilities
              .filter((capability) =>
                ["customer", "job", "appointment"].includes(capability.group))
              .map((capability) => (
                <details key={capability.key}>
                  <summary>
                    <span>{capability.label}</span>
                    <b data-available={capability.available}>
                      {capability.count}
                    </b>
                  </summary>
                  <p>{capability.reason}</p>
                </details>
              ))}
          </div>
        </section>
      )}
      {detail?.rules.sources.length ? (
        <section className={styles.railSection}>
          <h2>Official source set</h2>
          <div className={styles.sourceList}>
            {detail.rules.sources.map((source) => (
              <a
                key={source.sourceKey}
                href={source.officialSourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                <strong>{source.title}</strong>
                <span>
                  {source.officialVersion || "Live source"} |{" "}
                  {readable(source.verificationStatus)}
                </span>
              </a>
            ))}
          </div>
        </section>
      ) : null}
      <section className={styles.railSection}>
        <h2>Job-level regulated records</h2>
        {detail ? (
          <dl className={styles.boundaryList}>
            <div>
              <dt>Regulated cases created for this job</dt>
              <dd>{detail.boundaries.regulatedCasesCreated}</dd>
            </div>
            <div>
              <dt>Compliance evidence created for this job</dt>
              <dd>{detail.boundaries.complianceEvidenceCreated}</dd>
            </div>
            <div>
              <dt>Submission items created for this job</dt>
              <dd>{detail.boundaries.submissionItemsCreated}</dd>
            </div>
            <div>
              <dt>External submission for this job</dt>
              <dd>
                {detail.boundaries.externalSubmissionEnabled
                  ? "Enabled"
                  : "Blocked"}
              </dd>
            </div>
          </dl>
        ) : (
          <p className={styles.boundaryPending}>
            Awaiting authoritative job detail. No run-level count is shown here.
          </p>
        )}
      </section>
      <div className={styles.railActions}>
        <DisabledAction
          label="Submit externally"
          reason="Blocked by the controlled pilot boundary."
        />
        <DisabledAction
          label="Force compliant"
          reason="Government compliance gates cannot be bypassed."
        />
      </div>
    </>
  );
}

export function CreditexVeuJobAuditWorkspace({
  job,
  section,
  role,
  busy,
  options,
  priorities,
  detail,
  detailBusy = false,
  detailError = "",
  onSectionChange,
  onClose,
  onSave,
  onPrint,
}: CreditexVeuJobAuditWorkspaceProps) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState(
    job.appointment.id,
  );
  const authoritativeDetail =
    detailMatchesJob(job, detail) && !detailBusy && !detailError
      ? detail as CreditexJobAuditDetail
      : null;
  const selectedAppointment = authoritativeDetail?.appointments.find(
    (appointment) => appointment.id === selectedAppointmentId,
  ) || authoritativeDetail?.appointments.find(
    (appointment) => appointment.id === job.appointment.id,
  ) || authoritativeDetail?.appointments[0] || null;
  const appointmentSection = section.startsWith("appointment_");

  const activeGroup = useMemo(
    () => NAVIGATION.find((group) =>
      group.items.some((item) => item.section === section)),
    [section],
  );

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    headingRef.current?.focus();

    const media = window.matchMedia("(max-width: 860px)");
    let mobileTimer = 0;
    if (media.matches) {
      mobileTimer = window.setTimeout(() => {
        setLeftOpen(false);
        setRightOpen(false);
      }, 0);
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          workspaceRef.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
          ) || [],
        ).filter((element) => element.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (mobileTimer) window.clearTimeout(mobileTimer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={workspaceRef}
      className={styles.workspace}
      role="dialog"
      aria-modal="true"
      aria-labelledby="creditex-job-workspace-heading"
    >
      <header className={styles.topbar}>
        <div className={styles.identity}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={leftOpen ? "Collapse record navigation" : "Open record navigation"}
            aria-expanded={leftOpen}
            onClick={() => setLeftOpen((open) => !open)}
          >
            {leftOpen ? "<" : "Menu"}
          </button>
          <div className={styles.titleBlock}>
            <div className={styles.breadcrumb}>
              <span>
                {authoritativeDetail
                  ? authoritativeName(authoritativeDetail.job)
                  : fullName(job)}
              </span>
              <span>{authoritativeDetail?.job.jobNumber || job.jobNumber}</span>
              <span>{selectedAppointment?.id || job.appointment.id}</span>
            </div>
            <h1
              id="creditex-job-workspace-heading"
              ref={headingRef}
              tabIndex={-1}
            >
              {SECTION_LABELS[section]}
            </h1>
          </div>
        </div>
        <div className={styles.topStatus}>
          <span className={styles.syntheticBadge}>Synthetic test only</span>
          <span>
            {authoritativeDetail?.job.activity.registryActivityCode
              || job.registryActivityCode}
          </span>
          <StatusBadge
            value={authoritativeDetail?.job.statuses.review || job.reviewStatus}
          />
        </div>
        <div className={styles.topActions}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={rightOpen ? "Collapse compliance status" : "Open compliance status"}
            aria-expanded={rightOpen}
            onClick={() => setRightOpen((open) => !open)}
          >
            {rightOpen ? ">" : "Checks"}
          </button>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            Close
          </button>
        </div>
      </header>

      <div
        className={styles.shell}
        data-left-open={leftOpen}
        data-right-open={rightOpen}
      >
        {leftOpen && <aside className={styles.leftRail} aria-label="Job record navigation">
          <div className={styles.navIdentity}>
            <strong>{job.jobNumber}</strong>
            <span>{job.caseNumber}</span>
          </div>
          <nav>
            {NAVIGATION.map((group) => (
              <section key={group.label} className={styles.navGroup}>
                <h2>{group.label}</h2>
                {group.items.map((item) => (
                  <button
                    key={item.section}
                    type="button"
                    aria-current={section === item.section ? "page" : undefined}
                    onClick={() => {
                      onSectionChange(item.section);
                      if (window.matchMedia("(max-width: 860px)").matches) {
                        setLeftOpen(false);
                      }
                    }}
                  >
                    <span>{item.label}</span>
                    <span aria-hidden="true">&gt;</span>
                  </button>
                ))}
              </section>
            ))}
          </nav>
        </aside>}

        <main className={styles.main}>
          <div className={styles.mobileContext}>
            <span>{activeGroup?.label}</span>
            <strong>{SECTION_LABELS[section]}</strong>
          </div>
          <div className={styles.content}>
            {detailBusy && (
              <p className={styles.detailNotice} role="status">
                Loading the complete owner-scoped job record...
              </p>
            )}
            {detailError && (
              <p className={styles.detailError} role="alert">
                {detailError}
              </p>
            )}
            {appointmentSection && authoritativeDetail && (
              <AppointmentSelector
                appointments={authoritativeDetail.appointments}
                selectedAppointmentId={selectedAppointment?.id || ""}
                onChange={setSelectedAppointmentId}
              />
            )}
            <SectionContent
              section={section}
              job={job}
              role={role}
              busy={busy}
              options={options}
              detail={detail}
              detailBusy={detailBusy}
              detailError={detailError}
              selectedAppointment={selectedAppointment}
              onAppointmentChange={setSelectedAppointmentId}
              onSectionChange={onSectionChange}
              onSave={onSave}
              onPrint={onPrint}
            />
          </div>
        </main>

        {rightOpen && <aside className={styles.rightRail} aria-label="Compliance status">
          <ComplianceRail
            job={job}
            priorities={priorities}
            detail={authoritativeDetail}
          />
        </aside>}

        {(leftOpen || rightOpen) && (
          <button
            type="button"
            className={styles.mobileScrim}
            aria-label="Close open side panel"
            onClick={() => {
              setLeftOpen(false);
              setRightOpen(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
