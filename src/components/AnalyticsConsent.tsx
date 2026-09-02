"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";

const GA_MEASUREMENT_ID = "G-3PGGJ0JX4H";
const CONSENT_STORAGE_KEY = "australian-energy-assessments-analytics-consent-v1";
const CONSENT_GRANTED = "granted";
const CONSENT_DENIED = "denied";
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
type AnalyticsChoice = StoredAnalyticsChoice | null | undefined;

declare global {
  interface Window {
    dataLayer?: unknown[];
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

function storeChoice(choice: StoredAnalyticsChoice) {
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, choice);
  } catch {
    // Some strict privacy modes block browser storage. The choice still applies to this page.
  }
}

function clearStoredChoice() {
  try {
    window.localStorage.removeItem(CONSENT_STORAGE_KEY);
  } catch {
    // The current page can still reopen the choice when browser storage is unavailable.
  }
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

function enableGoogleAnalytics(pathname: string) {
  const wasConfigured = document.documentElement.hasAttribute(CONFIGURED_ATTRIBUTE);

  window["ga-disable-G-3PGGJ0JX4H"] = false;
  ensureGoogleConsentDefaults();
  window.gtag?.("consent", "update", {
    ad_personalization: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    analytics_storage: "granted",
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
    document.documentElement.setAttribute(CONFIGURED_ATTRIBUTE, "granted");
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

const bannerStyle: CSSProperties = {
  alignItems: "center",
  background: "#ffffff",
  border: "1px solid #9fcfc0",
  borderRadius: "16px",
  bottom: "12px",
  boxShadow: "0 18px 55px rgba(1, 23, 36, 0.28)",
  color: "#062c32",
  display: "flex",
  flexWrap: "wrap",
  gap: "14px 22px",
  justifyContent: "space-between",
  left: "50%",
  maxWidth: "780px",
  padding: "16px",
  position: "fixed",
  transform: "translateX(-50%)",
  width: "calc(100vw - 24px)",
  zIndex: 8500,
};

const copyStyle: CSSProperties = {
  flex: "1 1 360px",
  lineHeight: 1.5,
  margin: 0,
};

const titleStyle: CSSProperties = {
  display: "block",
  fontSize: "1rem",
  marginBottom: "4px",
};

const paragraphStyle: CSSProperties = {
  color: "#45625a",
  fontSize: ".86rem",
  margin: 0,
};

const linkStyle: CSSProperties = {
  color: "#08794c",
  fontSize: ".82rem",
  fontWeight: 800,
};

const actionsStyle: CSSProperties = {
  alignItems: "stretch",
  display: "flex",
  flex: "0 1 auto",
  flexWrap: "wrap",
  gap: "8px",
};

const actionStyle: CSSProperties = {
  minHeight: "44px",
  whiteSpace: "nowrap",
};

const preferencesStyle: CSSProperties = {
  background: "rgba(3, 25, 45, .94)",
  border: "1px solid rgba(94, 234, 212, .55)",
  borderRadius: "999px",
  bottom: "12px",
  color: "#ffffff",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: ".78rem",
  fontWeight: 800,
  left: "12px",
  minHeight: "44px",
  padding: "9px 14px",
  position: "fixed",
  zIndex: 80,
};

export function AnalyticsConsent() {
  const pathname = usePathname() || "/";
  const analyticsAllowed = analyticsAllowedOnPath(pathname);
  const [choice, setChoice] = useState<AnalyticsChoice>(undefined);
  const lastTrackedPath = useRef<string | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setChoice(readStoredChoice());
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const syncChoice = (event: StorageEvent) => {
      if (event.key === CONSENT_STORAGE_KEY) {
        setChoice(parseStoredChoice(event.newValue));
      }
    };
    window.addEventListener("storage", syncChoice);
    return () => window.removeEventListener("storage", syncChoice);
  }, []);

  useEffect(() => {
    if (choice === undefined) return;

    if (choice !== CONSENT_GRANTED || !analyticsAllowed) {
      disableGoogleAnalytics();
      lastTrackedPath.current = null;
      return;
    }

    enableGoogleAnalytics(pathname);
    if (lastTrackedPath.current !== pathname) {
      trackPageView(pathname);
    }
    lastTrackedPath.current = pathname;
  }, [analyticsAllowed, choice, pathname]);

  if (choice === undefined || !analyticsAllowed) return null;

  if (choice !== null) {
    return (
      <button
        type="button"
        style={preferencesStyle}
        onClick={() => {
          clearStoredChoice();
          setChoice(null);
        }}
      >
        Privacy choices
      </button>
    );
  }

  const choose = (nextChoice: StoredAnalyticsChoice) => {
    storeChoice(nextChoice);
    setChoice(nextChoice);
  };

  return (
    <aside aria-label="Website analytics choice" style={bannerStyle}>
      <div style={copyStyle}>
        <strong style={titleStyle}>Help us improve this website</strong>
        <p style={paragraphStyle}>
          If you allow it, we use Google Analytics to count visits and learn
          which pages are useful. We do not send Wattzun AI conversations,
          form answers, contact details or uploaded files.
        </p>
        <a href="/privacy" style={linkStyle}>Read the privacy notice</a>
      </div>
      <div style={actionsStyle}>
        <button
          className="btn"
          type="button"
          style={actionStyle}
          onClick={() => choose(CONSENT_GRANTED)}
        >
          Allow basic analytics
        </button>
        <button
          className="btn ghost"
          type="button"
          style={actionStyle}
          onClick={() => choose(CONSENT_DENIED)}
        >
          No thanks
        </button>
      </div>
    </aside>
  );
}
