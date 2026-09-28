export const MAX_STOCK_QUANTITY_MILLI = 1_000_000_000;

export type StockItem = {
  itemId: string; itemCode: string; name: string; itemType: string; unitLabel: string; recordStatus: string;
  tracked: boolean; onHandMilli: number; reservedMilli: number; availableMilli: number; lowStockMilli: number; revision: number;
};
export type StockHistoryEntry = {
  id: string; action: string; quantityMilli: number; changeMilli: number; onHandMilli: number;
  note: string; workOrderId: string; createdAt: string;
};
export type StockListResponse = { ok: boolean; items: StockItem[]; canManage: boolean; error?: string };
export type StockDetailResponse = { ok: boolean; item: StockItem; history: StockHistoryEntry[]; canManage: boolean; error?: string };
export type JobStockRequirement = {
  requirementId: string; itemId: string; description: string; unitLabel: string; requiredMilli: number;
  usedMilli: number; remainingMilli: number; reservedMilli: number; availableMilli: number; shortageMilli: number; revision: number; tracked: boolean;
};
export type JobStockSummary = { workOrderId: string; requirements: JobStockRequirement[]; canManage: boolean };
export type JobStockResponse = { ok: boolean; job: JobStockSummary; error?: string };
export type StockAction = "enable" | "configure" | "receive" | "count" | "disable" | "reserve" | "release";
export type StockMutation = {
  action: StockAction; itemId: string; operationId: string; expectedRevision: number;
  quantityMilli?: number; lowStockMilli?: number; note?: string; workOrderId?: string; requirementId?: string;
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
  const actions: StockAction[] = ["enable", "configure", "receive", "count", "disable", "reserve", "release"];
  const action = actions.find((candidate) => candidate === input.action);
  if (!action) throw new Error("STOCK_INVALID_INPUT");
  const result: StockMutation = { action, itemId: identifier(input.itemId), operationId: identifier(input.operationId), expectedRevision: integer(input.expectedRevision) };
  if (result.operationId.length < 16) throw new Error("STOCK_INVALID_INPUT");
  if (["enable", "receive", "count", "reserve"].includes(action)) result.quantityMilli = integer(input.quantityMilli, action === "receive" ? 1 : 0);
  if (["enable", "configure"].includes(action)) result.lowStockMilli = integer(input.lowStockMilli);
  if (action === "reserve" || action === "release") {
    result.workOrderId = identifier(input.workOrderId); result.requirementId = identifier(input.requirementId);
  }
  result.note = typeof input.note === "string" ? input.note.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 300) : "";
  return result;
}
