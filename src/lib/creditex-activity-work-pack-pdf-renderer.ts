import {
  PDFDocument,
  clip,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  type PDFFont,
  type PDFPage,
  rgb,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

import {
  CREDITEX_ACTIVITY_WORK_PACK_PDF_RENDERER_CONTRACT,
  CREDITEX_ACTIVITY_WORK_PACK_PDF_RENDERER_VERSION,
  type CreditexActivityWorkPackSignaturePayload,
  type CreditexWorkPackDocumentOutput,
  type CreditexWorkPackDocumentPlacement,
} from "./creditex-activity-work-pack.ts";
import { loadCustomerPlanPdfFonts } from "./customer-plan-pdf-fonts.ts";

export type CreditexWorkPackPdfRenderContext = Readonly<{
  prefill: Readonly<Record<string, unknown>>;
  response: Readonly<Record<string, unknown>>;
  declarations: Readonly<Record<string, unknown>>;
}>;

export type CreditexWorkPackPdfSignature = Readonly<{
  promptKey: string;
  signerRoleKey: string;
  signerName: string;
  signerCapacity: string;
  signedAt: string;
  payload: CreditexActivityWorkPackSignaturePayload;
}>;

export type CreditexWorkPackPdfRenderResult = Readonly<{
  rendererContract: typeof CREDITEX_ACTIVITY_WORK_PACK_PDF_RENDERER_CONTRACT;
  rendererVersion: typeof CREDITEX_ACTIVITY_WORK_PACK_PDF_RENDERER_VERSION;
  bytes: Uint8Array;
}>;

export class CreditexWorkPackPdfRenderError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CreditexWorkPackPdfRenderError";
    this.code = code;
  }
}

function renderFailure(code: string, message: string): never {
  throw new CreditexWorkPackPdfRenderError(code, message);
}

function pointerValue(root: Readonly<Record<string, unknown>>, path: string) {
  if (!path.startsWith("/")) {
    return renderFailure(
      "WORK_PACK_PDF_SOURCE_PATH_INVALID",
      "A mapped PDF source path is invalid.",
    );
  }
  let current: unknown = root;
  for (const encodedPart of path.slice(1).split("/")) {
    const part = encodedPart.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(part) || Number(part) >= current.length) return undefined;
      current = current[Number(part)];
      continue;
    }
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function textValue(
  value: unknown,
  format: CreditexWorkPackDocumentPlacement["textFormat"],
): string {
  if (format === "boolean_mark") return value === true ? "X" : "";
  if (format === "date_au") {
    const source = String(value ?? "");
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(source);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : source;
  }
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((entry) => textValue(entry, "text")).join(", ");
  return renderFailure(
    "WORK_PACK_PDF_SOURCE_VALUE_INVALID",
    "A mapped PDF value is not a supported visible value.",
  );
}

function wrapLine(font: PDFFont, value: string, size: number, width: number) {
  if (!value) return [""];
  const lines: string[] = [];
  for (const paragraph of value.replace(/\r/g, "").split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines;
}

function fittedText(
  font: PDFFont,
  value: string,
  placement: CreditexWorkPackDocumentPlacement,
  width: number,
  height: number,
) {
  let size = placement.fontSize;
  while (size >= placement.minimumFontSize) {
    const lines = placement.overflow === "wrap"
      ? wrapLine(font, value, size, width)
      : [value];
    const visible = lines.slice(0, placement.maximumLines);
    const lineHeight = size * 1.2;
    const fitsWidth = visible.every((line) => font.widthOfTextAtSize(line, size) <= width);
    const fitsHeight = visible.length * lineHeight <= height;
    if ((fitsWidth || placement.overflow === "clip") && fitsHeight) {
      return { lines: visible, size, lineHeight };
    }
    if (placement.overflow === "clip") break;
    size -= 0.5;
  }
  if (placement.overflow === "clip") {
    return {
      lines: [value],
      size: placement.minimumFontSize,
      lineHeight: placement.minimumFontSize * 1.2,
    };
  }
  return renderFailure(
    "WORK_PACK_PDF_TEXT_OVERFLOW",
    `Mapped value ${placement.placementKey} does not fit its approved PDF placement.`,
  );
}

function drawMappedText(
  page: PDFPage,
  font: PDFFont,
  value: string,
  placement: CreditexWorkPackDocumentPlacement,
) {
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const x = placement.x * pageWidth;
  const top = pageHeight * (1 - placement.y);
  const width = placement.width * pageWidth;
  const height = placement.height * pageHeight;
  const fitted = fittedText(font, value, placement, width, height);
  if (placement.overflow === "clip") {
    page.pushOperators(
      pushGraphicsState(),
      rectangle(x, top - height, width, height),
      clip(),
      endPath(),
    );
  }
  try {
    for (let index = 0; index < fitted.lines.length; index += 1) {
      page.drawText(fitted.lines[index], {
        x,
        y: top - fitted.size - (index * fitted.lineHeight),
        size: fitted.size,
        font,
        color: rgb(0, 0, 0),
        maxWidth: width,
      });
    }
  } finally {
    if (placement.overflow === "clip") {
      page.pushOperators(popGraphicsState());
    }
  }
}

function drawMappedSignature(
  page: PDFPage,
  signature: CreditexWorkPackPdfSignature,
  placement: CreditexWorkPackDocumentPlacement,
) {
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const left = placement.x * pageWidth;
  const top = pageHeight * (1 - placement.y);
  const width = placement.width * pageWidth;
  const height = placement.height * pageHeight;
  let drewPoint = false;
  for (const stroke of signature.payload.strokes) {
    for (let index = 1; index < stroke.points.length; index += 1) {
      const from = stroke.points[index - 1];
      const to = stroke.points[index];
      page.drawLine({
        start: {
          x: left + (from.x * width),
          y: top - (from.y * height),
        },
        end: {
          x: left + (to.x * width),
          y: top - (to.y * height),
        },
        thickness: 1.35,
        color: rgb(0, 0, 0),
      });
      drewPoint = true;
    }
    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      page.drawCircle({
        x: left + (point.x * width),
        y: top - (point.y * height),
        size: 0.75,
        color: rgb(0, 0, 0),
      });
      drewPoint = true;
    }
  }
  if (!drewPoint) {
    return renderFailure(
      "WORK_PACK_PDF_SIGNATURE_EMPTY",
      "A required visible signature contains no renderable strokes.",
    );
  }
}

export async function renderCreditexActivityWorkPackPdf(input: Readonly<{
  templateBytes: Uint8Array;
  output: CreditexWorkPackDocumentOutput;
  context: CreditexWorkPackPdfRenderContext;
  signatures: readonly CreditexWorkPackPdfSignature[];
}>): Promise<CreditexWorkPackPdfRenderResult> {
  if (
    input.output.rendererVersion !== CREDITEX_ACTIVITY_WORK_PACK_PDF_RENDERER_VERSION
    || !input.output.required
  ) {
    return renderFailure(
      "WORK_PACK_PDF_OUTPUT_NOT_SUPPORTED",
      "The required PDF output does not use the supported governed renderer.",
    );
  }
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(input.templateBytes, {
      updateMetadata: false,
      ignoreEncryption: false,
    });
  } catch {
    return renderFailure(
      "WORK_PACK_PDF_TEMPLATE_INVALID",
      "The approved source PDF cannot be rendered safely.",
    );
  }
  const pages = document.getPages();
  document.registerFontkit(fontkit);
  const bundledFonts = await loadCustomerPlanPdfFonts();
  const helvetica = await document.embedFont(bundledFonts.regular, {
    subset: true,
  });
  const helveticaBold = await document.embedFont(bundledFonts.bold, {
    subset: true,
  });
  const signatures = new Map(input.signatures.map((signature) => [
    `${signature.promptKey}\u0000${signature.signerRoleKey}`,
    signature,
  ]));
  const signatureText: Record<string, Record<string, Record<string, string>>> = {};
  for (const signature of input.signatures) {
    signatureText[signature.promptKey] ||= {};
    signatureText[signature.promptKey][signature.signerRoleKey] = {
      signerName: signature.signerName,
      signerRole: signature.signerRoleKey,
      signerCapacity: signature.signerCapacity,
      signedAt: signature.signedAt,
    };
  }
  const context: Readonly<Record<string, unknown>> = Object.freeze({
    prefill: input.context.prefill,
    response: input.context.response,
    declarations: input.context.declarations,
    signatures: signatureText,
  });
  for (const placement of input.output.placements) {
    const page = pages[placement.pageIndex];
    if (!page) {
      return renderFailure(
        "WORK_PACK_PDF_PAGE_INVALID",
        `Mapped placement ${placement.placementKey} references a missing PDF page.`,
      );
    }
    if (placement.kind === "signature") {
      const exact = signatures.get(
        `${placement.signaturePromptKey}\u0000${placement.signerRoleKey}`,
      );
      const candidates = exact
        ? [exact]
        : input.signatures.filter((candidate) =>
          candidate.signerRoleKey === placement.signerRoleKey
          && candidate.promptKey.endsWith(`].${placement.signaturePromptKey}`)
        );
      if (candidates.length !== 1) {
        return renderFailure(
          "WORK_PACK_PDF_SIGNATURE_MISSING",
          `Required signature ${placement.signaturePromptKey} is missing or ambiguous.`,
        );
      }
      drawMappedSignature(page, candidates[0], placement);
      continue;
    }
    const value = textValue(pointerValue(context, placement.sourcePath), placement.textFormat);
    drawMappedText(
      page,
      placement.fontFamily === "helvetica_bold" ? helveticaBold : helvetica,
      value,
      placement,
    );
  }
  const bytes = await document.save({
    useObjectStreams: false,
    addDefaultPage: false,
    objectsPerTick: 50,
    updateFieldAppearances: false,
  });
  return Object.freeze({
    rendererContract: CREDITEX_ACTIVITY_WORK_PACK_PDF_RENDERER_CONTRACT,
    rendererVersion: CREDITEX_ACTIVITY_WORK_PACK_PDF_RENDERER_VERSION,
    bytes,
  });
}
