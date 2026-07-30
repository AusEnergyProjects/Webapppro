"use client";

import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
} from "react";
import styles from "./CustomerDraftDeleteDialog.module.css";

export function CustomerDraftDeleteDialog({
  open,
  projectTitle,
  busy,
  error,
  recovery,
  returnFocus,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  projectTitle: string;
  busy: boolean;
  error: string;
  recovery: boolean;
  returnFocus: HTMLElement | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const keepButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;

    const previousOverflow = window.document.body.style.overflow;
    const returnTarget =
      returnFocus ||
      (window.document.activeElement instanceof HTMLElement
        ? window.document.activeElement
        : null);
    const focusFrame = window.requestAnimationFrame(() => {
      keepButtonRef.current?.focus();
    });

    window.document.body.style.overflow = "hidden";

    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.document.body.style.overflow = previousOverflow;
      if (returnTarget?.isConnected) returnTarget.focus();
    };
  }, [open, returnFocus]);

  if (!open) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      if (!busy) {
        event.preventDefault();
        onCancel();
      }
      return;
    }

    if (event.key !== "Tab") return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!dialogRef.current?.contains(window.document.activeElement)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && window.document.activeElement === first) {
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
        if (event.currentTarget === event.target && !busy) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        aria-busy={busy}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={styles.dialog}
        onKeyDown={handleKeyDown}
        role="dialog"
      >
        <header className={styles.header}>
          <span>
            {recovery ? "Finish secure deletion" : "Delete draft project"}
          </span>
          <h2 id={titleId}>
            {recovery ? (
              <>Finish deleting &ldquo;{projectTitle}&rdquo;?</>
            ) : (
              <>Delete &ldquo;{projectTitle}&rdquo;?</>
            )}
          </h2>
        </header>

        <div className={styles.body}>
          <p id={descriptionId}>
            {recovery
              ? "This draft is already locked for deletion. File cleanup paused before it finished. Finish deleting to remove the remaining private files and draft."
              : "This permanently removes this draft and its saved plan from your account. This cannot be undone."}
          </p>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className={styles.actions}>
          <button
            ref={keepButtonRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
          >
            {recovery ? "Not now" : "Keep draft"}
          </button>
          <button
            className={styles.deleteButton}
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy
              ? "Deleting..."
              : recovery
                ? "Finish deleting"
                : "Delete draft"}
          </button>
        </footer>
      </section>
    </div>
  );
}
