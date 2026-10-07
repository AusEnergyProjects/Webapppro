"use client";
import { useState } from "react";
import Link from "next/link";
import { councilReportPeriod } from "@/lib/council-reporting";
import { QuickUpgradeEnquiryDialog } from "./QuickUpgradeEnquiryDialog";
import { TLinkBrand } from "./TLinkChrome";
import styles from "./CouncilPortal.module.css";

type PublicCampaign = {
  code: string; title: string; kind: "campaign" | "session"; audience: "everyone" | "households" | "businesses" | "trades";
  startsAt: string | null; location: string | null; meetingUrl: string | null;
  councilName: string; state: string; postcodes: string[];
};
export function CouncilProgram({ campaign, unavailable = false }: { campaign: PublicCampaign | null; unavailable?: boolean }) {
  const [enquiryOpen, setEnquiryOpen] = useState(false);
  const timeZone = campaign ? councilReportPeriod("year", campaign.state).timeZone : "Australia/Melbourne";
  return <main id="site-content" className={styles.entry}><div className={styles.entryPanel}>
    <a href="/council" className={styles.brand}><TLinkBrand context="Community programs" /></a>
    {campaign ? <>
      <span className={styles.eyebrow}>{campaign.councilName} · {campaign.kind === "session" ? "Information session" : "Local upgrade program"}</span>
      <h1>{campaign.title}</h1>
      <p className={styles.lead}>Find practical upgrade options and connect with local providers through TLink.</p>
      {campaign.kind === "session" && <div className={styles.notice}>
        <strong>{campaign.startsAt && new Date(campaign.startsAt).toLocaleString("en-AU", { dateStyle: "full", timeStyle: "short", timeZone })} ({timeZone})</strong>
        {campaign.location && <p>{campaign.location}</p>}
        {campaign.meetingUrl && <a href={campaign.meetingUrl} target="_blank" rel="noopener noreferrer">Open online session ↗</a>}
      </div>}
      <p>For {campaign.audience === "everyone" ? "residents, businesses and trades" : campaign.audience} in the participating postcode area: {campaign.postcodes.join(", ") || "area awaiting confirmation"}.</p>
      <div className={styles.actions}>
        {campaign.audience !== "trades" && <button type="button" onClick={() => setEnquiryOpen(true)}>Explore my upgrade options <span aria-hidden="true">→</span></button>}
        <a className={styles.secondary} href="/direct-trade">Join TLink as a local business ↗</a>
      </div>
      <p className={styles.fine}>Your enquiry carries this council campaign reference. Council reporting uses protected totals and does not show your name, address or contact details. You choose the contact sharing in the enquiry form. Trade registrations made through the TLink link are not currently attributed to this campaign.</p>
      {enquiryOpen && <QuickUpgradeEnquiryDialog councilReference={campaign.code} initialPostcode={campaign.postcodes.length === 1 ? campaign.postcodes[0] : ""} onClose={() => setEnquiryOpen(false)} />}
    </> : <>
      <h1>{unavailable ? "This program is temporarily unavailable" : "This campaign is no longer active"}</h1>
      <p>{unavailable ? "Please try again shortly, or contact TLink support." : "Contact your council for the current program link. You can still explore upgrade options through TLink."}</p>
      <Link className={styles.secondary} href="/direct-trade">Explore TLink →</Link>
    </>}
  </div></main>;
}
