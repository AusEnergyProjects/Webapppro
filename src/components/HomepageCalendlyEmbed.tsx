"use client";

import { useState } from "react";
import { CALENDLY_EMBED_URL } from "@/lib/assessment-booking";
import styles from "./AssessmentBooking.module.css";

export function HomepageCalendlyEmbed() {
  const [opened, setOpened] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (!opened) {
    return (
      <div
        className={styles.embedShell}
        style={{ alignItems: "center", background: "#f4faf8", display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "space-between", minHeight: 112, padding: "22px 24px" }}
      >
        <p style={{ color: "#496961", display: "grid", flex: "1 1 280px", gap: 4, lineHeight: 1.45, margin: 0 }}><strong style={{ color: "#092c38", fontSize: "1.05rem" }}>Ready when you are</strong><span>Open the calendar and choose a time that suits you.</span></p>
        <button className="btn" style={{ flex: "1 1 170px", maxWidth: 240 }} type="button" onClick={() => setOpened(true)}>Choose a time</button>
      </div>
    );
  }

  return (
    <div className={styles.embedShell}>
      {!loaded ? <p className={styles.privacyNote} role="status">Loading available times...</p> : null}
      <iframe
        className={styles.embed}
        src={CALENDLY_EMBED_URL}
        title="Choose a five-minute call time with Australian Energy Assessments"
        loading="eager"
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}
