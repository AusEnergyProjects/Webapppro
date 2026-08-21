"use client";

import { requestSurgeOpen } from "@/lib/energy-assistant-events";
import styles from "./SurgeOpenButton.module.css";

export function SurgeOpenButton({
  label,
  description,
  draft,
}: {
  label: string;
  description: string;
  draft: string;
}) {
  return (
    <button
      className={styles.button}
      type="button"
      onClick={() => requestSurgeOpen(draft)}
    >
      <span className={styles.mascot} aria-hidden="true" />
      <span className={styles.copy}>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <span className={styles.arrow} aria-hidden="true">›</span>
    </button>
  );
}
