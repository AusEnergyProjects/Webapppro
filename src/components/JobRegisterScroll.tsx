"use client";

import { type ReactNode, useEffect, useRef } from "react";
import styles from "./InstallerCrmJobRegister.module.css";

/** Both native scrollbars use the table's measured width, including hidden columns. */
export function JobRegisterScroll({ children }: { children: ReactNode }) {
  const top = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLElement>(null);

  useEffect(() => {
    const upper = top.current;
    const spacer = track.current;
    const lower = table.current;
    if (!upper || !spacer || !lower) return;
    const measure = () => {
      spacer.style.width = `${lower.scrollWidth}px`;
      upper.hidden = lower.scrollWidth <= lower.clientWidth;
      upper.scrollLeft = lower.scrollLeft;
    };
    const fromTop = () => { if (lower.scrollLeft !== upper.scrollLeft) lower.scrollLeft = upper.scrollLeft; };
    const fromTable = () => { if (upper.scrollLeft !== lower.scrollLeft) upper.scrollLeft = lower.scrollLeft; };
    const observer = new ResizeObserver(measure);
    observer.observe(lower);
    if (lower.firstElementChild) observer.observe(lower.firstElementChild);
    upper.addEventListener("scroll", fromTop, { passive: true });
    lower.addEventListener("scroll", fromTable, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      upper.removeEventListener("scroll", fromTop);
      lower.removeEventListener("scroll", fromTable);
    };
  }, [children]);

  return <div className={styles.registerScroll}>
    <div ref={top} className={styles.topScroll} tabIndex={0} role="region" aria-label="Scroll job columns horizontally">
      <div ref={track} className={styles.scrollTrack} />
    </div>
    <section ref={table} className={`${styles.register} crm-job-list crm-record-table`} role="table" aria-label="Job results">{children}</section>
  </div>;
}
