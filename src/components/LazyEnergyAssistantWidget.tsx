"use client";

import Link from "next/link";
import { lazy, Suspense, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { storePendingSurgeDraft } from "@/lib/surge-page-navigation";
import styles from "./LazyEnergyAssistantWidget.module.css";

const DISPLAY_PREFERENCE_KEY = "aea-surge-display-v1";
const DISPLAY_PREFERENCE_TUCKED = "tucked";
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

function Loader() {
  return (
    <div className={styles.dedicatedLoading} role="status">
      Loading Surge AI...
    </div>
  );
}

export function LazyEnergyAssistantWidget() {
  const pathname = usePathname() || "/";
  const dedicated = pathname === "/surge";
  const [tucked, setTucked] = useState(false);
  const router = useRouter();

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
      if (event.key === DISPLAY_PREFERENCE_KEY) {
        setTucked(event.newValue === DISPLAY_PREFERENCE_TUCKED);
      }
    };
    window.addEventListener("storage", syncPreference);
    return () => {
      window.removeEventListener("storage", syncPreference);
    };
  }, []);

  if (hiddenRoute(pathname)) return null;

  if (dedicated) {
    return (
      <Suspense fallback={<Loader />}>
        <DeferredEnergyAssistantWidget />
      </Suspense>
    );
  }

  return (
    <div className={`${styles.root}${tucked ? ` ${styles.rootTucked}` : ""}`} data-surge-loader>
      {tucked ? (
        <Link
          className={styles.peek}
          href="/surge"
          prefetch={false}
          aria-label="Open the full Surge AI guide"
          onPointerEnter={() => router.prefetch("/surge")}
          onFocus={() => router.prefetch("/surge")}
          onClick={() => {
            setTucked(false);
            storeTucked(false);
            storePendingSurgeDraft();
          }}
        >
          <span className={`${styles.mascot} ${styles.mascotPeeking}`} aria-hidden="true" />
        </Link>
      ) : (
        <>
          <Link
            className={styles.launcher}
            href="/surge"
            prefetch={false}
            aria-label="Open the full Surge AI guide"
            onPointerEnter={() => router.prefetch("/surge")}
            onFocus={() => router.prefetch("/surge")}
            onClick={() => storePendingSurgeDraft()}
          >
            <span className={styles.mascot} aria-hidden="true" />
          </Link>
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
