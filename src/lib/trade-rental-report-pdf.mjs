import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { publicRentalReportValue } from "./trade-rental-assessment.mjs";
import { rentalImageWithinReportLimit } from "./trade-rental-image-dimensions.mjs";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const palette = Object.freeze({
  ink: rgb(0.06, 0.16, 0.19),
  muted: rgb(0.34, 0.43, 0.45),
  primary: rgb(0.03, 0.40, 0.36),
  accent: rgb(0.25, 0.78, 0.62),
  line: rgb(0.82, 0.88, 0.87),
  soft: rgb(0.94, 0.97, 0.96),
  warning: rgb(0.62, 0.32, 0.04),
  danger: rgb(0.67, 0.14, 0.08),
  white: rgb(1, 1, 1),
});

function safe(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ")
    .replace(/[\u2013\u2014]/g, "-");
}

function label(value) {
  return safe(value).replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function dateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return safe(value);
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Melbourne" }).format(date);
}

function dateOnly(value) {
  const date = new Date(String(value).length === 10 ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(date.getTime())) return safe(value);
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function wrap(font, value, size, width) {
  const paragraphs = safe(value).split("\n");
  const output = [];
  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const words = paragraphs[paragraphIndex].trim().split(/\s+/).filter(Boolean);
    if (!words.length) output.push("");
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) output.push(line);
      line = "";
      let remainder = word;
      while (remainder && font.widthOfTextAtSize(remainder, size) > width) {
        let split = 1;
        while (split < remainder.length && font.widthOfTextAtSize(remainder.slice(0, split + 1), size) <= width) split += 1;
        output.push(remainder.slice(0, split));
        remainder = remainder.slice(split);
      }
      line = remainder;
    }
    if (line) output.push(line);
    if (paragraphIndex < paragraphs.length - 1) output.push("");
  }
  return output.length ? output : [""];
}

function objectEntries(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).filter(([, entry]) => entry !== "" && entry !== null && entry !== undefined);
}

function outcomeLabel(outcome) {
  return ({
    meets: "Meets",
    does_not_meet: "Does not meet",
    specialist_verification_required: "Specialist verification required",
    not_accessible: "Not accessible",
    not_applicable: "Not applicable",
    exemption_evidence_pending: "Exemption evidence pending",
  })[outcome] || label(outcome || "Not assessed");
}

export async function createRentalAssessmentPdfBytes(snapshot, evidenceAssets = {}, fontBytes = {}) {
  if (!snapshot || snapshot.schemaVersion !== "tlink-rental-report-v1" || !snapshot.report?.number || !snapshot.property?.address) {
    throw new TypeError("A valid rental assessment report snapshot is required.");
  }
  snapshot = publicRentalReportValue(snapshot);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Rental assessment ${safe(snapshot.report.number)}`);
  pdf.setAuthor(safe(snapshot.business?.name || "TLink trade business"));
  pdf.setSubject("Victorian rental minimum standards assessment");
  pdf.setProducer("TLink");
  pdf.setCreationDate(new Date(snapshot.report.issuedAt));
  pdf.setModificationDate(new Date(snapshot.report.issuedAt));
  const useEmbeddedFonts = fontBytes.regular instanceof Uint8Array && fontBytes.bold instanceof Uint8Array;
  if (useEmbeddedFonts) pdf.registerFontkit(fontkit);
  const regular = useEmbeddedFonts
    ? await pdf.embedFont(fontBytes.regular, { subset: false })
    : await pdf.embedFont(StandardFonts.Helvetica);
  const bold = useEmbeddedFonts
    ? await pdf.embedFont(fontBytes.bold, { subset: false })
    : await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = [];
  let page;
  let y;

  function addPage() {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 8, width: PAGE_WIDTH, height: 8, color: palette.accent });
    y = PAGE_HEIGHT - MARGIN;
  }

  function ensure(height) {
    if (!page || y - height < 56) addPage();
  }

  function text(value, options = {}) {
    const font = options.bold ? bold : regular;
    const size = options.size || 9.3;
    const width = options.width || CONTENT_WIDTH;
    const x = options.x ?? MARGIN;
    const lineHeight = options.lineHeight || size * 1.35;
    const lines = wrap(font, value, size, width);
    for (const line of lines) {
      ensure(lineHeight + 2);
      if (line) page.drawText(line, { x, y, size, font, color: options.color || palette.ink });
      y -= lineHeight;
    }
    if (options.after) {
      ensure(options.after);
      y -= options.after;
    }
    return lines.length * lineHeight;
  }

  function rule(gap = 10) {
    ensure(gap * 2 + 1);
    y -= gap;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.7, color: palette.line });
    y -= gap;
  }

  function kicker(value) {
    text(safe(value).toUpperCase(), { bold: true, size: 7.3, lineHeight: 9, color: palette.primary, after: 5 });
  }

  function heading(kickerText, value, description = "") {
    ensure(description ? 66 : 46);
    kicker(kickerText);
    text(value, { bold: true, size: 17, lineHeight: 21, after: description ? 3 : 8 });
    if (description) text(description, { size: 8.8, lineHeight: 12, color: palette.muted, after: 8 });
  }

  function keyValue(key, value, options = {}) {
    const printable = typeof value === "boolean" ? (value ? "Yes" : "No") : safe(value);
    if (!printable) return;
    const keyWidth = options.keyWidth || 145;
    const size = options.size || 8.6;
    const keyLines = wrap(bold, safe(key), 7.7, keyWidth - 8);
    const valueLines = wrap(regular, printable, size, CONTENT_WIDTH - keyWidth - 8);
    const lineCount = Math.max(keyLines.length, valueLines.length);
    for (let index = 0; index < lineCount; index += 1) {
      ensure(15);
      if (keyLines[index]) page.drawText(keyLines[index], { x: MARGIN, y, font: bold, size: 7.7, color: palette.muted });
      if (valueLines[index]) page.drawText(valueLines[index], { x: MARGIN + keyWidth, y, font: regular, size, color: palette.ink });
      y -= 11;
    }
    y -= 4;
  }

  function badge(value, tone = "primary") {
    const printable = safe(value);
    const fontSize = 7.4;
    const available = CONTENT_WIDTH - 16;
    let visible = printable;
    while (visible.length > 1 && bold.widthOfTextAtSize(`${visible}...`, fontSize) > available) visible = visible.slice(0, -1);
    if (visible !== printable) visible = `${visible.trimEnd()}...`;
    const width = Math.min(CONTENT_WIDTH, bold.widthOfTextAtSize(visible, fontSize) + 16);
    ensure(23);
    const color = tone === "danger" ? palette.danger : tone === "warning" ? palette.warning : palette.primary;
    page.drawRectangle({ x: MARGIN, y: y - 3, width, height: 17, color, opacity: 0.12 });
    page.drawText(visible, { x: MARGIN + 8, y: y + 2, font: bold, size: fontSize, color });
    y -= 24;
  }

  const embeddedEvidence = new Map();

  async function embedEvidence(entry) {
    if (embeddedEvidence.has(entry.id)) return embeddedEvidence.get(entry.id);
    const asset = evidenceAssets[entry.id];
    if (!asset?.bytes) return null;
    try {
      const contentType = String(asset.contentType).toLowerCase();
      if (!rentalImageWithinReportLimit(asset.bytes, contentType)) return null;
      const image = contentType === "image/png"
        ? await pdf.embedPng(asset.bytes)
        : contentType === "image/jpeg"
          ? await pdf.embedJpg(asset.bytes)
          : null;
      if (image) embeddedEvidence.set(entry.id, image);
      return image;
    } catch {
      return null;
    }
    return null;
  }

  async function evidenceBlock(entries) {
    if (!entries.length) return;
    text("Evidence", { bold: true, size: 8.2, color: palette.primary, after: 4 });
    for (const entry of entries) {
      const image = await embedEvidence(entry);
      if (image) {
        const maximumWidth = CONTENT_WIDTH;
        const maximumHeight = 250;
        const scale = Math.min(maximumWidth / image.width, maximumHeight / image.height, 1);
        const width = image.width * scale;
        const height = image.height * scale;
        ensure(height + 38);
        page.drawImage(image, { x: MARGIN, y: y - height, width, height });
        y -= height + 6;
      }
      text(`${entry.fileName || "Evidence file"}${image ? "" : " | Included as an attachment in this PDF"}`, {
        size: 7.7, lineHeight: 10, color: palette.muted, after: 5,
      });
      if (entry.caption) keyValue("Caption", entry.caption, { keyWidth: 82, size: 7.7 });
      if (entry.purpose && entry.purpose !== entry.caption) keyValue("Purpose", entry.purpose, { keyWidth: 82, size: 7.7 });
      if (entry.capture?.capturedAtUtc) {
        keyValue(entry.capture.source === "in_app_camera" ? "Captured" : "Added", dateTime(entry.capture.capturedAtUtc), { keyWidth: 82, size: 7.7 });
        if (entry.capture.locationCaptured) {
          keyValue("Device-reported GPS", `${Number(entry.capture.latitude).toFixed(6)}, ${Number(entry.capture.longitude).toFixed(6)} | accuracy ${Math.round(Number(entry.capture.accuracyMetres))} m`, { keyWidth: 106, size: 7.7 });
        }
      }
    }
  }

  for (const [entryIndex, entry] of (snapshot.evidence || []).entries()) {
    const asset = evidenceAssets[entry.id];
    if (!asset?.bytes || await embedEvidence(entry)) continue;
    const attachmentName = `${String(entryIndex + 1).padStart(3, "0")}-${safe(entry.fileName || `evidence-${entry.id}`)}`;
    await pdf.attach(asset.bytes, attachmentName, {
      mimeType: safe(asset.contentType || entry.contentType || "application/octet-stream"),
      description: safe([entry.caption, entry.purpose && entry.purpose !== entry.caption ? entry.purpose : ""].filter(Boolean).join(" | ") || "Rental assessment evidence"),
      creationDate: new Date(snapshot.report.issuedAt),
      modificationDate: new Date(snapshot.report.issuedAt),
    });
  }

  addPage();
  kicker(snapshot.business?.name || "TLink trade business");
  y -= 14;
  text("Victorian rental minimum standards assessment", { bold: true, size: 25, lineHeight: 30, width: 450, after: 8 });
  text(snapshot.property.address, { bold: true, size: 13, lineHeight: 17, color: palette.primary, after: 13 });
  page.drawRectangle({ x: MARGIN, y: y - 96, width: CONTENT_WIDTH, height: 96, color: palette.soft });
  const boxTop = y - 18;
  page.drawText("REPORT", { x: MARGIN + 16, y: boxTop, font: bold, size: 7.4, color: palette.muted });
  page.drawText(safe(snapshot.report.number), { x: MARGIN + 16, y: boxTop - 18, font: bold, size: 12, color: palette.ink });
  page.drawText("ISSUED", { x: MARGIN + 190, y: boxTop, font: bold, size: 7.4, color: palette.muted });
  page.drawText(safe(dateTime(snapshot.report.issuedAt)), { x: MARGIN + 190, y: boxTop - 18, font: bold, size: 9.5, color: palette.ink });
  page.drawText("ASSESSOR", { x: MARGIN + 365, y: boxTop, font: bold, size: 7.4, color: palette.muted });
  page.drawText(safe(snapshot.issuer?.name || "Recorded issuer"), { x: MARGIN + 365, y: boxTop - 18, font: bold, size: 9.5, color: palette.ink, maxWidth: 130 });
  page.drawText("RULES EFFECTIVE", { x: MARGIN + 16, y: boxTop - 50, font: bold, size: 7.4, color: palette.muted });
  page.drawText(safe(dateOnly(snapshot.inspection?.rulesEffectiveFrom)), { x: MARGIN + 16, y: boxTop - 68, font: regular, size: 9, color: palette.ink });
  page.drawText("MODULES", { x: MARGIN + 190, y: boxTop - 50, font: bold, size: 7.4, color: palette.muted });
  page.drawText(String(snapshot.modules?.length || 0), { x: MARGIN + 190, y: boxTop - 68, font: regular, size: 9, color: palette.ink });
  page.drawText("FINDINGS", { x: MARGIN + 365, y: boxTop - 50, font: bold, size: 7.4, color: palette.muted });
  page.drawText(String((snapshot.findings || []).filter((finding) => finding.status !== "compliant").length), { x: MARGIN + 365, y: boxTop - 68, font: regular, size: 9, color: palette.ink });
  y -= 116;

  heading("Report boundary", "What this report covers");
  text("The default module assesses the current Victorian rental minimum standards. Separate electrical, gas and smoke alarm records appear only when selected, completed and authenticated in their own modules. This report records observed conditions, tests, limitations, evidence and work scopes as issued by the named assessor.", { size: 9.5, lineHeight: 14, after: 8 });
  keyValue("Inspection number", snapshot.inspection?.number);
  keyValue("Assessment date", dateOnly(snapshot.inspection?.assessmentDate || snapshot.report.issuedAt));
  keyValue("Building type", snapshot.property?.buildingType);
  keyValue("Rental provider or agent", snapshot.property?.customerName);
  keyValue("Contact", [snapshot.property?.customerEmail, snapshot.property?.customerPhone].filter(Boolean).join(" | "));
  keyValue("Business", snapshot.business?.name);
  keyValue("ABN", snapshot.business?.abn);
  keyValue("Business contact name", snapshot.business?.contactName);
  keyValue("Business contact", [snapshot.business?.email, snapshot.business?.phone].filter(Boolean).join(" | "));
  keyValue("Business address", snapshot.business?.address);
  keyValue("Assessor qualification", [snapshot.issuer?.qualificationType, snapshot.issuer?.qualificationNumber].filter(Boolean).join(" | "));
  keyValue("Assessor contact", [snapshot.issuer?.email, snapshot.issuer?.phone].filter(Boolean).join(" | "));

  const reportFindings = (snapshot.findings || []).filter((finding) => finding.status !== "compliant");
  const resolvedFindings = (snapshot.findings || []).filter((finding) => finding.status === "compliant");
  addPage();
  heading("Quote-ready register", "Findings and required trade scopes", "This register is designed so each trade can identify the exact location, priority, quantity and requested action without reading every checklist answer first.");
  if (!reportFindings.length) {
    badge("No outstanding findings recorded");
  }
  for (let index = 0; index < reportFindings.length; index += 1) {
    const finding = reportFindings[index];
    ensure(95);
    const tone = finding.severity === "immediate_safety_risk" ? "danger" : ["urgent", "required"].includes(finding.severity) ? "warning" : "primary";
    badge(`${String(index + 1).padStart(2, "0")} | ${label(finding.severity)} | ${finding.tradeCategory || "Trade follow-up"}`, tone);
    text(finding.title, { bold: true, size: 11, lineHeight: 15, after: 3 });
    keyValue("Status", label(finding.status));
    keyValue("Category", label(finding.category));
    keyValue("Responsible trade", finding.tradeCategory);
    keyValue("Location", finding.locationLabel);
    keyValue("Finding", finding.description);
    keyValue("Recommended action", finding.recommendedAction);
    keyValue("Quote-ready scope", finding.scopeSummary);
    keyValue("Quantity", `${Number(finding.quantityMilli || 0) / 1000} ${finding.unitLabel || "each"}`);
    keyValue("Reference", finding.standardReference);
    if (finding.severity === "immediate_safety_risk") {
      keyValue("Immediate action", finding.details?.immediateAction);
      keyValue("Responsible people notified", finding.details?.responsiblePeopleNotified === true ? "Yes" : "No");
      keyValue("Notification", [finding.details?.notificationRecipient, finding.details?.notificationTime].filter(Boolean).join(" | "));
    }
    const findingEvidence = (snapshot.evidence || []).filter((entry) => entry.findingId === finding.id || entry.itemId === finding.itemId);
    await evidenceBlock(findingEvidence);
    rule(8);
  }
  if (resolvedFindings.length) {
    rule(12);
    text("Resolved finding history", { bold: true, size: 13, lineHeight: 17, color: palette.primary, after: 4 });
    text("These findings were recorded earlier in the assessment and marked compliant or resolved before issue.", { size: 8.7, lineHeight: 12, color: palette.muted, after: 8 });
    for (const finding of resolvedFindings) {
      badge(`Resolved | ${finding.tradeCategory || "Assessment follow-up"}`);
      text(finding.title, { bold: true, size: 10, lineHeight: 14, after: 3 });
      keyValue("Category", label(finding.category));
      keyValue("Location", finding.locationLabel);
      keyValue("History", finding.description);
      keyValue("Reference", finding.standardReference);
      rule(7);
    }
  }

  for (const assessmentModule of snapshot.modules || []) {
    addPage();
    heading(assessmentModule.required ? "Included module" : "Optional module", assessmentModule.title, assessmentModule.reportBoundary);
    badge(`Completed | ${assessmentModule.completedAt ? dateTime(assessmentModule.completedAt) : "Recorded"}`);
    if (assessmentModule.credential && Object.keys(assessmentModule.credential).length) {
      keyValue("Assessor", assessmentModule.credential.assessorName || snapshot.issuer?.name);
      keyValue("Credential", [assessmentModule.credential.credentialName || assessmentModule.credential.credentialType, assessmentModule.credential.credentialNumber].filter(Boolean).join(" | ") || "Assessor declaration recorded");
      keyValue("Issuer / jurisdiction", [assessmentModule.credential.issuer, assessmentModule.credential.jurisdiction].filter(Boolean).join(" | "));
      keyValue("Credential valid until", assessmentModule.credential.expiresAt ? dateOnly(assessmentModule.credential.expiresAt) : "Not applicable");
      keyValue("Verification", assessmentModule.credential.verificationBasis === "manager_attested_document" ? "Manager-attested credential document" : "Assessor declaration");
      keyValue("Supporting record", assessmentModule.credential.supportingFileTitle);
    }
    for (const [key, value] of objectEntries(assessmentModule.answers)) {
      keyValue(label(key), typeof value === "boolean" ? (value ? "Yes" : "No") : value);
    }
    for (const section of assessmentModule.sections || []) {
      rule(11);
      text(section.title, { bold: true, size: 14, lineHeight: 18, color: palette.primary, after: 3 });
      if (section.summary) text(section.summary, { size: 8.7, lineHeight: 12, color: palette.muted, after: 7 });
      for (const item of section.items || []) {
        ensure(72);
        const tone = item.outcome === "meets" || item.outcome === "not_applicable" ? "primary"
          : item.outcome === "does_not_meet" ? "danger" : "warning";
        badge(`${outcomeLabel(item.outcome)}${item.locationLabel ? ` | ${item.locationLabel}` : ""}`, tone);
        text(item.prompt, { bold: true, size: 9.7, lineHeight: 13, after: 3 });
        if (item.locationLabel) keyValue("Location", item.locationLabel);
        if (item.publicNotes) keyValue("Report detail", item.publicNotes);
        for (const [key, value] of objectEntries(item.response)) {
          keyValue(label(key), typeof value === "boolean" ? (value ? "Yes" : "No") : value);
        }
        await evidenceBlock((snapshot.evidence || []).filter((entry) => entry.itemId === item.id));
        y -= 4;
      }
    }
  }

  addPage();
  heading("Evidence register", "Files captured for this assessment", "JPEG and PNG photos are rendered in this report. Other supplied formats, including WebP, are embedded as PDF attachments. Every file is listed below with its integrity hash.");
  for (const [index, entry] of (snapshot.evidence || []).entries()) {
    text(`${index + 1}. ${entry.fileName || "Evidence file"}`, { bold: true, size: 8.2, lineHeight: 11, after: 3 });
    if (entry.caption) keyValue("Caption", entry.caption, { keyWidth: 90, size: 7.8 });
    if (entry.purpose && entry.purpose !== entry.caption) keyValue("Purpose", entry.purpose, { keyWidth: 90, size: 7.8 });
    keyValue("Type", entry.contentType, { keyWidth: 90, size: 7.8 });
    if (entry.capture?.capturedAtUtc) {
      keyValue(entry.capture.source === "in_app_camera" ? "Captured" : "Added", dateTime(entry.capture.capturedAtUtc), { keyWidth: 90, size: 7.8 });
      if (entry.capture.locationCaptured) {
        keyValue("Device-reported GPS", `${Number(entry.capture.latitude).toFixed(6)}, ${Number(entry.capture.longitude).toFixed(6)}`, { keyWidth: 106, size: 7.8 });
        keyValue("Reported accuracy", `${Math.round(Number(entry.capture.accuracyMetres))} metres`, { keyWidth: 106, size: 7.8 });
      }
    }
    if (entry.originalSha256) keyValue("SHA-256", entry.originalSha256, { keyWidth: 90, size: 7.2 });
    y -= 5;
  }
  rule();
  heading("Issuer declaration", "Assessment authentication");
  keyValue("Issued by", snapshot.issuer?.name);
  keyValue("Role", snapshot.issuer?.role);
  keyValue("Qualification", snapshot.issuer?.qualificationType);
  keyValue("Qualification number", snapshot.issuer?.qualificationNumber);
  keyValue("Declaration", snapshot.issuer?.declaration);
  keyValue("Issued at", dateTime(snapshot.report.issuedAt));
  rule();
  heading("Governing sources", "Rule sources preserved with this report");
  for (const source of snapshot.sources || []) {
    keyValue(source.title, [source.version ? `Version ${source.version}` : "", source.effectiveFrom ? `effective ${dateOnly(source.effectiveFrom)}` : "", source.url].filter(Boolean).join(" | "), { keyWidth: 170, size: 7.6 });
  }

  for (let index = 0; index < pages.length; index += 1) {
    const footer = pages[index];
    footer.drawLine({ start: { x: MARGIN, y: 38 }, end: { x: PAGE_WIDTH - MARGIN, y: 38 }, thickness: 0.6, color: palette.line });
    footer.drawText(safe(`${snapshot.report.number} | ${snapshot.property.address}`), { x: MARGIN, y: 24, font: regular, size: 6.8, color: palette.muted, maxWidth: 390 });
    footer.drawText(`Page ${index + 1} of ${pages.length}`, { x: PAGE_WIDTH - MARGIN - 72, y: 24, font: regular, size: 6.8, color: palette.muted });
  }
  return new Uint8Array(await pdf.save({ useObjectStreams: true }));
}
