"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { CouncilApi } from "./CouncilPortal";
import type { CouncilRole } from "@/lib/council-access-server";
import styles from "./CouncilPortal.module.css";

type CouncilMember = { id: string; email: string; displayName: string; role: CouncilRole; status: "active" | "suspended"; pending: boolean };
type CouncilRecord = {
  id: string; name: string; slug: string; state: string; status: "active" | "suspended";
  createdAt: string; updatedAt: string; postcodes: string[]; members: CouncilMember[];
  scopeRequests: { id: string; postcodes: string[]; status: "pending" | "approved" | "rejected"; createdAt: string }[];
};
type CouncilList = { ok: true; councils: CouncilRecord[] };
const STATES = ["VIC", "NSW", "ACT", "QLD", "SA", "WA", "TAS", "NT"];
const toPostcodes = (value: FormDataEntryValue | null) => [...new Set(String(value || "").split(/[\s,;]+/).filter(Boolean))];

function RoleOptions() {
  return <><option value="viewer">Viewer: reports only</option><option value="editor">Editor: reports and campaigns</option><option value="owner">Owner: council workspace</option></>;
}

export function CouncilAdministration({ api, email, onBack }: { api: CouncilApi; email: string; onBack: () => void }) {
  const [councils, setCouncils] = useState<CouncilRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const load = useCallback(async () => {
    const result = await api<CouncilList>("/api/admin/councils");
    setCouncils(result.councils);
  }, [api]);

  useEffect(() => {
    let active = true;
    api<CouncilList>("/api/admin/councils").then((result) => {
      if (active) setCouncils(result.councils);
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : "Council access could not be loaded.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api]);

  async function save(body: Record<string, unknown>, message: string) {
    if (busy) return false;
    setBusy(true); setError(""); setNotice("");
    let saved = false;
    try {
      await api("/api/admin/councils", { method: "POST", body: JSON.stringify(body) });
      saved = true;
      await load();
      setNotice(message);
      return true;
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "The request could not be completed.";
      setError(saved ? `Your change was saved, but the list could not be refreshed. Refresh the list before making another change. ${detail}` : detail);
      return false;
    } finally { setBusy(false); }
  }

  async function refresh() {
    setLoading(true); setError("");
    try { await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Council access could not be loaded."); }
    finally { setLoading(false); }
  }

  async function createCouncil(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const saved = await save({ action: "create", name, slug, state: fields.get("state"),
      postcodes: toPostcodes(fields.get("postcodes")), email: fields.get("email"), displayName: fields.get("displayName"), role: "owner",
    }, "Council created. The nominated owner can sign in with their verified email. Return to the workspace to refresh your own access.");
    if (saved) { form.reset(); setName(""); setSlug(""); setSlugEdited(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>, council: CouncilRecord, action: string, message: string, extra: Record<string, unknown> = {}) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void save({ action, councilId: council.id, ...Object.fromEntries(fields.entries()), ...extra,
      ...(action === "scope" ? { postcodes: toPostcodes(fields.get("postcodes")) } : {}),
    }, message);
  }

  return <section className={`${styles.entryPanel} ${styles.admin}`} aria-labelledby="council-administration-title">
    <span className={styles.eyebrow}>TLink council administration</span>
    <h1 id="council-administration-title">Council access</h1>
    <p>Create a council workspace, approve its reporting area and give the right people access.</p>
    <div className={styles.actions}>
      <button type="button" onClick={onBack} disabled={busy}>Back to council workspace</button>
      <button type="button" className={styles.secondary} onClick={() => void refresh()} disabled={busy || loading}>{loading ? "Loading councils..." : "Refresh list"}</button>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}

    <details className={styles.adminCard} open={!loading && councils.length === 0}>
      <summary>Create a council workspace</summary>
      <form className={styles.form} onSubmit={(event) => void createCouncil(event)}>
        <fieldset className={styles.form} disabled={busy} style={{ border: 0, margin: 0, padding: 0 }}>
          <label>Council name<input name="name" required minLength={2} maxLength={120} value={name} placeholder="e.g. City of Casey" onChange={(event) => {
            const value = event.target.value; setName(value);
            if (!slugEdited) setSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64));
          }} /></label>
          <label>Workspace URL name<input name="slug" required minLength={3} maxLength={64} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} onChange={(event) => { setSlug(event.target.value.toLowerCase()); setSlugEdited(true); }} placeholder="city-of-casey" /></label>
          <label>State or territory<select name="state" defaultValue="VIC">{STATES.map((state) => <option key={state}>{state}</option>)}</select></label>
          <label>Approved reporting postcodes<textarea name="postcodes" rows={2} required placeholder="3805, 3806, 3977" aria-describedby="council-postcode-help" /></label>
          <p id="council-postcode-help" className={styles.fine}>Separate postcodes with commas or spaces. Include only the reporting area agreed with the council. Postcodes can cross council boundaries.</p>
          <label>Initial owner email<input type="email" name="email" defaultValue={email} required maxLength={254} autoComplete="email" /></label>
          <label>Owner name <span>(optional)</span><input name="displayName" maxLength={120} autoComplete="name" /></label>
          <p className={styles.fine}>Your email is filled in so you can open the workspace immediately. This creates an approved invitation; it does not send an email or grant trade or platform administration access.</p>
          <button type="submit">{busy ? "Saving..." : "Create council workspace"}</button>
        </fieldset>
      </form>
    </details>

    {loading && <p role="status">Loading approved councils...</p>}
    {!loading && !councils.length && !error && <p>No councils have been created yet.</p>}
    <div className={styles.adminList} aria-busy={busy || loading}>
      {councils.map((council) => <article className={styles.adminCard} key={council.id} aria-labelledby={`council-${council.id}`}>
        <h2 id={`council-${council.id}`}>{council.name}</h2>
        <p>{council.state} · {council.status === "active" ? "Active workspace" : "Workspace suspended"} · {council.members.filter((member) => member.status === "active").length} active members</p>
        <p className={styles.fine}>Approved postcodes: {council.postcodes.length ? council.postcodes.join(", ") : "None approved"}</p>
        {council.scopeRequests.filter((request) => request.status === "pending").map((request) => <div className={styles.notice} key={request.id}>
          <strong>Postcodes awaiting approval</strong><p>{request.postcodes.join(", ")}</p>
          <button type="button" disabled={busy} onClick={() => void save({ action: "scope", councilId: council.id,
            postcodes: [...new Set([...council.postcodes, ...request.postcodes])].sort(), requestId: request.id,
          }, `Reporting postcodes approved for ${council.name}.`)}>Approve requested postcodes</button>
        </div>)}

        <details><summary>Members and invitations</summary>
          {council.members.map((member) => <form className={`${styles.form} ${styles.member}`} key={`${member.id}-${member.role}-${member.status}`} onSubmit={(event) => submit(event, council, "member", `Access updated for ${member.email}.`, { membershipId: member.id })}>
            <p><strong>{member.displayName || member.email}</strong>{member.displayName && <><br />{member.email}</>}<br /><span className={styles.fine}>{member.pending ? "Invitation awaiting verified sign-in" : "Invitation accepted"}</span></p>
            <label>Role for {member.email}<select name="role" defaultValue={member.role} disabled={busy}><RoleOptions /></select></label>
            <label>Access for {member.email}<select name="status" defaultValue={member.status} disabled={busy}><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
            <button type="submit" disabled={busy}>Save member access</button>
          </form>)}
          <form className={styles.form} onSubmit={(event) => submit(event, council, "invite", "Invitation approved. The member can now sign in with that verified email. No email was sent.")}>
            <fieldset className={styles.form} disabled={busy} style={{ border: 0, margin: 0, padding: 0 }}>
              <label>New member email<input name="email" type="email" required maxLength={254} /></label>
              <label>Member name <span>(optional)</span><input name="displayName" maxLength={120} /></label>
              <label>Access level<select name="role" defaultValue="viewer"><RoleOptions /></select></label>
              <button type="submit">Approve member invitation</button>
            </fieldset>
          </form>
        </details>

        <details><summary>Reporting area and organisation settings</summary>
          <form className={styles.form} key={`${council.id}-${council.postcodes.join(",")}`} onSubmit={(event) => submit(event, council, "scope", `Reporting area updated for ${council.name}.`)}>
            <label>Approved {council.state} postcodes<textarea name="postcodes" rows={2} defaultValue={council.postcodes.join(", ")} disabled={busy} /></label>
            <p className={styles.fine}>Saving replaces the current approved area. Leaving this blank removes access to postcode reporting.</p>
            <button type="submit" disabled={busy}>Save approved reporting area</button>
          </form>
          <form className={styles.form} key={council.updatedAt} onSubmit={(event) => submit(event, council, "update", `Organisation settings updated for ${council.name}.`)}>
            <label>Council name<input name="name" defaultValue={council.name} required minLength={2} maxLength={120} disabled={busy} /></label>
            <label>Workspace access<select name="status" defaultValue={council.status} disabled={busy}><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
            <p className={styles.fine}>Suspending a workspace stops council member access and its public campaign links.</p>
            <button type="submit" disabled={busy}>Save organisation settings</button>
          </form>
        </details>
      </article>)}
    </div>
  </section>;
}
