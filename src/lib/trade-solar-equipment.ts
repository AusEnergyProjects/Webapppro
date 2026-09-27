export const SOLAR_EQUIPMENT_KINDS = ["panel", "inverter", "battery", "hot_water"] as const;
export type SolarEquipmentKind = typeof SOLAR_EQUIPMENT_KINDS[number];

/** Customer-safe equipment snapshot. Supplier costs and price-book rates never belong here. */
export type SolarEquipmentItem = {
  id: string;
  kind: SolarEquipmentKind;
  name: string;
  manufacturer: string;
  model: string;
  quantity: number;
  watts?: number;
  widthM?: number;
  lengthM?: number;
  capacityKwh?: number;
  capacityLitres?: number;
  warrantyYears?: number;
  datasheetUrl?: string;
  imageUrl?: string;
  catalogueProductId?: string;
  priceBookItemId?: string;
};
export type SolarDesignEquipment = SolarEquipmentItem[];
export const SOLAR_EQUIPMENT_LABELS: Record<SolarEquipmentKind, string> = {
  panel: "Solar panel", inverter: "Inverter", battery: "Battery", hot_water: "Hot water",
};

/** Editable starting dimensions, not a named product or a claim about the market average. */
export const DEFAULT_SOLAR_EQUIPMENT: SolarEquipmentItem = {
  id: "generic-panel", kind: "panel", name: "Generic 440 W panel", manufacturer: "", model: "Generic 440 W panel",
  quantity: 1, watts: 440, widthM: 1.134, lengthM: 1.762,
};

/** Manual specification edits must not retain a manufacturer's identity or documents. */
export function customSolarPanelEquipment(watts: number, widthM: number, lengthM: number): SolarEquipmentItem {
  return normalizeSolarEquipmentItem({ id: "generic-panel", kind: "panel", name: `Generic ${watts} W panel`,
    manufacturer: "", model: `Generic ${watts} W panel`, quantity: 1, watts, widthM, lengthM });
}

// Exact variant dimensions and nameplate watts checked against these manufacturer
// datasheets on 2026-09-27. Links only; no mirrored catalogue or warranty assumptions.
export const SOLAR_STARTER_PANELS: readonly SolarEquipmentItem[] = [
  { id: "starter-jinko-jkm440n-54hl4r-v", kind: "panel", name: "Jinko Solar 440 W", manufacturer: "Jinko Solar", model: "JKM440N-54HL4R-V",
    quantity: 1, watts: 440, widthM: 1.134, lengthM: 1.762, datasheetUrl: "https://www.jinkosolar.com/uploads/JKM425-445N-54HL4R-%28V%29-F3-EN.pdf" },
  { id: "starter-trina-tsm-440neg9r28", kind: "panel", name: "Trina Solar 440 W", manufacturer: "Trina Solar", model: "TSM-440NEG9R.28",
    quantity: 1, watts: 440, widthM: 1.134, lengthM: 1.762, datasheetUrl: "https://static.trinasolar.com/sites/default/files/Datasheet%20NEG9R.28.pdf" },
  { id: "starter-trina-tsm-450neg9r28", kind: "panel", name: "Trina Solar 450 W", manufacturer: "Trina Solar", model: "TSM-450NEG9R.28",
    quantity: 1, watts: 450, widthM: 1.134, lengthM: 1.762, datasheetUrl: "https://static.trinasolar.com/sites/default/files/Datasheet%20NEG9R.28.pdf" },
];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, limit: number, required = false) {
  if (value === undefined || value === null) {
    if (required) throw new Error("Equipment name and model are required.");
    return "";
  }
  if (typeof value !== "string" || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("Equipment text is not valid.");
  const result = value.trim();
  if (required && !result) throw new Error("Equipment name and model are required.");
  return result;
}
function optionalNumber(value: unknown, min: number, max: number, field: string) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`Enter a valid ${field}.`);
  return value;
}

export function solarEquipmentUrl(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const source = text(value, 2048);
  let url: URL;
  try { url = new URL(source); } catch { throw new Error("Equipment links must be full HTTPS addresses."); }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")
    || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(url.hostname) || url.hostname.startsWith("[")
    || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(url.hostname)) {
    throw new Error("Equipment links must be public HTTPS addresses.");
  }
  return url.href;
}

export function normalizeSolarEquipmentItem(raw: unknown): SolarEquipmentItem {
  if (!record(raw)) throw new Error("Equipment details are not valid.");
  const kind = raw.kind;
  if (kind !== "panel" && kind !== "inverter" && kind !== "battery" && kind !== "hot_water") throw new Error("Choose an equipment type.");
  const id = text(raw.id, 180, true);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Equipment identity is not valid.");
  const name = text(raw.name, 180, true);
  const manufacturer = text(raw.manufacturer, 140);
  const model = text(raw.model, 180, true);
  const quantity = optionalNumber(raw.quantity, 1, 1000, "equipment quantity") ?? 1;
  if (!Number.isInteger(quantity)) throw new Error("Equipment quantity must be a whole number.");
  const watts = optionalNumber(raw.watts, 1, kind === "panel" ? 2000 : 1_000_000, "power in watts");
  const widthM = optionalNumber(raw.widthM, 0.2, 4, "panel width in metres");
  const lengthM = optionalNumber(raw.lengthM, 0.2, 4, "panel length in metres");
  if (kind === "panel" && (watts === undefined || widthM === undefined || lengthM === undefined)) {
    throw new Error("Enter this panel's watts, width and length from its datasheet.");
  }
  const capacityKwh = optionalNumber(raw.capacityKwh, 0.01, 10_000, "battery capacity in kWh");
  const capacityLitres = optionalNumber(raw.capacityLitres, 1, 100_000, "hot water capacity in litres");
  const warrantyYears = optionalNumber(raw.warrantyYears, 0, 100, "warranty in years");
  const datasheetUrl = solarEquipmentUrl(raw.datasheetUrl);
  const imageUrl = solarEquipmentUrl(raw.imageUrl);
  const catalogueProductId = text(raw.catalogueProductId, 180);
  const priceBookItemId = text(raw.priceBookItemId, 180);
  if (priceBookItemId && !/^[a-zA-Z0-9_-]+$/.test(priceBookItemId)) throw new Error("Price-book equipment identity is not valid.");
  return {
    id, kind, name, manufacturer, model, quantity,
    ...(watts === undefined ? {} : { watts }), ...(widthM === undefined ? {} : { widthM }),
    ...(lengthM === undefined ? {} : { lengthM }), ...(capacityKwh === undefined ? {} : { capacityKwh }),
    ...(capacityLitres === undefined ? {} : { capacityLitres }), ...(warrantyYears === undefined ? {} : { warrantyYears }),
    ...(datasheetUrl ? { datasheetUrl } : {}), ...(imageUrl ? { imageUrl } : {}),
    ...(catalogueProductId ? { catalogueProductId } : {}),
    ...(priceBookItemId ? { priceBookItemId } : {}),
  };
}

export function normalizeSolarDesignEquipment(raw: unknown): SolarDesignEquipment {
  if (!Array.isArray(raw) || raw.length > 20) throw new Error("A design can include up to 20 equipment models.");
  const items = raw.map(normalizeSolarEquipmentItem);
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("Equipment models must have unique identities.");
  return items;
}

export function solarEquipmentDescription(item: SolarEquipmentItem) {
  const values: string[] = [];
  if (item.watts !== undefined) values.push(item.kind === "panel" ? `${item.watts} W` : `${Number((item.watts / 1000).toFixed(3))} kW`);
  if (item.capacityKwh !== undefined) values.push(`${item.capacityKwh} kWh`);
  if (item.capacityLitres !== undefined) values.push(`${item.capacityLitres} L`);
  if (item.kind === "panel" && item.widthM !== undefined && item.lengthM !== undefined) values.push(`${item.lengthM} × ${item.widthM} m`);
  return values.join(" · ");
}

/** Uses each placed panel's own snapshot so mixed models retain the correct capacity. */
export function solarEquipmentSummary(panels: readonly { equipment?: SolarEquipmentItem }[]) {
  const models = new Map<string, SolarEquipmentItem>();
  let knownWatts = 0;
  let knownPanelCount = 0;
  for (const panel of panels) {
    const item = panel.equipment;
    if (!item || item.kind !== "panel" || !Number.isFinite(item.watts) || !item.watts || item.watts <= 0) continue;
    knownWatts += item.watts;
    knownPanelCount += 1;
    // Different saved revisions of the same favourite must remain distinct in the bill of materials.
    const key = JSON.stringify([item.id, item.name, item.model, item.watts, item.widthM, item.lengthM, item.manufacturer,
      item.warrantyYears, item.datasheetUrl, item.imageUrl, item.catalogueProductId, item.priceBookItemId]);
    const existing = models.get(key);
    if (existing) existing.quantity += 1;
    else {
      let hash = 2166136261;
      for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
      models.set(key, { ...item, id: `${item.id.slice(0, 160)}-spec-${hash.toString(16)}`, quantity: 1 });
    }
  }
  return {
    panelCount: panels.length, knownPanelCount, unknownPanelCount: panels.length - knownPanelCount,
    knownWatts, systemKw: panels.length > 0 && knownPanelCount === panels.length ? Number((knownWatts / 1000).toFixed(3)) : null,
    models: [...models.values()],
  };
}
