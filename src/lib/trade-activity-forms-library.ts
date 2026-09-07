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
  if (source.includes("||")) {
    const parts = source.split("||").map((part) => compileCondition(part, fields, stage, programCode, activityCode));
    return parts.some((part) => !part) ? undefined : { any: parts.filter((part): part is ActivityCondition => Boolean(part)) };
  }
  if (source.includes("&&")) return { all: source.split("&&").map((part) => compileCondition(part, fields, stage, programCode, activityCode)!).filter(Boolean) };
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

export function defaultActivityFieldForm(templateId: string, variantId = ""): ActivityForm {
  const candidate = CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES.find((item) => item.templateId === templateId);
  if (!candidate) throw new Error("ACTIVITY_FORM_UNAVAILABLE");
  const sourceForms = creditexStatutorySourceLibrary();
  const exactForms = sourceForms.filter((item) => item.program === candidate.programCode && (candidate.programCode === "VEU"
    ? item.activity.startsWith(`Part ${candidate.activityCode.replace(/[^0-9].*$/, "")} |`)
    : item.activity.toUpperCase() === candidate.activityCode.toUpperCase()));
  const exact = variantId ? exactForms.find((item) => item.id === variantId)
    : exactForms.find((item) => item.id.endsWith("residential")) || exactForms[0];
  if (variantId && !exact) throw new Error("ACTIVITY_FORM_VARIANT_INVALID");
  const fields: ActivityField[] = [];
  const declarations: ActivityDeclaration[] = [];
  const reviewNotes = [...(exact?.authoringRequirements || [])];
  const rawVeu = veuSourceForms.find((item) => item.id === exact?.id);
  if (exact) {
    for (const group of exact.groups) for (const item of group.fields) {
      if (/signature|signed_at|signedAt|date_signed|declaration\.date/i.test(item.key) || item.type === "signature") continue;
      if (candidate.programCode === "SRES" && /stc_count|certificate.*quantity|certificate.*number|deeming_years/.test(item.key)) continue;
      const raw = rawVeu?.groups.flatMap((value) => value.prompts).find((value) => value.key === item.key);
      let stage = phase(group.timing);
      if (!rawVeu && /customer|consumer|holder|nomination|workers|scope|baseline|sizing/.test(item.key) && !/installation_date|onboarded|benefit|signed/.test(item.key)) stage = "before";
      if (/installation_date|^installation\.date$/.test(item.key)) stage = "after";
      const rawOptions = raw?.options || item.options;
      const options = rawOptions.map((option) => typeof option === "string" ? option : option.value || option.label);
      const condition = compileCondition(item.condition, fields, stage, candidate.programCode, candidate.activityCode);
      const fieldKey = item.key.replaceAll("[]", "");
      if (fields.some((field) => field.key === fieldKey)) continue;
      fields.push({ ...blankField(fieldKey, item.label, group.title, stage), type: typeOf(item.type, item.label, options), options,
        help: raw?.implementationNote || "", condition,
        ...(raw?.repeatFor ? { repeatGroup: raw.repeatFor } : item.key.includes("[]") ? { repeatGroup: `${item.key.split("[]")[0]}[]` } : {}),
        ...(raw?.autofillFrom ? { autofill: raw.autofillFrom } : {}),
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
  for (const evidence of candidate.evidenceRequirements) {
    if (candidate.programCode === "VEU" && candidate.activityCode === "44" && evidence.requirementId === "ci-water-heater-existing-product") {
      fields.push({ ...blankField("baseline.product_plate_readable", "Can the existing water heater's compliance plate be read?", "Existing water heater", "before"), type: "boolean" },
        { ...blankField(`evidence.${evidence.requirementId}`, "Photograph the existing water heater's readable compliance plate", "Existing water heater", "before"),
          type: "photo", requireLocation: true, condition: { fieldKey: "baseline.product_plate_readable", equals: true }, help: evidence.guidance.join(" ") },
        { ...blankField(`evidence.${evidence.requirementId}.manufacturer`, "Manufacturer document identifying the existing water heater", "Existing water heater", "before"),
          type: "document", condition: { fieldKey: "baseline.product_plate_readable", equals: false }, help: "Provide the manufacturer's product information when the existing compliance plate is unreadable." });
      continue;
    }
    if (/signed_statement|signed_declaration|assignment|nomination/.test(`${evidence.kind} ${evidence.requirementId}`)) continue;
    if (/declaration|signature/i.test(evidence.label)) {
      reviewNotes.push(`Declaration purpose for Creditex review: ${evidence.label}. Field facts and the provider-authored confirmation are collected in this record; Creditex checks any prescribed wording or independent witness requirement before program submission.`);
      const documents = evidence.label.match(/CCEW|GCC|commissioning report|heat-load report|site map|risk assessment|signage evidence|licence receipt/gi) || [];
      if (!documents.length) continue;
      fields.push({ ...blankField(`evidence.${evidence.requirementId}.supporting`, `${[...new Set(documents)].join(" / ")} supporting the work`, "Supporting work documents", "after"),
        type: "document", required: evidence.requiredCandidate && !/\bor\b/i.test(evidence.label), help: evidence.guidance.join(" ") });
      continue;
    }
    fields.push({ ...blankField(`evidence.${evidence.requirementId}`, evidence.label, "Evidence", phase(`${evidence.requirementId} ${evidence.label}`)),
      type: /photo|image/.test(evidence.kind) ? "photo" : "document", required: evidence.requiredCandidate,
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
  if (candidate.programCode === "VEU") {
    const factsheet = "https://www.energy.vic.gov.au/__data/assets/pdf_file/0028/585154/Victorian-Energy-Efficiency-Target-scheme-consumer-factsheet.pdf";
    const handouts = [{ title: "VEU consumer factsheet (PDF)", url: factsheet },
      { title: "Creditex Statement of Rights (PDF)", url: "/api/trade-activity-forms?consumerDocument=veu-rights-v1" }];
    const sizing = /^(1|3)/.test(candidate.activityCode)
      ? { title: "VEU water heating consumer factsheet (PDF)", url: "https://www.energy.vic.gov.au/__data/assets/pdf_file/0018/710280/VEU-water-heating-consumer-factsheet.pdf" }
      : /^6/.test(candidate.activityCode)
        ? { title: "VEU heating and cooling consumer factsheet (PDF)", url: "https://www.energy.vic.gov.au/__data/assets/pdf_file/0027/712809/VEU-space-heating-and-cooling-consumer-factsheet.pdf" } : null;
    if (sizing && !exact?.id.endsWith("business")) handouts.push(sizing);
    for (const field of fields) if (/factsheet/i.test(`${field.key} ${field.label}`)) field.referenceDocuments = sizing ? [sizing] : handouts;
    fields.unshift({ ...blankField("disclosures.veu_factsheet_given", "Has the customer received the VEU consumer factsheet before agreeing to the upgrade?", "Customer information", "before"),
      type: "boolean", requiredValue: true, referenceDocuments: handouts,
      help: "Open the documents below and give the customer copies before agreement. Opening a document does not record delivery." },
    { ...blankField("disclosures.veu_rights_given", "Has the customer received the Creditex Statement of Rights?", "Customer information", "before"), type: "boolean", requiredValue: true,
      referenceDocuments: [handouts[1]], help: "Provide this before the customer enters the upgrade contract." },
    { ...blankField("disclosures.veu_factsheet_method", "How were the customer documents provided?", "Customer information", "before"), type: "select", options: ["Shown and copy provided", "Printed copy", "Email", "SMS link"] },
    { ...blankField("disclosures.veu_factsheet_time", "When were the customer documents provided?", "Customer information", "before"), help: "Record the actual date and time, before the customer agreed to the upgrade." });
  } else if (candidate.programCode.startsWith("NSW")) {
    const sourceId = /^BESS[1-4]$/.test(candidate.activityCode) ? `${candidate.activityCode.toLowerCase()}_facts`
      : /^(D17|D19|WH1)$/.test(candidate.activityCode) ? "heer_hw_facts"
        : candidate.programCode === "NSW-ESS" && /^D\d/.test(candidate.activityCode) ? "heer_facts" : "";
    const factsheet = national.sources.find((item) => item.id === sourceId);
    for (const field of fields) if (/factsheet/i.test(`${field.key} ${field.label}`)) {
      if (factsheet) {
        field.referenceDocuments = [{ title: `${factsheet.title} (PDF)`, url: factsheet.url }];
        field.phase = "before";
        field.help = "Open and give the customer this document before agreement. Record the actual delivery method and date/time; opening alone does not confirm delivery.";
      } else if (candidate.activityCode === "BESS5") {
        field.required = false;
        field.label = "Other customer information provided, if applicable";
        field.help = "Record the title and delivery details of any additional customer information provided.";
      }
    }
  }
  if (!declarations.some((item) => item.role === "technician" && item.phase === "after")) declarations.push({
    key: "tlink.technician.field_record", title: "Technician field record confirmation", role: "technician", phase: "after", required: true,
    text: "I confirm that this field record describes the work I completed and the observations and evidence I collected. I have recorded any limitations and outstanding matters accurately. I authorise this record to be provided to CREDITEX PTY LTD for review.",
    sourceUrl: "", sourceTextSha256: "",
  });
  const deduped = [...new Map(fields.map((field) => [field.key, field])).values()];
  // References in official conditions must always have a collectable input.
  const dependencyFields: ActivityField[] = [];
  const resolveDependencies = (condition: ActivityCondition | undefined, stage: ActivityPhase) => {
    if (!condition) return;
    for (const child of [...(condition.all || []), ...(condition.any || [])]) resolveDependencies(child, stage);
    if (condition.fieldKey && !deduped.some((field) => field.key === condition.fieldKey) && !dependencyFields.some((field) => field.key === condition.fieldKey)) {
      dependencyFields.push({ ...blankField(condition.fieldKey, human(condition.fieldKey), "Work scope", stage),
        help: "Record the actual circumstance. This controls which follow-up questions apply." });
    }
  };
  for (const field of deduped) resolveDependencies(field.condition, field.phase);
  for (const declaration of declarations) resolveDependencies(declaration.condition, declaration.phase);
  return { id: `field:${templateId}:${exact?.id || "source"}`, title: candidate.title, version: 1,
    activityTemplateId: templateId, programCode: candidate.programCode,
    variantId: exact?.id || "", variantOptions: exactForms.map((item) => ({ id: item.id, label: item.id.endsWith("business") ? "Business premises" : item.id.endsWith("residential") ? "Residential premises" : item.title })),
    fields: [...dependencyFields, ...deduped].sort((a, b) => (a.phase === "before" ? 0 : 1) - (b.phase === "before" ? 0 : 1)), declarations,
    sources: [...new Map([...candidate.sources.map((item) => ({ title: item.title, url: item.officialUrl, sha256: item.expectedSha256 || "" })), ...(exact?.sources || [])].map((item) => [item.url, item])).values()],
    reviewNotes: [...new Set(reviewNotes)],
  };
}

export function activityFieldCatalogue() {
  return CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES.map((item) => ({ activityTemplateId: item.templateId, title: item.title,
    programCode: item.programCode, activityCode: item.activityCode, state: item.catalogueState }));
}

export function activityPrefill(form: ActivityForm, context: { address: string; customerName: string; customerEmail: string; customerPhone: string; businessName: string; technician: string }) {
  const values: Record<string, string> = {};
  for (const field of form.fields) {
    if (/creditex.*(name|person)|accredited_person/.test(field.key)) values[field.key] = creditexDeclarationProvider.legalName;
    else if (/installation_address|installation_site|\.address$/.test(field.key) && !/retailer|designer|installer/.test(field.key)) values[field.key] = context.address;
    else if (/system_owner_details|consumer_details/.test(field.key)) values[field.key] = [context.customerName, context.customerEmail, context.customerPhone].filter(Boolean).join(" | ");
    else if (/customer.*name|consumer.*name|owner\.full_name|holder\.full_name/.test(field.key)) values[field.key] = context.customerName;
    else if (/customer.*email|consumer.*email/.test(field.key)) values[field.key] = context.customerEmail;
    else if (/customer.*(phone|mobile)|consumer.*(phone|mobile)/.test(field.key)) values[field.key] = context.customerPhone;
    else if (/trade_business_and_assigned_technician/.test(field.key)) values[field.key] = `${context.businessName} | ${context.technician}`;
    else if (/workers\..*company_name/.test(field.key)) values[field.key] = context.businessName;
  }
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => value && form.fields.find((field) => field.key === key)?.type === "text"));
}
