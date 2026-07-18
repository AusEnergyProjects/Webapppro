export type QuickInvoiceLine = {
  lineId: string;
  priceBookItemId: string;
  priceRevision: number;
  description: string;
  quantity: number;
  unitPriceCentsExGst: number;
  taxCode: "gst" | "none";
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

export type QuickInvoiceDraft = {
  lines: QuickInvoiceLine[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

export function quickInvoiceTotals(lines: Pick<QuickInvoiceLine, "subtotalCents" | "taxCents" | "totalCents">[]) {
  return lines.reduce((total, line) => ({
    subtotalCents: total.subtotalCents + line.subtotalCents,
    taxCents: total.taxCents + line.taxCents,
    totalCents: total.totalCents + line.totalCents,
  }), { subtotalCents: 0, taxCents: 0, totalCents: 0 });
}
