export type QuickInvoiceLine = {
  lineId: string;
  priceBookItemId: string;
  priceRevision: number;
  description: string;
  quantity: number;
  unitPriceCentsExGst: number;
  taxCode: "gst" | "none";
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

export type QuickInvoiceDraft = {
  lines: QuickInvoiceLine[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
};

export type QuickInvoiceBrandAssetSnapshot = {
  objectKey: string;
  contentType: "image/png" | "image/jpeg";
};

export type QuickInvoiceBannerCropSnapshot = {
  xBasisPoints: number;
  yBasisPoints: number;
  widthBasisPoints: number;
  heightBasisPoints: number;
};

export type QuickInvoiceDocumentSnapshot = {
  schemaVersion: "trade-quick-invoice-document-v1";
  capturedAt: string;
  invoiceId: string;
  invoiceNumber: string;
  revision: number;
  currency: "AUD";
  dueAt: string;
  issuedAt: string;
  business: {
    name: string;
    phone: string;
    email: string;
    abn: string;
    website: string;
    address: string;
    themeKey: string;
    borderStyle: string;
    logo: QuickInvoiceBrandAssetSnapshot | null;
    banner: QuickInvoiceBrandAssetSnapshot | null;
    bannerCrop: QuickInvoiceBannerCropSnapshot;
  };
  payment: {
    accountName: string;
    bsb: string;
    accountNumber: string;
    reference: string;
    terms: string;
  };
  customer: {
    id: string;
    number: string;
    name: string;
    email: string;
    phone: string;
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
  work: {
    id: string;
    number: string;
    title: string;
  };
  lines: QuickInvoiceLine[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
};

type InvoiceTotalLine = Pick<
  QuickInvoiceLine,
  "subtotalCents" | "taxCents" | "totalCents"
> &
  Partial<Pick<QuickInvoiceLine, "taxCode">>;

function proportionalCents(
  totalCents: number,
  bucketCents: number,
  subtotalCents: number,
) {
  if (!totalCents || !bucketCents) return 0;
  const numerator =
    BigInt(totalCents) * BigInt(bucketCents) +
    BigInt(Math.floor(subtotalCents / 2));
  return Number(numerator / BigInt(subtotalCents));
}

export function quickInvoiceTotals(
  lines: InvoiceTotalLine[],
  discountCents = 0,
) {
  if (
    !Number.isInteger(discountCents) ||
    discountCents < 0 ||
    lines.some(
      (line) =>
        !Number.isInteger(line.subtotalCents) ||
        line.subtotalCents < 0 ||
        !Number.isInteger(line.taxCents) ||
        line.taxCents < 0 ||
        !Number.isInteger(line.totalCents) ||
        line.totalCents < 0 ||
        line.totalCents !== line.subtotalCents + line.taxCents ||
        (line.taxCode === "none" && line.taxCents !== 0),
    )
  ) {
    throw new TypeError("INVALID_QUICK_INVOICE");
  }
  const subtotalCents = lines.reduce(
    (total, line) => total + line.subtotalCents,
    0,
  );
  if (
    discountCents > 0 &&
    (subtotalCents <= 0 || discountCents >= subtotalCents)
  ) {
    throw new TypeError("INVALID_QUICK_INVOICE");
  }
  const taxableSubtotalCents = lines.reduce(
    (total, line) =>
      total +
      (line.taxCode === "gst" ||
      (line.taxCode === undefined && line.taxCents > 0)
        ? line.subtotalCents
        : 0),
    0,
  );
  const taxableDiscountCents = Math.min(
    taxableSubtotalCents,
    proportionalCents(
      discountCents,
      taxableSubtotalCents,
      subtotalCents,
    ),
  );
  const lineTaxCents = lines.reduce(
    (total, line) => total + line.taxCents,
    0,
  );
  const taxDiscountCents = Math.min(
    lineTaxCents,
    Math.floor((taxableDiscountCents + 5) / 10),
  );
  const taxCents = lineTaxCents - taxDiscountCents;
  return {
    subtotalCents,
    discountCents,
    taxableDiscountCents,
    gstFreeDiscountCents: discountCents - taxableDiscountCents,
    taxCents,
    totalCents: subtotalCents - discountCents + taxCents,
  };
}

function snapshotText(value: unknown, maximum: number, multiline = false) {
  const text = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ")
    .replace(/[\u2013\u2014]/g, "-");
  return (multiline
    ? text
        .split("\n")
        .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
    : text.replace(/\s+/g, " ").trim()
  ).slice(0, maximum);
}

function snapshotInteger(value: unknown, maximum = 100_000_000) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= maximum
    ? number
    : -1;
}

function snapshotAsset(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const objectKey = snapshotText(row.objectKey, 1_000);
  const contentType = snapshotText(row.contentType, 100).toLowerCase();
  return objectKey &&
    (contentType === "image/png" || contentType === "image/jpeg")
    ? {
        objectKey,
        contentType,
      } as QuickInvoiceBrandAssetSnapshot
    : null;
}

function snapshotCrop(value: unknown): QuickInvoiceBannerCropSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const xBasisPoints = snapshotInteger(row.xBasisPoints, 10_000);
  const yBasisPoints = snapshotInteger(row.yBasisPoints, 10_000);
  const widthBasisPoints = snapshotInteger(row.widthBasisPoints, 10_000);
  const heightBasisPoints = snapshotInteger(row.heightBasisPoints, 10_000);
  if (
    xBasisPoints < 0 ||
    yBasisPoints < 0 ||
    widthBasisPoints < 1 ||
    heightBasisPoints < 1 ||
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

function snapshotLine(value: unknown): QuickInvoiceLine | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const description = snapshotText(row.description, 180);
  const taxCode = row.taxCode === "gst" || row.taxCode === "none"
    ? row.taxCode
    : null;
  const unitPriceCentsExGst = snapshotInteger(row.unitPriceCentsExGst);
  const subtotalCents = snapshotInteger(row.subtotalCents);
  const taxCents = snapshotInteger(row.taxCents);
  const totalCents = snapshotInteger(row.totalCents);
  if (
    !description ||
    !taxCode ||
    unitPriceCentsExGst < 0 ||
    subtotalCents < 0 ||
    taxCents < 0 ||
    totalCents < 0 ||
    totalCents !== subtotalCents + taxCents ||
    (taxCode === "none" && taxCents !== 0)
  ) {
    return null;
  }
  return {
    lineId: snapshotText(row.lineId, 180),
    priceBookItemId: snapshotText(row.priceBookItemId, 180),
    priceRevision: Math.max(0, snapshotInteger(row.priceRevision, 1_000_000)),
    description,
    quantity: Math.max(1, snapshotInteger(row.quantity, 100_000)),
    unitPriceCentsExGst,
    taxCode,
    subtotalCents,
    taxCents,
    totalCents,
  };
}

export function normaliseQuickInvoiceDocumentSnapshot(
  value: unknown,
): QuickInvoiceDocumentSnapshot | null {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const row = parsed as Record<string, unknown>;
  if (
    row.schemaVersion !== "trade-quick-invoice-document-v1" ||
    !row.business ||
    !row.payment ||
    !row.customer ||
    !row.site ||
    !row.work ||
    !Array.isArray(row.lines)
  ) {
    return null;
  }
  const business = row.business as Record<string, unknown>;
  const payment = row.payment as Record<string, unknown>;
  const customer = row.customer as Record<string, unknown>;
  const site = row.site as Record<string, unknown>;
  const work = row.work as Record<string, unknown>;
  const lines = row.lines
    .slice(0, 8)
    .map(snapshotLine)
    .filter(Boolean) as QuickInvoiceLine[];
  const invoiceId = snapshotText(row.invoiceId, 180);
  const invoiceNumber = snapshotText(row.invoiceNumber, 120);
  const businessName = snapshotText(business.name, 240);
  const bannerCrop = snapshotCrop(business.bannerCrop);
  const subtotalCents = snapshotInteger(row.subtotalCents);
  const discountCents = snapshotInteger(row.discountCents);
  const taxCents = snapshotInteger(row.taxCents);
  const totalCents = snapshotInteger(row.totalCents);
  if (
    !invoiceId ||
    !invoiceNumber ||
    !businessName ||
    !bannerCrop ||
    !lines.length ||
    subtotalCents < 1 ||
    discountCents < 0 ||
    taxCents < 0 ||
    totalCents < 1
  ) {
    return null;
  }
  let totals;
  try {
    totals = quickInvoiceTotals(lines, discountCents);
  } catch {
    return null;
  }
  if (
    totals.subtotalCents !== subtotalCents ||
    totals.taxCents !== taxCents ||
    totals.totalCents !== totalCents
  ) {
    return null;
  }
  return {
    schemaVersion: "trade-quick-invoice-document-v1",
    capturedAt: snapshotText(row.capturedAt, 40),
    invoiceId,
    invoiceNumber,
    revision: Math.max(1, snapshotInteger(row.revision, 1_000_000)),
    currency: "AUD",
    dueAt: snapshotText(row.dueAt, 20),
    issuedAt: snapshotText(row.issuedAt, 40),
    business: {
      name: businessName,
      phone: snapshotText(business.phone, 60),
      email: snapshotText(business.email, 254),
      abn: snapshotText(business.abn, 20),
      website: snapshotText(business.website, 500),
      address: snapshotText(business.address, 800),
      themeKey: snapshotText(business.themeKey, 60) || "emerald_navy",
      borderStyle: snapshotText(business.borderStyle, 30) || "soft",
      logo: snapshotAsset(business.logo),
      banner: snapshotAsset(business.banner),
      bannerCrop,
    },
    payment: {
      accountName: snapshotText(payment.accountName, 180),
      bsb: snapshotText(payment.bsb, 20),
      accountNumber: snapshotText(payment.accountNumber, 40),
      reference: snapshotText(payment.reference, 120),
      terms: snapshotText(payment.terms, 20_000, true),
    },
    customer: {
      id: snapshotText(customer.id, 180),
      number: snapshotText(customer.number, 120),
      name: snapshotText(customer.name, 240),
      email: snapshotText(customer.email, 254),
      phone: snapshotText(customer.phone, 60),
    },
    site: {
      id: snapshotText(site.id, 180),
      label: snapshotText(site.label, 160),
      addressLine1: snapshotText(site.addressLine1, 300),
      addressLine2: snapshotText(site.addressLine2, 300),
      suburb: snapshotText(site.suburb, 160),
      state: snapshotText(site.state, 16),
      postcode: snapshotText(site.postcode, 12),
      summary: snapshotText(site.summary, 800),
    },
    work: {
      id: snapshotText(work.id, 180),
      number: snapshotText(work.number, 120),
      title: snapshotText(work.title, 300),
    },
    lines,
    subtotalCents,
    discountCents,
    taxCents,
    totalCents,
  };
}
