"use client";

import { useEffect, useState } from "react";
import { tradeDocumentSamples, type DocumentSampleSettings } from "@/lib/trade-document-sample";

export function TradeDocumentSamplePreview({ settings, logoSrc }: { settings: DocumentSampleSettings; logoSrc: string }) {
  const [kind, setKind] = useState<"quote" | "invoice">("quote");
  const [opened, setOpened] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pdf, setPdf] = useState<{ url: string; key: string } | null>(null);
  const [error, setError] = useState("");
  const input = JSON.stringify(settings);
  const key = `${kind}:${input}:${logoSrc}:${retry}`;
  useEffect(() => {
    if (!opened) return;
    let active = true; let url = "";
    const controller = new AbortController();
    const timer = window.setTimeout(() => { controller.abort(); if (active) setError("The sample took too long to load. Try again."); }, 20000);
    void (async () => {
      try {
        const read = async (path: string) => { const response = await fetch(path, { signal: controller.signal }); if (!response.ok) throw new Error("A document preview asset could not be loaded."); return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") || "" }; };
        const [regular, bold, logo] = await Promise.all([read("/fonts/LiberationSans-Regular.ttf"), read("/fonts/LiberationSans-Bold.ttf"), logoSrc ? read(logoSrc) : undefined]);
        const samples = tradeDocumentSamples(JSON.parse(input) as DocumentSampleSettings);
        const fonts = { regular: regular.bytes, bold: bold.bytes };
        const assets = { logo };
        const bytes = kind === "quote" ? await (await import("@/lib/trade-quote-pdf.mjs")).createTradeQuotePdfBytes(samples.quote, fonts, assets)
          : await (await import("@/lib/trade-quick-invoice-pdf.mjs")).createTradeQuickInvoicePdfBytes(samples.invoice, fonts, assets);
        if (!active || controller.signal.aborted) return;
        url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
        setPdf({ url, key }); setError("");
      } catch (caught) { if (active && !controller.signal.aborted) setError(caught instanceof Error ? caught.message : "The sample could not be generated."); }
      finally { clearTimeout(timer); }
    })();
    return () => { active = false; controller.abort(); clearTimeout(timer); if (url) URL.revokeObjectURL(url); };
  }, [opened, kind, input, logoSrc, key]);
  const ready = pdf?.key === key;
  return <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
    <div role="group" aria-label="Sample document" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{(["quote", "invoice"] as const).map(value => <button type="button" key={value} className="btn" aria-pressed={kind === value} onClick={() => { setKind(value); setOpened(true); setError(""); }}>{value === "quote" ? "Preview sample quote" : "Preview sample invoice"}</button>)}</div>
    <p>Your current logo, colours, contact details and terms appear in the actual PDF layout. Save any setting changes to use them on future documents. Samples do not create jobs, invoices or emails.</p>
    {opened && !ready && !error && <p role="status">Generating your sample PDF...</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => { setError(""); setRetry(value => value + 1); }}>Try again</button></p>}
    {ready && pdf && <><a className="btn" href={pdf.url} download={`TLink-sample-${kind}.pdf`}>Download sample {kind}</a><iframe title={`Actual sample ${kind} PDF`} src={pdf.url} style={{ width: "100%", height: "min(80vh,900px)", minHeight: 440, border: "1px solid var(--trade-line)", borderRadius: 8, background: "#eee" }} /></>}
  </div>;
}
