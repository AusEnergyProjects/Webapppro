import { env } from "cloudflare:workers";
import type {
  QuickInvoiceBrandAssetSnapshot,
  QuickInvoiceDocumentSnapshot,
} from "@/lib/trade-quick-invoice";
import { createTradeQuickInvoicePdfBytes } from "@/lib/trade-quick-invoice-pdf.mjs";

const FONT_PATHS = {
  regular: "/fonts/LiberationSans-Regular.ttf",
  bold: "/fonts/LiberationSans-Bold.ttf",
} as const;
const MAX_FONT_BYTES = 500_000;
const MAX_ASSET_BYTES = 4_000_000;

type AssetObject = {
  size?: number;
  httpMetadata?: { contentType?: string };
  arrayBuffer(): Promise<ArrayBuffer>;
};

type AssetBucket = {
  get(key: string): Promise<AssetObject | null>;
};

type PdfAsset = {
  bytes: Uint8Array;
  contentType: "image/png" | "image/jpeg";
};

const fontCache = new Map<
  string,
  Promise<{ regular: Uint8Array; bold: Uint8Array }>
>();

function secureOrigin(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    )
  ) {
    throw new TypeError("A secure site origin is required for invoice PDFs.");
  }
  return url.origin;
}

function fontsForOrigin(input: string) {
  const origin = secureOrigin(input);
  const cached = fontCache.get(origin);
  if (cached) return cached;
  const loading = Promise.all(
    Object.entries(FONT_PATHS).map(async ([weight, path]) => {
      const response = await fetch(new URL(path, origin), {
        cache: "force-cache",
      });
      if (!response.ok) {
        throw new Error(`PDF_${weight.toUpperCase()}_FONT_UNAVAILABLE`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength < 10_000 || bytes.byteLength > MAX_FONT_BYTES) {
        throw new Error(`PDF_${weight.toUpperCase()}_FONT_INVALID`);
      }
      return [weight, bytes] as const;
    }),
  )
    .then(
      (entries) =>
        Object.fromEntries(entries) as {
          regular: Uint8Array;
          bold: Uint8Array;
        },
    )
    .catch((error) => {
      fontCache.delete(origin);
      throw error;
    });
  fontCache.set(origin, loading);
  return loading;
}

function assetBucket() {
  return (env as unknown as { EVIDENCE?: AssetBucket }).EVIDENCE;
}

async function loadAsset(
  snapshot: QuickInvoiceBrandAssetSnapshot | null,
): Promise<PdfAsset | undefined> {
  if (!snapshot) return undefined;
  const bucket = assetBucket();
  if (!bucket) return undefined;
  const object = await bucket.get(snapshot.objectKey);
  if (!object || Number(object.size || 0) > MAX_ASSET_BYTES) return undefined;
  const contentType = String(object.httpMetadata?.contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType && contentType !== snapshot.contentType) return undefined;
  const bytes = new Uint8Array(await object.arrayBuffer());
  return bytes.byteLength >= 20 && bytes.byteLength <= MAX_ASSET_BYTES
    ? { bytes, contentType: snapshot.contentType }
    : undefined;
}

export async function renderTradeQuickInvoicePdf(
  snapshot: QuickInvoiceDocumentSnapshot,
  options: { origin: string },
) {
  const [fonts, logo, banner] = await Promise.all([
    fontsForOrigin(options.origin).catch(() => undefined),
    loadAsset(snapshot.business.logo).catch(() => undefined),
    loadAsset(snapshot.business.banner).catch(() => undefined),
  ]);
  return new Uint8Array(
    await createTradeQuickInvoicePdfBytes(snapshot, fonts, {
      logo,
      banner,
    }),
  );
}

export function tradeQuickInvoicePdfFilename(
  snapshot: Pick<QuickInvoiceDocumentSnapshot, "invoiceNumber" | "revision">,
) {
  const number =
    String(snapshot.invoiceNumber || "invoice")
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "invoice";
  return `${number}-r${Math.max(1, Number(snapshot.revision) || 1)}.pdf`;
}

export function tradeQuickInvoicePdfBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}
