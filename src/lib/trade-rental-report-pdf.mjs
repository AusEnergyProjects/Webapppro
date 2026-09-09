import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { publicRentalReportValue, rentalCheckIsReadiness } from "./trade-rental-assessment.mjs";
import { RENTAL_QUOTATION_FIELDS, rentalQuotation } from "./rental-quotation.mjs";
import { rentalImageWithinReportLimit } from "./trade-rental-image-dimensions.mjs";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const palette = Object.freeze({
  ink: rgb(0.94, 0.97, 1),
  muted: rgb(0.63, 0.73, 0.79),
  primary: rgb(0.38, 0.94, 0.81),
  accent: rgb(0.38, 0.94, 0.81),
  line: rgb(0.15, 0.27, 0.33),
  soft: rgb(0.06, 0.14, 0.19),
  background: rgb(0.022, 0.052, 0.086),
  blue: rgb(0.49, 0.67, 1),
  warning: rgb(1, 0.77, 0.45),
  danger: rgb(1, 0.54, 0.51),
  white: rgb(1, 1, 1),
});

function safe(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ")
    .replace(/[\u2013\u2014]/g, "-");
}

function label(value) {
  return safe(value).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function brief(value, limit = 110) {
  const printable = safe(value);
  return printable.length <= limit ? printable : `${printable.slice(0, limit - 3).trimEnd()}...`;
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

export async function createRentalAssessmentPdfBytes(snapshot, evidenceAssets = {}, fontBytes = {}, brandBytes) {
  if (!snapshot || snapshot.schemaVersion !== "tlink-rental-report-v1" || !snapshot.report?.number || !snapshot.property?.address) {
    throw new TypeError("A valid rental assessment report snapshot is required.");
  }
  snapshot = publicRentalReportValue(snapshot);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Rental assessment ${safe(snapshot.report.number)}`);
  pdf.setAuthor(safe(snapshot.business?.name || "TLink trade business"));
  pdf.setSubject(snapshot.inspection?.title || "Victorian rental minimum standards assessment");
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
  const brand = brandBytes instanceof Uint8Array ? await pdf.embedPng(brandBytes) : null;
  const pages = [];
  const evidenceReferences = new Map((snapshot.evidence || []).map((entry, index) => [entry.id, `E${String(index + 1).padStart(3, "0")}`]));
  const renderedEvidence = new Map();
  const allItems = (snapshot.modules || []).flatMap((module) => (module.sections || []).flatMap((section) => (section.items || []).map((item) => ({ ...item, sectionTitle: section.title, readiness: rentalCheckIsReadiness(item, module.assessmentScope) }))));
  const workArea = (finding) => allItems.find((item) => item.id === finding.itemId)?.sectionTitle || label(finding.category || "Required work");
  const reportFindings = (snapshot.findings || []).filter((finding) => finding.status !== "compliant");
  const resolvedFindings = (snapshot.findings || []).filter((finding) => finding.status === "compliant");
  const findingEvidence = (finding) => (snapshot.evidence || []).filter((entry) => entry.findingId === finding.id || entry.itemId === finding.itemId);
  let page;
  let y;

  function addPage() {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: palette.background });
    for (let index = 0; index < 14; index += 1) {
      page.drawLine({ start: { x: PAGE_WIDTH - 245 + index * 18, y: PAGE_HEIGHT }, end: { x: PAGE_WIDTH, y: PAGE_HEIGHT - 245 + index * 12 }, thickness: 0.6, color: palette.primary, opacity: 0.09 });
      page.drawLine({ start: { x: 0, y: index * 10 }, end: { x: 120 + index * 8, y: 0 }, thickness: 0.6, color: palette.blue, opacity: 0.08 });
    }
    if (brand) page.drawImage(brand, { x: MARGIN, y: PAGE_HEIGHT - 48, width: 25, height: 25 });
    page.drawText("TLink", { x: MARGIN + (brand ? 33 : 0), y: PAGE_HEIGHT - 41, font: bold, size: 17, color: palette.ink });
    page.drawText("PROPERTY ASSESSMENTS", { x: MARGIN + 91, y: PAGE_HEIGHT - 38, font: regular, size: 7, color: palette.muted });
    if (snapshot.preview === true) page.drawText("SAMPLE | NOT ISSUED", { x: PAGE_WIDTH - MARGIN - 96, y: PAGE_HEIGHT - 38, size: 6.8, font: bold, color: palette.warning });
    y = PAGE_HEIGHT - 76;
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
      if (line) page.drawText(line, { x, y: y - size, size, font, color: options.color || palette.ink });
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
    text(safe(value).toUpperCase(), { bold: true, size: 7.5, lineHeight: 10, color: palette.primary, after: 8 });
  }

  function heading(kickerText, value, description = "") {
    ensure(description ? 94 : 70);
    y -= 10;
    kicker(kickerText);
    text(value, { bold: true, size: 18, lineHeight: 24, after: 10 });
    if (description) text(description, { size: 8.8, lineHeight: 12, color: palette.muted, after: 8 });
  }

  function keyValue(key, value, options = {}) {
    const printable = typeof value === "boolean" ? (value ? "Yes" : "No") : safe(value);
    if (!printable) return;
    const keyWidth = options.keyWidth || 145;
    const size = options.size || 8.6;
    const keyLines = wrap(regular, safe(key), 8.2, keyWidth - 8);
    const valueLines = wrap(regular, printable, size, CONTENT_WIDTH - keyWidth - 8);
    const lineCount = Math.max(keyLines.length, valueLines.length);
    for (let index = 0; index < lineCount; index += 1) {
      ensure(15);
      if (keyLines[index]) page.drawText(keyLines[index], { x: MARGIN, y: y - 8.6, font: regular, size: 8.2, color: palette.muted });
      if (valueLines[index]) page.drawText(valueLines[index], { x: MARGIN + keyWidth, y: y - size, font: regular, size, color: palette.ink });
      y -= 13;
    }
    y -= 5;
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
    page.drawRectangle({ x: MARGIN, y: y - 20, width, height: 20, color, opacity: 0.12 });
    page.drawText(visible, { x: MARGIN + 8, y: y - 13, font: bold, size: fontSize, color });
    y -= 30;
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
    const printed = entries.filter((entry) => renderedEvidence.has(entry.id));
    if (printed.length) text(`Evidence: ${printed.map((entry) => `${evidenceReferences.get(entry.id)} (page ${renderedEvidence.get(entry.id)})`).join(", ")}`, { size: 8, color: palette.muted, after: 5 });
    entries = entries.filter((entry) => !renderedEvidence.has(entry.id));
    if (!entries.length) return;
    ensure(217);
    text("Evidence", { bold: true, size: 8.2, color: palette.primary, after: 4 });
    const columnWidth = (CONTENT_WIDTH - 14) / 2;
    for (let offset = 0; offset < entries.length; offset += 2) {
      const row = entries.slice(offset, offset + 2);
      const images = await Promise.all(row.map(embedEvidence));
      ensure(200);
      const top = y;
      for (let column = 0; column < row.length; column += 1) {
        const entry = row[column];
        const image = images[column];
        const x = MARGIN + column * (columnWidth + 14);
        page.drawRectangle({ x, y: top - 145, width: columnWidth, height: 145, color: palette.soft });
        if (image) {
          const scale = Math.min(columnWidth / image.width, 145 / image.height);
          const width = image.width * scale;
          const height = image.height * scale;
          page.drawImage(image, { x: x + (columnWidth - width) / 2, y: top - 145 + (145 - height) / 2, width, height });
        } else {
          page.drawText(evidenceAssets[entry.id]?.bytes ? "Evidence attached to this PDF" : "Evidence file indexed", { x: x + 12, y: top - 82, font: regular, size: 8, color: palette.muted });
        }
        renderedEvidence.set(entry.id, pages.length);
        const caption = (entry.caption || entry.purpose || entry.fileName || "Evidence");
        const lines = wrap(regular, evidenceReferences.get(entry.id) + " | " + safe(caption), 7.8, columnWidth).slice(0, 3);
        for (let line = 0; line < lines.length; line += 1) page.drawText(lines[line], { x, y: top - 159 - line * 10, font: regular, size: 7.8, color: palette.muted });
      }
      y = top - 198;
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
  kicker("Property condition + upgrade planning");
  text("Rental assessment", { bold: true, size: 32, lineHeight: 40, after: 12 });
  text(snapshot.property.address, { bold: true, size: 16, lineHeight: 20, width: CONTENT_WIDTH, after: 12 });
  text(snapshot.inspection?.title || "Victorian rental minimum standards assessment", { size: 9, lineHeight: 13, color: palette.muted, after: 18 });
  keyValue("Assessment date", dateOnly(snapshot.inspection?.assessmentDate || snapshot.report.issuedAt));
  keyValue("Prepared by", brief(snapshot.issuer?.name, 85));
  keyValue("Report reference", snapshot.report.number);
  keyValue("Prepared for", brief(snapshot.property?.customerName, 85));
  rule(7);
  const currentIssues = allItems.filter((item) => !item.readiness && item.outcome === "does_not_meet").length;
  const futureIssues = allItems.filter((item) => item.readiness && item.outcome === "does_not_meet").length;
  const uncertain = allItems.filter((item) => !["meets", "does_not_meet", "not_applicable"].includes(item.outcome)).length;
  const stats = [[currentIssues, "Current issues", palette.danger], [futureIssues, "Future upgrades", palette.blue], [uncertain, "Need verification", palette.warning], [reportFindings.length, "Work items", palette.primary]];
  ensure(77);
  for (let index = 0; index < stats.length; index += 1) {
    const x = MARGIN + index * (CONTENT_WIDTH + 8) / 4;
    page.drawRectangle({ x, y: y - 65, width: (CONTENT_WIDTH - 24) / 4, height: 65, color: palette.soft });
    page.drawRectangle({ x, y: y - 2, width: (CONTENT_WIDTH - 24) / 4, height: 2, color: stats[index][2] });
    page.drawText(String(stats[index][0]), { x: x + 12, y: y - 31, size: 23, font: bold, color: stats[index][2] });
    page.drawText(stats[index][1], { x: x + 12, y: y - 48, size: 7.2, font: regular, color: palette.ink });
  }
  y -= 84;
  heading("At a glance", "Work to arrange");
  for (const finding of reportFindings.slice(0, 3)) keyValue(brief(workArea(finding), 35), brief(finding.title));
  if (reportFindings.length > 3) text(`Plus ${reportFindings.length - 3} further scopes in the work details.`, { size: 8.5, color: palette.muted, after: 6 });
  if (!reportFindings.length) text("No outstanding work scopes recorded.", { size: 9, after: 6 });
  heading("For owners and agents", "Next steps");
  const urgent = reportFindings.filter((finding) => ["immediate_safety_risk", "urgent"].includes(finding.severity));
  text(urgent.length ? "Urgent attention: " + urgent.slice(0, 2).map((finding) => brief(finding.title, 90)).join("; ") + ". See the work details for immediate actions." : "No immediate or urgent safety finding was recorded. Review the work details and limitations.", { size: 9.2, lineHeight: 14, after: 9 });
  text(reportFindings.length ? "Use the work scopes, measurements and photos to request itemised quotes. Each scope includes access requirements and pricing allowances. Future upgrades show their own start date and trigger." : "No outstanding work scopes were recorded. Read the assessment and access limitations before relying on any individual result.", { size: 9.2, lineHeight: 14, after: 10 });
  if (allItems.some((item) => item.readiness)) text("Planning findings do not establish non-compliance today.", { size: 8.5, color: palette.muted, after: 8 });
  const limitation = snapshot.inspection?.applicabilityLimitation;
  if (limitation) { badge("Applicable minimum standards not assessed", "warning"); text(limitation, { size: 8.5, lineHeight: 12, after: 5 }); }
  text("This report records the assessed conditions and scope at the inspection date. It is not a blanket compliance certificate. Separate electrical, gas and smoke-alarm records apply only where included and authenticated. Contractors retain responsibility for compliant design and installation within the recorded scope and allowances.", { size: 8, lineHeight: 11, color: palette.muted });

  addPage();
  heading("02 / Work details", "Scope for quoting", "Measured work, specifications, access requirements and supporting evidence for each upgrade.");
  if (!reportFindings.length) {
    badge("No outstanding findings recorded");
  }
  const orderedFindings = [...reportFindings].sort((a, b) => workArea(a).localeCompare(workArea(b)));
  let previousArea = "";
  for (let index = 0; index < orderedFindings.length; index += 1) {
    const finding = orderedFindings[index];
    const area = workArea(finding);
    if (area !== previousArea) {
      ensure(260);
      text(area, { bold: true, size: 15, lineHeight: 20, after: 10 });
      previousArea = area;
    }
    ensure(95);
    const tone = finding.severity === "immediate_safety_risk" ? "danger" : ["urgent", "required"].includes(finding.severity) ? "warning" : "primary";
    badge(`ITEM ${String(index + 1).padStart(2, "0")} | ${label(finding.severity)}`, tone);
    text(finding.title, { bold: true, size: 11, lineHeight: 15, after: 3 });
    keyValue("Status", label(finding.status));
    keyValue("Location", finding.locationLabel);
    keyValue("Finding", finding.description);
    if (finding.recommendedAction && finding.recommendedAction !== finding.scopeSummary) keyValue("Recommended action", finding.recommendedAction);
    keyValue("Work required", finding.scopeSummary);
    const quotation = rentalQuotation(finding.details?.quotation);
    for (const field of RENTAL_QUOTATION_FIELDS) keyValue(field.label, quotation[field.key]);
    const assessedItem = allItems.find((item) => item.id === finding.itemId);
    if (assessedItem?.trigger) keyValue("Future requirement trigger", assessedItem.trigger);
    keyValue("Quantity", Number(finding.quantityMilli) > 0 ? `${Number(finding.quantityMilli) / 1000} ${finding.unitLabel || "each"}` : "Not measured; confirm before pricing");
    keyValue("Reference", finding.standardReference);
    if (finding.severity === "immediate_safety_risk") {
      keyValue("Immediate action", finding.details?.immediateAction);
      keyValue("Responsible people notified", finding.details?.responsiblePeopleNotified === true ? "Yes" : "No");
      keyValue("Notification", [finding.details?.notificationRecipient, finding.details?.notificationTime].filter(Boolean).join(" | "));
    }
    await evidenceBlock(findingEvidence(finding));
    rule(8);
  }
  if (resolvedFindings.length) {
    rule(12);
    text("Resolved finding history", { bold: true, size: 13, lineHeight: 17, color: palette.primary, after: 4 });
    text("These findings were recorded earlier in the assessment and marked compliant or resolved before issue.", { size: 8.7, lineHeight: 12, color: palette.muted, after: 8 });
    for (const finding of resolvedFindings) {
      badge("Resolved finding");
      text(finding.title, { bold: true, size: 10, lineHeight: 14, after: 3 });
      keyValue("Category", label(finding.category));
      keyValue("Location", finding.locationLabel);
      keyValue("History", finding.description);
      keyValue("Reference", finding.standardReference);
      rule(7);
    }
  }

  for (const assessmentModule of snapshot.modules || []) {
    ensure(280);
    heading(assessmentModule.required ? "Included module" : "Optional module", assessmentModule.title, assessmentModule.reportBoundary);
    badge(`Completed | ${assessmentModule.completedAt ? dateTime(assessmentModule.completedAt) : "Recorded"}`);
    if (assessmentModule.credential && Object.keys(assessmentModule.credential).length) {
      keyValue("Assessor", assessmentModule.credential.assessorName || snapshot.issuer?.name);
      if (assessmentModule.credential.credentialName || assessmentModule.credential.credentialType || assessmentModule.credential.credentialNumber) keyValue("Credential", [assessmentModule.credential.credentialName || assessmentModule.credential.credentialType, assessmentModule.credential.credentialNumber].filter(Boolean).join(" | "));
      keyValue("Issuer / jurisdiction", [assessmentModule.credential.issuer, assessmentModule.credential.jurisdiction].filter(Boolean).join(" | "));
      if (assessmentModule.credential.expiresAt) keyValue("Credential valid until", dateOnly(assessmentModule.credential.expiresAt));
      keyValue("Verification", assessmentModule.credential.verificationBasis === "manager_attested_document" ? "Manager-attested credential document" : assessmentModule.credential.verificationBasis === "assigned_team_profile" ? "Assigned TLink team member and final assessment declaration" : "Assessor declaration");
      keyValue("Supporting record", assessmentModule.credential.supportingFileTitle);
    }
    for (const [key, value] of objectEntries(assessmentModule.answers)) {
      keyValue(label(key), typeof value === "boolean" ? (value ? "Yes" : "No") : key === "rentalRegime" ? label(value) : value);
    }
    for (const section of assessmentModule.sections || []) {
      ensure(160);
      rule(11);
      text(section.title, { bold: true, size: 14, lineHeight: 18, color: palette.primary, after: 3 });
      if (section.summary) text(section.summary, { size: 8.7, lineHeight: 12, color: palette.muted, after: 7 });
      for (const item of section.items || []) {
        ensure(72);
        const tone = item.outcome === "meets" || item.outcome === "not_applicable" ? "primary"
          : item.outcome === "does_not_meet" && !rentalCheckIsReadiness(item, assessmentModule.assessmentScope) ? "danger" : "warning";
        const resultLabel = snapshot.inspection?.applicabilityLimitation && assessmentModule.key === "minimum_standards"
          ? (item.outcome === "meets" ? "Observation satisfactory; legal applicability unconfirmed" : outcomeLabel(item.outcome))
          : rentalCheckIsReadiness(item, assessmentModule.assessmentScope)
          ? (item.outcome === "meets" ? "Ready for the recorded requirement" : item.outcome === "does_not_meet" ? "Upgrade planning required" : outcomeLabel(item.outcome))
          : outcomeLabel(item.outcome);
        badge(`${resultLabel}${item.locationLabel ? ` | ${item.locationLabel}` : ""}`, tone);
        text(item.prompt, { bold: true, size: 9.7, lineHeight: 13, after: 3 });
        if (item.trigger) keyValue("Applies when", item.trigger);
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
  keyValue("Business", snapshot.business?.name);
  keyValue("ABN", snapshot.business?.abn);
  keyValue("Business contact", [snapshot.business?.email, snapshot.business?.phone].filter(Boolean).join(" | "));
  keyValue("Business address", snapshot.business?.address);
  keyValue(snapshot.inspection?.assessmentScope === "energy_readiness_2027" ? "FIRST PHASE STARTS" : "RULES EFFECTIVE", dateOnly(snapshot.inspection?.rulesEffectiveFrom));
  keyValue("Issued by", snapshot.issuer?.name);
  keyValue("Role", snapshot.issuer?.role);
  keyValue("Qualification", snapshot.issuer?.qualificationType);
  keyValue("Qualification number", snapshot.issuer?.qualificationNumber);
  keyValue("Declaration", snapshot.issuer?.declaration);
  keyValue("Issued at", dateTime(snapshot.report.issuedAt));
  rule();
  const sourceHeight = (snapshot.sources || []).reduce((height, source) => height + wrap(regular, source.url, 7.2, CONTENT_WIDTH).length * 10 + 25, 70);
  ensure(Math.min(sourceHeight, PAGE_HEIGHT - 132));
  heading("Governing sources", "Rule sources preserved with this report");
  for (const source of snapshot.sources || []) {
    text([source.title, source.version, source.effectiveFrom ? `effective ${dateOnly(source.effectiveFrom)}` : ""].filter(Boolean).join(" | "), { bold: true, size: 7.3, lineHeight: 10 });
    text(source.url, { size: 7.2, lineHeight: 10, color: palette.muted, after: 5 });
  }

  for (let index = 0; index < pages.length; index += 1) {
    const footer = pages[index];
    footer.drawLine({ start: { x: MARGIN, y: 38 }, end: { x: PAGE_WIDTH - MARGIN, y: 38 }, thickness: 0.6, color: palette.line });
    footer.drawText(brief(`${snapshot.report.number} | ${snapshot.property.address}`, 100), { x: MARGIN, y: 24, font: regular, size: 6.8, color: palette.muted });
    footer.drawText(`Page ${index + 1} of ${pages.length}`, { x: PAGE_WIDTH - MARGIN - 72, y: 24, font: regular, size: 6.8, color: palette.muted });
  }
  return new Uint8Array(await pdf.save({ useObjectStreams: true }));
}
