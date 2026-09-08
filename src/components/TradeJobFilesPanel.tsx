"use client";

/* eslint-disable @next/next/no-img-element */

import type { User } from "firebase/auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CreditexAssignedActivityWorkPackProjection,
} from "@/lib/creditex-activity-work-pack-server";

type SignaturePoint = { x: number; y: number };
type SignatureStroke = { points: readonly SignaturePoint[] };

type JobFile = {
  id: string;
  group: string;
  title: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  recordedAt: string;
  detail: string;
  path?: string;
  inlineText?: string;
  signature?: { signerName: string; strokes: readonly SignatureStroke[] };
};

type FieldWorkResult = {
  media?: Array<{
    id: string;
    category: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    caption: string;
    source: string;
    createdAt: string;
  }>;
  signoffs?: Array<{
    id: string;
    signerRole: string;
    signerName: string;
    confirmationText: string;
    method: string;
    signedAt: string;
  }>;
  error?: string;
};

type ActivitySummary = {
  id: string;
  intentId: string;
  title: string;
  programCode: string;
  status: string;
  recordNumber: string;
};

type ActivityRecord = {
  id: string;
  recordNumber: string;
  programCode?: string;
  status: string;
  submittedAt: string;
  reportUrl: string;
  form: {
    title: string;
    programCode: string;
    fields: Array<{ key: string; label: string }>;
    declarations: Array<{ key: string; title: string }>;
  };
  evidence: Array<{
    id: string;
    fieldKey: string;
    fileName: string;
    contentType: string;
    size: number;
    capturedAt: string;
    uploadedAt: string;
    latitude: number | null;
    longitude: number | null;
  }>;
  signatures: Array<{
    id: string;
    declarationKey: string;
    signerName: string;
    role: string;
    signedAt: string;
    strokes: readonly SignatureStroke[];
  }>;
};

type RentalResult = {
  reports?: Array<{
    id: string;
    reportNumber: string;
    revision: number;
    status: string;
    issuedAt: string;
    pdfSizeBytes: number;
    internalPdfUrl: string;
  }>;
  error?: string;
};

type HandoverResult = {
  pack?: null | {
    documents: Array<{
      id: string;
      category: string;
      fileName: string;
      contentType: string;
      sizeBytes: number;
      createdAt: string;
    }>;
  };
  error?: string;
};

type QuoteResult = {
  quote?: null | {
    id: string;
    quoteNumber: string;
    currentVersionNumber: number;
    link: null | { pdfUrl: string };
    versions: Array<{ versionNumber: number; status: string; issuedAt: string }>;
  };
  error?: string;
};

type InvoiceResult = {
  invoice?: null | {
    id: string;
    invoiceNumber: string;
    revision: number;
    status: string;
    canDownloadPdf: boolean;
    updatedAt: string;
  };
  error?: string;
};

type Preview = { item: JobFile; url: string; text: string };

function dateTime(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Date unavailable";
  return new Date(value).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

function sizeLabel(bytes: number) {
  if (!bytes) return "Size unavailable";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "file";
}

function signatureSvg(strokes: readonly SignatureStroke[]) {
  const polylines = strokes.map((stroke) => {
    const points = stroke.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      .map((point) => `${Math.max(0, Math.min(1, point.x)) * 1000},${Math.max(0, Math.min(1, point.y)) * 360}`)
      .join(" ");
    return points ? `<polyline points="${points}"/>` : "";
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 360" width="1000" height="360"><rect width="1000" height="360" fill="white"/><line x1="70" x2="930" y1="300" y2="300" stroke="#9aa9b4" stroke-width="2"/><g fill="none" stroke="#071b2b" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">${polylines}</g></svg>`;
}

function signatureFile(input: {
  id: string;
  group: string;
  title: string;
  signerName: string;
  signedAt: string;
  strokes: readonly SignatureStroke[];
  detail: string;
}): JobFile {
  return {
    id: input.id,
    group: input.group,
    title: input.title,
    fileName: `${safePart(input.signerName)}-signature.svg`,
    contentType: "image/svg+xml",
    sizeBytes: 0,
    recordedAt: input.signedAt,
    detail: input.detail,
    signature: { signerName: input.signerName, strokes: input.strokes },
  };
}

async function jsonRequest<T>(user: User, path: string) {
  const response = await fetch(path, {
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "Files could not be loaded.");
  return result;
}

export function TradeJobFilesPanel({
  user,
  workOrderId,
  includeRentalReports = false,
  includeHandover = false,
  includeQuotes = false,
  includeInvoices = false,
}: {
  user: User;
  workOrderId: string;
  includeRentalReports?: boolean;
  includeHandover?: boolean;
  includeQuotes?: boolean;
  includeInvoices?: boolean;
}) {
  const [files, setFiles] = useState<JobFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setStatus("");
    const queryId = encodeURIComponent(workOrderId);
    const sources = await Promise.allSettled([
      jsonRequest<FieldWorkResult>(user, `/api/trade-field-work?workOrderId=${queryId}`),
      jsonRequest<{ records?: ActivitySummary[] }>(user, `/api/trade-activity-forms?workOrderId=${queryId}`),
      jsonRequest<{ instances?: CreditexAssignedActivityWorkPackProjection[] }>(user, `/api/trade-team/work-packs?workOrderId=${queryId}`),
      includeRentalReports ? jsonRequest<RentalResult>(user, `/api/trade-rental-inspections?workOrderId=${queryId}`) : Promise.resolve<RentalResult>({ reports: [] }),
      includeHandover ? jsonRequest<HandoverResult>(user, `/api/trade-handover?workOrderId=${queryId}`) : Promise.resolve<HandoverResult>({ pack: null }),
      includeQuotes ? jsonRequest<QuoteResult>(user, `/api/trade-quotes?workOrderId=${queryId}`) : Promise.resolve<QuoteResult>({ quote: null }),
      includeInvoices ? jsonRequest<InvoiceResult>(user, `/api/trade-quick-invoices?workOrderId=${queryId}`) : Promise.resolve<InvoiceResult>({ invoice: null }),
    ]);
    const next: JobFile[] = [];
    const failures: string[] = [];
    const value = <T,>(index: number): T | undefined => {
      const source = sources[index];
      if (source.status === "fulfilled") return source.value as T;
      failures.push(source.reason instanceof Error ? source.reason.message : "A file source could not be loaded.");
      return undefined;
    };

    const field = value<FieldWorkResult>(0);
    for (const item of field?.media || []) {
      next.push({
        id: `job-media:${item.id}`,
        group: "General job files",
        title: item.caption || item.fileName,
        fileName: item.fileName,
        contentType: item.contentType,
        sizeBytes: item.sizeBytes,
        recordedAt: item.createdAt,
        detail: item.source === "customer_request" ? "Customer-provided evidence" : item.category.replaceAll("_", " "),
        path: `/api/trade-field-work?preview=${encodeURIComponent(item.id)}`,
      });
    }
    for (const item of field?.signoffs || []) {
      next.push({
        id: `job-signoff:${item.id}`,
        group: "General job sign-offs",
        title: `${item.signerName} sign-off`,
        fileName: `${safePart(item.signerName)}-sign-off.txt`,
        contentType: "text/plain",
        sizeBytes: 0,
        recordedAt: item.signedAt,
        detail: `${item.signerRole} | ${item.method}`,
        inlineText: `${item.signerName}\n${item.signerRole}\n${dateTime(item.signedAt)}\n\n${item.confirmationText}`,
      });
    }

    const activityList = value<{ records?: ActivitySummary[] }>(1);
    const activityDetails = await Promise.allSettled((activityList?.records || []).filter((item) => item.id)
      .map((item) => jsonRequest<{ record?: ActivityRecord }>(user, `/api/trade-activity-forms?recordId=${encodeURIComponent(item.id)}`)));
    for (const [index, result] of activityDetails.entries()) {
      if (result.status === "rejected") {
        failures.push(result.reason instanceof Error ? result.reason.message : "An activity record could not be loaded.");
        continue;
      }
      const record = result.value.record;
      if (!record) continue;
      const summary = (activityList?.records || []).filter((item) => item.id)[index];
      const group = `${record.recordNumber || summary?.programCode || "Activity"} | ${record.form.title}`;
      for (const item of record.evidence) {
        const fieldLabel = record.form.fields.find((fieldItem) => fieldItem.key === item.fieldKey)?.label || item.fileName;
        const location = item.latitude === null || item.longitude === null ? "Location unavailable" : `${item.latitude.toFixed(5)}, ${item.longitude.toFixed(5)}`;
        next.push({
          id: `activity-evidence:${record.id}:${item.id}`,
          group,
          title: fieldLabel,
          fileName: item.fileName,
          contentType: item.contentType,
          sizeBytes: item.size,
          recordedAt: item.capturedAt || item.uploadedAt,
          detail: `Activity evidence | ${location}`,
          path: `/api/trade-activity-forms?recordId=${encodeURIComponent(record.id)}&view=evidence&evidenceId=${encodeURIComponent(item.id)}`,
        });
      }
      for (const item of record.signatures) {
        const declaration = record.form.declarations.find((candidate) => candidate.key === item.declarationKey);
        next.push(signatureFile({
          id: `activity-signature:${record.id}:${item.id}`,
          group,
          title: declaration?.title || `${item.role} signature`,
          signerName: item.signerName,
          signedAt: item.signedAt,
          strokes: item.strokes,
          detail: `${item.role} signature`,
        }));
      }
      if (record.reportUrl) {
        next.push({
          id: `activity-report:${record.id}`,
          group,
          title: "Completed signed activity report",
          fileName: `${record.recordNumber || safePart(record.form.title)}.pdf`,
          contentType: "application/pdf",
          sizeBytes: 0,
          recordedAt: record.submittedAt,
          detail: "PDF submitted to Creditex",
          path: record.reportUrl,
        });
      }
    }

    const workPacks = value<{ instances?: CreditexAssignedActivityWorkPackProjection[] }>(2);
    for (const pack of workPacks?.instances || []) {
      const group = `${pack.definition.title} | governed activity`;
      for (const document of pack.referenceDocuments) {
        next.push({
          id: `work-pack-reference:${pack.instance.id}:${document.sourceArtifactId}:${document.responseKey}`,
          group,
          title: document.title,
          fileName: document.originalFileName,
          contentType: document.contentType,
          sizeBytes: document.sizeBytes,
          recordedAt: pack.instance.createdAt,
          detail: "Approved reference document",
          path: document.openUrl,
        });
      }
      for (const signature of pack.signatures.filter((item) => item.action === "captured")) {
        next.push(signatureFile({
          id: `work-pack-signature:${pack.instance.id}:${signature.id}`,
          group,
          title: `${signature.signerRole.replaceAll("_", " ")} signature`,
          signerName: signature.signerName,
          signedAt: signature.signedAt,
          strokes: signature.signaturePayload.strokes,
          detail: `${signature.signerCapacity} | retained governed signature`,
        }));
      }
      for (const artifact of pack.artifacts) {
        const path = new URLSearchParams({
          view: "artifact",
          workOrderId,
          caseInstanceId: pack.instance.id,
          artifactId: artifact.id,
        });
        next.push({
          id: `work-pack-artifact:${pack.instance.id}:${artifact.id}`,
          group,
          title: artifact.promptKey.replaceAll(/[._]/g, " "),
          fileName: artifact.originalFileName,
          contentType: artifact.contentType,
          sizeBytes: artifact.sizeBytes,
          recordedAt: artifact.capturedAt,
          detail: `${artifact.artifactKind} | verified evidence`,
          path: `/api/trade-team/work-packs?${path.toString()}`,
        });
      }
      if (pack.finalRecord) {
        next.push({
          id: `work-pack-final:${pack.instance.id}:${pack.finalRecord.id}`,
          group,
          title: "Completed signed activity record",
          fileName: pack.finalRecord.fileName,
          contentType: pack.finalRecord.contentType,
          sizeBytes: pack.finalRecord.sizeBytes,
          recordedAt: pack.finalRecord.finalisedAt,
          detail: "Immutable signed PDF",
          path: pack.finalRecord.downloadUrl,
        });
      }
    }

    const rental = value<RentalResult>(3);
    for (const report of rental?.reports || []) {
      if (!report.internalPdfUrl) continue;
      next.push({
        id: `rental-report:${report.id}`,
        group: "Rental assessment reports",
        title: `Rental assessment report revision ${report.revision}`,
        fileName: `${report.reportNumber}.pdf`,
        contentType: "application/pdf",
        sizeBytes: report.pdfSizeBytes,
        recordedAt: report.issuedAt,
        detail: report.status.replaceAll("_", " "),
        path: report.internalPdfUrl,
      });
    }

    const handover = value<HandoverResult>(4);
    for (const document of handover?.pack?.documents || []) {
      next.push({
        id: `handover:${document.id}`,
        group: "Handover documents",
        title: document.category.replaceAll("_", " "),
        fileName: document.fileName,
        contentType: document.contentType,
        sizeBytes: document.sizeBytes,
        recordedAt: document.createdAt,
        detail: "Completion and handover file",
        path: `/api/trade-handover/documents?download=${encodeURIComponent(document.id)}`,
      });
    }

    const quote = value<QuoteResult>(5)?.quote;
    if (quote?.link?.pdfUrl) {
      const current = quote.versions.find((version) => version.versionNumber === quote.currentVersionNumber);
      next.push({
        id: `quote:${quote.id}:${quote.currentVersionNumber}`,
        group: "Commercial documents",
        title: `Quote ${quote.quoteNumber}`,
        fileName: `${quote.quoteNumber}-v${quote.currentVersionNumber}.pdf`,
        contentType: "application/pdf",
        sizeBytes: 0,
        recordedAt: current?.issuedAt || "",
        detail: `Version ${quote.currentVersionNumber} | ${current?.status || "issued"}`,
        path: quote.link.pdfUrl,
      });
    }

    const invoice = value<InvoiceResult>(6)?.invoice;
    if (invoice?.canDownloadPdf) {
      next.push({
        id: `invoice:${invoice.id}:${invoice.revision}`,
        group: "Commercial documents",
        title: `Invoice ${invoice.invoiceNumber}`,
        fileName: `${invoice.invoiceNumber}-r${invoice.revision}.pdf`,
        contentType: "application/pdf",
        sizeBytes: 0,
        recordedAt: invoice.updatedAt,
        detail: invoice.status.replaceAll("_", " "),
        path: `/api/trade-quick-invoices/${encodeURIComponent(invoice.id)}/pdf`,
      });
    }

    const unique = [...new Map(next.map((item) => [item.id, item])).values()]
      .sort((left, right) => (Date.parse(right.recordedAt) || 0) - (Date.parse(left.recordedAt) || 0));
    setFiles(unique);
    if (failures.length) setStatus([...new Set(failures)].join(" "));
    setLoading(false);
  }, [includeHandover, includeInvoices, includeQuotes, includeRentalReports, user, workOrderId]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      void load().catch((error) => active && setStatus(error instanceof Error ? error.message : "Files could not be loaded."))
        .finally(() => active && setLoading(false));
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [load]);

  useEffect(() => {
    if (!preview) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setPreview(null); };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", close);
      URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  async function fileBlob(item: JobFile) {
    if (item.signature) return new Blob([signatureSvg(item.signature.strokes)], { type: "image/svg+xml" });
    if (item.inlineText !== undefined) return new Blob([item.inlineText], { type: "text/plain;charset=utf-8" });
    if (!item.path) throw new Error("This file is not available for download.");
    const url = new URL(item.path, window.location.origin);
    if (url.origin !== window.location.origin) throw new Error("The file address was not accepted.");
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      cache: "no-store",
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(result.error || "The file could not be opened.");
    }
    return response.blob();
  }

  async function openFile(item: JobFile) {
    setBusy(`open:${item.id}`);
    setStatus("");
    try {
      const blob = await fileBlob(item);
      setPreview({ item, url: URL.createObjectURL(blob), text: item.inlineText || "" });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The file could not be opened.");
    } finally {
      setBusy("");
    }
  }

  async function downloadFile(item: JobFile) {
    setBusy(`download:${item.id}`);
    setStatus("");
    try {
      const url = URL.createObjectURL(await fileBlob(item));
      const link = document.createElement("a");
      link.href = url;
      link.download = item.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The file could not be downloaded.");
    } finally {
      setBusy("");
    }
  }

  const visibleFiles = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("en-AU");
    if (!search) return files;
    return files.filter((item) => [item.group, item.title, item.fileName, item.detail]
      .some((value) => value.toLocaleLowerCase("en-AU").includes(search)));
  }, [files, query]);
  const groups = useMemo(() => [...new Set(visibleFiles.map((item) => item.group))], [visibleFiles]);

  return <section className="crm-field-work" aria-label="Job files">
    <div className="crm-section-heading"><div><span>Job record</span><h4>Files, evidence and signed reports</h4><p>Every available photo, document, signature and completed report for this job is grouped by activity.</p></div><button type="button" disabled={loading || Boolean(busy)} onClick={() => void load()}>{loading ? "Loading..." : "Refresh files"}</button></div>
    <section className="crm-field-summary"><article><span>Available files</span><strong>{files.length}</strong></article><article><span>Activities and groups</span><strong>{new Set(files.map((item) => item.group)).size}</strong></article><article><span>Photos and PDFs</span><strong>{files.filter((item) => item.contentType.startsWith("image/") || item.contentType === "application/pdf").length}</strong></article></section>
    {files.length > 6 && <label className="crm-field-card"><span>Find a file</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search photo, report, activity or file name" /></label>}
    {status && <p className="crm-status" role="status">{status}</p>}
    {groups.map((group) => <section className="crm-field-card wide" key={group}>
      <header><div><span>{visibleFiles.filter((item) => item.group === group).length} file{visibleFiles.filter((item) => item.group === group).length === 1 ? "" : "s"}</span><h4>{group}</h4></div></header>
      <ol className="crm-field-records">{visibleFiles.filter((item) => item.group === group).map((item) => <li key={item.id}><div><strong>{item.title}</strong><span>{item.fileName} | {sizeLabel(item.sizeBytes)}</span><small>{item.detail} | {dateTime(item.recordedAt)}</small></div><div><button type="button" disabled={Boolean(busy)} onClick={() => void openFile(item)}>{busy === `open:${item.id}` ? "Opening..." : "Preview"}</button><button type="button" disabled={Boolean(busy)} onClick={() => void downloadFile(item)}>{busy === `download:${item.id}` ? "Downloading..." : "Download"}</button></div></li>)}</ol>
    </section>)}
    {!loading && !status && !files.length && <div className="crm-empty"><strong>No job files recorded yet</strong><span>Photos, documents, signatures and completed reports will appear here as the team records them.</span></div>}
    {!loading && files.length > 0 && visibleFiles.length === 0 && <div className="crm-empty"><strong>No matching files</strong><span>Try another file name or activity.</span></div>}
    {preview && <div className="crm-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setPreview(null); }}><section className="crm-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="job-file-preview-title"><header><div><span>{preview.item.group}</span><strong id="job-file-preview-title">{preview.item.title}</strong><small>{preview.item.fileName}</small></div><button type="button" onClick={() => setPreview(null)} aria-label="Close file preview">Close</button></header><div className="crm-preview-content">{preview.item.contentType === "application/pdf" ? <iframe title={preview.item.title} src={preview.url} /> : preview.item.contentType.startsWith("image/") ? <img src={preview.url} alt={preview.item.title} /> : <pre>{preview.text}</pre>}</div><footer><a href={preview.url} download={preview.item.fileName}>Download file</a><button type="button" className="btn" onClick={() => setPreview(null)}>Done</button></footer></section></div>}
  </section>;
}
