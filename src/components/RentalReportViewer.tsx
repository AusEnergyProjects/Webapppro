"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./RentalReportViewer.module.css";

type Evidence = {
  id: string;
  itemId: string;
  findingId: string;
  fileName: string;
  contentType: string;
  caption: string;
  purpose: string;
  sizeBytes: number;
  viewUrl: string;
  capture: null | {
    source: string;
    capturedAtUtc: string;
    locationCaptured: boolean;
    locationObservedAtUtc: string;
    latitude: number | null;
    longitude: number | null;
    accuracyMetres: number | null;
  };
};

type Finding = {
  id: string;
  itemId: string;
  category: string;
  title: string;
  description: string;
  standardReference: string;
  status: string;
  severity: string;
  tradeCategory: string;
  locationLabel: string;
  recommendedAction: string;
  scopeSummary: string;
  quantityMilli: number;
  unitLabel: string;
  details: Record<string, unknown>;
};

type ReportItem = {
  id: string;
  locationLabel: string;
  prompt: string;
  outcome: string;
  response: Record<string, unknown>;
  publicNotes: string;
};

type ReportModule = {
  id: string;
  key: string;
  title: string;
  required: boolean;
  reportBoundary: string;
  answers: Record<string, unknown>;
  credential: {
    gate?: string;
    assessorName?: string;
    credentialType?: string;
    credentialName?: string;
    credentialNumber?: string;
    issuer?: string;
    jurisdiction?: string;
    expiresAt?: string;
    supportingFileTitle?: string;
    supportingFileSha256?: string;
    verificationBasis?: string;
    confirmedAt?: string;
  };
  completedAt: string;
  sections: Array<{ key: string; title: string; summary: string; items: ReportItem[] }>;
};

type RentalReport = {
  report: { number: string; revision: number; issuedAt: string };
  business: { name: string; abn: string; contactName: string; email: string; phone: string; address: string };
  property: { address: string; customerName: string; customerEmail: string; customerPhone: string; buildingType: string };
  inspection: { number: string; rulesEffectiveFrom: string; assessmentDate: string; templateVersion: number };
  issuer: { name: string; role: string; email: string; phone: string; qualificationType: string; qualificationNumber: string; declaration: string };
  modules: ReportModule[];
  findings: Finding[];
  evidence: Evidence[];
  sources: Array<{ title: string; version: string; effectiveFrom: string; url: string }>;
  access: { expiresAt: string; pdfUrl: string };
};

type Result = { ok?: boolean; report?: RentalReport; error?: string };

const outcomeLabels: Record<string, string> = {
  meets: "Meets",
  does_not_meet: "Does not meet",
  specialist_verification_required: "Specialist verification required",
  not_accessible: "Not accessible",
  not_applicable: "Not applicable",
  exemption_evidence_pending: "Exemption evidence pending",
};

const severityLabels: Record<string, string> = {
  immediate_safety_risk: "Immediate safety risk",
  urgent: "Urgent",
  required: "Required work",
  recommended: "Recommended",
  information: "Information",
};

function displayLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateLabel(value: string, includeTime = false) {
  if (!value) return "Not recorded";
  const dateOnly = value.length === 10;
  const date = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en-AU", includeTime
      ? { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Melbourne" }
      : { dateStyle: "medium", timeZone: dateOnly ? "UTC" : "Australia/Melbourne" })
    : value;
}

function bytesLabel(value: number) {
  return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`;
}

function visibleEntries(value: Record<string, unknown>) {
  return Object.entries(value || {}).filter(([, entry]) => entry !== "" && entry !== null && entry !== undefined);
}

function ResultPill({ outcome }: { outcome: string }) {
  const tone = outcome === "meets" || outcome === "not_applicable" ? styles.good
    : outcome === "does_not_meet" ? styles.bad : styles.caution;
  return <span className={`${styles.resultPill} ${tone}`}>{outcomeLabels[outcome] || displayLabel(outcome)}</span>;
}

function EvidenceGallery({ entries }: { entries: Evidence[] }) {
  if (!entries.length) return null;
  return <div className={styles.gallery}>
    {entries.map((entry) => <a href={entry.viewUrl} target="_blank" rel="noreferrer" key={entry.id}>
      {entry.contentType.startsWith("image/")
        ? <img src={entry.viewUrl} alt={entry.caption || entry.purpose || entry.fileName} loading="lazy" />
        : <div className={styles.documentIcon}>PDF</div>}
      <span>
        <strong>{entry.caption || entry.purpose || entry.fileName}</strong>
        {entry.purpose && entry.purpose !== entry.caption && <small>Purpose: {entry.purpose}</small>}
        <small>{entry.fileName} | {bytesLabel(entry.sizeBytes)}</small>
        {entry.capture && <small>
          {entry.capture.source === "in_app_camera" ? "Captured" : "Added"} {dateLabel(entry.capture.capturedAtUtc, true)}
          {entry.capture.locationCaptured && entry.capture.latitude !== null && entry.capture.longitude !== null && entry.capture.accuracyMetres !== null
            ? ` | device-reported GPS ${entry.capture.latitude.toFixed(6)}, ${entry.capture.longitude.toFixed(6)} | accuracy ${Math.round(entry.capture.accuracyMetres)} m`
            : ""}
        </small>}
      </span>
    </a>)}
  </div>;
}

export function RentalReportViewer({ token }: { token: string }) {
  const [data, setData] = useState<Result>({});
  const [loading, setLoading] = useState(true);
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    let active = true;
    void fetch(`/api/rental-report/${encodeURIComponent(token)}`, { cache: "no-store", referrerPolicy: "no-referrer" })
      .then(async (response) => {
        const result = await response.json().catch(() => ({})) as Result;
        if (!response.ok || !result.ok) throw new Error(result.error || "This report could not be opened.");
        if (active) setData(result);
      })
      .catch((error) => active && setData({ error: error instanceof Error ? error.message : "This report could not be opened." }))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [token]);

  const report = data.report;
  const openFindings = useMemo(() => (report?.findings || []).filter((finding) => finding.status !== "compliant"), [report]);
  const resolvedFindings = useMemo(() => (report?.findings || []).filter((finding) => finding.status === "compliant"), [report]);
  const groupedFindings = useMemo(() => Object.entries(openFindings.reduce<Record<string, Finding[]>>((groups, finding) => {
    const trade = finding.tradeCategory || "Assessor follow-up";
    (groups[trade] ||= []).push(finding);
    return groups;
  }, {})), [openFindings]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyStatus("Link copied");
    } catch {
      setCopyStatus("Use the browser address bar to copy this link");
    }
  }

  if (loading) return <main className={styles.state}><strong>Opening the issued report...</strong><span>Checking the secure 60-day link.</span></main>;
  if (!report) return <main className={styles.state}><strong>Report unavailable</strong><span>{data.error || "This report could not be found."}</span></main>;

  return <main className={styles.page}>
    <header className={styles.topbar}>
      <Link href="/" aria-label="TLink home"><span>TLink</span><strong>Rental report</strong></Link>
      <div><button type="button" onClick={() => void copyLink()}>Copy report link</button><a className={styles.downloadButton} href={report.access.pdfUrl}>Download full PDF</a></div>
    </header>

    <section className={styles.hero}>
      <div>
        <span>Issued Victorian rental assessment</span>
        <h1>{report.property.address}</h1>
        <p>{report.report.number} | revision {report.report.revision}</p>
      </div>
      <aside>
        <span>Issued by</span>
        <strong>{report.issuer.name}</strong>
        <small>{report.business.name}</small>
      </aside>
      <dl>
        <div><dt>Assessment date</dt><dd>{dateLabel(report.inspection.assessmentDate)}</dd></div>
        <div><dt>Issued</dt><dd>{dateLabel(report.report.issuedAt, true)}</dd></div>
        <div><dt>Rule version</dt><dd>Effective {dateLabel(report.inspection.rulesEffectiveFrom)}</dd></div>
        <div><dt>Link available until</dt><dd>{dateLabel(report.access.expiresAt, true)}</dd></div>
      </dl>
    </section>

    <aside className={styles.linkNotice}>
      <div><strong>No account is required</strong><span>Anyone with this link can view the report until it expires. Forward it only to people who need the property assessment.</span></div>
      {copyStatus && <small role="status">{copyStatus}</small>}
    </aside>

    <nav className={styles.jumpNav} aria-label="Report sections">
      <a href="#findings">Findings</a><a href="#assessment">Full assessment</a><a href="#evidence">Evidence</a><a href="#issuer">Issuer</a>
    </nav>

    <section className={styles.summaryCards}>
      <article><span>Selected modules</span><strong>{report.modules.length}</strong><small>{report.modules.map((module) => module.title).join(" | ")}</small></article>
      <article><span>Outstanding findings</span><strong>{openFindings.length}</strong><small>{groupedFindings.length} responsible trade group{groupedFindings.length === 1 ? "" : "s"}</small></article>
      <article><span>Evidence files</span><strong>{report.evidence.length}</strong><small>Photos and documents linked to exact checks</small></article>
    </section>

    <section className={styles.contentSection} id="findings">
      <header><span>Quote-ready register</span><h2>Findings and work scopes</h2><p>Grouped by responsible trade so repairs can be scoped and quoted without searching through the entire report.</p></header>
      {!openFindings.length ? <div className={styles.empty}><strong>No outstanding findings recorded</strong><span>Review the full assessment for every observed result, limitation and evidence file.</span></div>
        : groupedFindings.map(([trade, findings]) => <section className={styles.tradeGroup} key={trade}>
          <header><h3>{trade}</h3><strong>{findings.length} item{findings.length === 1 ? "" : "s"}</strong></header>
          {findings.map((finding, index) => <article className={styles.finding} key={finding.id}>
            <div className={styles.findingHeading}><span>{String(index + 1).padStart(2, "0")}</span><div><small>{severityLabels[finding.severity] || displayLabel(finding.severity)} | {finding.locationLabel || "Location in assessment"}</small><h4>{finding.title}</h4></div></div>
            <dl>
              <div><dt>Status</dt><dd>{displayLabel(finding.status)}</dd></div>
              <div><dt>Category</dt><dd>{displayLabel(finding.category)}</dd></div>
              <div><dt>Responsible trade</dt><dd>{finding.tradeCategory || "Assessor follow-up"}</dd></div>
              <div><dt>Finding</dt><dd>{finding.description}</dd></div>
              {finding.recommendedAction && <div><dt>Recommended action</dt><dd>{finding.recommendedAction}</dd></div>}
              <div className={styles.scopeRow}><dt>Quote-ready scope</dt><dd>{finding.scopeSummary}</dd></div>
              <div><dt>Quantity</dt><dd>{finding.quantityMilli / 1000} {finding.unitLabel}</dd></div>
              {finding.standardReference && <div><dt>Reference</dt><dd>{finding.standardReference}</dd></div>}
              {finding.severity === "immediate_safety_risk" && <>
                <div className={styles.dangerRow}><dt>Immediate action</dt><dd>{String(finding.details.immediateAction || "Not recorded")}</dd></div>
                <div className={styles.dangerRow}><dt>Responsible people notified</dt><dd>{finding.details.responsiblePeopleNotified === true ? "Yes" : "No"}</dd></div>
                <div className={styles.dangerRow}><dt>Notification</dt><dd>{[finding.details.notificationRecipient, finding.details.notificationTime].filter(Boolean).map(String).join(" | ") || "Not recorded"}</dd></div>
              </>}
            </dl>
            <EvidenceGallery entries={report.evidence.filter((entry) => entry.findingId === finding.id || entry.itemId === finding.itemId)} />
          </article>)}
        </section>)}
      {resolvedFindings.length > 0 && <section className={styles.tradeGroup}>
        <header><h3>Resolved finding history</h3><strong>{resolvedFindings.length} item{resolvedFindings.length === 1 ? "" : "s"}</strong></header>
        {resolvedFindings.map((finding, index) => <article className={styles.finding} key={finding.id}>
          <div className={styles.findingHeading}><span>{String(index + 1).padStart(2, "0")}</span><div><small>Resolved | {finding.locationLabel || "Location in assessment"}</small><h4>{finding.title}</h4></div></div>
          <dl>
            <div><dt>Category</dt><dd>{displayLabel(finding.category)}</dd></div>
            <div><dt>History</dt><dd>{finding.description}</dd></div>
            {finding.standardReference && <div><dt>Reference</dt><dd>{finding.standardReference}</dd></div>}
          </dl>
          <EvidenceGallery entries={report.evidence.filter((entry) => entry.findingId === finding.id || entry.itemId === finding.itemId)} />
        </article>)}
      </section>}
    </section>

    <section className={styles.contentSection} id="assessment">
      <header><span>Complete issued record</span><h2>Assessment modules</h2><p>The minimum-standards module is included by default. Separate safety-check modules appear only when selected for this job.</p></header>
      {report.modules.map((module, moduleIndex) => <details className={styles.module} open={moduleIndex === 0} key={module.id}>
        <summary><div><span>{module.required ? "Included" : "Optional"}</span><strong>{module.title}</strong><small>{module.reportBoundary}</small></div><em>Completed {dateLabel(module.completedAt)}</em></summary>
        <div className={styles.moduleBody}>
          <dl className={styles.metadata}>
            <div><dt>Assessor</dt><dd>{module.credential.assessorName || report.issuer.name}</dd></div>
            <div><dt>Credential</dt><dd>{[module.credential.credentialName || module.credential.credentialType, module.credential.credentialNumber].filter(Boolean).join(" | ") || "Assessor declaration recorded"}</dd></div>
            {module.credential.issuer && <div><dt>Issuer / jurisdiction</dt><dd>{[module.credential.issuer, module.credential.jurisdiction].filter(Boolean).join(" | ")}</dd></div>}
            {module.credential.expiresAt && <div><dt>Credential valid until</dt><dd>{dateLabel(module.credential.expiresAt)}</dd></div>}
            <div><dt>Verification</dt><dd>{module.credential.verificationBasis === "manager_attested_document" ? "Manager-attested credential document" : "Assessor declaration"}</dd></div>
            {module.credential.supportingFileTitle && <div><dt>Supporting record</dt><dd>{module.credential.supportingFileTitle}</dd></div>}
          </dl>
          <dl className={styles.metadata}>{visibleEntries(module.answers).map(([key, value]) => <div key={key}><dt>{displayLabel(key)}</dt><dd>{typeof value === "boolean" ? value ? "Yes" : "No" : String(value)}</dd></div>)}</dl>
          {module.sections.map((section) => <section className={styles.assessmentSection} key={section.key}>
            <header><h3>{section.title}</h3><p>{section.summary}</p></header>
            <div>{section.items.map((item) => <article className={styles.answer} key={item.id}>
              <div><ResultPill outcome={item.outcome} />{item.locationLabel && <strong>{item.locationLabel}</strong>}</div>
              <h4>{item.prompt}</h4>
              {item.publicNotes && <p>{item.publicNotes}</p>}
              {visibleEntries(item.response).length > 0 && <dl>{visibleEntries(item.response).map(([key, value]) => <div key={key}><dt>{displayLabel(key)}</dt><dd>{typeof value === "boolean" ? value ? "Yes" : "No" : String(value)}</dd></div>)}</dl>}
              <EvidenceGallery entries={report.evidence.filter((entry) => entry.itemId === item.id)} />
            </article>)}</div>
          </section>)}
        </div>
      </details>)}
    </section>

    <section className={styles.contentSection} id="evidence">
      <header><span>Evidence register</span><h2>All report photos and documents</h2><p>Every file remains linked to the exact assessment answer that it supports.</p></header>
      <EvidenceGallery entries={report.evidence} />
    </section>

    <section className={styles.issuerGrid} id="issuer">
      <article><span>Property and requester</span><h2>{report.property.customerName || "Property contact"}</h2><dl><div><dt>Property</dt><dd>{report.property.address}</dd></div><div><dt>Building type</dt><dd>{report.property.buildingType || "Not recorded"}</dd></div><div><dt>Contact</dt><dd>{[report.property.customerEmail, report.property.customerPhone].filter(Boolean).join(" | ") || "Not recorded"}</dd></div></dl></article>
      <article><span>Assessor and issuer</span><h2>{report.issuer.name}</h2><dl><div><dt>Role</dt><dd>{displayLabel(report.issuer.role)}</dd></div><div><dt>Qualification</dt><dd>{report.issuer.qualificationType}</dd></div><div><dt>Qualification number</dt><dd>{report.issuer.qualificationNumber}</dd></div><div><dt>Contact</dt><dd>{[report.issuer.email, report.issuer.phone].filter(Boolean).join(" | ")}</dd></div></dl><p>{report.issuer.declaration}</p></article>
      <article><span>Issuing business</span><h2>{report.business.name}</h2><dl><div><dt>ABN</dt><dd>{report.business.abn}</dd></div><div><dt>Contact name</dt><dd>{report.business.contactName || "Not recorded"}</dd></div><div><dt>Contact</dt><dd>{[report.business.email, report.business.phone].filter(Boolean).join(" | ")}</dd></div><div><dt>Address</dt><dd>{report.business.address}</dd></div></dl></article>
    </section>

    <section className={styles.sources}>
      <span>Sources preserved with the issued form version</span>
      {report.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={`${source.title}:${source.version}`}><strong>{source.title}</strong><small>{source.version ? `Version ${source.version}` : "Official source"}{source.effectiveFrom ? ` | effective ${dateLabel(source.effectiveFrom)}` : ""}</small></a>)}
    </section>

    <footer><div><strong>{report.report.number}</strong><span>Issued {dateLabel(report.report.issuedAt, true)}</span></div><a className={styles.downloadButton} href={report.access.pdfUrl}>Download full PDF</a></footer>
  </main>;
}
