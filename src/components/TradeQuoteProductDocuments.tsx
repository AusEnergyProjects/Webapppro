"use client";

import { useTradeBusinessFetch } from "./TradeBusinessProvider";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import type { QuoteProductDocumentSummary } from "@/lib/trade-quote-product-documents";
import styles from "./TradeQuoteLivePreview.module.css";

export function QuoteProductDocuments({ documents, choices = [] }: { documents: QuoteProductDocumentSummary[]; choices?: { id: string; name: string }[] }) {
  if (!documents.length) return null;
  return <section className={styles.productDocuments} aria-label="Included product documents"><h6>Product documents</h6><p>These PDF pages are included at the end of the quote.</p><ul>{documents.map((document) => <li key={document.id}><strong>{document.label}</strong><span>{document.pageCount} {document.pageCount === 1 ? "page" : "pages"}{document.choiceKeys.length ? ` | Offered option: ${document.choiceKeys.map((key) => choices.find((choice) => choice.id === key)?.name || "Customer choice").join(" / ")}` : ""}</span></li>)}</ul></section>;
}

export function QuoteCompletePdfPreview({ user, workOrderId, versionId, expectedUpdatedAt, dirty, revisionKey }: { user: User; workOrderId: string; versionId?: string; expectedUpdatedAt?: string; dirty: boolean; revisionKey: string }) {
  const fetch = useTradeBusinessFetch();
  const [result, setResult] = useState<{ key: string; url: string; error: string } | null>(null);
  const [requested, setRequested] = useState<{ key: string; attempt: number } | null>(null);
  const key = `${user.uid}:${workOrderId}:${versionId}:${expectedUpdatedAt}:${revisionKey}:${dirty}`;
  useEffect(() => {
    if (!versionId || dirty || requested?.key !== key) return;
    const controller = new AbortController();
    let objectUrl = "";
    void user.getIdToken().then((token) => fetch(`/api/trade-quotes?workOrderId=${encodeURIComponent(workOrderId)}&media=pdf&versionId=${encodeURIComponent(versionId)}${expectedUpdatedAt ? `&expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}` : ""}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
    })).then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).error || "The complete PDF could not be loaded.");
      const blob = await response.blob();
      if (blob.type !== "application/pdf") throw new Error("The complete PDF could not be verified.");
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setResult({ key, url: objectUrl, error: "" });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({ key, url: "", error: error instanceof Error ? error.message : "Could not load the complete PDF." });
    });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [fetch, dirty, expectedUpdatedAt, key, requested, user, versionId, workOrderId]);
  const current = result?.key === key ? result : null;
  return <div className={styles.completePdf}>{!versionId || dirty ? <p>Save draft to refresh product documents and view the complete PDF.</p> : <>
    <button type="button" onClick={() => { setResult(null); setRequested((previous) => ({ key, attempt: (previous?.attempt || 0) + 1 })); }} disabled={requested?.key === key && !current}>{requested?.key === key && !current ? "Preparing PDF..." : "View complete PDF"}</button>
    {current?.error && <p role="alert">{current.error}</p>}
    {current?.url && <><a href={current.url} download="quote.pdf">Download PDF</a><a href={current.url} target="_blank" rel="noreferrer">Open PDF in a new tab</a><iframe title="Complete quote PDF with product documents" src={current.url} /></>}
  </>}</div>;
}
