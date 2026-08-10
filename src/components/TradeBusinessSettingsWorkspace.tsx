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
  TRADE_BRAND_THEME_OPTIONS,
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
  { id: "appearance", label: "Appearance", detail: "Logo, banner and colours" },
  { id: "documents", label: "Customer documents", detail: "Identity and payment" },
  { id: "service", label: "Service areas", detail: "Postcodes and travel radius" },
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

type BannerCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const BANNER_CROP_SCALE = 10_000;
const DEFAULT_BANNER_CROP: BannerCrop = {
  x: 0,
  y: 0,
  width: 10_000,
  height: 10_000,
};

function profileBannerCrop(profile: TradeBusinessSettingsProfile): BannerCrop {
  const crop = {
    x: Number(profile.bannerCropXBasisPoints ?? DEFAULT_BANNER_CROP.x),
    y: Number(profile.bannerCropYBasisPoints ?? DEFAULT_BANNER_CROP.y),
    width: Number(profile.bannerCropWidthBasisPoints ?? DEFAULT_BANNER_CROP.width),
    height: Number(profile.bannerCropHeightBasisPoints ?? DEFAULT_BANNER_CROP.height),
  };
  return Object.values(crop).every(Number.isInteger)
    && crop.x >= 0
    && crop.y >= 0
    && crop.width >= 500
    && crop.height >= 500
    && crop.x + crop.width <= BANNER_CROP_SCALE
    && crop.y + crop.height <= BANNER_CROP_SCALE
    ? crop
    : DEFAULT_BANNER_CROP;
}

function fitCropToFiveToOne(
  crop: BannerCrop,
  naturalWidth: number,
  naturalHeight: number,
) {
  let x = (crop.x / BANNER_CROP_SCALE) * naturalWidth;
  let y = (crop.y / BANNER_CROP_SCALE) * naturalHeight;
  let width = (crop.width / BANNER_CROP_SCALE) * naturalWidth;
  let height = (crop.height / BANNER_CROP_SCALE) * naturalHeight;
  const ratio = width / height;
  if (ratio > 5) {
    const fittedWidth = height * 5;
    x += (width - fittedWidth) / 2;
    width = fittedWidth;
  } else if (ratio < 5) {
    const fittedHeight = width / 5;
    y += (height - fittedHeight) / 2;
    height = fittedHeight;
  }
  return { x, y, width, height };
}

function BannerCropPreview({
  src,
  crop,
  label,
}: {
  src: string;
  crop: BannerCrop;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !src) return;
    const image = new Image();
    image.onload = () => {
      const context = canvas.getContext("2d");
      if (!context) return;
      const fitted = fitCropToFiveToOne(
        crop,
        image.naturalWidth,
        image.naturalHeight,
      );
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(
        image,
        fitted.x,
        fitted.y,
        fitted.width,
        fitted.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    };
    image.src = src;
    return () => {
      image.onload = null;
    };
  }, [crop, src]);
  return src ? (
    <canvas
      ref={canvasRef}
      aria-label={label}
      role="img"
      width={1000}
      height={200}
    />
  ) : (
    <div className="business-settings-banner-placeholder">
      Banner preview appears here
    </div>
  );
}

function BannerCropEditorContext({
  src,
  crop,
}: {
  src: string;
  crop: BannerCrop;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !src) return;
    const image = new Image();
    image.onload = () => {
      const context = canvas.getContext("2d");
      if (!context) return;
      const fitted = fitCropToFiveToOne(
        crop,
        image.naturalWidth,
        image.naturalHeight,
      );
      const scale = Math.min(
        canvas.width / image.naturalWidth,
        canvas.height / image.naturalHeight,
      );
      const offsetX = (canvas.width - image.naturalWidth * scale) / 2;
      const offsetY = (canvas.height - image.naturalHeight * scale) / 2;
      context.fillStyle = "#071f28";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(
        image,
        offsetX,
        offsetY,
        image.naturalWidth * scale,
        image.naturalHeight * scale,
      );
      context.fillStyle = "rgba(2, 18, 25, .62)";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const cropX = offsetX + fitted.x * scale;
      const cropY = offsetY + fitted.y * scale;
      const cropWidth = fitted.width * scale;
      const cropHeight = fitted.height * scale;
      context.drawImage(
        image,
        fitted.x,
        fitted.y,
        fitted.width,
        fitted.height,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
      );
      context.strokeStyle = "#ffffff";
      context.lineWidth = 4;
      context.strokeRect(cropX, cropY, cropWidth, cropHeight);
    };
    image.src = src;
    return () => {
      image.onload = null;
    };
  }, [crop, src]);
  return src ? (
    <canvas
      ref={canvasRef}
      aria-label="Full banner image with the retained PDF crop outlined"
      role="img"
      width={1000}
      height={450}
    />
  ) : (
    <div className="business-settings-banner-placeholder">
      Upload a banner to choose the retained area
    </div>
  );
}

function CustomerDocumentPreview({
  kind,
  bannerSrc,
  bannerCrop,
  logoSrc,
  initials,
  businessName,
  phone,
  email,
  themeGradient,
  themeInk,
  borderRadius,
  quoteTerms,
  invoiceTerms,
  paymentAccountName,
  paymentBsb,
  paymentAccountNumber,
  paymentReference,
}: {
  kind: "quote" | "invoice";
  bannerSrc: string;
  bannerCrop: BannerCrop;
  logoSrc: string;
  initials: string;
  businessName: string;
  phone: string;
  email: string;
  themeGradient: string;
  themeInk: string;
  borderRadius: number;
  quoteTerms: string;
  invoiceTerms: string;
  paymentAccountName: string;
  paymentBsb: string;
  paymentAccountNumber: string;
  paymentReference: string;
}) {
  const discount = 200;
  const subtotal = 4_040;
  const taxable = subtotal - discount;
  const gst = taxable * 0.1;
  const total = taxable + gst;
  const formatCurrency = (value: number) =>
    value.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
  const paymentComplete = Boolean(
    paymentAccountName && paymentBsb && paymentAccountNumber,
  );
  const displayedBsb = /^\d{6}$/.test(paymentBsb)
    ? `${paymentBsb.slice(0, 3)}-${paymentBsb.slice(3)}`
    : paymentBsb;
  return (
    <article
      className="business-settings-document-preview"
      style={{ borderRadius }}
      aria-label={`${kind} document preview`}
    >
      <div className="business-settings-document-banner">
        <BannerCropPreview
          src={bannerSrc}
          crop={bannerCrop}
          label={`${kind} banner crop`}
        />
      </div>
      <header
        className="business-settings-document-brand"
        style={{ background: themeGradient, color: themeInk }}
      >
        <div
          className="business-settings-document-logo"
          style={{ borderRadius }}
        >
          {logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoSrc} alt="" />
          ) : (
            initials
          )}
        </div>
        <div>
          <small>{kind === "quote" ? "Quote from" : "Invoice from"}</small>
          <strong>{businessName}</strong>
          <span>{[phone, email].filter(Boolean).join("  |  ")}</span>
        </div>
      </header>
      <div className="business-settings-document-body">
        <div className="business-settings-document-meta">
          <div>
            <small>{kind}</small>
            <strong>
              {kind === "quote" ? "Q-TLJ-PREVIEW" : "INV-TLJ-PREVIEW"}
            </strong>
          </div>
          <div>
            <small>Prepared for</small>
            <strong>Sample customer</strong>
          </div>
          <div>
            <small>{kind === "quote" ? "Valid until" : "Due date"}</small>
            <strong>31 August 2026</strong>
          </div>
        </div>
        <div className="business-settings-document-items">
          <div className="heading">
            <span>Description</span>
            <span>Qty</span>
            <span>Ex GST</span>
            <span>Amount</span>
          </div>
          {[
            ["Heat-pump supply", "1", "$3,500.00", "$3,500.00"],
            ["Installation labour", "4", "$85.00", "$340.00"],
            ["Commissioning and handover", "1", "$200.00", "$200.00"],
          ].map((item) => (
            <div key={item[0]}>
              {item.map((value) => <span key={value}>{value}</span>)}
            </div>
          ))}
        </div>
        <div className="business-settings-document-summary">
          <span>Subtotal</span><strong>{formatCurrency(subtotal)}</strong>
          {discount > 0 && (
            <>
              <span>Discount</span><strong>-{formatCurrency(discount)}</strong>
            </>
          )}
          <span>GST (10%)</span><strong>{formatCurrency(gst)}</strong>
          <span className="total">Total</span>
          <strong className="total">{formatCurrency(total)}</strong>
        </div>
        {kind === "invoice" && (
          <section className="business-settings-document-payment">
            <small>Payment details</small>
            {paymentComplete ? (
              <dl>
                <div><dt>Account name</dt><dd>{paymentAccountName}</dd></div>
                <div><dt>BSB</dt><dd>{displayedBsb}</dd></div>
                <div><dt>Account number</dt><dd>{paymentAccountNumber}</dd></div>
                <div><dt>Reference</dt><dd>{paymentReference || "Invoice number"}</dd></div>
              </dl>
            ) : (
              <p>Add complete payment details above to show them here.</p>
            )}
          </section>
        )}
        <section className="business-settings-document-terms">
          <small>{kind === "quote" ? "Quote terms" : "Invoice terms"}</small>
          <p>
            {(kind === "quote" ? quoteTerms : invoiceTerms)
              || "No default terms saved. Terms can still be added before issue."}
          </p>
        </section>
        <p className="business-settings-document-note">
          Live settings preview with sample customer and line-item values.
          Issued documents retain their exact saved identity, branding and
          totals.
        </p>
      </div>
    </article>
  );
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
  const [bannerCrop, setBannerCrop] = useState<BannerCrop>(() =>
    profileBannerCrop(profile),
  );
  const [bannerNaturalSize, setBannerNaturalSize] = useState({
    width: 0,
    height: 0,
  });
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [saveSection, setSaveSection] = useState("");
  const [mediaBusy, setMediaBusy] = useState<"" | "logo" | "banner">("");
  const [mediaStatus, setMediaStatus] = useState("");
  const [logoPreview, setLogoPreview] = useState("");
  const [bannerPreview, setBannerPreview] = useState("");
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

  useEffect(() => {
    if (!bannerPreview) return;
    const image = new Image();
    image.onload = () => {
      setBannerNaturalSize({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };
    image.src = bannerPreview;
    return () => {
      image.onload = null;
    };
  }, [bannerPreview]);

  useEffect(
    () => () => {
      if (bannerPreview) URL.revokeObjectURL(bannerPreview);
    },
    [bannerPreview],
  );

  const selectedTheme = TRADE_BRAND_THEME_OPTIONS[brandThemeKey];
  const selectedBorder = borderOptions[brandBorderStyle];
  const businessWebsiteHref = useMemo(
    () => safeBusinessWebsiteHref(profile.businessWebsite),
    [profile.businessWebsite],
  );
  const accountInitials = useMemo(
    () =>
      (documentBusinessName || profile.businessName)
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || "TL",
    [documentBusinessName, profile.businessName],
  );
  const documentDisplayBusinessName =
    documentBusinessName.trim() || profile.businessName;
  const documentDisplayPhone =
    documentPhone.trim() || profile.phone || "";
  const documentDisplayEmail =
    documentEmail.trim() || profile.accountEmail || "";
  const bannerZoom = Math.max(
    100,
    Math.min(400, Math.round((BANNER_CROP_SCALE / bannerCrop.width) * 100)),
  );
  const bannerHorizontalPosition = bannerCrop.width < BANNER_CROP_SCALE
    ? Math.round(
        (bannerCrop.x / (BANNER_CROP_SCALE - bannerCrop.width)) * 100,
      )
    : 50;
  const bannerVerticalPosition = bannerCrop.height < BANNER_CROP_SCALE
    ? Math.round(
        (bannerCrop.y / (BANNER_CROP_SCALE - bannerCrop.height)) * 100,
      )
    : 50;

  function updateBannerCrop(
    zoom = bannerZoom,
    horizontal = bannerHorizontalPosition,
    vertical = bannerVerticalPosition,
  ) {
    const sourceWidth = bannerNaturalSize.width;
    const sourceHeight = bannerNaturalSize.height;
    if (!(sourceWidth > 0 && sourceHeight > 0)) return;
    let width = Math.round(BANNER_CROP_SCALE * (100 / zoom));
    let height = Math.round(
      width * (sourceWidth / (5 * sourceHeight)),
    );
    if (height > BANNER_CROP_SCALE) {
      height = BANNER_CROP_SCALE;
      width = Math.round(height * (5 * sourceHeight / sourceWidth));
    }
    width = Math.max(500, Math.min(BANNER_CROP_SCALE, width));
    height = Math.max(500, Math.min(BANNER_CROP_SCALE, height));
    setBannerCrop({
      x: Math.round(
        (BANNER_CROP_SCALE - width) * Math.max(0, Math.min(100, horizontal)) / 100,
      ),
      y: Math.round(
        (BANNER_CROP_SCALE - height) * Math.max(0, Math.min(100, vertical)) / 100,
      ),
      width,
      height,
    });
  }

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

  function validateSettings(targetSection: string) {
    if (targetSection === "service") {
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
            bannerCropXBasisPoints: bannerCrop.x,
            bannerCropYBasisPoints: bannerCrop.y,
            bannerCropWidthBasisPoints: bannerCrop.width,
            bannerCropHeightBasisPoints: bannerCrop.height,
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
      let bannerCropSaved = true;
      if (kind === "logo") {
        setLogoPreview(nextPreview);
        onProfileChange({
          hasLogo: true,
          logoMediaUrl: "/api/trade-profile-media?kind=logo",
        });
      } else {
        const nextCrop = DEFAULT_BANNER_CROP;
        const cropResponse = await fetch("/api/trade-profile", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            bannerCropXBasisPoints: nextCrop.x,
            bannerCropYBasisPoints: nextCrop.y,
            bannerCropWidthBasisPoints: nextCrop.width,
            bannerCropHeightBasisPoints: nextCrop.height,
          }),
        });
        bannerCropSaved = cropResponse.ok;
        setBannerPreview(nextPreview);
        setBannerCrop(nextCrop);
        onProfileChange({
          hasBanner: true,
          bannerMediaUrl: "/api/trade-profile-media?kind=banner",
          bannerCropXBasisPoints: nextCrop.x,
          bannerCropYBasisPoints: nextCrop.y,
          bannerCropWidthBasisPoints: nextCrop.width,
          bannerCropHeightBasisPoints: nextCrop.height,
        });
      }
      setMediaStatus(
        kind === "banner" && !bannerCropSaved
          ? "Banner uploaded. Review the crop and select Save appearance before issuing a document."
          : `${kind === "logo" ? "Logo" : "Banner"} uploaded.`,
      );
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
                    color: "var(--trade-accent)",
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
                    color: "var(--trade-accent)",
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
                    color: "var(--trade-accent)",
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
                  style={{
                    color: "var(--trade-accent)",
                    fontSize: ".7rem",
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
        </section>

        <section
          id="business-settings-appearance"
          className="business-settings-section"
          aria-labelledby="business-settings-appearance-title"
        >
          <header className="business-settings-section-heading">
            <span>Appearance</span>
            <h3 id="business-settings-appearance-title">
              Logo, banner and colour theme
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
              <div className="business-settings-crop-editor">
                <div>
                  <strong>Banner crop</strong>
                  <p>
                    The outlined 5:1 frame is the exact full-width area used on
                    customer quote and invoice PDFs.
                  </p>
                </div>
                <div className="business-settings-banner-crop-context">
                  <BannerCropEditorContext
                    src={bannerPreview}
                    crop={bannerCrop}
                  />
                </div>
                <div>
                  <strong>Exact PDF banner</strong>
                  <p>Everything shown below is retained at full document width.</p>
                </div>
                <div className="business-settings-banner-frame">
                  <BannerCropPreview
                    src={bannerPreview}
                    crop={bannerCrop}
                    label="Customer document banner crop preview"
                  />
                </div>
                <div className="business-settings-crop-controls">
                  <label style={fieldStyle}>
                    <span>Zoom: {bannerZoom}%</span>
                    <input
                      type="range"
                      min="100"
                      max="400"
                      step="1"
                      value={bannerZoom}
                      disabled={!bannerPreview}
                      onChange={(event) =>
                        updateBannerCrop(Number(event.target.value))
                      }
                    />
                  </label>
                  <label style={fieldStyle}>
                    <span>Move left or right</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={bannerHorizontalPosition}
                      disabled={!bannerPreview}
                      onChange={(event) =>
                        updateBannerCrop(
                          bannerZoom,
                          Number(event.target.value),
                        )
                      }
                    />
                  </label>
                  <label style={fieldStyle}>
                    <span>Move up or down</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={bannerVerticalPosition}
                      disabled={!bannerPreview}
                      onChange={(event) =>
                        updateBannerCrop(
                          bannerZoom,
                          bannerHorizontalPosition,
                          Number(event.target.value),
                        )
                      }
                    />
                  </label>
                </div>
              </div>
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
              {saveBusy ? "Saving..." : "Save appearance and apply crop"}
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
            <span>Service areas</span>
            <h3 id="business-settings-service-title">
              Postcodes and travel radius
            </h3>
            <p>
              Keep customer matching inside the locations the business can
              actually service.
            </p>
          </header>
          <form
            onSubmit={saveSettings}
            data-settings-section="service"
            style={{ display: "grid", gap: 16 }}
          >
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
          <div className="business-settings-document-preview-grid">
            {(["quote", "invoice"] as const).map((kind) => (
              <CustomerDocumentPreview
                key={kind}
                kind={kind}
                bannerSrc={bannerPreview}
                bannerCrop={bannerCrop}
                logoSrc={logoPreview}
                initials={accountInitials}
                businessName={documentDisplayBusinessName}
                phone={documentDisplayPhone}
                email={documentDisplayEmail}
                themeGradient={selectedTheme.gradient}
                themeInk={selectedTheme.ink}
                borderRadius={templateRadius}
                quoteTerms={quoteDefaultTerms}
                invoiceTerms={invoiceDefaultTerms}
                paymentAccountName={invoicePaymentAccountName}
                paymentBsb={invoicePaymentBsb}
                paymentAccountNumber={invoicePaymentAccountNumber}
                paymentReference={invoicePaymentReference}
              />
            ))}
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
              Edit document appearance: logo, banner and colours
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
