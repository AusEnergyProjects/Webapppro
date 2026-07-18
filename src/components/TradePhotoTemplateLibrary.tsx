"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { defaultPhotoRequirements, type PhotoRequirement } from "@/lib/trade-photo-requests";
import styles from "./TradePhotoTemplateLibrary.module.css";

type RequirementStats = {
  id: string; label: string; selectedCount: number; completedCount: number;
  usefulCount: number; unclearCount: number; unnecessaryCount: number;
};
type PhotoTemplate = {
  id: string;
  name: string;
  serviceCategory: string;
  status: "draft" | "published" | "archived";
  draftRequirements: PhotoRequirement[];
  publishedVersion: number;
  canSeed: boolean;
  latestVersion: null | { id: string; version: number; name: string; serviceCategory: string; requirements: PhotoRequirement[]; publishedAt: string };
  metrics: {
    selections: number; editedJobs: number; requestedRequirements: number; completedRequirements: number;
    missingFeedback: number; feedbackCounts: { useful: number; unclear: number; unnecessary: number };
    requirementStats: RequirementStats[];
  };
};
type Result = { ok?: boolean; templates?: PhotoTemplate[]; error?: string };

const serviceLabels: Record<string, string> = {
  assessment: "Energy assessment", solar: "Rooftop solar", battery: "Home batteries",
  "heating-cooling": "Heating and cooling", "hot-water": "Hot water",
  "insulation-draughts": "Insulation and draught control", "ev-charging": "EV charging",
  electrical: "Electrical services", plumbing: "Plumbing services",
  "mounting-hardware": "Mounting and hardware", controls: "Energy controls", other: "Other work",
};

function blankRequirement(): PhotoRequirement {
  return {
    id: `photo-${crypto.randomUUID().slice(0, 8)}`,
    label: "",
    guidance: "Take a clear, well-lit photo from a safe position.",
    usefulExample: "Show the full equipment or area and its surrounding context.",
    avoidExample: "People, documents, street numbers and unrelated belongings.",
    required: false,
  };
}

export function TradePhotoTemplateLibrary({ user }: { user: User }) {
  const [templates, setTemplates] = useState<PhotoTemplate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [serviceCategory, setServiceCategory] = useState("assessment");
  const [requirements, setRequirements] = useState<PhotoRequirement[]>(() => defaultPhotoRequirements("assessment"));
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  const selected = useMemo(() => templates.find((item) => item.id === selectedId) || null, [selectedId, templates]);

  const edit = useCallback((template: PhotoTemplate | null) => {
    setSelectedId(template?.id || "");
    setName(template?.name || "");
    setServiceCategory(template?.serviceCategory || "assessment");
    setRequirements((template?.draftRequirements.length ? template.draftRequirements : defaultPhotoRequirements(template?.serviceCategory || "assessment")).map((item) => ({ ...item })));
    setStatus("");
  }, []);

  const applyResult = useCallback((result: Result, preferredId = "") => {
    const next = result.templates || [];
    setTemplates(next);
    const nextSelected = next.find((item) => item.id === (preferredId || selectedId));
    if (nextSelected) edit(nextSelected);
  }, [edit, selectedId]);

  const load = useCallback(async () => {
    const token = await user.getIdToken();
    const response = await fetch("/api/trade-photo-templates", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as Result;
    if (!response.ok || !result.ok) throw new Error(result.error || "Photo templates could not be loaded.");
    setTemplates(result.templates || []);
  }, [user]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      void load().catch((error) => active && setStatus(error instanceof Error ? error.message : "Photo templates could not be loaded."))
        .finally(() => active && setLoading(false));
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [load]);

  function updateRequirement(index: number, field: keyof PhotoRequirement, value: string | boolean) {
    setRequirements((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
    setStatus("");
  }

  async function action(actionName: "create" | "save_draft" | "publish" | "duplicate" | "archive") {
    setBusy(actionName); setStatus("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-photo-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: actionName, templateId: selectedId, name, serviceCategory, requirements }),
      });
      const result = await response.json().catch(() => ({})) as Result;
      if (!response.ok || !result.ok) throw new Error(result.error || "The photo template could not be saved.");
      const nextId = actionName === "create" || actionName === "duplicate"
        ? result.templates?.find((item) => !templates.some((existing) => existing.id === item.id))?.id || ""
        : selectedId;
      applyResult(result, nextId);
      setStatus(actionName === "publish" ? "Published as an immutable version and ready for new job requests."
        : actionName === "archive" ? "Template archived. Existing job requests keep their independent copy."
        : actionName === "duplicate" ? "Draft copy created."
        : actionName === "create" ? "Draft created. Publish it when the guidance is ready."
        : "Draft saved. The current published version remains unchanged until you publish.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The photo template could not be saved."); }
    finally { setBusy(""); }
  }

  if (loading) return <section className={styles.state}><strong>Opening photo guidance templates</strong><span>Loading the business library...</span></section>;

  const archived = selected?.status === "archived";
  return <section className={styles.library} aria-labelledby="photo-template-library-title">
    <header className={styles.heading}><div><span>Customer photo guidance</span><h3 id="photo-template-library-title">Photo request templates</h3><p>Maintain upgrade-specific guidance from trade feedback. Publishing creates an immutable version, while each job gets its own editable copy.</p></div><button type="button" onClick={() => edit(null)}>New photo template</button></header>
    <div className={styles.boundary}><strong>Business only</strong><span>Templates, usage and feedback stay inside this installer business. Counts use request metadata only and never inspect customer images.</span></div>
    <div className={styles.layout}>
      <aside className={styles.list} aria-label="Photo request templates">
        {templates.length ? templates.map((template) => <button type="button" key={template.id} className={selectedId === template.id ? styles.active : ""} onClick={() => edit(template)}>
          <span>{serviceLabels[template.serviceCategory] || template.serviceCategory}</span><strong>{template.name}</strong><small>{template.status === "published" ? `Published v${template.publishedVersion}` : template.status === "draft" && template.publishedVersion ? `Draft changes, v${template.publishedVersion} remains available` : template.status}</small>
        </button>) : <div className={styles.empty}><strong>No photo templates yet</strong><span>Create one from the safe service defaults.</span></div>}
      </aside>
      <div className={styles.editor}>
        <header><div><span>{selected ? "Template editor" : "New draft"}</span><h4>{selected?.name || "Create reusable photo guidance"}</h4></div>{selected && <em data-state={selected.status}>{selected.status}</em>}</header>
        <div className={styles.fields}><label><span>Template name</span><input value={name} maxLength={100} disabled={archived} onChange={(event) => setName(event.target.value)} placeholder="Standard heat pump quote photos" /></label><label><span>Upgrade or service</span><select value={serviceCategory} disabled={archived} onChange={(event) => setServiceCategory(event.target.value)}>{Object.entries(serviceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        {!archived && <button type="button" className={styles.reset} onClick={() => setRequirements(defaultPhotoRequirements(serviceCategory))}>Reset to safe {serviceLabels[serviceCategory] || serviceCategory} defaults</button>}
        <div className={styles.requirements}>{requirements.map((item, index) => <article key={item.id}>
          <header><strong>Photo {index + 1}</strong><label><input type="checkbox" checked={item.required} disabled={archived} onChange={(event) => updateRequirement(index, "required", event.target.checked)} /><span>Required</span></label></header>
          <label><span>What the customer should photograph</span><input value={item.label} maxLength={120} disabled={archived} onChange={(event) => updateRequirement(index, "label", event.target.value)} /></label>
          <label><span>Capture guidance</span><textarea value={item.guidance} maxLength={500} rows={2} disabled={archived} onChange={(event) => updateRequirement(index, "guidance", event.target.value)} /></label>
          <div><label><span>Useful example</span><textarea value={item.usefulExample} maxLength={300} rows={2} disabled={archived} onChange={(event) => updateRequirement(index, "usefulExample", event.target.value)} /></label><label><span>Avoid example</span><textarea value={item.avoidExample} maxLength={300} rows={2} disabled={archived} onChange={(event) => updateRequirement(index, "avoidExample", event.target.value)} /></label></div>
          {!archived && <footer><span>Requirement ID: {item.id}</span><button type="button" disabled={requirements.length <= 1} onClick={() => setRequirements((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></footer>}
        </article>)}</div>
        {!archived && <div className={styles.actions}><button type="button" className={styles.secondary} disabled={requirements.length >= 12 || Boolean(busy)} onClick={() => setRequirements((current) => [...current, blankRequirement()])}>Add photo requirement</button><button type="button" disabled={Boolean(busy)} onClick={() => void action(selected ? "save_draft" : "create")}>{busy === "save_draft" || busy === "create" ? "Saving..." : selected ? "Save draft changes" : "Create draft"}</button>{selected && <button type="button" disabled={Boolean(busy)} onClick={() => void action("publish")}>{busy === "publish" ? "Publishing..." : selected.publishedVersion ? "Publish new version" : "Publish version 1"}</button>}{selected && <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => void action("duplicate")}>Duplicate</button>}{selected && <button type="button" className={styles.danger} disabled={Boolean(busy)} onClick={() => void action("archive")}>Archive</button>}</div>}
        {selected?.latestVersion && <section className={styles.metrics}><header><div><span>Privacy-safe feedback</span><h4>Published v{selected.latestVersion.version} usage</h4></div><small>No customer identity, address, contact or image content</small></header><div><article><span>Jobs selected</span><strong>{selected.metrics.selections}</strong></article><article><span>Jobs edited</span><strong>{selected.metrics.editedJobs}</strong></article><article><span>Photos requested</span><strong>{selected.metrics.requestedRequirements}</strong></article><article><span>Requirements completed</span><strong>{selected.metrics.completedRequirements}</strong></article><article><span>Missing guidance</span><strong>{selected.metrics.missingFeedback}</strong></article><article><span>Unclear feedback</span><strong>{selected.metrics.feedbackCounts.unclear}</strong></article></div>{selected.metrics.requirementStats.length > 0 && <ul>{selected.metrics.requirementStats.map((item) => <li key={item.id}><strong>{item.label}</strong><span>{item.selectedCount} requested</span><span>{item.completedCount} completed</span><span>{item.usefulCount} useful</span><span>{item.unclearCount} unclear</span><span>{item.unnecessaryCount} not needed</span></li>)}</ul>}</section>}
        {status && <p className={styles.status} role="status">{status}</p>}
      </div>
    </div>
  </section>;
}
