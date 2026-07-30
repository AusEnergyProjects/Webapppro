"use client";

import { useEffect, useMemo, useState } from "react";
import {
  customerProjectPhotoGuide,
  type CustomerProjectPhotoGuideItem,
} from "@/lib/customer-project-photo-guide";
import styles from "./CustomerProjectPhotoCapture.module.css";

type EvidencePreset = {
  category: CustomerProjectPhotoGuideItem["evidenceCategory"];
  factKeys: string[];
};

export function CustomerProjectPhotoCapture({
  serviceCategories,
  remainingSlots,
  onAdd,
}: {
  serviceCategories: string[];
  remainingSlots: number;
  onAdd: (files: File[], preset: EvidencePreset) => void;
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
  const [lastAdded, setLastAdded] = useState<{
    itemId: string;
    fileName: string;
    previewUrl: string;
  } | null>(null);
  const ready = checks.safe && checks.relevant && checks.private;

  useEffect(
    () => () => {
      if (lastAdded?.previewUrl) URL.revokeObjectURL(lastAdded.previewUrl);
    },
    [lastAdded],
  );

  const choose = (item: CustomerProjectPhotoGuideItem, files: FileList | null) => {
    const file = files?.[0];
    if (!file || !ready || remainingSlots < 1) return;
    if (lastAdded?.previewUrl) URL.revokeObjectURL(lastAdded.previewUrl);
    setLastAdded({
      itemId: item.id,
      fileName: file.name,
      previewUrl: URL.createObjectURL(file),
    });
    onAdd([file], {
      category: item.evidenceCategory,
      factKeys: item.factKeys,
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
        {guide.map((item) => (
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
            <div className={styles.actions}>
              <label aria-disabled={!ready || remainingSlots < 1}>
                Take photo
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  disabled={!ready || remainingSlots < 1}
                  onChange={(event) => {
                    choose(item, event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
              <label aria-disabled={!ready || remainingSlots < 1}>
                Choose existing
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={!ready || remainingSlots < 1}
                  onChange={(event) => {
                    choose(item, event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
            {lastAdded?.itemId === item.id && (
              <div className={styles.preview} role="status">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={lastAdded.previewUrl} alt="" />
                <span>
                  <strong>Added privately to this draft</strong>
                  <small>{lastAdded.fileName}</small>
                </span>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
