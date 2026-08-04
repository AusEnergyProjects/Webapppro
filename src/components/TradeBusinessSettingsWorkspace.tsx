"use client";

import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { User } from "firebase/auth";
import {
  DEFAULT_QUOTE_EMAIL_INTRO,
  DEFAULT_QUOTE_EMAIL_SUBJECT,
  DEFAULT_TRADE_BRAND_BORDER,
  DEFAULT_TRADE_BRAND_THEME,
  TRADE_BRAND_BORDER_STYLES,
  TRADE_BRAND_THEME_KEYS,
  type TradeBrandBorderStyle,
  type TradeBrandThemeKey,
} from "@/lib/trade-business-branding";

type AvailabilityStatus = "open" | "limited" | "paused";

type ServiceArea = {
  id?: string;
  postcode: string;
  radiusKm: number;
};

export type TradeBusinessSettingsProfile = {
  businessName: string;
  partnerType: "installer" | "supplier";
  abn?: string;
  addressLine1: string;
  suburb: string;
  addressState: string;
  postcode: string;
  contactName?: string;
  phone?: string;
  businessWebsite?: string;
  serviceStates: string[];
  capabilities: string[];
  accountStatus: string;
  verificationStatus: string;
  availabilityStatus: AvailabilityStatus;
  serviceBasePostcode: string;
  serviceRadiusKm: number;
  emailOpportunities: boolean;
  emailWeeklySummary: boolean;
  serviceAreas?: ServiceArea[];
  brandThemeKey?: TradeBrandThemeKey;
  brandBorderStyle?: TradeBrandBorderStyle;
  hasLogo?: boolean;
  hasBanner?: boolean;
  logoMediaUrl?: string;
  bannerMediaUrl?: string;
  quoteEmailSubjectTemplate?: string;
  quoteEmailIntro?: string;
  quoteDefaultTerms?: string;
  accountClosedAt?: string;
};

type SettingsSection =
  | "account"
  | "appearance"
  | "service"
  | "quotes"
  | "notifications"
  | "templates"
  | "closure";

type Props = {
  user: User;
  profile: TradeBusinessSettingsProfile;
  onProfileChange: (changes: Partial<TradeBusinessSettingsProfile>) => void;
  onAccountClosed: () => void;
};

const sectionOptions: Array<{
  id: SettingsSection;
  label: string;
  detail: string;
}> = [
  { id: "account", label: "Account", detail: "Identity and verification" },
  { id: "appearance", label: "Appearance", detail: "Logo, banner and colours" },
  { id: "service", label: "Service areas", detail: "Postcodes and travel radius" },
  { id: "quotes", label: "Quote defaults", detail: "Email and standard terms" },
  { id: "notifications", label: "Notifications", detail: "Capacity and account emails" },
  { id: "templates", label: "Templates", detail: "Quote and invoice preview" },
  { id: "closure", label: "Close account", detail: "Access and retained records" },
];

const themeOptions: Record<
  TradeBrandThemeKey,
  { label: string; gradient: string; ink: string }
> = {
  emerald_navy: {
    label: "Emerald navy",
    gradient: "linear-gradient(135deg, #062d3d 0%, #0d8f78 100%)",
    ink: "#ffffff",
  },
  ocean_mint: {
    label: "Ocean mint",
    gradient: "linear-gradient(135deg, #0b4a6b 0%, #2bc9a8 100%)",
    ink: "#ffffff",
  },
  cobalt_aqua: {
    label: "Cobalt aqua",
    gradient: "linear-gradient(135deg, #16378b 0%, #19b8c9 100%)",
    ink: "#ffffff",
  },
  violet_sunset: {
    label: "Violet sunset",
    gradient: "linear-gradient(135deg, #4b2a84 0%, #e3787b 100%)",
    ink: "#ffffff",
  },
  amber_ink: {
    label: "Amber ink",
    gradient: "linear-gradient(135deg, #b36d08 0%, #162533 100%)",
    ink: "#ffffff",
  },
  charcoal_silver: {
    label: "Charcoal silver",
    gradient: "linear-gradient(135deg, #111827 0%, #64748b 100%)",
    ink: "#ffffff",
  },
};

export function tradeBusinessThemeGradient(
  themeKey?: TradeBrandThemeKey,
) {
  return themeOptions[themeKey || DEFAULT_TRADE_BRAND_THEME].gradient;
}

const borderOptions: Record<
  TradeBrandBorderStyle,
  { label: string; detail: string; radius: number }
> = {
  soft: { label: "Soft corners", detail: "Balanced and professional", radius: 14 },
  square: { label: "Square", detail: "Structured document edges", radius: 2 },
  rounded: { label: "Rounded", detail: "Friendly, modern cards", radius: 26 },
};

const settingsShellStyle: CSSProperties = {
  display: "grid",
  gap: 16,
};

const settingsNavStyle: CSSProperties = {
  display: "grid",
  gap: 8,
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
};

const settingsNavButtonStyle: CSSProperties = {
  alignItems: "flex-start",
  background: "#f5faf8",
  border: "1px solid #cfe0da",
  borderRadius: 12,
  color: "#173f34",
  cursor: "pointer",
  display: "flex",
  flexDirection: "column",
  gap: 4,
  minHeight: 70,
  padding: "12px 13px",
  textAlign: "left",
};

const settingsNavActiveStyle: CSSProperties = {
  ...settingsNavButtonStyle,
  background: "#073746",
  borderColor: "#0d8f78",
  boxShadow: "0 8px 22px rgba(3, 35, 48, .16)",
  color: "#ffffff",
};

const summaryGridStyle: CSSProperties = {
  display: "grid",
  gap: 10,
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
};

const summaryCardStyle: CSSProperties = {
  background: "#f6faf8",
  border: "1px solid #d7e5df",
  borderRadius: 12,
  display: "grid",
  gap: 5,
  minHeight: 78,
  padding: 14,
};

const fieldGridStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
};

const fieldStyle: CSSProperties = {
  color: "#173f34",
  display: "grid",
  fontSize: ".72rem",
  fontWeight: 800,
  gap: 7,
};

const controlStyle: CSSProperties = {
  background: "#ffffff",
  border: "1.5px solid #bcd3ca",
  borderRadius: 10,
  color: "#163c32",
  minHeight: 44,
  padding: "10px 12px",
  width: "100%",
};

function initialServiceAreas(profile: TradeBusinessSettingsProfile) {
  if (profile.serviceAreas?.length) {
    return profile.serviceAreas.slice(0, 6).map((area) => ({
      id: area.id,
      postcode: area.postcode,
      radiusKm: Number(area.radiusKm || 50),
    }));
  }
  return [
    {
      postcode: profile.serviceBasePostcode || profile.postcode,
      radiusKm: Number(profile.serviceRadiusKm || 50),
    },
  ];
}

function accountTypeLabel(partnerType: TradeBusinessSettingsProfile["partnerType"]) {
  return partnerType === "supplier"
    ? "Product supplier or wholesaler"
    : "Licensed installer";
}

function verificationLabel(status: string) {
  if (status === "approved") return "Approved";
  if (status === "under_review") return "Under review";
  if (status === "needs_information") return "More information needed";
  return "Review not completed";
}

function statusMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function safeBusinessWebsiteHref(value: unknown) {
  if (typeof value !== "string") return "";
  const candidate = value.trim();
  if (
    !candidate
    || candidate.length > 300
    || /[\u0000-\u001f\u007f]/.test(candidate)
  ) return "";
  try {
    const website = new URL(candidate);
    if (
      website.protocol !== "https:"
      || !website.hostname
      || website.username
      || website.password
    ) return "";
    const canonical = website.toString();
    return canonical.length <= 300 ? canonical : "";
  } catch {
    return "";
  }
}

export function TradeBusinessSettingsWorkspace({
  user,
  profile,
  onProfileChange,
  onAccountClosed,
}: Props) {
  const [section, setSection] = useState<SettingsSection>("account");
  const [availabilityStatus, setAvailabilityStatus] =
    useState<AvailabilityStatus>(profile.availabilityStatus);
  const [emailOpportunities, setEmailOpportunities] = useState(
    profile.emailOpportunities !== false,
  );
  const [emailWeeklySummary, setEmailWeeklySummary] = useState(
    profile.emailWeeklySummary !== false,
  );
  const [serviceAreas, setServiceAreas] = useState<ServiceArea[]>(() =>
    initialServiceAreas(profile),
  );
  const [brandThemeKey, setBrandThemeKey] = useState<TradeBrandThemeKey>(
    profile.brandThemeKey || DEFAULT_TRADE_BRAND_THEME,
  );
  const [brandBorderStyle, setBrandBorderStyle] =
    useState<TradeBrandBorderStyle>(
      profile.brandBorderStyle || DEFAULT_TRADE_BRAND_BORDER,
    );
  const [quoteEmailSubjectTemplate, setQuoteEmailSubjectTemplate] = useState(
    profile.quoteEmailSubjectTemplate || DEFAULT_QUOTE_EMAIL_SUBJECT,
  );
  const [quoteEmailIntro, setQuoteEmailIntro] = useState(
    profile.quoteEmailIntro || DEFAULT_QUOTE_EMAIL_INTRO,
  );
  const [quoteDefaultTerms, setQuoteDefaultTerms] = useState(
    profile.quoteDefaultTerms || "",
  );
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [mediaBusy, setMediaBusy] = useState<"" | "logo" | "banner">("");
  const [mediaStatus, setMediaStatus] = useState("");
  const [logoPreview, setLogoPreview] = useState("");
  const [bannerPreview, setBannerPreview] = useState("");
  const [templateKind, setTemplateKind] = useState<"quote" | "invoice">(
    "quote",
  );
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [closeConfirmation, setCloseConfirmation] = useState("");
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeStatus, setCloseStatus] = useState("");
  const closeDialogRef = useRef<HTMLElement>(null);
  const closeKeepButtonRef = useRef<HTMLButtonElement>(null);
  const closeTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!closeOpen) return;
    const previousBodyOverflow = document.body.style.overflow;
    const returnTarget = closeTriggerRef.current
      || (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      closeKeepButtonRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousBodyOverflow;
      if (returnTarget?.isConnected) returnTarget.focus();
    };
  }, [closeOpen]);

  useEffect(() => {
    if (!profile.logoMediaUrl) return;
    const controller = new AbortController();
    let active = true;
    void user
      .getIdToken()
      .then((token) =>
        fetch(profile.logoMediaUrl || "", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        }),
      )
      .then((response) => {
        if (!response.ok) throw new Error("Logo could not be loaded.");
        return response.blob();
      })
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        if (active) setLogoPreview(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      controller.abort();
    };
  }, [profile.logoMediaUrl, user]);

  useEffect(() => {
    if (!profile.bannerMediaUrl) return;
    const controller = new AbortController();
    let active = true;
    void user
      .getIdToken()
      .then((token) =>
        fetch(profile.bannerMediaUrl || "", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        }),
      )
      .then((response) => {
        if (!response.ok) throw new Error("Banner could not be loaded.");
        return response.blob();
      })
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        if (active) setBannerPreview(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      controller.abort();
    };
  }, [profile.bannerMediaUrl, user]);

  useEffect(
    () => () => {
      if (logoPreview) URL.revokeObjectURL(logoPreview);
    },
    [logoPreview],
  );

  useEffect(
    () => () => {
      if (bannerPreview) URL.revokeObjectURL(bannerPreview);
    },
    [bannerPreview],
  );

  const selectedTheme = themeOptions[brandThemeKey];
  const selectedBorder = borderOptions[brandBorderStyle];
  const businessWebsiteHref = useMemo(
    () => safeBusinessWebsiteHref(profile.businessWebsite),
    [profile.businessWebsite],
  );
  const accountInitials = useMemo(
    () =>
      profile.businessName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || "TL",
    [profile.businessName],
  );

  function updateArea(
    index: number,
    change: Partial<Pick<ServiceArea, "postcode" | "radiusKm">>,
  ) {
    setServiceAreas((current) =>
      current.map((area, areaIndex) =>
        areaIndex === index ? { ...area, ...change } : area,
      ),
    );
  }

  function addServiceArea() {
    setServiceAreas((current) =>
      current.length >= 6
        ? current
        : [...current, { postcode: "", radiusKm: 50 }],
    );
  }

  function removeServiceArea(index: number) {
    setServiceAreas((current) =>
      current.length === 1
        ? current
        : current.filter((_, areaIndex) => areaIndex !== index),
    );
  }

  function validateSettings() {
    if (!serviceAreas.length || serviceAreas.length > 6) {
      return "Keep between one and six service areas.";
    }
    if (
      serviceAreas.some(
        (area) =>
          !/^\d{4}$/.test(area.postcode) ||
          !Number.isInteger(area.radiusKm) ||
          area.radiusKm < 10 ||
          area.radiusKm > 1000,
      )
    ) {
      return "Each service area needs a four digit postcode and a radius from 10 to 1,000 kilometres.";
    }
    if (new Set(serviceAreas.map((area) => area.postcode)).size !== serviceAreas.length) {
      return "Use each service postcode once.";
    }
    if (!quoteEmailSubjectTemplate.trim()) {
      return "Enter a quote email subject.";
    }
    if (!quoteEmailIntro.trim()) {
      return "Enter a quote email introduction.";
    }
    return "";
  }

  async function saveSettings(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const validationError = validateSettings();
    if (validationError) {
      setSaveStatus(validationError);
      return;
    }

    setSaveBusy(true);
    setSaveStatus("Saving business settings...");
    const primaryArea = serviceAreas[0];
    const payload = {
      availabilityStatus,
      emailOpportunities,
      emailWeeklySummary,
      serviceBasePostcode: primaryArea.postcode,
      serviceRadiusKm: primaryArea.radiusKm,
      serviceAreas: serviceAreas.map((area) => ({
        postcode: area.postcode,
        radiusKm: area.radiusKm,
      })),
      brandThemeKey,
      brandBorderStyle,
      quoteEmailSubjectTemplate: quoteEmailSubjectTemplate.trim(),
      quoteEmailIntro: quoteEmailIntro.trim(),
      quoteDefaultTerms: quoteDefaultTerms.trim(),
    };

    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        throw new Error(
          result.error || "The business settings could not be saved.",
        );
      }
      onProfileChange(payload);
      setSaveStatus("Business settings saved.");
    } catch (error) {
      setSaveStatus(
        statusMessage(error, "The business settings could not be saved."),
      );
    } finally {
      setSaveBusy(false);
    }
  }

  async function uploadMedia(kind: "logo" | "banner", file: File | null) {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setMediaStatus("Choose a PNG or JPEG image.");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setMediaStatus("Choose an image smaller than 3 MB.");
      return;
    }

    setMediaBusy(kind);
    setMediaStatus(`Uploading ${kind}...`);
    try {
      const token = await user.getIdToken();
      const formData = new FormData();
      formData.append("kind", kind);
      formData.append("file", file);
      const response = await fetch("/api/trade-profile-media", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        throw new Error(result.error || `The ${kind} could not be uploaded.`);
      }
      const nextPreview = URL.createObjectURL(file);
      if (kind === "logo") {
        setLogoPreview(nextPreview);
        onProfileChange({
          hasLogo: true,
          logoMediaUrl: "/api/trade-profile-media?kind=logo",
        });
      } else {
        setBannerPreview(nextPreview);
        onProfileChange({
          hasBanner: true,
          bannerMediaUrl: "/api/trade-profile-media?kind=banner",
        });
      }
      setMediaStatus(`${kind === "logo" ? "Logo" : "Banner"} uploaded.`);
    } catch (error) {
      setMediaStatus(
        statusMessage(error, `The ${kind} could not be uploaded.`),
      );
    } finally {
      setMediaBusy("");
    }
  }

  async function closeAccount() {
    if (closeConfirmation !== "CLOSE ACCOUNT") {
      setCloseStatus('Type "CLOSE ACCOUNT" to confirm.');
      return;
    }
    setCloseBusy(true);
    setCloseStatus("Closing account access...");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch("/api/trade-profile", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          confirmation: closeConfirmation,
          reason: closeReason.trim(),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "The account could not be closed.");
      }
      setCloseStatus("Account access closed.");
      onAccountClosed();
    } catch (error) {
      setCloseStatus(statusMessage(error, "The account could not be closed."));
    } finally {
      setCloseBusy(false);
    }
  }

  function dismissCloseDialog() {
    if (closeBusy) return;
    setCloseOpen(false);
    setCloseStatus("");
  }

  function handleCloseDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      dismissCloseDialog();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      closeDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ) || [],
    );
    if (!focusable.length) {
      event.preventDefault();
      closeDialogRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeElement = document.activeElement;
    if (!closeDialogRef.current?.contains(activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const templateRadius = selectedBorder.radius;
  const previewSurfaceStyle: CSSProperties = {
    background: "#ffffff",
    border: "1px solid #cbded6",
    borderRadius: templateRadius,
    boxShadow: "0 16px 36px rgba(4, 36, 46, .13)",
    maxWidth: 760,
    overflow: "hidden",
  };

  return (
    <section
      className="dashboard-panel dashboard-settings"
      aria-labelledby="business-settings-title"
    >
      <div className="dashboard-panel-heading">
        <span>Business settings</span>
        <h2 id="business-settings-title">Your account, brand and documents</h2>
        <p>
          Manage the business once. The same saved details flow into work,
          customer documents and account communication.
        </p>
      </div>

      <div style={settingsShellStyle}>
        <nav style={settingsNavStyle} aria-label="Business settings sections">
          {sectionOptions.map((option) => {
            const active = section === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-current={active ? "page" : undefined}
                style={active ? settingsNavActiveStyle : settingsNavButtonStyle}
                onClick={() => {
                  setSection(option.id);
                  setSaveStatus("");
                }}
              >
                <strong style={{ fontSize: ".76rem" }}>{option.label}</strong>
                <small
                  style={{
                    color: active ? "#b9e8db" : "#667b74",
                    fontSize: ".64rem",
                    lineHeight: 1.35,
                  }}
                >
                  {option.detail}
                </small>
              </button>
            );
          })}
        </nav>

        {section === "account" && (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={summaryGridStyle}>
              <article style={summaryCardStyle}>
                <span
                  style={{
                    color: "#0a7a59",
                    fontSize: ".62rem",
                    fontWeight: 900,
                    textTransform: "uppercase",
                  }}
                >
                  Account type
                </span>
                <strong>{accountTypeLabel(profile.partnerType)}</strong>
                <small style={{ color: "#63776f", lineHeight: 1.4 }}>
                  Fixed when the business account is created
                </small>
              </article>
              <article style={summaryCardStyle}>
                <span
                  style={{
                    color: "#0a7a59",
                    fontSize: ".62rem",
                    fontWeight: 900,
                    textTransform: "uppercase",
                  }}
                >
                  Verification
                </span>
                <strong>{verificationLabel(profile.verificationStatus)}</strong>
                <small style={{ color: "#63776f", lineHeight: 1.4 }}>
                  {profile.accountStatus === "active"
                    ? "Account access is active"
                    : `Account status: ${profile.accountStatus.replaceAll("_", " ")}`}
                </small>
              </article>
              <article style={summaryCardStyle}>
                <span
                  style={{
                    color: "#0a7a59",
                    fontSize: ".62rem",
                    fontWeight: 900,
                    textTransform: "uppercase",
                  }}
                >
                  Account contact
                </span>
                <strong>{profile.contactName || profile.businessName}</strong>
                <small style={{ color: "#63776f", lineHeight: 1.4 }}>
                  {profile.phone || "Contact number not set"}
                </small>
              </article>
            </div>
            <div style={summaryCardStyle}>
              <strong>{profile.businessName}</strong>
              <span style={{ color: "#4f665e", fontSize: ".72rem" }}>
                {[profile.addressLine1, profile.suburb, profile.addressState, profile.postcode]
                  .filter(Boolean)
                  .join(", ")}
              </span>
              {businessWebsiteHref && (
                <a
                  href={businessWebsiteHref}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#08794c", fontSize: ".7rem", fontWeight: 800 }}
                >
                  Open business website
                </a>
              )}
            </div>
            <div className="dashboard-account-links">
              <a href="/direct-trade/partners">
                <strong>Edit business identity</strong>
                <span>
                  Update contact details, address, capabilities and service
                  states. The account type remains fixed.
                </span>
              </a>
              <a href="/direct-trade/dashboard/verification">
                <strong>Verification centre</strong>
                <span>
                  Review evidence, licences and the current approval status.
                </span>
              </a>
            </div>
          </div>
        )}

        {section === "appearance" && (
          <form onSubmit={saveSettings} style={{ display: "grid", gap: 18 }}>
            <fieldset>
              <legend>Business images</legend>
              <div style={fieldGridStyle}>
                <label style={fieldStyle}>
                  <span>Logo</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    disabled={Boolean(mediaBusy)}
                    onChange={(event) =>
                      void uploadMedia("logo", event.target.files?.[0] || null)
                    }
                    style={controlStyle}
                  />
                  <small style={{ color: "#667b74", lineHeight: 1.4 }}>
                    PNG or JPEG, up to 3 MB.{" "}
                    {profile.hasLogo ? "A logo is saved." : "No logo saved yet."}
                  </small>
                </label>
                <label style={fieldStyle}>
                  <span>Document banner</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    disabled={Boolean(mediaBusy)}
                    onChange={(event) =>
                      void uploadMedia("banner", event.target.files?.[0] || null)
                    }
                    style={controlStyle}
                  />
                  <small style={{ color: "#667b74", lineHeight: 1.4 }}>
                    PNG or JPEG, up to 3 MB.{" "}
                    {profile.hasBanner
                      ? "A banner is saved."
                      : "No banner saved yet."}
                  </small>
                </label>
              </div>
              {mediaStatus && (
                <p className="dashboard-settings-status" role="status">
                  {mediaStatus}
                </p>
              )}
            </fieldset>

            <fieldset>
              <legend>Workspace and document colour</legend>
              <div className="dashboard-choice-grid">
                {TRADE_BRAND_THEME_KEYS.map((themeKey) => {
                  const theme = themeOptions[themeKey];
                  return (
                    <label
                      key={themeKey}
                      className={brandThemeKey === themeKey ? "selected" : ""}
                    >
                      <input
                        type="radio"
                        name="brand-theme"
                        value={themeKey}
                        checked={brandThemeKey === themeKey}
                        onChange={() => setBrandThemeKey(themeKey)}
                      />
                      <span>
                        <i
                          aria-hidden="true"
                          style={{
                            background: theme.gradient,
                            border: "1px solid rgba(0,0,0,.12)",
                            borderRadius: 999,
                            display: "block",
                            height: 25,
                            marginBottom: 7,
                            width: 58,
                          }}
                        />
                        <strong>{theme.label}</strong>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <fieldset>
              <legend>Border style</legend>
              <div className="dashboard-choice-grid">
                {TRADE_BRAND_BORDER_STYLES.map((borderKey) => (
                  <label
                    key={borderKey}
                    className={
                      brandBorderStyle === borderKey ? "selected" : ""
                    }
                  >
                    <input
                      type="radio"
                      name="brand-border"
                      value={borderKey}
                      checked={brandBorderStyle === borderKey}
                      onChange={() => setBrandBorderStyle(borderKey)}
                    />
                    <span>
                      <strong>{borderOptions[borderKey].label}</strong>
                      <small>{borderOptions[borderKey].detail}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button className="btn" disabled={saveBusy || Boolean(mediaBusy)}>
              {saveBusy ? "Saving..." : "Save appearance"}
            </button>
          </form>
        )}

        {section === "service" && (
          <form onSubmit={saveSettings} style={{ display: "grid", gap: 16 }}>
            <div>
              <strong style={{ color: "#173f34", fontSize: ".82rem" }}>
                Serviceability
              </strong>
              <p
                style={{
                  color: "#61766f",
                  fontSize: ".7rem",
                  lineHeight: 1.55,
                  margin: "5px 0 0",
                }}
              >
                Add up to six postcode centres. Each radius uses the postcode
                centroid for matching and planning.
              </p>
            </div>
            {serviceAreas.map((area, index) => (
              <fieldset
                key={area.id || `service-area-${index}`}
                style={{
                  background: "#f6faf8",
                  border: "1px solid #d2e2dc",
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <legend style={{ padding: "0 5px" }}>
                  Service area {index + 1}
                </legend>
                <div style={fieldGridStyle}>
                  <label style={fieldStyle}>
                    <span>Base postcode</span>
                    <input
                      required
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]{4}"
                      maxLength={4}
                      value={area.postcode}
                      onChange={(event) =>
                        updateArea(index, {
                          postcode: event.target.value
                            .replace(/\D/g, "")
                            .slice(0, 4),
                        })
                      }
                      style={controlStyle}
                    />
                  </label>
                  <label style={fieldStyle}>
                    <span>Maximum radius: {area.radiusKm} km</span>
                    <input
                      type="range"
                      min="10"
                      max="1000"
                      step="10"
                      value={area.radiusKm}
                      onChange={(event) =>
                        updateArea(index, {
                          radiusKm: Number(event.target.value),
                        })
                      }
                      style={{ ...controlStyle, accentColor: "#0b8f67" }}
                    />
                  </label>
                </div>
                {serviceAreas.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeServiceArea(index)}
                    style={{
                      background: "transparent",
                      border: 0,
                      color: "#9b3535",
                      cursor: "pointer",
                      fontSize: ".68rem",
                      fontWeight: 850,
                      marginTop: 10,
                      padding: 0,
                      textDecoration: "underline",
                    }}
                  >
                    Remove this area
                  </button>
                )}
              </fieldset>
            ))}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button
                type="button"
                className="btn"
                disabled={serviceAreas.length >= 6}
                onClick={addServiceArea}
              >
                Add service area
              </button>
              <button className="btn" disabled={saveBusy}>
                {saveBusy ? "Saving..." : "Save service areas"}
              </button>
            </div>
          </form>
        )}

        {section === "quotes" && (
          <form onSubmit={saveSettings} style={{ display: "grid", gap: 16 }}>
            <label style={fieldStyle}>
              <span>Default quote email subject</span>
              <input
                required
                type="text"
                maxLength={180}
                value={quoteEmailSubjectTemplate}
                onChange={(event) =>
                  setQuoteEmailSubjectTemplate(event.target.value)
                }
                style={controlStyle}
              />
              <small style={{ color: "#667b74", lineHeight: 1.45 }}>
                Available fields: {"{business_name}"}, {"{quote_number}"} and{" "}
                {"{customer_name}"}.
              </small>
            </label>
            <label style={fieldStyle}>
              <span>Default email introduction</span>
              <textarea
                required
                rows={4}
                maxLength={800}
                value={quoteEmailIntro}
                onChange={(event) => setQuoteEmailIntro(event.target.value)}
                style={controlStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span>Default quote terms</span>
              <textarea
                rows={6}
                maxLength={4000}
                value={quoteDefaultTerms}
                onChange={(event) => setQuoteDefaultTerms(event.target.value)}
                placeholder="Scope assumptions, exclusions, payment and completion terms"
                style={controlStyle}
              />
              <small style={{ color: "#667b74", lineHeight: 1.45 }}>
                These defaults can be edited on each quote before it is issued.
              </small>
            </label>
            <button className="btn" disabled={saveBusy}>
              {saveBusy ? "Saving..." : "Save quote defaults"}
            </button>
          </form>
        )}

        {section === "notifications" && (
          <form onSubmit={saveSettings} style={{ display: "grid", gap: 18 }}>
            {profile.partnerType === "installer" && (
              <fieldset>
                <legend>Current availability</legend>
                <div className="dashboard-choice-grid">
                  {(
                    [
                      ["open", "Open to suitable work", "Include the business in verified matching."],
                      ["limited", "Limited capacity", "Remain eligible with reduced allocation."],
                      ["paused", "Paused", "Do not include the business in matching."],
                    ] as const
                  ).map(([value, label, detail]) => (
                    <label
                      key={value}
                      className={
                        availabilityStatus === value ? "selected" : ""
                      }
                    >
                      <input
                        type="radio"
                        name="availability"
                        value={value}
                        checked={availabilityStatus === value}
                        onChange={() => setAvailabilityStatus(value)}
                      />
                      <span>
                        <strong>{label}</strong>
                        <small>{detail}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <fieldset>
              <legend>Email preferences</legend>
              <div className="dashboard-notification-list">
                <label>
                  <input
                    type="checkbox"
                    checked={emailOpportunities}
                    onChange={(event) =>
                      setEmailOpportunities(event.target.checked)
                    }
                  />
                  <span>
                    <strong>
                      {profile.partnerType === "supplier"
                        ? "Trade request and order emails"
                        : "Opportunity and customer response emails"}
                    </strong>
                    <small>
                      Send important work and customer updates to the account
                      contact.
                    </small>
                  </span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={emailWeeklySummary}
                    onChange={(event) =>
                      setEmailWeeklySummary(event.target.checked)
                    }
                  />
                  <span>
                    <strong>Weekly account summary</strong>
                    <small>
                      Receive one concise update covering readiness and account
                      activity.
                    </small>
                  </span>
                </label>
              </div>
            </fieldset>
            <button className="btn" disabled={saveBusy}>
              {saveBusy ? "Saving..." : "Save notifications"}
            </button>
          </form>
        )}

        {section === "templates" && (
          <div style={{ display: "grid", gap: 14 }}>
            <div
              style={{
                alignItems: "center",
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                justifyContent: "space-between",
              }}
            >
              <div>
                <strong style={{ color: "#173f34", fontSize: ".82rem" }}>
                  Customer document preview
                </strong>
                <p
                  style={{
                    color: "#61766f",
                    fontSize: ".68rem",
                    margin: "4px 0 0",
                  }}
                >
                  Issued documents keep the branding and business identity used
                  at the time.
                </p>
              </div>
              <div
                role="group"
                aria-label="Preview document type"
                style={{ display: "flex", gap: 7 }}
              >
                {(["quote", "invoice"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className="btn"
                    aria-pressed={templateKind === kind}
                    onClick={() => setTemplateKind(kind)}
                    style={{
                      opacity: templateKind === kind ? 1 : 0.65,
                      textTransform: "capitalize",
                    }}
                  >
                    {kind}
                  </button>
                ))}
              </div>
            </div>

            <div style={previewSurfaceStyle}>
              <header
                style={{
                  background: bannerPreview
                    ? `${selectedTheme.gradient}, url(${bannerPreview}) center/cover`
                    : selectedTheme.gradient,
                  color: selectedTheme.ink,
                  display: "grid",
                  gap: 14,
                  gridTemplateColumns: "auto 1fr",
                  padding: "24px 26px",
                }}
              >
                <div
                  style={{
                    alignItems: "center",
                    background: "#ffffff",
                    borderRadius: templateRadius,
                    color: "#073746",
                    display: "flex",
                    fontSize: ".8rem",
                    fontWeight: 950,
                    height: 52,
                    justifyContent: "center",
                    overflow: "hidden",
                    width: 52,
                  }}
                >
                  {logoPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoPreview}
                      alt=""
                      style={{
                        height: "100%",
                        objectFit: "contain",
                        width: "100%",
                      }}
                    />
                  ) : (
                    accountInitials
                  )}
                </div>
                <div>
                  <span
                    style={{
                      display: "block",
                      fontSize: ".62rem",
                      fontWeight: 850,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                    }}
                  >
                    {templateKind === "quote" ? "Quote from" : "Invoice from"}
                  </span>
                  <strong
                    style={{
                      display: "block",
                      fontSize: "1.18rem",
                      marginTop: 4,
                    }}
                  >
                    {profile.businessName}
                  </strong>
                  <small style={{ opacity: 0.82 }}>
                    {profile.phone || "Business contact"}{" "}
                    {businessWebsiteHref ? `| ${businessWebsiteHref}` : ""}
                  </small>
                </div>
              </header>
              <div style={{ display: "grid", gap: 14, padding: 24 }}>
                <div style={summaryGridStyle}>
                  <div>
                    <small
                      style={{
                        color: "#61766f",
                        display: "block",
                        fontWeight: 850,
                        textTransform: "uppercase",
                      }}
                    >
                      {templateKind}
                    </small>
                    <strong>
                      {templateKind === "quote"
                        ? "Q-TLJ-PREVIEW"
                        : "INV-TLJ-PREVIEW"}
                    </strong>
                  </div>
                  <div>
                    <small
                      style={{
                        color: "#61766f",
                        display: "block",
                        fontWeight: 850,
                        textTransform: "uppercase",
                      }}
                    >
                      Prepared for
                    </small>
                    <strong>Sample customer</strong>
                  </div>
                </div>
                <div
                  style={{
                    borderBottom: "1px solid #d7e5df",
                    borderTop: "1px solid #d7e5df",
                    display: "grid",
                    gap: 10,
                    padding: "16px 0",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      justifyContent: "space-between",
                    }}
                  >
                    <span>Installation and included work</span>
                    <strong>$4,040.00</strong>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      justifyContent: "space-between",
                    }}
                  >
                    <span>GST</span>
                    <strong>$404.00</strong>
                  </div>
                </div>
                <div
                  style={{
                    background: selectedTheme.gradient,
                    borderRadius: templateRadius,
                    color: selectedTheme.ink,
                    padding: 18,
                  }}
                >
                  <small
                    style={{
                      display: "block",
                      fontWeight: 850,
                      textTransform: "uppercase",
                    }}
                  >
                    Total
                  </small>
                  <strong style={{ display: "block", fontSize: "1.8rem" }}>
                    $4,444.00
                  </strong>
                </div>
                <small style={{ color: "#61766f", lineHeight: 1.5 }}>
                  This preview uses sample values. Customer, job, item and
                  payment details come from the saved work record.
                </small>
              </div>
            </div>
            <button
              type="button"
              className="btn"
              onClick={() => setSection("appearance")}
              style={{ justifySelf: "start" }}
            >
              Edit document appearance
            </button>
          </div>
        )}

        {section === "closure" && (
          <div style={{ display: "grid", gap: 14 }}>
            <div
              style={{
                background: "#fff7f1",
                border: "1px solid #edc9af",
                borderRadius: 12,
                color: "#5e3521",
                display: "grid",
                gap: 7,
                padding: 16,
              }}
            >
              <strong>Close this TLink account</strong>
              <p style={{ fontSize: ".72rem", lineHeight: 1.55, margin: 0 }}>
                Closing removes trade workspace access and editable business
                settings. Jobs, quotes, invoices, audit records and compliance
                records already created are retained for legal, operational
                and record keeping duties. An authorised TLink administrator
                can review a recovery request.
              </p>
            </div>
            <button
              ref={closeTriggerRef}
              type="button"
              onClick={() => {
                setCloseStatus("");
                setCloseOpen(true);
              }}
              style={{
                background: "#8e2c2c",
                border: 0,
                borderRadius: 10,
                color: "#ffffff",
                cursor: "pointer",
                fontSize: ".72rem",
                fontWeight: 900,
                justifySelf: "start",
                minHeight: 44,
                padding: "10px 15px",
              }}
            >
              Close account and remove access
            </button>
          </div>
        )}

        {saveStatus && section !== "closure" && (
          <p className="dashboard-settings-status" role="status">
            {saveStatus}
          </p>
        )}
      </div>

      {closeOpen && (
        <div
          role="presentation"
          style={{
            alignItems: "center",
            background: "rgba(2, 22, 31, .72)",
            display: "flex",
            inset: 0,
            justifyContent: "center",
            padding: 20,
            position: "fixed",
            zIndex: 1000,
          }}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) dismissCloseDialog();
          }}
        >
          <section
            ref={closeDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-trade-account-title"
            aria-describedby="close-trade-account-description"
            aria-busy={closeBusy}
            tabIndex={-1}
            onKeyDown={handleCloseDialogKeyDown}
            style={{
              background: "#ffffff",
              border: "1px solid #d5e3dd",
              borderRadius: 16,
              boxShadow: "0 28px 70px rgba(0, 15, 24, .3)",
              display: "grid",
              gap: 14,
              maxWidth: 560,
              padding: 22,
              width: "100%",
            }}
          >
            <div>
              <span
                style={{
                  color: "#9b3535",
                  fontSize: ".64rem",
                  fontWeight: 900,
                  textTransform: "uppercase",
                }}
              >
                Account closure
              </span>
              <h3 id="close-trade-account-title" style={{ marginTop: 5 }}>
                Remove business access?
              </h3>
              <p
                id="close-trade-account-description"
                style={{
                  color: "#5e716a",
                  fontSize: ".72rem",
                  lineHeight: 1.55,
                  margin: "7px 0 0",
                }}
              >
                Trade workspace access and editable settings are removed.
                Existing operational and compliance records remain retained.
                Recovery requires an authorised administrator review.
              </p>
            </div>
            <label style={fieldStyle}>
              <span>Reason, optional</span>
              <textarea
                rows={3}
                maxLength={500}
                value={closeReason}
                onChange={(event) => setCloseReason(event.target.value)}
                style={controlStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span>Type CLOSE ACCOUNT to confirm</span>
              <input
                type="text"
                value={closeConfirmation}
                onChange={(event) => setCloseConfirmation(event.target.value)}
                autoComplete="off"
                style={controlStyle}
              />
            </label>
            {closeStatus && (
              <p className="dashboard-settings-status" role="status">
                {closeStatus}
              </p>
            )}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 9,
                justifyContent: "flex-end",
              }}
            >
              <button
                ref={closeKeepButtonRef}
                type="button"
                className="btn"
                disabled={closeBusy}
                onClick={dismissCloseDialog}
              >
                Keep account
              </button>
              <button
                type="button"
                disabled={
                  closeBusy || closeConfirmation !== "CLOSE ACCOUNT"
                }
                onClick={() => void closeAccount()}
                style={{
                  background: "#8e2c2c",
                  border: 0,
                  borderRadius: 10,
                  color: "#ffffff",
                  cursor: closeBusy ? "wait" : "pointer",
                  fontSize: ".72rem",
                  fontWeight: 900,
                  minHeight: 44,
                  opacity:
                    closeConfirmation === "CLOSE ACCOUNT" ? 1 : 0.55,
                  padding: "10px 15px",
                }}
              >
                {closeBusy ? "Closing..." : "Close account"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
