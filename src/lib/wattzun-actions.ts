import { WattzunInputError } from "./wattzun-portal.ts";

export type WattzunActionLine = {
  lineType: "product" | "labour";
  description: string;
  quantity: string | null;
  unitPrice: string | null;
  taxCode: "gst" | "none" | null;
};
export type WattzunActionProposal = {
  kind: "prepare_quote" | "create_customer";
  firstName: string; lastName: string; email: string; phone: string; addressQuery: string;
  serviceCategory: string; description: string; lines: WattzunActionLine[];
};
export type WattzunActionAddress = {
  addressLine1: string; addressLine2: string; suburb: string; addressState: string; postcode: string;
  addressProvider: "google-places" | "google-geocoding";
  addressProviderReference: string; addressFormatted: string; addressSelectionProof: string;
};
export type WattzunConfirmedAction = {
  portal: "trade"; scopeId: string; requestId: string;
  action: WattzunActionProposal & {
    customerMode: "new" | "existing"; customerId: string; serviceSiteId: string; customerName: string;
    address: WattzunActionAddress;
  };
  confirmation: { reviewed: true; name: string; address: string };
};
export type WattzunActionReceipt = {
  kind: "quote_draft" | "customer"; id: string; href: string; label: string;
  workOrderId?: string; versionId?: string;
};

const proposalKeys = ["kind", "firstName", "lastName", "email", "phone", "addressQuery", "serviceCategory", "description", "lines"];
const limits = { firstName: 80, lastName: 80, email: 180, phone: 40, addressQuery: 300, serviceCategory: 60, description: 3000 } as const;
const lineSchema = {
  type: "object", additionalProperties: false,
  required: ["lineType", "description", "quantity", "unitPrice", "taxCode"],
  properties: {
    lineType: { type: "string", enum: ["product", "labour"] }, description: { type: "string", maxLength: 500 },
    quantity: { type: ["string", "null"], maxLength: 20 }, unitPrice: { type: ["string", "null"], maxLength: 20 },
    taxCode: { type: ["string", "null"], enum: ["gst", "none", null] },
  },
};
export const WATTZUN_ACTION_PROPOSAL_SCHEMA = {
  type: "object", additionalProperties: false, required: proposalKeys,
  properties: {
    kind: { type: "string", enum: ["prepare_quote", "create_customer"] },
    ...Object.fromEntries(Object.entries(limits).map(([key, maxLength]) => [key, { type: "string", maxLength }])),
    lines: { type: "array", maxItems: 30, items: lineSchema },
  },
};
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, maximum: number, multiline = false): string | null {
  const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
  return typeof value === "string" && value.length <= maximum && !controls.test(value)
    ? value.trim() : null;
}
function readWattzunActionProposal(value: unknown): WattzunActionProposal | null {
  if (!record(value) || Object.keys(value).some(key => !proposalKeys.includes(key))
    || !(value.kind === "prepare_quote" || value.kind === "create_customer")) return null;
  const fields = {
    firstName: text(value.firstName, limits.firstName), lastName: text(value.lastName, limits.lastName),
    email: text(value.email, limits.email), phone: text(value.phone, limits.phone),
    addressQuery: text(value.addressQuery, limits.addressQuery), serviceCategory: text(value.serviceCategory, limits.serviceCategory),
    description: text(value.description, limits.description, true),
  };
  if (Object.values(fields).some(field => field === null) || !Array.isArray(value.lines) || value.lines.length > 30) return null;
  const lines: WattzunActionLine[] = [];
  for (const input of value.lines) {
    if (!record(input) || Object.keys(input).some(key => !["lineType", "description", "quantity", "unitPrice", "taxCode"].includes(key))
      || !(input.lineType === "product" || input.lineType === "labour") || !(input.taxCode === "gst" || input.taxCode === "none" || input.taxCode === null)) return null;
    const description = text(input.description, 500);
    const quantity = input.quantity === null ? null : text(input.quantity, 20);
    const unitPrice = input.unitPrice === null ? null : text(input.unitPrice, 20);
    if (description === null || (input.quantity !== null && quantity === null) || (input.unitPrice !== null && unitPrice === null)) return null;
    lines.push({ lineType: input.lineType, description, quantity, unitPrice, taxCode: input.taxCode });
  }
  // Explicit assignments keep the runtime validation and the public interface aligned.
  if (fields.firstName === null || fields.lastName === null || fields.email === null || fields.phone === null
    || fields.addressQuery === null || fields.serviceCategory === null || fields.description === null) return null;
  return { kind: value.kind, firstName: fields.firstName, lastName: fields.lastName, email: fields.email, phone: fields.phone,
    addressQuery: fields.addressQuery, serviceCategory: fields.serviceCategory, description: fields.description, lines };
}
export function parseWattzunActionProposal(value: unknown): WattzunActionProposal {
  const proposal = readWattzunActionProposal(value);
  if (!proposal) throw new WattzunInputError("This proposed action could not be read. Ask Wattzun to prepare it again.");
  return proposal;
}

function required(value: unknown, maximum: number, message: string) {
  const result = text(value, maximum);
  if (result === null || !result) throw new WattzunInputError(message);
  return result;
}
export function wattzunActionName(action: Pick<WattzunActionProposal, "firstName" | "lastName">) {
  return [action.firstName, action.lastName].filter(Boolean).join(" ");
}
export function parseWattzunConfirmedAction(value: unknown): WattzunConfirmedAction {
  if (!record(value) || Object.keys(value).some(key => !["portal", "scopeId", "requestId", "action", "confirmation"].includes(key))
    || value.portal !== "trade" || typeof value.scopeId !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/.test(value.scopeId)
    || typeof value.requestId !== "string" || !/^[A-Za-z0-9_-]{16,72}$/.test(value.requestId)
    || !record(value.action) || !record(value.confirmation)) throw new WattzunInputError("Review this action in your TLink workspace first.");
  const input = value.action;
  if (Object.keys(input).some(key => ![...proposalKeys, "customerMode", "customerId", "serviceSiteId", "customerName", "address"].includes(key))) {
    throw new WattzunInputError("This action contains unsupported fields. Review it again.");
  }
  const proposal = readWattzunActionProposal(Object.fromEntries(proposalKeys.map(key => [key, input[key]])));
  if (!proposal || !(input.customerMode === "new" || input.customerMode === "existing")
    || !record(input.address)) throw new WattzunInputError("Add the exact customer name and choose a Google address.");
  if (proposal.kind === "create_customer" && input.customerMode !== "new") throw new WattzunInputError("This customer already exists. Open their saved record.");
  const customerId = text(input.customerId, 180), serviceSiteId = text(input.serviceSiteId, 180);
  const customerName = required(input.customerName, 180, "Confirm the customer's exact name.");
  if (customerId === null || serviceSiteId === null || (input.customerMode === "existing" && (!customerId || !serviceSiteId))
    || (input.customerMode === "new" && (customerId || serviceSiteId || customerName !== wattzunActionName(proposal)))) throw new WattzunInputError("Choose the exact customer and property.");
  const address = input.address;
  if (Object.keys(address).some(key => !["addressLine1", "addressLine2", "suburb", "addressState", "postcode", "addressProvider", "addressProviderReference", "addressFormatted", "addressSelectionProof"].includes(key))
    || !(address.addressProvider === "google-places" || address.addressProvider === "google-geocoding")) {
    throw new WattzunInputError("Choose a real Google street address before continuing.");
  }
  const optionalLine2 = text(address.addressLine2, 140);
  if (optionalLine2 === null) throw new WattzunInputError("Review the unit or second address line.");
  const parsedAddress: WattzunActionAddress = {
    addressLine1: required(address.addressLine1, 140, "Select a Google street address."), addressLine2: optionalLine2,
    suburb: required(address.suburb, 80, "Choose the address suburb."), addressState: required(address.addressState, 10, "Choose the address state."),
    postcode: required(address.postcode, 12, "Choose the address postcode."), addressProvider: address.addressProvider,
    addressProviderReference: required(address.addressProviderReference, 180, "Select a Google address result."),
    addressFormatted: required(address.addressFormatted, 300, "Select a Google address result."),
    addressSelectionProof: required(address.addressSelectionProof, 5000, "Select a Google address result again."),
  };
  if (Object.keys(value.confirmation).some(key => !["reviewed", "name", "address"].includes(key))
    || value.confirmation.reviewed !== true || value.confirmation.name !== customerName
    || value.confirmation.address !== parsedAddress.addressFormatted) {
    throw new WattzunInputError("Confirm the exact name spelling, selected address and reviewed details before saving.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(proposal.email) || proposal.phone.replace(/\D/g, "").length < 8) {
    throw new WattzunInputError("Add a valid customer email and mobile number.");
  }
  if (proposal.kind === "prepare_quote" && (!proposal.serviceCategory || !proposal.description || !proposal.lines.length
    || proposal.lines.some(line => !line.description || !line.quantity || line.unitPrice === null || line.unitPrice === "" || line.taxCode === null))) {
    throw new WattzunInputError("Complete the quote scope, quantities, prices and GST treatment before saving a draft.");
  }
  if (proposal.kind === "create_customer" && (proposal.lines.length || proposal.serviceCategory || proposal.description)) {
    throw new WattzunInputError("Create the customer separately from quote details.");
  }
  return { portal: "trade", scopeId: value.scopeId, requestId: value.requestId,
    action: { ...proposal, customerMode: input.customerMode, customerId, serviceSiteId, customerName, address: parsedAddress },
    confirmation: { reviewed: true, name: customerName, address: parsedAddress.addressFormatted } };
}
