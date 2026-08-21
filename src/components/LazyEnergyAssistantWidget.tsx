"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  OPEN_SURGE_EVENT,
  type OpenSurgeEventDetail,
} from "@/lib/energy-assistant-events";
import styles from "./LazyEnergyAssistantWidget.module.css";

const DISPLAY_PREFERENCE_KEY = "aea-surge-display-v1";
const DISPLAY_PREFERENCE_TUCKED = "tucked";
const MAX_DRAFT_LENGTH = 1_200;

function loadEnergyAssistant() {
  return import("./EnergyAssistantWidget").then((module) => ({
    default: module.EnergyAssistantWidget,
  }));
}

const DeferredEnergyAssistantWidget = lazy(loadEnergyAssistant);

function hiddenRoute(pathname: string) {
  return pathname === "/plan/print"
    || pathname.includes("/print/")
    || pathname.endsWith("/print")
    || pathname.includes("/pdf/")
    || pathname.endsWith("/pdf");
}

function storeTucked(tucked: boolean) {
  try {
    if (tucked) window.localStorage.setItem(DISPLAY_PREFERENCE_KEY, DISPLAY_PREFERENCE_TUCKED);
    else window.localStorage.removeItem(DISPLAY_PREFERENCE_KEY);
  } catch {
    // Storage can be unavailable in strict privacy modes. The control still works for this page.
  }
}

function Loader({ dedicated }: { dedicated: boolean }) {
  return (
    <div className={dedicated ? styles.dedicatedLoading : styles.loading} role="status">
      Loading Surge AI...
    </div>
  );
}

export function LazyEnergyAssistantWidget() {
  const pathname = usePathname() || "/";
  const dedicated = pathname === "/surge";
  const [requested, setRequested] = useState(false);
  const [initialDraft, setInitialDraft] = useState("");
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
    const openSurge = (event: Event) => {
      const detail = event instanceof CustomEvent
        ? event.detail as OpenSurgeEventDetail | undefined
        : undefined;
      setInitialDraft((detail?.draft || "").trim().slice(0, MAX_DRAFT_LENGTH));
      setTucked(false);
      storeTucked(false);
      setRequested(true);
    };
    const syncPreference = (event: StorageEvent) => {
      if (event.key === DISPLAY_PREFERENCE_KEY) {
        setTucked(event.newValue === DISPLAY_PREFERENCE_TUCKED);
      }
    };
    window.addEventListener(OPEN_SURGE_EVENT, openSurge);
    window.addEventListener("storage", syncPreference);
    return () => {
      window.removeEventListener(OPEN_SURGE_EVENT, openSurge);
      window.removeEventListener("storage", syncPreference);
    };
  }, []);

  if (hiddenRoute(pathname)) return null;

  if (requested || dedicated) {
    return (
      <Suspense fallback={<Loader dedicated={dedicated} />}>
        <DeferredEnergyAssistantWidget
          initialDraft={initialDraft}
          initialOpen={!dedicated}
        />
      </Suspense>
    );
  }

  return (
    <div className={`${styles.root}${tucked ? ` ${styles.rootTucked}` : ""}`} data-surge-loader>
      {tucked ? (
        <button
          className={styles.peek}
          type="button"
          aria-label="Bring Surge AI back and open chat"
          onPointerEnter={() => void loadEnergyAssistant()}
          onFocus={() => void loadEnergyAssistant()}
          onClick={() => {
            setTucked(false);
            storeTucked(false);
            setRequested(true);
          }}
        >
          <span className={`${styles.mascot} ${styles.mascotPeeking}`} aria-hidden="true" />
        </button>
      ) : (
        <>
          <button
            className={styles.launcher}
            type="button"
            aria-label="Open Surge AI"
            aria-controls="aea-energy-guide"
            aria-expanded="false"
            onPointerEnter={() => void loadEnergyAssistant()}
            onFocus={() => void loadEnergyAssistant()}
            onClick={() => setRequested(true)}
          >
            <span className={styles.mascot} aria-hidden="true" />
          </button>
          <button
            className={styles.dismiss}
            type="button"
            aria-label="Hide Surge AI mascot"
            title="Hide Surge AI"
            onClick={() => {
              setTucked(true);
              storeTucked(true);
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        </>
      )}
    </div>
  );
}
