"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  buildCustomerPlanHistoryExport,
  compareCustomerOutcomeCheckins,
  customerOutcomeOptions,
  customerPlanRevisionLabel,
  serialiseCustomerPlanHistoryExport,
} from "@/lib/customer-plan-history.mjs";
import { compareCustomerPlanRevisions } from "@/lib/customer-plan-revisions.mjs";
import styles from "./CustomerPlanHistoryProgress.module.css";

type Option = [string, string];

const comfortOptions: Option[] = customerOutcomeOptions.comfort.map(
  ([value, optionLabel]) => [String(value), String(optionLabel)],
);
const energyOptions: Option[] = customerOutcomeOptions.energy.map(
  ([value, optionLabel]) => [String(value), String(optionLabel)],
);

export type CustomerPlanHistoryStep = {
  id: string;
  stage: string;
  title: string;
  text: string;
};

export type CustomerPlanHistoryRevision = {
  id: string;
  revisionNumber: number;
  eventType: string;
  planVersion: string;
  goals: string[];
  homeFeatures: string[];
  pace: string;
  budgetRange: string;
  planSnapshot: {
    version?: string;
    propertyContext?: Record<string, string>;
    serviceCategories?: string[];
    items?: CustomerPlanHistoryStep[];
  };
  restoredFromRevision: number;
  createdAt: string;
};

export type CustomerPlanProgressCheckin = {
  id: string;
  comfortOutcome: string;
  energyOutcome: string;
  completedItemIds: string[];
  note: string;
  recordedAt: string;
};

export type CustomerPlanHistoryProject = {
  id: string;
  status: string;
  planRevision: number;
  updatedAt: string;
  planRevisions: CustomerPlanHistoryRevision[];
  outcomeCheckins: CustomerPlanProgressCheckin[];
};

export type CustomerPlanHistoryLabels = {
  goals: Option[];
  homeFeatures: Option[];
  paces: Option[];
  budgets: Option[];
  serviceCategories: Option[];
};

export type CustomerPlanProgressInput = {
  comfortOutcome: string;
  energyOutcome: string;
  note: string;
  expectedPlanRevision: number;
  expectedUpdatedAt: string;
};

const label = (options: Option[], value: string) =>
  options.find(([key]) => key === value)?.[1]
  || value.replaceAll("-", " ").replaceAll("_", " ");

const auDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Saved date unavailable"
    : date.toLocaleString("en-AU");
};

function ChangeList({
  title,
  values,
}: {
  title: string;
  values: string[];
}) {
  if (!values.length) return null;
  return (
    <div className={styles.changeTile}>
      <h4>{title}</h4>
      <ul>
        {values.map((value, index) => (
          <li key={`${value}:${index}`}>{value}</li>
        ))}
      </ul>
    </div>
  );
}

function defaultRevisionPair(revisions: CustomerPlanHistoryRevision[]) {
  const ordered = [...revisions]
    .sort((left, right) => left.revisionNumber - right.revisionNumber);
  return {
    earlier: ordered.at(-2)?.revisionNumber || ordered[0]?.revisionNumber || 0,
    later: ordered.at(-1)?.revisionNumber || 0,
  };
}

function defaultOutcomePair(outcomes: CustomerPlanProgressCheckin[]) {
  const ordered = [...outcomes]
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
  return {
    earlier: ordered.at(-2)?.id || ordered[0]?.id || "",
    later: ordered.at(-1)?.id || "",
  };
}

export function CustomerPlanHistoryProgress({
  project,
  labels,
  busy,
  onRecordOutcome,
  onRestore,
  downloadFileName = "home-energy-plan-history.json",
}: {
  project: CustomerPlanHistoryProject;
  labels: CustomerPlanHistoryLabels;
  busy: boolean;
  onRecordOutcome: (input: CustomerPlanProgressInput) => Promise<void>;
  onRestore?: (sourceRevisionNumber: number) => Promise<void>;
  downloadFileName?: string;
}) {
  const orderedRevisions = useMemo(
    () => [...project.planRevisions]
      .sort((left, right) => left.revisionNumber - right.revisionNumber),
    [project.planRevisions],
  );
  const orderedOutcomes = useMemo(
    () => [...project.outcomeCheckins]
      .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt)),
    [project.outcomeCheckins],
  );
  const planStepLabels = useMemo(() => {
    const steps = new Map<string, string>();
    for (const revision of orderedRevisions) {
      for (const item of revision.planSnapshot.items || []) {
        if (item.id && item.title) steps.set(item.id, item.title);
      }
    }
    return steps;
  }, [orderedRevisions]);
  const revisionDefaults = useMemo(
    () => defaultRevisionPair(orderedRevisions),
    [orderedRevisions],
  );
  const outcomeDefaults = useMemo(
    () => defaultOutcomePair(orderedOutcomes),
    [orderedOutcomes],
  );
  const [selectedEarlierRevisionNumber, setEarlierRevisionNumber] = useState(
    revisionDefaults.earlier,
  );
  const [selectedLaterRevisionNumber, setLaterRevisionNumber] = useState(
    revisionDefaults.later,
  );
  const [selectedEarlierOutcomeId, setEarlierOutcomeId] = useState(
    outcomeDefaults.earlier,
  );
  const [selectedLaterOutcomeId, setLaterOutcomeId] = useState(
    outcomeDefaults.later,
  );
  const [comfortOutcome, setComfortOutcome] = useState("not-sure");
  const [energyOutcome, setEnergyOutcome] = useState("not-checked");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState("");
  const [restoreConfirmationKey, setRestoreConfirmationKey] = useState("");
  const latestRevisionNumber =
    orderedRevisions.at(-1)?.revisionNumber || 0;
  const earlierRevisionNumber = orderedRevisions.some(
    (revision) =>
      revision.revisionNumber === selectedEarlierRevisionNumber
      && revision.revisionNumber < latestRevisionNumber,
  )
    ? selectedEarlierRevisionNumber
    : revisionDefaults.earlier;
  const laterRevisionNumber = orderedRevisions.some(
    (revision) =>
      revision.revisionNumber === selectedLaterRevisionNumber
      && revision.revisionNumber > earlierRevisionNumber,
  )
    ? selectedLaterRevisionNumber
    : revisionDefaults.later;
  const earlierOutcomeId = orderedOutcomes
    .slice(0, -1)
    .some((outcome) => outcome.id === selectedEarlierOutcomeId)
    ? selectedEarlierOutcomeId
    : outcomeDefaults.earlier;
  const earlierOutcomePosition = orderedOutcomes.findIndex(
    (outcome) => outcome.id === earlierOutcomeId,
  );
  const laterOutcomeId = orderedOutcomes
    .slice(earlierOutcomePosition + 1)
    .some((outcome) => outcome.id === selectedLaterOutcomeId)
    ? selectedLaterOutcomeId
    : outcomeDefaults.later;
  const currentRestoreKey =
    `${project.id}:${project.planRevision}:${earlierRevisionNumber}`;
  const restoreConfirmed = restoreConfirmationKey === currentRestoreKey;

  const earlierRevision = orderedRevisions.find(
    (revision) => revision.revisionNumber === earlierRevisionNumber,
  );
  const laterRevision = orderedRevisions.find(
    (revision) => revision.revisionNumber === laterRevisionNumber,
  );
  const revisionComparison = useMemo(
    () => earlierRevision && laterRevision
      ? compareCustomerPlanRevisions(earlierRevision, laterRevision)
      : null,
    [earlierRevision, laterRevision],
  );
  const earlierOutcome = orderedOutcomes.find(
    (outcome) => outcome.id === earlierOutcomeId,
  );
  const laterOutcome = orderedOutcomes.find(
    (outcome) => outcome.id === laterOutcomeId,
  );
  const outcomeComparison = useMemo(
    () => earlierOutcome && laterOutcome
      ? compareCustomerOutcomeCheckins(earlierOutcome, laterOutcome)
      : null,
    [earlierOutcome, laterOutcome],
  );
  const earlierRevisionOptions = orderedRevisions.slice(0, -1);
  const laterRevisionOptions = orderedRevisions.filter(
    (revision) => revision.revisionNumber > earlierRevisionNumber,
  );
  const earlierOutcomeIndex = earlierOutcomePosition;
  const earlierOutcomeOptions = orderedOutcomes.slice(0, -1);
  const laterOutcomeOptions = orderedOutcomes.slice(earlierOutcomeIndex + 1);

  const changeEarlierRevision = (revisionNumber: number) => {
    setEarlierRevisionNumber(revisionNumber);
    const availableLater = orderedRevisions.find(
      (revision) => revision.revisionNumber > revisionNumber,
    );
    if (
      laterRevisionNumber <= revisionNumber
      && availableLater
    ) {
      setLaterRevisionNumber(availableLater.revisionNumber);
    }
    setRestoreConfirmationKey("");
  };

  const changeEarlierOutcome = (outcomeId: string) => {
    setEarlierOutcomeId(outcomeId);
    const index = orderedOutcomes.findIndex(
      (outcome) => outcome.id === outcomeId,
    );
    const currentLaterIndex = orderedOutcomes.findIndex(
      (outcome) => outcome.id === laterOutcomeId,
    );
    if (currentLaterIndex <= index && orderedOutcomes[index + 1]) {
      setLaterOutcomeId(orderedOutcomes[index + 1].id);
    }
  };

  const saveOutcome = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    try {
      await onRecordOutcome({
        comfortOutcome,
        energyOutcome,
        note,
        expectedPlanRevision: project.planRevision,
        expectedUpdatedAt: project.updatedAt,
      });
      setNote("");
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "The progress check-in could not be saved.",
      );
    }
  };

  const downloadSelectedHistory = () => {
    const selectedRevisionNumbers = [
      earlierRevisionNumber,
      laterRevisionNumber,
    ].filter(Boolean);
    const selectedOutcomeIds = [
      earlierOutcomeId,
      laterOutcomeId,
    ].filter(Boolean);
    const contents = serialiseCustomerPlanHistoryExport({
      revisions: orderedRevisions,
      selectedRevisionNumbers,
      outcomes: orderedOutcomes,
      selectedOutcomeIds,
      labels,
    });
    const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = downloadFileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <section className={styles.workspace} aria-labelledby="plan-history-title">
      <header className={styles.intro}>
        <div>
          <span>Private plan history</span>
          <h2 id="plan-history-title">See what changed and what happened next</h2>
          <p>
            Compare any two saved roadmaps, restore a draft version, or record
            a private household observation after trying a step.
          </p>
        </div>
        <button
          className={styles.exportButton}
          type="button"
          disabled={busy || orderedRevisions.length === 0}
          onClick={downloadSelectedHistory}
        >
          Download selected summary
        </button>
      </header>

      <p className={styles.privacyNote}>
        The downloaded summary leaves out exact addresses, room names,
        evidence filenames, private notes and custom roadmap wording.
      </p>

      <div className={styles.sectionGrid}>
        <section className={styles.panel} aria-labelledby="revision-history-title">
          <header className={styles.panelHeading}>
            <span>Roadmap versions</span>
            <h3 id="revision-history-title">Choose two versions to compare</h3>
            <p>
              Saved labels explain what happened without making you remember
              version numbers.
            </p>
          </header>

          {orderedRevisions.length > 1 ? (
            <div className={styles.selectGrid}>
              <label>
                <span>Earlier roadmap</span>
                <select
                  value={earlierRevisionNumber}
                  onChange={(event) =>
                    changeEarlierRevision(Number(event.target.value))
                  }
                >
                  {earlierRevisionOptions.map((revision) => (
                    <option
                      value={revision.revisionNumber}
                      key={revision.id}
                    >
                      {customerPlanRevisionLabel(revision)}, version{" "}
                      {revision.revisionNumber}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Later roadmap</span>
                <select
                  value={laterRevisionNumber}
                  onChange={(event) => {
                    setLaterRevisionNumber(Number(event.target.value));
    setRestoreConfirmationKey("");
                  }}
                >
                  {laterRevisionOptions.map((revision) => (
                    <option
                      value={revision.revisionNumber}
                      key={revision.id}
                    >
                      {customerPlanRevisionLabel(revision)}, version{" "}
                      {revision.revisionNumber}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <p className={styles.emptyState}>
              The next saved roadmap change will create another version to
              compare.
            </p>
          )}

          {orderedRevisions.length > 1
            && revisionComparison
            && earlierRevision
            && laterRevision && (
            <div className={styles.comparison}>
              <div className={styles.comparisonHeading}>
                <span>What changed</span>
                <h4>
                  {customerPlanRevisionLabel(earlierRevision)} to{" "}
                  {customerPlanRevisionLabel(laterRevision)}
                </h4>
                <p>
                  {revisionComparison.changeCount === 0
                    ? "These roadmaps use the same choices and ordered steps."
                    : `${revisionComparison.changeCount} meaningful roadmap change${
                        revisionComparison.changeCount === 1 ? "" : "s"
                      } found.`}
                </p>
              </div>
              {revisionComparison.changeCount > 0 && (
                <div className={styles.changeGrid}>
                  <ChangeList
                    title="Goals added"
                    values={revisionComparison.goals.added.map((value: string) =>
                      label(labels.goals, value)
                    )}
                  />
                  <ChangeList
                    title="Goals removed"
                    values={revisionComparison.goals.removed.map(
                      (value: string) => label(labels.goals, value),
                    )}
                  />
                  <ChangeList
                    title="Home details added"
                    values={revisionComparison.homeFeatures.added.map(
                      (value: string) => label(labels.homeFeatures, value),
                    )}
                  />
                  <ChangeList
                    title="Home details removed"
                    values={revisionComparison.homeFeatures.removed.map(
                      (value: string) => label(labels.homeFeatures, value),
                    )}
                  />
                  {revisionComparison.pace.changed && (
                    <div className={styles.changeTile}>
                      <h4>Planning pace</h4>
                      <p>
                        {label(labels.paces, revisionComparison.pace.from)} to{" "}
                        {label(labels.paces, revisionComparison.pace.to)}
                      </p>
                    </div>
                  )}
                  {revisionComparison.budgetRange.changed && (
                    <div className={styles.changeTile}>
                      <h4>Budget range</h4>
                      <p>
                        {label(
                          labels.budgets,
                          revisionComparison.budgetRange.from,
                        )}{" "}
                        to{" "}
                        {label(
                          labels.budgets,
                          revisionComparison.budgetRange.to,
                        )}
                      </p>
                    </div>
                  )}
                  <div className={styles.changeTile}>
                    <h4>Ordered roadmap</h4>
                    <p>
                      {revisionComparison.steps.added.length} added,{" "}
                      {revisionComparison.steps.removed.length} removed,{" "}
                      {revisionComparison.steps.moved.length} moved and{" "}
                      {revisionComparison.steps.modified.length} wording
                      change
                      {revisionComparison.steps.modified.length === 1
                        ? ""
                        : "s"}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          <ol className={styles.timeline}>
            {[...orderedRevisions].reverse().map((revision) => (
              <li key={revision.id}>
                <span className={styles.timelineMarker} aria-hidden="true" />
                <div>
                  <strong>{customerPlanRevisionLabel(revision)}</strong>
                  <small>
                    Version {revision.revisionNumber}
                    {revision.revisionNumber === project.planRevision
                      ? ", current"
                      : ""}
                    {" | "}
                    {auDate(revision.createdAt)}
                  </small>
                  {revision.eventType === "restored" && (
                    <p>
                      Built from version {revision.restoredFromRevision}.
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>

          {onRestore && orderedRevisions.length > 1 && earlierRevision && (
            <div className={styles.restore}>
              {project.status === "draft" ? (
                <>
                  <div>
                    <span>Draft-only restore</span>
                    <h4>
                      Restore version {earlierRevision.revisionNumber} as a new
                      current roadmap
                    </h4>
                    <p>
                      The current and earlier versions stay in history. Project
                      identity, private notes, evidence, quotes and installer
                      activity are not replaced.
                    </p>
                  </div>
                  <label className={styles.confirmation}>
                    <input
                      type="checkbox"
                      checked={restoreConfirmed}
                      onChange={(event) =>
                        setRestoreConfirmationKey(
                          event.target.checked ? currentRestoreKey : "",
                        )
                      }
                    />
                    <span>
                      I understand this creates a new current roadmap from the
                      selected earlier version.
                    </span>
                  </label>
                  <button
                    type="button"
                    disabled={busy || !restoreConfirmed}
                    onClick={() =>
                      void onRestore(earlierRevision.revisionNumber)
                    }
                  >
                    Restore selected roadmap
                  </button>
                </>
              ) : (
                <p>
                  Submitted scopes stay locked. Duplicate this project to build
                  a new private draft from earlier information.
                </p>
              )}
            </div>
          )}
        </section>

        <section className={styles.panel} aria-labelledby="progress-title">
          <header className={styles.panelHeading}>
            <span>Household progress</span>
            <h3 id="progress-title">Record what you noticed</h3>
            <p>
              Add a private check-in after trying a step. You can compare
              observations later without treating them as proof.
            </p>
          </header>

          <form className={styles.progressForm} onSubmit={saveOutcome}>
            <div className={styles.selectGrid}>
              <label>
                <span>Comfort since the last change</span>
                <select
                  value={comfortOutcome}
                  onChange={(event) => setComfortOutcome(event.target.value)}
                >
                  {comfortOptions.map(([value, optionLabel]) => (
                    <option value={value} key={value}>{optionLabel}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Energy use or bills</span>
                <select
                  value={energyOutcome}
                  onChange={(event) => setEnergyOutcome(event.target.value)}
                >
                  {energyOptions.map(([value, optionLabel]) => (
                    <option value={value} key={value}>{optionLabel}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              <span>Optional private note</span>
              <textarea
                rows={3}
                maxLength={500}
                value={note}
                placeholder="Example: The living room felt less draughty on cold evenings."
                onChange={(event) => setNote(event.target.value)}
              />
              <small>This note stays in the signed-in household account.</small>
            </label>
            {formError && (
              <p className={styles.formError} role="alert">{formError}</p>
            )}
            <button className={styles.primaryButton} type="submit" disabled={busy}>
              {busy ? "Saving check-in..." : "Save private check-in"}
            </button>
          </form>

          {orderedOutcomes.length > 1 ? (
            <>
              <div className={styles.progressDivider}>
                <span>Before and after</span>
                <h4>Choose two check-ins to compare</h4>
              </div>
              <div className={styles.selectGrid}>
                <label>
                  <span>Earlier check-in</span>
                  <select
                    value={earlierOutcomeId}
                    onChange={(event) =>
                      changeEarlierOutcome(event.target.value)
                    }
                  >
                    {earlierOutcomeOptions.map((outcome) => (
                      <option value={outcome.id} key={outcome.id}>
                        {auDate(outcome.recordedAt)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Later check-in</span>
                  <select
                    value={laterOutcomeId}
                    onChange={(event) => setLaterOutcomeId(event.target.value)}
                  >
                    {laterOutcomeOptions.map((outcome) => (
                      <option value={outcome.id} key={outcome.id}>
                        {auDate(outcome.recordedAt)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          ) : (
            <p className={styles.emptyState}>
              Save another check-in after trying a step to see a before and
              after comparison.
            </p>
          )}

          {orderedOutcomes.length > 1 && outcomeComparison && (
            <>
              <div className={styles.outcomeComparison}>
                <div>
                  <span>Comfort</span>
                  <strong>
                    {label(
                      comfortOptions,
                      outcomeComparison.comfort.from,
                    )}{" "}
                    to{" "}
                    {label(
                      comfortOptions,
                      outcomeComparison.comfort.to,
                    )}
                  </strong>
                </div>
                <div>
                  <span>Energy use or bills</span>
                  <strong>
                    {label(
                      energyOptions,
                      outcomeComparison.energy.from,
                    )}{" "}
                    to{" "}
                    {label(
                      energyOptions,
                      outcomeComparison.energy.to,
                    )}
                  </strong>
                </div>
                <div>
                  <span>Steps marked complete</span>
                  <strong>
                    {outcomeComparison.completedSteps.fromCount} to{" "}
                    {outcomeComparison.completedSteps.toCount}
                  </strong>
                </div>
              </div>
              {(outcomeComparison.completedSteps.addedItemIds.length > 0
                || outcomeComparison.completedSteps.removedItemIds.length > 0)
                && (
                  <div className={styles.progressChangeList}>
                    {outcomeComparison.completedSteps.addedItemIds.length > 0
                      && (
                        <div>
                          <h4>Newly marked complete</h4>
                          <ul>
                            {outcomeComparison.completedSteps.addedItemIds.map(
                              (itemId: string) => (
                                <li key={itemId}>
                                  {planStepLabels.get(itemId)
                                    || "Roadmap step"}
                                </li>
                              ),
                            )}
                          </ul>
                        </div>
                      )}
                    {outcomeComparison.completedSteps.removedItemIds.length > 0
                      && (
                        <div>
                          <h4>No longer marked complete</h4>
                          <ul>
                            {outcomeComparison.completedSteps.removedItemIds.map(
                              (itemId: string) => (
                                <li key={itemId}>
                                  {planStepLabels.get(itemId)
                                    || "Roadmap step"}
                                </li>
                              ),
                            )}
                          </ul>
                        </div>
                      )}
                  </div>
                )}
            </>
          )}

          <p className={styles.interpretationNote}>
            These are household observations. They do not prove that a roadmap
            step caused a change or guarantee energy or bill savings.
          </p>

          {orderedOutcomes.length > 0 && (
            <details className={styles.savedCheckins}>
              <summary>
                Review {orderedOutcomes.length} private check-in
                {orderedOutcomes.length === 1 ? "" : "s"}
              </summary>
              <ol>
                {[...orderedOutcomes].reverse().map((outcome) => (
                  <li key={outcome.id}>
                    <strong>
                      {label(
                        comfortOptions,
                        outcome.comfortOutcome,
                      )}
                      {" | "}
                      {label(
                        energyOptions,
                        outcome.energyOutcome,
                      )}
                    </strong>
                    <small>
                      {auDate(outcome.recordedAt)}
                      {" | "}
                      {outcome.completedItemIds.length} steps marked complete
                    </small>
                    {outcome.note && <p>{outcome.note}</p>}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </section>
      </div>
    </section>
  );
}

export { buildCustomerPlanHistoryExport };
