"use client";

import { useTradeBusinessFetch } from "./TradeBusinessProvider";

import { type ReactNode, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { StockDetailResponse, StockItem, StockMutation } from "@/lib/trade-stock";
import styles from "./TradePriceBookWorkspace.module.css";

export function TradeProductTableScroll({ children }: { children: ReactNode }) {
  const top = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const upper = top.current, spacer = track.current, lower = bottom.current;
    if (!upper || !spacer || !lower) return;
    const measure = () => { spacer.style.width = `${lower.scrollWidth}px`; upper.hidden = lower.scrollWidth <= lower.clientWidth; upper.scrollLeft = lower.scrollLeft; };
    const fromTop = () => { if (lower.scrollLeft !== upper.scrollLeft) lower.scrollLeft = upper.scrollLeft; };
    const fromBottom = () => { if (upper.scrollLeft !== lower.scrollLeft) upper.scrollLeft = lower.scrollLeft; };
    const observer = new ResizeObserver(measure); observer.observe(lower); if (lower.firstElementChild) observer.observe(lower.firstElementChild);
    upper.addEventListener("scroll", fromTop, { passive: true }); lower.addEventListener("scroll", fromBottom, { passive: true }); measure();
    return () => { observer.disconnect(); upper.removeEventListener("scroll", fromTop); lower.removeEventListener("scroll", fromBottom); };
  }, [children]);
  return <div className={styles.productTableFrame}>
    <div ref={top} className={styles.tableTopScroll} tabIndex={0} role="region" aria-label="Scroll product columns horizontally"><div ref={track} className={styles.tableScrollTrack} /></div>
    <div ref={bottom} className={styles.tableBottomScroll} tabIndex={0} role="region" aria-label="Product columns and bottom scrollbar">{children}</div>
  </div>;
}

export function TradeProductStockSwitch({ user, itemId, name, stock, loading, failed, canManage, onChanged, onRefresh }: {
  user: User; itemId: string; name: string; stock: StockItem | null; loading: boolean; failed: boolean; canManage: boolean;
  onChanged: (item: StockItem) => void; onRefresh: () => void;
}) {
  const fetch = useTradeBusinessFetch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<StockMutation | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);

  async function send(mutation: StockMutation) {
    if (inFlight.current || !canManage) return;
    inFlight.current = true; pending.current = mutation; setBusy(true); setError("");
    const operation = new AbortController(); controller.current = operation;
    try {
      const token = await user.getIdToken(); if (operation.signal.aborted) return;
      const response = await fetch("/api/trade-stock", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(mutation), signal: operation.signal, cache: "no-store" });
      const result = await response.json() as StockDetailResponse;
      if (!mounted.current) return;
      if (!response.ok || !result.ok) {
        setError(result.error || "The tracking change could not be confirmed.");
        if (response.status >= 500 || response.ok) setUncertain(true);
        else { pending.current = null; setUncertain(false); if (response.status === 409) onRefresh(); }
        return;
      }
      if (result.item?.itemId !== itemId) throw new Error("The tracking change could not be confirmed.");
      pending.current = null; setUncertain(false); onChanged(result.item);
    } catch (failure) { if (mounted.current) { setUncertain(true); setError(failure instanceof Error ? failure.message : "The tracking change could not be confirmed."); } }
    finally { inFlight.current = false; controller.current = null; if (mounted.current) setBusy(false); }
  }

  function toggle() {
    if (!stock || loading || failed || uncertain || !canManage || busy || inFlight.current) return;
    void send({ action: stock.tracked ? "disable" : "enable", itemId, expectedRevision: stock.revision, operationId: crypto.randomUUID(),
      ...(!stock.tracked ? { quantityMilli: stock.onHandMilli, lowStockMilli: stock.lowStockMilli } : {}) });
  }
  const known = !loading && !failed && stock !== null;
  if (!canManage) return <span className={styles.stockReadOnly}>{loading ? "Loading…" : !known ? "Unavailable" : stock.tracked ? "On" : "Off"}</span>;
  return <div className={styles.inlineStockControl}>
    <button type="button" role="switch" aria-label={`Track stock for ${name}`} aria-checked={known ? stock.tracked : false} disabled={!known || busy || uncertain} className={styles.stockSwitch} onClick={toggle}>
      <span className={styles.switchTrack} aria-hidden="true"><span /></span><span>{busy ? "Saving…" : loading ? "Loading…" : !known ? "Unavailable" : stock.tracked ? "On" : "Off"}</span>
    </button>
    {known && !stock.tracked && stock.onHandMilli > 0 && <small className={styles.pausedLabel}>Counts paused</small>}
    {error && <p className={styles.stockInlineError} role="alert">{error}{uncertain && <><span>Retry the same change safely.</span><button type="button" disabled={busy} onClick={() => { if (pending.current) void send(pending.current); }}>Retry update</button></>}</p>}
  </div>;
}
