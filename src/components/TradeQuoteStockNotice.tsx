"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { quantityToMilli } from "@/lib/trade-quote";
import type { StockItem, StockListResponse } from "@/lib/trade-stock";
import type { QuoteChoice, QuoteLine } from "./TradeQuotePanel";
import styles from "./TradeQuoteStockNotice.module.css";

type StockLine = Pick<QuoteLine, "priceBookItemId" | "quantity">;
type StockChoice = Pick<QuoteChoice, "clientKey" | "name" | "lines">;
type StockWarning = { key: string; name: string; unitLabel: string; shortageMilli: number; scope: string };
const displayQuantity = (milli: number) => new Intl.NumberFormat("en-AU", { maximumFractionDigits: 3 }).format(milli / 1000);
const unitLabels: Record<string, string> = { each: "items", roll: "rolls", pack: "packs", bag: "bags", square_metre: "m²", metre: "m", kilometre: "km" };

function quantities(lines: readonly StockLine[]) {
  const result = new Map<string, number>();
  for (const line of lines) {
    if (!line.priceBookItemId) continue;
    try { result.set(line.priceBookItemId, (result.get(line.priceBookItemId) || 0) + quantityToMilli(line.quantity)); }
    catch { /* The quote editor handles incomplete or invalid quantity fields. */ }
  }
  return result;
}

export function quoteStockWarnings(lines: readonly StockLine[], choices: readonly StockChoice[], items: readonly StockItem[]): StockWarning[] {
  const tracked = new Map(items.filter((item) => item.tracked).map((item) => [item.itemId, item]));
  const base = quantities(lines);
  const warnings: StockWarning[] = [];
  const addWarnings = (required: Map<string, number>, key: string, scope: string, onlyItems?: Set<string>) => {
    for (const [itemId, requiredMilli] of required) {
      if (onlyItems && !onlyItems.has(itemId)) continue;
      const item = tracked.get(itemId); if (!item) continue;
      const shortageMilli = Math.max(0, requiredMilli - Math.max(0, item.availableMilli));
      if (shortageMilli) warnings.push({ key: `${key}:${itemId}`, name: item.name, unitLabel: item.unitLabel, shortageMilli, scope });
    }
  };
  addWarnings(base, "included", "Included items");
  for (const choice of choices) {
    const choiceQuantities = quantities(choice.lines); const required = new Map(base);
    for (const [itemId, requiredMilli] of choiceQuantities) required.set(itemId, (required.get(itemId) || 0) + requiredMilli);
    addWarnings(required, choice.clientKey, `With ${choice.name.trim() || "this option"}`, new Set(choiceQuantities.keys()));
  }
  return warnings;
}

export function TradeQuoteStockNotice({ user, lines, choices }: { user: User; lines: readonly QuoteLine[]; choices: readonly QuoteChoice[] }) {
  const productIds = [...new Set([...lines, ...choices.flatMap((choice) => choice.lines)].map((line) => line.priceBookItemId).filter((id): id is string => Boolean(id)))].sort().join("|");
  const [refresh, setRefresh] = useState(0);
  const key = `${user.uid}:${productIds}:${refresh}`;
  const [result, setResult] = useState<{ key: string; items: StockItem[]; failed: boolean } | null>(null);

  useEffect(() => {
    if (!productIds) return;
    const controller = new AbortController();
    const check = async () => {
      const token = await user.getIdToken(); if (controller.signal.aborted) return;
      const response = await fetch("/api/trade-stock", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
      const data = await response.json() as StockListResponse;
      if (!response.ok || !data.ok || !Array.isArray(data.items)) throw new Error("Stock check unavailable");
      if (!controller.signal.aborted) setResult({ key, items: data.items, failed: false });
    };
    void check().catch(() => { if (!controller.signal.aborted) setResult({ key, items: [], failed: true }); });
    return () => controller.abort();
  }, [key, productIds, user]);

  if (!productIds || result?.key !== key) return null;
  if (result.failed) return <aside className={`${styles.notice} ${styles.unavailable}`} role="status" aria-live="polite"><div><strong>Stock could not be checked</strong><p>You can still save and send this quote. Check availability before the job.</p></div><button type="button" onClick={() => setRefresh((value) => value + 1)}>Check stock again</button></aside>;
  const warnings = quoteStockWarnings(lines, choices, result.items);
  if (!warnings.length) return null;
  return <aside className={styles.notice} role="status" aria-live="polite" aria-label="Quote stock reminder"><div>
    <strong>Stock to order</strong><p>You can still send this quote if stock is on its way or you will buy it for the job.</p>
    <ul>{warnings.map((warning) => <li key={warning.key}><strong>{warning.name}</strong>: {displayQuantity(warning.shortageMilli)} {unitLabels[warning.unitLabel] || warning.unitLabel.replaceAll("_", " ")} short{choices.length > 0 && <span> · {warning.scope}</span>}</li>)}</ul>
    {choices.length > 0 && <small>Each option is checked with the included items separately.</small>}
  </div><button type="button" onClick={() => setRefresh((value) => value + 1)}>Refresh stock</button></aside>;
}
