"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import type { CustomerPlanReportView } from "@/lib/customer-plan-report";
import { CustomerPlanReportPreview } from "./CustomerPlanReportPreview";
import styles from "./CustomerPlanReportPreviewDialog.module.css";

export function CustomerPlanReportPreviewDialog({
  open,
  report,
  onClose,
  context = "customer",
}: {
  open: boolean;
  report: CustomerPlanReportView;
  onClose: () => void;
  context?: "customer" | "installer-enquiry";
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = window.document.body.style.overflow;
    const previouslyFocused = window.document.activeElement as HTMLElement | null;
    window.document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => {
      window.document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;
  const installerView = context === "installer-enquiry";

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = dialog.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && window.document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && window.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        aria-labelledby="customer-plan-preview-title"
        aria-modal="true"
        className={styles.dialog}
        onKeyDown={trapFocus}
        ref={dialog}
        role="dialog"
      >
        <header className={styles.toolbar}>
          <div>
            <span>
              {installerView ? "Complete privacy-safe plan" : "Full customer report"}
            </span>
            <h2 id="customer-plan-preview-title">
              {installerView ? "Review the complete plan" : "Preview before you share"}
            </h2>
            <p>
              {installerView
                ? "This complete plan excludes customer identity, exact location and private notes."
                : "This is the same report structure used for email and PDF."}
            </p>
          </div>
          <button ref={closeButton} type="button" onClick={onClose}>
            Close preview
          </button>
        </header>
        <div className={styles.viewport}>
          <CustomerPlanReportPreview report={report} />
        </div>
      </section>
    </div>
  );
}
