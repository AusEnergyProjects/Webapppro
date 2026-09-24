import { CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES } from "../data/creditex-current-work-pack-content.ts";
import type { ActivityField, ActivityForm } from "./trade-activity-form-types";

const human = (value: string) => value.replaceAll("_", " ").replaceAll(".", " ");
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
export const ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEY_SET = new Set<string>(Object.values(ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEYS));

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
    "holder.email": "job.customer.email",
    "holder.phone": "job.customer.phone",
    "owner.full_name": "job.customer.fullName",
    "owner.signer_name": "job.customer.fullName",
    "owner.email": "job.customer.email",
    "owner.phone": "job.customer.phone",
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
    installers: "job.assignee.profile",
    saa: "job.assignee.profile",
    battery_accreditation: "job.assignee.profile",
    installer_licences: "job.assignee.profile",
    licensed_roles: "job.assignee.profile",
    installer_details_company_and_licences: "job.assignee.profile",
    wind_professionals: "job.assignee.profile",
    hydro_professionals: "job.assignee.profile",
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
    "installation.date": "job.appointment.date",
    "customer_property.installation_date": "job.appointment.date",
  };
  if (exact[fieldKey]) return exact[fieldKey];
  if (fieldKey === "implementation_date" || fieldKey === "installation_date" || /\.installation_date$/.test(fieldKey)) {
    return "job.appointment.date";
  }
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
  if (source === "job.assignee.profile") return true;
  return /^(?:job\.appointment\.date|job\.property\.fullAddress|job\.customer\.(?:name|fullName|email|phone|companyName|abnOrAcn|identity)|job\.customer\.authorisedSignatory\.(?:signatory_name|signatory_company|signatory_email|signatory_phone)|job\.trade\.(?:name|address|phone|email|identity)|job\.assignee\.(?:fullName|businessAndTechnician)|job\.credential\.(?:electrician|licensed_plumber|registered_plumber|refrigerant_handler|installer|designer)|job\.credentialType\.(?:installer|designer|connection)|creditex\.provider\.(?:legalName|abn|email|phone|contact|identity|accreditation\.[A-Z-]+\..+))$/.test(source);
}

const OFFICE_WORKFLOW_FIELD_KEYS = new Set([
  "activity_delivery_record",
  "external_outcome_contract",
  "nomination_delivery",
  "nomination_copy",
  "local_signal_eligible_cost_aud",
  "local_signal_eligible_cost_ex_gst_aud",
  "pv_funding_evidence",
  "consumer_checks.bpc_received",
  "consumer_checks.coes_received",
  "consumer_checks.certificate_delivery_informed",
]);

const OFFICE_PROVIDER_PARTY_FIELD_KEYS = new Set([
  "retailer.legal_name",
  "retailer.abn",
  "retailer.representative_name",
  "retailer.representative_position",
  "retailer.signer_name",
  "binding.retailer.legal_name",
  "binding.retailer.abn",
  "binding.retailer.representative_name",
  "dra",
  "dra.legal_name",
  "dra.abn_acn",
  "dra.contact_phone_email",
  "dra.customer_support_access",
  "dra.same_as_creditex",
  "binding.dra.legal_name",
  "binding.dra.abn",
  "vpp.controller.legal_name",
  "vpp.controller.abn",
  "binding.vpp.controller.legal_name",
  "binding.vpp.controller.abn",
]);

function isOfficeCommercialField(field: ActivityField) {
  const source = `${field.key} ${field.label} ${field.sourceRequirementId || ""}`;
  return OFFICE_WORKFLOW_FIELD_KEYS.has(field.key)
    || OFFICE_PROVIDER_PARTY_FIELD_KEYS.has(field.key)
    || field.key === "assignment" || field.key.startsWith("assignment.")
    || field.key === "compliance_certificate" || field.key.startsWith("certificates.")
    || /^evidence\..+-external-outcome-receipt$/.test(field.key)
    || field.key === "value_required_in_assignment_or_linked_invoice"
    || field.key.startsWith("benefit_payment.")
    || /(?:^|[._:-])(?:invoice|payment|price|benefit|co_?payment)(?:$|[._:-])/i.test(field.key)
    || /\b(?:invoice|proof of purchase|certificate benefit|consumer payment|price including gst|amount actually paid)\b/i.test(source);
}

export function applySystemDerivedFieldPolicy(fields: ActivityField[], programCode: string, activityCode: string, clearUnsupported = false) {
  for (const field of fields) {
    const specialist = field.key.match(/^workers\.(electrician|licensed_plumber|registered_plumber|refrigerant_handler)\.(name|company_name|company_address|phone|licence_or_registration)$/);
    if (specialist) {
      const role = human(specialist[1]);
      const fact = specialist[2] === "licence_or_registration" ? "licence or registration number" : human(specialist[2]);
      field.label = `${role[0].toUpperCase()}${role.slice(1)} ${fact}`;
      field.help = "Filled from the assigned team member and business profile.";
    }
    const suppliedAutofill = field.autofill || "";
    const autofill = isSupportedAutofill(suppliedAutofill) ? suppliedAutofill
      : inferredAutofill(field.key, programCode, activityCode);
    if (!autofill && ACTIVITY_BOOKING_DOCUMENT_RECEIPT_KEY_SET.has(field.key)) continue;
    if (autofill && isSupportedAutofill(autofill)) {
      field.autofill = autofill;
      field.presentation = "derived";
    } else if (clearUnsupported && (field.autofill || field.presentation === "derived" || field.presentation === "prefilled")) {
      delete field.autofill;
      delete field.presentation;
    }
  }
}

const ACTIVITY_APPROVED_PRODUCT_SELECTORS = {
  "veu-3": { productKind: "veu_water_heater", veuActivityCodes: ["3C", "3D"] },
  "veu-6": { productKind: "veu_air_conditioner", veuActivityCodes: ["6"] },
} as const;

export function activityApprovedProductContract(templateId: string) {
  const contract = ACTIVITY_APPROVED_PRODUCT_SELECTORS[templateId as keyof typeof ACTIVITY_APPROVED_PRODUCT_SELECTORS];
  return contract ? { productKind: contract.productKind, veuActivityCodes: [...contract.veuActivityCodes] } : null;
}
const RETIRED_ACTIVITY_3_PRODUCT_FIELDS = new Set([
  "installed_product.heat_pump_model",
  "installed_product.tank_model",
]);

export function isRetiredFieldWorkerField(templateId: string, field: Pick<ActivityField, "key">) {
  return templateId === "veu-3" && RETIRED_ACTIVITY_3_PRODUCT_FIELDS.has(field.key);
}

export function applyFieldWorkerPolicy(fields: ActivityField[], templateId: string) {
  for (let index = fields.length - 1; index >= 0; index--) {
    if (isRetiredFieldWorkerField(templateId, fields[index])) fields.splice(index, 1);
  }
  for (const field of fields) {
    if (isOfficeCommercialField(field)) {
      field.presentation = "derived";
      delete field.autofill;
      field.help = "Completed from the TLink quote, invoice or Creditex calculation outside the installer workflow.";
    }
  }
  const productSelector = ACTIVITY_APPROVED_PRODUCT_SELECTORS[templateId as keyof typeof ACTIVITY_APPROVED_PRODUCT_SELECTORS];
  if (!productSelector) return;
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const brand = byKey.get("installed_product.brand");
  if (brand) {
    brand.label = "Approved brand";
    brand.help = "Choose from the current VEU approved-product register.";
    brand.type = "text";
    delete brand.autofill;
    delete brand.presentation;
    brand.approvedProduct = { role: "brand", productKind: productSelector.productKind,
      veuActivityCodes: [...productSelector.veuActivityCodes] };
  }
  const model = byKey.get("installed_product.model");
  if (model) {
    model.label = "Approved model";
    model.help = "Choose an approved model for the selected brand.";
    model.type = "text";
    delete model.autofill;
    delete model.presentation;
    model.approvedProduct = { role: "model", productKind: productSelector.productKind,
      veuActivityCodes: [...productSelector.veuActivityCodes], brandFieldKey: "installed_product.brand" };
  }
  const serial = byKey.get("installed_product.serial_numbers");
  if (serial) {
    serial.label = "Serial number";
    serial.help = "Enter the serial number shown on this installed unit.";
  }
  const category = byKey.get("installed_product.category");
  if (category) {
    category.presentation = "derived";
    delete category.autofill;
    category.help = "Resolved from the approved product selected in TLink.";
  }
  const systemSize = byKey.get("installed_product.system_size");
  if (systemSize) {
    systemSize.presentation = "derived";
    delete systemSize.autofill;
    systemSize.help = "Resolved from the approved product selected in TLink.";
  }
  if (templateId !== "veu-6") return;
  const heating = byKey.get("installed_product.indoor_heating_kw");
  if (heating) {
    heating.label = "Total installed heating capacity (kW)";
    heating.help = "Enter the combined installed heating capacity.";
    delete heating.condition;
  }
  const cooling = byKey.get("installed_product.indoor_cooling_kw");
  if (cooling) {
    cooling.label = "Total installed cooling capacity (kW)";
    cooling.help = "Enter the combined installed cooling capacity.";
    delete cooling.condition;
  }
  const sameOem = byKey.get("installed_product.same_oem");
  if (sameOem) {
    sameOem.presentation = "derived";
    delete sameOem.autofill;
    sameOem.help = "Resolved from the approved product selection during Creditex review.";
  }
}

/** Applies the current field-worker visibility policy without changing the stored governed form. */
export function activityFieldWorkerForm(form: ActivityForm): ActivityForm {
  const fields = form.fields.map((field) => ({ ...field }));
  const activityCode = CREDITEX_CURRENT_WORK_PACK_CONTENT_CANDIDATES.find((item) => item.templateId === form.activityTemplateId)?.activityCode || "";
  applySystemDerivedFieldPolicy(fields, form.programCode, activityCode);
  applyFieldWorkerPolicy(fields, form.activityTemplateId);
  return { ...form, fields };
}
