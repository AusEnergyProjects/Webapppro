"use client";

import { useCallback, useEffect, useState } from "react";

type Setting = { channel: string; provider: string; enabled: boolean; configured: boolean; senderLabel: string; dailyLimit: number; revision: number; updatedAt: string };
type Count = { channel: string; status: string; total: number };
type Failure = { id: string; channel: string; provider: string; status: string; attempts: number; providerStatus: string; lastError: string; updatedAt: string };
type Result = { settings?: Setting[]; counts?: Count[]; failures?: Failure[] };

export function AdminServiceReminderDelivery({ api, setStatus }: { api: (path: string, init?: RequestInit) => Promise<Record<string, unknown>>; setStatus: (value: string) => void }) {
  const [data, setData] = useState<Result>({}); const [busy, setBusy] = useState("");
  const load = useCallback(async () => { try { setData(await api("/api/admin/service-reminder-delivery") as Result); } catch (error) { setStatus(error instanceof Error ? error.message : "Reminder delivery health could not be loaded."); } }, [api, setStatus]);
  useEffect(() => { const frame = window.requestAnimationFrame(() => void load()); return () => window.cancelAnimationFrame(frame); }, [load]);
  async function save(setting: Setting, updates: Partial<Setting>) {
    setBusy(setting.channel); setStatus("Saving protected reminder channel settings...");
    try {
      const next = { ...setting, ...updates }; const result = await api("/api/admin/service-reminder-delivery", { method: "PATCH", body: JSON.stringify({ channel: setting.channel,
        enabled: next.enabled, senderLabel: next.senderLabel, dailyLimit: next.dailyLimit, expectedRevision: setting.revision }) }) as Result;
      setData(result); setStatus(`${setting.channel === "email" ? "Email" : "SMS"} reminder settings saved and audited.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Reminder channel settings could not be saved."); }
    finally { setBusy(""); }
  }
  return <section className="admin-panel admin-reminder-delivery"><div className="admin-panel-heading"><span>Customer communications</span><h2>Service reminder delivery</h2><p>Provider credentials stay in protected Sites secrets. A channel can be enabled only after authenticated delivery callbacks are ready.</p></div><div className="admin-reminder-channels">{(data.settings || []).map((setting) => <article key={setting.channel}><header><div><strong>{setting.channel === "email" ? "Email" : "SMS"}</strong><small>{setting.provider} | {setting.configured ? "credentials and callbacks ready" : "provider setup required"}</small></div><span className={setting.enabled ? "ready" : "attention"}>{setting.enabled ? "Enabled" : "Disabled"}</span></header><label>Daily safety limit<input type="number" min="1" max="1000" defaultValue={setting.dailyLimit} onBlur={(event) => { const dailyLimit = Number(event.target.value); if (dailyLimit !== setting.dailyLimit) void save(setting, { dailyLimit }); }} /></label><button type="button" disabled={Boolean(busy) || (!setting.configured && !setting.enabled)} onClick={() => void save(setting, { enabled: !setting.enabled })}>{setting.enabled ? "Disable channel" : "Enable channel"}</button><small>{(data.counts || []).filter((item) => item.channel === setting.channel).map((item) => `${item.total} ${item.status}`).join(" | ") || "No deliveries yet"}</small></article>)}</div>{Boolean(data.failures?.length) && <details><summary>Recent failed or suppressed deliveries</summary><div className="admin-reminder-failures">{data.failures?.map((item) => <article key={item.id}><strong>{item.channel.toUpperCase()} | {item.status}</strong><span>{item.providerStatus || item.lastError || "Provider did not supply a reason"}</span><small>{new Date(item.updatedAt).toLocaleString("en-AU")}</small></article>)}</div></details>}</section>;
}
