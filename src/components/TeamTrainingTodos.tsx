"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { ENERGY_SERVICE_CATALOGUE } from "@/lib/energy-service-catalogue.mjs";
import styles from "./TeamTrainingTodos.module.css";

type Module = { id: string; title: string; programCode: string; activityTemplateIds: string[]; serviceCategory: string; businessServiceEnabled: boolean;
  status: string; availability: string; assessmentAvailable: boolean; assessmentUnavailableReason: string; completion: null | { reference: string; expiresAt: string } };
type Result = { ok: boolean; error?: string; memberId: string; canTakeTraining: boolean;
  selectedMember: { memberId: string; displayName: string; isOwner: boolean; isSelf: boolean };
  modules: Module[]; unavailableActivities: { id: string; title: string; programCode: string; message: string }[] };
type Props = { user: User; memberId: string; displayName: string; hasOfficeLogin: boolean; active: boolean; unsavedServices: boolean; saving: boolean;
  onSave: () => void; onOpenOwnTraining?: () => void; ownTrainingHref: string };

function moduleStatus(module: Module) {
  if (module.status === "passed") return "Passed";
  if (!module.assessmentAvailable) return "Assessment unavailable";
  return ({ expired: "Pass expired", revoked: "Pass revoked" } as Record<string, string>)[module.status] || "To do";
}

export function TeamTrainingTodos({ user, memberId, displayName, hasOfficeLogin, active, unsavedServices, saving, onSave, onOpenOwnTraining, ownTrainingHref }: Props) {
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(active);
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState("");
  const [program, setProgram] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    if (!active) return;
    let current = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/trade-training?memberId=${encodeURIComponent(memberId)}`, {
          headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: "no-store", signal: controller.signal,
        });
        const result = await response.json() as Result;
        if (!response.ok || !result.ok) throw new Error(result.error || "Training to-dos could not be loaded.");
        if (result.memberId !== memberId || result.selectedMember.memberId !== memberId) throw new Error("Training records did not match this member. Refresh and try again.");
        if (current) { setData(result); setError(""); }
      } catch (caught) { if (current) setError(caught instanceof Error ? caught.message : "Training to-dos could not be loaded."); }
      finally { if (current) setLoading(false); }
    })();
    return () => { current = false; controller.abort(); };
  }, [active, memberId, refresh, user]);
  const modules = data?.modules || [];
  const unavailable = data?.unavailableActivities || [];
  const programs = [...new Set([...modules, ...unavailable].map(module => module.programCode))].sort();
  const matches = (item: { id: string; title: string; programCode: string }) => (!program || item.programCode === program)
    && `${item.id} ${item.title} ${item.programCode}`.toLowerCase().includes(search.trim().toLowerCase());
  const matching = modules.filter(matches);
  const totalPages = Math.max(1, Math.ceil(matching.length / 6));
  const currentPage = Math.min(page, totalPages);
  const passed = modules.filter(module => module.status === "passed").length;
  const serviceLabel = (id: string) => ENERGY_SERVICE_CATALOGUE.find(service => service.id === id)?.label || id;
  return <section className={styles.panel} aria-label={`Training to-dos for ${displayName}`}>
    <header className={styles.header}><div><h4>Training to-dos</h4><p>{displayName}&apos;s saved services determine this list.</p></div>{active && <button type="button" className={styles.button} disabled={loading || saving} onClick={() => { setLoading(true); setError(""); setRefresh(value => value + 1); }}>Refresh training</button>}</header>
    {unsavedServices && <div className={styles.notice} role="status"><p>Service changes are not saved. The to-dos below still reflect the saved services.</p><button type="button" className={styles.button} disabled={saving} onClick={onSave}>Save services and update to-dos</button></div>}
    {!active ? <p className={styles.notice}>This member is inactive. Reactivate access before they can complete training or take program work.</p> : <>
      {!hasOfficeLogin && <p className={styles.note}>Office login is not linked. Use the app PIN setup above if this person has not signed in to the app.</p>}
      <p className={styles.note}>Each person completes their own modules in Training on the app or To do &amp; training in TLink. A manager cannot complete another person&apos;s assessment.</p>
      {loading && <p role="status" className={styles.note}>Loading saved training to-dos...</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {data && !loading && !error && <>
        <p className={styles.summary}><strong>{passed} of {modules.length} modules passed</strong><span>100% required. Unlimited immediate retakes.</span></p>
        {data.canTakeTraining && data.selectedMember.isSelf && (onOpenOwnTraining
          ? <button type="button" className={styles.button} disabled={saving} onClick={onOpenOwnTraining}>Open my training</button>
          : <a className={styles.button} href={ownTrainingHref}>Open my training</a>)}
        {modules.length > 0 && <><div className={styles.filters}><label>Find an activity<input type="search" value={search} placeholder="Activity, program or work type" onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label><label>Program<select value={program} onChange={event => { setProgram(event.target.value); setPage(1); }}><option value="">All programs</option>{programs.map(item => <option key={item} value={item}>{item}</option>)}</select></label></div>
          <p className={styles.note}>{matching.length} matching activities</p><ul className={styles.list}>{matching.slice((currentPage - 1) * 6, currentPage * 6).map(module => {
            const currentPass = module.status === "passed";
            return <li key={module.id} className={styles.module}><div className={styles.row}><div><small>{module.programCode} · {module.activityTemplateIds.join(", ")}</small><h5>{module.title}</h5></div><span className={currentPass ? styles.passed : styles.badge}>{currentPass && <span aria-hidden="true">✓ </span>}{moduleStatus(module)}</span></div>
              {!module.assessmentAvailable && <p>{module.assessmentUnavailableReason || "Assessment is unavailable. Refresh training for the current requirements."}</p>}
              {!module.businessServiceEnabled && <p className={styles.notice}>The business has not enabled {serviceLabel(module.serviceCategory)}. The owner must update Business settings before this work becomes eligible.</p>}
              {currentPass && module.completion && <p className={styles.reference}><strong>Learning completion reference</strong><code>{module.completion.reference}</code><small>Valid until {new Date(module.completion.expiresAt).toLocaleDateString("en-AU")}</small></p>}
            </li>;
          })}</ul>{!matching.length && <p className={styles.note}>No activity matches. Change the search or program.</p>}
          {totalPages > 1 && <nav className={styles.pagination} aria-label="Training to-do pages"><button type="button" className={styles.button} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage} of {totalPages}</span><button type="button" className={styles.button} disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}</>}
        {!modules.length && !unavailable.length && <p className={styles.note}>No government activity modules match the saved services and business service locations. Select and save the relevant services. An empty list does not approve government program work.</p>}
        {unavailable.filter(matches).map(item => <div key={item.id} className={styles.notice}><strong>{item.programCode} · {item.title}</strong><p>{item.message}</p></div>)}
        <p className={styles.note}>A training pass records learning only. Business setup, current insurance, licences and job evidence remain separate requirements.</p>
      </>}
    </>}
  </section>;
}
