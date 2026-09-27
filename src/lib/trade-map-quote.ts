export type MapQuoteKind = "area" | "distance" | "solar";
export type MapQuoteMeasurement = { kind: MapQuoteKind; quantity: number; roofImage?: { dataUrl: string } };
export type MapQuoteIntent = { id: string; ownerUid: string; workOrderId: string; measurement: MapQuoteMeasurement };
export const MAP_QUOTE_UNITS = { area: "m²", distance: "m", solar: "panels" } as const;
const SECTIONS = { area: "Map estimate: roof area (m²)", distance: "Map estimate: distance (m)", solar: "Map concept: solar panels" };

export function mapQuoteMeasurement(kind: MapQuoteKind, value: number): MapQuoteMeasurement | null {
  if (!["area", "distance", "solar"].includes(kind) || !Number.isFinite(value) || value <= 0 || value > 999_999 || (kind === "solar" && !Number.isInteger(value))) return null;
  const quantity = Number(value.toFixed(kind === "solar" ? 0 : kind === "area" ? 1 : 2));
  return quantity > 0 ? { kind, quantity } : null;
}

export function mapQuoteKind(section: string): MapQuoteKind | null {
  if (mapQuoteSystemPanels(section) !== null) return "solar";
  for (const kind of ["area", "distance", "solar"] as const) if (SECTIONS[kind] === section) return kind;
  return null;
}

/** The count describes the design; the quote quantity is always one system. */
export function mapQuoteSystemPanels(section: string): number | null {
  const match = /^Solar system \((\d{1,6}(?:\.\d{1,3})?) panels?\)$/.exec(section);
  return match && Number(match[1]) > 0 ? Number(match[1]) : null;
}

export function mapQuoteLine(measurement: MapQuoteMeasurement) {
  const validated = mapQuoteMeasurement(measurement.kind, measurement.quantity);
  if (!validated) throw new Error("Invalid map quantity");
  return {
    lineType: "product", description: measurement.kind === "area" ? "Roof area from map. Confirm actual insulation coverage on site."
      : measurement.kind === "distance" ? "Approximate map distance. Confirm on site." : "Solar system from roof concept. Confirm equipment and installation design.",
    quantity: measurement.kind === "solar" ? "1" : String(validated.quantity), unitPrice: "", taxCode: "gst",
    sectionHeading: measurement.kind === "solar" ? `Solar system (${validated.quantity} ${validated.quantity === 1 ? "panel" : "panels"})` : SECTIONS[measurement.kind],
  };
}

export function canApplyMapQuoteIntent(intent: MapQuoteIntent, context: { ownerUid: string; workOrderId: string; canManage: boolean; consumedId: string }) {
  return Boolean(context.canManage && intent.id && intent.id !== context.consumedId && intent.ownerUid === context.ownerUid
    && intent.workOrderId === context.workOrderId && mapQuoteMeasurement(intent.measurement.kind, intent.measurement.quantity));
}

export function mapQuoteUnitMatches(kind: MapQuoteKind, unit: string, section = "") {
  const value = unit.toLowerCase().trim().replace(/^per\s+/, "").replace(/\s+/g, " ");
  if (kind === "solar" && mapQuoteSystemPanels(section) !== null) return ["system", "systems", "job", "jobs"].includes(value);
  const units = {
    area: ["m²", "m2", "sqm", "sq m", "square metre", "square metres", "square meter", "square meters"],
    distance: ["m", "metre", "metres", "meter", "meters", "linear metre", "linear metres"],
    solar: ["ea", "each", "unit", "units", "panel", "panels"],
  };
  return units[kind].includes(value);
}

export type MapQuoteJob = {
  id: string; workNumber: string; title: string; customerDisplayName: string; customerSource: string; sourceType: string;
  crmCustomerId: string; serviceSiteId: string; quoteStatus: string;
  jobRegister: { streetAddress: string; suburb: string; state: string; postcode: string };
};

/** Only already released, directly quotable jobs from the authenticated index. */
export function isMapQuoteJob(value: unknown): value is MapQuoteJob {
  if (!value || typeof value !== "object") return false;
  const required = ["id", "workNumber", "title", "customerDisplayName", "customerSource", "sourceType", "crmCustomerId", "serviceSiteId", "quoteStatus"];
  if (!required.every((key) => key in value && typeof Reflect.get(value, key) === "string")) return false;
  if (!("customerSource" in value) || !["trade_owned", "public_lead_released"].includes(String(value.customerSource))
    || !("sourceType" in value) || value.sourceType === "opportunity"
    || !Reflect.get(value, "id") || !Reflect.get(value, "crmCustomerId") || !Reflect.get(value, "serviceSiteId") || Reflect.get(value, "quoteStatus") === "restricted") return false;
  const address = Reflect.get(value, "jobRegister");
  return Boolean(address && typeof address === "object" && ["streetAddress", "suburb", "state", "postcode"].every((key) => typeof Reflect.get(address, key) === "string"));
}
