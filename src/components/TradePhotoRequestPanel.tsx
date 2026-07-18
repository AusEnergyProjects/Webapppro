"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import type { PhotoRequirement, PhotoTemplateFeedback, PhotoTemplateFeedbackValue } from "@/lib/trade-photo-requests";
import styles from "./TradePhotoRequestPanel.module.css";

type RequestRecord = {
  id: string;
  status: string;
  revision: number;
  requirements: PhotoRequirement[];
  expiresAt: string;
  lastSharedAt: string;
  linkActive: boolean;
  uploadCounts: Record<string, number>;
  sourceTemplate: null | { id: string; versionId: string; version: number; name: string; serviceCategory: string; requirements: PhotoRequirement[] };
  sourceTemplateEdited: boolean;
  templateFeedback: PhotoTemplateFeedback;
  templateMissingFeedback: boolean;
};
type TemplateOption = { id: string; versionId: string; version: number; name: string; serviceCategory: string; requirements: PhotoRequirement[] };
type Result = {
  ok?: boolean;
  request?: RequestRecord | null;
  defaults?: PhotoRequirement[];
  templates?: TemplateOption[];
  shareUrl?: string;
  error?: string;
};

export function TradePhotoRequestPanel({ user, workOrderId }: { user: User; workOrderId: string }) {
  const [record, setRecord] = useState<RequestRecord | null>(null);
  const [requirements, setRequirements] = useState<PhotoRequirement[]>([]);
  const [defaults, setDefaults] = useState<PhotoRequirement[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [selectedTemplateVersionId, setSelectedTemplateVersionId] = useState("");
  const [templateFeedback, setTemplateFeedback] = useState<PhotoTemplateFeedback>({});
  const [templateMissingFeedback, setTemplateMissingFeedback] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");

  const apply = useCallback((result: Result) => {
    setRecord(result.request || null);
    setRequirements(result.request?.requirements || result.defaults || []);
    setDefaults(result.defaults || []);
    setTemplates(result.templates || []);
    setSelectedTemplateVersionId(result.request?.sourceTemplate?.versionId || "");
    setTemplateFeedback(result.request?.templateFeedback || {});
    setTemplateMissingFeedback(Boolean(result.request?.templateMissingFeedback));
    if (result.shareUrl) setShareUrl(result.shareUrl);
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const token = await user.getIdToken();
        const response = await fetch(`/api/trade-photo-requests?workOrderId=${encodeURIComponent(workOrderId)}`, {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
        });
        const result = await response.json().catch(() => ({})) as Result;
        if (!response.ok || !result.ok) throw new Error(result.error || "Customer photo requests could not be loaded.");
        if (active) apply(result);
      } catch (error) {
        if (active) setStatus(error instanceof Error ? error.message : "Customer photo requests could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [apply, user, workOrderId]);

  function update(index: number, field: keyof PhotoRequirement, value: string | boolean) {
    setRequirements((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
    setStatus("");
  }

  function addRequirement() {
    if (requirements.length >= 12) return;
    setRequirements((current) => [...current, {
      id: `photo-${crypto.randomUUID().slice(0, 8)}`,
      label: "",
      guidance: "Take a clear, well-lit photo from a safe position.",
      usefulExample: "Show the full equipment or area and its surrounding context.",
      avoidExample: "People, documents, street numbers and unrelated belongings.",
      required: false,
    }]);
  }

  async function action(actionName: "save_request" | "issue_link" | "save_feedback") {
    setBusy(actionName); setStatus(actionName === "issue_link" ? "Creating a new secure link..." : actionName === "save_feedback" ? "Saving trade feedback..." : "Saving the requested photos...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-photo-requests", { method: "POST", headers: {
        "Content-Type": "application/json", Authorization: `Bearer ${token}`,
      }, body: JSON.stringify({ action: actionName, workOrderId, requirements, expectedRevision: record?.revision || 0,
        sourceTemplateVersionId: selectedTemplateVersionId, templateFeedback, templateMissingFeedback }) });
      const result = await response.json().catch(() => ({})) as Result;
      if (!response.ok || !result.ok) throw new Error(result.error || "The customer photo request could not be saved.");
      apply(result);
      setStatus(actionName === "save_feedback" ? "Privacy-safe template feedback saved for the business library."
        : actionName === "issue_link" || result.shareUrl
        ? "Secure link ready. Copy or share it now. Creating another link later will replace this one."
        : "Photo requirements saved. The active customer link now shows this revision.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The customer photo request could not be saved."); }
    finally { setBusy(""); }
  }

  async function revoke() {
    setBusy("revoke"); setStatus("Revoking the customer link...");
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/trade-photo-requests?workOrderId=${encodeURIComponent(workOrderId)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json().catch(() => ({})) as Result;
      if (!response.ok || !result.ok) throw new Error(result.error || "The customer link could not be revoked.");
      apply(result); setShareUrl(""); setStatus("The previous customer link is no longer active.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The customer link could not be revoked."); }
    finally { setBusy(""); }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(shareUrl); setStatus("Secure customer link copied."); }
    catch { setStatus("Copy was blocked by this browser. Select the link and copy it manually."); }
  }

  async function shareLink() {
    if (!shareUrl) return;
    if (navigator.share) {
      try { await navigator.share({ title: "Photos requested for your job", text: "Please use this secure link to add the requested job photos.", url: shareUrl }); setStatus("Secure link shared."); }
      catch { setStatus("Sharing was cancelled. The secure link is still ready to copy."); }
    } else await copyLink();
  }

  if (loading) return <div className={styles.state}><strong>Opening customer photo requests</strong><span>Loading the editable request...</span></div>;

  const totalUploads = Object.values(record?.uploadCounts || {}).reduce((sum, count) => sum + count, 0);
  return <section className={styles.panel} aria-labelledby="trade-photo-request-title">
    <header className={styles.heading}><div><span>Request info</span><h4 id="trade-photo-request-title">Customer photo request</h4><p>Start with service guidance, then edit the exact photos this job needs. The secure link places accepted uploads into this job proof.</p></div><div><strong>{totalUploads}</strong><span>customer photos</span></div></header>
    <div className={styles.boundary}><strong>Direct customer only</strong><span>The link contains an opaque capability token, expires after 30 days and never includes the customer name, contact details or address.</span></div>
    {!record && <section className={styles.templatePicker}><label><span>Start from published business guidance, optional</span><select value={selectedTemplateVersionId} onChange={(event) => {
      const versionId = event.target.value; const template = templates.find((item) => item.versionId === versionId);
      setSelectedTemplateVersionId(versionId); setRequirements((template?.requirements || defaults).map((item) => ({ ...item })));
      setStatus(template ? `${template.name} v${template.version} applied. This job will keep its own editable snapshot.` : "Safe service defaults restored.");
    }}><option value="">Safe service defaults</option>{templates.map((template) => <option key={template.versionId} value={template.versionId}>{template.name} v{template.version}</option>)}</select></label><p>{templates.length ? "Only the latest published version can seed a new request. Archived templates are excluded." : "No published business template is available. The safe service defaults remain ready to edit."}</p></section>}
    {record?.sourceTemplate && <section className={styles.source}><div><span>Seeded from business template</span><strong>{record.sourceTemplate.name} v{record.sourceTemplate.version}</strong><small>{record.sourceTemplateEdited ? "This job has independent changes." : "This job still matches the published snapshot."} Later template changes do not rewrite it.</small></div></section>}
    <div className={styles.requirements}>
      {requirements.map((item, index) => <article key={item.id}>
        <header><strong>Photo {index + 1}</strong><label><input type="checkbox" checked={item.required} onChange={(event) => update(index, "required", event.target.checked)} /><span>Required</span></label></header>
        <label><span>What the customer should photograph</span><input value={item.label} maxLength={120} onChange={(event) => update(index, "label", event.target.value)} /></label>
        <label><span>Capture guidance</span><textarea value={item.guidance} maxLength={500} rows={2} onChange={(event) => update(index, "guidance", event.target.value)} /></label>
        <div><label><span>Useful example</span><textarea value={item.usefulExample} maxLength={300} rows={2} onChange={(event) => update(index, "usefulExample", event.target.value)} /></label><label><span>Avoid example</span><textarea value={item.avoidExample} maxLength={300} rows={2} onChange={(event) => update(index, "avoidExample", event.target.value)} /></label></div>
        <footer><span>{record?.uploadCounts[item.id] || 0} uploaded</span><button type="button" disabled={requirements.length <= 1 || Boolean(busy)} onClick={() => setRequirements((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove requirement</button></footer>
      </article>)}
    </div>
    {record?.sourceTemplate && <section className={styles.feedback}><header><div><span>Trade feedback</span><strong>Help improve the next published version</strong></div><small>Counts only. Do not add customer or property information.</small></header><div>{record.sourceTemplate.requirements.map((item) => <label key={item.id}><span>{item.label}</span><select value={templateFeedback[item.id] || ""} onChange={(event) => setTemplateFeedback((current) => {
      const next = { ...current }; const value = event.target.value as PhotoTemplateFeedbackValue | "";
      if (value) next[item.id] = value; else delete next[item.id]; return next;
    })}><option value="">No feedback</option><option value="useful">Useful</option><option value="unclear">Unclear</option><option value="unnecessary">Not needed</option></select></label>)}</div><label className={styles.missing}><input type="checkbox" checked={templateMissingFeedback} onChange={(event) => setTemplateMissingFeedback(event.target.checked)} /><span>The template was missing a photo requirement for this type of work.</span></label><button type="button" disabled={Boolean(busy)} onClick={() => void action("save_feedback")}>{busy === "save_feedback" ? "Saving..." : "Save template feedback"}</button></section>}
    <div className={styles.editorActions}><button type="button" className={styles.secondary} disabled={requirements.length >= 12 || Boolean(busy)} onClick={addRequirement}>Add photo requirement</button><button type="button" disabled={Boolean(busy)} onClick={() => void action("save_request")}>{busy === "save_request" ? "Saving..." : record ? "Save requirement changes" : "Create request and link"}</button></div>
    {record && <section className={styles.linkCard}><div><span>{record.linkActive ? "Active secure link" : record.status === "revoked" ? "Link revoked" : "Link expired"}</span><strong>{record.linkActive ? `Available until ${new Date(record.expiresAt).toLocaleDateString("en-AU")}` : "Create a replacement before sending"}</strong><small>Requirement revision {record.revision}. Customer uploads remain attached if the request wording changes.</small></div><button type="button" disabled={Boolean(busy)} onClick={() => void action("issue_link")}>{busy === "issue_link" ? "Creating..." : record.linkActive ? "Replace secure link" : "Create secure link"}</button>{record.linkActive && <button type="button" className={styles.danger} disabled={Boolean(busy)} onClick={() => void revoke()}>{busy === "revoke" ? "Revoking..." : "Revoke link"}</button>}</section>}
    {shareUrl && <section className={styles.share}><label><span>Secure link, visible until this page reloads</span><input readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} /></label><button type="button" onClick={() => void copyLink()}>Copy link</button><button type="button" onClick={() => void shareLink()}>Share link</button></section>}
    {status && <p className={styles.status} role="status">{status}</p>}
  </section>;
}
