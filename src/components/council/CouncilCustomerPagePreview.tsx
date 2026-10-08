import { lazy, Suspense, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { CouncilProfileInput } from "@/lib/council-profile";
import { councilThemeVariables } from "@/lib/council-theme";
import styles from "./CouncilProfileSettings.module.css";

const CouncilProgram = lazy(() => import("../CouncilProgram").then(module => ({ default: module.CouncilProgram })));

export function CouncilCustomerPagePreview({ profile, state, onClose }: {
  profile: CouncilProfileInput;
  state: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const returnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const element = dialog.current;
    element?.showModal();
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(<dialog
    ref={dialog}
    className={styles.customerPreview}
    aria-labelledby={titleId}
    aria-describedby={descriptionId}
    style={councilThemeVariables(profile.theme, "day")}
    onKeyDown={event => {
      if (event.defaultPrevented || event.key !== "Tab"
        || (event.target instanceof Element && event.target.closest('[role="dialog"]'))) return;
      const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      )).filter(element => element.tabIndex >= 0 && element.getClientRects().length);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    }}
    onCancel={event => {
      event.preventDefault();
      // The enquiry dialog handles its own Escape before returning to this preview.
      if (!dialog.current?.querySelector('[role="dialog"]')) onClose();
    }}
  >
    <header className={styles.customerPreviewToolbar}>
      <div><h2 id={titleId}>Preview customer page</h2><p id={descriptionId}>Your current settings, including unsaved edits. No enquiries are sent or providers contacted.</p></div>
      <button ref={closeButton} type="button" onClick={onClose}>Close preview</button>
    </header>
    <div className={styles.customerPreviewViewport}>
      <Suspense fallback={<p role="status" aria-live="polite">Loading your customer page preview...</p>}><CouncilProgram embeddedPreview demonstration campaign={{
        code: "PROFILE-PREVIEW",
        title: "Better energy for your home or business",
        kind: "campaign",
        audience: "everyone",
        startsAt: null,
        location: null,
        meetingUrl: null,
        councilName: profile.name,
        state,
        postcodes: profile.postcodes,
        logoDataUrl: profile.logoDataUrl,
        primaryColor: profile.theme.primaryColor,
        accentColor: profile.theme.accentColor,
        homeUrl: profile.publicJourney?.homeUrl,
      }} /></Suspense>
    </div>
  </dialog>, document.body);
}
