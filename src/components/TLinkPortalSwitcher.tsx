"use client";

import { useEffect, useId, useState } from "react";
import type { User } from "firebase/auth";
import { TLINK_PORTALS, type TlinkPortalAvailability, type TlinkPortalId, type TlinkPortalStatus } from "@/lib/tlink-portals";
import styles from "./TLinkPortalSwitcher.module.css";

const statusLabels: Record<TlinkPortalStatus, string> = {
  ready: "", verify_email: "Verify email", verify_mfa: "Security check",
  invitation: "Accept invitation", setup: "Set up access", no_access: "No access",
};
const isPortalStatus = (value: unknown): value is TlinkPortalStatus => typeof value === "string" && Object.hasOwn(statusLabels, value);

function readAvailability(value: unknown): TlinkPortalAvailability[] {
  if (!value || typeof value !== "object" || !("ok" in value) || value.ok !== true || !("portals" in value) || !Array.isArray(value.portals)) throw new Error("Invalid access response");
  const entries: unknown[] = value.portals;
  return TLINK_PORTALS.map(portal => {
    const matches = entries.filter(item => item && typeof item === "object" && "id" in item && item.id === portal.id);
    const item = matches[0];
    if (matches.length !== 1 || !item || typeof item !== "object" || !("available" in item) || typeof item.available !== "boolean" || !("status" in item) || !isPortalStatus(item.status)) throw new Error("Invalid portal access");
    return { id: portal.id, available: item.available, status: item.status };
  });
}

export function TLinkPortalSwitcher({ current = "trade", user, onBeforeSwitch }: {
  current?: TlinkPortalId;
  user: User | null;
  onBeforeSwitch?: () => boolean;
}) {
  const id = useId();
  const [result, setResult] = useState<{ uid: string; portals: TlinkPortalAvailability[]; error: boolean } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    let active = true;
    void (async () => {
      const response = await fetch("/api/tlink/portals", { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Access unavailable");
      const portals = readAvailability(await response.json());
      if (active) setResult({ uid: user.uid, portals, error: false });
    })().catch(() => { if (active) setResult({ uid: user.uid, portals: [], error: true }); });
    return () => { active = false; controller.abort(); };
  }, [user, revision]);
  const access = user && result?.uid === user.uid ? result : null;
  const loading = Boolean(user && !access);
  return <div className={styles.switcher} data-tlink-portal-switcher>
    <label htmlFor={id}>Dashboard</label>
    <select id={id} aria-label="TLink dashboard" value={current} aria-describedby={access?.error ? `${id}-error` : undefined} onFocus={() => { if (user) setRevision(value => value + 1); }} onChange={event => {
      const portal = TLINK_PORTALS.find(item => item.id === event.target.value);
      if (!portal || portal.id === current || (user && !access?.portals.find(item => item.id === portal.id)?.available)) return;
      if (onBeforeSwitch && !onBeforeSwitch()) return;
      window.location.assign(portal.href);
    }}>
      {TLINK_PORTALS.map(portal => {
        const permission = access?.portals.find(item => item.id === portal.id);
        const note = user && portal.id !== current ? loading ? "Checking access" : permission ? statusLabels[permission.status] : "Check access" : "";
        return <option key={portal.id} value={portal.id} disabled={Boolean(user && portal.id !== current && !permission?.available)}>{portal.label}{note ? ` · ${note}` : ""}</option>;
      })}
    </select>
    {access?.error && <span id={`${id}-error`} className={styles.error} role="status">Access could not be checked. <button type="button" onClick={() => setRevision(value => value + 1)}>Retry</button></span>}
  </div>;
}
