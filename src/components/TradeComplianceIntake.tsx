"use client";

import type { User } from "firebase/auth";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ComplianceActivity = {
  id: string;
  programId: string;
  organisationName: string;
  programName: string;
  programCode: string;
  schemeKind: string;
  jurisdiction: string;
  activityKey: string;
  version: number;
  title: string;
  serviceCategory: string;
  registryActivityCode: string;
  specificationPart: string;
  productCategory: string;
  scenarioCode: string;
  scenario: string;
  effectiveFrom: string;
  effectiveTo: string;
  officialSourceUrl: string;
  officialSourceTitle: string;
  officialSourceVersion: string;
  calculationApprovalState: string;
};

type CatalogueResponse = {
  ok?: boolean;
  activities?: ComplianceActivity[];
  context?: {
    serviceCategory: string;
    jurisdiction: string;
    activityDate: string;
  };
  existingCase?: {
    id: string;
    caseNumber: string;
    activityVersionId: string;
  };
  pagination?: {
    hasNext?: boolean;
    nextCursor?: string;
  };
  error?: string;
};

function scenarioValue(activity: ComplianceActivity) {
  return JSON.stringify([activity.scenarioCode, activity.scenario]);
}

function singleOrSelected<T extends string>(
  selected: T,
  values: T[],
) {
  return values.includes(selected) ? selected : values.length === 1 ? values[0] : "" as T;
}

export function TradeComplianceIntake({
  user,
  workOrderId,
  initialIntent,
  onChanged,
}: {
  user: User;
  workOrderId: string;
  initialIntent?: {
    programCode: string;
    activityKey: string;
    registryActivityCode: string;
    activityTitle: string;
  };
  onChanged: () => Promise<void>;
}) {
  const [activities, setActivities] = useState<ComplianceActivity[]>([]);
  const [context, setContext] = useState<CatalogueResponse["context"]>();
  const [programId, setProgramId] = useState("");
  const [activityKey, setActivityKey] = useState("");
  const [productCategory, setProductCategory] = useState("");
  const [scenario, setScenario] = useState("");
  const [activityVersionId, setActivityVersionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  const idempotencyKey = useRef("");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const token = await user.getIdToken();
      const nextActivities: ComplianceActivity[] = [];
      const seenIds = new Set<string>();
      const seenCursors = new Set<string>();
      let afterActivityId = "";
      let nextContext: CatalogueResponse["context"];
      for (;;) {
        if (seenCursors.has(afterActivityId)) {
          throw new Error("The governed activity catalogue returned an invalid page sequence.");
        }
        seenCursors.add(afterActivityId);
        const query = new URLSearchParams({ workOrderId });
        if (afterActivityId) query.set("afterActivityId", afterActivityId);
        const response = await fetch(`/api/trade-compliance?${query}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const result = await response.json() as CatalogueResponse;
        if (!response.ok || !result.ok) {
          throw new Error(
            result.error || "The governed activity catalogue is unavailable.",
          );
        }
        if (result.existingCase) {
          setReady(false);
          setMessage(
            `${result.existingCase.caseNumber} is already linked to this job.`,
          );
          setActivities([]);
          return;
        }
        nextContext = result.context || nextContext;
        for (const activity of result.activities || []) {
          if (!seenIds.has(activity.id)) {
            nextActivities.push(activity);
            seenIds.add(activity.id);
          }
        }
        if (!result.pagination?.hasNext) break;
        const nextCursor = String(result.pagination.nextCursor || "");
        if (!nextCursor || seenCursors.has(nextCursor)) {
          throw new Error("The governed activity catalogue returned an invalid page sequence.");
        }
        afterActivityId = nextCursor;
      }
      nextActivities.sort((left, right) =>
        [
          left.organisationName,
          left.programName,
          left.registryActivityCode,
          left.activityKey,
          left.productCategory,
          left.scenarioCode,
          String(9999 - left.version).padStart(4, "0"),
        ].join("|").localeCompare([
          right.organisationName,
          right.programName,
          right.registryActivityCode,
          right.activityKey,
          right.productCategory,
          right.scenarioCode,
          String(9999 - right.version).padStart(4, "0"),
        ].join("|"), "en-AU"));
      setActivities(nextActivities);
      setContext(nextContext);
      setReady(nextActivities.length > 0);
      const plannedActivity = initialIntent
        ? nextActivities.find((item) =>
          item.programCode === initialIntent.programCode
          && (
            initialIntent.registryActivityCode
              ? item.registryActivityCode === initialIntent.registryActivityCode
              : item.activityKey === initialIntent.activityKey
          ))
        : undefined;
      if (plannedActivity) {
        setProgramId(plannedActivity.programId);
        setActivityKey(plannedActivity.activityKey);
        setProductCategory("");
        setScenario("");
        setActivityVersionId("");
      }
      setMessage(nextActivities.length
        ? plannedActivity
          ? `${initialIntent?.programCode} ${initialIntent?.registryActivityCode || initialIntent?.activityKey} was planned when the job was created. Confirm the exact governed product, scenario and source version.`
          : "Choose the exact government activity for the accepted work."
        : initialIntent
          ? `${initialIntent.programCode} ${initialIntent.registryActivityCode || initialIntent.activityKey} is planned, but Creditex has not published a matching governed activity and evidence policy for this job yet.`
          : "No governed published activity applies to this job type, state and planned installation date.");
    } catch (error) {
      setActivities([]);
      setReady(false);
      setMessage(
        error instanceof Error
          ? error.message
          : "Compliance intake is unavailable.",
      );
    } finally {
      setLoading(false);
    }
  }, [initialIntent, user, workOrderId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const programs = useMemo(() => {
    const values = new Map<string, ComplianceActivity>();
    for (const item of activities) {
      if (!values.has(item.programId)) values.set(item.programId, item);
    }
    return [...values.values()];
  }, [activities]);
  const effectiveProgramId = singleOrSelected(
    programId,
    programs.map((item) => item.programId),
  );
  const activityOptions = useMemo(() => {
    const values = new Map<string, ComplianceActivity>();
    for (const item of activities) {
      if (
        item.programId === effectiveProgramId
        && !values.has(item.activityKey)
      ) {
        values.set(item.activityKey, item);
      }
    }
    return [...values.values()];
  }, [activities, effectiveProgramId]);
  const effectiveActivityKey = singleOrSelected(
    activityKey,
    activityOptions.map((item) => item.activityKey),
  );
  const productOptions = useMemo(() => [
    ...new Set(activities
      .filter((item) =>
        item.programId === effectiveProgramId
        && item.activityKey === effectiveActivityKey)
      .map((item) => item.productCategory)),
  ], [activities, effectiveActivityKey, effectiveProgramId]);
  const effectiveProductCategory = singleOrSelected(
    productCategory,
    productOptions,
  );
  const scenarioOptions = useMemo(() => {
    const values = new Map<string, ComplianceActivity>();
    for (const item of activities) {
      if (
        item.programId === effectiveProgramId
        && item.activityKey === effectiveActivityKey
        && item.productCategory === effectiveProductCategory
      ) {
        values.set(scenarioValue(item), item);
      }
    }
    return [...values.values()];
  }, [
    activities,
    effectiveActivityKey,
    effectiveProductCategory,
    effectiveProgramId,
  ]);
  const effectiveScenario = singleOrSelected(
    scenario,
    scenarioOptions.map(scenarioValue),
  );
  const versionOptions = useMemo(() => activities
    .filter((item) =>
      item.programId === effectiveProgramId
      && item.activityKey === effectiveActivityKey
      && item.productCategory === effectiveProductCategory
      && scenarioValue(item) === effectiveScenario)
    .sort((left, right) => right.version - left.version), [
    activities,
    effectiveActivityKey,
    effectiveProductCategory,
    effectiveProgramId,
    effectiveScenario,
  ]);
  const effectiveActivityVersionId = singleOrSelected(
    activityVersionId,
    versionOptions.map((item) => item.id),
  );
  const selectedActivity = activities.find(
    (item) => item.id === effectiveActivityVersionId,
  );

  async function openIntake() {
    if (!effectiveActivityVersionId) {
      setMessage("Choose the exact published activity version.");
      return;
    }
    setSaving(true);
    setMessage("Opening the Creditex compliance intake...");
    try {
      const token = await user.getIdToken();
      if (!idempotencyKey.current) {
        idempotencyKey.current = crypto.randomUUID();
      }
      const response = await fetch("/api/trade-compliance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          workOrderId,
          activityVersionId: effectiveActivityVersionId,
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const result = await response.json() as {
        ok?: boolean;
        complianceCaseNumber?: string;
        error?: string;
      };
      if (!response.ok || !result.ok) {
        throw new Error(
          result.error || "The compliance intake could not be opened.",
        );
      }
      setReady(false);
      setMessage(
        `${result.complianceCaseNumber || "Compliance case"} is ready for Creditex review.`,
      );
      await onChanged();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The compliance intake could not be opened.",
      );
    } finally {
      setSaving(false);
    }
  }

  return <section className="crm-job-compliance">
    <header>
      <div>
        <span>Accepted quote compliance</span>
        <h4>{initialIntent ? "Confirm the planned activity" : "Link the government activity"}</h4>
      </div>
      <strong>{loading ? "Checking..." : ready ? "Ready to link" : "Not ready"}</strong>
    </header>
    <p>
      TLink uses the accepted quote, job address, work type and planned
      installation date. Creditex receives the resulting case and evidence for
      audit.
    </p>
    {ready && <div className="crm-form-grid">
      <label>
        <span>Program</span>
        <select value={effectiveProgramId} onChange={(event) => {
          setProgramId(event.target.value);
          setActivityKey("");
          setProductCategory("");
          setScenario("");
          setActivityVersionId("");
        }}>
          <option value="">Choose program</option>
          {programs.map((item) => <option key={item.programId} value={item.programId}>
            {item.jurisdiction} | {item.programCode} | {item.programName}
          </option>)}
        </select>
      </label>
      <label>
        <span>Activity</span>
        <select value={effectiveActivityKey} disabled={!effectiveProgramId} onChange={(event) => {
          setActivityKey(event.target.value);
          setProductCategory("");
          setScenario("");
          setActivityVersionId("");
        }}>
          <option value="">Choose activity</option>
          {activityOptions.map((item) => <option key={item.activityKey} value={item.activityKey}>
            {item.registryActivityCode || item.activityKey} | {item.title}
          </option>)}
        </select>
      </label>
      <label>
        <span>Product category</span>
        <select value={effectiveProductCategory} disabled={!effectiveActivityKey} onChange={(event) => {
          setProductCategory(event.target.value);
          setScenario("");
          setActivityVersionId("");
        }}>
          <option value="">Choose product category</option>
          {productOptions.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      <label>
        <span>Activity scenario</span>
        <select value={effectiveScenario} disabled={!effectiveProductCategory} onChange={(event) => {
          setScenario(event.target.value);
          setActivityVersionId("");
        }}>
          <option value="">Choose activity scenario</option>
          {scenarioOptions.map((item) => <option key={scenarioValue(item)} value={scenarioValue(item)}>
            {item.scenarioCode ? `${item.scenarioCode} | ` : ""}{item.scenario}
          </option>)}
        </select>
      </label>
      <label className="wide">
        <span>Effective source version</span>
        <select value={effectiveActivityVersionId} disabled={!effectiveScenario} onChange={(event) => setActivityVersionId(event.target.value)}>
          <option value="">Choose exact effective version</option>
          {versionOptions.map((item) => <option key={item.id} value={item.id}>
            Version {item.version} | effective {item.effectiveFrom}
            {item.effectiveTo ? ` to ${item.effectiveTo}` : " onward"} | {item.officialSourceVersion || item.officialSourceTitle}
          </option>)}
        </select>
      </label>
    </div>}
    {context && <small>
      {context.jurisdiction} | {context.serviceCategory} | planned installation {context.activityDate}
    </small>}
    {selectedActivity && <div className="crm-compliance-notice">
      <strong>{selectedActivity.organisationName} will audit this case</strong>
      <p>
        TLink will pin the accepted quote scope and exact government source,
        activity, product, scenario and evidence policy version.
      </p>
      <a href={selectedActivity.officialSourceUrl} target="_blank" rel="noreferrer">
        Open official {selectedActivity.officialSourceVersion || "activity"} source
      </a>
    </div>}
    <div className="crm-wizard-actions">
      {!ready && !loading && <button type="button" onClick={() => void load()}>
        Check again
      </button>}
      {ready && <button type="button" className="btn" disabled={saving || !effectiveActivityVersionId} onClick={() => void openIntake()}>
        {saving ? "Opening intake..." : "Open Creditex intake"}
      </button>}
    </div>
    <p role="status">{message}</p>
  </section>;
}
