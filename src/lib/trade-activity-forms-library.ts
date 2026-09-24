import { ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS, ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEY_SET,
  applySystemDerivedFieldPolicy, applyFieldWorkerPolicy, isRetiredFieldWorkerField } from "./trade-activity-field-policy.ts";
export { ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS, activityApprovedProductContract, activityFieldWorkerForm } from "./trade-activity-field-policy.ts";
import { CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES, type CreditexCurrentWorkPackContentCandidate } from "../data/creditex-current-work-pack-content.ts";
import veu from "../data/creditex-veu-statutory-forms.json" with { type: "json" };
import national from "../data/creditex-national-statutory-forms.json" with { type: "json" };
import { creditexStatutorySourceLibrary, creditexDeclarationProvider } from "./creditex-statutory-form-library.ts";
import { activityHash, type ActivityCondition, type ActivityDeclaration, type ActivityField, type ActivityForm, type ActivityPhase } from "./trade-activity-forms.ts";

const human = (value: string) => value.replaceAll("_", " ").replaceAll(".", " ");
const phase = (value: string): ActivityPhase => /before|pre.?work|pre.?installation|nomination/i.test(value) && !/after|final|onboard/i.test(value) ? "before" : "after";
const blankField = (key: string, label: string, section: string, stage: ActivityPhase): ActivityField => ({
  key, label, section, phase: stage, type: "text", required: true, options: [], help: "",
});
const conditions: Record<string, string> = {
  electrical_work_performed: "Does this work include electrical installation or disconnection?",
  licensed_plumbing_work_performed_or_registered_plumber_supervision_required: "Does this work include plumbing?",
  signing_installer_is_registered_plumber_not_licensed_plumber: "Is the installer a registered plumber working under a licensed plumber?",
  handling_fluorocarbon_refrigerant_covered_by_ozone_act: "Will a worker handle regulated fluorocarbon refrigerant?",
  "installed_product.isHeatPump": "Is the new product a heat pump?",
  "installed_product.isMultiSplit": "Is the new system a multi-split?",
  "installed_product.isDucted": "Is the new system ducted?",
  "baseline.isDucted": "Is the existing system ducted?",
  value_required_in_assignment_or_linked_invoice: "Record the benefit and payment value in this form?",
  "BESS2 or differs from owner": "Is the electricity account holder different from the property owner?",
  "NSW certificate or grid-connected SRES battery": "Is this battery connected to the electricity grid?",
  "off-grid VPP exception claimed": "Are you claiming the permitted off-grid VPP exception?",
  "multiple heaters": "Are two or more heaters included in this activity?",
  "holder is company or registered body": "Is the customer a company or registered organisation?",
  holder_is_company_or_registered_body: "Is the customer a company or registered organisation?",
  "business site": "Is this a business premises?",
  "small/large business eligibility": "Is this activity at a business premises?",
  "multi-split": "Is this a multi-split air conditioner?",
  replacement: "Does this installation replace existing equipment?",
  "old equipment contains refrigerant": "Does the old equipment contain refrigerant?",
  "split components connected by refrigerant": "Are the indoor and outdoor units connected by refrigerant pipework?",
  "HVAC2 residential/small-business exception": "Does this residential or small-business site qualify for the HVAC2 exception described below?",
  "equipment connects through existing GPO": "Does the new equipment plug into an existing power point?",
  "BESS1 indoors OR BESS4 indoors in Class3": "Is the battery installed indoors in premises covered by the smoke-alarm requirement?",
};
type SourcePrompt = { key: string; options?: readonly (string | { value?: string; label: string })[];
  implementationNote?: string; repeatFor?: string; autofillFrom?: string };
const veuSourceForms: readonly { id: string; groups: readonly { prompts: readonly SourcePrompt[] }[] }[] = veu.forms;

export type ActivityConsumerDocument = {
  key: string;
  title: string;
  url: string;
  requiredTiming: "booking_before_customer_agreement";
};

export const INSTALLER_ID_SELFIE_FIELD_KEY = "evidence.tlink-installer-id-selfie";
const installerIdSelfieField = (): ActivityField => ({
  key: INSTALLER_ID_SELFIE_FIELD_KEY,
  section: "Start of job",
  label: "Take a selfie holding your installer ID",
  type: "photo",
  required: true,
  options: [],
  help: "Before work starts, take a clear selfie at the job address showing your face and installer ID. TLink records the capture time and GPS location.",
  phase: "before",
  requireLocation: true,
});
const isInstallerIdSelfieField = (field: ActivityField) => {
  if (field.key === INSTALLER_ID_SELFIE_FIELD_KEY) return true;
  const text = `${field.key} ${field.label} ${field.help}`;
  return field.type === "photo" && /selfie/i.test(text) && /installer/i.test(text) && /\b(?:id|identity|badge|accreditation|licen[cs]e)\b/i.test(text);
};
function ensureInstallerIdSelfie(fields: readonly ActivityField[]) {
  const existing = fields.find(isInstallerIdSelfieField);
  const selfie = existing ? { ...existing, section: "Start of job", label: "Take a selfie holding your installer ID",
    type: "photo" as const, required: true, options: [], phase: "before" as const, requireLocation: true,
    help: installerIdSelfieField().help } : installerIdSelfieField();
  delete selfie.condition;
  delete selfie.repeatGroup;
  delete selfie.autofill;
  delete selfie.presentation;
  return [selfie, ...fields.filter((field) => field !== existing && !isInstallerIdSelfieField(field))];
}

const VEU_DOCUMENTS = {
  consumer: { key: "veu-consumer-factsheet", title: "VEU consumer factsheet (PDF)",
    url: "https://www.energy.vic.gov.au/__data/assets/pdf_file/0028/585154/Victorian-Energy-Efficiency-Target-scheme-consumer-factsheet.pdf",
    requiredTiming: "booking_before_customer_agreement" as const },
  rights: { key: "creditex-veu-statement-of-rights-v1", title: "Creditex Statement of Rights (PDF)",
    url: "/api/trade-activity-forms?consumerDocument=veu-rights-v1", requiredTiming: "booking_before_customer_agreement" as const },
  waterHeating: { key: "veu-water-heating-consumer-factsheet", title: "VEU water heating consumer factsheet (PDF)",
    url: "https://www.energy.vic.gov.au/__data/assets/pdf_file/0018/710280/VEU-water-heating-consumer-factsheet.pdf",
    requiredTiming: "booking_before_customer_agreement" as const },
  heatingCooling: { key: "veu-heating-cooling-consumer-factsheet", title: "VEU heating and cooling consumer factsheet (PDF)",
    url: "https://www.energy.vic.gov.au/__data/assets/pdf_file/0027/712809/VEU-space-heating-and-cooling-consumer-factsheet.pdf",
    requiredTiming: "booking_before_customer_agreement" as const },
  cooktop: { key: "veu-cooktop-consumer-factsheet", title: "VEU cooktop consumer factsheet (PDF)",
    url: "https://www.energy.vic.gov.au/__data/assets/pdf_file/0030/775560/Information-about-purchasing-an-induction-cooktop_V2.pdf",
    requiredTiming: "booking_before_customer_agreement" as const },
};

function sourceFormsFor(programCode: string, activityCode: string) {
  return creditexStatutorySourceLibrary().filter((item) => item.program === programCode && (programCode === "VEU"
    ? item.activity.startsWith(`Part ${activityCode.replace(/[^0-9].*$/, "")} |`)
    : item.activity.toUpperCase() === activityCode.toUpperCase()));
}

function sourceFormVariant(templateId: string, variantId = "") {
  const candidate = CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES.find((item) => item.templateId === templateId);
  if (!candidate) throw new Error("ACTIVITY_FORM_UNAVAILABLE");
  const exactForms = sourceFormsFor(candidate.programCode, candidate.activityCode);
  const exact = variantId ? exactForms.find((item) => item.id === variantId)
    : exactForms.find((item) => item.id.endsWith("residential")) || exactForms[0];
  if (variantId && !exact) throw new Error("ACTIVITY_FORM_VARIANT_INVALID");
  return { candidate, exactForms, exact };
}

export function activityConsumerDocuments(templateId: string, variantId = ""): ActivityConsumerDocument[] {
  const { candidate, exact } = sourceFormVariant(templateId, variantId);
  if (candidate.programCode === "VEU") {
    const documents: ActivityConsumerDocument[] = [VEU_DOCUMENTS.consumer, VEU_DOCUMENTS.rights];
    if (!exact?.id.endsWith("business")) {
      if (["1", "3"].includes(candidate.activityCode)) documents.push(VEU_DOCUMENTS.waterHeating);
      else if (candidate.activityCode === "6") documents.push(VEU_DOCUMENTS.heatingCooling);
    }
    if (candidate.activityCode === "46") documents.push(VEU_DOCUMENTS.cooktop);
    return documents.map((item) => ({ ...item }));
  }
  if (!candidate.programCode.startsWith("NSW")) return [];
  const sourceId = /^BESS[1-4]$/.test(candidate.activityCode) ? `${candidate.activityCode.toLowerCase()}_facts`
    : /^(D17|D19|F16|F17|WH1)$/.test(candidate.activityCode) ? "heer_hw_facts"
      : candidate.programCode === "NSW-ESS" && /^D\d/.test(candidate.activityCode) ? "heer_facts" : "";
  const factsheet = national.sources.find((item) => item.id === sourceId);
  return factsheet ? [{ key: `nsw-${sourceId}`, title: `${factsheet.title} (PDF)`, url: factsheet.url,
    requiredTiming: "booking_before_customer_agreement" }] : [];
}

function compileCondition(expression: string, fields: ActivityField[], stage: ActivityPhase, programCode = "", activityCode = ""): ActivityCondition | undefined {
  const source = expression.trim();
  if (!source || /^(always|true|required)$/i.test(source)) return undefined;
  if (source === "PDRS selected") return programCode === "NSW-PDRS" ? undefined : { any: [] };
  if (source === "ESS selected") return programCode === "NSW-ESS" ? undefined : { any: [] };
  if (source.startsWith("BESS1/") || source === "BESS3/4/5") {
    const codes = source.split(";")[0].replace("BESS", "").split("/").map((code) => `BESS${code}`);
    return codes.includes(activityCode.toUpperCase()) ? undefined : { any: [] };
  }
  if (source === "BESS2 or differs from owner" && activityCode === "BESS2") return undefined;
  if (source === "NSW certificate or grid-connected SRES battery" && programCode.startsWith("NSW")) return undefined;
  if (programCode === "SRES" && activityCode === "BESS"
    && /^grid_connected\s*={1,3}\s*yes\s+OR\s+distance_km\s*<=\s*1$/i.test(source)) {
    return { any: [{ fieldKey: "grid_connected", equals: true }, { fieldKey: "distance_km", lessThanOrEqual: 1 }] };
  }
  if (source.includes("||")) {
    const parts = source.split("||").map((part) => compileCondition(part, fields, stage, programCode, activityCode));
    return parts.some((part) => !part) ? undefined : { any: parts.filter((part): part is ActivityCondition => Boolean(part)) };
  }
  if (source.includes("&&")) return { all: source.split("&&").map((part) => compileCondition(part, fields, stage, programCode, activityCode)!).filter(Boolean) };
  const numericUpperBound = source.match(/^([\w.]+)\s*<=\s*(-?(?:\d+(?:\.\d+)?|\.\d+))$/);
  if (numericUpperBound) return { fieldKey: numericUpperBound[1], lessThanOrEqual: Number(numericUpperBound[2]) };
  const equality = source.match(/^([\w.]+)\s*(===?|!==?)\s*["']?([^"']+?)["']?$/);
  if (equality && !source.includes("legal_entity_id")) {
    const [, fieldKey, operator, value] = equality;
    return operator.startsWith("!") ? { fieldKey, notEquals: value.trim() } : { fieldKey, equals: value.trim() };
  }
  if (source.includes("creditex.nsw.legal_entity_id")) {
    if (!fields.some((field) => field.key === "dra.same_as_creditex")) fields.push({ ...blankField("dra.same_as_creditex", "Is Creditex also the demand response aggregator?", "VPP provider", stage), type: "boolean" });
    return { fieldKey: "dra.same_as_creditex", equals: !source.includes("!==") };
  }
  const known = conditions[source];
  const key = known ? /^[\w.]+$/.test(source) ? source : `scope.${source.toLowerCase().replace(/[^a-z0-9]+/g, "_")}` : `applicable.${activityHash(source).slice(0, 16)}`;
  if (!fields.some((field) => field.key === key)) {
    fields.push({ ...blankField(key, known || `Does this condition apply: ${human(source)}?`, "Work scope", stage), type: "boolean",
      help: known ? "" : `Source applicability condition: ${source}. Record the actual circumstances.` });
    if (!known) fields.push({ ...blankField(`${key}.reason`, "Why does this condition not apply?", "Work scope", stage), condition: { fieldKey: key, equals: false } });
  }
  return { fieldKey: key, equals: true };
}

function typeOf(type: string, label: string, options: string[]): ActivityField["type"] {
  if (/photo|image/.test(type)) return "photo";
  if (/file|document|upload/.test(type)) return "document";
  if (options.length) return "select";
  if (/^(yes_no|boolean|checkbox)$/.test(type) || /^(is |has |have |does |was |were |do |are |can )/i.test(label)) return "boolean";
  if (/integer|number|money|currency|decimal/.test(type)) return "number";
  if (type === "date") return "date";
  return "text";
}

function normaliseCondition(condition: ActivityCondition | undefined, fields: ReadonlyMap<string, ActivityField>): ActivityCondition | undefined {
  if (!condition) return undefined;
  const hasAll = condition.all !== undefined;
  const hasAny = condition.any !== undefined;
  if (hasAll || hasAny) {
    if (hasAll === hasAny || condition.fieldKey || condition.equals !== undefined || condition.notEquals !== undefined
      || condition.lessThanOrEqual !== undefined) {
      throw new Error("INVALID_ACTIVITY_FORM_CONDITION_VALUE");
    }
    return hasAll ? { all: condition.all!.map((child) => normaliseCondition(child, fields)!) }
      : { any: condition.any!.map((child) => normaliseCondition(child, fields)!) };
  }
  const hasEquals = condition.equals !== undefined;
  const hasNotEquals = condition.notEquals !== undefined;
  const hasLessThanOrEqual = condition.lessThanOrEqual !== undefined;
  if (!condition.fieldKey || Number(hasEquals) + Number(hasNotEquals) + Number(hasLessThanOrEqual) !== 1) {
    throw new Error("INVALID_ACTIVITY_FORM_CONDITION_VALUE");
  }
  const input = fields.get(condition.fieldKey);
  if (!input) throw new Error(`INVALID_ACTIVITY_FORM_CONDITION_REFERENCE:${condition.fieldKey}`);
  if (hasLessThanOrEqual) {
    if (input.type !== "number" || typeof condition.lessThanOrEqual !== "number" || !Number.isFinite(condition.lessThanOrEqual)) {
      throw new Error(`INVALID_ACTIVITY_FORM_CONDITION_VALUE:${condition.fieldKey}`);
    }
    return { fieldKey: condition.fieldKey, lessThanOrEqual: condition.lessThanOrEqual };
  }
  const value = hasEquals ? condition.equals : condition.notEquals;
  let normalised: string | number | boolean;
  if (input.type === "boolean") {
    if (typeof value === "boolean") normalised = value;
    else if (typeof value === "string" && /^(?:yes|true)$/i.test(value.trim())) normalised = true;
    else if (typeof value === "string" && /^(?:no|false)$/i.test(value.trim())) normalised = false;
    else throw new Error(`INVALID_ACTIVITY_FORM_CONDITION_VALUE:${condition.fieldKey}`);
  } else if (input.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`INVALID_ACTIVITY_FORM_CONDITION_VALUE:${condition.fieldKey}`);
    normalised = value;
  } else if (["text", "date", "select"].includes(input.type)) {
    if (typeof value !== "string" || input.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || input.type === "select" && !input.options.includes(value)) {
      throw new Error(`INVALID_ACTIVITY_FORM_CONDITION_VALUE:${condition.fieldKey}`);
    }
    normalised = value;
  } else {
    throw new Error(`INVALID_ACTIVITY_FORM_CONDITION_VALUE:${condition.fieldKey}`);
  }
  return hasEquals ? { fieldKey: condition.fieldKey, equals: normalised } : { fieldKey: condition.fieldKey, notEquals: normalised };
}

function normaliseActivityFormConditions(fields: ActivityField[], declarations: ActivityDeclaration[]) {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  for (const item of [...fields, ...declarations]) {
    const condition = normaliseCondition(item.condition, byKey);
    if (condition) item.condition = condition;
    else delete item.condition;
  }
}

function optionLabel(value: string, fieldKey: string) {
  const exact: Record<string, Record<string, string>> = {
    "prework_scope.removal_scope": {
      remove: "Installer will remove the replaced equipment",
      retain_unsafe_or_impractical: "Existing equipment will remain because removal is unsafe or impractical",
    },
    "prework_scope.repair_scope": {
      all: "Installer will complete all required building repairs",
      some: "Installer will complete some required building repairs",
      none: "Customer or another contractor will complete all required building repairs",
    },
    "benefit_payment.benefit_type": {
      upfront_cash: "Upfront cash payment",
      price_reduction: "Price reduction",
      delayed_cash: "Cash payment after the work",
      other: "Other benefit",
    },
  };
  if (exact[fieldKey]?.[value]) return exact[fieldKey][value];
  if (value === "yes") return "Yes";
  if (value === "no") return "No";
  if (value === "not_applicable") return "Not applicable";
  const buildingClass = value.match(/^Class\s*([1-9])$/i);
  if (buildingClass) return `Class ${buildingClass[1]} building`;
  const words = human(value).replace(/\s+/g, " ").trim();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : value;
}

function isSignatureTimestamp(fieldKey: string, autofill = "") {
  return /^signatureEvents\..+\.localDate$/.test(autofill)
    || /(?:signature|declaration|acknowledgement|acknowledgment|assignment)(?:\.|_|-)*(?:date|signed(?:\.|_|-)*at)$|(?:date|signed(?:\.|_|-)*at)(?:\.|_|-)*(?:signature|declaration|acknowledgement|acknowledgment|assignment)/i.test(fieldKey);
}

function derivedDeliveryFields(documents: readonly ActivityConsumerDocument[]): ActivityField[] {
  if (!documents.length) return [];
  const help = "Recorded from the immutable customer-document email acceptance event created when the job is booked.";
  return [
    { ...blankField(ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.deliveryId, "Provider-accepted delivery ID", "Customer document delivery", "before"),
      required: false, presentation: "derived", help },
    { ...blankField(ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.providerAccepted, "Provider-accepted required customer documents", "Customer document delivery", "before"),
      type: "boolean", required: false, presentation: "derived", help },
    { ...blankField(ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.method, "Provider-accepted delivery method", "Customer document delivery", "before"),
      required: false, presentation: "derived", help },
    { ...blankField(ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.acceptedAt, "Provider-accepted at", "Customer document delivery", "before"),
      required: false, presentation: "derived", help },
    { ...blankField(ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.recipient, "Provider-accepted recipient", "Customer document delivery", "before"),
      required: false, presentation: "derived", help },
    { ...blankField(ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.appointmentId, "Provider-accepted appointment ID", "Customer document delivery", "before"),
      required: false, presentation: "derived", help },
    { ...blankField(ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.documentIds, "Provider-accepted document IDs", "Customer document delivery", "before"),
      required: false, presentation: "derived", help },
    { ...blankField(ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.documentSha256Set, "Provider-accepted document SHA-256 set", "Customer document delivery", "before"),
      required: false, presentation: "derived", help },
    { ...blankField(ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.packSha256, "Provider-accepted activity-bound pack SHA-256", "Customer document delivery", "before"),
      required: false, presentation: "derived", help },
  ];
}

const evidenceSourceAliases: Record<string, string> = {
  battery_warranty: "warranty",
  manual: "manual-location-evidence",
  contract: "demand-response-contract",
  retailer_disclosures: "pv-retailer-statement",
  disclosures: "battery-retailer-statement",
};

function normaliseEvidenceSource(value: string) {
  return value.toLowerCase().replace(/^activity-evidence:|^evidence\./, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function evidenceSourceIdentity(fieldKey: string, requirements: ReadonlyMap<string, string>) {
  const alias = evidenceSourceAliases[fieldKey];
  const normalised = normaliseEvidenceSource(alias || fieldKey);
  return requirements.get(normalised) || "";
}

function sameCondition(left: ActivityCondition | undefined, right: ActivityCondition | undefined) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeEvidenceFields(catalogue: ActivityField, exact: ActivityField): ActivityField {
  const type = catalogue.type === "photo" || exact.type === "photo" || catalogue.requireLocation || exact.requireLocation ? "photo" : "document";
  const catalogueHelp = catalogue.help.trim();
  const exactHelp = exact.help.trim();
  const help = exactHelp.includes(catalogueHelp) ? exactHelp : catalogueHelp.includes(exactHelp) ? catalogueHelp
    : [...new Set([catalogueHelp, exactHelp].filter(Boolean))].join(" ");
  const condition = !catalogue.condition || !exact.condition ? undefined : sameCondition(catalogue.condition, exact.condition) ? catalogue.condition : undefined;
  const merged: ActivityField = {
    ...catalogue,
    type,
    required: catalogue.required || exact.required,
    requireLocation: type === "photo" && Boolean(catalogue.requireLocation || exact.requireLocation),
    phase: catalogue.phase === "before" || exact.phase === "before" ? "before" : "after",
    evidenceFor: [...new Set([...(catalogue.evidenceFor || []), ...(exact.evidenceFor || [])])],
    help,
    condition,
  };
  if (!merged.condition) delete merged.condition;
  if (!merged.requireLocation) delete merged.requireLocation;
  return merged;
}

function appendCatalogueEvidence(fields: ActivityField[], catalogue: ActivityField) {
  const matches = fields.map((field, index) => ({ field, index })).filter(({ field }) => field.sourceRequirementId === catalogue.sourceRequirementId
    && (field.type === "photo" || field.type === "document"));
  if (matches.length !== 1) {
    fields.push(catalogue);
    return;
  }
  fields.splice(matches[0].index, 1, mergeEvidenceFields(catalogue, matches[0].field));
}

const MANUAL_CUSTOMER_DOCUMENT_KEYS = new Set([
  "disclosures.veu_factsheet_given",
  "disclosures.veu_rights_given",
  "disclosures.veu_factsheet_method",
  "disclosures.veu_factsheet_time",
  "consumer_checks.sizing_factsheet_received",
  "consumer_checks.sizing_consistency_informed",
  "customer_documents",
  "factsheet_receipt",
  "factsheet",
  "cooktop_consumer_fact_sheet_provided",
]);

const MANUAL_CUSTOMER_DOCUMENT_EVIDENCE_IDS = new Set(["factsheet-delivery", "customer-factsheet", "facts"]);
const NO_GENERIC_CUSTOMER_DOCUMENT_GATE_TEMPLATES = new Set([
  "sres-pv", "sres-bess", "sres-swh", "sres-ashp",
  "nsw-pdrs-hvac1", "nsw-pdrs-hvac2", "nsw-pdrs-bess5",
]);

function isRedundantManualCustomerDocumentField(field: ActivityField) {
  return MANUAL_CUSTOMER_DOCUMENT_KEYS.has(field.key)
    || Boolean(field.sourceRequirementId && MANUAL_CUSTOMER_DOCUMENT_EVIDENCE_IDS.has(field.sourceRequirementId));
}

function evidencePlacement(requirementId: string, label: string) {
  const source = `${requirementId} ${label}`.toLowerCase();
  if (/invoice|proof.of.purchase|payment/.test(source)) return { section: "Benefit and payment", phase: "after" as const,
    evidenceFor: ["benefit_payment.benefit_type", "benefit_payment.benefit_amount", "benefit_payment.gross_price", "benefit_payment.consumer_paid"] };
  if (/plumb|electrical|certificate|coes|bpc/.test(source)) return { section: "Trade certificates", phase: "after" as const,
    evidenceFor: ["certificates.bpc_number", "certificates.coes_number"] };
  if (/sizing|heat.load/.test(source)) return { section: "Product sizing", phase: "after" as const,
    evidenceFor: ["sizing.baseline_area_range", "sizing.matches_factsheet", "sizing.departure_reason"] };
  if (/refrigerant/.test(source)) return { section: "Existing equipment", phase: "after" as const,
    evidenceFor: ["baseline.scenario", "baseline.decommissioning_method"] };
  if (/existing|decommission/.test(source)) return { section: "Existing equipment", phase: "before" as const,
    evidenceFor: ["baseline.scenario", "baseline.brand", "baseline.model", "baseline.decommissioning_method"] };
  if (/installed|product|equipment/.test(source)) return { section: "Installed equipment", phase: "after" as const,
    evidenceFor: ["installed_product.category", "installed_product.brand", "installed_product.model", "installed_product.serial_numbers"] };
  if (/property|premises|site/.test(source)) return { section: "Customer and property", phase: "before" as const,
    evidenceFor: ["customer_property.installation_address"] };
  return { section: "Evidence", phase: phase(`${requirementId} ${label}`), evidenceFor: [] as string[] };
}

function evidenceCondition(requirementId: string, fields: readonly ActivityField[]): ActivityCondition | undefined {
  const match = /plumbing|\bbpc\b/i.test(requirementId) ? { fieldKey: "certificates.bpc_required", equals: "yes" }
    : /electrical|\bcoes\b/i.test(requirementId) ? { fieldKey: "certificates.coes_required", equals: "yes" }
      : /refrigerant/i.test(requirementId) ? { fieldKey: "handling_fluorocarbon_refrigerant_covered_by_ozone_act", equals: true }
        : /multisplit|multi-split/i.test(requirementId) ? { fieldKey: "installed_product.isMultiSplit", equals: true } : undefined;
  return match && fields.some((field) => field.key === match.fieldKey) ? match : undefined;
}

function conditionFieldKeys(condition: ActivityCondition | undefined, into = new Set<string>()) {
  if (!condition) return into;
  if (condition.fieldKey) into.add(condition.fieldKey);
  for (const child of [...(condition.all || []), ...(condition.any || [])]) conditionFieldKeys(child, into);
  return into;
}

function orderByPhaseAndSection(fields: readonly ActivityField[]) {
  const byKey = new Map<string, ActivityField>();
  const originalIndex = new Map<string, number>();
  for (const [index, field] of fields.entries()) {
    if (byKey.has(field.key)) throw new Error(`INVALID_ACTIVITY_FORM_CONDITION_REFERENCE:${field.key}`);
    byKey.set(field.key, field);
    originalIndex.set(field.key, index);
  }

  const ordered: ActivityField[] = [];
  for (const stage of ["before", "after"] as const) {
    const stageFields = fields.filter((field) => field.phase === stage);
    const sectionFields = new Map<string, ActivityField[]>();
    const sectionByField = new Map<string, string>();
    for (const field of stageFields) {
      sectionFields.set(field.section, [...(sectionFields.get(field.section) || []), field]);
      sectionByField.set(field.key, field.section);
    }
    const unitKey = (field: ActivityField) => field.repeatGroup
      ? `repeat:${stage}:${field.section}:${field.repeatGroup}` : `field:${field.key}`;
    const unitFields = new Map<string, ActivityField[]>();
    const unitByField = new Map<string, string>();
    for (const field of stageFields) {
      const key = unitKey(field);
      unitFields.set(key, [...(unitFields.get(key) || []), field]);
      unitByField.set(field.key, key);
    }

    const sectionDependencies = new Map([...sectionFields.keys()].map((key) => [key, new Set<string>()]));
    const sectionDependants = new Map([...sectionFields.keys()].map((key) => [key, new Set<string>()]));
    const unitDependencies = new Map([...unitFields.keys()].map((key) => [key, new Set<string>()]));
    const unitDependants = new Map([...unitFields.keys()].map((key) => [key, new Set<string>()]));
    const memberDependencies = new Map(stageFields.map((field) => [field.key, new Set<string>()]));
    const memberDependants = new Map(stageFields.map((field) => [field.key, new Set<string>()]));
    for (const field of stageFields) {
      for (const dependencyKey of conditionFieldKeys(field.condition)) {
        const dependency = byKey.get(dependencyKey);
        if (!dependency) throw new Error(`INVALID_ACTIVITY_FORM_CONDITION_REFERENCE:${field.key}:${dependencyKey}`);
        if (field.phase === "before" && dependency.phase === "after") {
          throw new Error(`INVALID_ACTIVITY_FORM_CONDITION_PHASE:${field.key}:${dependencyKey}`);
        }
        if (dependency.phase !== stage) continue;
        const dependantSection = sectionByField.get(field.key)!;
        const dependencySection = sectionByField.get(dependencyKey)!;
        if (dependantSection !== dependencySection) {
          if (sectionDependencies.get(dependantSection)!.has(dependencySection)) continue;
          sectionDependencies.get(dependantSection)!.add(dependencySection);
          sectionDependants.get(dependencySection)!.add(dependantSection);
          continue;
        }
        const dependantUnit = unitByField.get(field.key)!;
        const dependencyUnit = unitByField.get(dependencyKey)!;
        if (dependantUnit === dependencyUnit) {
          if (memberDependencies.get(field.key)!.has(dependencyKey)) continue;
          memberDependencies.get(field.key)!.add(dependencyKey);
          memberDependants.get(dependencyKey)!.add(field.key);
        } else {
          if (unitDependencies.get(dependantUnit)!.has(dependencyUnit)) continue;
          unitDependencies.get(dependantUnit)!.add(dependencyUnit);
          unitDependants.get(dependencyUnit)!.add(dependantUnit);
        }
      }
    }

    const compareFields = (left: ActivityField, right: ActivityField) => originalIndex.get(left.key)! - originalIndex.get(right.key)!;
    const compareSections = (left: string, right: string) => compareFields(sectionFields.get(left)![0], sectionFields.get(right)![0]);
    const readySections = [...sectionFields.keys()].filter((key) => sectionDependencies.get(key)!.size === 0).sort(compareSections);
    const orderedSections: string[] = [];
    while (readySections.length) {
      const key = readySections.shift()!;
      orderedSections.push(key);
      for (const dependantKey of sectionDependants.get(key)!) {
        const remaining = sectionDependencies.get(dependantKey)!;
        remaining.delete(key);
        if (!remaining.size) {
          readySections.push(dependantKey);
          readySections.sort(compareSections);
        }
      }
    }
    if (orderedSections.length !== sectionFields.size) {
      const cycle = [...sectionFields.keys()].filter((key) => sectionDependencies.get(key)!.size).sort().join(",");
      throw new Error(`INVALID_ACTIVITY_FORM_CONDITION_SECTION_CYCLE:${cycle}`);
    }

    for (const section of orderedSections) {
      const units = [...unitFields.keys()].filter((key) => unitFields.get(key)![0].section === section);
      const compareUnits = (left: string, right: string) => compareFields(unitFields.get(left)![0], unitFields.get(right)![0]);
      const readyUnits = units.filter((key) => unitDependencies.get(key)!.size === 0).sort(compareUnits);
      const orderedUnits: string[] = [];
      while (readyUnits.length) {
        const key = readyUnits.shift()!;
        orderedUnits.push(key);
        for (const dependantKey of unitDependants.get(key)!) {
          const remaining = unitDependencies.get(dependantKey)!;
          remaining.delete(key);
          if (!remaining.size) {
            readyUnits.push(dependantKey);
            readyUnits.sort(compareUnits);
          }
        }
      }
      if (orderedUnits.length !== units.length) {
        const cycle = units.filter((key) => unitDependencies.get(key)!.size)
          .flatMap((key) => unitFields.get(key)!.map((field) => field.key)).sort().join(",");
        throw new Error(`INVALID_ACTIVITY_FORM_CONDITION_CYCLE:${cycle}`);
      }

      for (const key of orderedUnits) {
        const members = unitFields.get(key)!;
        const readyMembers = members.filter((field) => memberDependencies.get(field.key)!.size === 0).sort(compareFields);
        const orderedMembers: ActivityField[] = [];
        while (readyMembers.length) {
          const field = readyMembers.shift()!;
          orderedMembers.push(field);
          for (const dependantKey of memberDependants.get(field.key)!) {
            const remaining = memberDependencies.get(dependantKey)!;
            remaining.delete(field.key);
            if (!remaining.size) {
              readyMembers.push(byKey.get(dependantKey)!);
              readyMembers.sort(compareFields);
            }
          }
        }
        if (orderedMembers.length !== members.length) {
          const cycle = members.filter((field) => memberDependencies.get(field.key)!.size).map((field) => field.key).sort().join(",");
          throw new Error(`INVALID_ACTIVITY_FORM_CONDITION_CYCLE:${cycle}`);
        }
        ordered.push(...orderedMembers);
      }
    }
  }
  return ordered;
}

const VEU_ASSIGNMENT_SOURCES = [{ title: "VEET Guidelines v16: written assignments and signed declarations, sections 8.1–8.5",
  url: "https://www.esc.vic.gov.au/sites/default/files/documents/PBL%20-%20VEET%20guidelines%20v16%20-%2020260416.pdf" }];
const ACT_ACTIVITY_RECORD_SOURCES = [{ title: "ACT EEIS Code of Practice 2025: signed activity records, sections 5.3–5.21",
  url: "https://www.legislation.act.gov.au/DownloadFile/ni/2025-254/current/PDF/2025-254.PDF" }];
const ACT_ACTIVITY_CODE_SOURCES = [{ title: "ACT EEIS Eligible Activities Code of Practice 2025",
  url: "https://www.legislation.act.gov.au/DownloadFile/ni/2025-184/current/PDF/2025-184.PDF" }];
const SA_ACTIVITY_RECORD_SOURCES = [{ title: "ESCOSA REPS Technical Bulletin 8: activity records and signatures",
  url: "https://www.escosa.sa.gov.au/industry/reps/bulletins/technical-bulletins" }];
const NSW_CAPACITY_NOMINATION_SOURCES = [{ title: "NSW PDRS capacity holder nomination and BESS2 exception",
  url: "https://www.energysustainabilityschemes.nsw.gov.au/pdrs/nomination-capacity-holder" }];
const WATER_HEATER_ASSIGNMENT_SOURCES = [{
  title: "CER required documents before creating water-heater STCs",
  url: "https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-technology-certificates/create-small-scale-technology-certificates",
}];
const INSULATION_ASSIGNMENT_SOURCES = [{
  title: "VEU ceiling insulation industry pack: accredited person contract and assignment",
  url: "https://www.energy.vic.gov.au/__data/assets/pdf_file/0026/800945/VEU-Ceiling-Insulation-Industry-Pack.pdf",
}];

function requireSignedArtifact(fields: ActivityField[], input: {
  requirementId: string; label: string; phase: ActivityPhase; help: string;
  sources: readonly { title: string; url: string }[]; condition?: ActivityCondition;
}) {
  const existing = fields.find(item => item.sourceRequirementId === input.requirementId && item.type === "document");
  const key = existing?.key || `evidence.${input.requirementId}`;
  const field: ActivityField = { ...blankField(key, input.label, "Signed programme documents", input.phase),
    type: "document", sourceRequirementId: input.requirementId, referenceDocuments: [...input.sources], help: input.help,
    ...(input.condition ? { condition: input.condition } : {}) };
  const index = fields.findIndex(item => item.key === key);
  if (index < 0) fields.push(field); else fields[index] = field;
}

function applyProgrammeSignedArtifactPolicy(fields: ActivityField[], declarations: ActivityDeclaration[], candidate: CreditexCurrentWorkPackContentCandidate,
  exact: ReturnType<typeof sourceFormVariant>["exact"], reviewNotes: string[]) {
  let applies = false;
  const requireArtifact = (input: Parameters<typeof requireSignedArtifact>[1]) => {
    requireSignedArtifact(fields, input); applies = true;
  };
  // These are exact source requirements, not a universal assignment inferred
  // from a finance or administration programme's service category.
  for (const evidence of candidate.evidenceRequirements) {
    const assignment = /assignment|nomination/i.test(`${evidence.requirementId} ${evidence.label}`);
    const signedStatement = /signed_statement|signed_declaration/.test(evidence.kind);
    const originalHolderAlternative = /original capacity-holder evidence or/i.test(evidence.label);
    const heerDeclaration = candidate.programCode === "NSW-ESS" && ["site-assessor-declaration", "post-implementation-declaration"].includes(evidence.requirementId);
    const installerDeclaration = candidate.programCode === "NSW-ESS" && evidence.requirementId === "installer-declaration";
    if (!assignment && !signedStatement && !heerDeclaration && !installerDeclaration) continue;
    const before = evidence.requirementId === "site-assessor-declaration" || (assignment && (candidate.programCode === "NSW-ESS" || (candidate.programCode === "NSW-PDRS" && candidate.activityCode !== "BESS2")));
    // Preserve the source's CCEW/commissioning-report alternatives in the
    // required installer-evidence field, instead of leaving an optional copy.
    if (installerDeclaration) {
      const supportingIndex = fields.findIndex(field => field.key === "evidence.installer-declaration.supporting");
      if (supportingIndex >= 0) fields.splice(supportingIndex, 1);
    }
    const timing = evidence.requirementId === "site-assessor-declaration" ? "Retain the completed site-assessor declaration signed before or at the start of work."
      : before ? originalHolderAlternative ? "Before work, retain evidence that the ACP is the original capacity holder, or the applicable nomination signed on or before implementation. The original-holder evidence is an alternative, not a requirement for an additional signed nomination."
        : "Retain the completed signed nomination on or before implementation; capture it before work starts."
      : candidate.templateId === "nsw-pdrs-bess2" ? "Use the specific BESS2 nomination incorporated in the demand-response aggregator contract. Complete within 90 days of onboarding and before certificate creation; retain the customer copy. Do not substitute the general pre-installation nomination."
        : "Retain the completed signed document after the relevant activity facts are known and before certificate creation.";
    requireArtifact({ requirementId: evidence.requirementId, label: evidence.label,
      ...(evidence.requirementId === "pv_retailer_statement" ? { condition: { fieldKey: "scope.solar_retailer_involved", equals: true } } : {}),
      phase: before ? "before" : "after", sources: [{ title: evidence.source.title, url: evidence.source.officialUrl },
        ...(candidate.programCode === "NSW-PDRS" ? NSW_CAPACITY_NOMINATION_SOURCES : [])],
      help: `${evidence.guidance.join(" ")} ${timing} ${originalHolderAlternative ? "For the nomination pathway, use" : "Use"} the current activity-specific template approved by Creditex with verified legal parties, actual activity details and every required signature/date or witness. Where the source permits original-holder evidence instead of a nomination, retain that evidence for Creditex review. A general TLink field-authorisation signature does not replace this artifact. Do not use unverified legacy supplied PDFs. Creditex must verify any certificate quantity, benefit and final assignment before certificate creation.` });
  }
  if (candidate.templateId === "sres-pv") {
    const condition: ActivityCondition = { fieldKey: "scope.solar_retailer_involved", equals: true };
    fields.push({ ...blankField("scope.solar_retailer_involved", "Was a solar retailer involved?", "Work scope", "before"), type: "boolean",
      sourceRequirementId: "pv_retailer_applicability", help: "Record whether a solar retailer was involved. Its details and signed statement are required when applicable." });
    for (const field of fields) if (/^(?:binding\.)?retailer\.|^retailer_disclosures$/.test(field.key)) {
      field.condition = condition;
      field.sourceRequirementId ||= `pv_retailer_applicability:${field.key}`;
    }
    for (const declaration of declarations) if (declaration.key.startsWith("sres_pv_retailer_statement:")) declaration.condition = condition;
  }
  if (candidate.programCode === "VEU") {
    const sources = [...(exact?.sources || []).map(source => ({ title: source.title, url: source.url })), ...VEU_ASSIGNMENT_SOURCES];
    // Activity 48 already has its own contract and exact assignment field below.
    if (candidate.templateId !== "veu-48") requireArtifact({ requirementId: "veu-signed-assignment",
      label: `Completed and signed Activity ${candidate.activityCode} VEEC assignment`, phase: "after", sources,
      help: "Upload the completed current Creditex-approved assignment for this exact activity and residential/business premises. Include every prescribed field, actual parties, activity details, benefit and required signature/date. Complete the relevant activity facts before signing and follow the exact template's timing; this upload occurs after field capture and must precede VEEC creation. Changes require every signer's initials and date. Provide the required consumer copy. The electronic field declarations do not remove this controlled artifact requirement; unverified legacy supplied PDFs are not active templates." });
    applies = true;
  }
  if (candidate.programCode === "NSW-ESS" || candidate.programCode === "NSW-PDRS") {
    const exactNomination = exact?.declarations.some(item => /nomination/i.test(`${item.key} ${item.title}`));
    const alreadyCaptured = candidate.evidenceRequirements.some(item => /nomination/i.test(`${item.requirementId} ${item.label}`));
    if (exactNomination && !alreadyCaptured) {
      const bess2 = candidate.templateId === "nsw-pdrs-bess2";
      requireArtifact({ requirementId: "signed-programme-nomination", label: bess2 ? "Completed signed BESS2 capacity-holder nomination" : "Completed signed original energy-saver/capacity-holder nomination",
        phase: bess2 ? "after" : "before", sources: [...(exact?.sources || []).map(source => ({ title: source.title, url: source.url })),
          ...(candidate.programCode === "NSW-PDRS" ? NSW_CAPACITY_NOMINATION_SOURCES : [])],
        help: bess2 ? "Retain the specific BESS2 nomination in the demand-response aggregator contract, completed within 90 days of onboarding and before certificate creation, with the correct customer, aggregator, ACP and battery/VPP details. Provide the completed customer copy. The general nomination template and field-authorisation signature do not replace it."
          : "Before implementation, retain the completed current Creditex-approved nomination signed by the original energy saver/capacity holder on or before implementation. It must identify the exact activity, site, nominated ACP, parties and required declarations. Give the customer their copy. A field-authorisation signature does not replace the nomination." });
    }
  }
  if (candidate.programCode === "ACT-EEIS") requireArtifact({ requirementId: "act-eeis-signed-activity-record",
    label: "Completed and signed ACT EEIS activity record", phase: "after", sources: ACT_ACTIVITY_RECORD_SOURCES,
    help: "Use the current ACT EEIS activity record with the prescribed declarations for this exact installation or purchase. Complete the facts before signature. Obtain the consumer's signature and every authorised installer's signature, including the primary-installer declaration when there are multiple installers; purchase-only activities require the authorised seller instead. Provide the consumer a copy immediately after both parties sign. This is an ACT activity record, not a VEEC or NSW assignment, and generic TLink field authority does not replace it. Retain later disposal or certification attachments required by the activity." });
  if (["act-eeis-1-8", "act-eeis-1-9"].includes(candidate.templateId)) {
    const ceiling = candidate.templateId === "act-eeis-1-8";
    requireArtifact({ requirementId: "act-insulation-electrical-safety-report", label: "Electrician-signed pre-installation electrical safety report", phase: "before", sources: ACT_ACTIVITY_CODE_SOURCES,
      help: "Before insulation, retain the licensed electrician's signed report confirming all required checks and remediation under the current Code and electricity retailer's safe work method statement." });
    requireArtifact({ requirementId: "act-insulation-term-of-responsibility", label: "Occupant and owner signed term of responsibility", phase: "before", sources: ACT_ACTIVITY_CODE_SOURCES,
      help: `After the electrician's work and before insulation, obtain the occupant's signature and, if different, the owner's signature. They acknowledge the work and safety issues and agree not to enter or permit access to the ${ceiling ? "roof space" : "underfloor cavity"} during that interval.` });
    fields.push({ ...blankField("scope.act_insulation_electrical_work", "Did the electrician perform electrical work?", "Insulation safety", "before"), type: "boolean", sourceRequirementId: "act-insulation-electrical-work-applicability" });
    requireArtifact({ requirementId: "act-insulation-electrical-safety-certificate", label: "Certificate of Electrical Safety for completed electrical work", phase: "before", sources: ACT_ACTIVITY_CODE_SOURCES,
      condition: { fieldKey: "scope.act_insulation_electrical_work", equals: true },
      help: "Where electrical work was performed, retain the relevant CES with the specific remedial work identified. This does not replace the signed pre-installation safety report." });
    if (ceiling) {
      fields.push({ ...blankField("scope.act_insulation_downlights_present", "Were downlights present?", "Insulation safety", "before"), type: "boolean", sourceRequirementId: "act-insulation-downlight-applicability" });
      requireArtifact({ requirementId: "act-insulation-no-downlights-statement", label: "Signed statement confirming no downlights were present", phase: "before", sources: ACT_ACTIVITY_CODE_SOURCES,
        condition: { fieldKey: "scope.act_insulation_downlights_present", equals: false },
        help: "If no downlights were present, retain the signed statement required by section 1.8.6(b)(vi). Where downlights exist, retain the applicable clearance/barrier and installation evidence instead." });
    }
  }
  if (candidate.templateId === "act-eeis-4-2") requireArtifact({ requirementId: "act-lighting-compliance-declaration", label: "Signed installed-lighting compliance declaration", phase: "after", sources: ACT_ACTIVITY_CODE_SOURCES,
    help: "Retain the signed declaration that installed lighting complies with the applicable AS/NZS 1680 and NCC F4.4 requirements under section 4.2.7(g), in addition to the signed ACT activity record." });
  if (candidate.programCode === "SA-REPS") requireArtifact({ requirementId: "sa-reps-signed-activity-record",
    label: "Completed and signed SA REPS activity record", phase: "after", sources: SA_ACTIVITY_RECORD_SOURCES,
    help: "Retain the current obligated retailer-approved activity record completed with the exact REPS activity facts before the customer signs. Use a handwritten or equivalent signature, not a tick box. Obtain express approval and customer/installer initials for changes; provide the required Information Statement and record, and a signed copy on request. Attach any applicable Address, Occupant or Compliance Declaration for retailer approval before reporting; these are conditional, not universally required. This record is not a certificate assignment and generic TLink field authority does not replace it." });
  if (["sa-reps-bs1a", "sa-reps-bs1b"].includes(candidate.templateId)) requireArtifact({ requirementId: "sa-insulation-installer-acknowledgement", label: "Signed ceiling-insulation Installer Acknowledgement Form", phase: "after",
    sources: [{ title: `SA REPS ${candidate.activityCode} insulation activity specification`, url: candidate.templateId === "sa-reps-bs1a"
      ? "https://www.energymining.sa.gov.au/__data/assets/pdf_file/0011/1235567/Install-Insulation-in-an-Uninsulated-Ceiling-Space-BS1A.pdf"
      : "https://www.energymining.sa.gov.au/__data/assets/pdf_file/0003/1235568/Install-Top-up-Insulation-in-a-Ceiling-Space-BS1B.pdf" }],
    help: "Retain the completed signed Installer Acknowledgement Form for this insulation installation and give the customer a copy. This supplements the REPS activity record; complete the required self-assessment and hazard assessment before installation." });
  if (applies) reviewNotes.push("Required signed programme artifacts must be completed using current controlled templates and verified by Creditex/the responsible scheme provider. A file upload or general field-authorisation signature does not establish statutory validity or certificate entitlement. Supplied legacy PDFs remain reference material until their legal identity, current wording and applicability are approved.");
  return applies;
}

function applySignedAssignmentEvidencePolicy(fields: ActivityField[], templateId: string, reviewNotes: string[]) {
  if (templateId === "sres-ashp" || templateId === "sres-swh") {
    const kind = templateId === "sres-ashp" ? "ashp" : "swh";
    const technology = kind === "ashp" ? "air-source heat pump" : "solar water heater";
    fields.push({ ...blankField(`evidence.${kind}_stc_assignment`, `Signed ${technology} owner STC assignment`, "Certificate assignment", "after"),
      type: "document", sourceRequirementId: `${kind}_stc_assignment`, referenceDocuments: WATER_HEATER_ASSIGNMENT_SOURCES,
      help: `Upload the completed current Creditex-approved ${technology} assignment. It must identify the system owner, installation address and date, registered agent, actual system brand/model/quantity and tank serial numbers; state the verified eligible STCs, applicable deeming period, incentive type and amount and retailer name/ABN; and include the owner declaration, signature/date and required witness details. Do not reuse obsolete solar-PV deeming options. Creditex must review the signed document before certificate creation.` });
    const statement = fields.find((field) => field.key === `evidence.${kind}_installer_compliance_certificate`);
    if (statement) {
      statement.label = `Signed ${technology} installer compliance statement`;
      statement.type = "document"; statement.required = true; statement.phase = "after";
      statement.sourceRequirementId = `${kind}_installer_compliance_certificate`;
      statement.referenceDocuments = WATER_HEATER_ASSIGNMENT_SOURCES;
      statement.help = "Upload the installer's signed and completed compliance statement for the actual water-heater installation, with installer identity, applicable licence details and installation compliance information. A generic TLink field-record signature does not replace this document. Retain any separate state or territory compliance certificates required for the work.";
    }
    const reference = fields.find((field) => field.key === "assignment");
    if (reference) {
      reference.label = "Current Creditex-approved water-heater assignment template reference";
      reference.help = "Record the template reference and revision supplied or approved by Creditex for this technology. Upload its completed signed copy below. This reference is for Creditex review and does not approve the template or calculate certificate entitlement.";
      reference.sourceRequirementId = `${kind}_assignment_template_reference`;
      reference.referenceDocuments = WATER_HEATER_ASSIGNMENT_SOURCES;
    }
    // These broad national-form fields concern electricity-account nominations and batteries,
    // not ownership and assignment of water-heater STCs.
    for (let index = fields.length - 1; index >= 0; index--) {
      if (["account_holder", "nmi", "scope.bess2_or_differs_from_owner", "scope.nsw_certificate_or_grid_connected_sres_battery"].includes(fields[index].key)) fields.splice(index, 1);
    }
    reviewNotes.push("Before creating water-heater STCs, Creditex must verify the current technology-specific signed owner assignment and signed installer compliance statement. The supplied legacy combined STC assignment is reference material only: its historical PV deeming options are not an approved current template. Field authorisation and completion signatures do not replace these documents.");
  }
  if (templateId === "veu-48") {
    fields.push({ ...blankField("evidence.insulation-ap-consumer-contract", "Signed Activity 48 contract between the accredited person and consumer", "Consumer contract", "before"),
      type: "document", sourceRequirementId: "insulation-ap-consumer-contract", referenceDocuments: INSULATION_ASSIGNMENT_SOURCES,
      help: "Before installation, retain the signed contract between the consumer and the Activity 48 accredited person using the current approved contract model. A subcontractor agreement or general authority to send TLink records does not replace that contract. Creditex must verify its accreditation and contract arrangements." },
    { ...blankField("assignment.insulation_template_reference", "Current Creditex-approved Activity 48 assignment template reference", "Certificate assignment", "after"),
      sourceRequirementId: "insulation-assignment-template-reference", referenceDocuments: INSULATION_ASSIGNMENT_SOURCES,
      help: "Record the approved Activity 48 template reference and revision supplied by Creditex. Do not use an Activity 1, 3 or 6 assignment. If no current approved Activity 48 template is available, refer the job to Creditex; the assignment requirement remains incomplete." },
    { ...blankField("evidence.insulation-veec-assignment", "Completed and signed Activity 48 VEEC assignment", "Certificate assignment", "after"),
      type: "document", sourceRequirementId: "insulation-veec-assignment", referenceDocuments: INSULATION_ASSIGNMENT_SOURCES,
      help: "Upload the completed and signed current Activity 48 assignment approved by Creditex, including the prescribed consumer and accredited-person declarations and actual activity details. Do not use an Activity 1, 3 or 6 assignment. Creditex must verify the correct template, parties, signatures and completed particulars before certificate creation. A general field-record signature does not assign VEEC rights." });
    reviewNotes.push("No current downloadable prescribed Activity 48 assignment template was verified for this release. Require the current Creditex-approved Activity 48 contract and signed assignment artifacts and review them before certificate creation; never substitute another activity's assignment or treat this capture form as the prescribed assignment.");
  }
}

export function defaultActivityFieldForm(templateId: string, variantId = ""): ActivityForm {
  const { candidate, exactForms, exact } = sourceFormVariant(templateId, variantId);
  const documents = activityConsumerDocuments(templateId, exact?.id || "");
  const evidenceRequirements = new Map(candidate.evidenceRequirements.map((item) => [normaliseEvidenceSource(item.requirementId), item.requirementId]));
  const fields: ActivityField[] = [];
  const declarations: ActivityDeclaration[] = [];
  const reviewNotes = [...(exact?.authoringRequirements || [])];
  const rawVeu = veuSourceForms.find((item) => item.id === exact?.id);
  if (exact) {
    for (const group of exact.groups) for (const item of group.fields) {
      if (item.type === "signature" || /(^|[._])signature($|[._])|signed_at|date_signed/i.test(item.key)) continue;
      if (candidate.programCode === "SRES" && /stc_count|certificate.*quantity|certificate.*number|deeming_years/.test(item.key)) continue;
      const raw = rawVeu?.groups.flatMap((value) => value.prompts).find((value) => value.key === item.key);
      if (isSignatureTimestamp(item.key, raw?.autofillFrom)) continue;
      let stage = phase(group.timing);
      if (!rawVeu && /customer|consumer|holder|nomination|workers|scope|baseline|sizing/.test(item.key) && !/installation_date|onboarded|benefit|signed/.test(item.key)) stage = "before";
      if (/installation_date|^installation\.date$/.test(item.key)) stage = "after";
      const rawOptions = raw?.options || item.options;
      const options = rawOptions.map((option) => typeof option === "string" ? option : option.value || option.label);
      const optionLabels = Object.fromEntries(rawOptions.map((option) => {
        const value = typeof option === "string" ? option : option.value || option.label;
        return [value, typeof option === "string" ? optionLabel(value, item.key) : option.label];
      }));
      const condition = compileCondition(item.condition, fields, stage, candidate.programCode, candidate.activityCode);
      const fieldKey = item.key.replaceAll("[]", "");
      if (fields.some((field) => field.key === fieldKey)) continue;
      fields.push({ ...blankField(fieldKey, item.label, group.title, stage), type: typeOf(item.type, item.label, options), options,
        help: raw?.implementationNote || "", condition,
        ...(options.length ? { optionLabels } : {}),
        ...(raw?.repeatFor ? { repeatGroup: raw.repeatFor } : item.key.includes("[]") ? { repeatGroup: `${item.key.split("[]")[0]}[]` } : {}),
        ...(raw?.autofillFrom ? { autofill: raw.autofillFrom, presentation: "derived" as const } : {}),
      });
    }
    const grouped = new Map<string, typeof exact.declarations>();
    for (const item of exact.declarations) {
      const key = item.key.includes(":") ? item.key.split(":").slice(0, 3).join(":") : item.key;
      grouped.set(key, [...(grouped.get(key) || []), item]);
    }
    for (const [key, items] of grouped) {
      const first = items[0];
      if (items.some((item) => /\{\{certificate\./.test(item.text))) {
        reviewNotes.push(`Creditex finalises the quantity-dependent statutory assignment after checking the installation inputs: ${first.title}. The field customer authorisation does not transfer certificate rights.`);
        continue;
      }
      const role = /consumer|customer|owner|energy saver|capacity holder|holder of.*account/i.test(first.signer) ? "customer"
        : /installer|technician/i.test(first.signer) ? "technician" : "other";
      const stage = rawVeu ? phase(first.timing) : key.startsWith("nsw_general_nomination") ? "before" : "after";
      const text = items.map((item) => item.text).join("\n\n");
      declarations.push({ key, title: first.title, text, role, phase: stage, required: true,
        condition: compileCondition(first.condition || "", fields, stage, candidate.programCode, candidate.activityCode), sourceUrl: first.sourceUrl || exact.sources[0]?.url || "",
        sourceTextSha256: activityHash(items.map((item) => item.sourceTextSha256)) });
      for (const token of text.matchAll(/\{\{([^{}]+)\}\}/g)) {
        const bindingKey = `binding.${token[1]}`;
        if (!fields.some((field) => field.key === bindingKey)) fields.push({ ...blankField(bindingKey, human(token[1]), "Declaration details", stage), condition: declarations.at(-1)?.condition });
      }
    }
  } else {
    // Each entry already has its own retained regulator-specific capture needs.
    // This does not infer a form from a broad service category.
    for (const item of candidate.prompts) {
      if (/issued_certificate|certificate_count|veec_count|stc_count|calculator_result|consumer_rights_information/.test(item.key)) continue;
      if (/creditex_accredited_person|registered_agent_assignment/.test(item.key)) continue;
      if (/declaration/.test(item.key)) continue;
      fields.push({ ...blankField(item.key, item.label.replace(/ from the applicable activity assignment form template$/, ""), "Activity details", phase(`${item.key} ${item.category}`)),
        type: /_confirmed$|_provided$|_compliant$/.test(item.key) ? "boolean" : typeOf(item.inputSignal, item.label, []), required: item.requiredCandidate,
        help: item.guidance.join(" ") });
    }
  }
  for (const field of fields) {
    if (!['photo', 'document'].includes(field.type)) continue;
    const requirementId = evidenceSourceIdentity(field.key, evidenceRequirements);
    if (!requirementId) continue;
    const placement = evidencePlacement(requirementId, field.label);
    field.sourceRequirementId = requirementId;
    field.evidenceFor = [...new Set([...(field.evidenceFor || []), ...placement.evidenceFor])];
  }
  for (const evidence of candidate.evidenceRequirements) {
    if (documents.length && MANUAL_CUSTOMER_DOCUMENT_EVIDENCE_IDS.has(evidence.requirementId)) continue;
    if (candidate.programCode === "VEU" && candidate.activityCode === "44" && evidence.requirementId === "ci-water-heater-existing-product") {
      fields.push({ ...blankField("baseline.product_plate_readable", "Can the existing water heater's compliance plate be read?", "Existing water heater", "before"), type: "boolean" },
        { ...blankField(`evidence.${evidence.requirementId}`, "Photograph the existing water heater's readable compliance plate", "Existing water heater", "before"),
          type: "photo", requireLocation: true, condition: { fieldKey: "baseline.product_plate_readable", equals: true }, sourceRequirementId: evidence.requirementId,
          evidenceFor: ["baseline.product_plate_readable"], help: evidence.guidance.join(" ") },
        { ...blankField(`evidence.${evidence.requirementId}.manufacturer`, "Manufacturer document identifying the existing water heater", "Existing water heater", "before"),
          type: "document", condition: { fieldKey: "baseline.product_plate_readable", equals: false }, sourceRequirementId: evidence.requirementId,
          evidenceFor: ["baseline.product_plate_readable"], help: "Provide the manufacturer's product information when the existing compliance plate is unreadable." });
      continue;
    }
    if (candidate.programCode === "VEU" && candidate.activityCode === "6" && evidence.requirementId === "air-conditioner-photos") {
      const help = evidence.guidance.join(" ");
      const replacement: ActivityCondition = { fieldKey: "baseline.scenario", notEquals: "xi" };
      fields.push(
        { ...blankField("evidence.air-conditioner-existing", "Photograph the existing system before work, including its connections and readable product details", "Existing equipment", "before"),
          type: "photo", requireLocation: true, condition: replacement, sourceRequirementId: evidence.requirementId,
          evidenceFor: ["baseline.scenario", "baseline.brand", "baseline.model"], help },
        { ...blankField("evidence.air-conditioner-installed", "Photograph the installed system and readable product details", "Installed equipment", "after"),
          type: "photo", requireLocation: true, sourceRequirementId: evidence.requirementId,
          evidenceFor: ["installed_product.category", "installed_product.brand", "installed_product.model", "installed_product.serial_numbers"], help },
        { ...blankField("evidence.air-conditioner-decommissioned", "Photograph how the replaced system was permanently disabled or removed", "Existing equipment", "after"),
          type: "photo", requireLocation: true, condition: replacement, sourceRequirementId: evidence.requirementId,
          evidenceFor: ["baseline.decommissioning_method", "baseline.removed", "baseline.retained_reason"], help },
      );
      continue;
    }
    if (/signed_statement|signed_declaration|assignment|nomination/.test(`${evidence.kind} ${evidence.requirementId}`)) continue;
    if (/declaration|signature/i.test(evidence.label)) {
      reviewNotes.push(`Declaration purpose for Creditex review: ${evidence.label}. Field facts and the provider-authored confirmation are collected in this record; Creditex checks any prescribed wording or independent witness requirement before program submission.`);
      const documents = evidence.label.match(/CCEW|GCC|commissioning report|heat-load report|site map|risk assessment|signage evidence|licence receipt/gi) || [];
      if (!documents.length) continue;
      const placement = evidencePlacement(evidence.requirementId, evidence.label);
      appendCatalogueEvidence(fields, { ...blankField(`evidence.${evidence.requirementId}.supporting`, `${[...new Set(documents)].join(" / ")} supporting the work`, placement.section, placement.phase),
        type: "document", required: evidence.requiredCandidate && !/\bor\b/i.test(evidence.label), sourceRequirementId: evidence.requirementId,
        evidenceFor: placement.evidenceFor, condition: evidenceCondition(evidence.requirementId, fields), help: evidence.guidance.join(" ") });
      continue;
    }
    const placement = evidencePlacement(evidence.requirementId, evidence.label);
    appendCatalogueEvidence(fields, { ...blankField(`evidence.${evidence.requirementId}`, evidence.label, placement.section, placement.phase),
      type: /photo|image/.test(evidence.kind) ? "photo" : "document", required: evidence.requiredCandidate,
      sourceRequirementId: evidence.requirementId, evidenceFor: placement.evidenceFor, condition: evidenceCondition(evidence.requirementId, fields),
      requireLocation: /geotag/.test(`${evidence.kind} ${evidence.guidance.join(" ")}`),
      help: evidence.guidance.join(" ") });
  }
  if (!exact?.declarations.length) {
    reviewNotes.push(`Creditex-authored field declarations accompany the sourced ${candidate.activityCode} requirements. These collect field facts and authority to provide the record; they do not claim to replace any prescribed nomination or assignment needed for program-administrator submission.`);
  }
  if (!declarations.some((item) => item.role === "customer")) declarations.push({
    key: "creditex.customer.field_authorisation", title: "Customer authority to provide the field record", role: "customer", phase: "before", required: true,
    text: `I confirm that I am the customer or am authorised to act for the customer for the ${candidate.title} work described in this record. I authorise the trade business to provide the activity details, site evidence and this signed record to CREDITEX PTY LTD (ABN 76 105 513 040) so Creditex can assess participation in ${candidate.programCode} and contact me about any information or further declaration required. This authority does not itself assign certificate rights or agree to a certificate quantity or financial benefit.`,
    sourceUrl: "", sourceTextSha256: "",
  });
  if (NO_GENERIC_CUSTOMER_DOCUMENT_GATE_TEMPLATES.has(templateId)) {
    for (let index = fields.length - 1; index >= 0; index--) {
      if (isRedundantManualCustomerDocumentField(fields[index])) fields.splice(index, 1);
    }
  }
  if (documents.length) {
    for (let index = fields.length - 1; index >= 0; index--) {
      if (isRedundantManualCustomerDocumentField(fields[index])) fields.splice(index, 1);
    }
    const handouts = documents.map(({ title, url }) => ({ title, url }));
    const activityFactsheet = handouts.find((document) => /water heating|heating and cooling|heat.?pump/i.test(document.title));
    for (const field of fields) if (/factsheet/i.test(`${field.key} ${field.label}`)) field.referenceDocuments = activityFactsheet ? [activityFactsheet] : handouts;
    const receipts = derivedDeliveryFields(documents);
    const acceptedReceipt = receipts.find((field) => field.key === ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.providerAccepted);
    if (acceptedReceipt) acceptedReceipt.referenceDocuments = handouts;
    fields.unshift(...receipts);
  } else if (candidate.programCode.startsWith("NSW") && candidate.activityCode === "BESS5") {
    for (const field of fields) if (/factsheet/i.test(`${field.key} ${field.label}`)) {
      field.required = false;
      field.label = "Other customer information provided, if applicable";
      field.help = "Record the title and delivery details of any additional customer information provided.";
    }
  }
  if (!declarations.some((item) => item.role === "technician" && item.phase === "after")) declarations.push({
    key: "tlink.technician.field_record", title: "Technician field record confirmation", role: "technician", phase: "after", required: true,
    text: "I confirm that this field record describes the work I completed and the observations and evidence I collected. I have recorded any limitations and outstanding matters accurately. I authorise this record to be provided to CREDITEX PTY LTD for review.",
    sourceUrl: "", sourceTextSha256: "",
  });
  const signedArtifactPolicy = applyProgrammeSignedArtifactPolicy(fields, declarations, candidate, exact, reviewNotes);
  applySignedAssignmentEvidencePolicy(fields, templateId, reviewNotes);
  applySystemDerivedFieldPolicy(fields, candidate.programCode, candidate.activityCode, true);
  applyFieldWorkerPolicy(fields, templateId);
  const deduped = [...new Map(fields.filter((field) => !isSignatureTimestamp(field.key, field.autofill)).map((field) => [field.key, field])).values()];
  // References in official conditions must always have a collectable input.
  const dependencyFields: ActivityField[] = [];
  const resolveDependencies = (condition: ActivityCondition | undefined, stage: ActivityPhase) => {
    if (!condition) return;
    for (const child of [...(condition.all || []), ...(condition.any || [])]) resolveDependencies(child, stage);
    if (condition.fieldKey && !deduped.some((field) => field.key === condition.fieldKey)) {
      const dependency = dependencyFields.find((field) => field.key === condition.fieldKey);
      if (dependency) {
        if (stage === "before") dependency.phase = "before";
      } else {
        dependencyFields.push({ ...blankField(condition.fieldKey, human(condition.fieldKey), "Work scope", stage),
          help: "Record the actual circumstance. This controls which follow-up questions apply." });
      }
    }
  };
  for (const field of deduped) resolveDependencies(field.condition, field.phase);
  for (const declaration of declarations) resolveDependencies(declaration.condition, declaration.phase);
  const completedFields = ensureInstallerIdSelfie([...dependencyFields, ...deduped]);
  normaliseActivityFormConditions(completedFields, declarations);
  return { id: `field:${templateId}:${exact?.id || "source"}`, title: candidate.title, version: signedArtifactPolicy ? 3 : 1,
    activityTemplateId: templateId, programCode: candidate.programCode,
    variantId: exact?.id || "", variantOptions: exactForms.map((item) => ({ id: item.id, label: item.id.endsWith("business") ? "Business premises" : item.id.endsWith("residential") ? "Residential premises" : item.title })),
    fields: orderByPhaseAndSection(completedFields), declarations,
    sources: [...new Map([...candidate.sources.map((item) => ({ title: item.title, url: item.officialUrl, sha256: item.expectedSha256 || "" })), ...(exact?.sources || [])].map((item) => [item.url, item])).values()],
    reviewNotes: [...new Set(reviewNotes)],
  };
}

export function applyDefaultActivityFormPolicy(form: ActivityForm, baseline: ActivityForm): ActivityForm {
  if (form.activityTemplateId !== baseline.activityTemplateId || form.programCode !== baseline.programCode || form.variantId !== baseline.variantId) {
    throw new Error("ACTIVITY_FORM_POLICY_MISMATCH");
  }
  const baselineFields = new Map(baseline.fields.map((field) => [field.key, field]));
  const baselineInstallerSelfieKey = baseline.fields.find(isInstallerIdSelfieField)?.key || INSTALLER_ID_SELFIE_FIELD_KEY;
  const replacedRequirementIds = new Set(baseline.fields.map((field) => field.sourceRequirementId).filter(Boolean));
  const governedCustomerDocuments = baseline.fields.some((field) => field.key === ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.providerAccepted);
  const stripUnsupportedGenericCustomerDocuments = NO_GENERIC_CUSTOMER_DOCUMENT_GATE_TEMPLATES.has(baseline.activityTemplateId);
  const current = form.fields.filter((field) => !((governedCustomerDocuments || stripUnsupportedGenericCustomerDocuments) && isRedundantManualCustomerDocumentField(field))
    && !(["sres-ashp", "sres-swh"].includes(baseline.activityTemplateId) && ["account_holder", "nmi", "scope.bess2_or_differs_from_owner", "scope.nsw_certificate_or_grid_connected_sres_battery"].includes(field.key))
    && !isSignatureTimestamp(field.key, field.autofill)
    && !isRetiredFieldWorkerField(baseline.activityTemplateId, field)
    && (!isInstallerIdSelfieField(field) || field.key === baselineInstallerSelfieKey)
    && !(field.key === "evidence.air-conditioner-photos" && replacedRequirementIds.has("air-conditioner-photos")));
  const fields = current.map((field) => {
    const policy = baselineFields.get(field.key);
    if (policy?.sourceRequirementId || policy?.key === baselineInstallerSelfieKey
      || (policy && ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEY_SET.has(policy.key))) return structuredClone(policy);
    const governed: ActivityField = { ...field };
    if (policy?.approvedProduct) {
      governed.approvedProduct = structuredClone(policy.approvedProduct);
      governed.type = policy.type;
      governed.phase = policy.phase;
      governed.required = policy.required;
      governed.repeatGroup = policy.repeatGroup;
      delete governed.autofill;
      delete governed.presentation;
    } else if (policy?.presentation === "derived" || policy?.presentation === "prefilled") {
      governed.presentation = policy.presentation;
      governed.autofill = policy.autofill;
      governed.type = policy.type;
      governed.phase = policy.phase;
      governed.required = policy.required;
    } else {
      delete governed.autofill;
      delete governed.approvedProduct;
      delete governed.sourceRequirementId;
      delete governed.evidenceFor;
      if (governed.presentation === "derived" || governed.presentation === "prefilled") delete governed.presentation;
    }
    if (governed.type === "select") {
      governed.optionLabels = Object.fromEntries(governed.options.map((option) => [option,
        governed.optionLabels?.[option]?.trim() || policy?.optionLabels?.[option]?.trim() || optionLabel(option, governed.key)]));
    } else {
      delete governed.optionLabels;
    }
    if (governed.condition === undefined) delete governed.condition;
    if (governed.autofill === undefined) delete governed.autofill;
    return governed;
  });
  for (const policy of baseline.fields) {
    const controlled = policy.presentation === "derived" || policy.presentation === "prefilled"
      || Boolean(policy.approvedProduct)
      || policy.key === baselineInstallerSelfieKey
      || Boolean(policy.sourceRequirementId) || policy.requiredValue !== undefined;
    if (controlled && !fields.some((field) => field.key === policy.key)) fields.push(structuredClone(policy));
  }
  const baselineDeclarations = new Map(baseline.declarations.map((declaration) => [declaration.key, declaration]));
  const declarations = form.declarations.map((declaration) => {
    const policy = baselineDeclarations.get(declaration.key);
    if (!policy) return { ...declaration };
    if (policy.sourceUrl || policy.sourceTextSha256) return structuredClone(policy);
    const governed: ActivityDeclaration = { ...declaration, key: policy.key, role: policy.role, phase: policy.phase,
      required: policy.required, condition: policy.condition, sourceUrl: policy.sourceUrl, sourceTextSha256: policy.sourceTextSha256 };
    if (!governed.condition) delete governed.condition;
    return governed;
  });
  for (const policy of baseline.declarations) {
    if (!declarations.some((declaration) => declaration.key === policy.key)) declarations.push(structuredClone(policy));
  }
  const baselineSourceUrls = new Set(baseline.sources.map((source) => source.url));
  const baselineSourceTitles = new Set(baseline.sources.map((source) => source.title.trim().toLowerCase()));
  const addedSources = form.sources.filter((source) => !baselineSourceUrls.has(source.url)
    && !baselineSourceTitles.has(source.title.trim().toLowerCase()));
  const sources = [...baseline.sources.map((source) => structuredClone(source)),
    ...new Map(addedSources.map((source) => [source.url, source])).values()];
  normaliseActivityFormConditions(fields, declarations);
  return JSON.parse(JSON.stringify({ ...form, version: Math.max(form.version, baseline.version), fields: orderByPhaseAndSection(ensureInstallerIdSelfie(fields)), declarations, sources,
    reviewNotes: [...new Set([...form.reviewNotes, ...baseline.reviewNotes])] })) as ActivityForm;
}

export function activityFieldCatalogue() {
  return CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES.map((item) => ({ activityTemplateId: item.templateId, title: item.title,
    programCode: item.programCode, activityCode: item.activityCode, state: item.catalogueState }));
}

export type ActivityPrefillContext = {
  address: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerBusinessName?: string;
  customerBusinessNumber?: string;
  businessName: string;
  businessAddress?: string;
  businessPhone?: string;
  businessEmail?: string;
  technician: string;
  scheduledInstallationDate?: string;
  workerCredentials?: readonly { name: string; number: string; type: string; jurisdiction: string; gate: string }[];
  credentialNumbers?: Partial<Record<"electrician" | "licensed_plumber" | "registered_plumber" | "refrigerant_handler" | "installer" | "designer", string>>;
  credentialTypes?: Partial<Record<"installer" | "designer" | "connection", string>>;
};

function joined(...values: (string | undefined)[]) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].join(" | ");
}

function creditexAccreditation(programCode: string, activityCode: string) {
  const matches = creditexDeclarationProvider.accreditations.filter((item) => item.scheme === programCode);
  return matches.find((item) => item.activities.some((activity) => activity.toUpperCase() === activityCode.toUpperCase()))?.number
    || matches[0]?.number || "";
}

function sourcePrefill(field: ActivityField, context: ActivityPrefillContext) {
  const source = field.autofill || "";
  if (source === "job.appointment.date") return context.scheduledInstallationDate || "";
  if (source === "job.property.fullAddress") return context.address;
  if (source === "job.customer.name" || source === "job.customer.fullName") return context.customerName;
  if (source === "job.customer.email") return context.customerEmail;
  if (source === "job.customer.phone") return context.customerPhone;
  if (source === "job.customer.companyName") return context.customerBusinessName || "";
  if (source === "job.customer.abnOrAcn") return context.customerBusinessNumber || "";
  if (source === "job.customer.identity") return joined(context.customerName, context.customerBusinessName, context.customerBusinessNumber,
    context.customerEmail, context.customerPhone);
  if (source === "job.customer.authorisedSignatory.signatory_name") return context.customerName;
  if (source === "job.customer.authorisedSignatory.signatory_company") return context.customerBusinessName || "";
  if (source === "job.customer.authorisedSignatory.signatory_email") return context.customerEmail;
  if (source === "job.customer.authorisedSignatory.signatory_phone") return context.customerPhone;
  if (source === "job.trade.name") return context.businessName;
  if (source === "job.trade.address") return context.businessAddress || "";
  if (source === "job.trade.phone") return context.businessPhone || "";
  if (source === "job.trade.email") return context.businessEmail || "";
  if (source === "job.trade.identity") return joined(context.businessName, context.businessAddress, context.businessPhone, context.businessEmail);
  if (source === "job.assignee.fullName") return context.technician;
  if (source === "job.assignee.businessAndTechnician") return joined(context.businessName, context.technician);
  if (source === "job.assignee.profile") {
    const credentials = (context.workerCredentials || []).filter((item) => item.number && (
      (['licensed_electrician', 'licensed_plumber', 'refrigerant_handler'].includes(item.gate) && item.type === 'licence')
      || (item.gate === 'registered_plumber' && item.type === 'registration')
      || (['sres_installer_accreditation', 'sres_designer_accreditation'].includes(item.gate)
        && item.type === 'accreditation' && item.jurisdiction === 'NATIONAL')));
    if (!context.technician || !credentials.length) return "";
    const hasGate = (gate: string) => credentials.some((item) => item.gate === gate);
    if (['saa', 'battery_accreditation', 'wind_professionals', 'hydro_professionals'].includes(field.key)) {
      if (!['sres_installer_accreditation', 'sres_designer_accreditation', 'licensed_electrician'].every(hasGate)) return "";
      if (field.key === 'battery_accreditation' && !['sres_installer_accreditation', 'sres_designer_accreditation']
        .every((gate) => credentials.some((item) => item.gate === gate && /battery|batteries/i.test(item.name)))) return "";
    }
    if (['installer_licences', 'licensed_roles'].includes(field.key)
      && (!hasGate('licensed_electrician') || !(hasGate('licensed_plumber') || hasGate('registered_plumber')))) return "";
    return joined(`Assigned technician: ${context.technician}`, context.businessName, context.businessAddress,
      context.businessPhone, context.businessEmail,
      ...credentials.map((item) => `${item.name} (${item.type}, ${item.jurisdiction}): ${item.number}`));
  }
  const credentials = context.credentialNumbers || {};
  if (source === "job.credential.electrician") return credentials.electrician || "";
  if (source === "job.credential.licensed_plumber") return credentials.licensed_plumber || "";
  if (source === "job.credential.registered_plumber") return credentials.registered_plumber || "";
  if (source === "job.credential.refrigerant_handler") return credentials.refrigerant_handler || "";
  if (source === "job.credential.installer") return credentials.installer || "";
  if (source === "job.credential.designer") return credentials.designer || "";
  if (source === "job.credentialType.installer") return context.credentialTypes?.installer || "";
  if (source === "job.credentialType.designer") return context.credentialTypes?.designer || "";
  if (source === "job.credentialType.connection") return context.credentialTypes?.connection || "";
  if (source === "creditex.provider.legalName") return creditexDeclarationProvider.legalName;
  if (source === "creditex.provider.abn") return creditexDeclarationProvider.abn;
  if (source === "creditex.provider.email") return creditexDeclarationProvider.email;
  if (source === "creditex.provider.phone") return creditexDeclarationProvider.phone;
  if (source === "creditex.provider.contact") return joined(creditexDeclarationProvider.phone, creditexDeclarationProvider.email);
  if (source === "creditex.provider.identity") return joined(creditexDeclarationProvider.legalName, `ABN ${creditexDeclarationProvider.abn}`,
    creditexDeclarationProvider.phone, creditexDeclarationProvider.email);
  const accreditation = source.match(/^creditex\.provider\.accreditation\.([A-Z-]+)\.(.+)$/);
  if (accreditation) return creditexAccreditation(accreditation[1], accreditation[2]);
  return "";
}

export function activityPrefill(form: ActivityForm, context: ActivityPrefillContext) {
  const values: Record<string, string> = {};
  for (const field of form.fields) {
    const derived = sourcePrefill(field, context);
    if (derived) values[field.key] = derived;
  }
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => value
    && ["text", "date"].includes(form.fields.find((field) => field.key === key)?.type || "")));
}
