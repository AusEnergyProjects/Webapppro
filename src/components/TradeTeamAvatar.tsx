"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { MessageMediaAuth } from "@/lib/trade-message-media";
import { prepareMessagePhoto, uploadPrivateMessageFile } from "@/lib/trade-message-media-client";
import styles from "./TradeTeamAvatar.module.css";

export default function TradeTeamAvatar({ memberId, name, revision = "", editable = false, getAuthHeaders, onChange }: {
  memberId: string; name: string; revision?: string; editable?: boolean; getAuthHeaders: MessageMediaAuth; onChange?: (revision: string) => void;
}) {
  const [loaded, setLoaded] = useState({ revision: "", url: "" }), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [saved, setSaved] = useState<{ memberId: string; base: string; revision: string } | null>(null); const file = useRef<HTMLInputElement>(null);
  const savedRevision = saved?.memberId === memberId && saved.base === revision ? saved.revision : revision;
  useEffect(() => {
    const controller = new AbortController(); let objectUrl = "";
    if (savedRevision) void (async () => {
      try {
        const response = await fetch(`/api/trade-message-media?avatarMemberId=${encodeURIComponent(memberId)}&revision=${encodeURIComponent(savedRevision)}`, { headers: await getAuthHeaders(), cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const blob = await response.blob(); if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob); setLoaded({ revision: savedRevision, url: objectUrl });
      } catch { /* The initials remain when the current photo is unavailable. */ }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [savedRevision, memberId, getAuthHeaders]);
  const save = async (selected: File) => {
    setBusy(true); setError("");
    try {
      const photo = await prepareMessagePhoto(selected, true), result = await uploadPrivateMessageFile(photo, { memberId }, getAuthHeaders);
      setSaved({ memberId, base: revision, revision: result.id }); onChange?.(result.id);
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Photo could not be saved."); }
    finally { setBusy(false); }
  };
  const url = loaded.revision === savedRevision ? loaded.url : "";
  const content = url ? <Image src={url} unoptimized width={36} height={36} alt="" /> : <span>{name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "?"}</span>;
  return <span className={styles.wrap}>
    {editable ? <button type="button" className={styles.avatar} onClick={() => file.current?.click()} disabled={busy} aria-label={`Change profile photo for ${name}`} title="Change profile photo">{content}<span className={styles.edit}>＋</span></button> : <span className={styles.avatar} aria-label={name}>{content}</span>}
    {editable && <input ref={file} className={styles.hidden} type="file" accept="image/*" onChange={event => { const selected = event.target.files?.[0]; event.target.value = ""; if (selected) void save(selected); }} />}
    {busy && <span className={styles.status}>Saving photo…</span>}
    {error && <span className={styles.error} role="alert">{error}</span>}
  </span>;
}
