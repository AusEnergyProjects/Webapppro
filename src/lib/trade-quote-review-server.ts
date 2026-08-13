import { getD1 } from "../../db";
import { adminJson } from "@/lib/admin-server";
import {
  hashQuoteLinkSecret,
  splitQuoteLinkToken,
} from "@/lib/trade-quote-links";
import { verifiedTradeAccountPredicate } from "@/lib/trade-access-server";

type Row = Record<string, unknown>;

export type TradeQuoteLineSnapshot = {
  id: string;
  lineType?: "product" | "labour" | "adjustment";
  description: string;
  quantityMilli: number;
  unitPriceCents: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  sectionHeading: string;
};

export type TradeQuoteChoiceSnapshot = {
  id: string;
  kind: "package" | "addon" | "choose_one";
  groupKey: string;
  name: string;
  summary: string;
  recommended: boolean;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  items: TradeQuoteLineSnapshot[];
};

export type TradeQuoteBrandAssetSnapshot = {
  objectKey: string;
  contentType: "image/png" | "image/jpeg";
};

export type TradeQuoteBannerCropSnapshot = {
  xBasisPoints: number;
  yBasisPoints: number;
  widthBasisPoints: number;
  heightBasisPoints: number;
};

export type TradeQuoteDocumentSnapshot = {
  schemaVersion: "trade-quote-document-v1" | "trade-quote-document-v2";
  capturedAt: string;
  quoteId: string;
  quoteVersionId: string;
  quoteNumber: string;
  versionNumber: number;
  work: {
    id: string;
    number: string;
    title: string;
  };
  customer: {
    id: string;
    number: string;
    name: string;
    email: string;
  };
  site: {
    id: string;
    label: string;
    addressLine1: string;
    addressLine2: string;
    suburb: string;
    state: string;
    postcode: string;
    summary: string;
  };
  business: {
    name: string;
    email: string;
    phone: string;
    abn: string;
    website: string;
    address: string;
    themeKey: string;
    borderStyle: string;
    logo: TradeQuoteBrandAssetSnapshot | null;
    banner: TradeQuoteBrandAssetSnapshot | null;
    bannerCrop?: TradeQuoteBannerCropSnapshot;
    quoteEmailSubjectTemplate: string;
    quoteEmailIntro: string;
  };
  acceptanceEmail: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  customerMessage: string;
  terms: string;
  validUntil: string;
  consentStatement: string;
  issuedAt: string;
  items: TradeQuoteLineSnapshot[];
  choices: TradeQuoteChoiceSnapshot[];
};

export type AuthorisedTradeQuoteLink = Row & {
  id: string;
  quote_id: string;
  quote_version_id: string;
  work_order_id: string;
  firebase_uid: string;
  crm_customer_id: string;
  token_issue: number;
  expires_at: string;
  document_snapshot_json: string;
  invoice_payment_account_name: string;
  invoice_payment_bsb: string;
  invoice_payment_account_number: string;
  invoice_payment_reference: string;
  invoice_default_terms: string;
};

export type TradeQuoteQuestionPayload = {
  id: string;
  question: string;
  answer: string;
  status: string;
  askedAt: string;
  answeredAt: string;
};

export type TradeQuoteReviewPayload = {
  linkId: string;
  tokenIssue: number;
  quoteVersionId: string;
  quoteNumber: string;
  versionNumber: number;
  workNumber: string;
  workTitle: string;
  customerName: string;
  customerNumber: string;
  siteLabel: string;
  siteSummary: string;
  business: {
    name: string;
    email: string;
    phone: string;
    abn: string;
    website: string;
    themeKey: string;
    borderStyle: string;
    hasLogo: boolean;
    hasBanner: boolean;
    bannerCrop: TradeQuoteBannerCropSnapshot;
  };
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  customerMessage: string;
  terms: string;
  validUntil: string;
  issuedAt: string;
  consentStatement: string;
  expiresAt: string;
  items: TradeQuoteLineSnapshot[];
  choices: TradeQuoteChoiceSnapshot[];
  questions: TradeQuoteQuestionPayload[];
};

export type TradeQuoteDocumentSnapshotOverrides = {
  capturedAt?: string;
  consentStatement?: string;
  issuedAt?: string;
  acceptanceEmail?: string;
  releasedCustomer?: {
    name: string;
    email: string;
  };
  releasedSite?: {
    label: string;
    addressLine1: string;
    addressLine2: string;
    suburb: string;
    state: string;
    postcode: string;
  };
};

function cleanText(value: unknown, maximum: number, multiline = false) {
  const cleaned = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ")
    .replace(/[\u2013\u2014]/g, "-");
  return (multiline
    ? cleaned
        .split("\n")
        .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
    : cleaned.replace(/\s+/g, " ")
  )
    .trim()
    .slice(0, maximum);
}

function boundedInteger(value: unknown, maximum = 1_000_000_000) {
  const number = Math.round(Number(value) || 0);
  return Math.min(maximum, Math.max(0, number));
}

function signedBoundedInteger(value: unknown, maximum = 1_000_000_000) {
  const number = Math.round(Number(value) || 0);
  return Math.min(maximum, Math.max(-maximum, number));
}

const DEFAULT_BANNER_CROP: TradeQuoteBannerCropSnapshot = {
  xBasisPoints: 0,
  yBasisPoints: 0,
  widthBasisPoints: 10_000,
  heightBasisPoints: 10_000,
};

function normaliseBannerCrop(
  value: unknown,
): TradeQuoteBannerCropSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const values = [
    row.xBasisPoints,
    row.yBasisPoints,
    row.widthBasisPoints,
    row.heightBasisPoints,
  ].map(Number);
  if (values.some((item) => !Number.isInteger(item))) return null;
  const [xBasisPoints, yBasisPoints, widthBasisPoints, heightBasisPoints] =
    values;
  if (
    xBasisPoints < 0 ||
    yBasisPoints < 0 ||
    widthBasisPoints <= 0 ||
    heightBasisPoints <= 0 ||
    xBasisPoints + widthBasisPoints > 10_000 ||
    yBasisPoints + heightBasisPoints > 10_000
  ) {
    return null;
  }
  return {
    xBasisPoints,
    yBasisPoints,
    widthBasisPoints,
    heightBasisPoints,
  };
}

function lineType(value: unknown) {
  const candidate = cleanText(value, 30);
  return candidate === "product" ||
    candidate === "labour" ||
    candidate === "adjustment"
    ? candidate
    : null;
}

function imageAsset(objectKey: unknown, contentType: unknown) {
  const key = cleanText(objectKey, 1_000);
  const type = cleanText(contentType, 100).toLowerCase();
  if (
    !key ||
    (type !== "image/png" && type !== "image/jpeg")
  ) {
    return null;
  }
  return {
    objectKey: key,
    contentType: type,
  } as TradeQuoteBrandAssetSnapshot;
}

function lineSnapshot(row: Row): TradeQuoteLineSnapshot {
  const resolvedLineType = lineType(row.line_type) || "product";
  const amount = resolvedLineType === "adjustment"
    ? signedBoundedInteger
    : boundedInteger;
  return {
    id: cleanText(row.id, 180),
    lineType: resolvedLineType,
    description: cleanText(row.description, 500),
    quantityMilli: boundedInteger(row.quantity_milli, 100_000_000),
    unitPriceCents: amount(row.unit_price_cents),
    subtotalCents: amount(row.subtotal_cents),
    taxCents: amount(row.tax_cents),
    totalCents: amount(row.total_cents),
    sectionHeading: cleanText(row.section_heading, 160) || "Included work",
  };
}

function normaliseLine(
  value: unknown,
  schemaVersion: TradeQuoteDocumentSnapshot["schemaVersion"],
): TradeQuoteLineSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const description = cleanText(row.description, 500);
  if (!description) return null;
  const resolvedLineType = lineType(row.lineType);
  if (schemaVersion === "trade-quote-document-v2" && !resolvedLineType) {
    return null;
  }
  const amount =
    schemaVersion === "trade-quote-document-v2" &&
    resolvedLineType === "adjustment"
      ? signedBoundedInteger
      : boundedInteger;
  return {
    id: cleanText(row.id, 180),
    ...(resolvedLineType ? { lineType: resolvedLineType } : {}),
    description,
    quantityMilli: boundedInteger(row.quantityMilli, 100_000_000),
    unitPriceCents: amount(row.unitPriceCents),
    subtotalCents: amount(row.subtotalCents),
    taxCents: amount(row.taxCents),
    totalCents: amount(row.totalCents),
    sectionHeading: cleanText(row.sectionHeading, 160) || "Included work",
  };
}

function normaliseChoice(
  value: unknown,
  schemaVersion: TradeQuoteDocumentSnapshot["schemaVersion"],
): TradeQuoteChoiceSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const rawKind = cleanText(row.kind, 30);
  const kind =
    rawKind === "package" ||
    rawKind === "addon" ||
    rawKind === "choose_one"
      ? rawKind
      : null;
  const name = cleanText(row.name, 200);
  if (!kind || !name) return null;
  const sourceItems = Array.isArray(row.items)
    ? row.items.slice(0, 200)
    : [];
  const items = sourceItems
    .map((item) => normaliseLine(item, schemaVersion))
    .filter(Boolean) as TradeQuoteLineSnapshot[];
  if (
    schemaVersion === "trade-quote-document-v2" &&
    items.length !== sourceItems.length
  ) {
    return null;
  }
  return {
    id: cleanText(row.id, 180),
    kind,
    groupKey: cleanText(row.groupKey, 120),
    name,
    summary: cleanText(row.summary, 500),
    recommended: row.recommended === true,
    subtotalCents: boundedInteger(row.subtotalCents),
    taxCents: boundedInteger(row.taxCents),
    totalCents: boundedInteger(row.totalCents),
    items,
  };
}

function normaliseAsset(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return imageAsset(row.objectKey, row.contentType);
}

function snapshotFromObject(
  row: Record<string, unknown>,
): TradeQuoteDocumentSnapshot | null {
  const schemaVersion =
    row.schemaVersion === "trade-quote-document-v1" ||
    row.schemaVersion === "trade-quote-document-v2"
      ? row.schemaVersion
      : null;
  if (
    !schemaVersion ||
    !row.work ||
    !row.customer ||
    !row.site ||
    !row.business
  ) {
    return null;
  }
  const work = row.work as Record<string, unknown>;
  const customer = row.customer as Record<string, unknown>;
  const site = row.site as Record<string, unknown>;
  const business = row.business as Record<string, unknown>;
  const quoteVersionId = cleanText(row.quoteVersionId, 180);
  const quoteNumber = cleanText(row.quoteNumber, 120);
  const bannerCrop = normaliseBannerCrop(business.bannerCrop);
  if (!quoteVersionId || !quoteNumber || !cleanText(business.name, 240)) {
    return null;
  }
  if (schemaVersion === "trade-quote-document-v2" && !bannerCrop) return null;
  const sourceItems = Array.isArray(row.items)
    ? row.items.slice(0, 500)
    : [];
  const items = sourceItems
    .map((item) => normaliseLine(item, schemaVersion))
    .filter(Boolean) as TradeQuoteLineSnapshot[];
  const sourceChoices = Array.isArray(row.choices)
    ? row.choices.slice(0, 100)
    : [];
  const choices = sourceChoices
    .map((choice) => normaliseChoice(choice, schemaVersion))
    .filter(Boolean) as TradeQuoteChoiceSnapshot[];
  if (
    schemaVersion === "trade-quote-document-v2" &&
    (
      items.length !== sourceItems.length ||
      choices.length !== sourceChoices.length
    )
  ) {
    return null;
  }
  return {
    schemaVersion,
    capturedAt: cleanText(row.capturedAt, 40),
    quoteId: cleanText(row.quoteId, 180),
    quoteVersionId,
    quoteNumber,
    versionNumber: boundedInteger(row.versionNumber, 1_000_000),
    work: {
      id: cleanText(work.id, 180),
      number: cleanText(work.number, 120),
      title: cleanText(work.title, 300),
    },
    customer: {
      id: cleanText(customer.id, 180),
      number: cleanText(customer.number, 120),
      name: cleanText(customer.name, 240),
      email: cleanText(customer.email, 254),
    },
    site: {
      id: cleanText(site.id, 180),
      label: cleanText(site.label, 160),
      addressLine1: cleanText(site.addressLine1, 300),
      addressLine2: cleanText(site.addressLine2, 300),
      suburb: cleanText(site.suburb, 160),
      state: cleanText(site.state, 16),
      postcode: cleanText(site.postcode, 12),
      summary: cleanText(site.summary, 800),
    },
    business: {
      name: cleanText(business.name, 240),
      email: cleanText(business.email, 254),
      phone: cleanText(business.phone, 60),
      abn: cleanText(business.abn, 20),
      website: cleanText(business.website, 500),
      address: cleanText(business.address, 800),
      themeKey: cleanText(business.themeKey, 60) || "emerald_navy",
      borderStyle: cleanText(business.borderStyle, 30) || "soft",
      logo: normaliseAsset(business.logo),
      banner: normaliseAsset(business.banner),
      ...(bannerCrop ? { bannerCrop } : {}),
      quoteEmailSubjectTemplate: cleanText(
        business.quoteEmailSubjectTemplate,
        240,
      ),
      quoteEmailIntro: cleanText(business.quoteEmailIntro, 1_000, true),
    },
    acceptanceEmail: cleanText(row.acceptanceEmail, 254),
    subtotalCents: boundedInteger(row.subtotalCents),
    taxCents: boundedInteger(row.taxCents),
    totalCents: boundedInteger(row.totalCents),
    customerMessage: cleanText(row.customerMessage, 2_000, true),
    terms: cleanText(row.terms, 20_000, true),
    validUntil: cleanText(row.validUntil, 20),
    consentStatement: cleanText(row.consentStatement, 2_000, true),
    issuedAt: cleanText(row.issuedAt, 40),
    items,
    choices,
  };
}

export function parseTradeQuoteDocumentSnapshot(value: unknown) {
  let candidate: unknown = value;
  if (typeof value === "string") {
    if (!value.trim() || new TextEncoder().encode(value).byteLength > 1_000_000) {
      return null;
    }
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  return snapshotFromObject(candidate as Record<string, unknown>);
}

export async function buildTradeQuoteDocumentSnapshot(
  ownerUid: string,
  versionId: string,
  overrides: TradeQuoteDocumentSnapshotOverrides = {},
): Promise<TradeQuoteDocumentSnapshot> {
  const db = getD1();
  const row = await db
    .prepare(
      `SELECT version.id quote_version_id, version.quote_id, version.version_number,
        version.acceptance_email, version.subtotal_cents, version.tax_cents,
        version.total_cents, version.customer_message, version.terms,
        version.valid_until, version.consent_statement, version.issued_at,
        quote.quote_number, work.id work_order_id, work.work_number,
        work.title work_title, customer.id customer_id,
        customer.customer_number,
        CASE WHEN customer.business_name != '' THEN customer.business_name
          ELSE TRIM(customer.first_name || ' ' || customer.last_name) END customer_name,
        customer.email customer_email, site.id service_site_id,
        site.site_label, site.address_line_1, site.address_line_2, site.suburb,
        site.address_state, site.postcode,
        trade.business_name trade_business_name, trade.email trade_email,
        trade.phone trade_phone, trade.abn trade_abn,
        trade.business_website trade_website, trade.address_line_1 trade_address_line_1,
        trade.suburb trade_suburb, trade.address_state trade_address_state,
        trade.postcode trade_postcode, trade.brand_theme_key,
        trade.brand_border_style, trade.logo_object_key, trade.logo_content_type,
        trade.banner_object_key, trade.banner_content_type,
        trade.document_business_name, trade.document_phone,
        trade.document_email, trade.banner_crop_x_basis_points,
        trade.banner_crop_y_basis_points, trade.banner_crop_width_basis_points,
        trade.banner_crop_height_basis_points,
        trade.quote_email_subject_template, trade.quote_email_intro
      FROM trade_crm_quote_versions version
      JOIN trade_crm_quotes quote
        ON quote.id = version.quote_id AND quote.firebase_uid = version.firebase_uid
      JOIN trade_work_orders work
        ON work.id = quote.work_order_id AND work.firebase_uid = version.firebase_uid
        AND work.record_status = 'active'
      JOIN trade_crm_customers customer
        ON customer.id = quote.crm_customer_id
        AND customer.firebase_uid = version.firebase_uid
        AND customer.record_status = 'active'
      JOIN trade_crm_service_sites site
        ON site.id = quote.service_site_id
        AND site.customer_id = customer.id
        AND site.firebase_uid = version.firebase_uid
        AND site.record_status = 'active'
      JOIN trade_accounts trade ON trade.firebase_uid = version.firebase_uid
      WHERE version.id = ? AND version.firebase_uid = ?
      LIMIT 1`,
    )
    .bind(versionId, ownerUid)
    .first<Row>();
  if (!row) throw new Error("QUOTE_NOT_FOUND");

  const [itemRows, choiceRows] = await Promise.all([
    db
      .prepare(
        "SELECT * FROM trade_crm_quote_items WHERE quote_version_id = ? AND firebase_uid = ? ORDER BY position",
      )
      .bind(versionId, ownerUid)
      .all<Row>(),
    db
      .prepare(
        "SELECT * FROM trade_crm_quote_choices WHERE quote_version_id = ? AND firebase_uid = ? ORDER BY position",
      )
      .bind(versionId, ownerUid)
      .all<Row>(),
  ]);
  const allItems = itemRows.results.map(lineSnapshot);
  const releasedCustomer = overrides.releasedCustomer;
  const releasedSite = overrides.releasedSite;
  const siteSummary = [
    releasedSite?.addressLine1 ?? row.address_line_1,
    releasedSite?.addressLine2 ?? row.address_line_2,
    releasedSite?.suburb ?? row.suburb,
    releasedSite?.state ?? row.address_state,
    releasedSite?.postcode ?? row.postcode,
  ]
    .map((value) => cleanText(value, 300))
    .filter(Boolean)
    .join(", ");
  const businessAddress = [
    row.trade_address_line_1,
    row.trade_suburb,
    row.trade_address_state,
    row.trade_postcode,
  ]
    .map((value) => cleanText(value, 300))
    .filter(Boolean)
    .join(", ");
  const bannerCrop =
    normaliseBannerCrop({
      xBasisPoints: row.banner_crop_x_basis_points,
      yBasisPoints: row.banner_crop_y_basis_points,
      widthBasisPoints: row.banner_crop_width_basis_points,
      heightBasisPoints: row.banner_crop_height_basis_points,
    }) || DEFAULT_BANNER_CROP;

  return {
    schemaVersion: "trade-quote-document-v2",
    capturedAt:
      cleanText(overrides.capturedAt, 40) || new Date().toISOString(),
    quoteId: cleanText(row.quote_id, 180),
    quoteVersionId: cleanText(row.quote_version_id, 180),
    quoteNumber: cleanText(row.quote_number, 120),
    versionNumber: boundedInteger(row.version_number, 1_000_000),
    work: {
      id: cleanText(row.work_order_id, 180),
      number: cleanText(row.work_number, 120),
      title: cleanText(row.work_title, 300),
    },
    customer: {
      id: cleanText(row.customer_id, 180),
      number: cleanText(row.customer_number, 120),
      name: cleanText(releasedCustomer?.name ?? row.customer_name, 240),
      email: cleanText(releasedCustomer?.email ?? row.customer_email, 254),
    },
    site: {
      id: cleanText(row.service_site_id, 180),
      label: cleanText(releasedSite?.label ?? row.site_label, 160),
      addressLine1: cleanText(releasedSite?.addressLine1 ?? row.address_line_1, 300),
      addressLine2: cleanText(releasedSite?.addressLine2 ?? row.address_line_2, 300),
      suburb: cleanText(releasedSite?.suburb ?? row.suburb, 160),
      state: cleanText(releasedSite?.state ?? row.address_state, 16),
      postcode: cleanText(releasedSite?.postcode ?? row.postcode, 12),
      summary: siteSummary,
    },
    business: {
      name:
        cleanText(row.document_business_name, 240) ||
        cleanText(row.trade_business_name, 240),
      email:
        cleanText(row.document_email, 254) ||
        cleanText(row.trade_email, 254),
      phone:
        cleanText(row.document_phone, 60) ||
        cleanText(row.trade_phone, 60),
      abn: cleanText(row.trade_abn, 20),
      website: cleanText(row.trade_website, 500),
      address: businessAddress,
      themeKey: cleanText(row.brand_theme_key, 60) || "emerald_navy",
      borderStyle: cleanText(row.brand_border_style, 30) || "soft",
      logo: imageAsset(row.logo_object_key, row.logo_content_type),
      banner: imageAsset(row.banner_object_key, row.banner_content_type),
      bannerCrop,
      quoteEmailSubjectTemplate: cleanText(
        row.quote_email_subject_template,
        240,
      ),
      quoteEmailIntro: cleanText(row.quote_email_intro, 1_000, true),
    },
    acceptanceEmail: cleanText(overrides.acceptanceEmail ?? row.acceptance_email, 254),
    subtotalCents: boundedInteger(row.subtotal_cents),
    taxCents: boundedInteger(row.tax_cents),
    totalCents: boundedInteger(row.total_cents),
    customerMessage: cleanText(row.customer_message, 2_000, true),
    terms: cleanText(row.terms, 20_000, true),
    validUntil: cleanText(row.valid_until, 20),
    consentStatement: cleanText(
      overrides.consentStatement === undefined
        ? row.consent_statement
        : overrides.consentStatement,
      2_000,
      true,
    ),
    issuedAt: cleanText(
      overrides.issuedAt === undefined ? row.issued_at : overrides.issuedAt,
      40,
    ),
    items: allItems.filter(
      (_item, index) => !String(itemRows.results[index]?.quote_choice_id || ""),
    ),
    choices: choiceRows.results.map((choice) => ({
      id: cleanText(choice.id, 180),
      kind: cleanText(choice.choice_kind, 30) as TradeQuoteChoiceSnapshot["kind"],
      groupKey: cleanText(choice.group_key, 120),
      name: cleanText(choice.name, 200),
      summary: cleanText(choice.summary, 500),
      recommended: Boolean(choice.recommended),
      subtotalCents: boundedInteger(choice.subtotal_cents),
      taxCents: boundedInteger(choice.tax_cents),
      totalCents: boundedInteger(choice.total_cents),
      items: allItems.filter(
        (_item, index) =>
          String(itemRows.results[index]?.quote_choice_id || "") ===
          String(choice.id),
      ),
    })),
  };
}

export async function authoriseTradeQuoteLink(
  token: string,
  options: { requireCurrentTradeAccess?: boolean } = {},
): Promise<AuthorisedTradeQuoteLink> {
  const { linkId, secret } = splitQuoteLinkToken(token);
  const tradeAccessPredicate = options.requireCurrentTradeAccess
    ? verifiedTradeAccountPredicate("trade")
    : "trade.account_status = 'active'";
  const row = await getD1()
    .prepare(
      `SELECT link.*, version.version_number, version.status version_status,
        version.document_snapshot_json, version.valid_until,
        quote.quote_number, quote.current_version_number,
        work.source_type work_source_type,
        work.source_reference work_source_reference,
        detail.customer_source,
        trade.invoice_payment_account_name,
        trade.invoice_payment_bsb,
        trade.invoice_payment_account_number,
        trade.invoice_payment_reference,
        trade.invoice_default_terms
      FROM trade_crm_quote_links link
      JOIN trade_crm_quote_versions version
        ON version.id = link.quote_version_id
        AND version.firebase_uid = link.firebase_uid
        AND version.quote_id = link.quote_id
      JOIN trade_crm_quotes quote
        ON quote.id = link.quote_id AND quote.firebase_uid = link.firebase_uid
        AND quote.work_order_id = link.work_order_id
        AND quote.crm_customer_id = link.crm_customer_id
        AND quote.current_version_number = version.version_number
      JOIN trade_work_orders work
        ON work.id = link.work_order_id AND work.firebase_uid = link.firebase_uid
        AND work.record_status = 'active'
      LEFT JOIN trade_crm_job_details detail
        ON detail.work_order_id = work.id AND detail.firebase_uid = work.firebase_uid
        AND detail.crm_customer_id = link.crm_customer_id
      JOIN trade_accounts trade
        ON trade.firebase_uid = link.firebase_uid
        AND trade.partner_type = 'installer'
        AND ${tradeAccessPredicate}
      WHERE link.id = ?
      LIMIT 1`,
    )
    .bind(linkId)
    .first<Row>();
  if (
    !row ||
    !row.token_hash ||
    (await hashQuoteLinkSecret(secret)) !== row.token_hash
  ) {
    throw new Error("QUOTE_LINK_NOT_FOUND");
  }
  const now = new Date().toISOString();
  if (
    String(row.expires_at) <= now ||
    (row.valid_until && String(row.valid_until) < now.slice(0, 10))
  ) {
    throw new Error("QUOTE_LINK_EXPIRED");
  }
  if (
    row.status !== "active" ||
    row.version_status !== "issued" ||
    Number(row.version_number) !== Number(row.current_version_number)
  ) {
    throw new Error("QUOTE_LINK_STOPPED");
  }
  return {
    ...row,
    id: String(row.id),
    quote_id: String(row.quote_id),
    quote_version_id: String(row.quote_version_id),
    work_order_id: String(row.work_order_id),
    firebase_uid: String(row.firebase_uid),
    crm_customer_id: String(row.crm_customer_id),
    token_issue: Number(row.token_issue),
    expires_at: String(row.expires_at),
    document_snapshot_json: String(row.document_snapshot_json || ""),
    invoice_payment_account_name: String(row.invoice_payment_account_name || ""),
    invoice_payment_bsb: String(row.invoice_payment_bsb || ""),
    invoice_payment_account_number: String(row.invoice_payment_account_number || ""),
    invoice_payment_reference: String(row.invoice_payment_reference || ""),
    invoice_default_terms: String(row.invoice_default_terms || ""),
  };
}

export async function quoteDocumentSnapshotForAuthorisedLink(
  row: AuthorisedTradeQuoteLink,
) {
  const storedSnapshot = row.document_snapshot_json.trim();
  const snapshot = storedSnapshot
    ? parseTradeQuoteDocumentSnapshot(storedSnapshot)
    : await buildTradeQuoteDocumentSnapshot(
      row.firebase_uid,
      row.quote_version_id,
    );
  if (
    !snapshot ||
    snapshot.quoteId !== row.quote_id ||
    snapshot.quoteVersionId !== row.quote_version_id ||
    snapshot.work.id !== row.work_order_id ||
    snapshot.customer.id !== row.crm_customer_id
  ) {
    throw new Error("QUOTE_DOCUMENT_SNAPSHOT_INVALID");
  }
  return snapshot;
}

export async function buildTradeQuoteReviewPayload(
  row: AuthorisedTradeQuoteLink,
): Promise<TradeQuoteReviewPayload> {
  const [snapshot, questions] = await Promise.all([
    quoteDocumentSnapshotForAuthorisedLink(row),
    getD1()
      .prepare(
        "SELECT id, question, answer, status, asked_at, answered_at FROM trade_crm_quote_questions WHERE quote_version_id = ? AND firebase_uid = ? ORDER BY asked_at",
      )
      .bind(row.quote_version_id, row.firebase_uid)
      .all<Row>(),
  ]);
  return {
    linkId: row.id,
    tokenIssue: row.token_issue,
    quoteVersionId: snapshot.quoteVersionId,
    quoteNumber: snapshot.quoteNumber,
    versionNumber: snapshot.versionNumber,
    workNumber: snapshot.work.number,
    workTitle: snapshot.work.title,
    customerName: snapshot.customer.name,
    customerNumber: snapshot.customer.number,
    siteLabel: snapshot.site.label,
    siteSummary: snapshot.site.summary,
    business: {
      name: snapshot.business.name,
      email: snapshot.business.email,
      phone: snapshot.business.phone,
      abn: snapshot.business.abn,
      website: snapshot.business.website,
      themeKey: snapshot.business.themeKey,
      borderStyle: snapshot.business.borderStyle,
      hasLogo: Boolean(snapshot.business.logo),
      hasBanner: Boolean(snapshot.business.banner),
      bannerCrop: snapshot.business.bannerCrop || DEFAULT_BANNER_CROP,
    },
    subtotalCents: snapshot.subtotalCents,
    taxCents: snapshot.taxCents,
    totalCents: snapshot.totalCents,
    customerMessage: snapshot.customerMessage,
    terms: snapshot.terms,
    validUntil: snapshot.validUntil,
    issuedAt: snapshot.issuedAt,
    consentStatement: snapshot.consentStatement,
    expiresAt: row.expires_at,
    items: snapshot.items,
    choices: snapshot.choices,
    questions: questions.results.map((question) => ({
      id: cleanText(question.id, 180),
      question: cleanText(question.question, 1_000, true),
      answer: cleanText(question.answer, 2_000, true),
      status: cleanText(question.status, 30),
      askedAt: cleanText(question.asked_at, 40),
      answeredAt: cleanText(question.answered_at, 40),
    })),
  };
}

function publicFailureCode(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (
    [
      "QUOTE_DOCUMENT_SNAPSHOT_INVALID",
      "QUOTE_ISSUED_PDF_MISMATCH",
      "QUOTE_ISSUED_PDF_UNAVAILABLE",
      "INVALID_COMMERCIAL_HANDOFF",
      "QUOTE_DECISION_CONFLICT",
      "QUOTE_JOB_ALREADY_ACCEPTED",
      "INVALID_ACCEPTED_INVOICE",
      "QUOTE_DECISION_REPLAY_MISMATCH",
      "QUOTE_DECISION_RECEIPT_INVALID",
      "QUOTE_LINK_EXPIRED",
      "QUOTE_LINK_STOPPED",
      "QUOTE_LINK_INVALID",
      "QUOTE_LINK_NOT_FOUND",
    ].includes(code)
  ) {
    return code;
  }
  if (code.startsWith("PDF_") || code.includes("font")) {
    return "QUOTE_PDF_RENDER_FAILED";
  }
  return "QUOTE_PUBLIC_REQUEST_FAILED";
}

export function tradeQuoteTokenErrorResponse(
  error: unknown,
  stage = "review",
) {
  const code = error instanceof Error ? error.message : "";
  const requestId = crypto.randomUUID();
  console.error("Trade quote public request failed", {
    code: publicFailureCode(error),
    requestId,
    stage,
  });
  let response: Response;
  if (code === "QUOTE_DOCUMENT_SNAPSHOT_INVALID") {
    response = adminJson(
      {
        ok: false,
        error:
          "This quote document could not be verified. Ask the trade business to issue a replacement.",
      },
      409,
    );
  } else if (
    code === "QUOTE_ISSUED_PDF_MISMATCH" ||
    code === "QUOTE_ISSUED_PDF_UNAVAILABLE"
  ) {
    response = adminJson(
      {
        ok: false,
        error:
          "The exact issued quote PDF could not be verified. Ask the trade business to issue a replacement.",
      },
      409,
    );
  } else if (code === "INVALID_COMMERCIAL_HANDOFF") {
    response = adminJson(
      {
        ok: false,
        error:
          "This quote could not be accepted because its recorded totals could not be verified. Ask the trade business to issue a replacement.",
        requestId,
      },
      409,
    );
  } else if (code === "QUOTE_DECISION_CONFLICT") {
    response = adminJson(
      {
        ok: false,
        error:
          "This quote changed before your decision could be recorded. Refresh the page and check its current status.",
        requestId,
      },
      409,
    );
  } else if (code === "QUOTE_JOB_ALREADY_ACCEPTED") {
    response = adminJson(
      {
        ok: false,
        error:
          "This job already has a recorded accepted quote and invoice. Ask the trade business to review it before accepting another quote.",
        requestId,
      },
      409,
    );
  } else if (code === "QUOTE_DECISION_REPLAY_MISMATCH") {
    response = adminJson(
      {
        ok: false,
        error:
          "This quote already has a different recorded decision. Refresh the page to see its receipt.",
        requestId,
      },
      409,
    );
  } else if (
    code === "INVALID_ACCEPTED_INVOICE" ||
    code === "QUOTE_DECISION_RECEIPT_INVALID"
  ) {
    response = adminJson(
      {
        ok: false,
        error:
          "The decision could not be safely completed. No duplicate invoice was created. Ask the trade business to check the quote.",
        requestId,
      },
      409,
    );
  } else if (code === "QUOTE_LINK_EXPIRED") {
    response = adminJson(
      {
        ok: false,
        error: "This quote link has expired. Ask the trade business for a new one.",
      },
      410,
    );
  } else if (code === "QUOTE_LINK_STOPPED") {
    response = adminJson(
      { ok: false, error: "This quote link is no longer active." },
      410,
    );
  } else if (code === "QUOTE_LINK_INVALID" || code === "QUOTE_LINK_NOT_FOUND") {
    response = adminJson(
      { ok: false, error: "This quote link is not valid." },
      404,
    );
  } else {
    response = adminJson(
      {
        ok: false,
        error: "This quote could not be opened.",
        requestId,
      },
      500,
    );
  }
  response.headers.set("X-TLink-Request-Id", requestId);
  return response;
}
