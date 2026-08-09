"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createCustomerProjectPlan,
  customerHomeFeatureSections as rawCustomerHomeFeatureSections,
  customerProjectOptions as rawCustomerProjectOptions,
} from "@/lib/customer-projects.mjs";
import { HomeFeatureIntake } from "@/components/HomeFeatureIntake";

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
type PlannerStep =
  | { id: "situation" | "goals" | "apartment" | "budget" | "pace" | "location"; label: string }
  | { id: "features"; label: string; featureSection: string; featureQuestion: string }
  | { id: "result"; label: string };

const customerProjectOptions = rawCustomerProjectOptions as unknown as {
  goals: Option[];
  paces: Option[];
  situations: Option[];
  budgets: Option[];
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

const plannerStepsBeforeFeatures: PlannerStep[] = [
  { id: "situation", label: "Your home" },
  { id: "apartment", label: "Apartment" },
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
const firstPostFeatureStepIndex =
  plannerStepsBeforeFeatures.length + plannerFeatureSteps.length;

function appendValues(params: URLSearchParams, name: string, values: string[]) {
  values.forEach((value) => params.append(name, value));
}

function PlannerTradeEnquiry({ href }: { href: string }) {
  return (
    <section className="planner-boundary planner-trade-enquiry" aria-labelledby="planner-trade-enquiry-title">
      <span className="planner-trade-enquiry-eyebrow">Optional next step</span>
      <h3 id="planner-trade-enquiry-title">Want help turning the plan into quotes?</h3>
      <p>
        Enquire with verified trades only when you are ready. Creating a free private
        account saves this plan and carries every current answer across.
      </p>
      <p className="planner-trade-enquiry-privacy">
        This is not required to view your plan. Your name, phone number
        and exact address stay hidden during matching. Contact details are released
        only to the one business you choose.
      </p>
      <a className="planner-optional-link" href={href}>Save or enquire with verified trades</a>
    </section>
  );
}

function initialPlannerStep(selection: InitialPlannerSelection) {
  const isDefault = selection.goals.length === 1
    && selection.goals[0] === "lower-bills"
    && selection.pace === "staged"
    && !selection.situation
    && selection.approvalContext === "not_sure"
    && selection.budgetRange === "not_set"
    && !selection.addressState
    && selection.features.length === 0;
  return isDefault ? 0 : plannerSteps.length - 1;
}

export function HomeEnergyPlanner({ initialSelection }: { initialSelection: InitialPlannerSelection }) {
  const [goals, setGoals] = useState(initialSelection.goals);
  const [pace, setPace] = useState(initialSelection.pace);
  const [situation, setSituation] = useState(initialSelection.situation);
  const [approvalContext, setApprovalContext] = useState(initialSelection.approvalContext);
  const [budgetRange, setBudgetRange] = useState(initialSelection.budgetRange);
  const [addressState, setAddressState] = useState(initialSelection.addressState);
  const [features, setFeatures] = useState(initialSelection.features);
  const [stepIndex, setStepIndex] = useState(() => initialPlannerStep(initialSelection));
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const hasChangedStep = useRef(false);
  const currentStep = plannerSteps[stepIndex];
  const questionCount = plannerSteps.length - 1;
  const isResult = currentStep.id === "result";
  const progressValue = isResult ? 100 : Math.round(((stepIndex + 1) / questionCount) * 100);
  const currentFeatureQuestion = currentStep.id === "features"
    ? customerHomeFeatureSections
        .find((section) => section.id === currentStep.featureSection)
        ?.questions.find((question) => question.id === currentStep.featureQuestion)
    : undefined;
  const hasCurrentFeatureAnswer = currentFeatureQuestion?.options.some(([value]) =>
    features.includes(value)) ?? false;

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
    }) as CustomerPlan,
    [goals, pace, situation, approvalContext, budgetRange, addressState, features],
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
    return params;
  }, [goals, pace, situation, approvalContext, budgetRange, addressState, features]);
  const tradeEnquiryHref = `/account/projects/new?${selectionParams.toString()}`;

  const apartmentAnswer = approvalContext === "strata"
    ? "yes"
    : approvalContext === "none"
      ? "no"
      : "not_sure";

  function setApartmentAnswer(value: string) {
    setApprovalContext(value === "yes" ? "strata" : value === "no" ? "none" : "not_sure");
  }

  function toggleGoal(value: string) {
    setGoals((current) => {
      if (!current.includes(value)) return [...current, value];
      return current.length > 1 ? current.filter((item) => item !== value) : current;
    });
  }

  function goToStep(nextIndex: number) {
    hasChangedStep.current = true;
    setStepIndex(Math.max(0, Math.min(plannerSteps.length - 1, nextIndex)));
  }

  function resetPlan() {
    setGoals(["lower-bills"]);
    setPace("staged");
    setSituation("");
    setApprovalContext("not_sure");
    setBudgetRange("not_set");
    setAddressState("");
    setFeatures([]);
    goToStep(0);
  }

  const canContinue = currentStep.id !== "situation" || Boolean(situation);
  const continueLabel = currentStep.id === "location"
    ? "Build my plan"
    : currentStep.id === "features" && !hasCurrentFeatureAnswer
      ? "Skip this question"
      : "Continue";

  return (
    <section className="planner-layout" aria-label="Home energy planning tool">
      <header className="planner-progress-shell">
        <div className="planner-progress-copy">
          <span>{isResult ? "Plan ready" : `Question ${stepIndex + 1} of ${questionCount}`}</span>
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

            {currentStep.id === "apartment" ? (
              <>
                <span className="planner-step-eyebrow">Building approvals</span>
                <h2 id={`planner-step-${stepIndex}`} ref={stepHeadingRef} tabIndex={-1}>Do you live in an apartment complex?</h2>
                <p>If yes, the plan will flag external units, common property and other changes that may need building manager, body corporate or owners corporation approval.</p>
                <div className="planner-choice-grid planner-choice-grid-compact">
                  {[["yes", "Yes"], ["no", "No"], ["not_sure", "Not sure"]].map(([value, label]) => (
                    <label className={apartmentAnswer === value ? "selected" : ""} key={value}>
                      <input type="radio" name="planner-apartment" checked={apartmentAnswer === value} onChange={() => setApartmentAnswer(value)} />
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
                <span className="planner-step-eyebrow">Optional home detail</span>
                <h2 id={`planner-step-${stepIndex}`} ref={stepHeadingRef} tabIndex={-1}>{currentStep.label}</h2>
                <p>Answer only if you know. You can skip this question or all remaining home details.</p>
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
                {currentStep.id === "features" && stepIndex < firstPostFeatureStepIndex - 1 ? (
                  <button type="button" className="planner-skip-details" onClick={() => goToStep(firstPostFeatureStepIndex)}>
                    Skip remaining home details
                  </button>
                ) : null}
                <button type="button" className="planner-continue" disabled={!canContinue} onClick={() => goToStep(stepIndex + 1)}>{continueLabel}</button>
              </div>
            </footer>
            {!canContinue ? <p className="planner-step-prompt" role="status">Choose whether you own or rent to continue.</p> : null}
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
          <div className="planner-result-actions">
            <a className="planner-primary-result" href={`/plan/print?${selectionParams.toString()}`}>Open my printable plan</a>
            <button type="button" className="planner-reset" onClick={() => goToStep(0)}>Edit my answers</button>
            <button type="button" className="planner-reset" onClick={resetPlan}>Start over</button>
          </div>

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

          {(plan.nextQuestions.length > 0 || plan.everydayActions.length > 0) ? (
            <details className="planner-more-detail">
              <summary>Optional ways to refine or use this plan</summary>
              {plan.nextQuestions.length > 0 ? (
                <section className="planner-next-questions">
                  <h3>Questions that could change the order</h3>
                  <ol>{plan.nextQuestions.map((question) => <li key={question.id}><strong>{question.prompt}</strong><p>{question.whyItMatters}</p><small>Not sure is allowed</small></li>)}</ol>
                </section>
              ) : null}
              {plan.everydayActions.length > 0 ? (
                <section className="planner-everyday-actions">
                  <h3>Helpful things you can try now</h3>
                  <p>{plan.everydayActionsBoundary}</p>
                  <div>{plan.everydayActions.map((action) => <article key={action.id}><small>{action.category}</small><h4>{action.title}</h4><p>{action.text}</p></article>)}</div>
                </section>
              ) : null}
            </details>
          ) : null}

          <div className="planner-boundary">
            <strong>Before committing</strong>
            <p>Replace indicative assumptions with current written quotes, confirm official incentives and approvals, and use licensed professionals for regulated work.</p>
          </div>
          <PlannerTradeEnquiry href={tradeEnquiryHref} />
        </section>
      )}
    </section>
  );
}
