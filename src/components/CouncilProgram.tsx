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

export function CouncilProgram({ campaign, unavailable = false, demonstration = false, embeddedPreview = false }: { campaign: PublicCampaign | null; unavailable?: boolean; demonstration?: boolean; embeddedPreview?: boolean }) {
  const [enquiryOpen, setEnquiryOpen] = useState(false);
  const [sector, setSector] = useState<"residential" | "business">(campaign?.audience === "businesses" ? "business" : "residential");
  const theme = { primaryColor: campaign?.primaryColor || COUNCIL_DEFAULT_THEME.primaryColor, accentColor: campaign?.accentColor || COUNCIL_DEFAULT_THEME.accentColor };
  const branding: CouncilPublicBranding | undefined = campaign ? { councilName: campaign.councilName, logoDataUrl: campaign.logoDataUrl || null, homeUrl: campaign.homeUrl || null, theme } : undefined;
  const timeZone = campaign ? councilReportPeriod("year", campaign.state).timeZone : "Australia/Melbourne";
  const initials = campaign?.councilName.split(/\s+/).filter(word => !["city", "of", "council"].includes(word.toLowerCase())).slice(0, 2).map(word => word[0]).join("") || "C";
  const Page = embeddedPreview ? "div" : "main";
  return <Page id={embeddedPreview ? undefined : "site-content"} className={styles.page} style={councilThemeVariables(theme, "day")}>
    {demonstration && <div className={styles.demo} role="note"><strong>Customer journey demonstration</strong><span>Preview using {campaign?.councilName || "your council"}. No enquiries are sent. This preview does not imply council endorsement.</span></div>}
    <header className={styles.header}><div className={styles.headerInner}>
      <div className={styles.identity}><span className={`${styles.logo}${campaign?.logoDataUrl ? ` ${styles.imageLogo}` : ""}`}>{campaign?.logoDataUrl ? <NextImage unoptimized src={campaign.logoDataUrl} alt={`${campaign.councilName} logo`} width={200} height={64} /> : <span aria-hidden="true">{initials}</span>}</span><div><strong>{campaign?.councilName || "Local energy upgrades"}</strong><span>Energy upgrades for our community</span></div></div>
      {branding?.homeUrl && <a href={branding.homeUrl} className={styles.home}>Back to council website <span aria-hidden="true">↗</span></a>}
    </div></header>
    <div className={styles.content}>{campaign ? <>
      <section className={styles.hero}><div className={styles.heroCopy}><span className={styles.eyebrow}><span aria-hidden="true">✦</span>{campaign.kind === "session" ? "Community information session" : "Homes and local businesses"}</span><h1>{campaign.title}</h1><p className={styles.lead}>Make your next energy upgrade feel simple. Explore options for your home or business, choose your timeframe and hear from matching providers.</p>
        {campaign.kind === "session" && <div className={styles.session}><strong>{campaign.startsAt && new Date(campaign.startsAt).toLocaleString("en-AU", { dateStyle: "full", timeStyle: "short", timeZone })} ({timeZone})</strong>{campaign.location && <p>{campaign.location}</p>}{campaign.meetingUrl && <a href={campaign.meetingUrl} target="_blank" rel="noopener noreferrer">Join online session ↗</a>}</div>}
        <div className={styles.upgradeExamples}><span>Solar &amp; storage</span><span>Heating &amp; cooling</span><span>Insulation &amp; more</span></div>
      </div><aside className={styles.neighbourhood}>
        <span className={styles.artEyebrow}>Good energy starts here</span>
        <svg className={styles.scene} viewBox="0 0 640 370" aria-hidden="true" focusable="false">
          <circle cx="500" cy="74" r="42" fill="#efcf7e" />
          <path d="M28 288C91 245 133 259 196 277S323 220 402 263 535 237 617 278V352H28Z" fill="var(--c-accent-soft)" />
          <path d="M34 320H610" stroke="var(--c-header-start)" strokeWidth="3" strokeLinecap="round" opacity=".24" />
          <path d="M44 289V227M24 253C9 224 30 199 47 198 73 192 84 221 71 238 101 256 79 279 44 272" fill="var(--c-header-start)" stroke="var(--c-header-start)" strokeWidth="5" strokeLinecap="round" />
          <path d="M49 290V248L37 236M49 262L66 247" fill="none" stroke="#f7efe0" strokeWidth="3" strokeLinecap="round" />
          <path d="M104 180L255 90 398 180V313H104Z" fill="#fffaf1" />
          <path d="M85 183L254 79 416 182 398 205 254 117 104 205Z" fill="var(--c-header-start)" />
          <path d="M223 102L274 133 211 172 161 141Z" fill="#aad3d0" stroke="#fffaf1" strokeWidth="3" />
          <path d="M178 130L228 162M193 120L243 152M208 111L258 142M180 153L241 115" fill="none" stroke="var(--c-header-start)" strokeWidth="2" opacity=".6" />
          <path d="M353 154V99H376V169" fill="var(--c-header-end)" />
          <rect x="132" y="211" width="64" height="65" rx="4" fill="#b6dad8" stroke="var(--c-header-start)" strokeWidth="4" />
          <path d="M164 213V274M134 243H194" stroke="var(--c-header-start)" strokeWidth="3" />
          <rect x="220" y="213" width="62" height="100" rx="5" fill="var(--c-header-end)" />
          <circle cx="268" cy="261" r="3" fill="#fffaf1" />
          <rect x="309" y="213" width="60" height="49" rx="4" fill="#b6dad8" stroke="var(--c-header-start)" strokeWidth="4" />
          <path d="M339 215V260" stroke="var(--c-header-start)" strokeWidth="3" />
          <rect x="316" y="280" width="62" height="33" rx="5" fill="#e9e9da" stroke="var(--c-header-start)" strokeWidth="3" />
          <circle cx="335" cy="296" r="10" fill="none" stroke="var(--c-header-start)" strokeWidth="2" />
          <path d="M353 290H370M353 296H370M353 302H370" stroke="var(--c-header-start)" strokeWidth="2" />
          <rect x="422" y="186" width="137" height="127" rx="3" fill="#f0dfc1" />
          <path d="M412 185H569V164H412Z" fill="var(--c-header-start)" />
          <rect x="432" y="225" width="77" height="62" rx="3" fill="#b6dad8" stroke="var(--c-header-start)" strokeWidth="3" />
          <path d="M471 227V285" stroke="var(--c-header-start)" strokeWidth="3" />
          <path d="M518 224H549V313H518Z" fill="var(--c-header-start)" />
          <path d="M421 190H560L572 220H409Z" fill="var(--c-header-end)" />
          <path d="M438 190L435 220M465 190V220M493 190V220M520 190L524 220M546 190L554 220" stroke="#fffaf1" strokeWidth="13" />
          <path d="M116 314H562" stroke="var(--c-header-start)" strokeWidth="4" strokeLinecap="round" />
          <path d="M576 313V264M559 274C542 259 553 241 575 240 585 216 613 234 606 252 624 270 608 289 576 283" fill="var(--c-header-start)" stroke="var(--c-header-start)" strokeWidth="4" strokeLinecap="round" />
          <path d="M578 300V260L589 250" fill="none" stroke="#f7efe0" strokeWidth="3" strokeLinecap="round" />
          <path d="M75 309C80 289 102 290 106 308M388 311C392 290 412 292 416 311" fill="var(--c-header-end)" />
          <path d="M98 69H124M111 56V82M448 112H464M456 104V120" stroke="var(--c-header-end)" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <p>Your place.<br /><strong>Your pace.</strong><span>Practical upgrades for everyday life.</span></p>
      </aside></section>
      {campaign.audience !== "trades" && <section className={styles.start} aria-labelledby="journey-title"><div className={styles.startHeading}><span className={styles.sectionLabel}>Let&apos;s find your next step</span><h2 id="journey-title">What would you like to upgrade?</h2><p>Start with your home or business. You choose the work and when you&apos;re ready.</p></div><div className={styles.sectors} role="group" aria-label="Property type">
        {campaign.audience !== "businesses" && <button type="button" className={styles.sector} aria-pressed={sector === "residential"} onClick={() => setSector("residential")}><span className={styles.sectorIcon} aria-hidden="true"><svg viewBox="0 0 48 48" fill="none" focusable="false"><path d="M7 23L24 9 41 23M12 20V40H36V20M20 40V28H28V40" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg></span><span><strong>My home</strong><small>Comfort, efficiency and practical household upgrades.</small></span><span className={styles.selectionMark} aria-hidden="true">{sector === "residential" ? "✓" : ""}</span></button>}
        {campaign.audience !== "households" && <button type="button" className={styles.sector} aria-pressed={sector === "business"} onClick={() => setSector("business")}><span className={styles.sectorIcon} aria-hidden="true"><svg viewBox="0 0 48 48" fill="none" focusable="false"><path d="M9 19H39L36 10H12L9 19ZM12 22V40H36V22M19 40V29H28V40M17 11V19M24 11V19M31 11V19M9 19C9 25 17 25 17 19 17 25 24 25 24 19 24 25 31 25 31 19 31 25 39 25 39 19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg></span><span><strong>My business</strong><small>Energy upgrades for your business premises.</small></span><span className={styles.selectionMark} aria-hidden="true">{sector === "business" ? "✓" : ""}</span></button>}
      </div><div className={styles.startAction}><button type="button" className={styles.primary} onClick={() => setEnquiryOpen(true)}>Explore upgrade options <span aria-hidden="true">→</span></button><span>A few details. A clearer next step.</span></div></section>}
      <section className={styles.promise} aria-labelledby="upgrade-steps"><div><span className={styles.sectionLabel}>How it works</span><h2 id="upgrade-steps">A simpler path to upgrades</h2></div><ol><li><strong>Choose your upgrades</strong><span>Tell us what you&apos;re considering.</span></li><li><strong>Set your timeframe</strong><span>Choose when you want the work done.</span></li><li><strong>Hear from providers</strong><span>Receive quotes while your enquiry is open.</span></li></ol></section>
      <section className={styles.privacy}><div><h2>Your details, your choice</h2><p>Choose how providers may contact you. Council reporting shows protected totals and does not show your name, street address or contact details.</p></div><a href={`${PUBLIC_SITE.apexUrl}/privacy`} target="_blank" rel="noopener noreferrer">Privacy information ↗</a></section>
      {enquiryOpen && <QuickUpgradeEnquiryDialog councilReference={demonstration ? undefined : campaign.code} councilBranding={branding} demonstration={demonstration} initialCustomerSector={sector} initialPostcode={campaign.postcodes.length === 1 ? campaign.postcodes[0] : ""} onClose={() => setEnquiryOpen(false)} />}
    </> : <section className={styles.unavailable}><h1>{unavailable ? "This program is temporarily unavailable" : "This campaign is no longer active"}</h1><p>{unavailable ? "Please try again shortly or contact TLink support." : "Contact your council for its current program link."}</p><a className={styles.primary} href={`${PUBLIC_SITE.apexUrl}/direct-trade`}>Explore TLink →</a></section>}</div>
    <footer className={styles.footer}><span>Energy upgrade enquiries powered by <strong>TLink</strong></span><nav aria-label="TLink access"><a href={`${PUBLIC_SITE.apexUrl}/direct-trade`}>Join as a local provider ↗</a><a href={`${PUBLIC_SITE.apexUrl}/council`}>Council sign in ↗</a></nav></footer>
  </Page>;
}
