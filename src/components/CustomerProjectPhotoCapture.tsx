"use client";

import { useEffect, useMemo, useState } from "react";
import {
  customerProjectPhotoGuide,
  type CustomerProjectPhotoGuideItem,
} from "@/lib/customer-project-photo-guide";
import styles from "./CustomerProjectPhotoCapture.module.css";

export type GuidedPendingEvidence = {
  id: string;
  file: File;
  category: string;
  captureSlot: string;
  factKeys: string[];
  replaceEvidenceId?: string;
  expectedEvidenceRevision?: number;
  uploadProgress?: number;
  uploadStatus?: "queued" | "uploading" | "finalising" | "failed";
  uploadError?: string;
};

export type GuidedStoredEvidence = {
  id: string;
  category: string;
  captureSlot: string;
  factKeys: string[];
  fileName: string;
  contentType: string;
  privacyStatus: string;
  revision: number;
  updatedAt: string;
};

type EvidencePreset = {
  category: string;
  captureSlot: string;
  factKeys: string[];
  replaceEvidenceId?: string;
  expectedEvidenceRevision?: number;
  replacePendingId?: string;
};

function evidenceByCaptureSlot<T extends { captureSlot: string }>(items: T[]) {
  const grouped = new Map<string, T[]>();
  items.forEach((item) => {
    if (!item.captureSlot) return;
    const current = grouped.get(item.captureSlot) || [];
    current.push(item);
    grouped.set(item.captureSlot, current);
  });
  return grouped;
}

function PendingPhotoPreview({ file }: { file: File }) {
  const previewUrl = useMemo(() => URL.createObjectURL(file), [file]);

  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={previewUrl} alt="" />
  );
}

function StoredPhotoPreview({
  evidence,
  onLoad,
}: {
  evidence: GuidedStoredEvidence;
  onLoad: (evidence: GuidedStoredEvidence) => Promise<Blob>;
}) {
  const [preview, setPreview] = useState({
    evidenceId: "",
    previewUrl: "",
    failed: false,
  });

  useEffect(() => {
    let active = true;
    let nextUrl = "";
    void onLoad(evidence)
      .then((blob) => {
        if (!active) return;
        nextUrl = URL.createObjectURL(blob);
        setPreview({
          evidenceId: evidence.id,
          previewUrl: nextUrl,
          failed: false,
        });
      })
      .catch(() => {
        if (active) {
          setPreview({
            evidenceId: evidence.id,
            previewUrl: "",
            failed: true,
          });
        }
      });
    return () => {
      active = false;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [evidence, onLoad]);

  const currentPreview =
    preview.evidenceId === evidence.id ? preview : null;
  if (currentPreview?.failed) {
    return (
      <span className={styles.previewPlaceholder} aria-label="Preview unavailable">
        Photo
      </span>
    );
  }
  return currentPreview?.previewUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={currentPreview.previewUrl} alt="" />
  ) : (
    <span
      className={styles.previewPlaceholder}
      aria-label="Loading saved photo preview"
    />
  );
}

function PendingEvidencePreview({
  pending,
  replacing,
  contextLabel,
  onRemove,
}: {
  pending: GuidedPendingEvidence;
  replacing: boolean;
  contextLabel: string;
  onRemove: () => void;
}) {
  const uploadLocked = ["uploading", "finalising"].includes(
    pending.uploadStatus || "",
  );
  return (
    <div
      className={`${styles.preview} ${styles.pendingPreview}`}
      role="status"
      aria-live="polite"
    >
      <PendingPhotoPreview file={pending.file} />
      <span>
        <strong>
          {pending.uploadStatus === "uploading"
            ? `Saving securely ${Math.round(pending.uploadProgress || 0)}%`
            : pending.uploadStatus === "finalising"
              ? "Finishing the private save"
              : pending.uploadStatus === "failed"
                ? "Save interrupted"
                : replacing
                  ? "Replacement ready to save"
                  : "Ready to save with this plan"}
        </strong>
        <small>{pending.file.name}</small>
        {pending.uploadError ? (
          <small className={styles.previewError}>
            {pending.uploadError} Select Save changes to retry.
          </small>
        ) : replacing ? (
          <small>The current saved photo stays in place until this one saves.</small>
        ) : null}
      </span>
      <button
        type="button"
        onClick={onRemove}
        disabled={uploadLocked}
        aria-label={`Cancel selected photo for ${contextLabel}`}
      >
        Cancel
      </button>
    </div>
  );
}

function StoredEvidencePreview({
  evidence,
  contextLabel,
  removeDisabled,
  onLoad,
  onRemove,
}: {
  evidence: GuidedStoredEvidence;
  contextLabel: string;
  removeDisabled: boolean;
  onLoad: (evidence: GuidedStoredEvidence) => Promise<Blob>;
  onRemove: () => void;
}) {
  return (
    <div className={`${styles.preview} ${styles.savedPreview}`}>
      <StoredPhotoPreview evidence={evidence} onLoad={onLoad} />
      <span>
        <strong>Saved privately in this photo section</strong>
        <small>{evidence.fileName}</small>
        <small>
          {evidence.privacyStatus === "metadata-stripped"
            ? "Location and camera metadata removed"
            : "Protected inside your signed-in plan"}
        </small>
      </span>
      <button
        type="button"
        onClick={onRemove}
        disabled={removeDisabled}
        title={
          removeDisabled
            ? "Cancel the replacement before removing this saved photo"
            : undefined
        }
        aria-label={`Remove ${evidence.fileName} from ${contextLabel}`}
      >
        Remove
      </button>
    </div>
  );
}

export function CustomerProjectPhotoCapture({
  serviceCategories,
  remainingSlots,
  pendingEvidence,
  storedEvidence,
  onAdd,
  onRemovePending,
  onRemoveStored,
  onLoadStoredPreview,
}: {
  serviceCategories: string[];
  remainingSlots: number;
  pendingEvidence: GuidedPendingEvidence[];
  storedEvidence: GuidedStoredEvidence[];
  onAdd: (files: File[], preset: EvidencePreset) => void;
  onRemovePending: (id: string) => void;
  onRemoveStored: (evidence: GuidedStoredEvidence) => void;
  onLoadStoredPreview: (evidence: GuidedStoredEvidence) => Promise<Blob>;
}) {
  const guide = useMemo(
    () => customerProjectPhotoGuide(serviceCategories),
    [serviceCategories],
  );
  const [checks, setChecks] = useState({
    safe: false,
    relevant: false,
    private: false,
  });
  const ready = checks.safe && checks.relevant && checks.private;
  const pendingBySlot = useMemo(
    () => evidenceByCaptureSlot(pendingEvidence),
    [pendingEvidence],
  );
  const storedBySlot = useMemo(
    () => evidenceByCaptureSlot(storedEvidence),
    [storedEvidence],
  );
  const guideSlots = useMemo(
    () => new Set(guide.map((item) => item.id)),
    [guide],
  );
  const earlierStoredEvidence = useMemo(
    () => storedEvidence.filter(
      (item) =>
        Boolean(item.captureSlot)
        && !item.captureSlot.startsWith("other:")
        && item.contentType.startsWith("image/")
        && !guideSlots.has(item.captureSlot),
    ),
    [guideSlots, storedEvidence],
  );
  const earlierPendingEvidence = useMemo(
    () => pendingEvidence.filter(
      (item) =>
        Boolean(item.captureSlot)
        && !item.captureSlot.startsWith("other:")
        && item.file.type.startsWith("image/")
        && !guideSlots.has(item.captureSlot),
    ),
    [guideSlots, pendingEvidence],
  );
  const earlierSlots = useMemo(
    () => [...new Set([
      ...earlierStoredEvidence.map((item) => item.captureSlot),
      ...earlierPendingEvidence.map((item) => item.captureSlot),
    ])],
    [earlierPendingEvidence, earlierStoredEvidence],
  );

  const chooseNew = (
    item: CustomerProjectPhotoGuideItem,
    files: FileList | null,
  ) => {
    const file = files?.[0];
    if (!file || !ready || remainingSlots < 1) return;
    onAdd([file], {
      category: item.evidenceCategory,
      captureSlot: item.id,
      factKeys: item.factKeys,
    });
  };
  const chooseStoredReplacement = (
    stored: GuidedStoredEvidence,
    files: FileList | null,
  ) => {
    const file = files?.[0];
    if (!file || !ready) return;
    onAdd([file], {
      category: stored.category,
      captureSlot: stored.captureSlot,
      factKeys: stored.factKeys,
      replaceEvidenceId: stored.id,
      expectedEvidenceRevision: stored.revision,
    });
  };
  const choosePendingReplacement = (
    pending: GuidedPendingEvidence,
    files: FileList | null,
  ) => {
    const file = files?.[0];
    if (
      !file
      || !ready
      || ["uploading", "finalising"].includes(pending.uploadStatus || "")
    ) {
      return;
    }
    onAdd([file], {
      category: pending.category,
      captureSlot: pending.captureSlot,
      factKeys: pending.factKeys,
      replaceEvidenceId: pending.replaceEvidenceId,
      expectedEvidenceRevision: pending.expectedEvidenceRevision,
      replacePendingId: pending.id,
    });
  };

  return (
    <section className={styles.guide} aria-labelledby="guided-photo-title">
      <div className={styles.intro}>
        <div>
          <span>Guided safe capture</span>
          <h4 id="guided-photo-title">Take the photos that answer useful questions</h4>
          <p>
            These suggestions match the work selected above. Photos are optional,
            save privately first and never prove a home fact on their own.
          </p>
        </div>
        <strong>{Math.max(0, remainingSlots)} file spaces left</strong>
      </div>

      <fieldset className={styles.safety}>
        <legend>Before opening the camera, confirm all three</legend>
        <label>
          <input
            type="checkbox"
            checked={checks.safe}
            onChange={(event) =>
              setChecks((current) => ({ ...current, safe: event.target.checked }))
            }
          />
          <span>
            <strong>I can take it safely</strong>
            <small>
              I will stay on the ground or a normal floor, leave electrical
              covers in place and never enter a roof space or crawl under a home.
            </small>
          </span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={checks.relevant}
            onChange={(event) =>
              setChecks((current) => ({
                ...current,
                relevant: event.target.checked,
              }))
            }
          />
          <span>
            <strong>The photo will show the useful area clearly</strong>
            <small>I will use good light and include enough surrounding context.</small>
          </span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={checks.private}
            onChange={(event) =>
              setChecks((current) => ({
                ...current,
                private: event.target.checked,
              }))
            }
          />
          <span>
            <strong>I checked the frame for private information</strong>
            <small>
              No people, mail, street numbers, number plates, bills, NMI,
              account details, identity documents or passwords are visible.
            </small>
          </span>
        </label>
      </fieldset>

      {!ready && (
        <p className={styles.locked} role="status">
          Complete the three safety checks to enable the camera and photo picker.
        </p>
      )}

      <div className={styles.cards}>
        {guide.map((item) => {
          const promptPending = pendingBySlot.get(item.id) || [];
          const promptStored = storedBySlot.get(item.id) || [];
          const storedIds = new Set(promptStored.map((stored) => stored.id));
          const pendingAdditions = promptPending.filter(
            (pending) =>
              !pending.replaceEvidenceId
              || !storedIds.has(pending.replaceEvidenceId),
          );
          const photoCount = promptStored.length + pendingAdditions.length;
          const canAdd = ready && remainingSlots > 0;
          return (
            <article className={styles.card} key={item.id}>
              <div className={styles.cardTop}>
                <span>{item.required ? "Most useful" : "Helpful extra"}</span>
                <small>{item.serviceLabel}</small>
              </div>
              <h5>{item.label}</h5>
              <p>{item.guidance}</p>
              <details>
                <summary>See a clear example</summary>
                <div className={styles.examples}>
                  <p>
                    <strong>Useful</strong>
                    {item.usefulExample}
                  </p>
                  <p>
                    <strong>Avoid</strong>
                    {item.avoidExample}
                  </p>
                </div>
              </details>

              {photoCount > 0 && (
                <>
                  <p className={styles.photoCount}>
                    {photoCount} {photoCount === 1 ? "photo" : "photos"} in this section
                  </p>
                  <div
                    className={styles.photoList}
                    role="list"
                    aria-label={`Photos for ${item.label}`}
                  >
                    {promptStored.map((stored, index) => {
                    const replacement = promptPending.find(
                      (pending) => pending.replaceEvidenceId === stored.id,
                    );
                    const replacementLocked = replacement
                      ? ["uploading", "finalising"].includes(
                          replacement.uploadStatus || "",
                        )
                      : false;
                    const contextLabel = `${item.label}, photo ${index + 1}`;
                    return (
                      <div
                        className={styles.photoItem}
                        role="listitem"
                        key={stored.id}
                      >
                        <StoredEvidencePreview
                          evidence={stored}
                          contextLabel={contextLabel}
                          removeDisabled={Boolean(replacement)}
                          onLoad={onLoadStoredPreview}
                          onRemove={() => onRemoveStored(stored)}
                        />
                        {replacement && (
                          <PendingEvidencePreview
                            pending={replacement}
                            replacing
                            contextLabel={contextLabel}
                            onRemove={() => onRemovePending(replacement.id)}
                          />
                        )}
                        <div className={styles.actions}>
                          <label
                            aria-disabled={!ready || replacementLocked}
                            aria-label={`Retake ${contextLabel}`}
                          >
                            Retake this photo
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              capture="environment"
                              disabled={!ready || replacementLocked}
                              onChange={(event) => {
                                chooseStoredReplacement(stored, event.target.files);
                                event.target.value = "";
                              }}
                            />
                          </label>
                          <label
                            aria-disabled={!ready || replacementLocked}
                            aria-label={`Choose a replacement for ${contextLabel}`}
                          >
                            Choose replacement
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              disabled={!ready || replacementLocked}
                              onChange={(event) => {
                                chooseStoredReplacement(stored, event.target.files);
                                event.target.value = "";
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    );
                    })}
                    {pendingAdditions.map((pending, index) => {
                    const pendingLocked = ["uploading", "finalising"].includes(
                      pending.uploadStatus || "",
                    );
                    const contextLabel = `${item.label}, photo ${
                      promptStored.length + index + 1
                    }`;
                    return (
                      <div
                        className={styles.photoItem}
                        role="listitem"
                        key={pending.id}
                      >
                        <PendingEvidencePreview
                          pending={pending}
                          replacing={Boolean(pending.replaceEvidenceId)}
                          contextLabel={contextLabel}
                          onRemove={() => onRemovePending(pending.id)}
                        />
                        <div className={styles.actions}>
                          <label
                            aria-disabled={!ready || pendingLocked}
                            aria-label={`Retake selected ${contextLabel}`}
                          >
                            Retake selected photo
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              capture="environment"
                              disabled={!ready || pendingLocked}
                              onChange={(event) => {
                                choosePendingReplacement(pending, event.target.files);
                                event.target.value = "";
                              }}
                            />
                          </label>
                          <label
                            aria-disabled={!ready || pendingLocked}
                            aria-label={`Change selected ${contextLabel}`}
                          >
                            Choose replacement
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              disabled={!ready || pendingLocked}
                              onChange={(event) => {
                                choosePendingReplacement(pending, event.target.files);
                                event.target.value = "";
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    );
                    })}
                  </div>
                </>
              )}

              <div className={styles.actions}>
                <label
                  aria-disabled={!canAdd}
                  aria-label={`${
                    photoCount ? "Add another photo to" : "Take a photo for"
                  } ${item.label}`}
                >
                  {photoCount ? "Add another photo" : "Take photo"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    disabled={!canAdd}
                    onChange={(event) => {
                      chooseNew(item, event.target.files);
                      event.target.value = "";
                    }}
                  />
                </label>
                <label
                  aria-disabled={!canAdd}
                  aria-label={`${
                    photoCount ? "Choose another photo for" : "Choose a photo for"
                  } ${item.label}`}
                >
                  {photoCount ? "Choose another photo" : "Choose existing"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={!canAdd}
                    onChange={(event) => {
                      chooseNew(item, event.target.files);
                      event.target.value = "";
                    }}
                  />
                </label>
              </div>
              {ready && remainingSlots < 1 && (
                <p className={styles.limitNote} role="status">
                  All 12 file spaces are used. Replace or remove a photo to add
                  another.
                </p>
              )}
            </article>
          );
        })}
      </div>

      {earlierSlots.length > 0 && (
        <section
          className={styles.earlierSelection}
          aria-labelledby="earlier-selection-title"
        >
          <div className={styles.earlierSelectionHeader}>
            <div>
              <span>Still saved privately</span>
              <h5 id="earlier-selection-title">
                Saved from an earlier selection
              </h5>
            </div>
            <p>
              These photos no longer match the work selected above. Keep,
              replace or remove them here.
            </p>
          </div>
          <div className={styles.earlierSelectionList}>
            {earlierSlots.map((captureSlot) => {
              const slotStored = earlierStoredEvidence.filter(
                (stored) => stored.captureSlot === captureSlot,
              );
              const slotPending = earlierPendingEvidence.filter(
                (pending) => pending.captureSlot === captureSlot,
              );
              const storedIds = new Set(slotStored.map((stored) => stored.id));
              const pendingAdditions = slotPending.filter(
                (pending) =>
                  !pending.replaceEvidenceId
                  || !storedIds.has(pending.replaceEvidenceId),
              );
              const photoCount = slotStored.length + pendingAdditions.length;
              return (
                <article
                  className={styles.earlierSelectionItem}
                  key={captureSlot}
                  aria-label={`${photoCount} ${
                    photoCount === 1 ? "photo" : "photos"
                  } from an earlier selection`}
                >
                  <p className={styles.photoCount}>
                    {photoCount} {photoCount === 1 ? "photo" : "photos"} in this
                    saved section
                  </p>
                  <div className={styles.photoList} role="list">
                    {slotStored.map((stored, index) => {
                      const replacement = slotPending.find(
                        (pending) => pending.replaceEvidenceId === stored.id,
                      );
                      const replacementLocked = replacement
                        ? ["uploading", "finalising"].includes(
                            replacement.uploadStatus || "",
                          )
                        : false;
                      const contextLabel = `earlier selection, photo ${index + 1}`;
                      return (
                        <div
                          className={styles.photoItem}
                          role="listitem"
                          key={stored.id}
                        >
                          <StoredEvidencePreview
                            evidence={stored}
                            contextLabel={contextLabel}
                            removeDisabled={Boolean(replacement)}
                            onLoad={onLoadStoredPreview}
                            onRemove={() => onRemoveStored(stored)}
                          />
                          {replacement && (
                            <PendingEvidencePreview
                              pending={replacement}
                              replacing
                              contextLabel={contextLabel}
                              onRemove={() => onRemovePending(replacement.id)}
                            />
                          )}
                          <div className={styles.actions}>
                            <label
                              aria-disabled={!ready || replacementLocked}
                              aria-label={`Retake ${contextLabel}`}
                            >
                              Retake this photo
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                capture="environment"
                                disabled={!ready || replacementLocked}
                                onChange={(event) => {
                                  chooseStoredReplacement(
                                    stored,
                                    event.target.files,
                                  );
                                  event.target.value = "";
                                }}
                              />
                            </label>
                            <label
                              aria-disabled={!ready || replacementLocked}
                              aria-label={`Choose a replacement for ${contextLabel}`}
                            >
                              Choose replacement
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                disabled={!ready || replacementLocked}
                                onChange={(event) => {
                                  chooseStoredReplacement(
                                    stored,
                                    event.target.files,
                                  );
                                  event.target.value = "";
                                }}
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                    {pendingAdditions.map((pending, index) => {
                      const pendingLocked = ["uploading", "finalising"].includes(
                        pending.uploadStatus || "",
                      );
                      const contextLabel = `earlier selection, photo ${
                        slotStored.length + index + 1
                      }`;
                      return (
                        <div
                          className={styles.photoItem}
                          role="listitem"
                          key={pending.id}
                        >
                          <PendingEvidencePreview
                            pending={pending}
                            replacing={Boolean(pending.replaceEvidenceId)}
                            contextLabel={contextLabel}
                            onRemove={() => onRemovePending(pending.id)}
                          />
                          <div className={styles.actions}>
                            <label
                              aria-disabled={!ready || pendingLocked}
                              aria-label={`Retake selected ${contextLabel}`}
                            >
                              Retake selected photo
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                capture="environment"
                                disabled={!ready || pendingLocked}
                                onChange={(event) => {
                                  choosePendingReplacement(
                                    pending,
                                    event.target.files,
                                  );
                                  event.target.value = "";
                                }}
                              />
                            </label>
                            <label
                              aria-disabled={!ready || pendingLocked}
                              aria-label={`Change selected ${contextLabel}`}
                            >
                              Choose replacement
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                disabled={!ready || pendingLocked}
                                onChange={(event) => {
                                  choosePendingReplacement(
                                    pending,
                                    event.target.files,
                                  );
                                  event.target.value = "";
                                }}
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </section>
  );
}
