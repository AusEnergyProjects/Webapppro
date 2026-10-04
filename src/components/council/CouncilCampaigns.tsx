"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import type { CouncilCampaign, CouncilCampaignInput } from "@/lib/council-campaigns";
import type { CouncilReport } from "@/lib/council-reporting";
import { CouncilAttribution } from "./CouncilAnalytics";
import { CouncilEmpty, CouncilIcon, CouncilPanel, CouncilPill, councilDateTime, councilNumber } from "./CouncilPrimitives";
import styles from "./CouncilWorkspace.module.css";

export type CouncilSaveCampaign = (input: CouncilCampaignInput, id?: string, status?: CouncilCampaign["status"]) => Promise<void>;
const subscribeToBrowserTimeZone = () => () => {};
const getBrowserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const getServerTimeZone = () => null;

function localDateTime(iso: string | null) {
  if (!iso) return "";
  const value = new Date(iso);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}T${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

export function CouncilCampaigns({ report, campaigns, sessions = false, initiallyCreate = false, canManage, onSaveCampaign }: { report: CouncilReport; campaigns: CouncilCampaign[]; sessions?: boolean; initiallyCreate?: boolean; canManage: boolean; onSaveCampaign: CouncilSaveCampaign }) {
  const [editor, setEditor] = useState<CouncilCampaign | "new" | null>(initiallyCreate ? "new" : null);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const filtered = campaigns.filter(item => item.kind === (sessions ? "session" : "campaign"));
  const demo = report.mode === "demonstration";
  async function copyLink(campaign: CouncilCampaign) {
    setError("");
    try { await navigator.clipboard.writeText(new URL(campaign.shareUrl, window.location.origin).href); setCopied(campaign.id); }
    catch { setError("Your browser could not copy the link. Select and copy the address shown on the card."); }
  }
  return <>
    <div className={styles.subheading}><div><h2>{sessions ? "Bring your community on board" : "Create the next wave of local upgrades"}</h2><p>{sessions ? "Plan online or in-person information sessions, with a council reference attached." : "Give every council promotion a dedicated link and a traceable enquiry pathway."}</p></div>{canManage && <button className={styles.primaryButton} type="button" onClick={() => setEditor("new")}><CouncilIcon name="plus" size={16} />{sessions ? "Plan a session" : "New campaign"}</button>}</div>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {editor && <CouncilCampaignEditor key={editor === "new" ? "new" : editor.id} campaign={editor === "new" ? undefined : editor} kind={sessions ? "session" : "campaign"} demo={demo} onCancel={() => setEditor(null)} onSave={async (input, id, status) => { await onSaveCampaign(input, id, status); setEditor(null); }} />}
    {filtered.length ? <div className={styles.campaignGrid}>{filtered.map(campaign => {
      const analytics = report.campaigns.find(row => row.id === campaign.id);
      const audience = { everyone: "Everyone", households: "Households", businesses: "Businesses", trades: "Trades" }[campaign.audience];
      return <article key={campaign.id} className={styles.campaignCard}><header><div><span className={styles.eyebrow}>{sessions ? "Information session" : "Council campaign"}</span><h3>{campaign.title}</h3></div><CouncilPill muted={campaign.status === "paused"}>{campaign.status === "active" ? "Active" : "Paused"}</CouncilPill></header>
        <p>{sessions && campaign.startsAt ? councilDateTime(campaign.startsAt, report.period.timeZone) : `For ${audience.toLowerCase()}`} {sessions && campaign.location ? ` · ${campaign.location}` : ""}</p>
        {sessions && <div className={styles.tags}><span>{audience}</span><span>{campaign.meetingUrl ? "Online session" : "In person"}</span></div>}
        <div className={styles.campaignStats}><div><strong>{councilNumber(analytics?.enquiries)}</strong><span>Referred enquiries</span></div><div><strong>{councilNumber(analytics?.completedJobs)}</strong><span>Completed upgrades</span></div></div>
        <div className={styles.linkBox}><code>{campaign.shareUrl}</code><button type="button" className={styles.iconButton} aria-label={`Copy ${campaign.title} link`} onClick={() => void copyLink(campaign)}><CouncilIcon name={copied === campaign.id ? "check" : "copy"} size={16} /></button></div>
        <div className={styles.panelFooter}><span className={styles.formHint}>Reference: <strong>{campaign.code}</strong>{copied === campaign.id && <span role="status"> · Link copied</span>}</span>{canManage && <button type="button" className={styles.textButton} onClick={() => setEditor(campaign)}>Edit {sessions ? "session" : "campaign"}<CouncilIcon name="arrow" size={14} /></button>}</div>
      </article>;
    })}</div> : <CouncilPanel title={sessions ? "Your session calendar" : "Your council campaigns"}><CouncilEmpty title={sessions ? "Make participation easier to understand" : "Start with one clear invitation"} icon={sessions ? "calendar" : "campaign"}>{sessions ? "Create an information session for customers, businesses or trades. Its referral link helps you follow enquiries from your promotion." : "Create a campaign, copy its link into your newsletter or social post, and follow the enquiries that carry your council reference."}</CouncilEmpty></CouncilPanel>}
    <div className={styles.subheading}><div><h2>{sessions ? "From participation to action" : "Council campaign outcomes"}</h2><p>All council promotions · {report.period.label.toLowerCase()}</p></div></div>
    <CouncilAttribution report={report} />
    {sessions && <div className={styles.insight}><CouncilIcon name="calendar" size={17} /><p>Session details and referral links are saved here. Organise invitations, meeting access and attendance through your existing channels. Enquiries measure follow-up activity, not session attendance.</p></div>}
  </>;
}

function CouncilCampaignEditor({ campaign, kind, demo, onCancel, onSave }: { campaign?: CouncilCampaign; kind: CouncilCampaign["kind"]; demo: boolean; onCancel: () => void; onSave: CouncilSaveCampaign }) {
  const browserTimeZone = useSyncExternalStore(subscribeToBrowserTimeZone, getBrowserTimeZone, getServerTimeZone);
  const [title, setTitle] = useState(campaign?.title || "");
  const [audience, setAudience] = useState<CouncilCampaign["audience"]>(campaign?.audience || "everyone");
  const [status, setStatus] = useState<CouncilCampaign["status"]>(campaign?.status || "active");
  const [startsAt, setStartsAt] = useState(localDateTime(campaign?.startsAt || null));
  const [location, setLocation] = useState(campaign?.location || "");
  const [meetingUrl, setMeetingUrl] = useState(campaign?.meetingUrl || "");
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    try { await onSave({ title: title.trim(), kind, audience, startsAt: startsAt ? new Date(startsAt).toISOString() : null, location: location.trim() || null, meetingUrl: meetingUrl.trim() || null }, campaign?.id, status); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Your changes could not be saved. Please try again."); }
    finally { setSaving(false); }
  }
  return <CouncilPanel title={`${campaign ? "Edit" : "Create"} ${kind === "session" ? "information session" : "council campaign"}`} subtitle={demo ? "Practice changes are saved in this browser. No real campaign is published." : "Every promotion receives its own council reference."} className={styles.editor}>
    <form className={styles.form} onSubmit={event => void submit(event)}>
      {error && <div className={styles.error} role="alert">{error}</div>}
      <div className={styles.formRow}><label>{kind === "session" ? "Session title" : "Campaign name"}<input autoFocus required minLength={3} maxLength={120} value={title} onChange={event => setTitle(event.target.value)} placeholder={kind === "session" ? "Getting started with home energy upgrades" : "Spring home upgrade program"} /></label><label>Who is it for?<select value={audience} onChange={event => { const value = event.target.value; if (value === "everyone" || value === "households" || value === "businesses" || value === "trades") setAudience(value); }}><option value="everyone">Everyone</option><option value="households">Households</option><option value="businesses">Businesses</option><option value="trades">Trades</option></select></label></div>
      {kind === "session" && <><div className={styles.formRow}><label>Date and time<input type="datetime-local" required value={startsAt} onChange={event => setStartsAt(event.target.value)} /><small>{browserTimeZone ? `Your browser time zone: ${browserTimeZone}` : "Enter the date and time in your browser's local time zone."}</small></label><label>Location<input maxLength={200} value={location} onChange={event => setLocation(event.target.value)} placeholder="Council offices, community hall or online" /></label></div><label>Online meeting URL (optional)<input type="url" value={meetingUrl} onChange={event => setMeetingUrl(event.target.value)} placeholder="https://" maxLength={1000} /><small>Add your existing meeting link. Creating a session does not create or send a meeting invitation.</small></label></>}
      {campaign && <label>Status<select value={status} onChange={event => setStatus(event.target.value === "paused" ? "paused" : "active")}><option value="active">Active</option><option value="paused">Paused</option></select><small>Paused promotions stop accepting new campaign attribution.</small></label>}
      <div className={styles.formActions}><button type="button" className={styles.secondaryButton} disabled={saving} onClick={onCancel}>Cancel</button><button type="submit" className={styles.primaryButton} disabled={saving}>{saving ? "Saving..." : demo ? "Keep for this demo" : campaign ? "Save changes" : kind === "session" ? "Create session" : "Create campaign"}</button></div>
    </form>
  </CouncilPanel>;
}
