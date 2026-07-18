"use client";

import { ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";

const MENU_OPEN_EVENT = "tlink-menu-open";

export function AccessibleMenu({ label, active, className, children }: {
  label: string;
  active?: boolean;
  className: string;
  children: (close: () => void) => ReactNode;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  const closeAfterSelection = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(true); }
    };
    const onPeerOpen = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener(MENU_OPEN_EVENT, onPeerOpen);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(MENU_OPEN_EVENT, onPeerOpen);
    };
  }, [close, id, open]);

  function toggle() {
    setOpen((current) => {
      const next = !current;
      if (next) window.dispatchEvent(new CustomEvent(MENU_OPEN_EVENT, { detail: id }));
      return next;
    });
  }

  return <div className={className} ref={rootRef} data-open={open || undefined}>
    <button ref={triggerRef} type="button" className={active ? "active" : ""} aria-expanded={open} aria-haspopup="menu" aria-controls={`${id}-menu`} onClick={toggle}>{label}</button>
    {open && <div id={`${id}-menu`} role="menu">{children(closeAfterSelection)}</div>}
  </div>;
}
