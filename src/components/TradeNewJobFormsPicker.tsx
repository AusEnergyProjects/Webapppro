"use client";

import type { User } from "firebase/auth";
import { useEffect, useState } from "react";
import { useTradeBusiness, useTradeBusinessFetch } from "./TradeBusinessProvider";

type Template = { key: string; version: number; name: string; jurisdiction: string; description: string; fieldCount: number };
export type TradeJobFormSelection = { templateKey: string; templateVersion: number; name: string };
type Library = { ok?: boolean; serviceCategory?: string; templates?: Template[]; error?: string };
const MAX_SELECTED_FORMS = 20;

export function TradeNewJobFormsPicker({ user, serviceCategory, selections, disabled = false, onChange }: {
  user: User;
  serviceCategory: string;
  selections: TradeJobFormSelection[];
  disabled?: boolean;
  onChange: (selections: TradeJobFormSelection[]) => void;
}) {
  const fetch = useTradeBusinessFetch();
  const business = useTradeBusiness();
  const [library, setLibrary] = useState<{ scope: string; templates: Template[] | null; error: string }>({ scope: "", templates: null, error: "" });
  const [retry, setRetry] = useState(0);
  const scope = JSON.stringify([user.uid, business?.ownerUid, serviceCategory, retry]);
  const current = library.scope === scope ? library : null;
  const templates = current?.templates || [];
  const error = current?.error || "";
  const loading = !current || current.templates === null && !error;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void (async () => {
      try {
        const token = await user.getIdToken();
        if (!active) return;
        const response = await fetch(`/api/trade-job-forms?${new URLSearchParams({ mode: "library", serviceCategory })}`, {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
        });
        const result = await response.json() as Library;
        if (!response.ok || !result.ok) throw new Error(result.error || "The form library could not be loaded.");
        if (result.serviceCategory !== serviceCategory || !Array.isArray(result.templates)) throw new Error("The form library did not match this work type. Retry before selecting forms.");
        if (active) setLibrary({ scope, templates: result.templates, error: "" });
      } catch (failure) {
        if (active) setLibrary({ scope, templates: null, error: failure instanceof Error ? failure.message : "The form library could not be loaded." });
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [fetch, scope, serviceCategory, user]);

  function add(template: Template) {
    if (disabled || selections.length >= MAX_SELECTED_FORMS || selections.some((item) => item.templateKey === template.key)) return;
    onChange([...selections, { templateKey: template.key, templateVersion: template.version, name: template.name }]);
  }

  return <section className="crm-form-library" aria-label="Choose job forms">
    <div><strong>Supporting and business forms</strong><span>Selected forms will be added when you create the job.</span></div>
    {loading ? <p role="status">Loading forms for this work type...</p> : error ? <div role="alert"><p>{error}</p><button type="button" disabled={disabled} onClick={() => setRetry((value) => value + 1)}>Retry form library</button></div> : <div>
      {!templates.length && <p>No published supporting or business forms are available for this work type.</p>}
      {templates.map((template) => {
        const selected = selections.some((item) => item.templateKey === template.key);
        return <article key={`${template.key}:${template.version}`}><div><span>{template.jurisdiction} | Version {template.version}</span><strong>{template.name}</strong><p>{template.description}</p><small>{template.fieldCount} fields</small></div><button type="button" disabled={disabled || selected || selections.length >= MAX_SELECTED_FORMS} onClick={() => add(template)}>{selected ? "Selected" : "Add form"}</button></article>;
      })}
      {selections.length >= MAX_SELECTED_FORMS && <p role="status">You can select up to {MAX_SELECTED_FORMS} forms during job setup. More can be added from the saved job.</p>}
    </div>}
  </section>;
}
