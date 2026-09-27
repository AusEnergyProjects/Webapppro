import { resolvePriceBookDocuments } from "./trade-price-book-documents-server";
import { groupQuoteProductDocuments } from "./trade-quote-product-documents";
import type { QuoteEquipment } from "./trade-quote-equipment";

export async function resolveQuoteProductDocuments(ownerUid: string,
  groups: { choiceKey: string; productIds: string[] }[], equipment: QuoteEquipment) {
  const scopes = groups.map((group) => ({ ...group, productIds: [...group.productIds,
    ...(group.choiceKey ? equipment.choices.find((choice) => choice.choiceKey === group.choiceKey)?.items || [] : equipment.common)
      .map((item) => item.priceBookItemId || "").filter(Boolean)] }));
  const resolved = await Promise.all(scopes.map(async (scope) => ({ choiceKey: scope.choiceKey,
    documents: scope.productIds.length ? await resolvePriceBookDocuments(ownerUid, [...new Set(scope.productIds)]) : [] })));
  return groupQuoteProductDocuments(resolved);
}
