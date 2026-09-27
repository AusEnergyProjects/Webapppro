import { calculateTradeQuoteLine, dollarsToCents, quantityToMilli } from "./trade-quote.ts";
import { mapQuoteKind, mapQuoteLine, mapQuoteSystemPanels } from "./trade-map-quote.ts";
import type { QuoteEquipment } from "./trade-quote-equipment.ts";

type SystemLine = { lineType: string; description: string; quantity: string; unitPrice: string; taxCode: string; sectionHeading: string; priceBookItemId?: string; jobPacketId?: string; jobPacketLineId?: string; id?: string };

/** Reuses ordinary required package choices. Every package is one complete system. */
export function solarQuotePackages(lines: SystemLine[], equipment: QuoteEquipment, count: 2 | 3, groupKey: string) {
  const solar = lines.filter((line) => mapQuoteKind(line.sectionHeading) === "solar");
  if (solar.length !== 1) throw new Error("Choose one solar system to build packages.");
  const source = solar[0];
  const panelCount = mapQuoteSystemPanels(source.sectionHeading) ?? Number(source.quantity);
  const originalPrice = source.unitPrice.trim() ? (calculateTradeQuoteLine(quantityToMilli(source.quantity),
    dollarsToCents(source.unitPrice), source.taxCode === "none" ? "none" : "gst").subtotalCents / 100).toFixed(2) : "";
  const names = ["Solar", "Solar + battery", "Solar + battery + hot water"].slice(0, count);
  const choices = names.map((name, index) => ({
    clientKey: `${groupKey}-${index}`, kind: "package" as const, groupKey, name,
    summary: "", recommended: index === 0,
    lines: [{ ...mapQuoteLine({ kind: "solar", quantity: panelCount }), description: index ? name : source.description,
      unitPrice: index ? "" : originalPrice, taxCode: source.taxCode }],
  }));
  return {
    lines: lines.filter((line) => line !== source), choices,
    equipment: { common: equipment.common.filter((item) => item.kind === "panel" || item.kind === "inverter"),
      choices: [...equipment.choices, ...choices.map((choice, index) => ({ choiceKey: choice.clientKey,
        items: equipment.common.filter((item) => (item.kind === "battery" && index >= 1) || (item.kind === "hot_water" && index >= 2)),
      })).filter((group) => group.items.length)] },
  };
}
