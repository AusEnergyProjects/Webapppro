import { parseProductDocuments, type TradeProductDocument } from "./trade-price-book-documents.ts";

export type QuoteProductDocument = { document: TradeProductDocument; choiceKeys: string[] };
export type QuoteProductDocumentSummary = { id: string; label: string; fileName: string; pageCount: number; choiceKeys: string[] };

export function normaliseQuoteProductDocuments(value: unknown): QuoteProductDocument[] {
  const input: unknown = typeof value === "string" ? JSON.parse(value || "[]") : value ?? [];
  if (!Array.isArray(input) || input.length > 100) throw new Error("QUOTE_PRODUCT_DOCUMENTS_INVALID");
  const documents = parseProductDocuments(input.map((entry) => entry && typeof entry === "object" ? Reflect.get(entry, "document") : null));
  const keys = new Set<string>();
  return documents.map((document, index) => {
    const choiceKeys: unknown = Reflect.get(input[index], "choiceKeys");
    if (!Array.isArray(choiceKeys) || choiceKeys.length > 20 || choiceKeys.some((key) => typeof key !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(key))
      || new Set(choiceKeys).size !== choiceKeys.length || keys.has(document.sha256)) throw new Error("QUOTE_PRODUCT_DOCUMENTS_INVALID");
    keys.add(document.sha256);
    return { document, choiceKeys };
  });
}

export function quoteProductDocumentSummaries(documents: QuoteProductDocument[]): QuoteProductDocumentSummary[] {
  return documents.map(({ document, choiceKeys }) => ({ id: document.id, label: document.label, fileName: document.fileName, pageCount: document.pageCount, choiceKeys }));
}

export function selectedQuoteProductDocuments<T extends { choiceKeys: string[] }>(documents: T[], selectedChoiceIds: string[]) {
  return documents.filter((entry) => !entry.choiceKeys.length || entry.choiceKeys.some((key) => selectedChoiceIds.includes(key)));
}

/** One copy of identical PDF bytes, including when several products use the same brochure. */
export function groupQuoteProductDocuments(groups: { choiceKey: string; documents: TradeProductDocument[] }[]): QuoteProductDocument[] {
  const byHash = new Map<string, QuoteProductDocument>();
  for (const group of groups) for (const document of group.documents) {
    const prior = byHash.get(document.sha256);
    if (!prior) byHash.set(document.sha256, { document, choiceKeys: group.choiceKey ? [group.choiceKey] : [] });
    else if (!group.choiceKey) prior.choiceKeys = [];
    else if (prior.choiceKeys.length && !prior.choiceKeys.includes(group.choiceKey)) prior.choiceKeys.push(group.choiceKey);
  }
  return normaliseQuoteProductDocuments([...byHash.values()]);
}
