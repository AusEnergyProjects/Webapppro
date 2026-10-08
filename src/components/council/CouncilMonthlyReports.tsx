"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import type { CouncilApi } from "@/components/CouncilPortal";
import type { CouncilProfile } from "@/lib/council-profile";
import { parseCouncilMonthlySettings, type CouncilMonthlySettings } from "@/lib/council-monthly-report";
import { CouncilIcon, CouncilPanel, councilDateTime } from "./CouncilPrimitives";
import styles from "./CouncilMonthlyReports.module.css";

export function CouncilMonthlyReports({ profile, demonstration, user, api, canManage }: {
  profile: CouncilProfile; demonstration: boolean; user: User | null; api?: CouncilApi; canManage: boolean;
}) {
  const [settings, setSettings] = useState<CouncilMonthlySettings | null>(null);
  const [enabled, setEnabled] = useState(false), [recipients, setRecipients] = useState("");
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(!demonstration);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const mounted = useRef(true);
  const identity = `${user?.uid ?? "demo"}:${profile.councilId}:${profile.postcodes.join(",")}`;
  const currentIdentity = useRef(identity);
  useEffect(() => { currentIdentity.current = identity; }, [identity]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (demonstration || !api) return;
    let active = true;
    void api<{ settings: CouncilMonthlySettings }>(`/api/council/monthly-report?councilId=${encodeURIComponent(profile.councilId)}`).then(result => {
      if (!active) return;
      setSettings(result.settings); setEnabled(result.settings.enabled); setRecipients(result.settings.recipients.join("\n")); setError("");
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Report settings could not be loaded."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, demonstration, identity, profile.councilId]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!api || demonstration || !canManage || !settings?.canManage || busy) return;
    const actor = identity; setError(""); setNotice(""); setBusy(true);
    try {
      const input = parseCouncilMonthlySettings({ enabled, recipients: recipients.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean) });
      const result = await api<{ settings: CouncilMonthlySettings }>(`/api/council/monthly-report?councilId=${encodeURIComponent(profile.councilId)}`, { method: "PATCH", body: JSON.stringify(input) });
      if (!mounted.current || currentIdentity.current !== actor) return;
      setSettings(result.settings); setEnabled(result.settings.enabled); setRecipients(result.settings.recipients.join("\n"));
      setNotice(input.enabled ? "Monthly reports enabled. Recipient changes apply to future editions; removed recipients stop receiving queued copies." : "Monthly reports paused. Pending emails will not be sent.");
    } catch (reason) { if (mounted.current && currentIdentity.current === actor) setError(reason instanceof Error ? reason.message : "Settings could not be saved."); }
    finally { if (mounted.current && currentIdentity.current === actor) setBusy(false); }
  }
  async function download(previousId?: string) {
    if (busy) return;
    const actor = identity; setBusy(true); setError(""); setNotice("");
    try {
      const path = demonstration ? "/api/council/report-pdf?demonstration=seccca" : previousId
        ? `/api/council/monthly-report?councilId=${encodeURIComponent(profile.councilId)}&download=${encodeURIComponent(previousId)}`
        : `/api/council/report-pdf?councilId=${encodeURIComponent(profile.councilId)}`;
      const headers = new Headers();
      if (!demonstration) {
        const activeUser = firebaseAuth.currentUser;
        if (!activeUser || activeUser.uid !== user?.uid) throw new Error("Sign in to your council account to download a report.");
        headers.set("Authorization", `Bearer ${await activeUser.getIdToken()}`);
      }
      const response = await fetch(path, { headers, cache: "no-store" });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || "The PDF could not be prepared."); }
      if (!response.headers.get("content-type")?.includes("application/pdf")) throw new Error("The report response was not a PDF.");
      const blob = await response.blob();
      if (!mounted.current || currentIdentity.current !== actor || (!demonstration && firebaseAuth.currentUser?.uid !== user?.uid)) return;
      const href = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = href; link.download = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "council-energy-progress.pdf";
      link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
      setNotice(demonstration ? "SECCCA demonstration PDF downloaded. Official source data is real; TLink outcomes are sample data." : "Council energy progress PDF downloaded.");
    } catch (reason) { if (mounted.current && currentIdentity.current === actor) setError(reason instanceof Error ? reason.message : "The PDF could not be downloaded."); }
    finally { if (mounted.current && currentIdentity.current === actor) setBusy(false); }
  }
  return <CouncilPanel title="Your council energy report" subtitle="A branded PDF with official community data, available business/residential activity and separate TLink participation.">
    <div className={styles.intro}><div><span className={styles.tag}>Ready to share</span><p>CER solar and storage figures, official VEU business and residential upgrades, postcode activity and clear reporting notes in one document.</p><small>CER covers the latest 12 published months. VEU and TLink cover the current calendar year. Source dates and unavailable figures are shown in the report.</small></div><button type="button" disabled={busy} className={styles.primary} onClick={() => void download()}><CouncilIcon name="download" size={18}/>{busy ? "Preparing…" : demonstration ? "Download SECCCA sample" : "Download current PDF"}</button></div>
    {demonstration ? <p className={styles.hint}>Demonstration only. No council affiliation or endorsement. Monthly emails are not enabled here. Sign in to an approved council workspace to nominate recipients.</p> : loading ? <p role="status">Loading monthly report settings…</p> : settings && <form className={styles.form} onSubmit={event => void save(event)}>
      <div><h3>Monthly delivery</h3><p>The source check runs daily. A report becomes eligible 24 hours after a new CER publication date is first detected. Each council receives one edition for that source date; source revisions are not extra emails.</p></div>
      <label className={styles.toggle}><input type="checkbox" checked={enabled} disabled={!canManage || !settings.canManage || busy} onChange={event => setEnabled(event.target.checked)}/>Email my council&apos;s monthly report</label>
      {canManage && settings.canManage ? <><label>Recipients<textarea rows={3} value={recipients} onChange={event => setRecipients(event.target.value)} disabled={busy} placeholder="sustainability@yourcouncil.vic.gov.au"/></label><small>Up to 10 addresses, one per line. Added recipients receive future editions. Removing a recipient or pausing delivery stops pending copies.</small><button type="submit" className={styles.primary} disabled={busy || (enabled && !settings.emailConfigured)}>Save monthly delivery</button></> : <p className={styles.hint}>A council owner or editor manages recipients. You can download the council report.</p>}
      {!settings.emailConfigured && <p className={styles.hint}>Email delivery is not configured for this site. Reports can be downloaded while setup is completed.</p>}
      {settings.latestSourceAsOf && <p className={styles.hint}>Latest detected CER edition: {settings.latestSourceAsOf}{settings.nextEligibleAt ? ` · Eligible ${councilDateTime(settings.nextEligibleAt)}` : ""}</p>}
      {settings.lastReport && <div className={styles.last}><span>Last edition: {settings.lastReport.sourceAsOf} · {settings.lastReport.acceptedRecipients}/{settings.lastReport.totalRecipients} emails accepted by the provider · {settings.lastReport.status}</span><button type="button" disabled={busy} onClick={() => void download(settings.lastReport!.id)}>Download saved edition</button></div>}
    </form>}
    {error && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status" className={styles.notice}>{notice}</p>}
  </CouncilPanel>;
}
