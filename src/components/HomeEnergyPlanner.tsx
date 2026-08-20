"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createCustomerProjectPlan,
  customerHomeFeatureSections as rawCustomerHomeFeatureSections,
  customerProjectOptions as rawCustomerProjectOptions,
  normalizeHomeFeatureSelections,
  updateHomeFeatureSelection,
} from "@/lib/customer-projects.mjs";
import { residentialStateFromPostcode } from "@/lib/australian-postcodes.mjs";
import { HomeFeatureIntake } from "@/components/HomeFeatureIntake";
import {
  PublicPlanEnquiryForm,
  type PublicPlanUpgradeInterest,
} from "@/components/PublicPlanEnquiryForm";
import styles from "./HomeEnergyPlanner.module.css";

type Option = [string, string];
type CustomerPlanItem = {
  id: string;
  stage: string;
  title: string;
  text: string;
  href: string;
  action: string;
  guidance?: {
    basedOn: string[];
    stillUncertain: string[];
    reconsiderIf: string[];
  };
};
type CustomerPlan = {
  title: string;
  summary: string;
  everydayActions: Array<{
    id: string;
    category: string;
    title: string;
    text: string;
  }>;
  everydayActionsBoundary: string;
  items: CustomerPlanItem[];
};
type InitialPlannerSelection = {
  goals: string[];
  pace: string;
  situation: string;
  approvalContext: string;
  budgetRange: string;
  postcode: string;
  addressState: string;
  features: string[];
  propertyType: string;
  storeys: string;
  ageBand: string;
  floorArea: string;
  occupants: string;
  sharedWalls: string;
  roofType: string;
  roofColour: string;
  roofForm: string;
  roofCondition: string;
  switchboard: string;
  wallConstruction: string;
  floorConstruction: string;
};
type PlannerDraft = InitialPlannerSelection;
type HomeFeatureQuestion = { id: string; options: Option[] };
type HomeFeatureSection = { id: string; questions: HomeFeatureQuestion[] };
type PropertyQuestionKey =
  | "storeys"
  | "ageBand"
  | "floorArea"
  | "sharedWalls"
  | "roofType"
  | "roofColour"
  | "roofForm"
  | "roofCondition"
  | "switchboard"
  | "wallConstruction"
  | "floorConstruction";

const customerProjectOptions = rawCustomerProjectOptions as unknown as {
  goals: Option[];
  paces: Option[];
  situations: Option[];
  approvalContexts: Option[];
  budgets: Option[];
  propertyTypes: Option[];
  storeys: Option[];
  ageBands: Option[];
  floorAreas: Option[];
  occupants: Option[];
  sharedWalls: Option[];
  roofTypes: Option[];
  roofColours: Option[];
  roofForms: Option[];
  roofConditions: Option[];
  switchboards: Option[];
  wallConstructions: Option[];
  floorConstructions: Option[];
  states: string[];
};

const customerHomeFeatureSections =
  rawCustomerHomeFeatureSections as unknown as HomeFeatureSection[];

const STORAGE_KEY = "aea-home-energy-assessment-v1";
const PRIMARY_STAGE_COUNT = 4;
const stageNames = [
  "Goal and household",
  "Comfort and building",
  "Current systems",
  "Timing and review",
] as const;
const comfortQuestionIds = [
  "comfort-concerns",
  "ceiling-insulation",
  "glazing",
  "heating-cooling-systems",
];
const systemQuestionIds = ["hot-water", "cooking", "solar", "battery", "ev"];
const commonPlannerFeatureDefaults = [
  ["comfort-concerns", "comfort-too-hot"],
  ["ceiling-insulation", "ceiling-insulation-limited"],
  ["glazing", "single-glazing"],
  ["heating-cooling-systems", "reverse-cycle"],
  ["hot-water", "electric-storage-hot-water"],
  ["cooking", "electric-resistance-cooking"],
  ["solar", "solar-none"],
  ["battery", "battery-none"],
  ["ev", "ev-none"],
] as const;

const planInterestByItemId = new Map<string, PublicPlanUpgradeInterest>([
  ["assessment", "assessment"],
  ["moisture-ventilation", "assessment"],
  ["electrical-supply-check", "assessment"],
  ["solar", "solar"],
  ["battery", "battery"],
  ["heating", "heating-cooling"],
  ["existing-reverse-cycle", "heating-cooling"],
  ["existing-hydronic-heating", "heating-cooling"],
  ["existing-wood-heating", "heating-cooling"],
  ["electric-resistance-heating-review", "heating-cooling"],
  ["hot-water", "hot-water"],
  ["existing-heat-pump-hot-water", "hot-water"],
  ["electric-hot-water-review", "hot-water"],
  ["draught-proofing", "draught-proofing"],
  ["insulation-review", "insulation"],
  ["windows-glazing", "glazing"],
  ["window-shading", "window-coverings"],
  ["ev", "ev-charging"],
]);

const optionalPropertyQuestions: Array<{
  key: PropertyQuestionKey;
  label: string;
  options: Option[];
}> = [
  { key: "storeys", label: "Storeys", options: customerProjectOptions.storeys },
  { key: "floorArea", label: "Approximate floor area", options: customerProjectOptions.floorAreas },
  { key: "ageBand", label: "Home age", options: customerProjectOptions.ageBands },
  { key: "sharedWalls", label: "Shared walls", options: customerProjectOptions.sharedWalls },
  { key: "wallConstruction", label: "External wall construction", options: customerProjectOptions.wallConstructions },
  { key: "floorConstruction", label: "Floor construction", options: customerProjectOptions.floorConstructions },
  { key: "roofType", label: "Roof covering", options: customerProjectOptions.roofTypes },
  { key: "roofColour", label: "Roof colour", options: customerProjectOptions.roofColours },
  { key: "roofForm", label: "Roof form", options: customerProjectOptions.roofForms },
  { key: "roofCondition", label: "Roof condition", options: customerProjectOptions.roofConditions },
  { key: "switchboard", label: "Switchboard", options: customerProjectOptions.switchboards },
];

function suggestedPlanInterests(items: CustomerPlanItem[]) {
  const interests: PublicPlanUpgradeInterest[] = [];
  for (const item of items) {
    const interest = planInterestByItemId.get(item.id);
    if (interest && !interests.includes(interest)) interests.push(interest);
  }
  return interests.length ? interests : ["assessment"];
}

function questionAnswered(features: string[], questionId: string) {
  const question = customerHomeFeatureSections
    .flatMap((section) => section.questions)
    .find((item) => item.id === questionId);
  return question?.options.some(([value]) => features.includes(value)) ?? false;
}

function withCommonPlannerFeatureDefaults(features: string[]) {
  let next = normalizeHomeFeatureSelections(features);
  for (const [questionId, value] of commonPlannerFeatureDefaults) {
    if (!questionAnswered(next, questionId)) {
      next = updateHomeFeatureSelection(next, questionId, value, true);
    }
  }
  return next;
}

function normalizeFloorInsulation(draft: PlannerDraft): PlannerDraft {
  if (draft.floorConstruction !== "slab_on_ground") return draft;
  return {
    ...draft,
    features: updateHomeFeatureSelection(
      draft.features,
      "floor-insulation",
      "floor-insulation-not-applicable",
      true,
    ),
  };
}

function defaultDraft(initialSelection: InitialPlannerSelection): PlannerDraft {
  const postcodeState = residentialStateFromPostcode(initialSelection.postcode);
  return normalizeFloorInsulation({
    ...initialSelection,
    goals: initialSelection.goals.length ? initialSelection.goals : ["lower-bills"],
    pace: initialSelection.pace || "staged",
    situation: initialSelection.situation || "owner",
    approvalContext: initialSelection.approvalContext || "none",
    budgetRange: initialSelection.budgetRange || "not_set",
    features: withCommonPlannerFeatureDefaults(initialSelection.features),
    propertyType: initialSelection.propertyType || "house",
    occupants: initialSelection.occupants || "two",
    addressState: postcodeState || "",
  });
}

function explicitInitialDraft(initialSelection: InitialPlannerSelection): PlannerDraft {
  return normalizeFloorInsulation({
    ...initialSelection,
    addressState: residentialStateFromPostcode(initialSelection.postcode) || "",
    features: normalizeHomeFeatureSelections(initialSelection.features),
  });
}

function hasExplicitSelection(selection: InitialPlannerSelection) {
  return Boolean(
    selection.postcode
    || selection.situation
    || selection.features.length
    || selection.propertyType
    || selection.occupants
    || selection.addressState,
  );
}

function firstIncompleteAssessmentStage(draft: PlannerDraft) {
  const postcodeState = residentialStateFromPostcode(draft.postcode);
  const householdComplete = Boolean(
    /^\d{4}$/.test(draft.postcode)
    && postcodeState
    && draft.addressState === postcodeState
    && draft.situation
    && draft.propertyType
    && draft.occupants,
  );
  if (!householdComplete) return 0;
  if (!comfortQuestionIds.every((id) => questionAnswered(draft.features, id))) return 1;
  if (!systemQuestionIds.every((id) => questionAnswered(draft.features, id))) return 2;
  return 4;
}

function storedOption(options: Option[], value: unknown, fallback = "") {
  return typeof value === "string" && options.some(([option]) => option === value)
    ? value
    : fallback;
}

function sanitizeStoredDraft(candidate: Partial<PlannerDraft>): PlannerDraft {
  const postcode = typeof candidate.postcode === "string"
    ? candidate.postcode.replace(/\D/g, "").slice(0, 4)
    : "";
  const goals = Array.isArray(candidate.goals)
    ? candidate.goals
        .filter((item): item is string => typeof item === "string")
        .filter((item) => customerProjectOptions.goals.some(([option]) => option === item))
        .slice(0, 10)
    : [];
  const rawFeatures = Array.isArray(candidate.features)
    ? candidate.features.filter((item): item is string => typeof item === "string").slice(0, 36)
    : [];
  return normalizeFloorInsulation({
    goals: goals.length ? goals : ["lower-bills"],
    pace: storedOption(customerProjectOptions.paces, candidate.pace, "staged"),
    situation: storedOption(customerProjectOptions.situations, candidate.situation, "owner"),
    approvalContext: storedOption(customerProjectOptions.approvalContexts, candidate.approvalContext, "none"),
    budgetRange: storedOption(customerProjectOptions.budgets, candidate.budgetRange, "not_set"),
    postcode,
    addressState: residentialStateFromPostcode(postcode) || "",
    features: withCommonPlannerFeatureDefaults(rawFeatures),
    propertyType: storedOption(customerProjectOptions.propertyTypes, candidate.propertyType, "house"),
    storeys: storedOption(customerProjectOptions.storeys, candidate.storeys),
    ageBand: storedOption(customerProjectOptions.ageBands, candidate.ageBand),
    floorArea: storedOption(customerProjectOptions.floorAreas, candidate.floorArea),
    occupants: storedOption(customerProjectOptions.occupants, candidate.occupants, "two"),
    sharedWalls: storedOption(customerProjectOptions.sharedWalls, candidate.sharedWalls),
    roofType: storedOption(customerProjectOptions.roofTypes, candidate.roofType),
    roofColour: storedOption(customerProjectOptions.roofColours, candidate.roofColour),
    roofForm: storedOption(customerProjectOptions.roofForms, candidate.roofForm),
    roofCondition: storedOption(customerProjectOptions.roofConditions, candidate.roofCondition),
    switchboard: storedOption(customerProjectOptions.switchboards, candidate.switchboard),
    wallConstruction: storedOption(customerProjectOptions.wallConstructions, candidate.wallConstruction),
    floorConstruction: storedOption(customerProjectOptions.floorConstructions, candidate.floorConstruction),
  });
}

function safeStoredDraft(value: string | null): { draft: PlannerDraft; stage: number } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { version?: unknown; draft?: unknown; stage?: unknown };
    if (parsed.version !== 1 || !parsed.draft || typeof parsed.draft !== "object") return null;
    const candidate = parsed.draft as Partial<PlannerDraft>;
    if (!Array.isArray(candidate.goals) || !Array.isArray(candidate.features)) return null;
    return {
      draft: sanitizeStoredDraft(candidate),
      stage: Number.isInteger(parsed.stage) && Number(parsed.stage) >= 0 && Number(parsed.stage) <= 4
        ? Number(parsed.stage)
        : 0,
    };
  } catch {
    return null;
  }
}

function readStoredAssessment() {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeAssessment(value: string) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, value);
  } catch {
    // The assessment remains fully usable when browser storage is unavailable.
  }
}

function removeStoredAssessment() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Reset the in-memory assessment even when browser storage is unavailable.
  }
}

function appendValues(params: URLSearchParams, name: string, values: string[]) {
  values.forEach((value) => params.append(name, value));
}

function ChoiceTiles({
  legend,
  name,
  options,
  selected,
  onSelect,
  multiple = false,
}: {
  legend: string;
  name: string;
  options: Option[];
  selected: string[];
  onSelect: (value: string) => void;
  multiple?: boolean;
}) {
  return (
    <fieldset className={styles.fieldset}>
      <legend>{legend}</legend>
      <div className={styles.tiles}>
        {options.map(([value, label]) => {
          const checked = selected.includes(value);
          return (
            <label className={checked ? styles.tileSelected : styles.tile} key={value}>
              <input
                type={multiple ? "checkbox" : "radio"}
                name={name}
                value={value}
                checked={checked}
                onChange={() => onSelect(value)}
              />
              <span>{label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function HomeEnergyPlanner({ initialSelection }: { initialSelection: InitialPlannerSelection }) {
  const initialDraft = useMemo(() => defaultDraft(initialSelection), [initialSelection]);
  const [draft, setDraft] = useState<PlannerDraft>(initialDraft);
  const [stage, setStage] = useState(() => firstIncompleteAssessmentStage(explicitInitialDraft(initialSelection)));
  const [attemptedStage, setAttemptedStage] = useState<number | null>(null);
  const [restored, setRestored] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hydratedRef = useRef(false);
  const previousStageRef = useRef(stage);

  useEffect(() => {
    let restoreFrame: number | undefined;
    if (!hasExplicitSelection(initialSelection)) {
      const stored = safeStoredDraft(readStoredAssessment());
      if (stored) {
        restoreFrame = window.requestAnimationFrame(() => {
          setDraft({ ...initialDraft, ...stored.draft });
          previousStageRef.current = stored.stage;
          setStage(stored.stage);
          setRestored(true);
          hydratedRef.current = true;
        });
      } else {
        hydratedRef.current = true;
      }
    } else {
      hydratedRef.current = true;
    }
    return () => {
      if (restoreFrame !== undefined) window.cancelAnimationFrame(restoreFrame);
    };
  }, [initialDraft, initialSelection]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    storeAssessment(JSON.stringify({ version: 1, draft, stage }));
  }, [draft, stage]);

  useEffect(() => {
    if (previousStageRef.current === stage) return;
    previousStageRef.current = stage;
    headingRef.current?.focus();
  }, [stage]);

  const plan = useMemo(
    () => createCustomerProjectPlan({
      goals: draft.goals,
      pace: draft.pace,
      situation: draft.situation,
      approvalContext: draft.approvalContext,
      budgetRange: draft.budgetRange,
      postcode: draft.postcode,
      addressState: draft.addressState,
      features: draft.features,
      propertyContext: {
        propertyType: draft.propertyType,
        storeys: draft.storeys,
        ageBand: draft.ageBand,
        floorArea: draft.floorArea,
        occupants: draft.occupants,
        sharedWalls: draft.sharedWalls,
        roofType: draft.roofType,
        roofColour: draft.roofColour,
        roofForm: draft.roofForm,
        roofCondition: draft.roofCondition,
        switchboard: draft.switchboard,
        wallConstruction: draft.wallConstruction,
        floorConstruction: draft.floorConstruction,
      },
    }) as CustomerPlan,
    [draft],
  );

  const selectionParams = useMemo(() => {
    const params = new URLSearchParams({
      pace: draft.pace,
      situation: draft.situation,
      approvalContext: draft.approvalContext,
      budgetRange: draft.budgetRange,
    });
    appendValues(params, "goal", draft.goals);
    appendValues(params, "feature", draft.features);
    for (const [key, value] of Object.entries(draft)) {
      if (["goals", "features", "pace", "situation", "approvalContext", "budgetRange"].includes(key)) continue;
      if (typeof value === "string" && value) params.set(key, value);
    }
    return params;
  }, [draft]);

  const printablePlanHref = `/plan/print?${selectionParams.toString()}`;
  const firstActionItem = plan.items.find((item) => Boolean(item.href));
  const enquiryInterests = suggestedPlanInterests(plan.items);
  const enquiryPropertyContext = {
    propertyType: draft.propertyType,
    storeys: draft.storeys,
    ageBand: draft.ageBand,
    floorArea: draft.floorArea,
    occupants: draft.occupants,
    sharedWalls: draft.sharedWalls,
    roofType: draft.roofType,
    roofColour: draft.roofColour,
    roofForm: draft.roofForm,
    roofCondition: draft.roofCondition,
    switchboard: draft.switchboard,
    wallConstruction: draft.wallConstruction,
    floorConstruction: draft.floorConstruction,
  };

  function setField<K extends keyof PlannerDraft>(key: K, value: PlannerDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function setPostcode(value: string) {
    const postcode = value.replace(/\D/g, "").slice(0, 4);
    const inferredState = /^\d{4}$/.test(postcode) ? residentialStateFromPostcode(postcode) : "";
    setDraft((current) => ({
      ...current,
      postcode,
      addressState: inferredState || "",
    }));
  }

  function toggleGoal(value: string) {
    setDraft((current) => {
      const goals = current.goals.includes(value)
        ? current.goals.length > 1
          ? current.goals.filter((item) => item !== value)
          : current.goals
        : [...current.goals, value];
      return { ...current, goals };
    });
  }

  function setPropertyAnswer(key: PropertyQuestionKey, value: string) {
    setDraft((current) => ({
      ...current,
      [key]: value,
      features: key === "floorConstruction"
        ? updateHomeFeatureSelection(
            current.features,
            "floor-insulation",
            "floor-insulation-not-applicable",
            value === "slab_on_ground",
          )
        : current.features,
    }));
  }

  function validationErrors(currentStage: number) {
    if (currentStage === 0) {
      const errors: string[] = [];
      const postcodeState = residentialStateFromPostcode(draft.postcode);
      if (!/^\d{4}$/.test(draft.postcode) || !postcodeState) {
        errors.push("Enter a valid four digit Australian residential postcode.");
      } else if (draft.addressState !== postcodeState) {
        errors.push("The postcode and detected state must match.");
      }
      if (!draft.situation) errors.push("Choose whether the household owns or rents the home.");
      if (!draft.propertyType) errors.push("Choose the home type, including Not sure.");
      if (!draft.occupants) errors.push("Choose the household size, including Not sure.");
      return errors;
    }
    if (currentStage === 1) {
      return comfortQuestionIds.every((id) => questionAnswered(draft.features, id))
        ? []
        : ["Answer the four core comfort questions. Not sure is a valid answer."];
    }
    if (currentStage === 2) {
      return systemQuestionIds.every((id) => questionAnswered(draft.features, id))
        ? []
        : ["Answer the hot water, cooking, solar, battery and vehicle questions. Not sure is a valid answer."];
    }
    return [];
  }

  const errors = attemptedStage === stage ? validationErrors(stage) : [];

  function continueAssessment() {
    const nextErrors = validationErrors(stage);
    setAttemptedStage(stage);
    if (nextErrors.length) return;
    setAttemptedStage(null);
    setStage((current) => Math.min(4, current + 1));
  }

  function resetPlan() {
    removeStoredAssessment();
    setDraft(defaultDraft({
      ...initialSelection,
      goals: ["lower-bills"],
      pace: "staged",
      situation: "",
      approvalContext: "none",
      budgetRange: "not_set",
      postcode: "",
      addressState: "",
      features: [],
      propertyType: "",
      storeys: "",
      ageBand: "",
      floorArea: "",
      occupants: "",
      sharedWalls: "",
      roofType: "",
      roofColour: "",
      roofForm: "",
      roofCondition: "",
      switchboard: "",
      wallConstruction: "",
      floorConstruction: "",
    }));
    setStage(0);
    setAttemptedStage(null);
    setRestored(false);
  }

  const progressValue = stage === 4 ? 100 : Math.round(((stage + 1) / PRIMARY_STAGE_COUNT) * 100);

  return (
    <section className={styles.layout} aria-label="Home energy assessment">
      <header className={styles.progressHeader}>
        <div>
          <span>{stage === 4 ? "Your roadmap is ready" : `Step ${stage + 1} of ${PRIMARY_STAGE_COUNT}`}</span>
          <strong>{stage === 4 ? "Your home energy roadmap" : stageNames[stage]}</strong>
          <small>{stage === 4 ? "Edit any stage whenever you need" : "Common answers are selected. Review and tap Next."}</small>
        </div>
        <div className={styles.progressTrack} role="progressbar" aria-label="Assessment progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressValue}>
          <span style={{ width: `${progressValue}%` }} />
        </div>
        {restored ? <p className={styles.restored} role="status">Your unfinished assessment was restored in this browser tab.</p> : null}
      </header>

      {stage < 4 ? (
        <form className={styles.form} onSubmit={(event) => { event.preventDefault(); continueAssessment(); }} noValidate>
          {errors.length ? (
            <div className={styles.errorSummary} role="alert" tabIndex={-1}>
              <strong>Check this step</strong>
              <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>
            </div>
          ) : null}

          <section className={styles.stageCard} aria-labelledby={`assessment-stage-${stage}`}>
            {stage === 0 ? (
              <>
                <div className={styles.stageIntro}>
                  <span>Start with what matters</span>
                  <h2 id="assessment-stage-0" ref={headingRef} tabIndex={-1}>Tell us about the household</h2>
                  <p>Enter the postcode, then review the common starting answers already selected below. Change anything that is different.</p>
                </div>
                <div className={styles.twoColumns}>
                  <label className={styles.textField}>
                    <span>Postcode</span>
                    <input inputMode="numeric" autoComplete="postal-code" maxLength={4} value={draft.postcode} onChange={(event) => setPostcode(event.target.value)} placeholder="3000" />
                    <small>{draft.addressState ? `State detected: ${draft.addressState}` : "Four digits"}</small>
                  </label>
                  <label className={styles.textField}>
                    <span>Detected state or territory</span>
                    <input readOnly value={draft.addressState} placeholder="Enter postcode first" aria-label="Detected state or territory" />
                  </label>
                </div>
                <ChoiceTiles legend="I am planning for" name="assessment-situation" options={customerProjectOptions.situations.map(([value, label]) => [value, value === "owner" ? "A home I own or manage" : label])} selected={draft.situation ? [draft.situation] : []} onSelect={(value) => setField("situation", value)} />
                <ChoiceTiles legend="Home type" name="assessment-property" options={customerProjectOptions.propertyTypes} selected={draft.propertyType ? [draft.propertyType] : []} onSelect={(value) => setField("propertyType", value)} />
                <ChoiceTiles legend="Shared property or approval" name="assessment-approval" options={customerProjectOptions.approvalContexts} selected={[draft.approvalContext]} onSelect={(value) => setField("approvalContext", value)} />
                <ChoiceTiles legend="People usually living here" name="assessment-occupants" options={customerProjectOptions.occupants} selected={draft.occupants ? [draft.occupants] : []} onSelect={(value) => setField("occupants", value)} />
                <ChoiceTiles legend="What matters most? Choose one or more." name="assessment-goals" options={customerProjectOptions.goals} selected={draft.goals} onSelect={toggleGoal} multiple />
              </>
            ) : null}

            {stage === 1 ? (
              <>
                <div className={styles.stageIntro}>
                  <span>Comfort before equipment</span>
                  <h2 id="assessment-stage-1" ref={headingRef} tabIndex={-1}>How does the home feel and perform?</h2>
                  <p>Common starting answers are preselected. Not sure is always valid; change every highlighted answer that differs for this home.</p>
                </div>
                <HomeFeatureIntake idPrefix="quick-comfort" sectionId="comfort" questionId="comfort-concerns" selected={draft.features} onChange={(features) => setField("features", features)} />
                <HomeFeatureIntake idPrefix="quick-insulation" sectionId="insulation" questionId="ceiling-insulation" selected={draft.features} onChange={(features) => setField("features", features)} />
                <HomeFeatureIntake idPrefix="quick-glazing" sectionId="windows" questionId="glazing" selected={draft.features} onChange={(features) => setField("features", features)} />
                <HomeFeatureIntake idPrefix="quick-heating" sectionId="heating-cooling" questionId="heating-cooling-systems" selected={draft.features} onChange={(features) => setField("features", features)} />
                <aside className={styles.preliminary} aria-live="polite">
                  <strong>Preliminary roadmap</strong>
                  <p>{plan.items.length} practical steps are already available. No dollar saving is invented without bill, tariff and equipment evidence.</p>
                </aside>
              </>
            ) : null}

            {stage === 2 ? (
              <>
                <div className={styles.stageIntro}>
                  <span>Systems already at the home</span>
                  <h2 id="assessment-stage-2" ref={headingRef} tabIndex={-1}>What currently provides energy services?</h2>
                  <p>Common systems are preselected so you can review and continue. Change anything that differs; these are planning answers, not electrical verification.</p>
                </div>
                <HomeFeatureIntake idPrefix="quick-hot-water-cooking" sectionId="hot-water-cooking" selected={draft.features} onChange={(features) => setField("features", features)} />
                <HomeFeatureIntake idPrefix="quick-solar" sectionId="solar-storage-transport" questionId="solar" selected={draft.features} onChange={(features) => setField("features", features)} />
                <HomeFeatureIntake idPrefix="quick-battery" sectionId="solar-storage-transport" questionId="battery" selected={draft.features} onChange={(features) => setField("features", features)} />
                <HomeFeatureIntake idPrefix="quick-ev" sectionId="solar-storage-transport" questionId="ev" selected={draft.features} onChange={(features) => setField("features", features)} />
              </>
            ) : null}

            {stage === 3 ? (
              <>
                <div className={styles.stageIntro}>
                  <span>Review before results</span>
                  <h2 id="assessment-stage-3" ref={headingRef} tabIndex={-1}>Choose timing, then review your answers</h2>
                  <p>Budget and advanced details are optional. Your roadmap remains useful without them.</p>
                </div>
                <ChoiceTiles legend="How should improvements be staged?" name="assessment-pace" options={customerProjectOptions.paces} selected={[draft.pace]} onSelect={(value) => setField("pace", value)} />
                <ChoiceTiles legend="Comfortable first-stage budget" name="assessment-budget" options={customerProjectOptions.budgets} selected={[draft.budgetRange]} onSelect={(value) => setField("budgetRange", value)} />
                <details className={styles.advanced}>
                  <summary>Optional advanced home details</summary>
                  <p>Add only what you safely know. Every selector can stay at Not sure.</p>
                  <div className={styles.selectGrid}>
                    {optionalPropertyQuestions.map((question) => (
                      <label className={styles.selectField} key={question.key}>
                        <span>{question.label}</span>
                        <select value={draft[question.key]} onChange={(event) => setPropertyAnswer(question.key, event.target.value)}>
                          <option value="">Not sure or skip</option>
                          {question.options.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                  <HomeFeatureIntake idPrefix="advanced-wall-insulation" sectionId="insulation" questionId="wall-insulation" selected={draft.features} onChange={(features) => setField("features", features)} />
                  {draft.floorConstruction === "slab_on_ground" ? (
                    <p className={styles.notApplicable}><strong>Under-floor insulation:</strong> Not applicable for the selected slab-on-ground construction.</p>
                  ) : (
                    <HomeFeatureIntake idPrefix="advanced-floor-insulation" sectionId="insulation" questionId="floor-insulation" selected={draft.features} onChange={(features) => setField("features", features)} />
                  )}
                  <HomeFeatureIntake idPrefix="advanced-window-coverings" sectionId="windows" questionId="window-coverings" selected={draft.features} onChange={(features) => setField("features", features)} />
                  <HomeFeatureIntake idPrefix="advanced-external-shading" sectionId="windows" questionId="external-shading" selected={draft.features} onChange={(features) => setField("features", features)} />
                  <HomeFeatureIntake idPrefix="advanced-sun-exposure" sectionId="windows" questionId="sun-exposure" selected={draft.features} onChange={(features) => setField("features", features)} />
                  <HomeFeatureIntake idPrefix="advanced-electrical" sectionId="solar-storage-transport" questionId="electrical-supply" selected={draft.features} onChange={(features) => setField("features", features)} />
                  <HomeFeatureIntake idPrefix="advanced-ventilation" sectionId="ventilation" selected={draft.features} onChange={(features) => setField("features", features)} />
                  <HomeFeatureIntake idPrefix="advanced-lighting" sectionId="lighting-pool" selected={draft.features} onChange={(features) => setField("features", features)} />
                </details>
                <section className={styles.review} aria-label="Assessment review">
                  <h3>Review</h3>
                  <dl>
                    <div><dt>Location</dt><dd>{draft.postcode}, {draft.addressState}</dd></div>
                    <div><dt>Household</dt><dd>{customerProjectOptions.occupants.find(([value]) => value === draft.occupants)?.[1] || "Not sure"}</dd></div>
                    <div><dt>Home</dt><dd>{customerProjectOptions.propertyTypes.find(([value]) => value === draft.propertyType)?.[1] || "Not sure"}</dd></div>
                    <div><dt>Priorities</dt><dd>{draft.goals.map((goal) => customerProjectOptions.goals.find(([value]) => value === goal)?.[1]).filter(Boolean).join(", ")}</dd></div>
                    <div><dt>Core system answers</dt><dd>{systemQuestionIds.filter((id) => questionAnswered(draft.features, id)).length} of {systemQuestionIds.length}</dd></div>
                  </dl>
                  <button type="button" onClick={() => setStage(0)}>Edit household details</button>
                </section>
              </>
            ) : null}

            <footer className={styles.actions}>
              {stage > 0 ? <button type="button" className={styles.secondaryButton} onClick={() => { setAttemptedStage(null); setStage((current) => current - 1); }}>Back</button> : <button type="button" className={styles.textButton} onClick={resetPlan}>Reset</button>}
              <button type="submit" className={styles.primaryButton}>{stage === 3 ? "Build my roadmap" : "Next"}</button>
            </footer>
            <p className={styles.saveNote}>Progress is kept in this browser tab when storage is available. It is sent to Australian Energy Assessments only if you explicitly open the printable plan or request contact.</p>
          </section>
        </form>
      ) : (
        <section className="planner-results" aria-labelledby="planner-results-title">
          <div className="planner-results-heading">
            <span>Your ordered roadmap</span>
            <h2 id="planner-results-title" ref={headingRef} tabIndex={-1}>{plan.title}</h2>
            <p>{plan.summary}</p>
            <p className="planner-results-status" role="status" aria-live="polite" aria-atomic="true">
              {plan.items.length} ordered steps prepared from your answers. This is general planning guidance, not a NatHERS rating, site assessment or guaranteed saving.
            </p>
          </div>
          {firstActionItem ? (
            <section className="planner-next-move" aria-labelledby="planner-next-move-title">
              <div>
                <span>Start here</span>
                <h3 id="planner-next-move-title">{firstActionItem.title}</h3>
                <p>{firstActionItem.text}</p>
              </div>
              <a href={firstActionItem.href}>{firstActionItem.action}</a>
            </section>
          ) : null}
          <section className="planner-result-decision" id="plan-enquiry" aria-label="Get help with this plan">
            <PublicPlanEnquiryForm
              planHref={printablePlanHref}
              initialPostcode={draft.postcode}
              suggestedInterests={enquiryInterests}
              planSnapshot={{
                goals: draft.goals,
                pace: draft.pace,
                situation: draft.situation,
                approvalContext: draft.approvalContext,
                budgetRange: draft.budgetRange,
                addressState: draft.addressState,
                features: draft.features,
                propertyContext: enquiryPropertyContext,
              }}
            />
          </section>
          <div className="planner-result-actions">
            <a className="planner-primary-result" href={printablePlanHref}>Open my printable plan</a>
            <button type="button" className="planner-reset" onClick={() => setStage(0)}>Edit my answers</button>
            <button type="button" className="planner-reset" onClick={resetPlan}>Start over</button>
          </div>

          {plan.everydayActions.length > 0 ? (
            <section className="planner-quick-wins" aria-labelledby="planner-quick-wins-title">
              <div className="planner-quick-wins-heading">
                <span>Do these first</span>
                <h3 id="planner-quick-wins-title">Quick wins for your home</h3>
                <p>{plan.everydayActionsBoundary}</p>
                <p><a href="https://www.energy.gov.au/households/quick-wins">Read the Australian Government quick-wins guidance</a></p>
              </div>
              <div className="planner-quick-wins-grid">
                {plan.everydayActions.map((action) => (
                  <article key={action.id}>
                    <small>{action.category}</small>
                    <h4>{action.title}</h4>
                    <p>{action.text}</p>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <ol className="planner-roadmap-list">
            {plan.items.map((item, index) => (
              <li key={item.id}>
                <span className="planner-order">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <small>{item.stage}</small>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                  {item.href ? <a href={item.href}>{item.action}</a> : null}
                  {item.guidance ? (
                    <details className="planner-item-rationale">
                      <summary>Why this is in the plan</summary>
                      <div>
                        {[["Based on", item.guidance.basedOn], ["Still uncertain", item.guidance.stillUncertain], ["Could change if", item.guidance.reconsiderIf]].map(([heading, reasons]) => (
                          <section key={heading as string}>
                            <strong>{heading as string}</strong>
                            <ul>{(reasons as string[]).map((reason) => <li key={reason}>{reason}</li>)}</ul>
                          </section>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>

          <div className="planner-boundary">
            <strong>Before committing</strong>
            <p>Replace indicative assumptions with current written quotes, confirm official incentives and approvals, and use licensed professionals for regulated work.</p>
          </div>

          <section className="planner-quick-wins" aria-labelledby="planner-continue-title">
            <div className="planner-quick-wins-heading">
              <span>Your next step</span>
              <h3 id="planner-continue-title">Keep the momentum going</h3>
              <p>Compare current plans, calculate source-verified rebates, or review assistance without mixing electricity and gas pricing.</p>
            </div>
            <div className="planner-quick-wins-grid">
              <article><small>Recommended next</small><h4>Compare electricity plans</h4><p>Use a bill or interval data when available.</p><a href="/compare?from=home-plan">Start electricity comparison</a></article>
              <article><small>If the home uses gas</small><h4>Compare gas plans</h4><p>Keep gas and electricity pricing separate.</p><a href="/gas-compare?from=home-plan">Start gas comparison</a></article>
              <article><small>Estimate an upgrade</small><h4>Use the rebate calculator</h4><p>Choose an activity and current approved product.</p><a href="/calculator">Open rebate calculator</a></article>
              <article><small>Understand assistance</small><h4>Review rebates and support</h4><p>Check current pathways before accepting a quote.</p><a href="/rebates">View rebates and assistance</a></article>
            </div>
          </section>
        </section>
      )}
    </section>
  );
}
