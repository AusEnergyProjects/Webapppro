"use client";

import { useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { useTradeBusinessFetch, useTradePersonalNameUpdate } from "./TradeBusinessProvider";

export function TradePersonalNameSettings({ user, name, onSaved }: { user: User; name: string; onSaved: (name: string) => void }) {
  const request = useTradeBusinessFetch();
  const updatePersonalName = useTradePersonalNameUpdate();
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setStatus("");
    try {
      const response = await request("/api/trade-personal-profile", { method: "PATCH",
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft }) });
      const result = await response.json() as { ok?: boolean; name?: string; error?: string };
      if (!response.ok || !result.ok || typeof result.name !== "string") throw new Error(result.error || "Your name could not be saved.");
      setDraft(result.name); updatePersonalName?.(result.name); onSaved(result.name); setStatus("Your name is saved.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Your name could not be saved."); }
    finally { setBusy(false); }
  }
  return <details className="team-field-tools"><summary>My name</summary><form onSubmit={save} style={{ display: "grid", gap: 12, marginTop: 12 }}>
    <label style={{ display: "grid", gap: 8 }}><span>My name</span><input autoComplete="name" value={draft} onChange={event => setDraft(event.target.value)} maxLength={120} required disabled={busy} /></label>
    <small>Your teammates see this name in messages and incoming calls.</small>
    <button className="btn" type="submit" disabled={busy} style={{ justifySelf: "start" }}>{busy ? "Saving..." : "Save my name"}</button>
    {status && <p role="status">{status}</p>}
  </form></details>;
}
