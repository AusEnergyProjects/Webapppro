/// <reference types="vite/client" />

import boldFontDataUri from "../../public/fonts/LiberationSans-Bold.ttf?inline";
import regularFontDataUri from "../../public/fonts/LiberationSans-Regular.ttf?inline";

export type CustomerPlanPdfFonts = {
  regular: Uint8Array;
  bold: Uint8Array;
};

const MIN_FONT_BYTES = 10_000;
const MAX_FONT_BYTES = 500_000;
const TRUE_TYPE_SIGNATURE = [0x00, 0x01, 0x00, 0x00] as const;
const BUNDLED_FONT_DATA = {
  regular: regularFontDataUri,
  bold: boldFontDataUri,
} as const;

let fontCache: Promise<CustomerPlanPdfFonts> | undefined;

export class CustomerPlanPdfFontError extends Error {
  readonly code = "CUSTOMER_PLAN_PDF_FONT_INVALID";

  constructor(readonly weight: keyof CustomerPlanPdfFonts) {
    super(`CUSTOMER_PLAN_PDF_${weight.toUpperCase()}_FONT_INVALID`);
    this.name = "CustomerPlanPdfFontError";
  }
}

function decodeAndValidateFont(
  weight: keyof CustomerPlanPdfFonts,
  dataUri: string,
) {
  const separator = dataUri.indexOf(",");
  if (
    separator < 0
    || !/^data:[^,]*;base64$/i.test(dataUri.slice(0, separator))
  ) {
    throw new CustomerPlanPdfFontError(weight);
  }

  let decoded: string;
  try {
    decoded = atob(dataUri.slice(separator + 1));
  } catch {
    throw new CustomerPlanPdfFontError(weight);
  }

  if (decoded.length < MIN_FONT_BYTES || decoded.length > MAX_FONT_BYTES) {
    throw new CustomerPlanPdfFontError(weight);
  }

  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  if (
    !TRUE_TYPE_SIGNATURE.every((value, index) => bytes[index] === value)
  ) {
    throw new CustomerPlanPdfFontError(weight);
  }
  return bytes;
}

export function loadCustomerPlanPdfFonts(): Promise<CustomerPlanPdfFonts> {
  if (fontCache) return fontCache;

  fontCache = Promise.resolve().then(() => ({
    regular: decodeAndValidateFont("regular", BUNDLED_FONT_DATA.regular),
    bold: decodeAndValidateFont("bold", BUNDLED_FONT_DATA.bold),
  })).catch((error) => {
    fontCache = undefined;
    throw error;
  });
  return fontCache;
}
