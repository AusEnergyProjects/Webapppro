import type { SolarPanel } from "./trade-map-solar";
import { normalizeSolarDesignEquipment, normalizeSolarEquipmentItem, type SolarDesignEquipment } from "./trade-solar-equipment.ts";

export const SOLAR_DESIGN_MAX_PANELS = 500;
export const SOLAR_DESIGN_MAX_BYTES = 512_000;
export const SOLAR_DESIGN_PAGE_SIZE = 50;

export type SolarDesignInput = {
  title: string;
  panels: SolarPanel[];
  equipment: SolarDesignEquipment;
  installationNotes: string;
  center: { lat: number; lng: number };
  zoom: number;
  customerId: string;
  workOrderId: string;
};
export type SolarDesign = SolarDesignInput & {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type SolarDesignSummary = Pick<SolarDesign, "id" | "title" | "revision" | "customerId" | "workOrderId" | "createdAt" | "updatedAt"> & { panelCount: number };

function invalid(): never { throw new Error("SOLAR_DESIGN_INVALID"); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number, required = false) {
  if (typeof value !== "string" || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) invalid();
  const result = value.trim();
  if (required && !result) invalid();
  return result;
}
function number(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) invalid();
  return value;
}
function coordinates(value: unknown) {
  const point = object(value);
  return { lat: number(point.lat, -85, 85), lng: number(point.lng, -180, 180) };
}
export function solarDesignRecordId(value: unknown, required = false) {
  const id = text(value ?? "", 180, required);
  if (id && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) invalid();
  return id;
}
export function solarDesignRevision(value: unknown) {
  const revision = number(value, 0, Number.MAX_SAFE_INTEGER - 1);
  if (!Number.isSafeInteger(revision)) invalid();
  return revision;
}

/** Only geometry and explicitly selected equipment are retained, never map tiles or arbitrary client fields. */
export function normalizeSolarDesignInput(raw: unknown): SolarDesignInput {
  const value = object(raw);
  if (!Array.isArray(value.panels) || value.panels.length > SOLAR_DESIGN_MAX_PANELS) invalid();
  const panelIds = new Set<number>();
  const panels: SolarPanel[] = value.panels.map((rawPanel) => {
    const panel = object(rawPanel);
    const id = number(panel.id, 1, Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(id) || panelIds.has(id)) invalid();
    panelIds.add(id);
    const widthM = number(panel.widthM, 0.2, 4), lengthM = number(panel.lengthM, 0.2, 4);
    let equipment;
    try { equipment = panel.equipment === undefined ? undefined : normalizeSolarEquipmentItem(panel.equipment); }
    catch { invalid(); }
    if (equipment && (equipment.kind !== "panel"
      || Math.abs((equipment.widthM ?? 0) - widthM) > 0.000001
      || Math.abs((equipment.lengthM ?? 0) - lengthM) > 0.000001)) invalid();
    return {
      id, center: coordinates(panel.center), widthM, lengthM,
      lengthTilt: number(panel.lengthTilt, 0, 85), widthTilt: number(panel.widthTilt, 0, 85),
      heading: ((number(panel.heading, -360_000, 360_000) % 360) + 360) % 360,
      ...(equipment ? { equipment } : {}),
    };
  });
  let equipment: SolarDesignEquipment;
  try { equipment = normalizeSolarDesignEquipment(value.equipment); }
  catch { invalid(); }
  const result: SolarDesignInput = {
    title: text(value.title, 180, true), panels,
    equipment,
    installationNotes: text(value.installationNotes, 5_000),
    center: coordinates(value.center), zoom: number(value.zoom, 0, 24),
    customerId: solarDesignRecordId(value.customerId), workOrderId: solarDesignRecordId(value.workOrderId),
  };
  if (new TextEncoder().encode(JSON.stringify(result)).length > SOLAR_DESIGN_MAX_BYTES) invalid();
  return result;
}
