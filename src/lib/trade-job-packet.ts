import { quantityToMilli } from "./trade-quote.ts";
import { calculatePriceBookRates } from "./trade-price-book.ts";

export type PacketPriceItem = {
  id: string;
  itemCode: string;
  name: string;
  itemType: string;
  unitLabel: string;
  supplierCostCentsExGst: number;
  sellPriceCentsExGst: number;
  taxCode: "gst" | "none";
  expectedDurationMinutes: number;
  requiredSkill: string;
};

export type PacketLineInput = { id?: string; priceBookItemId: string; quantityMilli: number };

function scaled(value: number, quantityMilli: number) {
  const numerator = BigInt(value) * BigInt(quantityMilli);
  const negative = numerator < BigInt(0); const absolute = negative ? -numerator : numerator;
  const rounded = (absolute + BigInt(500)) / BigInt(1000);
  return Number(negative ? -rounded : rounded);
}

export function normalisePacketLines(raw: unknown, available: Map<string, PacketPriceItem>) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 40) throw new Error("INVALID_JOB_PACKET_LINES");
  const seen = new Set<string>();
  return raw.map((line) => {
    if (!line || typeof line !== "object") throw new Error("INVALID_JOB_PACKET_LINES");
    const record = line as Record<string, unknown>; const priceBookItemId = String(record.priceBookItemId || "");
    if (!priceBookItemId || seen.has(priceBookItemId) || !available.has(priceBookItemId)) throw new Error("INVALID_JOB_PACKET_LINES");
    seen.add(priceBookItemId);
    return { priceBookItemId, quantityMilli: quantityToMilli(record.quantity) };
  });
}

export function calculateJobPacketSummary(lines: PacketLineInput[], available: Map<string, PacketPriceItem>) {
  let costCentsExGst = 0; let sellCentsExGst = 0; let estimatedDurationMinutes = 0;
  const requiredCapabilities = new Set<string>();
  for (const line of lines) {
    const item = available.get(line.priceBookItemId); if (!item) throw new Error("JOB_PACKET_ITEM_UNAVAILABLE");
    costCentsExGst += scaled(item.supplierCostCentsExGst, line.quantityMilli);
    sellCentsExGst += scaled(item.sellPriceCentsExGst, line.quantityMilli);
    estimatedDurationMinutes += scaled(item.expectedDurationMinutes, line.quantityMilli);
    if (item.requiredSkill) requiredCapabilities.add(item.requiredSkill);
  }
  const rates = calculatePriceBookRates(costCentsExGst, sellCentsExGst);
  return { costCentsExGst, sellCentsExGst, estimatedDurationMinutes,
    requiredCapabilities: [...requiredCapabilities].sort(), markupBasisPoints: rates.markupBasisPoints,
    marginBasisPoints: rates.marginBasisPoints };
}

export function normaliseSuggestedCrewSize(value: unknown) {
  const text = String(value ?? "1").trim(); if (!/^\d{1,2}$/.test(text)) throw new Error("INVALID_JOB_PACKET_CREW");
  const count = Number(text); if (count < 1 || count > 20) throw new Error("INVALID_JOB_PACKET_CREW"); return count;
}
