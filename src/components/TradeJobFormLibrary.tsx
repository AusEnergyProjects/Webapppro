"use client";

import type { User } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import type { TradeJobFormLibraryOption } from "@/lib/trade-job-form-library";
import { useTradeBusiness, useTradeBusinessFetch } from "./TradeBusinessProvider";

type Library = { ok?: boolean; options?: TradeJobFormLibraryOption[]; revision?: number; error?: string };
const groups = ["Rental assessments", "Creditex forms", "Business forms"] as const;

export function TradeJobFormLibrary({ user, serviceCategory, addressState = "", buildingType = "not_sure", workOrderId,
  selectedIds, disabled = false, refreshKey = 0, onSelect }: {
  user: User; serviceCategory: string; addressState?: string; buildingType?: string; workOrderId?: string;
  selectedIds: string[]; disabled?: boolean; refreshKey?: number;
  onSelect: (option: TradeJobFormLibraryOption, revision?: number) => void | Promise<void>;
}) {
  const fetch = useTradeBusinessFetch(), business = useTradeBusiness();
  const [library, setLibrary] = useState<{ scope: string; options: TradeJobFormLibraryOption[] | null; revision?: number; error: string }>({ scope: "", options: null, error: "" });
  const [search, setSearch] = useState(""), [retry, setRetry] = useState(0), [adding, setAdding] = useState("");
  const inFlight = useRef(false);
  const scope = JSON.stringify([user.uid, business?.ownerUid, serviceCategory, addressState, buildingType, workOrderId, refreshKey, retry]);
  const current = library.scope === scope ? library : null;
  const options = current?.options || [], error = current?.error || "";
  const loading = !current || current.options === null && !error;
  const query = search.trim().toLocaleLowerCase("en-AU");
  const searchWords = query.split(/[\s-]+/).filter(Boolean);
  const matches = options.filter(option => {
    const content = `${option.name} ${option.description} ${option.group} ${option.searchText}`.toLocaleLowerCase("en-AU");
    return searchWords.every(word => content.includes(word));
  });

  useEffect(() => {
    const controller = new AbortController(); let active = true;
    void (async () => {
      try {
        const token = await user.getIdToken(); if (!active) return;
        const params = workOrderId ? new URLSearchParams({ workOrderId }) : new URLSearchParams({ serviceCategory, addressState, buildingType });
        const response = await fetch(`/api/trade-job-form-library?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
        const result = await response.json() as Library;
        if (!response.ok || !result.ok) throw new Error(result.error || "The form library could not be loaded.");
        if (!Array.isArray(result.options) || workOrderId && !Number.isSafeInteger(result.revision)) throw new Error("The form library could not be read. Retry before adding a form.");
        if (active) setLibrary({ scope, options: result.options, revision: result.revision, error: "" });
      } catch (failure) { if (active) setLibrary({ scope, options: null, error: failure instanceof Error ? failure.message : "The form library could not be loaded." }); }
    })();
    return () => { active = false; controller.abort(); };
  }, [fetch, scope, serviceCategory, addressState, buildingType, workOrderId, user]);

  const isSelected = (option: TradeJobFormLibraryOption) => selectedIds.includes(option.id) || option.selection.kind === "business" && selectedIds.some(id => id.startsWith(`business:${option.selection.kind === "business" ? option.selection.templateKey : ""}:`));

  async function add(option: TradeJobFormLibraryOption) {
    if (disabled || inFlight.current || loading || option.added || option.unavailableReason || isSelected(option)) return;
    inFlight.current = true; setAdding(option.id);
    try { await onSelect(option, current?.revision); }
    finally { inFlight.current = false; setAdding(""); }
  }

  return <section className="crm-form-library" aria-label="Choose job forms">
    <div><strong>Form library</strong><span>{workOrderId ? "Add a form to this job." : "Selected forms will be attached when you create the job."}</span></div>
    <label><span>Search forms</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search rental, Creditex or business forms" /></label>
    <div><button type="button" onClick={() => setSearch("rental minimum standards")}>Rental assessment</button><button type="button" onClick={() => setSearch("PIESA")}>Pre-insulation electrical safety</button>{search && <button type="button" onClick={() => setSearch("")}>Show all forms</button>}</div>
    {loading ? <p role="status">Loading form library...</p> : error ? <div role="alert"><p>{error}</p><button type="button" disabled={disabled || Boolean(adding)} onClick={() => setRetry(value => value + 1)}>Retry form library</button></div> : <div>
      <p role="status">{matches.length} of {options.length} forms</p>
      {!matches.length && <p>{query ? "No forms match your search." : "No published forms are available."}</p>}
      {groups.map(group => {
        const entries = matches.filter(option => option.group === group);
        return entries.length ? <section key={group} aria-label={group}><h4>{group}</h4>{entries.map(option => {
          const selected = isSelected(option);
          return <article key={option.id}><div><span>{option.jurisdiction}{option.selection.kind === "business" ? ` | Version ${option.selection.templateVersion}` : ""}</span><strong>{option.name}</strong><p>{option.description}</p>{option.unavailableReason && !option.added && <small>{option.unavailableReason}</small>}</div>
            <button type="button" disabled={disabled || Boolean(adding) || selected || option.added || Boolean(option.unavailableReason)} onClick={() => void add(option)}>{adding === option.id ? "Adding..." : option.added ? "Added" : selected ? "Selected" : "Add form"}</button></article>;
        })}</section> : null;
      })}
    </div>}
  </section>;
}
