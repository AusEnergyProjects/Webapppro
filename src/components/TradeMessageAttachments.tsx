"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { MessageAttachment, MessageMediaAuth } from "@/lib/trade-message-media";
import { prepareMessagePhoto, removePrivateMessageFile, startVoiceNoteCapture, uploadPrivateMessageFile } from "@/lib/trade-message-media-client";
import styles from "./TradeMessageAttachments.module.css";

function PrivateAttachment({ attachment, getAuthHeaders }: { attachment: MessageAttachment; getAuthHeaders: MessageMediaAuth }) {
  const [loaded, setLoaded] = useState({ id: "", url: "", error: false });
  useEffect(() => {
    const controller = new AbortController(); let objectUrl = "";
    void (async () => {
      try {
        const response = await fetch(`/api/trade-message-media?id=${encodeURIComponent(attachment.id)}`, { headers: await getAuthHeaders(), cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Attachment unavailable");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob); setLoaded({ id: attachment.id, url: objectUrl, error: false });
      } catch { if (!controller.signal.aborted) setLoaded({ id: attachment.id, url: "", error: true }); }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment.id, getAuthHeaders]);
  const url = loaded.id === attachment.id ? loaded.url : "";
  if (loaded.id === attachment.id && loaded.error) return <span className={styles.status}>Attachment unavailable. Refresh the conversation to retry.</span>;
  if (!url) return <span className={styles.status}>Loading {attachment.kind === "audio" ? "voice note" : "photo"}…</span>;
  return attachment.kind === "audio" ? <audio className={styles.audio} controls preload="metadata" src={url} aria-label="Voice note" /> :
    <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open photo"><Image className={styles.photo} src={url} unoptimized width={320} height={240} alt="Photo shared in the conversation" /></a>;
}

export function TradeMessageAttachmentList({ attachments, getAuthHeaders }: { attachments: MessageAttachment[]; getAuthHeaders: MessageMediaAuth }) {
  if (!attachments.length) return null;
  return <div className={styles.attachments}>{attachments.map(attachment => <PrivateAttachment key={attachment.id} attachment={attachment} getAuthHeaders={getAuthHeaders} />)}</div>;
}

export default function TradeMessageAttachments({ threadId, value, onChange, getAuthHeaders, disabled = false, onBusyChange }: {
  threadId: string; value: MessageAttachment[]; onChange: (value: MessageAttachment[]) => void; getAuthHeaders: MessageMediaAuth; disabled?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false), [recording, setRecording] = useState(false), [error, setError] = useState("");
  const upload = useRef<HTMLInputElement>(null), camera = useRef<HTMLInputElement>(null);
  const capture = useRef<Awaited<ReturnType<typeof startVoiceNoteCapture>> | null>(null);
  const controller = useRef<AbortController | null>(null), alive = useRef(true), latest = useRef(value), generation = useRef(0);
  useEffect(() => { latest.current = value; }, [value]);
  useEffect(() => { alive.current = true; const current = ++generation.current; return () => { alive.current = false; generation.current = current + 1; controller.current?.abort(); capture.current?.cancel(); }; }, [threadId]);
  useEffect(() => { onBusyChange?.(busy || recording); }, [busy, recording, onBusyChange]);
  const add = async (file: File, isPhoto: boolean) => {
    const current = generation.current;
    const isCurrent = () => alive.current && current === generation.current;
    setBusy(true); setError("");
    try {
      const prepared = isPhoto ? await prepareMessagePhoto(file) : file;
      if (!isCurrent()) return;
      const attachment = await uploadPrivateMessageFile(prepared, { threadId }, getAuthHeaders);
      if (isCurrent()) onChange([...latest.current, attachment]);
      else await removePrivateMessageFile(attachment.id, getAuthHeaders);
    } catch (problem) { if (isCurrent()) setError(problem instanceof Error ? problem.message : "Upload failed. Please try again."); }
    finally { if (isCurrent()) setBusy(false); }
  };
  const remove = async (id: string) => {
    setBusy(true); setError("");
    try { await removePrivateMessageFile(id, getAuthHeaders); onChange(latest.current.filter(item => item.id !== id)); }
    catch (problem) { setError(problem instanceof Error ? problem.message : "Attachment could not be removed."); }
    finally { setBusy(false); }
  };
  const start = async () => {
    setError(""); setBusy(true); controller.current = new AbortController();
    try {
      capture.current = await startVoiceNoteCapture({ signal: controller.current.signal,
        onComplete: file => { if (alive.current) { setRecording(false); void add(file, false); } },
        onError: problem => { if (alive.current) { setRecording(false); setBusy(false); setError(problem.message); } },
      });
      if (alive.current) setRecording(true);
    } catch (problem) { if (alive.current && !controller.current.signal.aborted) setError(problem instanceof Error ? problem.message : "Microphone could not be opened."); }
    finally { if (alive.current) setBusy(false); }
  };
  const blocked = disabled || busy || recording || value.length >= 4;
  return <div className={styles.composer}>
    <div className={styles.tools}>
      <button type="button" onClick={() => upload.current?.click()} disabled={blocked}>＋ Photo</button>
      <button type="button" onClick={() => camera.current?.click()} disabled={blocked}>Camera</button>
      {recording ? <><span className={styles.recording} role="status">Recording · up to 90 seconds</span><button type="button" onClick={() => capture.current?.stop()}>Stop &amp; attach</button><button type="button" onClick={() => { controller.current?.abort(); capture.current?.cancel(); setRecording(false); }}>Cancel</button></> : <button type="button" onClick={() => void start()} disabled={blocked}>Mic · voice note</button>}
      <input className={styles.hidden} ref={upload} type="file" accept="image/*" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void add(file, true); }} />
      <input className={styles.hidden} ref={camera} type="file" accept="image/*" capture="environment" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void add(file, true); }} />
    </div>
    {value.length > 0 && <div className={styles.pending}>{value.map((item, index) => <div key={item.id}><span>{item.kind === "audio" ? "Voice note" : `Photo ${index + 1}`} ready</span><button type="button" disabled={busy || disabled} onClick={() => void remove(item.id)} aria-label={`Remove ${item.kind === "audio" ? "voice note" : `photo ${index + 1}`}`}>×</button></div>)}</div>}
    {busy && <span className={styles.status} role="status">Preparing attachment…</span>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}
