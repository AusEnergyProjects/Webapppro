"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { User } from "firebase/auth";
import type { PortalWorkspace } from "@/lib/portal-workspace-profile";
import { prepareMessagePhoto } from "@/lib/trade-message-media-client";
import styles from "./PortalProfileAvatar.module.css";

type Props = { workspace: PortalWorkspace; user: User; name: string; memberId?: string; revision?: string; editable?: boolean };
export function PortalProfileAvatar(props: Props) {
  return <ProfileAvatar key={`${props.workspace}:${props.user.uid}:${props.memberId || "me"}`} {...props} revision={props.memberId ? props.revision || "" : props.revision} />;
}
function ProfileAvatar({ workspace, user, name, memberId, revision, editable = false }: Props) {
  const [metadata, setMetadata] = useState({ memberId: "", revision: "" });
  const [loaded, setLoaded] = useState({ identity: "", url: "" });
  const [loading, setLoading] = useState(revision === undefined);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const file = useRef<HTMLInputElement>(null), locked = useRef(false);
  const base = `/api/portal-profile-avatar?workspace=${workspace}`;
  useEffect(() => {
    if (revision !== undefined) return;
    const changed = (event: Event) => {
      if (event instanceof CustomEvent && event.detail?.workspace === workspace && event.detail?.uid === user.uid) setRefresh(value => value + 1);
    };
    window.addEventListener("portal-profile-photo-changed", changed);
    return () => window.removeEventListener("portal-profile-photo-changed", changed);
  }, [workspace, user.uid, revision]);
  useEffect(() => {
    if (revision !== undefined) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`${base}&metadata=1`, { cache: "no-store", headers: { Authorization: `Bearer ${await user.getIdToken()}` }, signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Your profile photo could not be loaded.");
        if (!controller.signal.aborted) { setMetadata({ memberId: result.memberId, revision: result.revision }); setError(""); }
      } catch (problem) { if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : "Your profile photo could not be loaded."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [base, user, revision, refresh]);
  const currentMember = memberId || metadata.memberId;
  const currentRevision = revision ?? metadata.revision;
  const identity = `${workspace}:${user.uid}:${currentMember}:${currentRevision}`;
  useEffect(() => {
    if (!currentMember || !currentRevision) return;
    const controller = new AbortController(); let objectUrl = "";
    void (async () => {
      try {
        const response = await fetch(`${base}&memberId=${encodeURIComponent(currentMember)}&revision=${encodeURIComponent(currentRevision)}`,
          { cache: "no-store", headers: { Authorization: `Bearer ${await user.getIdToken()}` }, signal: controller.signal });
        if (!response.ok) return;
        const blob = await response.blob(); if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob); setLoaded({ identity, url: objectUrl });
      } catch { /* Initials remain when a private photo cannot be retrieved. */ }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [base, currentMember, currentRevision, identity, user]);
  async function change(selected: File | null) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try {
      const photo = selected ? await prepareMessagePhoto(selected, true) : null;
      const response = await fetch(`${base}${photo ? "" : `&revision=${encodeURIComponent(currentRevision)}`}`, {
        method: photo ? "POST" : "DELETE", headers: { Authorization: `Bearer ${await user.getIdToken()}`, ...(photo ? { "Content-Type": photo.type } : {}) }, body: photo,
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Your profile photo could not be saved.");
      setMetadata({ memberId: result.memberId, revision: result.revision });
      window.dispatchEvent(new CustomEvent("portal-profile-photo-changed", { detail: { workspace, uid: user.uid } }));
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Your profile photo could not be saved."); }
    finally { locked.current = false; setBusy(false); }
  }
  const url = loaded.identity === identity ? loaded.url : "";
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "?";
  const picture = <span className={styles.avatar} aria-hidden="true">{url ? <Image src={url} unoptimized width={72} height={72} alt="" /> : initials}</span>;
  if (!editable) return picture;
  return <div className={styles.editor}>
    {picture}<div><strong>Profile photo</strong><p>Shown beside your name in team messages. Only people in this workspace can see it.</p>
      <div className={styles.actions}><button type="button" disabled={loading || busy} onClick={() => file.current?.click()}>{busy ? "Saving photo..." : currentRevision ? "Change photo" : "Add photo"}</button>
        {currentRevision && <button type="button" disabled={loading || busy} onClick={() => void change(null)}>Remove photo</button>}
        {error && <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Reload photo</button>}
      </div><small>Your photo saves immediately. JPEG or PNG recommended.</small>
      <input ref={file} className={styles.hidden} type="file" accept="image/*" aria-label="Choose profile photo" onChange={event => { const selected = event.target.files?.[0]; event.target.value = ""; if (selected) void change(selected); }} />
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>
  </div>;
}
