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
  captureSlot: string;
  replaceEvidenceId?: string;
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
};

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
    () => new Map(pendingEvidence.map((item) => [item.captureSlot, item])),
    [pendingEvidence],
  );
  const storedBySlot = useMemo(
    () => new Map(storedEvidence.map((item) => [item.captureSlot, item])),
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

  const choose = (item: CustomerProjectPhotoGuideItem, files: FileList | null) => {
    const file = files?.[0];
    const pending = pendingBySlot.get(item.id);
    const stored = storedBySlot.get(item.id);
    if (
      !file
      || !ready
      || (remainingSlots < 1 && !pending && !stored)
    ) {
      return;
    }
    onAdd([file], {
      category: item.evidenceCategory,
      captureSlot: item.id,
      factKeys: item.factKeys,
      ...(stored
        ? {
            replaceEvidenceId: stored.id,
            expectedEvidenceRevision: stored.revision,
          }
        : {}),
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
          const pending = pendingBySlot.get(item.id);
          const stored = storedBySlot.get(item.id);
          const canChoose = ready && (remainingSlots > 0 || Boolean(pending || stored));
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

              {pending ? (
                <div
                  className={`${styles.preview} ${styles.pendingPreview}`}
                  role="status"
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
                            : stored
                              ? "Replacement ready to save"
                              : "Ready to save with this plan"}
                    </strong>
                    <small>{pending.file.name}</small>
                    {pending.uploadError && (
                      <small className={styles.previewError}>
                        {pending.uploadError} Select Save changes to retry.
                      </small>
                    )}
                    {!pending.uploadError && stored && (
                      <small>The current saved photo stays in place until this one saves.</small>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemovePending(pending.id)}
                    disabled={["uploading", "finalising"].includes(
                      pending.uploadStatus || "",
                    )}
                  >
                    Cancel
                  </button>
                </div>
              ) : stored ? (
                <div className={`${styles.preview} ${styles.savedPreview}`}>
                  <StoredPhotoPreview
                    evidence={stored}
                    onLoad={onLoadStoredPreview}
                  />
                  <span>
                    <strong>Saved privately in this photo spot</strong>
                    <small>{stored.fileName}</small>
                    <small>
                      {stored.privacyStatus === "metadata-stripped"
                        ? "Location and camera metadata removed"
                        : "Protected inside your signed-in plan"}
                    </small>
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveStored(stored)}
                  >
                    Remove
                  </button>
                </div>
              ) : null}

              <div className={styles.actions}>
                <label aria-disabled={!canChoose}>
                  {pending || stored ? "Retake photo" : "Take photo"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    disabled={!canChoose}
                    onChange={(event) => {
                      choose(item, event.target.files);
                      event.target.value = "";
                    }}
                  />
                </label>
                <label aria-disabled={!canChoose}>
                  {pending || stored ? "Choose replacement" : "Choose existing"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={!canChoose}
                    onChange={(event) => {
                      choose(item, event.target.files);
                      event.target.value = "";
                    }}
                  />
                </label>
              </div>
            </article>
          );
        })}
      </div>

      {earlierStoredEvidence.length > 0 && (
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
            {earlierStoredEvidence.map((stored) => {
              const pending = pendingBySlot.get(stored.captureSlot);
              return (
                <article className={styles.earlierSelectionItem} key={stored.id}>
                  <div className={`${styles.preview} ${styles.savedPreview}`}>
                    <StoredPhotoPreview
                      evidence={stored}
                      onLoad={onLoadStoredPreview}
                    />
                    <span>
                      <strong>Saved privately with this plan</strong>
                      <small>{stored.fileName}</small>
                      <small>
                        {stored.privacyStatus === "metadata-stripped"
                          ? "Location and camera metadata removed"
                          : "Protected inside your signed-in plan"}
                      </small>
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveStored(stored)}
                      disabled={Boolean(pending)}
                      title={
                        pending
                          ? "Cancel the replacement before removing this saved photo"
                          : undefined
                      }
                    >
                      Remove
                    </button>
                  </div>

                  {pending && (
                    <div
                      className={`${styles.preview} ${styles.pendingPreview}`}
                      role="status"
                    >
                      <PendingPhotoPreview file={pending.file} />
                      <span>
                        <strong>
                          {pending.uploadStatus === "uploading"
                            ? `Saving replacement ${Math.round(
                                pending.uploadProgress || 0,
                              )}%`
                            : pending.uploadStatus === "finalising"
                              ? "Finishing the private save"
                              : pending.uploadStatus === "failed"
                                ? "Save interrupted"
                                : "Replacement ready to save"}
                        </strong>
                        <small>{pending.file.name}</small>
                        {pending.uploadError ? (
                          <small className={styles.previewError}>
                            {pending.uploadError} Select Save changes to retry.
                          </small>
                        ) : (
                          <small>
                            The current saved photo stays in place until this one
                            saves.
                          </small>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => onRemovePending(pending.id)}
                        disabled={["uploading", "finalising"].includes(
                          pending.uploadStatus || "",
                        )}
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  <div className={styles.actions}>
                    <label aria-disabled={!ready}>
                      Retake photo
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        capture="environment"
                        disabled={!ready}
                        onChange={(event) => {
                          chooseStoredReplacement(stored, event.target.files);
                          event.target.value = "";
                        }}
                      />
                    </label>
                    <label aria-disabled={!ready}>
                      Choose replacement
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={!ready}
                        onChange={(event) => {
                          chooseStoredReplacement(stored, event.target.files);
                          event.target.value = "";
                        }}
                      />
                    </label>
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
