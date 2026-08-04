import { env } from "cloudflare:workers";
import {
  buildTradeQuoteDocumentSnapshot,
  type TradeQuoteBrandAssetSnapshot,
  type TradeQuoteDocumentSnapshot,
} from "@/lib/trade-quote-review-server";
import { createTradeQuotePdfBytes } from "@/lib/trade-quote-pdf.mjs";

const FONT_PATHS = {
  regular: "/fonts/LiberationSans-Regular.ttf",
  bold: "/fonts/LiberationSans-Bold.ttf",
} as const;
const MAX_FONT_BYTES = 500_000;
const MAX_BRAND_ASSET_BYTES = 4_000_000;

type QuoteAssetObject = {
  size?: number;
  httpMetadata?: { contentType?: string };
  arrayBuffer(): Promise<ArrayBuffer>;
};

type QuoteAssetBucket = {
  get(key: string): Promise<QuoteAssetObject | null>;
};

export type TradeQuotePdfBrandAsset = {
  bytes: Uint8Array;
  contentType: "image/png" | "image/jpeg";
};

export type TradeQuotePdfBrandAssets = {
  logo?: TradeQuotePdfBrandAsset;
  banner?: TradeQuotePdfBrandAsset;
};

export type RenderTradeQuotePdfOptions = {
  origin: string;
  assets?: TradeQuotePdfBrandAssets;
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
    throw new TypeError("A secure site origin is required for quote PDFs.");
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
      const suppliedLength = Number(
        response.headers.get("content-length") || 0,
      );
      if (
        Number.isFinite(suppliedLength) &&
        suppliedLength > MAX_FONT_BYTES
      ) {
        throw new Error(`PDF_${weight.toUpperCase()}_FONT_INVALID`);
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

function quoteAssetBucket() {
  return (env as unknown as { EVIDENCE?: QuoteAssetBucket }).EVIDENCE;
}

async function loadBrandAsset(
  asset: TradeQuoteBrandAssetSnapshot | null,
): Promise<TradeQuotePdfBrandAsset | undefined> {
  if (!asset) return undefined;
  const bucket = quoteAssetBucket();
  if (!bucket) return undefined;
  const object = await bucket.get(asset.objectKey);
  if (!object) return undefined;
  const metadataType = String(object.httpMetadata?.contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (
    metadataType &&
    metadataType !== asset.contentType
  ) {
    return undefined;
  }
  if (
    Number(object.size || 0) > MAX_BRAND_ASSET_BYTES
  ) {
    return undefined;
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (
    bytes.byteLength < 20 ||
    bytes.byteLength > MAX_BRAND_ASSET_BYTES
  ) {
    return undefined;
  }
  return { bytes, contentType: asset.contentType };
}

export async function loadTradeQuoteBrandAssets(
  snapshot: TradeQuoteDocumentSnapshot,
): Promise<TradeQuotePdfBrandAssets> {
  const [logo, banner] = await Promise.all([
    loadBrandAsset(snapshot.business.logo),
    loadBrandAsset(snapshot.business.banner),
  ]);
  return { logo, banner };
}

export function tradeQuoteBrandAssetSnapshot(
  snapshot: TradeQuoteDocumentSnapshot,
  kind: "logo" | "banner",
) {
  return snapshot.business[kind];
}

export async function loadTradeQuoteBrandAsset(
  snapshot: TradeQuoteDocumentSnapshot,
  kind: "logo" | "banner",
) {
  return loadBrandAsset(tradeQuoteBrandAssetSnapshot(snapshot, kind));
}

export async function renderTradeQuotePdf(
  snapshot: TradeQuoteDocumentSnapshot,
  options: RenderTradeQuotePdfOptions,
) {
  const [fonts, assets] = await Promise.all([
    fontsForOrigin(options.origin).catch(() => null),
    options.assets
      ? Promise.resolve(options.assets)
      : loadTradeQuoteBrandAssets(snapshot).catch(() => ({})),
  ]);
  try {
    return new Uint8Array(
      await createTradeQuotePdfBytes(snapshot, fonts || undefined, assets),
    );
  } catch (error) {
    if (!fonts) throw error;
    return new Uint8Array(
      await createTradeQuotePdfBytes(snapshot, undefined, assets),
    );
  }
}

export function tradeQuotePdfFilename(
  snapshot: Pick<TradeQuoteDocumentSnapshot, "quoteNumber" | "versionNumber">,
) {
  const number =
    String(snapshot.quoteNumber || "quote")
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "quote";
  return `${number}-v${Math.max(1, Number(snapshot.versionNumber) || 1)}.pdf`;
}

export async function tradeQuotePdfSha256(bytes: Uint8Array) {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      input.buffer,
    ),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function tradeQuotePdfBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

export async function generateTradeQuotePdfForVersion(
  ownerUid: string,
  versionId: string,
  options: { origin: string },
) {
  const snapshot = await buildTradeQuoteDocumentSnapshot(ownerUid, versionId);
  const bytes = await renderTradeQuotePdf(snapshot, options);
  return {
    snapshot,
    bytes,
    base64: tradeQuotePdfBase64(bytes),
    filename: tradeQuotePdfFilename(snapshot),
    sha256: await tradeQuotePdfSha256(bytes),
  };
}
