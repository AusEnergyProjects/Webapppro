export const MAX_STOCK_QUANTITY_MILLI = 1_000_000_000;

export type StockLocation = { id: string; name: string; isDefault: boolean; revision: number; responsibleMemberId: string; responsibleName: string };
export type StockLocationBalance = { locationId: string; name: string; responsibleName: string; onHandMilli: number };
export type StockUsageLocation = { locationId: string; quantityMilli: number };

export type StockItem = {
  itemId: string; itemCode: string; name: string; itemType: string; unitLabel: string; recordStatus: string;
  tracked: boolean; onHandMilli: number; reservedMilli: number; availableMilli: number; lowStockMilli: number; revision: number; locations: StockLocationBalance[];
};
export type StockHistoryEntry = {
  id: string; action: string; quantityMilli: number; changeMilli: number; onHandMilli: number;
  note: string; workOrderId: string; createdAt: string;
};
export type StockListResponse = { ok: boolean; items: StockItem[]; canManage: boolean; locations: StockLocation[]; members: { id: string; name: string }[]; error?: string };
export type StockDetailResponse = { ok: boolean; item: StockItem; history: StockHistoryEntry[]; canManage: boolean; locations: StockLocation[]; members: { id: string; name: string }[]; error?: string };
export type JobStockRequirement = {
  requirementId: string; itemId: string; description: string; unitLabel: string; requiredMilli: number;
  usedMilli: number; remainingMilli: number; reservedMilli: number; availableMilli: number; shortageMilli: number; revision: number; tracked: boolean;
  stockBaselineMilli: number; stockLocations: (StockLocationBalance & { isDefault: boolean; usedMilli: number })[];
};
export type JobStockSummary = { workOrderId: string; requirements: JobStockRequirement[]; canManage: boolean };
export type JobStockResponse = { ok: boolean; job: JobStockSummary; error?: string };
export type StockAction = "enable" | "configure" | "receive" | "count" | "disable" | "reserve" | "release" | "transfer";
export type StockMutation = {
  action: StockAction; itemId: string; operationId: string; expectedRevision: number;
  quantityMilli?: number; lowStockMilli?: number; note?: string; workOrderId?: string; requirementId?: string; locationId?: string; fromLocationId?: string; toLocationId?: string;
};

function integer(value: unknown, minimum = 0) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > MAX_STOCK_QUANTITY_MILLI) throw new Error("STOCK_INVALID_QUANTITY");
  return value;
}
function identifier(value: unknown) {
  if (typeof value !== "string" || !/^[\w:-]{1,180}$/.test(value)) throw new Error("STOCK_INVALID_INPUT");
  return value;
}
export function normaliseStockMutation(value: unknown): StockMutation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("STOCK_INVALID_INPUT");
  const input = value as Record<string, unknown>;
  const actions: StockAction[] = ["enable", "configure", "receive", "count", "disable", "reserve", "release", "transfer"];
  const action = actions.find((candidate) => candidate === input.action);
  if (!action) throw new Error("STOCK_INVALID_INPUT");
  const result: StockMutation = { action, itemId: identifier(input.itemId), operationId: identifier(input.operationId), expectedRevision: integer(input.expectedRevision) };
  if (result.operationId.length < 16) throw new Error("STOCK_INVALID_INPUT");
  if (["enable", "receive", "count", "reserve", "transfer"].includes(action)) result.quantityMilli = integer(input.quantityMilli, ["receive", "transfer"].includes(action) ? 1 : 0);
  if (["enable", "configure"].includes(action)) result.lowStockMilli = integer(input.lowStockMilli);
  if (action === "reserve" || action === "release") {
    result.workOrderId = identifier(input.workOrderId); result.requirementId = identifier(input.requirementId);
  }
  if (action === "transfer") { result.fromLocationId = identifier(input.fromLocationId); result.toLocationId = identifier(input.toLocationId); if (result.fromLocationId === result.toLocationId) throw new Error("STOCK_INVALID_LOCATION"); }
  if (input.locationId !== undefined) result.locationId = identifier(input.locationId);
  result.note = typeof input.note === "string" ? input.note.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 300) : "";
  return result;
}

export type StockLocationMutation = { action: "create_location" | "rename_location"; operationId: string; name: string; locationId?: string; expectedRevision?: number; responsibleMemberId?: string };
export type StockLocationResponse = { ok: boolean; location: StockLocation; locations: StockLocation[]; members: { id: string; name: string }[]; error?: string };
export function normaliseStockLocationMutation(value: unknown): StockLocationMutation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("STOCK_INVALID_INPUT");
  const input = value as Record<string, unknown>;
  if (input.action !== "create_location" && input.action !== "rename_location") throw new Error("STOCK_INVALID_INPUT");
  const name = typeof input.name === "string" ? input.name.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
  if (!name || name.length > 60) throw new Error("STOCK_INVALID_LOCATION");
  const result: StockLocationMutation = { action: input.action, operationId: identifier(input.operationId), name };
  if (result.operationId.length < 16) throw new Error("STOCK_INVALID_INPUT");
  if (input.action === "rename_location") { result.locationId = identifier(input.locationId); result.expectedRevision = integer(input.expectedRevision, 1); }
  if (input.responsibleMemberId !== undefined) result.responsibleMemberId = input.responsibleMemberId === "" ? "" : identifier(input.responsibleMemberId);
  return result;
}
export function normaliseStockUsageLocations(value: unknown): StockUsageLocation[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("STOCK_INVALID_LOCATION");
  const result = value.map(entry => {
    if (!entry || typeof entry !== "object") throw new Error("STOCK_INVALID_LOCATION");
    return { locationId: identifier(entry.locationId), quantityMilli: integer(entry.quantityMilli) };
  });
  if (new Set(result.map(entry => entry.locationId)).size !== result.length) throw new Error("STOCK_INVALID_LOCATION");
  return result.sort((a, b) => a.locationId.localeCompare(b.locationId));
}
