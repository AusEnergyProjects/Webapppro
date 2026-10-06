"use client";

import { useEffect, useState } from "react";
import type { WattzunHat as Hat } from "@/lib/wattzun-appearance";
import { WattzunMascot } from "./WattzunMascot";
import styles from "./LazyEnergyAssistantWidget.module.css";

const DISPLAY_PREFERENCE_KEY = "aea-surge-display-v1";
const DISPLAY_PREFERENCE_TUCKED = "tucked";

function storeTucked(tucked: boolean) {
  try {
    if (tucked) window.localStorage.setItem(DISPLAY_PREFERENCE_KEY, DISPLAY_PREFERENCE_TUCKED);
    else window.localStorage.removeItem(DISPLAY_PREFERENCE_KEY);
  } catch {
    // Storage can be unavailable in strict privacy modes. The control still works for this page.
  }
}

export function EnergyAssistantLauncher({ onPreload, onOpen, hat }: { onPreload: () => unknown; onOpen: () => void; hat?: Hat }) {
  const [tucked, setTucked] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        setTucked(window.localStorage.getItem(DISPLAY_PREFERENCE_KEY) === DISPLAY_PREFERENCE_TUCKED);
      } catch {
        setTucked(false);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const syncPreference = (event: StorageEvent) => {
      if (event.key === DISPLAY_PREFERENCE_KEY) setTucked(event.newValue === DISPLAY_PREFERENCE_TUCKED);
    };
    window.addEventListener("storage", syncPreference);
    return () => window.removeEventListener("storage", syncPreference);
  }, []);

  return <div
    className={`${styles.root}${tucked ? ` ${styles.rootTucked}` : ""}`}
    data-surge-loader
    onPointerEnter={onPreload}
    onFocusCapture={onPreload}
    onTouchStart={onPreload}
  >
    {tucked ? <button
      className={styles.peek}
      type="button"
      aria-label="Bring Wattzun AI back and open chat"
      onClick={() => { setTucked(false); storeTucked(false); onOpen(); }}
    >
      <WattzunMascot hat={hat} className={`${styles.mascot} ${styles.mascotPeeking}`} />
    </button> : <>
      <button className={styles.launcher} type="button" aria-label="Open Wattzun AI chat" onClick={onOpen}>
        <WattzunMascot hat={hat} className={styles.mascot} />
      </button>
      <button
        className={styles.dismiss}
        type="button"
        aria-label="Hide Wattzun AI mascot"
        title="Hide Wattzun AI"
        onClick={() => { setTucked(true); storeTucked(true); }}
      >
        <span aria-hidden="true">×</span>
      </button>
    </>}
  </div>;
}
