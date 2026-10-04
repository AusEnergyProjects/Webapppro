"use client";

import { PublicRebateCalculatorWorkspace } from "../PublicRebateCalculatorWorkspace";
import { CouncilIcon } from "./CouncilPrimitives";
import styles from "./CouncilRebateCalculator.module.css";

/** Reuses the public quote workflow, without council or trade access credentials. */
export function CouncilRebateCalculator({ demonstration, postcodes, state }: {
  demonstration: boolean;
  postcodes: string[];
  state: string;
}) {
  const initialProgramCode = state === "VIC" ? "VEU" : state === "NSW" ? "NSW-ESS-2026" : "SRES";
  return <div className={styles.root}>
    <section className={styles.introduction} aria-labelledby="council-rebate-title">
      <div className={styles.introCopy}>
        <h2 id="council-rebate-title">Explore rebates for local upgrades</h2>
        <p>The same scheme calculator available to residents and local trades, with full program and activity choices.</p>
      </div>
      <a className={styles.publicLink} href="/calculator" target="_blank" rel="noopener noreferrer">Open the public calculator <CouncilIcon name="external" size={16} /></a>
      <div className={styles.context}>
        <div><CouncilIcon name="map" size={16} /><span><strong>{state} council area</strong>{postcodes.length ? ` · ${postcodes.join(", ")}` : " · No approved postcodes yet"}</span></div>
        <p>{demonstration && <strong>Real calculator in a demonstration workspace. </strong>}Use the actual installation postcode when requested. Product-based calculations need the official register; results do not change council reporting totals.</p>
      </div>
    </section>
    <div className={styles.officialCalculator}>
      <PublicRebateCalculatorWorkspace embedded initialProgramCode={initialProgramCode} initialActivityCode={state === "VIC" ? "46" : undefined} />
    </div>
    <p className={styles.boundary}><CouncilIcon name="shield" size={16} />Calculations support planning. They do not confirm a household&apos;s eligibility, the final installer price or certificate creation.</p>
  </div>;
}
