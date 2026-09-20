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
import dynamic from "next/dynamic";
import Image from "next/image";

const TradeDocumentSamplePreview = dynamic(() => import("./TradeDocumentSamplePreview").then(module => module.TradeDocumentSamplePreview));
const TradeCreditexOnboarding = dynamic(() => import("./TradeTrainingWorkspace").then((module) => module.TradeCreditexOnboarding), { loading: () => <p role="status">Loading Creditex onboarding...</p> });
import {
  DEFAULT_QUOTE_EMAIL_INTRO,
  DEFAULT_QUOTE_EMAIL_SUBJECT,
  DEFAULT_TRADE_BRAND_BORDER,
  DEFAULT_TRADE_BRAND_THEME,
  TRADE_BRAND_BORDER_STYLES,
  TRADE_BRAND_THEME_KEYS,
  TRADE_BRAND_THEME_OPTIONS,
  type TradeBrandBorderStyle,
  type TradeBrandThemeKey,
} from "@/lib/trade-business-branding";
import {
  ENERGY_SERVICE_CATALOGUE,
  savedEnergyServiceIds,
} from "@/lib/energy-service-catalogue.mjs";
import { AUSTRALIAN_STATE_OPTIONS, canonicalAustralianState } from "@/lib/australian-postcodes.mjs";

type AvailabilityStatus = "open" | "limited" | "paused";

type ServiceArea = {
  id?: string;
  postcode: string;
  radiusKm: number;
};

export type TradeBusinessSettingsProfile = {
  businessName: string;
  accountEmail?: string;
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
  documentBusinessName?: string;
  documentPhone?: string;
  documentEmail?: string;
  documentDisplayBusinessName?: string;
  documentDisplayPhone?: string;
  documentDisplayEmail?: string;
  bannerCropXBasisPoints?: number;
  bannerCropYBasisPoints?: number;
  bannerCropWidthBasisPoints?: number;
  bannerCropHeightBasisPoints?: number;
  quoteEmailSubjectTemplate?: string;
  quoteEmailIntro?: string;
  quoteDefaultTerms?: string;
  invoicePaymentAccountName?: string;
  invoicePaymentBsb?: string;
  invoicePaymentAccountNumber?: string;
  invoicePaymentReference?: string;
  invoiceDefaultTerms?: string;
  accountClosedAt?: string;
};

type SettingsSection =
  | "account"
  | "team"
  | "appearance"
  | "documents"
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
  { id: "team", label: "Team", detail: "People, access and files" },
  { id: "appearance", label: "Appearance", detail: "Logo and colours" },
  { id: "documents", label: "Customer documents", detail: "Identity and payment" },
  { id: "service", label: "Services and areas", detail: "Business services and coverage" },
  { id: "quotes", label: "Quote defaults", detail: "Email and standard terms" },
  { id: "notifications", label: "Notifications", detail: "Capacity and account emails" },
  { id: "templates", label: "Templates", detail: "Quote and invoice preview" },
  { id: "closure", label: "Close account", detail: "Access and retained records" },
];

export function tradeBusinessThemeGradient(
  themeKey?: TradeBrandThemeKey,
) {
  return TRADE_BRAND_THEME_OPTIONS[themeKey || DEFAULT_TRADE_BRAND_THEME].gradient;
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

const summaryGridStyle: CSSProperties = {
  display: "grid",
  gap: 10,
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
};

const summaryCardStyle: CSSProperties = {
  background: "var(--trade-surface-soft)",
  border: "1px solid var(--trade-line)",
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
  color: "var(--trade-ink)",
  display: "grid",
  fontSize: ".72rem",
  fontWeight: 800,
  gap: 7,
};

const controlStyle: CSSProperties = {
  background: "var(--trade-field)",
  border: "1.5px solid var(--trade-line)",
  borderRadius: 10,
  color: "var(--trade-field-ink)",
  minHeight: 44,
  padding: "10px 12px",
  width: "100%",
};

function visibleServiceStates(profile: Pick<TradeBusinessSettingsProfile, "serviceStates" | "addressState">) {
  const declared = [...new Set(profile.serviceStates.map(canonicalAustralianState).filter((state): state is string => Boolean(state)))];
  const addressState = canonicalAustralianState(profile.addressState);
  return declared.length ? declared : addressState ? [addressState] : [];
}

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
  const [serviceStates, setServiceStates] = useState<string[]>(() => visibleServiceStates(profile));
  const [capabilities, setCapabilities] = useState<string[]>(() =>
    savedEnergyServiceIds(profile.capabilities),
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
  const [documentBusinessName, setDocumentBusinessName] = useState(
    profile.documentBusinessName || "",
  );
  const [documentPhone, setDocumentPhone] = useState(
    profile.documentPhone || "",
  );
  const [documentEmail, setDocumentEmail] = useState(
    profile.documentEmail || "",
  );
  const [invoicePaymentAccountName, setInvoicePaymentAccountName] = useState(
    profile.invoicePaymentAccountName || "",
  );
  const [invoicePaymentBsb, setInvoicePaymentBsb] = useState(
    profile.invoicePaymentBsb || "",
  );
  const [invoicePaymentAccountNumber, setInvoicePaymentAccountNumber] =
    useState(profile.invoicePaymentAccountNumber || "");
  const [invoicePaymentReference, setInvoicePaymentReference] = useState(
    profile.invoicePaymentReference || "",
  );
  const [invoiceDefaultTerms, setInvoiceDefaultTerms] = useState(
    profile.invoiceDefaultTerms || "",
  );
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [saveSection, setSaveSection] = useState("");
  const [mediaBusy, setMediaBusy] = useState<"" | "logo">("");
  const [mediaStatus, setMediaStatus] = useState("");
  const [logoPreview, setLogoPreview] = useState("");
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

  useEffect(
    () => () => {
      if (logoPreview) URL.revokeObjectURL(logoPreview);
    },
    [logoPreview],
  );

  const businessWebsiteHref = useMemo(
    () => safeBusinessWebsiteHref(profile.businessWebsite),
    [profile.businessWebsite],
  );
  const documentDisplayBusinessName =
    documentBusinessName.trim() || profile.businessName;
  const documentDisplayPhone =
    documentPhone.trim() || profile.phone || "";
  const documentDisplayEmail =
    documentEmail.trim() || profile.accountEmail || "";
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

  function toggleCapability(capability: string) {
    setCapabilities((current) =>
      current.includes(capability)
        ? current.filter((item) => item !== capability)
        : [...current, capability],
    );
  }

  function validateSettings(targetSection: string) {
    if (targetSection === "service") {
      if (profile.partnerType === "installer" && !capabilities.length) {
        return "Choose at least one business service.";
      }
      if (profile.partnerType === "installer" && !serviceStates.length) {
        return "Choose at least one state or territory served by this business.";
      }
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
    }
    if (targetSection === "quotes") {
      if (!quoteEmailSubjectTemplate.trim()) {
        return "Enter a quote email subject.";
      }
      if (!quoteEmailIntro.trim()) {
        return "Enter a quote email introduction.";
      }
    }
    if (targetSection === "documents") {
      const phoneDigits = documentPhone.replace(/\D/g, "");
      if (documentPhone && (phoneDigits.length < 8 || phoneDigits.length > 15)) {
        return "Enter a valid customer-facing phone number, or leave it blank to use the account phone.";
      }
      if (
        documentEmail
        && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(documentEmail)
      ) {
        return "Enter a valid customer-facing email, or leave it blank to use the account email.";
      }
      const bankFields = [
        invoicePaymentAccountName,
        invoicePaymentBsb,
        invoicePaymentAccountNumber,
      ];
      if (bankFields.some((value) => value.trim()) && !bankFields.every((value) => value.trim())) {
        return "Add the payment account name, BSB and account number together, or leave all three blank.";
      }
    }
    return "";
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetSection = event.currentTarget.dataset.settingsSection || "";
    setSaveSection(targetSection);
    const validationError = validateSettings(targetSection);
    if (validationError) {
      setSaveStatus(validationError);
      return;
    }

    setSaveBusy(true);
    setSaveStatus("Saving business settings...");
    const payload: Partial<TradeBusinessSettingsProfile> =
      targetSection === "appearance"
        ? {
            brandThemeKey,
            brandBorderStyle,
          }
        : targetSection === "documents"
          ? {
              documentBusinessName: documentBusinessName.trim(),
              documentPhone: documentPhone.trim(),
              documentEmail: documentEmail.trim(),
              invoicePaymentAccountName: invoicePaymentAccountName.trim(),
              invoicePaymentBsb: invoicePaymentBsb.trim(),
              invoicePaymentAccountNumber:
                invoicePaymentAccountNumber.trim(),
              invoicePaymentReference: invoicePaymentReference.trim(),
              invoiceDefaultTerms: invoiceDefaultTerms.trim(),
            }
        : targetSection === "service"
          ? {
              capabilities,
              serviceStates,
              serviceBasePostcode: serviceAreas[0]?.postcode || "",
              serviceRadiusKm: serviceAreas[0]?.radiusKm || 50,
              serviceAreas: serviceAreas.map((area) => ({
                postcode: area.postcode,
                radiusKm: area.radiusKm,
              })),
            }
          : targetSection === "quotes"
            ? {
                quoteEmailSubjectTemplate:
                  quoteEmailSubjectTemplate.trim(),
                quoteEmailIntro: quoteEmailIntro.trim(),
                quoteDefaultTerms: quoteDefaultTerms.trim(),
              }
            : targetSection === "notifications"
              ? {
                  availabilityStatus,
                  emailOpportunities,
                  emailWeeklySummary,
                }
              : {};
    if (!Object.keys(payload).length) {
      setSaveBusy(false);
      setSaveStatus("Choose a business settings section to save.");
      return;
    }

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
      const savedSettings = result.settings as
        | Partial<TradeBusinessSettingsProfile>
        | undefined;
      onProfileChange(savedSettings || payload);
      if (savedSettings?.capabilities) {
        setCapabilities(savedEnergyServiceIds(savedSettings.capabilities));
      }
      if (savedSettings?.serviceStates) {
        setServiceStates(visibleServiceStates({ serviceStates: savedSettings.serviceStates, addressState: profile.addressState }));
      }
      if (savedSettings?.invoicePaymentBsb !== undefined) {
        setInvoicePaymentBsb(savedSettings.invoicePaymentBsb);
      }
      if (savedSettings?.invoicePaymentAccountNumber !== undefined) {
        setInvoicePaymentAccountNumber(
          savedSettings.invoicePaymentAccountNumber,
        );
      }
      setSaveStatus("Business settings saved.");
    } catch (error) {
      setSaveStatus(
        statusMessage(error, "The business settings could not be saved."),
      );
    } finally {
      setSaveBusy(false);
    }
  }

  async function uploadMedia(kind: "logo", file: File | null) {
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
      setLogoPreview(nextPreview);
      onProfileChange({ hasLogo: true, logoMediaUrl: "/api/trade-profile-media?kind=logo" });
      setMediaStatus("Logo uploaded.");
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
        {profile.partnerType === "installer" && <><TradeCreditexOnboarding user={user} businessName={profile.businessName} businessAddress={[profile.addressLine1, profile.suburb, profile.addressState, profile.postcode].filter(Boolean).join(", ")} /><p><a href="/direct-trade/dashboard?workspace=training">Open activity training and team completion status</a></p></>}
        <nav
          className="business-settings-jump-nav"
          aria-label="Jump to business settings section"
        >
          {sectionOptions.map((option) => (
            <a key={option.id} href={`#business-settings-${option.id}`}>
              <strong>{option.label}</strong>
              <small>{option.detail}</small>
            </a>
          ))}
        </nav>

        <section
          id="business-settings-account"
          className="business-settings-section"
          aria-labelledby="business-settings-account-title"
        >
          <header className="business-settings-section-heading">
            <span>Account</span>
            <h3 id="business-settings-account-title">
              Business identity and verification
            </h3>
            <p>
              Review the identity that controls workspace access and customer
              documents.
            </p>
          </header>
          <div style={{ display: "grid", gap: 14 }}>
            <div style={summaryGridStyle}>
              <article style={summaryCardStyle}>
                <span
                  style={{
                    color: "var(--trade-accent-readable)",
                    fontSize: ".62rem",
                    fontWeight: 900,
                    textTransform: "uppercase",
                  }}
                >
                  Account type
                </span>
                <strong>{accountTypeLabel(profile.partnerType)}</strong>
                <small style={{ color: "var(--trade-muted)", lineHeight: 1.4 }}>
                  Fixed when the business account is created
                </small>
              </article>
              <article style={summaryCardStyle}>
                <span
                  style={{
                    color: "var(--trade-accent-readable)",
                    fontSize: ".62rem",
                    fontWeight: 900,
                    textTransform: "uppercase",
                  }}
                >
                  Verification
                </span>
                <strong>{verificationLabel(profile.verificationStatus)}</strong>
                <small style={{ color: "var(--trade-muted)", lineHeight: 1.4 }}>
                  {profile.accountStatus === "active"
                    ? "Account access is active"
                    : `Account status: ${profile.accountStatus.replaceAll("_", " ")}`}
                </small>
              </article>
              <article style={summaryCardStyle}>
                <span
                  style={{
                    color: "var(--trade-accent-readable)",
                    fontSize: ".62rem",
                    fontWeight: 900,
                    textTransform: "uppercase",
                  }}
                >
                  Account contact
                </span>
                <strong>{profile.contactName || profile.businessName}</strong>
                <small style={{ color: "var(--trade-muted)", lineHeight: 1.4 }}>
                  {profile.phone || "Contact number not set"}
                </small>
              </article>
            </div>
            <div style={summaryCardStyle}>
              <strong>{profile.businessName}</strong>
              <span style={{ color: "var(--trade-muted)", fontSize: ".72rem" }}>
                {[profile.addressLine1, profile.suburb, profile.addressState, profile.postcode]
                  .filter(Boolean)
                  .join(", ")}
              </span>
              {businessWebsiteHref && (
                <a
                  href={businessWebsiteHref}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    color: "var(--trade-accent-readable)",
                    fontSize: ".84rem",
                    fontWeight: 800,
                  }}
                >
                  Open business website
                </a>
              )}
            </div>
            <div className="dashboard-account-links">
              <a href="/direct-trade/partners">
                <strong>Edit business identity</strong>
                <span>
                  Update contact details, address and registered service states.
                  The account type remains fixed.
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
        </section>

        {profile.partnerType === "installer" && (
          <section
            id="business-settings-team"
            className="business-settings-section"
            aria-labelledby="business-settings-team-title"
          >
            <header className="business-settings-section-heading">
              <span>Team</span>
              <h3 id="business-settings-team-title">People, access and member files</h3>
              <p>
                Add staff, control exactly what they can use and keep private ID,
                licence and compliance records with the right person.
              </p>
            </header>
            <div style={summaryCardStyle}>
              <strong>Team management has its own workspace</strong>
              <span style={{ color: "var(--trade-muted)", fontSize: ".84rem", lineHeight: 1.5 }}>
                Add people, assign access and manage private licence and compliance files from Team.
              </span>
              <a href="/direct-trade/dashboard?workspace=team" style={{ color: "var(--trade-accent-readable)", fontSize: ".86rem", fontWeight: 850 }}>
                Open Team
              </a>
            </div>
          </section>
        )}

        <section
          id="business-settings-appearance"
          className="business-settings-section"
          aria-labelledby="business-settings-appearance-title"
        >
          <header className="business-settings-section-heading">
            <span>Appearance</span>
            <h3 id="business-settings-appearance-title">
              Logo and colour theme
            </h3>
            <p>
              Apply one accessible visual identity across the workspace and
              customer documents.
            </p>
          </header>
          <form
            onSubmit={saveSettings}
            data-settings-section="appearance"
            style={{ display: "grid", gap: 18 }}
          >
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
                  <small style={{ color: "var(--trade-muted)", lineHeight: 1.4 }}>
                    PNG or JPEG, up to 3 MB.{" "}
                    {profile.hasLogo ? "A logo is saved." : "No logo saved yet."}
                  </small>
                </label>

              </div>
              {mediaStatus && (
                <p className="dashboard-settings-status" role="status">
                  {mediaStatus}
                </p>
              )}
              {logoPreview && <Image src={logoPreview} alt="Business logo preview" width={200} height={90} unoptimized style={{ objectFit: "contain", marginTop: 12 }} />}
              <p>Your logo appears at the top left of quotes and invoices.</p>
            </fieldset>

            <fieldset>
              <legend>Workspace and document colour</legend>
              <div className="dashboard-choice-grid">
                {TRADE_BRAND_THEME_KEYS.map((themeKey) => {
                  const theme = TRADE_BRAND_THEME_OPTIONS[themeKey];
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
            {saveStatus && saveSection === "appearance" && (
              <p className="dashboard-settings-status" role="status">
                {saveStatus}
              </p>
            )}
          </form>
        </section>

        <section
          id="business-settings-documents"
          className="business-settings-section"
          aria-labelledby="business-settings-documents-title"
        >
          <header className="business-settings-section-heading">
            <span>Customer documents</span>
            <h3 id="business-settings-documents-title">
              Trading identity and invoice payment
            </h3>
            <p>
              Set the contact details customers see without changing the
              registered TLink account identity. Blank contact fields fall
              back to the registered business details.
            </p>
          </header>
          <form
            onSubmit={saveSettings}
            data-settings-section="documents"
            style={{ display: "grid", gap: 18 }}
          >
            <fieldset>
              <legend>Shown on quotes and invoices</legend>
              <div style={fieldGridStyle}>
                <label style={fieldStyle}>
                  <span>Customer-facing business name</span>
                  <input
                    type="text"
                    maxLength={240}
                    value={documentBusinessName}
                    onChange={(event) =>
                      setDocumentBusinessName(event.target.value)
                    }
                    placeholder={profile.businessName}
                    style={controlStyle}
                  />
                </label>
                <label style={fieldStyle}>
                  <span>Customer enquiries phone</span>
                  <input
                    type="tel"
                    maxLength={60}
                    value={documentPhone}
                    onChange={(event) => setDocumentPhone(event.target.value)}
                    placeholder={profile.phone || "Registered account phone"}
                    style={controlStyle}
                  />
                </label>
                <label style={fieldStyle}>
                  <span>Customer enquiries email</span>
                  <input
                    type="email"
                    maxLength={254}
                    value={documentEmail}
                    onChange={(event) => setDocumentEmail(event.target.value)}
                    placeholder={profile.accountEmail || "Registered account email"}
                    style={controlStyle}
                  />
                </label>
              </div>
            </fieldset>
            <fieldset>
              <legend>Invoice payment details</legend>
              <div style={fieldGridStyle}>
                <label style={fieldStyle}>
                  <span>Account name</span>
                  <input
                    type="text"
                    maxLength={180}
                    value={invoicePaymentAccountName}
                    onChange={(event) =>
                      setInvoicePaymentAccountName(event.target.value)
                    }
                    style={controlStyle}
                  />
                </label>
                <label style={fieldStyle}>
                  <span>BSB</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={12}
                    value={invoicePaymentBsb}
                    onChange={(event) =>
                      setInvoicePaymentBsb(event.target.value)
                    }
                    placeholder="123-456"
                    style={controlStyle}
                  />
                </label>
                <label style={fieldStyle}>
                  <span>Account number</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={24}
                    value={invoicePaymentAccountNumber}
                    onChange={(event) =>
                      setInvoicePaymentAccountNumber(event.target.value)
                    }
                    style={controlStyle}
                  />
                </label>
                <label style={fieldStyle}>
                  <span>Default payment reference</span>
                  <input
                    type="text"
                    maxLength={120}
                    value={invoicePaymentReference}
                    onChange={(event) =>
                      setInvoicePaymentReference(event.target.value)
                    }
                    placeholder="Invoice number"
                    style={controlStyle}
                  />
                </label>
              </div>
              <label style={{ ...fieldStyle, marginTop: 14 }}>
                <span>Default invoice terms</span>
                <textarea
                  rows={5}
                  maxLength={5000}
                  value={invoiceDefaultTerms}
                  onChange={(event) =>
                    setInvoiceDefaultTerms(event.target.value)
                  }
                  placeholder="Payment due dates and remittance instructions"
                  style={controlStyle}
                />
              </label>
            </fieldset>
            <button className="btn" disabled={saveBusy}>
              {saveBusy ? "Saving..." : "Save customer document details"}
            </button>
            {saveStatus && saveSection === "documents" && (
              <p className="dashboard-settings-status" role="status">
                {saveStatus}
              </p>
            )}
          </form>
        </section>

        <section
          id="business-settings-service"
          className="business-settings-section"
          aria-labelledby="business-settings-service-title"
        >
          <header className="business-settings-section-heading">
            <span>Services and areas</span>
            <h3 id="business-settings-service-title">
              Business services and travel coverage
            </h3>
            <p>
              Choose the work and locations this business can actually service.
            </p>
          </header>
          <form
            onSubmit={saveSettings}
            data-settings-section="service"
            style={{ display: "grid", gap: 16 }}
          >
            {profile.partnerType === "installer" && (
              <fieldset
                style={{
                  border: "1px solid var(--trade-line)",
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <legend style={{ padding: "0 5px" }}>Business services</legend>
                <p
                  style={{
                    color: "var(--trade-muted)",
                    fontSize: ".82rem",
                    lineHeight: 1.55,
                    margin: "0 0 12px",
                  }}
                >
                  Choose the services your business performs. Team uses the same
                  list for each person. Eligible services can be used for future
                  lead matching, subject to approval, training and coverage.
                  AEA-managed enquiries remain with Australian Energy Assessments.
                  Changes do not remove leads already assigned. Licences and
                  verification do not automatically add services.
                </p>
                <div className="dashboard-choice-grid">
                  {ENERGY_SERVICE_CATALOGUE.map((service) => {
                    const selected = capabilities.includes(service.id);
                    return (
                      <label
                        className={selected ? "selected" : ""}
                        key={service.id}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleCapability(service.id)}
                        />
                        <span>
                          <strong>{service.label}</strong>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p
                  style={{
                    color: "var(--trade-accent-readable)",
                    fontSize: ".82rem",
                    fontWeight: 800,
                    margin: "12px 0 0",
                  }}
                >
                  {capabilities.length} of {ENERGY_SERVICE_CATALOGUE.length} services selected
                </p>
              </fieldset>
            )}
            <fieldset
              style={{ border: "1px solid var(--trade-line)", borderRadius: 12, padding: 14 }}
            >
              <legend style={{ padding: "0 5px" }}>States and territories served</legend>
              <p style={{ color: "var(--trade-muted)", fontSize: ".82rem", lineHeight: 1.55, margin: "0 0 12px" }}>
                Choose where your business performs work. These states determine
                the state programmes shown in your team&apos;s training, alongside
                national programmes for their services. Lead matching also requires
                a customer to be within a saved travel area. Changing a postcode
                or radius does not change these selections. If you work across a
                state border, select both states.
              </p>
              <div className="dashboard-choice-grid">
                {AUSTRALIAN_STATE_OPTIONS.map(([state, label]) => (
                  <label className={serviceStates.includes(state) ? "selected" : ""} key={state}>
                    <input
                      type="checkbox"
                      value={state}
                      checked={serviceStates.includes(state)}
                      onChange={(event) => setServiceStates((current) => event.target.checked
                        ? [...new Set([...current, state])]
                        : current.filter((item) => item !== state))}
                    />
                    <span><strong>{label}</strong></span>
                  </label>
                ))}
              </div>
              <p style={{ color: "var(--trade-accent-readable)", fontSize: ".82rem", fontWeight: 800, margin: "12px 0 0" }}>
                Selected: {serviceStates.length ? serviceStates.join(", ") : "No states selected"}
              </p>
            </fieldset>
            <div>
              <strong style={{ color: "var(--trade-ink)", fontSize: ".82rem" }}>
                Serviceability
              </strong>
              <p
                style={{
                  color: "var(--trade-muted)",
                  fontSize: ".84rem",
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
                  background: "var(--trade-surface-soft)",
                  border: "1px solid var(--trade-line)",
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
                      style={{ ...controlStyle, accentColor: "var(--trade-accent)" }}
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
                      color: "color-mix(in srgb, #d86b5c 64%, var(--trade-ink))",
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
                {saveBusy ? "Saving..." : "Save services and areas"}
              </button>
            </div>
            {saveStatus && saveSection === "service" && (
              <p className="dashboard-settings-status" role="status">
                {saveStatus}
              </p>
            )}
          </form>
        </section>

        <section
          id="business-settings-quotes"
          className="business-settings-section"
          aria-labelledby="business-settings-quotes-title"
        >
          <header className="business-settings-section-heading">
            <span>Quote defaults</span>
            <h3 id="business-settings-quotes-title">
              Customer email and standard terms
            </h3>
            <p>
              Set the reusable wording that starts each new customer quote.
            </p>
          </header>
          <form
            onSubmit={saveSettings}
            data-settings-section="quotes"
            style={{ display: "grid", gap: 16 }}
          >
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
              <small style={{ color: "var(--trade-muted)", lineHeight: 1.45 }}>
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
              <small style={{ color: "var(--trade-muted)", lineHeight: 1.45 }}>
                These defaults can be edited on each quote before it is issued.
              </small>
            </label>
            <button className="btn" disabled={saveBusy}>
              {saveBusy ? "Saving..." : "Save quote defaults"}
            </button>
            {saveStatus && saveSection === "quotes" && (
              <p className="dashboard-settings-status" role="status">
                {saveStatus}
              </p>
            )}
          </form>
        </section>

        <section
          id="business-settings-notifications"
          className="business-settings-section"
          aria-labelledby="business-settings-notifications-title"
        >
          <header className="business-settings-section-heading">
            <span>Notifications</span>
            <h3 id="business-settings-notifications-title">
              Capacity and account emails
            </h3>
            <p>
              Control work availability and the operational messages sent to
              the account contact.
            </p>
          </header>
          <form
            onSubmit={saveSettings}
            data-settings-section="notifications"
            style={{ display: "grid", gap: 18 }}
          >
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
                        : "Other opportunity and customer response emails"}
                    </strong>
                    <small>
                      {profile.partnerType === "supplier"
                        ? "Send important work and customer updates to the account contact."
                        : "New matched public enquiries are always emailed while your approved business is open to matching."}
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
            {saveStatus && saveSection === "notifications" && (
              <p className="dashboard-settings-status" role="status">
                {saveStatus}
              </p>
            )}
          </form>
        </section>

        <section
          id="business-settings-templates"
          className="business-settings-section"
          aria-labelledby="business-settings-templates-title"
        >
          <header className="business-settings-section-heading">
            <span>Templates</span>
            <h3 id="business-settings-templates-title">
              Quote and invoice preview
            </h3>
            <p>
              Confirm how the saved business identity will appear to
              customers.
            </p>
          </header>
          <div className="business-settings-pdf-preview">
            <TradeDocumentSamplePreview logoSrc={logoPreview} settings={{
              name: documentDisplayBusinessName, phone: documentDisplayPhone, email: documentDisplayEmail,
              abn: profile.abn || "", website: profile.businessWebsite || "", address: [profile.addressLine1, profile.suburb, profile.addressState, profile.postcode].filter(Boolean).join(", "),
              themeKey: brandThemeKey, borderStyle: brandBorderStyle, quoteTerms: quoteDefaultTerms,
              payment: { accountName: invoicePaymentAccountName, bsb: invoicePaymentBsb, accountNumber: invoicePaymentAccountNumber, reference: invoicePaymentReference, terms: invoiceDefaultTerms },
            }} />
            <button
              type="button"
              className="btn"
              onClick={() =>
                document
                  .getElementById("business-settings-appearance")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              style={{ justifySelf: "start" }}
            >
              Edit document appearance: logo and colours
            </button>
          </div>
        </section>

        <section
          id="business-settings-closure"
          className="business-settings-section business-settings-section-danger"
          aria-labelledby="business-settings-closure-title"
        >
          <header className="business-settings-section-heading">
            <span>Close account</span>
            <h3 id="business-settings-closure-title">
              Remove workspace access
            </h3>
            <p>
              Close the account only when this business should no longer use
              TLink.
            </p>
          </header>
          <div style={{ display: "grid", gap: 14 }}>
            <div
              style={{
                background: "color-mix(in srgb, #8e2c2c 18%, var(--trade-surface))",
                border: "1px solid color-mix(in srgb, #d86b5c 52%, var(--trade-line))",
                borderRadius: 12,
                color: "color-mix(in srgb, #e98576 42%, var(--trade-ink))",
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
        </section>

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
              background: "var(--trade-surface)",
              border: "1px solid var(--trade-line)",
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
                  color: "color-mix(in srgb, #d86b5c 64%, var(--trade-ink))",
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
                  color: "var(--trade-muted)",
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
