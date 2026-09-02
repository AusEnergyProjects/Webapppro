"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";

const GA_MEASUREMENT_ID = "G-3PGGJ0JX4H";
const CONSENT_STORAGE_KEY = "australian-energy-assessments-analytics-consent-v1";
const CONSENT_GRANTED = "granted";
const CONSENT_DENIED = "denied";
const PREFERENCE_CHANGE_EVENT = "australian-energy-assessments:analytics-preference";
const ANALYTICS_SCRIPT_ID = "australian-energy-assessments-google-analytics";
const CONFIGURED_ATTRIBUTE = "data-australian-energy-assessments-analytics";
const CONSENT_DEFAULT_ATTRIBUTE = "data-australian-energy-assessments-consent-default";
const PRIVATE_PATH_PREFIXES = [
  "/account",
  "/creditex",
  "/direct-trade/dashboard",
  "/direct-trade/team",
  "/job-information",
  "/operations",
  "/quote-review",
  "/rental-report",
];

type StoredAnalyticsChoice = typeof CONSENT_GRANTED | typeof CONSENT_DENIED;
type AnalyticsPreference = "enabled" | "disabled" | "browser-disabled";

const privacyControlStyle: CSSProperties = {
  borderTop: "1px solid var(--color-aea-line)",
  display: "grid",
  gap: "12px",
  marginTop: "16px",
  paddingTop: "16px",
};

declare global {
  interface Navigator {
    globalPrivacyControl?: boolean;
    msDoNotTrack?: string;
  }

  interface Window {
    dataLayer?: unknown[];
    doNotTrack?: string;
    gtag?: (...args: unknown[]) => void;
    "ga-disable-G-3PGGJ0JX4H"?: boolean;
  }
}

function parseStoredChoice(value: string | null): StoredAnalyticsChoice | null {
  return value === CONSENT_GRANTED || value === CONSENT_DENIED ? value : null;
}

function readStoredChoice(): StoredAnalyticsChoice | null {
  try {
    return parseStoredChoice(window.localStorage.getItem(CONSENT_STORAGE_KEY));
  } catch {
    return null;
  }
}

function browserRequestsNoTracking() {
  return navigator.globalPrivacyControl === true
    || navigator.doNotTrack === "1"
    || navigator.doNotTrack === "yes"
    || navigator.msDoNotTrack === "1"
    || window.doNotTrack === "1";
}

function readAnalyticsPreference(): AnalyticsPreference {
  if (browserRequestsNoTracking()) return "browser-disabled";
  return readStoredChoice() === CONSENT_DENIED ? "disabled" : "enabled";
}

function storeChoice(choice: StoredAnalyticsChoice) {
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, choice);
  } catch {
    // Some strict privacy modes block browser storage. The choice still applies to this page.
  }
  window.dispatchEvent(new CustomEvent(PREFERENCE_CHANGE_EVENT, { detail: choice }));
}

function analyticsAllowedOnPath(pathname: string) {
  if (pathname.includes("/print/") || pathname.endsWith("/print") || pathname.includes("/pdf/")) {
    return false;
  }
  return !PRIVATE_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function pageDetails(pathname: string) {
  return {
    page_location: `${window.location.origin}${pathname}`,
    page_path: pathname,
    page_title: document.title,
  };
}

function ensureGoogleTagFunction() {
  window.dataLayer ??= [];
  window.gtag ??= (...args: unknown[]) => {
    window.dataLayer?.push(args);
  };
}

function ensureGoogleConsentDefaults() {
  ensureGoogleTagFunction();
  if (document.documentElement.hasAttribute(CONSENT_DEFAULT_ATTRIBUTE)) return;

  window.gtag?.("consent", "default", {
    ad_personalization: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    analytics_storage: "denied",
  });
  document.documentElement.setAttribute(CONSENT_DEFAULT_ATTRIBUTE, "denied");
}

function clearGoogleAnalyticsCookies() {
  const cookieNames = document.cookie
    .split(";")
    .map((cookie) => cookie.split("=", 1)[0]?.trim())
    .filter((name): name is string => Boolean(name && /^_(?:ga|gac|gat|gid)(?:_|$)/.test(name)));

  const domainAttributes = [
    "",
    `; Domain=${window.location.hostname}`,
    "; Domain=.ausenergyassessments.com",
  ];

  for (const name of cookieNames) {
    for (const domainAttribute of domainAttributes) {
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domainAttribute}`;
    }
  }
}

function enableCookielessGoogleAnalytics(pathname: string) {
  const wasConfigured = document.documentElement.hasAttribute(CONFIGURED_ATTRIBUTE);

  clearGoogleAnalyticsCookies();
  window["ga-disable-G-3PGGJ0JX4H"] = false;
  ensureGoogleConsentDefaults();
  window.gtag?.("consent", "update", {
    ad_personalization: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    analytics_storage: "denied",
  });

  if (!wasConfigured) {
    window.gtag?.("js", new Date());
    window.gtag?.("config", GA_MEASUREMENT_ID, {
      ...pageDetails(pathname),
      allow_ad_personalization_signals: false,
      allow_google_signals: false,
      anonymize_ip: true,
      send_page_view: false,
    });
    document.documentElement.setAttribute(CONFIGURED_ATTRIBUTE, "cookieless");
  }

  if (!document.getElementById(ANALYTICS_SCRIPT_ID)) {
    const script = document.createElement("script");
    script.id = ANALYTICS_SCRIPT_ID;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
    script.addEventListener("error", () => {
      script.remove();
      document.documentElement.removeAttribute(CONFIGURED_ATTRIBUTE);
    }, { once: true });
    document.head.appendChild(script);
  }
}

function disableGoogleAnalytics() {
  window["ga-disable-G-3PGGJ0JX4H"] = true;
  ensureGoogleConsentDefaults();
  window.gtag?.("consent", "update", {
    ad_personalization: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    analytics_storage: "denied",
  });
  document.documentElement.removeAttribute(CONFIGURED_ATTRIBUTE);
  clearGoogleAnalyticsCookies();
}

function trackPageView(pathname: string) {
  window.gtag?.("event", "page_view", pageDetails(pathname));
}

function useAnalyticsPreference() {
  const [preference, setPreference] = useState<AnalyticsPreference | undefined>(undefined);

  useEffect(() => {
    const syncPreference = () => setPreference(readAnalyticsPreference());
    const syncCurrentTabPreference = (event: Event) => {
      if (browserRequestsNoTracking()) {
        setPreference("browser-disabled");
        return;
      }

      const choice = event instanceof CustomEvent && typeof event.detail === "string"
        ? parseStoredChoice(event.detail)
        : null;
      setPreference(choice === CONSENT_DENIED ? "disabled" : "enabled");
    };
    const frame = window.requestAnimationFrame(syncPreference);
    const syncStoredPreference = (event: StorageEvent) => {
      if (event.key === CONSENT_STORAGE_KEY || event.key === null) syncPreference();
    };

    window.addEventListener(PREFERENCE_CHANGE_EVENT, syncCurrentTabPreference);
    window.addEventListener("storage", syncStoredPreference);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener(PREFERENCE_CHANGE_EVENT, syncCurrentTabPreference);
      window.removeEventListener("storage", syncStoredPreference);
    };
  }, []);

  return preference;
}

export function AnalyticsConsent() {
  const pathname = usePathname() || "/";
  const analyticsAllowed = analyticsAllowedOnPath(pathname);
  const preference = useAnalyticsPreference();
  const lastTrackedPath = useRef<string | null>(null);

  useEffect(() => {
    if (preference === undefined) return;

    if (preference !== "enabled" || !analyticsAllowed) {
      disableGoogleAnalytics();
      lastTrackedPath.current = null;
      return;
    }

    enableCookielessGoogleAnalytics(pathname);
    if (lastTrackedPath.current !== pathname) {
      trackPageView(pathname);
    }
    lastTrackedPath.current = pathname;
  }, [analyticsAllowed, pathname, preference]);

  return null;
}

export function AnalyticsPrivacyControl() {
  const preference = useAnalyticsPreference();

  if (preference === undefined) {
    return (
      <div className="analytics-privacy-control" style={privacyControlStyle} aria-live="polite">
        <p>Checking this browser&apos;s analytics setting...</p>
      </div>
    );
  }

  if (preference === "browser-disabled") {
    return (
      <div className="analytics-privacy-control" style={privacyControlStyle} aria-live="polite">
        <div>
          <strong>Basic analytics is off</strong>
          <p>This browser has asked websites not to track it, so we respect that setting automatically.</p>
        </div>
      </div>
    );
  }

  const enabled = preference === "enabled";
  return (
    <div className="analytics-privacy-control" style={privacyControlStyle} aria-live="polite">
      <div>
        <strong>Basic analytics is {enabled ? "on" : "off"}</strong>
        <p>
          {enabled
            ? "Cookieless public-page measurement is active in this browser."
            : "Further cookieless page-view measurement is off in this browser."}
        </p>
      </div>
      <button
        className={`btn${enabled ? " ghost" : ""}`}
        type="button"
        style={{ justifySelf: "start", minHeight: "44px" }}
        onClick={() => storeChoice(enabled ? CONSENT_DENIED : CONSENT_GRANTED)}
      >
        {enabled ? "Turn off basic analytics" : "Allow basic analytics"}
      </button>
    </div>
  );
}
