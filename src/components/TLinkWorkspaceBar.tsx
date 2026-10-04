"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { TLINK_PORTALS, type TlinkPortalId } from "@/lib/tlink-portals";
import { TLinkPortalSwitcher } from "./TLinkPortalSwitcher";
import styles from "./TLinkWorkspaceBar.module.css";

export function TLinkWorkspaceBar({ current, user, organisation, displayName, actions, error, onBeforeSwitch, businessContext = false }: {
  current: TlinkPortalId;
  user: User | null;
  organisation?: string;
  displayName?: string;
  actions?: ReactNode;
  error?: string;
  onBeforeSwitch?: () => boolean;
  businessContext?: boolean;
}) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = bar.current, container = element?.parentElement;
    if (!element || !container) return;
    const measure = () => container.style.setProperty("--tlink-workspace-bar-height", `${element.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => { observer.disconnect(); container.style.removeProperty("--tlink-workspace-bar-height"); };
  }, []);
  return <div ref={bar} className={styles.bar} data-tlink-workspace-bar data-workspace-portal={current} data-tlink-business-switcher={businessContext || undefined}>
    <div className={styles.context}><span>Working with <strong>{organisation || TLINK_PORTALS.find(portal => portal.id === current)?.label}</strong></span>{user && <span data-tlink-welcome>{displayName ? `Welcome ${displayName}` : "Welcome"}</span>}{error && <p role="alert">{error}</p>}</div>
    <div className={styles.tools}>{actions && <div className={styles.actions}>{actions}</div>}<div className={styles.selector}><TLinkPortalSwitcher current={current} user={user} onBeforeSwitch={onBeforeSwitch} /></div></div>
  </div>;
}
