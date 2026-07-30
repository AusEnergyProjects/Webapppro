"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import styles from "./CustomerInstallerRequestDialog.module.css";

export type CustomerInstallerRequestContact = {
  phone: string;
  addressLine1: string;
  addressLine2: string;
  suburb: string;
};

export type CustomerInstallerRequestDialogProps = {
  open: boolean;
  initialContact: CustomerInstallerRequestContact;
  projectPostcode: string;
  projectState: string;
  installerEvidenceConfirmationRequired?: boolean;
  onClose: () => void;
  onSubmit: (
    contact: CustomerInstallerRequestContact,
    confirmInstallerPhotoSharing: boolean,
  ) => Promise<string | void>;
  onComplete: () => void;
};

type ContactField = keyof CustomerInstallerRequestContact | "evidence" | "";

const phonePattern = /^\+?[0-9][0-9 ()-]{6,30}[0-9]$/;
const defaultCompletionMessage =
  "Your request is now in private installer matching. Your name, phone number and street address stay hidden until you approve a direct contact handover.";

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "We could not send your request. Check your details and try again.";
}

export function CustomerInstallerRequestDialog(
  props: CustomerInstallerRequestDialogProps,
) {
  if (!props.open) return null;
  return <OpenCustomerInstallerRequestDialog {...props} />;
}

function OpenCustomerInstallerRequestDialog({
  initialContact,
  projectPostcode,
  projectState,
  installerEvidenceConfirmationRequired = false,
  onClose,
  onSubmit,
  onComplete,
}: CustomerInstallerRequestDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const addressLine1Ref = useRef<HTMLInputElement>(null);
  const suburbRef = useRef<HTMLInputElement>(null);
  const evidenceRef = useRef<HTMLInputElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const submittingRef = useRef(false);
  const initialFocusField = useRef<ContactField>(
    !initialContact.phone.trim()
      ? "phone"
      : !initialContact.addressLine1.trim()
        ? "addressLine1"
        : !initialContact.suburb.trim()
          ? "suburb"
          : installerEvidenceConfirmationRequired
            ? "evidence"
            : "",
  );
  const [contact, setContact] =
    useState<CustomerInstallerRequestContact>(initialContact);
  const [confirmInstallerPhotoSharing, setConfirmInstallerPhotoSharing] =
    useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invalidField, setInvalidField] = useState<ContactField>("");
  const [complete, setComplete] = useState(false);
  const [completionMessage, setCompletionMessage] = useState(
    defaultCompletionMessage,
  );

  useEffect(() => {
    const previousOverflow = window.document.body.style.overflow;
    const returnTarget =
      window.document.activeElement instanceof HTMLElement
        ? window.document.activeElement
        : null;
    const focusFrame = window.requestAnimationFrame(() => {
      const firstMissing =
        initialFocusField.current === "phone"
          ? phoneRef.current
          : initialFocusField.current === "addressLine1"
            ? addressLine1Ref.current
            : initialFocusField.current === "suburb"
              ? suburbRef.current
              : initialFocusField.current === "evidence"
                ? evidenceRef.current
                : submitButtonRef.current;
      firstMissing?.focus();
    });

    window.document.body.style.overflow = "hidden";

    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.document.body.style.overflow = previousOverflow;
      if (returnTarget?.isConnected) returnTarget.focus();
    };
  }, []);

  useEffect(() => {
    if (!complete) return;
    const focusFrame = window.requestAnimationFrame(() => {
      submitButtonRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [complete]);

  const dismissible = !busy && !complete;

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      if (dismissible) {
        event.preventDefault();
        onClose();
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

  const updateContact = (
    field: keyof CustomerInstallerRequestContact,
    value: string,
  ) => {
    setContact((current) => ({ ...current, [field]: value }));
    if (invalidField === field) {
      setInvalidField("");
      setError("");
    }
  };

  const validate = () => {
    const nextContact = {
      phone: contact.phone.trim(),
      addressLine1: contact.addressLine1.trim(),
      addressLine2: contact.addressLine2.trim(),
      suburb: contact.suburb.trim(),
    };

    if (!nextContact.phone) {
      return {
        contact: nextContact,
        field: "phone" as const,
        error: "Add the best phone number for this request.",
      };
    }
    if (!phonePattern.test(nextContact.phone)) {
      return {
        contact: nextContact,
        field: "phone" as const,
        error:
          "Enter a phone number using digits, spaces or an Australian country code.",
      };
    }
    if (!nextContact.addressLine1) {
      return {
        contact: nextContact,
        field: "addressLine1" as const,
        error: "Add the service street address.",
      };
    }
    if (!nextContact.suburb) {
      return {
        contact: nextContact,
        field: "suburb" as const,
        error: "Add the service suburb.",
      };
    }
    if (
      installerEvidenceConfirmationRequired &&
      !confirmInstallerPhotoSharing
    ) {
      return {
        contact: nextContact,
        field: "evidence" as const,
        error:
          "Confirm that the selected evidence can be shared for installer quoting.",
      };
    }
    return { contact: nextContact, field: "" as const, error: "" };
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current || busy) return;

    const result = validate();
    if (result.error) {
      setInvalidField(result.field);
      setError(result.error);
      const target =
        result.field === "phone"
          ? phoneRef.current
          : result.field === "addressLine1"
            ? addressLine1Ref.current
            : result.field === "suburb"
              ? suburbRef.current
              : evidenceRef.current;
      target?.focus();
      return;
    }

    submittingRef.current = true;
    setBusy(true);
    setError("");
    setInvalidField("");
    try {
      const nextCompletionMessage = await onSubmit(
        result.contact,
        confirmInstallerPhotoSharing,
      );
      if (nextCompletionMessage) {
        setCompletionMessage(nextCompletionMessage);
      }
      setComplete(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && dismissible) onClose();
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
        {complete ? (
          <>
            <header className={styles.header}>
              <span>Request sent</span>
              <h2 id={titleId}>Your project is ready for private matching</h2>
            </header>
            <div
              className={styles.success}
              role="status"
              aria-live="polite"
            >
              <div className={styles.successMark} aria-hidden="true">
                ✓
              </div>
              <p id={descriptionId}>{completionMessage}</p>
            </div>
            <footer className={`${styles.actions} ${styles.singleAction}`}>
              <button
                ref={submitButtonRef}
                className={styles.primaryButton}
                type="button"
                onClick={onComplete}
              >
                Back to overview
              </button>
            </footer>
          </>
        ) : (
          <>
            <header className={styles.header}>
              <div>
                <span>One last step</span>
                <h2 id={titleId}>Where should the installer work?</h2>
              </div>
              <button
                aria-label="Close installer request window"
                className={styles.closeButton}
                disabled={busy}
                type="button"
                onClick={onClose}
              >
                Close
              </button>
            </header>

            <form onSubmit={(event) => void submit(event)}>
              <div className={styles.body}>
                <p id={descriptionId} className={styles.intro}>
                  Add the contact details needed to finish this request. They
                  are saved to your private profile so you will not need to
                  enter them again.
                </p>
                <div className={styles.privacyNote}>
                  <strong>Private during matching</strong>
                  <span>
                    Installers cannot see your name, phone number or street
                    address until you approve a direct contact handover.
                  </span>
                </div>

                <div className={styles.fieldGrid}>
                  <label>
                    <span>Phone number</span>
                    <input
                      ref={phoneRef}
                      aria-invalid={invalidField === "phone"}
                      autoComplete="tel"
                      inputMode="tel"
                      maxLength={32}
                      required
                      type="tel"
                      value={contact.phone}
                      onChange={(event) =>
                        updateContact("phone", event.target.value)
                      }
                    />
                  </label>
                  <label className={styles.fullWidth}>
                    <span>Service street address</span>
                    <input
                      ref={addressLine1Ref}
                      aria-invalid={invalidField === "addressLine1"}
                      autoComplete="address-line1"
                      maxLength={120}
                      required
                      type="text"
                      value={contact.addressLine1}
                      onChange={(event) =>
                        updateContact("addressLine1", event.target.value)
                      }
                    />
                  </label>
                  <label className={styles.fullWidth}>
                    <span>Unit, building or address detail</span>
                    <small>Optional</small>
                    <input
                      autoComplete="address-line2"
                      maxLength={120}
                      type="text"
                      value={contact.addressLine2}
                      onChange={(event) =>
                        updateContact("addressLine2", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>Suburb</span>
                    <input
                      ref={suburbRef}
                      aria-invalid={invalidField === "suburb"}
                      autoComplete="address-level2"
                      maxLength={80}
                      required
                      type="text"
                      value={contact.suburb}
                      onChange={(event) =>
                        updateContact("suburb", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>Project postcode</span>
                    <input
                      aria-readonly="true"
                      autoComplete="postal-code"
                      readOnly
                      type="text"
                      value={projectPostcode}
                    />
                  </label>
                  <label>
                    <span>State or territory</span>
                    <input
                      aria-readonly="true"
                      autoComplete="address-level1"
                      readOnly
                      type="text"
                      value={projectState}
                    />
                  </label>
                </div>

                <p className={styles.serviceAreaNote}>
                  The postcode and state come from this project and will update
                  the service area in your private profile.
                </p>

                {installerEvidenceConfirmationRequired && (
                  <label className={styles.evidenceConfirmation}>
                    <input
                      ref={evidenceRef}
                      aria-invalid={invalidField === "evidence"}
                      checked={confirmInstallerPhotoSharing}
                      type="checkbox"
                      onChange={(event) => {
                        setConfirmInstallerPhotoSharing(event.target.checked);
                        if (invalidField === "evidence") {
                          setInvalidField("");
                          setError("");
                        }
                      }}
                    />
                    <span>
                      I confirm that the photos and documents I selected for
                      quoting can be shared with matched installers.
                    </span>
                  </label>
                )}

                {error && (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                )}
              </div>

              <footer className={styles.actions}>
                <button disabled={busy} type="button" onClick={onClose}>
                  Cancel
                </button>
                <button
                  ref={submitButtonRef}
                  className={styles.primaryButton}
                  disabled={busy}
                  type="submit"
                >
                  {busy
                    ? "Saving and sending..."
                    : "Save details and request responses"}
                </button>
              </footer>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
