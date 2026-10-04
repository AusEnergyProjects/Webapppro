"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { useTradeBusiness, useTradeBusinessFetch } from "./TradeBusinessProvider";
import { canReviewCustomerDeliveries, type CustomerDeliveryExceptions, type CustomerDeliveryPermissions, type CustomerDeliveryTab } from "@/lib/trade-customer-delivery-exceptions";
import { TradeTasksWorkspace } from "./TradeTasksWorkspace";
import styles from "./TradeCustomerDeliveryExceptions.module.css";

type Result = Partial<CustomerDeliveryExceptions> & { ok?: boolean; error?: string };

export function TradeCustomerDeliveryExceptions({ user, workOrderId = "", permissions, refreshKey = 0, onOpenJob }: {
  user: User;
  workOrderId?: string;
  permissions?: CustomerDeliveryPermissions;
  refreshKey?: number;
  onOpenJob: (id: string, tab: CustomerDeliveryTab) => void;
}) {
  const fetch = useTradeBusinessFetch();
  const business = useTradeBusiness();
  const scopeKey = JSON.stringify([user.uid, business?.ownerUid, business?.memberId, workOrderId, permissions]);
  const allowed = canReviewCustomerDeliveries(permissions);
  const [paging, setPaging] = useState({ key: "", page: 1 });
  const page = paging.key === scopeKey ? paging.page : 1;
  const setPage = (value: number) => setPaging({ key: scopeKey, page: value });
  const [refresh, setRefresh] = useState(0);
  const [handover, setHandover] = useState({ key: "", id: "" });
  const [assigned, setAssigned] = useState<string[]>([]);
  const [response, setResponse] = useState<{ key: string; data: Result; error: string }>({ key: "", data: {}, error: "" });
  const requestKey = JSON.stringify([scopeKey, page, refresh, refreshKey]);
  const loading = response.key !== requestKey;
  useEffect(() => {
    if (!allowed) return;
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
  }, [fetch, user, workOrderId, page, requestKey, allowed]);

  if (!allowed) return null;
  const selected = !loading && !response.error && handover.key === requestKey
    ? response.data.items?.find(item => item.id === handover.id) : undefined;
  const reviewLabel = (tab: CustomerDeliveryTab) => tab === "quote" ? "Review quote" : tab === "invoice" ? "Review invoice" : tab === "schedule" ? "Review booking" : tab === "files" ? "Review report" : "Review delivery";

  return <section className={styles.panel} aria-label="Customer email delivery">
    <header><div><h3>Customer emails{!loading && !response.error && Boolean(response.data.total) && <span>{response.data.total} to review</span>}</h3><p>Review delivery issues before sending another copy.</p></div>
      <button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh</button>
    </header>
    {loading ? <p role="status">Checking delivery records…</p> : response.error ? <p role="alert">{response.error}</p> : <>
      {response.data.items?.length ? <ul>{response.data.items.map(item => <li key={item.id}>
        <div><strong>{item.label}</strong><span>{item.workNumber} · {item.jobTitle}</span><p>{item.message}</p></div>
        <div className={styles.actions}><button type="button" onClick={() => onOpenJob(item.workOrderId, item.tab)}>{reviewLabel(item.tab)}</button>
          {assigned.includes(`${scopeKey}:${item.id}`) ? <span role="status">Follow-up task added</span> : <button type="button" className={styles.secondary} aria-expanded={selected?.id === item.id} onClick={() => setHandover(selected?.id === item.id ? { key: "", id: "" } : { key: requestKey, id: item.id })}>Assign follow-up</button>}
        </div>
      </li>)}</ul> : <p className={styles.empty}>No failed or uncertain emails in the delivery records available to you.</p>}
      {selected && <div className={styles.handover}>
        <p>Assign someone to check {selected.workNumber}. Their existing job access still applies. The delivery issue stays here until its source record is resolved.</p>
        <TradeTasksWorkspace user={user} compact draft={{ key: `${scopeKey}:${selected.id}`, title: `Review ${selected.label.toLowerCase()} for ${selected.workNumber}`.slice(0, 180),
          detail: `${selected.workNumber}: ${selected.label}. ${selected.message}\nOpen the job and review its ${selected.tab === "schedule" ? "booking" : selected.tab} delivery before sending another copy. Complete this task after checking the source record.\nJob: /direct-trade/dashboard?${new URLSearchParams({ workspace: "work", jobId: selected.workOrderId, jobTab: selected.tab, business: business?.ownerUid || user.uid })}` }}
          onCreated={() => { setAssigned(current => [...current, `${scopeKey}:${selected.id}`]); setHandover({ key: "", id: "" }); }} />
        <button type="button" className={styles.secondary} onClick={() => setHandover({ key: "", id: "" })}>Cancel handover</button>
      </div>}
      {(page > 1 || response.data.hasNext) && <nav aria-label="Email delivery pages"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page}</span><button type="button" disabled={!response.data.hasNext} onClick={() => setPage(page + 1)}>Next</button></nav>}
    </>}
  </section>;
}
