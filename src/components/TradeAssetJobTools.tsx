"use client";

import { useEffect, useState, type ComponentProps } from "react";
import type { User } from "firebase/auth";
import { useTradeBusiness, useTradeBusinessFetch } from "./TradeBusinessProvider";
import { TradeAssetLifecycle } from "./TradeAssetLifecycle";
import { TradeHandoverCorrections } from "./TradeHandoverCorrections";
import styles from "./TradeAssetJobTools.module.css";

type AssetPack = { status: string; assets: ComponentProps<typeof TradeHandoverCorrections>["assets"] };
type Result = { ok?: boolean; pack?: AssetPack | null; error?: string };

/** Reuses the existing asset records and their established owner-only tools. */
export function TradeAssetJobTools({ user, workOrderId, label }: { user: User; workOrderId: string; label: string }) {
  const business = useTradeBusiness();
  const request = useTradeBusinessFetch();
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; pack: AssetPack | null; error: string } | null>(null);
  const allowed = business?.role === "owner";
  const key = `${user.uid}|${business?.ownerUid || ""}|${workOrderId}|${attempt}`;
  const loaded = open && allowed && result?.key === key;

  useEffect(() => {
    if (!open || !allowed) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      setResult({ key, pack: null, error: "These asset records are taking too long to load. Please try again." });
    }, 25000);
    void (async () => {
      try {
        const token = await user.getIdToken();
        if (controller.signal.aborted) return;
        const response = await request(`/api/trade-handover?workOrderId=${encodeURIComponent(workOrderId)}`, {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
        });
        const body: Result = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok || body.ok !== true) throw new Error(body.error || "These asset records could not be loaded.");
        setResult({ key, pack: body.pack || null, error: "" });
      } catch (failure) {
        if (!controller.signal.aborted) setResult({ key, pack: null, error: failure instanceof Error ? failure.message : "These asset records could not be loaded." });
      } finally { clearTimeout(timer); }
    })();
    return () => { clearTimeout(timer); controller.abort(); };
  }, [allowed, key, open, request, user, workOrderId]);

  if (!allowed) return null;
  return <details className={styles.tools} open={open} onToggle={event => {
    const next = event.currentTarget.open;
    if (next !== open) { setOpen(next); if (next) setAttempt(value => value + 1); }
  }}>
    <summary>Service schedules and asset corrections · {label}</summary>
    {open && <div className={styles.body}>
      {!loaded && <p role="status">Loading asset records...</p>}
      {loaded && result.error && <div role="alert"><p>{result.error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>}
      {loaded && !result.error && (!result.pack || !result.pack.assets.length) && <p>No saved assets were found for this job.</p>}
      {loaded && !result.error && result.pack && result.pack.assets.length > 0 && <>
        <TradeAssetLifecycle key={`lifecycle:${key}`} user={user} workOrderId={workOrderId} assets={result.pack.assets} />
        {result.pack.status === "published" && <TradeHandoverCorrections key={`corrections:${key}`} user={user} workOrderId={workOrderId} assets={result.pack.assets} />}
      </>}
    </div>}
  </details>;
}
