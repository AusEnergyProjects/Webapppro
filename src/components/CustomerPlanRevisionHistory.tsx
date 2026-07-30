"use client";

import { useMemo, useState } from "react";
import { compareCustomerPlanRevisions } from "@/lib/customer-plan-revisions.mjs";
import styles from "./CustomerPlanRevisionHistory.module.css";

type Option = [string, string];
type PlanStep = {
  id: string;
  stage: string;
  title: string;
  text: string;
};
type PlanRevision = {
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
    title?: string;
    summary?: string;
    items?: PlanStep[];
  };
  restoredFromRevision: number;
  createdAt: string;
};

const label = (options: Option[], value: string) =>
  options.find(([key]) => key === value)?.[1] || value.replaceAll("-", " ");

function ChangeList({
  title,
  values,
}: {
  title: string;
  values: string[];
}) {
  if (!values.length) return null;
  return (
    <div>
      <h4>{title}</h4>
      <ul>
        {values.map((value, index) => (
          <li key={`${value}:${index}`}>{value}</li>
        ))}
      </ul>
    </div>
  );
}

export function CustomerPlanRevisionHistory({
  project,
  busy,
  goalOptions,
  homeFeatureOptions,
  paceOptions,
  budgetOptions,
  onRestore,
}: {
  project: {
    status: string;
    planRevision: number;
    goals: string[];
    existingFeatures: string[];
    pace: string;
    budgetRange: string;
    planSnapshot: { version?: string; items?: PlanStep[] };
    planRevisions: PlanRevision[];
  };
  busy: boolean;
  goalOptions: Option[];
  homeFeatureOptions: Option[];
  paceOptions: Option[];
  budgetOptions: Option[];
  onRestore: (sourceRevisionNumber: number) => Promise<void>;
}) {
  const [selectedNumber, setSelectedNumber] = useState(0);
  const [confirmationKey, setConfirmationKey] = useState("");
  const currentConfirmationKey = `${project.planRevision}:${selectedNumber}`;
  const confirmed = confirmationKey === currentConfirmationKey;
  const selected = project.planRevisions.find(
    (revision) => revision.revisionNumber === selectedNumber,
  );
  const comparison = useMemo(
    () =>
      selected
        ? compareCustomerPlanRevisions(selected, {
            revisionNumber: project.planRevision,
            planVersion: project.planSnapshot.version,
            goals: project.goals,
            homeFeatures: project.existingFeatures,
            pace: project.pace,
            budgetRange: project.budgetRange,
            planSnapshot: project.planSnapshot,
          })
        : null,
    [project, selected],
  );

  return (
    <div className={styles.history}>
      <ol className={styles.timeline}>
        {project.planRevisions.slice(0, 12).map((revision) => {
          const current = revision.revisionNumber === project.planRevision;
          return (
            <li
              className={
                selectedNumber === revision.revisionNumber ? styles.selected : ""
              }
              key={revision.id}
            >
              <div>
                <strong>
                  Version {revision.revisionNumber}
                  {current ? " | Current" : ""}
                </strong>
                <small>
                  {new Date(revision.createdAt).toLocaleString("en-AU")}
                  {" | "}
                  {revision.planSnapshot.items?.length || 0} ordered steps
                </small>
                {revision.eventType === "restored" && (
                  <span>
                    Restored from version {revision.restoredFromRevision}
                  </span>
                )}
              </div>
              <button
                type="button"
                aria-pressed={selectedNumber === revision.revisionNumber}
                onClick={() => {
                  setSelectedNumber(revision.revisionNumber);
                  setConfirmationKey("");
                }}
              >
                {selectedNumber === revision.revisionNumber
                  ? "Comparison open"
                  : "Compare with current"}
              </button>
            </li>
          );
        })}
      </ol>

      {selected && comparison && (
        <section
          aria-labelledby="plan-version-comparison-title"
          className={styles.comparison}
        >
          <header>
            <span>Version comparison</span>
            <h3 id="plan-version-comparison-title">
              Version {selected.revisionNumber} compared with current version{" "}
              {project.planRevision}
            </h3>
            <p>
              {comparison.changeCount === 0
                ? "These two versions have the same roadmap inputs and ordered steps."
                : `${comparison.changeCount} roadmap change${
                    comparison.changeCount === 1 ? "" : "s"
                  } found.`}
            </p>
          </header>

          {comparison.changeCount > 0 && (
            <div className={styles.changeGrid}>
              <ChangeList
                title={`Goals added after version ${selected.revisionNumber}`}
                values={comparison.goals.added.map((value: string) =>
                  label(goalOptions, value),
                )}
              />
              <ChangeList
                title={`Goals removed after version ${selected.revisionNumber}`}
                values={comparison.goals.removed.map((value: string) =>
                  label(goalOptions, value),
                )}
              />
              <ChangeList
                title="Home details added later"
                values={comparison.homeFeatures.added.map((value: string) =>
                  label(homeFeatureOptions, value),
                )}
              />
              <ChangeList
                title="Home details removed later"
                values={comparison.homeFeatures.removed.map((value: string) =>
                  label(homeFeatureOptions, value),
                )}
              />
              {comparison.pace.changed && (
                <div>
                  <h4>Planning pace changed</h4>
                  <p>
                    {label(paceOptions, comparison.pace.from)} to{" "}
                    {label(paceOptions, comparison.pace.to)}
                  </p>
                </div>
              )}
              {comparison.budgetRange.changed && (
                <div>
                  <h4>Budget range changed</h4>
                  <p>
                    {label(budgetOptions, comparison.budgetRange.from)} to{" "}
                    {label(budgetOptions, comparison.budgetRange.to)}
                  </p>
                </div>
              )}
              {comparison.planVersion.changed && (
                <div>
                  <h4>Advisor plan version changed</h4>
                  <p>
                    {comparison.planVersion.from || "Earlier advisor version"}{" "}
                    to {comparison.planVersion.to || "Current advisor version"}
                  </p>
                </div>
              )}
              <ChangeList
                title="Steps added later"
                values={comparison.steps.added.map(
                  (item: PlanStep) => item.title,
                )}
              />
              <ChangeList
                title="Steps removed later"
                values={comparison.steps.removed.map(
                  (item: PlanStep) => item.title,
                )}
              />
              <ChangeList
                title="Steps moved later"
                values={comparison.steps.moved.map(
                  (item: {
                    title: string;
                    fromPosition: number;
                    toPosition: number;
                  }) =>
                    `${item.title}: ${item.fromPosition} to ${item.toPosition}`,
                )}
              />
              <ChangeList
                title="Step wording changed later"
                values={comparison.steps.modified.map(
                  (item: { after: { title: string } }) => item.after.title,
                )}
              />
            </div>
          )}

          {selected.revisionNumber !== project.planRevision && (
            <div className={styles.restore}>
              {project.status === "draft" ? (
                <>
                  <h4>Restore this roadmap as a new version</h4>
                  <p>
                    Only goals, home answers used by the roadmap, planning pace,
                    budget range, ordered steps and compatible completion ticks
                    will change.
                  </p>
                  <p>
                    Project name, address, work categories, private notes,
                    adviser notes, evidence, permissions, quotes and installer
                    activity will not be replaced.
                  </p>
                  <label>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) =>
                        setConfirmationKey(
                          event.target.checked ? currentConfirmationKey : "",
                        )
                      }
                    />
                    <span>
                      I understand version {selected.revisionNumber} will become a
                      new current version. The existing history will remain.
                    </span>
                  </label>
                  <button
                    type="button"
                    disabled={busy || !confirmed}
                    onClick={() => void onRestore(selected.revisionNumber)}
                  >
                    {busy ? "Restoring..." : "Restore as new version"}
                  </button>
                </>
              ) : (
                <p>
                  Submitted scopes stay locked. Duplicate this project first if
                  you want to build a new private draft from earlier information.
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
