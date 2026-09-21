"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import styles from "./JobRowActions.module.css";

export type JobRowAction = { label: string; run: () => void };
type MenuState = { id: string; label: string; x: number; y: number; launcher: HTMLElement; actions: JobRowAction[] };

export function useJobRowMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const launcherRef = useRef<HTMLElement | null>(null);
  const closeMenu = useCallback((restoreFocus = true) => {
    if (restoreFocus && launcherRef.current?.isConnected) launcherRef.current.focus({ preventScroll: true });
    setMenu(null);
  }, []);
  function openMenu(event: MouseEvent<HTMLElement>, id: string, label: string, actions: (launcher: HTMLElement) => JobRowAction[]) {
    event.preventDefault();
    const launcher = event.currentTarget.querySelector<HTMLButtonElement>("button[data-job-actions]") || event.currentTarget;
    launcherRef.current = launcher;
    const bounds = launcher.getBoundingClientRect();
    const atPointer = event.type === "contextmenu" && (event.clientX !== 0 || event.clientY !== 0);
    setMenu({ id, label, launcher, actions: actions(launcher), x: atPointer ? event.clientX : bounds.left, y: atPointer ? event.clientY : bounds.bottom + 4 });
  }
  return { menu, openMenu, closeMenu };
}

export function JobRowMenu({ menu, onClose }: { menu: MenuState | null; onClose: (restoreFocus?: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const bounds = ref.current.getBoundingClientRect();
    ref.current.style.left = `${Math.max(8, Math.min(menu.x, document.documentElement.clientWidth - bounds.width - 8))}px`;
    ref.current.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - bounds.height - 8))}px`;
    ref.current.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus({ preventScroll: true });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(false); };
    const dismiss = () => onClose(false);
    const outsideScroll = (event: Event) => {
      if (event.target === window || !ref.current?.contains(event.target as Node)) onClose(false);
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", outsideScroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", outsideScroll, true);
    };
  }, [menu, onClose]);
  if (!menu) return null;
  return <div ref={ref} id={menu.id} role="menu" aria-label={`Actions for ${menu.label}`} className={styles.menu} style={{ left: menu.x, top: menu.y }} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key === "Tab") { onClose(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitem]"));
    const index = items.findIndex(item => item === document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus({ preventScroll: true });
  }}>
    <span className={styles.label}>{menu.label}</span>
    {menu.actions.map(action => <button type="button" role="menuitem" key={action.label} onClick={() => { onClose(); action.run(); }}>{action.label}</button>)}
  </div>;
}

export function JobActionsButton({ label, menuId, expanded, onClick }: { label: string; menuId: string; expanded: boolean; onClick: (event: MouseEvent<HTMLButtonElement>) => void }) {
  return <button type="button" data-job-actions className={styles.trigger} aria-label={`Actions for ${label}`} aria-haspopup="menu" aria-expanded={expanded} aria-controls={expanded ? menuId : undefined} onClick={onClick} onKeyDown={event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); event.currentTarget.click(); }
  }}><span aria-hidden="true">⋯</span></button>;
}
