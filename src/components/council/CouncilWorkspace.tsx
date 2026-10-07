"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import NextImage from "next/image";
import type { CouncilCampaign } from "@/lib/council-campaigns";
import type { CouncilProfile, CouncilProfileInput } from "@/lib/council-profile";
import type { CouncilPeriodKey, CouncilReport } from "@/lib/council-reporting";
import { councilThemeVariables } from "@/lib/council-theme";
import { readTLinkColourMode, TLINK_COLOUR_MODE_STORAGE_KEY, writeTLinkColourMode, type TLinkColourMode } from "@/lib/trade-device-client";
import { TLinkMark } from "../TLinkChrome";
import { CouncilActivities, CouncilAttribution, CouncilEnquiries, CouncilLocalShare, CouncilPostcodes, CouncilReports, CouncilSummary, CouncilTrend } from "./CouncilAnalytics";
import { CouncilCampaigns, type CouncilSaveCampaign } from "./CouncilCampaigns";
import { CouncilIcon, CouncilPanel, type CouncilIconName, councilDateTime, councilNumber } from "./CouncilPrimitives";
import { CouncilProfileSettings } from "./CouncilProfileSettings";
import styles from "./CouncilWorkspace.module.css";
import type { User } from "firebase/auth";
import { TLinkWorkspaceBar } from "../TLinkWorkspaceBar";
import { WattzunToolsWorkspace } from "../WattzunToolsWorkspace";
import { TLinkNavigationIcon } from "../TLinkNavigationIcon";
import { councilWorkspaceFromSearch, councilWorkspaceSearch, type CouncilWorkspaceView as CouncilView } from "@/lib/council-workspace-navigation";
import { requestWattzunAssistant } from "@/lib/wattzun-appearance";

const navigation: Array<{ id: CouncilView; label: string; icon: CouncilIconName }> = [
  { id: "overview", label: "Overview", icon: "overview" }, { id: "community", label: "Community progress", icon: "community" }, { id: "map", label: "Community map", icon: "map" }, { id: "calculator", label: "Rebate calculator", icon: "calculator" }, { id: "activities", label: "Upgrade activity", icon: "activity" }, { id: "economy", label: "Local economy", icon: "business" }, { id: "campaigns", label: "Campaigns", icon: "campaign" }, { id: "sessions", label: "Information sessions", icon: "calendar" }, { id: "reports", label: "Reports & insights", icon: "report" }, { id: "settings", label: "Council profile", icon: "settings" }, { id: "team", label: "Council team", icon: "users" },
];
const headings: Record<CouncilView, { title: string; description: string; eyebrow: string }> = {
  wattzun: { title: "Wattzun", description: "Your council assistant, usage and preferences.", eyebrow: "Tools" },
  community: { title: "Your community is moving forward.", description: "Explore official energy upgrade and installation data across your council's postcodes.", eyebrow: "Community progress" },
  team: { title: "Bring your team together.", description: "Give colleagues the access they need to coordinate programs and report progress.", eyebrow: "Council team" },
  overview: { title: "Local action. Lasting impact.", description: "A clear view of community upgrades, local opportunity and your council's contribution.", eyebrow: "Your impact at a glance" },
  map: { title: "Your community, in view.", description: "Explore protected activity totals and local participation across your approved area.", eyebrow: "Community map" },
  calculator: { title: "Make upgrades easier to explore.", description: "Explore supported rebate calculations and the inputs behind each estimate.", eyebrow: "Rebate calculator" },
  activities: { title: "See what is changing.", description: "Understand which upgrades your community is completing and the outcomes behind them.", eyebrow: "Upgrade activity" },
  economy: { title: "More opportunity, closer to home.", description: "See where work is happening and how much is being delivered by local businesses.", eyebrow: "Local economic participation" },
  campaigns: { title: "Turn awareness into action.", description: "Promote useful programs and connect your council's outreach to recorded outcomes.", eyebrow: "Council campaigns" },
  sessions: { title: "Help your community take part.", description: "Bring customers, businesses and trades together, online or in person.", eyebrow: "Information sessions" },
  reports: { title: "A clearer story to share.", description: "Bring your reporting figures, their coverage and their calculation basis into one place.", eyebrow: "Reports & insights" },
  settings: { title: "Your council. Your workspace.", description: "Set your identity, reporting postcodes and colours in one place.", eyebrow: "Council profile" },
};

export type CouncilWorkspaceProps = {
  portalUser?: User | null;
  workspaceActions?: ReactNode;
  report: CouncilReport;
  profile: CouncilProfile;
  campaigns: CouncilCampaign[];
  loading?: boolean;
  error?: string;
  notice?: string;
  canManage: boolean;
  onPeriodChange: (period: CouncilPeriodKey) => void;
  onRefresh: () => void;
  onSignOut?: () => void;
  onSaveCampaign: CouncilSaveCampaign;
  onSaveProfile: (input: CouncilProfileInput) => Promise<void>;
  onExport: () => void;
  onExitDemo?: () => void;
  mapSlot?: ReactNode;
  calculatorSlot?: ReactNode;
  onResetDemo?: () => void;
  communitySlot?: ReactNode;
  communitySummarySlot?: ReactNode;
  teamSlot?: ReactNode;
};

export function CouncilWorkspace({ report, profile, campaigns, loading = false, error, notice, canManage, onPeriodChange, onRefresh, onSignOut, onSaveCampaign, onSaveProfile, onExport, onExitDemo, mapSlot, calculatorSlot, onResetDemo, communitySlot, communitySummarySlot, teamSlot, portalUser = null, workspaceActions }: CouncilWorkspaceProps) {
  const [view, setView] = useState<CouncilView>("overview");
  const [createOnOpen, setCreateOnOpen] = useState(false);
  const [colourMode, setColourMode] = useState<TLinkColourMode>("day");
  const [profileDraft, setProfileDraft] = useState<CouncilProfileInput | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const activeHeading = headings[view];
  const demo = report.mode === "demonstration";
  const communityAvailable = Boolean(communitySlot), mapAvailable = Boolean(mapSlot), calculatorAvailable = Boolean(calculatorSlot), teamAvailable = Boolean(teamSlot);
  const wattzunAvailable = !demo && Boolean(portalUser);
  const identity = profileDraft ?? profile;
  const savedInput: CouncilProfileInput = { name: profile.name, postcodes: profile.postcodes, logoDataUrl: profile.logoDataUrl, theme: profile.theme };
  const profileDirty = profileDraft !== null && JSON.stringify(profileDraft) !== JSON.stringify(savedInput);
  const initials = identity.name.split(" ").filter(Boolean).slice(0, 2).map(word => word[0]).join("") || "C";
  const themeVariables = councilThemeVariables(identity.theme, colourMode);
  async function saveProfile(input: CouncilProfileInput) { await onSaveProfile(input); setProfileDraft(null); }
  useEffect(() => {
    const sync = () => {
      const params = new URLSearchParams(window.location.search);
      const reference = params.getAll("campaign").length === 1 ? params.get("campaign") : null;
      const linkedCampaign = demo && !params.has("workspace") && reference ? campaigns.find(campaign => campaign.id === reference) : null;
      setView(linkedCampaign ? linkedCampaign.kind === "session" ? "sessions" : "campaigns" : councilWorkspaceFromSearch(window.location.search, {
        community: communityAvailable, map: mapAvailable, calculator: calculatorAvailable, team: teamAvailable, wattzun: wattzunAvailable,
      }));
    };
    const frame = requestAnimationFrame(sync);
    window.addEventListener("popstate", sync);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("popstate", sync); };
  }, [communityAvailable, mapAvailable, calculatorAvailable, teamAvailable, wattzunAvailable, campaigns, demo]);
  useEffect(() => {
    const syncStoredMode = () => { try { setColourMode(readTLinkColourMode(window.localStorage)); } catch { setColourMode("day"); } };
    const frame = requestAnimationFrame(syncStoredMode);
    const syncAcrossTabs = (event: StorageEvent) => { if (event.key === TLINK_COLOUR_MODE_STORAGE_KEY || event.key === null) syncStoredMode(); };
    window.addEventListener("storage", syncAcrossTabs);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("storage", syncAcrossTabs); };
  }, []);
  function toggleColourMode() {
    const next = colourMode === "day" ? "night" : "day";
    setColourMode(next);
    try { writeTLinkColourMode(window.localStorage, next); } catch { /* The current tab still changes mode when browser storage is unavailable. */ }
  }
  function navigate(next: CouncilView, create = false) {
    setCreateOnOpen(create); setView(next);
    window.history.pushState(window.history.state, "", `${window.location.pathname}${councilWorkspaceSearch(window.location.search, next)}${window.location.hash}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    requestAnimationFrame(() => { window.scrollTo({ top: 0, behavior: "instant" }); headingRef.current?.focus({ preventScroll: true }); });
  }
  function askWattzun() {
    if (!portalUser || demo || profile.councilId !== report.scope.councilId) return;
    void requestWattzunAssistant({ userUid: portalUser.uid, portal: "council", scopeId: report.scope.councilId, mode: "message",
      workReference: { kind: "council_report", period: report.period.key }, initialMessage: "Explain this report, its coverage and the main next steps." });
  }
  return <div className={styles.workspace} data-colour-mode={colourMode} style={{ ...themeVariables, color: "var(--c-ink)" }}>
    <TLinkWorkspaceBar current="council" user={portalUser} organisation={identity.name || "Your council"} displayName={portalUser?.displayName?.trim().split(/\s+/)[0]} actions={workspaceActions} onBeforeSwitch={() => !profileDirty || window.confirm("Leave without saving your council profile changes?")} />
    <aside className={styles.sidebar}><div className={styles.brand}><TLinkMark className={styles.brandMark} size={42} /><div><strong>TLink</strong><small>Council workspace</small></div></div><p className={styles.navCaption}>Community impact</p><nav className={styles.nav} aria-label="Council workspace">{navigation.filter(item => (item.id !== "map" || mapSlot) && (item.id !== "calculator" || calculatorSlot) && (item.id !== "community" || communitySlot) && (item.id !== "team" || teamSlot)).map(item => <button type="button" key={item.id} onClick={() => navigate(item.id)} aria-current={view === item.id ? "page" : undefined}><CouncilIcon name={item.icon} size={18} />{item.label}</button>)}</nav>{!demo && portalUser && <><p className={styles.navCaption}>Tools</p><nav className={styles.nav} aria-label="Council tools"><button type="button" onClick={() => navigate("wattzun")} aria-current={view === "wattzun" ? "page" : undefined}><TLinkNavigationIcon name="wattzun" />Wattzun</button></nav></>}<div className={styles.sidebarBottom}><div className={styles.privacyBadge}><CouncilIcon name="shield" size={19} /><div><strong>Private by design</strong>Local insights.<br />Customer details stay private.</div></div><p className={styles.poweredBy}>TLink Council<br />Community impact workspace</p></div></aside>
    <div className={styles.main}>
      <header className={styles.topbar}><div className={styles.councilIdentity}><span className={styles.councilMonogram}>{identity.logoDataUrl ? <NextImage unoptimized src={identity.logoDataUrl} alt={`${identity.name} logo`} width={40} height={40} /> : initials}</span><div><strong>{identity.name || "Your council"}</strong><small>{profile.state} · {profileDraft ? identity.postcodes.length : report.scope.postcodes.length} reporting postcodes{profileDirty ? " · Preview" : ""}</small></div></div><div className={styles.topbarTools}><span>{demo ? "TLink Council demonstration" : "TLink Council"}</span><button type="button" className={styles.colourModeToggle} aria-label="Night mode" aria-pressed={colourMode === "night"} title={colourMode === "night" ? "Switch to day mode" : "Switch to night mode"} onClick={toggleColourMode}><span className={colourMode === "day" ? styles.modeActive : undefined} aria-hidden="true"><CouncilIcon name="sun" size={16} /></span><span className={colourMode === "night" ? styles.modeActive : undefined} aria-hidden="true"><CouncilIcon name="moon" size={16} /></span></button><button type="button" className={styles.iconButton} onClick={onRefresh} disabled={loading} aria-label="Refresh council report"><CouncilIcon name="refresh" size={17} /></button>{onSignOut && <button type="button" className={styles.iconButton} onClick={onSignOut} aria-label="Sign out"><CouncilIcon name="logout" size={17} /></button>}</div></header>
      {demo && <div className={styles.demoBanner}><div><strong>Explore TLink Council</strong>Official public community data alongside clearly labelled sample TLink outcomes. Profile and campaign changes are saved only in this browser.</div>{onExitDemo ? <button type="button" className={styles.textButton} onClick={onExitDemo}>Exit demo</button> : <a href="/council">Council sign in</a>}</div>}
      <main className={styles.content} id="site-content">
        {profileDirty && view !== "settings" && <div className={styles.previewBanner}><span>Previewing your council profile. Changes are not saved yet.</span><div><button type="button" onClick={() => navigate("settings")}>Review and save</button><button type="button" onClick={() => setProfileDraft(null)}>Cancel preview</button></div></div>}
        {view !== "wattzun" && <div className={styles.heading}><div><span className={styles.eyebrow}>{activeHeading.eyebrow}</span><h1 ref={headingRef} tabIndex={-1}>{activeHeading.title}</h1><p>{activeHeading.description}</p></div><div className={styles.actions}><button type="button" className={styles.secondaryButton} onClick={onExport} disabled={loading || Boolean(error)}><CouncilIcon name="download" size={16} />Export TLink report</button>{view === "overview" && canManage && <button type="button" className={styles.primaryButton} onClick={() => navigate("campaigns", true)}><CouncilIcon name="plus" size={16} />Create a campaign</button>}</div></div>}
        {!["settings", "calculator", "team", "community", "wattzun"].includes(view) && <div className={styles.filters}><div className={styles.filterFields}><label><CouncilIcon name="calendar" size={15} /><span>TLink period</span><select value={report.period.key} disabled={loading} onChange={event => { const period = event.target.value; if (period === "quarter" || period === "year" || period === "all") onPeriodChange(period); }} aria-label="Reporting period"><option value="quarter">This quarter</option><option value="year">This year</option><option value="all">All time</option></select></label><span className={styles.areaFilter}><CouncilIcon name="map" size={15} />All approved postcodes</span></div><span className={styles.filterNote}>{demo ? "Illustrative outcomes" : "Recorded TLink activity"}</span></div>}
        {notice && <div className={styles.notice} role="status">{notice}</div>}
        {loading && <div className={styles.notice} role="status">Updating your council workspace...</div>}
        {error && <div className={styles.error} role="alert">{error} <button type="button" className={styles.textButton} onClick={onRefresh}>Try again</button></div>}
        {!loading && !error && <>
          {view === "wattzun" && !demo && portalUser && <WattzunToolsWorkspace user={portalUser} portal="council" scopeId={profile.councilId} />}
          {report.dataQuality.suppressed && !["settings", "calculator", "team", "community", "wattzun"].includes(view) && <div className={styles.notice}><CouncilIcon name="shield" size={16} /> Some figures are withheld to protect small customer groups. Reports explains the privacy rules.</div>}
          {view === "overview" && <>{communitySummarySlot}<CouncilQuickActions mapAvailable={Boolean(mapSlot)} calculatorAvailable={Boolean(calculatorSlot)} canManage={canManage} onNavigate={navigate} /><div className={styles.subheading}><div><h2>{demo ? "Sample TLink participation" : "Your TLink participation"}</h2><p>Enquiries, local trades and completed work recorded in TLink.</p></div><button type="button" className={styles.textButton} onClick={() => navigate("community")}>Explore official community data <CouncilIcon name="arrow" size={15} /></button></div><CouncilSummary report={report} /><CouncilEnquiries report={report} /><div className={styles.twoColumns}><CouncilTrend report={report} /><CouncilActivities report={report} onExplore={() => navigate("activities")} /></div><div className={styles.twoColumns}><CouncilPostcodes report={report} /><CouncilLocalShare report={report} /></div><CouncilAttribution report={report} onExplore={() => navigate("campaigns")} /></>}
          {view === "activities" && <><CouncilSummary report={report} /><CouncilActivities report={report} detailed /><div className={styles.subheading}><div><h2>How impact is calculated</h2><p>Keep scheme activity and estimated emissions clearly separated.</p></div></div><details className={styles.methodology}><summary>Technical calculation basis</summary><div className={styles.evenColumns}><CouncilPanel title="Scheme activity" subtitle="Provider-accepted quantities for completed work"><div className={styles.certificateTotals}><div><span>Provider-accepted VEECs</span><strong>{councilNumber(report.metrics.veecQuantity)}</strong><small>VEECs</small></div><div><span>Provider-accepted STCs</span><strong>{councilNumber(report.metrics.stcQuantity)}</strong><small>STCs</small></div></div><p className={styles.formHint}>These are provider-accepted quantities, not registry-issued certificates. The two scheme units are reported separately and are never added together.</p></CouncilPanel><CouncilPanel title="An honest view of carbon outcomes" subtitle={report.dataQuality.missingCarbonMethod ? "Awaiting supported impact evidence" : "Estimates with a stated basis"}><p className={styles.formHint}>Deemed lifetime abatement is based on supported VEU evidence only. STCs are excluded. This is not annual measured emissions, and the same upgrade is never counted twice.</p><button type="button" className={styles.textButton} onClick={() => navigate("reports")}>Read the reporting methodology <CouncilIcon name="arrow" size={15} /></button></CouncilPanel></div></details></>}
          {view === "economy" && <><CouncilSummary report={report} /><div className={styles.twoColumns}><CouncilPostcodes report={report} /><CouncilLocalShare report={report} /></div><CouncilPanel title="Use participation to shape your next step" subtitle="A practical view of local opportunity"><div className={styles.opportunityGrid}><div><CouncilIcon name="business" size={23} /><h3>Grow local participation</h3><p>Use the local delivery split to identify where more local trades could get involved.</p><button type="button" className={styles.textButton} onClick={() => navigate("sessions")}>Plan a trade information session <CouncilIcon name="arrow" size={14} /></button></div><div><CouncilIcon name="campaign" size={23} /><h3>Focus your outreach</h3><p>Compare postcode activity, then promote a useful program to the community you want to reach.</p><button type="button" className={styles.textButton} onClick={() => navigate("campaigns")}>Open council campaigns <CouncilIcon name="arrow" size={14} /></button></div></div></CouncilPanel></>}
          {view === "campaigns" && <CouncilCampaigns key="campaigns" initiallyCreate={createOnOpen} report={report} campaigns={campaigns} canManage={canManage} onSaveCampaign={onSaveCampaign} />}
          {view === "sessions" && <CouncilCampaigns key="sessions" report={report} campaigns={campaigns} sessions canManage={canManage} onSaveCampaign={onSaveCampaign} />}
          {view === "map" && mapSlot}
          {view === "community" && communitySlot}
          {view === "team" && teamSlot}
          {view === "calculator" && calculatorSlot}
          {view === "reports" && <><div className={styles.actions}><button type="button" className={styles.secondaryButton} onClick={() => window.print()}>Print complete report</button></div>{communitySlot}<CouncilEnquiries report={report} /><CouncilReports report={report} onExport={onExport} onAskWattzun={wattzunAvailable && profile.councilId === report.scope.councilId ? askWattzun : undefined} /></>}
          {view === "settings" && <CouncilProfileSettings profile={profile} value={profileDraft ?? savedInput} canManage={canManage} dirty={profileDirty} demonstration={demo} onChange={setProfileDraft} onSave={saveProfile} onCancel={() => setProfileDraft(null)} onResetDemo={onResetDemo} />}
        </>}
        <footer className={styles.bottomNote}><span><CouncilIcon name="shield" size={13} />Aggregated insights. No private customer records.</span><span>{demo ? "Illustrative demonstration" : "TLink recorded activity"} · Updated {councilDateTime(report.generatedAt,report.period.timeZone)}</span></footer>
      </main>
    </div>
  </div>;
}

function CouncilQuickActions({ mapAvailable, calculatorAvailable, canManage, onNavigate }: { mapAvailable: boolean; calculatorAvailable: boolean; canManage: boolean; onNavigate: (view: CouncilView) => void }) {
  return <div className={styles.quickActions} aria-label="Explore your council workspace">
    {calculatorAvailable && <button type="button" className={styles.quickActionFeatured} onClick={() => onNavigate("calculator")}><span className={styles.quickActionIcon}><CouncilIcon name="overview" size={23} /></span><span><small>Rebate calculator</small><strong>Explore an upgrade</strong><span>See supported calculations and their inputs.</span></span><CouncilIcon name="arrow" size={20} /></button>}
    {mapAvailable && <button type="button" onClick={() => onNavigate("map")}><span className={styles.quickActionIcon}><CouncilIcon name="map" size={23} /></span><span><small>Community map</small><strong>See your local network</strong><span>Explore local trades and postcode activity.</span></span><CouncilIcon name="arrow" size={20} /></button>}
    <button type="button" onClick={() => onNavigate("settings")}><span className={styles.quickActionIcon}><CouncilIcon name="settings" size={23} /></span><span><small>Council profile</small><strong>{canManage ? "Make it your workspace" : "View your council profile"}</strong><span>Your identity, reporting area and colours.</span></span><CouncilIcon name="arrow" size={20} /></button>
  </div>;
}
