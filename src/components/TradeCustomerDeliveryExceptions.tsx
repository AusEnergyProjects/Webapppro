"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { useTradeBusiness, useTradeBusinessFetch } from "./TradeBusinessProvider";
import type { CustomerDeliveryExceptions, CustomerDeliveryTab } from "@/lib/trade-customer-delivery-exceptions";
import styles from "./TradeCustomerDeliveryExceptions.module.css";

type Result = Partial<CustomerDeliveryExceptions> & { ok?: boolean; error?: string };

export function TradeCustomerDeliveryExceptions({ user, workOrderId = "", onOpenJob }: {
  user: User;
  workOrderId?: string;
  onOpenJob: (id: string, tab: CustomerDeliveryTab) => void;
}) {
  const fetch = useTradeBusinessFetch();
  const business = useTradeBusiness();
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [response, setResponse] = useState<{ key: string; data: Result; error: string }>({ key: "", data: {}, error: "" });
  const requestKey = JSON.stringify([user.uid, business?.ownerUid, workOrderId, page, refresh]);
  const loading = response.key !== requestKey;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      if (active) setResponse({ key: requestKey, data: {}, error: "Email delivery checks took too long. Try again." });
    }, 25000);
    void (async () => {
      try {
        const token = await user.getIdToken();
        if (!active || controller.signal.aborted) return;
        const params = new URLSearchParams({ page: String(page) });
        if (workOrderId) params.set("workOrderId", workOrderId);
        const result = await fetch(`/api/trade-customer-delivery-exceptions?${params}`, {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
        });
        const data = await result.json() as Result;
        if (!result.ok || !data.ok || !Array.isArray(data.items) || typeof data.total !== "number") throw new Error(data.error || "Email delivery checks could not be loaded.");
        if (active && !controller.signal.aborted) setResponse({ key: requestKey, data, error: "" });
      } catch (error) {
        if (active && !controller.signal.aborted) setResponse({ key: requestKey, data: {}, error: error instanceof Error ? error.message : "Email delivery checks could not be loaded." });
      } finally { clearTimeout(timer); }
    })();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [fetch, user, workOrderId, page, requestKey]);

  return <section className={styles.panel} aria-label="Customer email delivery">
    <header><div><h3>Customer emails{!loading && !response.error && Boolean(response.data.total) && <span>{response.data.total} to review</span>}</h3><p>Review delivery issues before sending another copy.</p></div>
      <button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh</button>
    </header>
    {loading ? <p role="status">Checking delivery records…</p> : response.error ? <p role="alert">{response.error}</p> : <>
      {response.data.items?.length ? <ul>{response.data.items.map(item => <li key={item.id}>
        <div><strong>{item.label}</strong><span>{item.workNumber} · {item.jobTitle}</span><p>{item.message}</p></div>
        <button type="button" onClick={() => onOpenJob(item.workOrderId, item.tab)}>Review</button>
      </li>)}</ul> : <p className={styles.empty}>No failed or uncertain emails in the current delivery records.</p>}
      {(page > 1 || response.data.hasNext) && <nav aria-label="Email delivery pages"><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page}</span><button type="button" disabled={!response.data.hasNext} onClick={() => setPage(value => value + 1)}>Next</button></nav>}
    </>}
  </section>;
}
