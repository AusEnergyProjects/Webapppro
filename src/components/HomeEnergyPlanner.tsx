"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createCustomerProjectPlan,
  customerHomeFeatureSections as rawCustomerHomeFeatureSections,
  customerProjectOptions as rawCustomerProjectOptions,
  updateHomeFeatureSelection,
} from "@/lib/customer-projects.mjs";
import { HomeFeatureIntake } from "@/components/HomeFeatureIntake";
import { PlannerHomeJourney } from "@/components/PlannerHomeJourney";
import {
  PublicPlanEnquiryForm,
  type PublicPlanUpgradeInterest,
} from "@/components/PublicPlanEnquiryForm";

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
  nextQuestions: Array<{
    id: string;
    prompt: string;
    whyItMatters: string;
    notSureAllowed: true;
  }>;
};
type InitialPlannerSelection = {
  goals: string[];
  pace: string;
  situation: string;
  approvalContext: string;
  budgetRange: string;
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
type HomeFeatureQuestion = {
  id: string;
  options: Option[];
};
type HomeFeatureSection = {
  id: string;
  title: string;
  questions: HomeFeatureQuestion[];
};
type PropertyQuestionKey =
  | "propertyType"
  | "storeys"
  | "ageBand"
  | "floorArea"
  | "occupants"
  | "sharedWalls"
  | "roofType"
  | "roofColour"
  | "roofForm"
  | "roofCondition"
  | "switchboard"
  | "wallConstruction"
  | "floorConstruction";
type PlannerStep =
  | { id: "situation" | "goals" | "shared-property" | "budget" | "pace" | "location"; label: string }
  | { id: "property"; label: string; propertyKey: PropertyQuestionKey; eyebrow: string; prompt: string; help: string; options: Option[] }
  | { id: "features"; label: string; featureSection: string; featureQuestion: string }
  | { id: "result"; label: string };

const customerProjectOptions = rawCustomerProjectOptions as unknown as {
  goals: Option[];
  paces: Option[];
  situations: Option[];
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

const plannerFeatureSteps = customerHomeFeatureSections.flatMap((section) =>
  section.questions.map((question): PlannerStep => ({
    id: "features",
    label: section.title,
    featureSection: section.id,
    featureQuestion: question.id,
  })),
);

const plannerPropertySteps: PlannerStep[] = [
  {
    id: "property",
    label: "Home type",
    propertyKey: "propertyType",
    eyebrow: "Home basics",
    prompt: "What type of home is it?",
    help: "This changes shared-wall, access and approval assumptions.",
    options: customerProjectOptions.propertyTypes,
  },
  {
    id: "property",
    label: "Storeys",
    propertyKey: "storeys",
    eyebrow: "Home basics",
    prompt: "How many storeys are inside the home?",
    help: "Home height can affect zoning, access and the scope of fixed work.",
    options: customerProjectOptions.storeys,
  },
  {
    id: "property",
    label: "Home size",
    propertyKey: "floorArea",
    eyebrow: "Home basics",
    prompt: "About how large is the home inside?",
    help: "A broad range is enough to frame scale without asking for a floor plan.",
    options: customerProjectOptions.floorAreas,
  },
  {
    id: "property",
    label: "Household size",
    propertyKey: "occupants",
    eyebrow: "Home basics",
    prompt: "How many people usually live here?",
    help: "This helps frame occupied zones and everyday hot-water demand. It is not used as a NatHERS occupancy input.",
    options: customerProjectOptions.occupants,
  },
  {
    id: "property",
    label: "Shared walls",
    propertyKey: "sharedWalls",
    eyebrow: "Home basics",
    prompt: "How many sides share a wall with another dwelling?",
    help: "Only count walls shared with a neighbouring home, not internal walls within your home.",
    options: customerProjectOptions.sharedWalls,
  },
  {
    id: "property",
    label: "Home age",
    propertyKey: "ageBand",
    eyebrow: "Construction context",
    prompt: "When was the main part of the home built?",
    help: "Use the main construction period. An extension can be checked separately during an assessment.",
    options: customerProjectOptions.ageBands,
  },
  {
    id: "property",
    label: "External walls",
    propertyKey: "wallConstruction",
    eyebrow: "Construction context",
    prompt: "What are the walls facing outdoors mainly made from?",
    help: "Choose from what is safely visible or recorded. This does not prove whether insulation is present.",
    options: customerProjectOptions.wallConstructions,
  },
  {
    id: "property",
    label: "Floor construction",
    propertyKey: "floorConstruction",
    eyebrow: "Construction context",
    prompt: "What is the main floor construction?",
    help: "Do not crawl under the home to check. Use a known record or choose Not sure.",
    options: customerProjectOptions.floorConstructions,
  },
  {
    id: "property",
    label: "Roof covering",
    propertyKey: "roofType",
    eyebrow: "Roof context",
    prompt: "What is the main roof covering?",
    help: "Use what is safely visible from ground level or an existing record. Do not climb onto the roof.",
    options: customerProjectOptions.roofTypes,
  },
  {
    id: "property",
    label: "Roof colour",
    propertyKey: "roofColour",
    eyebrow: "Roof context",
    prompt: "What colour is most of the roof?",
    help: "A broad light, mid or dark answer is enough. Do not climb onto the roof to check.",
    options: customerProjectOptions.roofColours,
  },
  {
    id: "property",
    label: "Roof form",
    propertyKey: "roofForm",
    eyebrow: "Roof context",
    prompt: "What is the main roof form?",
    help: "Choose the closest shape visible safely from ground level.",
    options: customerProjectOptions.roofForms,
  },
  {
    id: "property",
    label: "Roof condition",
    propertyKey: "roofCondition",
    eyebrow: "Roof context",
    prompt: "Is there a known roof condition problem?",
    help: "Answer from known leaks, visible damage or existing records. A professional should verify condition before roof-mounted work.",
    options: customerProjectOptions.roofConditions,
  },
  {
    id: "property",
    label: "Switchboard",
    propertyKey: "switchboard",
    eyebrow: "Electrical context",
    prompt: "Which switchboard description looks closest?",
    help: "Use a safe front-on look or an existing record. Never remove the cover. A licensed electrician must verify capacity.",
    options: customerProjectOptions.switchboards,
  },
];

const plannerStepsBeforeFeatures: PlannerStep[] = [
  { id: "situation", label: "Your home" },
  { id: "shared-property", label: "Shared property" },
  ...plannerPropertySteps,
  { id: "goals", label: "Priorities" },
];

const plannerStepsAfterFeatures: PlannerStep[] = [
  { id: "budget", label: "Investment" },
  { id: "pace", label: "Timing" },
  { id: "location", label: "Location" },
  { id: "result", label: "Your plan" },
];

const plannerSteps: PlannerStep[] = [
  ...plannerStepsBeforeFeatures,
  ...plannerFeatureSteps,
  ...plannerStepsAfterFeatures,
];
const floorInsulationStepIndex = plannerSteps.findIndex(
  (step) => step.id === "features" && step.featureQuestion === "floor-insulation",
);
const plannerStages = ["understand", "home", "direction", "plan"] as const;

function appendValues(params: URLSearchParams, name: string, values: string[]) {
  values.forEach((value) => params.append(name, value));
}

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

function suggestedPlanInterests(items: CustomerPlanItem[]) {
  const interests: PublicPlanUpgradeInterest[] = [];
  for (const item of items) {
    const interest = planInterestByItemId.get(item.id);
    if (interest && !interests.includes(interest)) interests.push(interest);
  }
  return interests.length ? interests : ["assessment"];
}

function initialPlannerStep(selection: InitialPlannerSelection) {
  const isDefault = selection.goals.length === 1
    && selection.goals[0] === "lower-bills"
    && selection.pace === "staged"
    && !selection.situation
    && selection.approvalContext === "not_sure"
    && selection.budgetRange === "not_set"
    && !selection.addressState
    && selection.features.length === 0
    && !selection.propertyType
    && !selection.storeys
    && !selection.ageBand
    && !selection.floorArea
    && !selection.occupants
    && !selection.sharedWalls
    && !selection.roofType
    && !selection.roofColour
    && !selection.roofForm
    && !selection.roofCondition
    && !selection.switchboard
    && !selection.wallConstruction
    && !selection.floorConstruction;
  return isDefault ? 0 : plannerSteps.length - 1;
}

export function HomeEnergyPlanner({ initialSelection }: { initialSelection: InitialPlannerSelection }) {
  const [goals, setGoals] = useState(initialSelection.goals);
  const [pace, setPace] = useState(initialSelection.pace);
  const [situation, setSituation] = useState(initialSelection.situation);
  const [approvalContext, setApprovalContext] = useState(initialSelection.approvalContext);
  const [budgetRange, setBudgetRange] = useState(initialSelection.budgetRange);
  const [addressState, setAddressState] = useState(initialSelection.addressState);
  const [features, setFeatures] = useState(() => (
    initialSelection.floorConstruction === "slab_on_ground"
      ? updateHomeFeatureSelection(
          initialSelection.features,
          "floor-insulation",
          "floor-insulation-not-applicable",
        )
      : initialSelection.features
  ));
  const [propertyType, setPropertyType] = useState(initialSelection.propertyType);
  const [storeys, setStoreys] = useState(initialSelection.storeys);
  const [ageBand, setAgeBand] = useState(initialSelection.ageBand);
  const [floorArea, setFloorArea] = useState(initialSelection.floorArea);
  const [occupants, setOccupants] = useState(initialSelection.occupants);
  const [sharedWalls, setSharedWalls] = useState(initialSelection.sharedWalls);
  const [roofType, setRoofType] = useState(initialSelection.roofType);
  const [roofColour, setRoofColour] = useState(initialSelection.roofColour);
  const [roofForm, setRoofForm] = useState(initialSelection.roofForm);
  const [roofCondition, setRoofCondition] = useState(initialSelection.roofCondition);
  const [switchboard, setSwitchboard] = useState(initialSelection.switchboard);
  const [wallConstruction, setWallConstruction] = useState(initialSelection.wallConstruction);
  const [floorConstruction, setFloorConstruction] = useState(initialSelection.floorConstruction);
  const [stepIndex, setStepIndex] = useState(() => initialPlannerStep(initialSelection));
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const hasChangedStep = useRef(false);
  const currentStep = plannerSteps[stepIndex];
  const questionCount = plannerSteps.length - 1;
  const isResult = currentStep.id === "result";
  const floorInsulationIsInapplicable = floorConstruction === "slab_on_ground";
  const visibleQuestionCount = questionCount - (floorInsulationIsInapplicable ? 1 : 0);
  const visibleQuestionNumber = stepIndex + 1 - (
    floorInsulationIsInapplicable && stepIndex > floorInsulationStepIndex ? 1 : 0
  );
  const stageIndex = isResult
    ? 3
    : currentStep.id === "features"
      ? 1
      : stepIndex < plannerStepsBeforeFeatures.length
        ? 0
        : 2;
  const progressValue = isResult
    ? 100
    : Math.round((visibleQuestionNumber / visibleQuestionCount) * 100);
  const currentFeatureQuestion = currentStep.id === "features"
    ? customerHomeFeatureSections
        .find((section) => section.id === currentStep.featureSection)
        ?.questions.find((question) => question.id === currentStep.featureQuestion)
    : undefined;
  const hasCurrentFeatureAnswer = currentFeatureQuestion?.options.some(([value]) =>
    features.includes(value)) ?? false;
  const propertyAnswers: Record<PropertyQuestionKey, string> = {
    propertyType,
    storeys,
    ageBand,
    floorArea,
    occupants,
    sharedWalls,
    roofType,
    roofColour,
    roofForm,
    roofCondition,
    switchboard,
    wallConstruction,
    floorConstruction,
  };
  const currentPropertyAnswer = currentStep.id === "property"
    ? propertyAnswers[currentStep.propertyKey]
    : "";

  useEffect(() => {
    if (!hasChangedStep.current) return;
    stepHeadingRef.current?.focus();
  }, [stepIndex]);

  const plan = useMemo(
    () => createCustomerProjectPlan({
      goals,
      pace,
      situation,
      approvalContext,
      budgetRange,
      addressState,
      features,
      propertyContext: {
        propertyType,
        storeys,
        ageBand,
        floorArea,
        occupants,
        sharedWalls,
        roofType,
        roofColour,
        roofForm,
        roofCondition,
        switchboard,
        wallConstruction,
        floorConstruction,
      },
    }) as CustomerPlan,
    [
      goals,
      pace,
      situation,
      approvalContext,
      budgetRange,
      addressState,
      features,
      propertyType,
      storeys,
      ageBand,
      floorArea,
      occupants,
      sharedWalls,
      roofType,
      roofColour,
      roofForm,
      roofCondition,
      switchboard,
      wallConstruction,
      floorConstruction,
    ],
  );

  const selectionParams = useMemo(() => {
    const params = new URLSearchParams({
      pace,
      situation,
      approvalContext,
      budgetRange,
    });
    appendValues(params, "goal", goals);
    appendValues(params, "feature", features);
    if (addressState) params.set("addressState", addressState);
    if (propertyType) params.set("propertyType", propertyType);
    if (storeys) params.set("storeys", storeys);
    if (ageBand) params.set("ageBand", ageBand);
    if (floorArea) params.set("floorArea", floorArea);
    if (occupants) params.set("occupants", occupants);
    if (sharedWalls) params.set("sharedWalls", sharedWalls);
    if (roofType) params.set("roofType", roofType);
    if (roofColour) params.set("roofColour", roofColour);
    if (roofForm) params.set("roofForm", roofForm);
    if (roofCondition) params.set("roofCondition", roofCondition);
    if (switchboard) params.set("switchboard", switchboard);
    if (wallConstruction) params.set("wallConstruction", wallConstruction);
    if (floorConstruction) params.set("floorConstruction", floorConstruction);
    return params;
  }, [
    goals,
    pace,
    situation,
    approvalContext,
    budgetRange,
    addressState,
    features,
    propertyType,
    storeys,
    ageBand,
    floorArea,
    occupants,
    sharedWalls,
    roofType,
    roofColour,
    roofForm,
    roofCondition,
    switchboard,
    wallConstruction,
    floorConstruction,
  ]);
  const printablePlanHref = `/plan/print?${selectionParams.toString()}`;
  const firstActionItem = plan.items.find((item) => Boolean(item.href));
  const enquiryInterests = suggestedPlanInterests(plan.items);
  const enquiryPropertyContext = {
    propertyType,
    storeys,
    ageBand,
    floorArea,
    occupants,
    sharedWalls,
    roofType,
    roofColour,
    roofForm,
    roofCondition,
    switchboard,
    wallConstruction,
    floorConstruction,
  };

  const sharedPropertyAnswer = approvalContext === "strata"
    ? "yes"
    : approvalContext === "none"
      ? "no"
      : "not_sure";

  function setSharedPropertyAnswer(value: string) {
    setApprovalContext(value === "yes" ? "strata" : value === "no" ? "none" : "not_sure");
  }

  function toggleGoal(value: string) {
    setGoals((current) => {
      if (!current.includes(value)) return [...current, value];
      return current.length > 1 ? current.filter((item) => item !== value) : current;
    });
  }

  function setPropertyAnswer(key: PropertyQuestionKey, value: string) {
    const setters: Record<PropertyQuestionKey, (next: string) => void> = {
      propertyType: setPropertyType,
      storeys: setStoreys,
      ageBand: setAgeBand,
      floorArea: setFloorArea,
      occupants: setOccupants,
      sharedWalls: setSharedWalls,
      roofType: setRoofType,
      roofColour: setRoofColour,
      roofForm: setRoofForm,
      roofCondition: setRoofCondition,
      switchboard: setSwitchboard,
      wallConstruction: setWallConstruction,
      floorConstruction: setFloorConstruction,
    };
    setters[key](value);
    if (key === "floorConstruction") {
      setFeatures((current) => updateHomeFeatureSelection(
        current,
        "floor-insulation",
        "floor-insulation-not-applicable",
        value === "slab_on_ground",
      ));
    }
  }

  function goToStep(nextIndex: number) {
    hasChangedStep.current = true;
    const direction = Math.sign(nextIndex - stepIndex);
    let resolvedIndex = Math.max(0, Math.min(plannerSteps.length - 1, nextIndex));
    const isInapplicableFloorInsulation = (index: number) => {
      const step = plannerSteps[index];
      return step?.id === "features"
        && step.featureQuestion === "floor-insulation"
        && floorConstruction === "slab_on_ground";
    };
    while (direction !== 0 && isInapplicableFloorInsulation(resolvedIndex)) {
      resolvedIndex = Math.max(
        0,
        Math.min(plannerSteps.length - 1, resolvedIndex + direction),
      );
    }
    setStepIndex(resolvedIndex);
  }

  function resetPlan() {
    setGoals(["lower-bills"]);
    setPace("staged");
    setSituation("");
    setApprovalContext("not_sure");
    setBudgetRange("not_set");
    setAddressState("");
    setFeatures([]);
    setPropertyType("");
    setStoreys("");
    setAgeBand("");
    setFloorArea("");
    setOccupants("");
    setSharedWalls("");
    setRoofType("");
    setRoofColour("");
    setRoofForm("");
    setRoofCondition("");
    setSwitchboard("");
    setWallConstruction("");
    setFloorConstruction("");
    goToStep(0);
  }

  const canContinue = currentStep.id === "situation"
    ? Boolean(situation)
    : currentStep.id === "property"
      ? Boolean(currentPropertyAnswer)
      : currentStep.id === "features"
        ? hasCurrentFeatureAnswer
        : true;
  const continueLabel = currentStep.id === "location"
    ? "Build my plan"
    : "Continue";

  return (
    <section className="planner-layout" aria-label="Home energy planning tool">
      <PlannerHomeJourney
        stage={plannerStages[stageIndex]}
        progress={progressValue}
        focusLabel={currentStep.label}
        focusKey={currentStep.id === "features"
          ? currentStep.featureQuestion
          : currentStep.id === "property"
            ? currentStep.propertyKey
            : currentStep.id}
        selectedFeatureCount={features.length}
      />
      <header className="planner-progress-shell">
        <div className="planner-progress-copy">
          <span>{isResult ? "Plan ready" : `Question ${visibleQuestionNumber} of ${visibleQuestionCount}`}</span>
          <strong>{currentStep.label}</strong>
          <small>{progressValue}% complete</small>
        </div>
        <div
          className="planner-progress-track"
          role="progressbar"
          aria-label="Home plan progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressValue}
        >
          <span style={{ width: `${progressValue}%` }} />
        </div>
      </header>

      {!isResult ? (
        <form className="planner-controls planner-guided-controls" onSubmit={(event) => event.preventDefault()}>
          <section className="planner-step-card" aria-labelledby={`planner-step-${stepIndex}`}>
            <span className={`planner-stage-emblem planner-stage-emblem-${plannerStages[stageIndex]}`} aria-hidden="true" />
            {currentStep.id === "situation" ? (
              <>
                <span className="planner-step-eyebrow">First, the permission boundary</span>
                <h2 id={`planner-step-${stepIndex}`} ref={stepHeadingRef} tabIndex={-1}>Do you own or rent the home?</h2>
                <p>This helps the plan separate changes you control from work that may need permission.</p>
                <div className="planner-choice-grid planner-choice-grid-compact">
                  {customerProjectOptions.situations.map(([value, label]) => (
                    <label className={situation === value ? "selected" : ""} key={value}>
                      <input type="radio" name="planner-situation" checked={situation === value} onChange={() => setSituation(value)} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </>
            ) : null}

            {currentStep.id === "shared-property" ? (
              <>
                <span className="planner-step-eyebrow">Building approvals</span>
                <h2 id={`planner-step-${stepIndex}`} ref={stepHeadingRef} tabIndex={-1}>Does the home have strata, a body corporate, an owners corporation or shared common property?</h2>
                <p>This can apply to apartments, units, townhouses, villas, duplexes and other housing complexes. It helps flag roofs, external walls, gardens, services and equipment locations that may need approval.</p>
                <div className="planner-choice-grid planner-choice-grid-compact">
                  {[["yes", "Yes, or it is likely"], ["no", "No, not that I know of"], ["not_sure", "Not sure"]].map(([value, label]) => (
                    <label className={sharedPropertyAnswer === value ? "selected" : ""} key={value}>
                      <input type="radio" name="planner-shared-property" checked={sharedPropertyAnswer === value} onChange={() => setSharedPropertyAnswer(value)} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </>
            ) : null}

            {currentStep.id === "property" ? (
              <>
                <span className="planner-step-eyebrow">{currentStep.eyebrow}</span>
                <h2 id={`planner-step-${stepIndex}`} ref={stepHeadingRef} tabIndex={-1}>{currentStep.prompt}</h2>
                <p>{currentStep.help}</p>
                <div className="planner-choice-grid planner-choice-grid-compact">
                  {currentStep.options.map(([value, label]) => (
                    <label className={currentPropertyAnswer === value ? "selected" : ""} key={value}>
                      <input
                        type="radio"
                        name={`planner-property-${currentStep.propertyKey}`}
                        checked={currentPropertyAnswer === value}
                        onChange={() => setPropertyAnswer(currentStep.propertyKey, value)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </>
            ) : null}

            {currentStep.id === "goals" ? (
              <>
                <span className="planner-step-eyebrow">Your priorities</span>
                <h2 id={`planner-step-${stepIndex}`} ref={stepHeadingRef} tabIndex={-1}>What would make the biggest difference?</h2>
                <p>Choose one or more. We will combine them into one ordered plan.</p>
                <div className="planner-choice-grid">
                  {customerProjectOptions.goals.map(([value, label]) => (
                    <label className={goals.includes(value) ? "selected" : ""} key={value}>
                      <input type="checkbox" checked={goals.includes(value)} onChange={() => toggleGoal(value)} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </>
            ) : null}

            {currentStep.id === "features" ? (
              <>
                <span className="planner-step-eyebrow">Home detail</span>
                <h2 id={`planner-step-${stepIndex}`} ref={stepHeadingRef} tabIndex={-1}>{currentStep.label}</h2>
                <p>Choose the closest answer. Select Not sure whenever you do not safely know.</p>
                <HomeFeatureIntake
                  idPrefix="public-home-feature"
                  sectionId={currentStep.featureSection}
                  questionId={currentStep.featureQuestion}
                  selected={features}
                  onChange={setFeatures}
                />
              </>
            ) : null}

            {currentStep.id === "budget" ? (
              <>
                <span className="planner-step-eyebrow">Optional planning comfort</span>
                <h2 id={`planner-step-${stepIndex}`} ref={stepHeadingRef} tabIndex={-1}>What investment range feels comfortable for the first stage?</h2>
                <p>This only helps stage the plan. It is not a quote, price promise or commitment, and you can skip it.</p>
                <div className="planner-choice-grid planner-choice-grid-compact">
                  {customerProjectOptions.budgets.map(([value, label]) => (
                    <label className={budgetRange === value ? "selected" : ""} key={value}>
                      <input type="radio" name="planner-budget" checked={budgetRange === value} onChange={() => setBudgetRange(value)} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </>
            ) : null}

            {currentStep.id === "pace" ? (
              <>
                <span className="planner-step-eyebrow">How you want to proceed</span>
                <h2 id={`planner-step-${stepIndex}`} ref={stepHeadingRef} tabIndex={-1}>How should the work be staged?</h2>
                <div className="planner-choice-grid planner-choice-grid-compact">
                  {customerProjectOptions.paces.map(([value, label]) => (
                    <label className={pace === value ? "selected" : ""} key={value}>
                      <input type="radio" name="planner-pace" checked={pace === value} onChange={() => setPace(value)} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </>
            ) : null}

            {currentStep.id === "location" ? (
              <>
                <span className="planner-step-eyebrow">Last question</span>
                <h2 id={`planner-step-${stepIndex}`} ref={stepHeadingRef} tabIndex={-1}>Which state or territory is the home in?</h2>
                <p>Optional. This makes the guidance more relevant without asking for your address or postcode.</p>
                <select aria-label="State or territory" value={addressState} onChange={(event) => setAddressState(event.target.value)}>
                  <option value="">Skip location for now</option>
                  {customerProjectOptions.states.map((state) => <option value={state} key={state}>{state}</option>)}
                </select>
              </>
            ) : null}

            <footer className="planner-step-actions">
              {stepIndex > 0 ? <button type="button" className="planner-back" onClick={() => goToStep(stepIndex - 1)}>Back</button> : <span />}
              <div className="planner-step-forward-actions">
                <button type="button" className="planner-continue" disabled={!canContinue} onClick={() => goToStep(stepIndex + 1)}>{continueLabel}</button>
              </div>
            </footer>
            {!canContinue ? (
              <p className="planner-step-prompt" role="status">
                {currentStep.id === "situation"
                  ? "Choose whether you own or rent to continue."
                  : "Choose the closest answer, including Not sure, to continue."}
              </p>
            ) : null}
          </section>
        </form>
      ) : (
        <section className="planner-results" aria-labelledby="planner-results-title">
          <div className="planner-results-heading">
            <span>Your ordered roadmap</span>
            <h2 id="planner-results-title" ref={stepHeadingRef} tabIndex={-1}>{plan.title}</h2>
            <p>{plan.summary}</p>
            <p className="planner-results-status" role="status" aria-live="polite" aria-atomic="true">
              {plan.items.length} ordered steps prepared from your answers.
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
              suggestedInterests={enquiryInterests}
              planSnapshot={{
                goals,
                pace,
                situation,
                approvalContext,
                budgetRange,
                addressState,
                features,
                propertyContext: enquiryPropertyContext,
              }}
            />
          </section>
          <div className="planner-result-actions">
            <a className="planner-primary-result" href={printablePlanHref}>Open my printable plan</a>
            <button type="button" className="planner-reset" onClick={() => goToStep(0)}>Edit my answers</button>
            <button type="button" className="planner-reset" onClick={resetPlan}>Start over</button>
          </div>

          {plan.everydayActions.length > 0 ? (
            <section className="planner-quick-wins" aria-labelledby="planner-quick-wins-title">
              <div className="planner-quick-wins-heading">
                <span>Do these first</span>
                <h3 id="planner-quick-wins-title">Quick wins for your home</h3>
                <p>{plan.everydayActionsBoundary}</p>
                <p>
                  <a href="https://www.energy.gov.au/households/quick-wins">Read the Australian Government quick-wins guidance</a>
                </p>
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
              <p>Start by checking whether your current energy plan still suits the way this household uses energy. Then estimate upgrade rebates or review available assistance.</p>
            </div>
            <div className="planner-quick-wins-grid">
              <article>
                <small>Recommended next</small>
                <h4>Compare electricity plans</h4>
                <p>Follow a guided comparison using your bill or interval data when available.</p>
                <a href="/compare?from=home-plan">Start electricity comparison</a>
              </article>
              <article>
                <small>If the home uses gas</small>
                <h4>Compare gas plans</h4>
                <p>Check gas offers separately so electricity and gas pricing are not mixed together.</p>
                <a href="/gas-compare?from=home-plan">Start gas comparison</a>
              </article>
              <article>
                <small>Estimate an upgrade</small>
                <h4>Use the rebate calculator</h4>
                <p>Choose an activity and approved product to estimate relevant certificates or rebates.</p>
                <a href="/calculator">Open rebate calculator</a>
              </article>
              <article>
                <small>Understand assistance</small>
                <h4>Review rebates and support</h4>
                <p>See current rebate pathways and the checks to make before accepting a quote.</p>
                <a href="/rebates">View rebates and assistance</a>
              </article>
            </div>
          </section>
        </section>
      )}
    </section>
  );
}
