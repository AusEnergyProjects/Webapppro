import { residentialStateFromPostcode } from "./australian-postcodes.mjs";
import { buildDirectTradeTriage } from "./direct-trade-matching.mjs";

const EVENT_TYPES = new Set([
  "comparison.results",
  "electricity.upgrade",
  "gas.upgrade",
  "direct_trade.project",
  "direct_trade.partner",
]);

const ELECTRICITY_ENQUIRIES = new Set([
  "electricity-solar",
  "electricity-solar-battery",
  "electricity-battery",
  "solar",
  "solar-battery",
  "battery",
]);

const GAS_ENQUIRIES = new Set(["gas-heating", "gas-hot-water"]);

export function leadEventType(payload) {
  if (payload?.submissionType === "comparison") return "comparison.results";
  if (payload?.enquiry === "direct-trade-project") return "direct_trade.project";
  if (payload?.enquiry === "direct-trade-partner") return "direct_trade.partner";
  if (GAS_ENQUIRIES.has(payload?.enquiry)) return "gas.upgrade";
  if (ELECTRICITY_ENQUIRIES.has(payload?.enquiry)) return "electricity.upgrade";
  return "";
}

function referenceDate(isoDate) {
  return String(isoDate || "").slice(0, 10).replaceAll("-", "");
}

export function createLeadEnvelope(payload, options = {}) {
  const submittedAt = payload.submittedAt || (options.now ? options.now() : new Date()).toISOString();
  const eventType = leadEventType(payload);
  if (!EVENT_TYPES.has(eventType)) throw new Error("Unsupported lead event type.");
  const createId = options.createId || (() => crypto.randomUUID());
  const suffix = String(createId()).replaceAll("-", "").slice(0, 10).toUpperCase();
  const reference = `AEA-${referenceDate(submittedAt)}-${suffix}`;
  const inferredState = residentialStateFromPostcode(payload.postcode);
  const directTradeTriage = eventType === "direct_trade.project"
    ? buildDirectTradeTriage({ ...payload, state: payload.state || inferredState || "" })
    : null;

  return {
    ...payload,
    schemaVersion: "3",
    eventType,
    reference,
    submittedAt,
    state: payload.state || inferredState || "",
    source: "aea-energy-web",
    ...(directTradeTriage ? { directTradeTriage } : {}),
  };
}
