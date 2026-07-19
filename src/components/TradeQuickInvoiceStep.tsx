"use client";

import type { User } from "firebase/auth";
import { useCallback, useEffect, useMemo, useState } from "react";

type PriceBookItem = { id: string; name: string; itemType: string; sellPriceCentsExGst: number; taxCode: "gst" | "none" };
type Provider = { provider: string; label: string; configured: boolean; status: "connected" | "not_connected"; accountLabel: string };
type DraftLine = { clientId: string; priceBookItemId: string; description: string; unitPriceCentsExGst: number; taxCode: "gst" | "none" };

const providerKeys = new Set(["xero", "myob", "quickbooks", "stripe", "square"]);
function money(cents: number) { return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100); }
function cents(value: string) { const amount = Number(value); return Number.isFinite(amount) ? Math.round(amount * 100) : 0; }

export function TradeQuickInvoiceStep({ user, active, busy, customerName, deliveryEmail, onBack }: { user: User; active: boolean; busy: boolean; customerName: string; deliveryEmail: string; onBack: () => void }) {
  const [mode, setMode] = useState<"skip" | "send">("skip");
  const [items, setItems] = useState<PriceBookItem[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [customDescription, setCustomDescription] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [customTaxCode, setCustomTaxCode] = useState<"gst" | "none">("gst");
  const [dueDays, setDueDays] = useState("7");
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const [priceResponse, integrationResponse] = await Promise.all([
        fetch("/api/trade-price-book?status=active", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
        fetch("/api/trade-integrations", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
      ]);
      const priceResult = await priceResponse.json() as { items?: PriceBookItem[] };
      const integrationResult = await integrationResponse.json() as { providers?: Provider[] };
      if (priceResponse.ok) setItems((priceResult.items || []).filter((item) => item.sellPriceCentsExGst !== 0));
      if (integrationResponse.ok) setProviders((integrationResult.providers || []).filter((provider) => providerKeys.has(provider.provider)));
    } finally { setLoading(false); }
  }, [user]);

  useEffect(() => {
    if (!active || mode !== "send" || items.length || providers.length) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [active, items.length, mode, providers.length, refresh]);
  useEffect(() => {
    if (!active || mode !== "send") return;
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [active, mode, refresh]);
  useEffect(() => {
    if (!previewOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setPreviewOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [previewOpen]);

  const pendingLines = useMemo(() => {
    const next: DraftLine[] = [];
    const item = items.find((candidate) => candidate.id === selectedItemId);
    if (item) next.push({ clientId: `pending-price-${item.id}`, priceBookItemId: item.id, description: item.name, unitPriceCentsExGst: item.sellPriceCentsExGst, taxCode: item.taxCode });
    const amount = cents(customAmount);
    if (customDescription.trim() && amount > 0) next.push({ clientId: "pending-custom", priceBookItemId: "", description: customDescription.trim().slice(0, 180), unitPriceCentsExGst: amount, taxCode: customTaxCode });
    return next;
  }, [customAmount, customDescription, customTaxCode, items, selectedItemId]);
  const effectiveLines = useMemo(() => [...lines, ...pendingLines], [lines, pendingLines]);
  const totals = useMemo(() => effectiveLines.reduce((total, line) => {
    const tax = line.taxCode === "gst" ? Math.round(line.unitPriceCentsExGst / 10) : 0;
    return { subtotal: total.subtotal + line.unitPriceCentsExGst, tax: total.tax + tax, total: total.total + line.unitPriceCentsExGst + tax };
  }, { subtotal: 0, tax: 0, total: 0 }), [effectiveLines]);
  const connected = providers.filter((provider) => provider.status === "connected");
  const configured = providers.filter((provider) => provider.configured && provider.status !== "connected");

  function addSavedItem() {
    const item = items.find((candidate) => candidate.id === selectedItemId);
    if (!item) { setMessage("Choose a saved fixed fee first."); return; }
    setLines((current) => [...current, { clientId: crypto.randomUUID(), priceBookItemId: item.id, description: item.name, unitPriceCentsExGst: item.sellPriceCentsExGst, taxCode: item.taxCode }]);
    setSelectedItemId(""); setMessage("");
  }

  function addCustomFee() {
    const amount = cents(customAmount);
    if (!customDescription.trim() || amount <= 0) { setMessage("Add a fee description and an amount above zero."); return; }
    setLines((current) => [...current, { clientId: crypto.randomUUID(), priceBookItemId: "", description: customDescription.trim().slice(0, 180), unitPriceCentsExGst: amount, taxCode: customTaxCode }]);
    setCustomDescription(""); setCustomAmount(""); setMessage("");
  }

  async function connect(provider: Provider) {
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setMessage(`Opening ${provider.label} connection...`);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-integrations", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ provider: provider.provider }) });
      const result = await response.json() as { authorizationUrl?: string; error?: string };
      if (!response.ok || !result.authorizationUrl) throw new Error(result.error || `${provider.label} could not be opened.`);
      if (popup) popup.location.href = result.authorizationUrl;
      else window.location.assign(result.authorizationUrl);
      setMessage(`Finish connecting ${provider.label} in the new tab, then return here.`);
    } catch (error) { popup?.close(); setMessage(error instanceof Error ? error.message : `${provider.label} could not be opened.`); }
  }

  const submittedLines = effectiveLines.map((line) => ({ priceBookItemId: line.priceBookItemId, description: line.description, unitPriceCentsExGst: line.unitPriceCentsExGst, taxCode: line.taxCode }));
  const canSend = mode === "skip" || (effectiveLines.length > 0 && totals.total > 0 && consent && Boolean(deliveryEmail));
  return <section data-step="6" hidden={!active} className="crm-wizard-panel">
    <input type="hidden" name="invoiceMode" value={mode} />
    <input type="hidden" name="quickInvoiceLines" value={JSON.stringify(submittedLines)} />
    <input type="hidden" name="quickInvoiceDueDays" value={dueDays} />
    <input type="hidden" name="quickInvoiceConsent" value={consent ? "true" : "false"} />
    <header><span>6 of 6</span><h3>Invoice, optional</h3><p>Send a simple fixed-fee invoice now, or skip it and invoice later from the job.</p></header>
    <div className="crm-invoice-mode" role="radiogroup" aria-label="Quick invoice choice">
      <label className={mode === "skip" ? "selected" : ""}><input type="radio" name="invoiceChoice" checked={mode === "skip"} onChange={() => setMode("skip")} /><span><strong>Skip for now</strong><small>The job, appointment and evidence request are still created.</small></span></label>
      <label className={mode === "send" ? "selected" : ""}><input type="radio" name="invoiceChoice" checked={mode === "send"} onChange={() => setMode("send")} /><span><strong>Send a quick invoice</strong><small>Use a saved fixed fee or enter one here.</small></span></label>
    </div>
    {mode === "send" && <>
      <div className="crm-quick-invoice-builder">
        <section><header><strong>Saved fixed fee</strong><small>Prices come from your active price book.</small></header><div><select aria-label="Saved fixed fee" value={selectedItemId} onChange={(event) => setSelectedItemId(event.target.value)}><option value="">{loading ? "Loading saved fees..." : items.length ? "Choose a saved fee" : "No saved fees yet"}</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name} | {money(item.sellPriceCentsExGst)}{item.taxCode === "gst" ? " + GST" : " GST-free"}</option>)}</select><button type="button" onClick={addSavedItem}>Add</button></div></section>
        <section><header><strong>Custom fixed fee</strong><small>Enter the amount before GST.</small></header><div className="custom"><input aria-label="Custom fee description" maxLength={180} placeholder="Call-out fee" value={customDescription} onChange={(event) => setCustomDescription(event.target.value)} /><input aria-label="Custom fee amount before GST" type="number" min="0.01" max="100000" step="0.01" placeholder="0.00" value={customAmount} onChange={(event) => setCustomAmount(event.target.value)} /><select aria-label="Custom fee GST" value={customTaxCode} onChange={(event) => setCustomTaxCode(event.target.value as "gst" | "none")}><option value="gst">Add GST</option><option value="none">GST-free</option></select><button type="button" onClick={addCustomFee}>Add</button></div></section>
      </div>
      {effectiveLines.length > 0 && <div className="crm-quick-invoice-draft"><div className="head"><span>Invoice line</span><span>Amount</span></div>{effectiveLines.map((line) => <div key={line.clientId}><span><strong>{line.description}</strong><small>{line.clientId.startsWith("pending-") ? "Included when you send" : line.taxCode === "gst" ? "GST added" : "GST-free"}</small></span><b>{money(line.unitPriceCentsExGst)}</b>{line.clientId.startsWith("pending-") ? <span /> : <button type="button" aria-label={`Remove ${line.description}`} onClick={() => setLines((current) => current.filter((item) => item.clientId !== line.clientId))}>Remove</button>}</div>)}<dl><div><dt>Subtotal</dt><dd>{money(totals.subtotal)}</dd></div><div><dt>GST</dt><dd>{money(totals.tax)}</dd></div><div className="total"><dt>Total</dt><dd>{money(totals.total)}</dd></div></dl></div>}
      <div className="crm-form-grid crm-quick-invoice-options"><label><span>Payment due</span><select value={dueDays} onChange={(event) => setDueDays(event.target.value)}><option value="0">Today</option><option value="7">In 7 days</option><option value="14">In 14 days</option><option value="30">In 30 days</option></select></label><label className="crm-consent-confirm"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span><strong>Send invoice by email to {deliveryEmail || "this customer"}</strong><small>I confirm the customer asked to receive this invoice.</small></span></label></div>
      {connected.length > 0 ? <div className="crm-connected-provider-note"><strong>Connected</strong><span>{connected.map((provider) => provider.label).join(", ")}. Connection prompts stay hidden while a financial provider is connected.</span></div> : <details className="crm-invoice-connect-prompt"><summary>Connect accounting or payments, optional</summary><p>TLink can send this invoice without a connection. Connect a service now if you also want it available in your invoice workspace.</p>{configured.length > 0 ? <div>{configured.map((provider) => <button type="button" key={provider.provider} onClick={() => void connect(provider)}>Connect {provider.label}</button>)}</div> : <small>Provider connections are not enabled for this workspace yet. You can still send the TLink invoice.</small>}</details>}
    </>}
    {message && <div className="crm-wizard-message" role="status">{message}</div>}
    <div className="crm-final-summary"><strong>Ready to schedule</strong><span>{customerName}</span><small>{mode === "send" ? "The job, appointment, evidence request and quick invoice are saved together." : "The job, appointment and secure evidence request are saved together."}</small></div>
    {mode === "send" && !canSend && <div className="crm-wizard-message" role="status">{!effectiveLines.length ? "Choose or enter at least one fee." : !deliveryEmail ? "Add a customer email before sending." : !consent ? "Confirm the customer asked to receive this invoice." : "Check the invoice details."}</div>}
    <div className="crm-wizard-actions"><button type="button" onClick={onBack}>Back</button>{mode === "send"
      ? <button type="button" className="btn" disabled={busy || !canSend} onClick={() => setPreviewOpen(true)}>Preview invoice and finish</button>
      : <button type="submit" className="btn" disabled={busy}>{busy ? "Scheduling..." : "Schedule and request info"}</button>}</div>
    {previewOpen && <div className="crm-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setPreviewOpen(false); }}>
      <section className="crm-invoice-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="new-invoice-preview-title">
        <header><div><span>Check before sending</span><strong id="new-invoice-preview-title">Invoice preview</strong><small>Customer: {customerName}</small></div><button type="button" onClick={() => setPreviewOpen(false)} aria-label="Close invoice preview">Close</button></header>
        <div className="crm-invoice-preview-lines">{effectiveLines.map((line) => <div key={line.clientId}><span><strong>{line.description}</strong><small>{line.taxCode === "gst" ? "GST added" : "GST-free"}</small></span><b>{money(line.unitPriceCentsExGst)}</b></div>)}</div>
        <dl><div><dt>Subtotal</dt><dd>{money(totals.subtotal)}</dd></div><div><dt>GST</dt><dd>{money(totals.tax)}</dd></div><div className="total"><dt>Total</dt><dd>{money(totals.total)}</dd></div><div><dt>Payment due</dt><dd>{dueDays === "0" ? "Today" : `In ${dueDays} days`}</dd></div></dl>
        <p>This invoice will be emailed to <strong>{deliveryEmail}</strong> with the appointment and photo request.</p>
        <footer><button type="button" onClick={() => setPreviewOpen(false)}>Go back and edit</button><button type="submit" className="btn" disabled={busy}>{busy ? "Scheduling and sending..." : "Confirm and send"}</button></footer>
      </section>
    </div>}
  </section>;
}
