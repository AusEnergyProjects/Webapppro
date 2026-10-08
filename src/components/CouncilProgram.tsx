"use client";
import { useState } from "react";
import NextImage from "next/image";
import { councilReportPeriod } from "@/lib/council-reporting";
import { councilThemeVariables } from "@/lib/council-theme";
import { COUNCIL_DEFAULT_THEME } from "@/lib/council-profile";
import { PUBLIC_SITE } from "@/lib/public-site";
import type { CouncilPublicBranding } from "@/lib/council-public-branding";
import { QuickUpgradeEnquiryDialog } from "./QuickUpgradeEnquiryDialog";
import styles from "./CouncilProgram.module.css";

type PublicCampaign = {
  code: string; title: string; kind: "campaign" | "session"; audience: "everyone" | "households" | "businesses" | "trades";
  startsAt: string | null; location: string | null; meetingUrl: string | null;
  councilName: string; state: string; postcodes: string[];
  logoDataUrl?: string | null; primaryColor?: string; accentColor?: string; homeUrl?: string | null;
};

export function CouncilProgram({ campaign, unavailable = false, demonstration = false }: { campaign: PublicCampaign | null; unavailable?: boolean; demonstration?: boolean }) {
  const [enquiryOpen, setEnquiryOpen] = useState(false);
  const [sector, setSector] = useState<"residential" | "business">(campaign?.audience === "businesses" ? "business" : "residential");
  const theme = { primaryColor: campaign?.primaryColor || COUNCIL_DEFAULT_THEME.primaryColor, accentColor: campaign?.accentColor || COUNCIL_DEFAULT_THEME.accentColor };
  const branding: CouncilPublicBranding | undefined = campaign ? { councilName: campaign.councilName, logoDataUrl: campaign.logoDataUrl || null, homeUrl: campaign.homeUrl || null, theme } : undefined;
  const timeZone = campaign ? councilReportPeriod("year", campaign.state).timeZone : "Australia/Melbourne";
  const initials = campaign?.councilName.split(/\s+/).filter(word => !["city", "of", "council"].includes(word.toLowerCase())).slice(0, 2).map(word => word[0]).join("") || "C";
  return <main id="site-content" className={styles.page} style={councilThemeVariables(theme, "day")}>
    {demonstration && <div className={styles.demo} role="note"><strong>Customer journey demonstration</strong><span>Preview using City of Port Phillip. No enquiries are sent. This preview does not imply council endorsement.</span></div>}
    <header className={styles.header}><div className={styles.headerInner}>
      <div className={styles.identity}><span className={styles.logo}>{campaign?.logoDataUrl ? <NextImage unoptimized src={campaign.logoDataUrl} alt={`${campaign.councilName} logo`} width={64} height={64} /> : <span aria-hidden="true">{initials}</span>}</span><div><strong>{campaign?.councilName || "Local energy upgrades"}</strong><span>Energy upgrades for our community</span></div></div>
      {branding?.homeUrl && <a href={branding.homeUrl} className={styles.home}>Back to council website <span aria-hidden="true">↗</span></a>}
    </div></header>
    <div className={styles.content}>{campaign ? <>
      <section className={styles.hero}><div><span className={styles.eyebrow}>{campaign.kind === "session" ? "Community information session" : "Homes and local businesses"}</span><h1>{campaign.title}</h1><p className={styles.lead}>Explore practical energy upgrades. Tell us what you need, when you need it and how long you would like to receive quotes.</p>
        {campaign.kind === "session" && <div className={styles.session}><strong>{campaign.startsAt && new Date(campaign.startsAt).toLocaleString("en-AU", { dateStyle: "full", timeStyle: "short", timeZone })} ({timeZone})</strong>{campaign.location && <p>{campaign.location}</p>}{campaign.meetingUrl && <a href={campaign.meetingUrl} target="_blank" rel="noopener noreferrer">Join online session ↗</a>}</div>}
        <p className={styles.area}>Available in participating postcodes: <strong>{campaign.postcodes.join(", ") || "Area awaiting confirmation"}</strong></p>
      </div><aside className={styles.promise}><span className={styles.promiseIcon} aria-hidden="true">↗</span><h2>A simpler path to upgrades</h2><ol><li>Choose the work you are considering.</li><li>Set your completion timeframe.</li><li>Hear from matching providers while your enquiry is open.</li></ol><p>You choose the contact details shared with providers.</p></aside></section>
      {campaign.audience !== "trades" && <section className={styles.start} aria-labelledby="journey-title"><div className={styles.startHeading}><h2 id="journey-title">What would you like to upgrade?</h2><p>Start with your home or business. Your enquiry stays connected to this council journey.</p></div><div className={styles.sectors} role="group" aria-label="Property type">
        {campaign.audience !== "businesses" && <button type="button" className={styles.sector} aria-pressed={sector === "residential"} onClick={() => setSector("residential")}><span className={styles.sectorIcon} aria-hidden="true">⌂</span><span><strong>My home</strong><small>Comfort, efficiency and practical household upgrades.</small></span><span aria-hidden="true">{sector === "residential" ? "✓" : ""}</span></button>}
        {campaign.audience !== "households" && <button type="button" className={styles.sector} aria-pressed={sector === "business"} onClick={() => setSector("business")}><span className={styles.sectorIcon} aria-hidden="true">▥</span><span><strong>My business</strong><small>Energy upgrades for your business premises.</small></span><span aria-hidden="true">{sector === "business" ? "✓" : ""}</span></button>}
      </div><button type="button" className={styles.primary} onClick={() => setEnquiryOpen(true)}>Explore upgrade options <span aria-hidden="true">→</span></button></section>}
      <section className={styles.privacy}><div><h2>Your details, your choice</h2><p>Choose how providers may contact you. Council reporting shows protected totals and does not show your name, street address or contact details.</p></div><a href={`${PUBLIC_SITE.apexUrl}/privacy`} target="_blank" rel="noopener noreferrer">Privacy information ↗</a></section>
      {enquiryOpen && <QuickUpgradeEnquiryDialog councilReference={demonstration ? undefined : campaign.code} councilBranding={branding} demonstration={demonstration} initialCustomerSector={sector} initialPostcode={campaign.postcodes.length === 1 ? campaign.postcodes[0] : ""} onClose={() => setEnquiryOpen(false)} />}
    </> : <section className={styles.unavailable}><h1>{unavailable ? "This program is temporarily unavailable" : "This campaign is no longer active"}</h1><p>{unavailable ? "Please try again shortly or contact TLink support." : "Contact your council for its current program link."}</p><a className={styles.primary} href={`${PUBLIC_SITE.apexUrl}/direct-trade`}>Explore TLink →</a></section>}</div>
    <footer className={styles.footer}><span>Energy upgrade enquiries powered by <strong>TLink</strong></span><nav aria-label="TLink access"><a href={`${PUBLIC_SITE.apexUrl}/direct-trade`}>Join as a local provider ↗</a><a href={`${PUBLIC_SITE.apexUrl}/council`}>Council sign in ↗</a></nav></footer>
  </main>;
}
