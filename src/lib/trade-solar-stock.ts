/** Internal issue-time stock data. Never include supplier costs in customer documents. */
export type QuoteSolarStockComponent = {
  priceBookItemId: string;
  choiceId: string;
  name: string;
  quantityMilli: number;
  unitCostCents: number;
};

export type QuoteSolarStockWarning = {
  name: string;
  choiceId: string;
  reason: "unlinked" | "tracking_off";
};

export type QuoteSolarStockSnapshot = {
  version: 1;
  components: QuoteSolarStockComponent[];
  warnings: QuoteSolarStockWarning[];
};

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readQuoteSolarStockSnapshot(value: unknown): QuoteSolarStockSnapshot {
  let parsed: unknown;
  try { parsed = typeof value === "string" ? JSON.parse(value) : value; }
  catch { throw new Error("QUOTE_SOLAR_STOCK_SNAPSHOT_INVALID"); }
  if (!object(parsed) || parsed.version !== 1 || !Array.isArray(parsed.components) || !Array.isArray(parsed.warnings)
    || parsed.components.length > 420 || parsed.warnings.length > 420) throw new Error("QUOTE_SOLAR_STOCK_SNAPSHOT_INVALID");
  const components = parsed.components.map((entry): QuoteSolarStockComponent => {
    if (!object(entry) || typeof entry.priceBookItemId !== "string" || !/^[a-zA-Z0-9_-]{1,180}$/.test(entry.priceBookItemId)
      || typeof entry.choiceId !== "string" || !/^[a-zA-Z0-9_-]{0,180}$/.test(entry.choiceId)
      || typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 180
      || typeof entry.quantityMilli !== "number" || !Number.isSafeInteger(entry.quantityMilli) || entry.quantityMilli <= 0 || entry.quantityMilli > 1_000_000_000
      || typeof entry.unitCostCents !== "number" || !Number.isSafeInteger(entry.unitCostCents) || entry.unitCostCents < 0 || entry.unitCostCents > 1_000_000_000) {
      throw new Error("QUOTE_SOLAR_STOCK_SNAPSHOT_INVALID");
    }
    return { priceBookItemId: entry.priceBookItemId, choiceId: entry.choiceId, name: entry.name, quantityMilli: entry.quantityMilli, unitCostCents: entry.unitCostCents };
  });
  const warnings = parsed.warnings.map((entry): QuoteSolarStockWarning => {
    if (!object(entry) || typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 180
      || typeof entry.choiceId !== "string" || !/^[a-zA-Z0-9_-]{0,180}$/.test(entry.choiceId)
      || (entry.reason !== "unlinked" && entry.reason !== "tracking_off")) throw new Error("QUOTE_SOLAR_STOCK_SNAPSHOT_INVALID");
    return { name: entry.name, choiceId: entry.choiceId, reason: entry.reason };
  });
  return { version: 1, components, warnings };
}

/** Explicit accepted material lines already create stock requirements. Add only the uncovered equipment quantity. */
export function selectedQuoteSolarStockComponents(
  snapshot: QuoteSolarStockSnapshot,
  selectedChoiceIds: readonly string[],
  explicitMaterials: readonly { priceBookItemId: string; choiceId: string; quantityMilli: number }[],
): QuoteSolarStockComponent[] {
  const covered = new Map<string, number>();
  const scopeKey = (item: { priceBookItemId: string; choiceId: string }) => `${item.choiceId}:${item.priceBookItemId}`;
  for (const line of explicitMaterials) covered.set(scopeKey(line), (covered.get(scopeKey(line)) ?? 0) + line.quantityMilli);
  return snapshot.components.filter((component) => !component.choiceId || selectedChoiceIds.includes(component.choiceId)).flatMap((component) => {
    const key = scopeKey(component);
    const used = Math.min(component.quantityMilli, covered.get(key) ?? 0);
    covered.set(key, (covered.get(key) ?? 0) - used);
    const quantityMilli = component.quantityMilli - used;
    return quantityMilli > 0 ? [{ ...component, quantityMilli }] : [];
  });
}
