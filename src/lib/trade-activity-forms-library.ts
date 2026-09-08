import { CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES } from "../data/creditex-current-work-pack-content.ts";
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

export const ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS = {
  deliveryId: "delivery.booking_documents.delivery_id",
  providerAccepted: "delivery.booking_documents.provider_accepted",
  method: "delivery.booking_documents.method",
  acceptedAt: "delivery.booking_documents.accepted_at",
  recipient: "delivery.booking_documents.recipient",
  appointmentId: "delivery.booking_documents.appointment_id",
  documentIds: "delivery.booking_documents.document_ids",
  documentSha256Set: "delivery.booking_documents.document_sha256_set",
  packSha256: "delivery.booking_documents.pack_sha256",
} as const;
const ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEY_SET = new Set<string>(Object.values(ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS));

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

function creditexAccreditationSource(programCode: string, activityCode: string) {
  return `creditex.provider.accreditation.${programCode}.${activityCode}`;
}

function inferredAutofill(fieldKey: string, programCode = "", activityCode = "") {
  const exact: Record<string, string> = {
    customer: "job.customer.identity",
    participant_or_customer_identity: "job.customer.identity",
    "job-and-nomination:customer_or_capacity_holder": "job.customer.identity",
    system_owner_details: "job.customer.identity",
    consumer_details: "job.customer.identity",
    account_holder: "job.customer.fullName",
    owner: "job.customer.fullName",
    purchaser: "job.customer.fullName",
    signer: "job.customer.fullName",
    "holder.name": "job.customer.fullName",
    "holder.full_name": "job.customer.fullName",
    "holder.signer_name": "job.customer.fullName",
    "owner.full_name": "job.customer.fullName",
    "owner.signer_name": "job.customer.fullName",
    "binding.owner.full_name_or_legal_name": "job.customer.fullName",
    "owner.company_name": "job.customer.companyName",
    "holder.abn_acn": "job.customer.abnOrAcn",
    "owner.acn_abn": "job.customer.abnOrAcn",
    "owner.postal_address": "job.property.fullAddress",
    address: "job.property.fullAddress",
    site_identity_and_address: "job.property.fullAddress",
    "job-and-nomination:implementation_site": "job.property.fullAddress",
    "binding.installation.address": "job.property.fullAddress",
    "installation.address": "job.property.fullAddress",
    "installation.address_details": "job.property.fullAddress",
    "sites.address": "job.property.fullAddress",
    creditex_acp: "creditex.provider.identity",
    "job-and-nomination:creditex_acp_identity": "creditex.provider.identity",
    "creditex.nsw.legal_name": "creditex.provider.legalName",
    "creditex.sres.legal_name": "creditex.provider.legalName",
    "creditex.nsw.abn_acn": "creditex.provider.abn",
    "creditex.nsw.contact_name": "creditex.provider.legalName",
    "creditex.nsw.contact_email": "creditex.provider.email",
    "creditex.nsw.contact_phone": "creditex.provider.phone",
    "creditex.nsw.contact_phone_email": "creditex.provider.contact",
    "creditex.nsw.ess_accreditation_number": creditexAccreditationSource("NSW-ESS", activityCode),
    "creditex.nsw.pdrs_accreditation_number": creditexAccreditationSource("NSW-PDRS", activityCode),
    delivery_business_identity: "job.trade.identity",
    assigned_technician_identity: "job.assignee.fullName",
    "job-and-nomination:assigned_trade_and_technician": "job.assignee.businessAndTechnician",
    trade_business_and_assigned_technician: "job.assignee.businessAndTechnician",
    "binding.installer.full_name": "job.assignee.fullName",
    "installer.full_name": "job.assignee.fullName",
    "installer.signer_name": "job.assignee.fullName",
    "electrician.full_name": "job.assignee.fullName",
    "installer.company_name": "job.trade.name",
    "electrician.company_name": "job.trade.name",
    "installer.address": "job.trade.address",
    "electrician.address": "job.trade.address",
    "installer.phone": "job.trade.phone",
    "electrician.phone": "job.trade.phone",
    "installer.email": "job.trade.email",
    "electrician.email": "job.trade.email",
    "designer.full_name": "job.assignee.fullName",
    "designer.signer_name": "job.assignee.fullName",
    "binding.designer.full_name": "job.assignee.fullName",
    "designer.company_name": "job.trade.name",
    "designer.address": "job.trade.address",
    "designer.phone": "job.trade.phone",
    "designer.email": "job.trade.email",
    "installer.electrical_licence": "job.credential.electrician",
    "electrician.licence_number": "job.credential.electrician",
    "installer.accreditation_number": "job.credential.installer",
    "binding.installer.accreditation_number": "job.credential.installer",
    "designer.accreditation_number": "job.credential.designer",
    "binding.designer.accreditation_number": "job.credential.designer",
    "installer.accreditation_type": "job.credentialType.installer",
    "designer.accreditation_type": "job.credentialType.designer",
    "binding.designer.accreditation_type": "job.credentialType.designer",
    "binding.installation.accreditation_connection_type": "job.credentialType.connection",
  };
  if (exact[fieldKey]) return exact[fieldKey];
  const specialist = fieldKey.match(/^workers\.(electrician|licensed_plumber|registered_plumber|refrigerant_handler)\.(name|company_name|company_address|phone|licence_or_registration)$/);
  if (specialist) {
    const [, role, fact] = specialist;
    if (fact === "name") return "job.assignee.fullName";
    if (fact === "company_name") return "job.trade.name";
    if (fact === "company_address") return "job.trade.address";
    if (fact === "phone") return "job.trade.phone";
    return `job.credential.${role}`;
  }
  if (/^(?:binding\.)?(?:installer\.full_name|workers\.installer\.name|technician(?:\.name)?)$/.test(fieldKey)) return "job.assignee.fullName";
  if (/installation_address|installation_site|customer_property\.address|premises\.address/.test(fieldKey) && !/retailer|designer|installer/.test(fieldKey)) return "job.property.fullAddress";
  if (/customer.*(?:email)/.test(fieldKey) || /consumer.*(?:email)/.test(fieldKey)) return "job.customer.email";
  if (/customer.*(?:phone|mobile)/.test(fieldKey) || /consumer.*(?:phone|mobile)/.test(fieldKey)) return "job.customer.phone";
  if (/customer.*name|consumer.*name|owner\.full_name|holder\.full_name/.test(fieldKey)) return "job.customer.fullName";
  if (/trade_business_and_assigned_technician/.test(fieldKey)) return "job.assignee.businessAndTechnician";
  if (/^creditex\..*accreditation/.test(fieldKey)) return creditexAccreditationSource(programCode, activityCode);
  return "";
}

function isSupportedAutofill(source: string) {
  return /^(?:job\.property\.fullAddress|job\.customer\.(?:name|fullName|email|phone|companyName|abnOrAcn|identity)|job\.customer\.authorisedSignatory\.(?:signatory_name|signatory_company|signatory_email|signatory_phone)|job\.trade\.(?:name|address|phone|email|identity)|job\.assignee\.(?:fullName|businessAndTechnician)|job\.credential\.(?:electrician|licensed_plumber|registered_plumber|refrigerant_handler|installer|designer)|job\.credentialType\.(?:installer|designer|connection)|creditex\.provider\.(?:legalName|abn|email|phone|contact|identity|accreditation\.[A-Z-]+\..+))$/.test(source);
}

function isEditableRolePrefill(programCode: string, fieldKey: string) {
  return programCode === "SRES" && /^(?:binding\.)?(?:installer|designer|electrician)\./.test(fieldKey)
    || /^workers\.(?:electrician|licensed_plumber|registered_plumber|refrigerant_handler)\./.test(fieldKey);
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
  for (const field of fields) {
    const specialist = field.key.match(/^workers\.(electrician|licensed_plumber|registered_plumber|refrigerant_handler)\.(name|company_name|company_address|phone|licence_or_registration)$/);
    if (specialist) {
      const role = human(specialist[1]);
      const fact = specialist[2] === "licence_or_registration" ? "licence or registration number" : human(specialist[2]);
      field.label = `${role[0].toUpperCase()}${role.slice(1)} ${fact}`;
      field.help = [field.help, `Enter the ${fact} for the ${role} who performed this work.`].filter(Boolean).join(" ");
    }
    const suppliedAutofill = field.autofill || "";
    const autofill = isSupportedAutofill(suppliedAutofill) ? suppliedAutofill
      : inferredAutofill(field.key, candidate.programCode, candidate.activityCode);
    if (!autofill && ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEY_SET.has(field.key)) continue;
    if (autofill && isSupportedAutofill(autofill)) {
      field.autofill = autofill;
      field.presentation = isEditableRolePrefill(candidate.programCode, field.key) ? "prefilled" : "derived";
    } else if (field.autofill || field.presentation === "derived" || field.presentation === "prefilled") {
      delete field.autofill;
      delete field.presentation;
    }
  }
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
  const completedFields = [...dependencyFields, ...deduped];
  normaliseActivityFormConditions(completedFields, declarations);
  return { id: `field:${templateId}:${exact?.id || "source"}`, title: candidate.title, version: 1,
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
  const replacedRequirementIds = new Set(baseline.fields.map((field) => field.sourceRequirementId).filter(Boolean));
  const governedCustomerDocuments = baseline.fields.some((field) => field.key === ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS.providerAccepted);
  const stripUnsupportedGenericCustomerDocuments = NO_GENERIC_CUSTOMER_DOCUMENT_GATE_TEMPLATES.has(baseline.activityTemplateId);
  const current = form.fields.filter((field) => !((governedCustomerDocuments || stripUnsupportedGenericCustomerDocuments) && isRedundantManualCustomerDocumentField(field))
    && !isSignatureTimestamp(field.key, field.autofill)
    && !(field.key === "evidence.air-conditioner-photos" && replacedRequirementIds.has("air-conditioner-photos")));
  const fields = current.map((field) => {
    const policy = baselineFields.get(field.key);
    if (policy?.sourceRequirementId || (policy && ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEY_SET.has(policy.key))) return structuredClone(policy);
    const governed: ActivityField = { ...field };
    if (policy?.presentation === "derived" || policy?.presentation === "prefilled") {
      governed.presentation = policy.presentation;
      governed.autofill = policy.autofill;
      governed.type = policy.type;
      governed.phase = policy.phase;
      governed.required = policy.required;
    } else {
      delete governed.autofill;
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
  return JSON.parse(JSON.stringify({ ...form, fields: orderByPhaseAndSection(fields), declarations, sources })) as ActivityForm;
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
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => value && form.fields.find((field) => field.key === key)?.type === "text"));
}
