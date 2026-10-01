"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { useTradeBusinessFetch } from "./TradeBusinessProvider";
import styles from "./TradeTeamSettings.module.css";

type Crew = { id: string; name: string; companyName: string; leadMemberId: string; revision: number; memberIds: string[] };
type CrewPerson = { id: string; displayName: string; status: string; crewId: string };
type Result = { ok: boolean; error?: string; isOwner: boolean; crews: Crew[]; members: CrewPerson[] };

export function TradeCrewWorkspace({ user }: { user: User }) {
  const fetch = useTradeBusinessFetch();
  const [data, setData] = useState<Result | null>(null);
  const [editing, setEditing] = useState<Crew | "new" | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [lead, setLead] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void user.getIdToken()
      .then(token => fetch("/api/trade-crews", { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } }))
      .then(async response => {
        const result: Result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Crews could not be loaded.");
        return result;
      })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Crews could not be loaded."); });
    return () => controller.abort();
  }, [fetch, user]);
  function open(crew: Crew | "new") { setEditing(crew); setSelected(crew === "new" ? [] : crew.memberIds.filter(id => data?.members.some(person => person.id === id && person.status === "active"))); setLead(crew === "new" || !data?.members.some(person => person.id === crew.leadMemberId && person.status === "active") ? "" : crew.leadMemberId); setError(""); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return;
    const form = new FormData(event.currentTarget); setBusy(true); setError("");
    try {
      const response = await fetch("/api/trade-crews", { method: "POST", headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...(editing === "new" ? {} : { id: editing.id, revision: editing.revision }), name: form.get("name"), companyName: form.get("companyName"), leadMemberId: lead, memberIds: selected }) });
      const result: Result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "The crew could not be saved.");
      setData(result); setEditing(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The crew could not be saved."); }
    finally { setBusy(false); }
  }
  return <section className={styles.list} aria-label="Crews">
    <header className={styles.listHeader}><div><strong>{data?.isOwner ? "Crews and subcontractors" : "My crew"}</strong><p>People are grouped within this business. Each person keeps their own job assignments and training.</p></div>
      {data?.isOwner && !editing && <button type="button" className={styles.primary} onClick={() => open("new")}>Add crew</button>}</header>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!data && !error && <p role="status">Loading crews...</p>}
    {editing && <form className={styles.crewEditor} onSubmit={save}>
      <h5>{editing === "new" ? "Add crew" : "Edit crew"}</h5>
      <div className={styles.grid}><label>Crew name<input name="name" required maxLength={120} defaultValue={editing === "new" ? "" : editing.name} /></label>
        <label>Subcontractor company, optional<input name="companyName" maxLength={180} defaultValue={editing === "new" ? "" : editing.companyName} /></label></div>
      <p className={styles.hint}>Crew access is limited to assigned work. Adding a person removes whole-business, customer directory, finance and team administration access. A lead can assign or reschedule crew work only when those permissions are enabled in their person details.</p>
      <fieldset className={styles.permissionGroup}><legend>People in this crew</legend><div className={styles.grid}>
        {data?.members.filter(person => person.status === "active" && (!person.crewId || (editing !== "new" && person.crewId === editing.id))).map(person => <label className={styles.check} key={person.id}>
          <input type="checkbox" checked={selected.includes(person.id)} disabled={busy} onChange={event => {
            setSelected(current => event.target.checked ? [...current, person.id] : current.filter(id => id !== person.id));
            if (!event.target.checked && lead === person.id) setLead("");
          }} /><span>{person.displayName}</span></label>)}
      </div></fieldset>
      <label>Crew lead<select required value={lead} disabled={busy} onChange={event => setLead(event.target.value)}><option value="">Choose a person in this crew</option>{data?.members.filter(person => selected.includes(person.id)).map(person => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>
      <p className={styles.hint}>The lead can view this crew&apos;s assigned jobs and schedule. Other members see their own assigned work. The business owner keeps full visibility.</p>
      <div className={styles.actions}><button className={styles.primary} disabled={busy || !lead}>{busy ? "Saving..." : "Save crew"}</button><button type="button" className={styles.secondary} disabled={busy} onClick={() => setEditing(null)}>Cancel</button></div>
    </form>}
    {!editing && data && <div className={styles.crewList}>{data.crews.map(crew => <article className={styles.crewCard} key={crew.id}>
      <header><div><strong>{crew.name}</strong>{crew.companyName && <p>{crew.companyName}</p>}</div>{data.isOwner && <button type="button" className={styles.secondary} onClick={() => open(crew)}>Edit crew</button>}</header>
      <ul>{data.members.filter(person => person.crewId === crew.id).map(person => <li key={person.id}>{person.displayName}{person.id === crew.leadMemberId ? " · Lead" : ""}{person.status !== "active" ? " · Inactive" : ""}</li>)}</ul>
    </article>)}{!data.crews.length && <p className={styles.empty}>No crews have been added.</p>}</div>}
  </section>;
}
