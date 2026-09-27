"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { MAX_PRODUCT_DOCUMENT_BYTES, MAX_PRODUCT_DOCUMENTS, MAX_PRODUCT_DOCUMENT_PAGES, type ProductDocumentMetadata } from "@/lib/trade-price-book-documents";
import styles from "./TradeProductDocuments.module.css";

type Result = { ok?: boolean; error?: string; documents?: ProductDocumentMetadata[]; document?: ProductDocumentMetadata };

export function TradeProductDocuments({ user, itemId, canManage, disabled = false }: { user: User; itemId: string; canManage: boolean; disabled?: boolean }) {
  const [documents, setDocuments] = useState<ProductDocumentMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const [reload, setReload] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const requestInProgress = useRef(false);
  const mounted = useRef(true);
  const previewUrl = useRef("");
  const actionController = useRef<AbortController | null>(null);
  const path = `/api/trade-price-book/documents?itemId=${encodeURIComponent(itemId)}`;

  const request = useCallback(async (suffix = "", init: RequestInit = {}) => {
    const token = await user.getIdToken();
    if (init.signal?.aborted) throw new DOMException("Request cancelled.", "AbortError");
    const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(`${path}${suffix}`, { ...init, headers, cache: "no-store" });
    if (!response.ok) {
      const result: Result = await response.json().catch(() => ({}));
      throw new Error(result.error || "The product document could not be loaded. Try again.");
    }
    return response;
  }, [path, user]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; actionController.current?.abort(); if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); previewUrl.current = ""; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void request("", { signal: controller.signal }).then(async (response) => {
      const result: Result = await response.json();
      if (!result.ok || !Array.isArray(result.documents) || result.documents.some((document) => document.priceBookItemId !== itemId)) throw new Error("Could not load product documents. Try again.");
      if (!controller.signal.aborted) { setDocuments(result.documents); setLoaded(true); setLoadError(""); }
    }).catch((failure: unknown) => { if (!controller.signal.aborted) { setLoaded(false); setLoadError(failure instanceof Error ? failure.message : "Could not load product documents."); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [request, reload, itemId]);

  async function upload(file: File) {
    if (requestInProgress.current || !canManage || disabled || loading || !loaded) return;
    setError(""); setMessage("");
    if (documents.length >= MAX_PRODUCT_DOCUMENTS) { setError(`This product already has ${MAX_PRODUCT_DOCUMENTS} PDFs. Remove one before adding another.`); return; }
    if (!file.name.toLowerCase().endsWith(".pdf") || (file.type && file.type !== "application/pdf")) { setError("Choose a PDF document."); return; }
    if (!file.size || file.size > MAX_PRODUCT_DOCUMENT_BYTES) { setError(`Choose a PDF up to ${MAX_PRODUCT_DOCUMENT_BYTES / 1024 / 1024} MB.`); return; }
    requestInProgress.current = true; setBusy("upload");
    const controller = new AbortController(); actionController.current = controller;
    try {
      const response = await request(`&filename=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: file, signal: controller.signal });
      const result: Result = await response.json();
      if (!result.ok || !result.document || result.document.priceBookItemId !== itemId) throw new Error("The upload was not confirmed. Refresh the document list before trying again.");
      const document = result.document;
      if (mounted.current) { setDocuments((items) => [...items.filter((item) => item.id !== document.id), document]); setMessage("PDF added. Its pages will be included when this product is quoted."); }
    } catch (failure) { if (mounted.current) { setError(failure instanceof Error ? failure.message : "The PDF could not be uploaded."); setLoading(true); setReload((value) => value + 1); } }
    finally { actionController.current = null; requestInProgress.current = false; if (mounted.current) setBusy(""); }
  }

  function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    if (files.length !== 1) { setError("Choose one PDF at a time."); return; }
    void upload(files[0]);
  }

  async function open(document: ProductDocumentMetadata) {
    if (requestInProgress.current) return;
    requestInProgress.current = true; setBusy(document.id); setError("");
    const controller = new AbortController(); actionController.current = controller;
    try {
      const response = await request(`&documentId=${encodeURIComponent(document.id)}`, { signal: controller.signal });
      const blob = await response.blob();
      if (blob.type.split(";")[0] !== "application/pdf") throw new Error("The document preview could not be verified.");
      if (mounted.current) {
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = URL.createObjectURL(blob); setPreview({ name: document.fileName, url: previewUrl.current });
      }
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "Could not preview the PDF."); }
    finally { actionController.current = null; requestInProgress.current = false; if (mounted.current) setBusy(""); }
  }

  async function remove(document: ProductDocumentMetadata) {
    if (requestInProgress.current || !canManage || disabled) return;
    requestInProgress.current = true; setBusy(document.id); setError(""); setMessage("");
    const controller = new AbortController(); actionController.current = controller;
    try {
      const response = await request(`&documentId=${encodeURIComponent(document.id)}`, { method: "DELETE", signal: controller.signal });
      const result: Result = await response.json();
      if (!result.ok) throw new Error(result.error || "Could not remove the product document.");
      if (mounted.current) { setDocuments((items) => items.filter((item) => item.id !== document.id)); closePreview(); setMessage("Removed from future quotes. Existing saved quotes retain their documents."); }
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "Could not remove the product document."); }
    finally { actionController.current = null; requestInProgress.current = false; if (mounted.current) setBusy(""); }
  }

  function closePreview() { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); previewUrl.current = ""; setPreview(null); }
  return <section className={styles.documents} aria-label="Product PDFs">
    <header><div><strong>Product PDFs</strong><p>Upload a warranty, brochure or datasheet once. Its pages are added to quotes that use this product.</p></div>
      {canManage && <><input ref={fileInput} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => { uploadFiles(event.target.files); event.target.value = ""; }} /><button type="button" disabled={disabled || loading || !loaded || Boolean(busy) || documents.length >= MAX_PRODUCT_DOCUMENTS} onClick={() => fileInput.current?.click()}>{busy === "upload" ? "Uploading PDF…" : "Upload PDF"}</button></>}
    </header>
    {canManage && <div className={`${styles.dropZone}${dragging ? ` ${styles.dragging}` : ""}`} onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); if (!disabled && !busy && !loading && loaded) setDragging(true); } }} onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={(event) => {
      event.preventDefault(); setDragging(false);
      if (disabled || busy || loading || !loaded) return;
      uploadFiles(event.dataTransfer.files);
    }}><strong>Drop a PDF here</strong><span>Warranty, brochure or datasheet</span></div>}
    {loading ? <p role="status">Loading documents…</p> : <ul>{documents.map((document) => <li key={document.id}><div><strong>{document.label || document.fileName}</strong><span>{document.pageCount} {document.pageCount === 1 ? "page" : "pages"} · {(document.sizeBytes / 1024 / 1024).toFixed(1)} MB</span></div><div className={styles.actions}><button type="button" disabled={Boolean(busy)} onClick={() => void open(document)}>View</button>{canManage && <button type="button" disabled={disabled || Boolean(busy)} onClick={() => void remove(document)} aria-label={`Remove ${document.fileName}`}>Remove</button>}</div></li>)}</ul>}
    <small>Up to {MAX_PRODUCT_DOCUMENTS} PDFs, {MAX_PRODUCT_DOCUMENT_BYTES / 1024 / 1024} MB and {MAX_PRODUCT_DOCUMENT_PAGES} pages each. Previously issued quotes keep their original documents.</small>
    {loadError && <p role="alert">{loadError} <button type="button" disabled={loading || Boolean(busy)} onClick={() => { setLoading(true); setReload((value) => value + 1); }}>Load documents again</button></p>}
    {error && <p role="alert">{error} <button type="button" disabled={Boolean(busy)} onClick={() => { setLoading(true); setReload((value) => value + 1); }}>Refresh documents</button></p>}
    {message && <p role="status">{message}</p>}
    {preview && <div className={styles.preview}><div><strong>{preview.name}</strong><button type="button" onClick={closePreview}>Close PDF</button></div><iframe title={preview.name} src={preview.url} /><div className={styles.previewLinks}><a href={preview.url} download={preview.name}>Download PDF</a><a href={preview.url} target="_blank" rel="noopener noreferrer">Open PDF in a new tab</a></div></div>}
  </section>;
}
