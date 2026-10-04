"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./CustomerHubFilePreview.module.css";

export function CustomerHubFilePreview({ file, question, fileUrl, request, isCurrent, onClose,
  ownerLabel = "Customer upload", customer = false }: {
  file: { id: string; name: string; type: string }; question: string; fileUrl: string;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  isCurrent: () => boolean; onClose: () => void; ownerLabel?: string; customer?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const source = JSON.stringify([fileUrl, file.id, file.type]);
  const [content, setContent] = useState({ source: "", url: "", error: "" });
  const url = content.source === source ? content.url : "";
  const error = content.source === source ? content.error : "";
  const pdf = file.type === "application/pdf";
  const subject = customer ? "Your" : "Customer";
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    element?.showModal(); document.body.style.overflow = "hidden";
    return () => {
      element?.close(); document.body.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); let objectUrl = "";
    const current = () => !controller.signal.aborted && isCurrent();
    void (async () => {
      try {
        if (!current()) return;
        const response = await request(fileUrl, { cache: "no-store", signal: controller.signal });
        if (!current()) return;
        if (!response.ok) throw new Error("This shared file is no longer available. Close the preview and refresh Customer Q&A.");
        const blob = await response.blob();
        if (!current()) return;
        if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(blob.type) || blob.type !== file.type) throw new Error("This file could not be safely previewed.");
        objectUrl = URL.createObjectURL(blob); setContent({ source, url: objectUrl, error: "" });
      } catch (failure) { if (current()) setContent({ source, url: "", error: failure instanceof Error ? failure.message : "The preview could not be opened." }); }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [source, fileUrl, file.type, isCurrent, request]);
  return <dialog ref={dialog} className={`${styles.preview}${customer ? ` ${styles.customer}` : ""}`} aria-label={`${subject} ${pdf ? "PDF" : "photo"} preview`}
    onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={styles.previewLayout}><header><div><span>{ownerLabel}</span><h2>{pdf ? "Document preview" : "Photo preview"}</h2><p>{question}</p></div><button type="button" onClick={onClose} aria-label="Close file preview" autoFocus>Close</button></header>
      <div className={styles.previewContent} aria-busy={!url && !error}>
        {!url && !error && <p role="status">Opening {subject.toLowerCase()} {pdf ? "document" : "photo"}...</p>}
        {error && <p role="alert">{error}</p>}
        {/* Chrome blocks its native PDF viewer in sandboxed iframes. Only an authenticated,
            exact application/pdf blob is allowed here; HTML and SVG are never embedded. */}
        {url && (pdf ? <iframe title={`${subject} document: ${file.name}`} src={url} referrerPolicy="no-referrer" />
          // Authenticated local object URL, revoked when this preview closes.
          // eslint-disable-next-line @next/next/no-img-element
          : <img src={url} alt={`${subject} photo for: ${question}`} onError={() => setContent({ source, url, error: "This photo could not be displayed. You can download the file below." })} />)}
      </div><footer><small>{file.name}</small>{url && <a href={url} download={file.name} onClick={event => { if (!isCurrent()) { event.preventDefault(); onClose(); } }}>Download</a>}</footer>
    </div>
  </dialog>;
}
