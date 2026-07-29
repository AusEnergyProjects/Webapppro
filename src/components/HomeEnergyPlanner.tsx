"use client";

import { useMemo, useState } from "react";
import {
  createCustomerProjectPlan,
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

const customerProjectOptions = rawCustomerProjectOptions as unknown as {
  goals: Option[];
  paces: Option[];
  situations: Option[];
  approvalContexts: Option[];
  budgets: Option[];
  states: string[];
};

function appendValues(
  params: URLSearchParams,
  name: string,
  values: string[],
) {
  values.forEach((value) => params.append(name, value));
}

export function HomeEnergyPlanner({
  initialSelection,
}: {
  initialSelection: InitialPlannerSelection;
}) {
  const [goals, setGoals] = useState(initialSelection.goals);
  const [pace, setPace] = useState(initialSelection.pace);
  const [situation, setSituation] = useState(initialSelection.situation);
  const [approvalContext, setApprovalContext] = useState(
    initialSelection.approvalContext,
  );
  const [budgetRange, setBudgetRange] = useState(initialSelection.budgetRange);
  const [addressState, setAddressState] = useState(
    initialSelection.addressState,
  );
  const [features, setFeatures] = useState(initialSelection.features);

  const plan = useMemo(
    () =>
      createCustomerProjectPlan({
        goals,
        pace,
        situation,
        approvalContext,
        budgetRange,
        addressState,
        features,
      }) as CustomerPlan,
    [
      goals,
      pace,
      situation,
      approvalContext,
      budgetRange,
      addressState,
      features,
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
    return params;
  }, [
    goals,
    pace,
    situation,
    approvalContext,
    budgetRange,
    addressState,
    features,
  ]);

  function toggleGoal(value: string) {
    setGoals((current) => {
      if (!current.includes(value)) return [...current, value];
      return current.length > 1
        ? current.filter((item) => item !== value)
        : current;
    });
  }

  function resetPlan() {
    setGoals(["lower-bills"]);
    setPace("staged");
    setSituation("");
    setApprovalContext("not_sure");
    setBudgetRange("not_set");
    setAddressState("");
    setFeatures([]);
  }

  return (
    <section className="planner-layout" aria-label="Home energy planning tool">
      <form
        className="planner-controls"
        onSubmit={(event) => event.preventDefault()}
      >
        <fieldset>
          <legend>
            <span>1</span>Do you own or rent the home?
          </legend>
          <p>This changes which fixed and portable options should come first.</p>
          <div className="planner-choice-grid planner-choice-grid-compact">
            {customerProjectOptions.situations.map(([value, label]) => (
              <label
                className={situation === value ? "selected" : ""}
                key={value}
              >
                <input
                  type="radio"
                  name="planner-situation"
                  checked={situation === value}
                  onChange={() => setSituation(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>
            <span>2</span>What matters most to your household?
          </legend>
          <p>Choose one or more goals. The plan combines them into one sequence.</p>
          <div className="planner-choice-grid">
            {customerProjectOptions.goals.map(([value, label]) => (
              <label
                className={goals.includes(value) ? "selected" : ""}
                key={value}
              >
                <input
                  type="checkbox"
                  checked={goals.includes(value)}
                  onChange={() => toggleGoal(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>
            <span>3</span>Could shared-property approval apply?
          </legend>
          <p>
            Keep ownership separate from strata, owners corporation and common
            property questions.
          </p>
          <div className="planner-choice-grid">
            {customerProjectOptions.approvalContexts.map(([value, label]) => (
              <label
                className={approvalContext === value ? "selected" : ""}
                key={value}
              >
                <input
                  type="radio"
                  name="planner-approval"
                  checked={approvalContext === value}
                  onChange={() => setApprovalContext(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>
            <span>4</span>What does your home have today?
          </legend>
          <p>
            Work through the categories and choose what you safely know. Not
            sure is a useful answer, and leaving a question blank is fine.
          </p>
          <HomeFeatureIntake
            idPrefix="public-home-feature"
            selected={features}
            onChange={setFeatures}
          />
        </fieldset>

        <fieldset>
          <legend>
            <span>5</span>What budget boundary should guide the first stage?
          </legend>
          <p>
            This is a planning ceiling, not a price estimate. Current
            site-specific quotes remain necessary.
          </p>
          <div className="planner-choice-grid planner-choice-grid-compact">
            {customerProjectOptions.budgets.map(([value, label]) => (
              <label
                className={budgetRange === value ? "selected" : ""}
                key={value}
              >
                <input
                  type="radio"
                  name="planner-budget"
                  checked={budgetRange === value}
                  onChange={() => setBudgetRange(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>
            <span>6</span>How should the work be staged?
          </legend>
          <div className="planner-choice-grid planner-choice-grid-compact">
            {customerProjectOptions.paces.map(([value, label]) => (
              <label
                className={pace === value ? "selected" : ""}
                key={value}
              >
                <input
                  type="radio"
                  name="planner-pace"
                  checked={pace === value}
                  onChange={() => setPace(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>
            <span>7</span>Which state or territory is the home in?
          </legend>
          <p>
            Optional. This carries into your private project. The quick plan
            stays general until you add a matching postcode after sign-in.
          </p>
          <select
            aria-label="State or territory"
            value={addressState}
            onChange={(event) => setAddressState(event.target.value)}
          >
            <option value="">Choose a state or territory</option>
            {customerProjectOptions.states.map((state) => (
              <option value={state} key={state}>
                {state}
              </option>
            ))}
          </select>
        </fieldset>
      </form>

      <section
        className="planner-results"
        aria-labelledby="planner-results-title"
      >
        <div className="planner-results-heading">
          <span>Your ordered roadmap</span>
          <h2 id="planner-results-title">{plan.title}</h2>
          <p>{plan.summary}</p>
          {!situation ? (
            <p>
              Choose whether you own or rent so the plan can put permission and
              portable options in the right place.
            </p>
          ) : null}
          <p
            className="planner-results-status"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {plan.items.length} ordered steps prepared from the current
            selections.
          </p>
        </div>
        <div className="planner-result-actions">
          <a
            className="planner-save-account"
            href={`/account/projects/new?${selectionParams.toString()}`}
          >
            Continue in my free account
          </a>
          <a href={`/plan/print?${selectionParams.toString()}`}>
            Open print view
          </a>
          <button type="button" className="planner-reset" onClick={resetPlan}>
            Start over
          </button>
        </div>
        {plan.everydayActions.length > 0 && (
          <section
            className="planner-everyday-actions"
            aria-labelledby="planner-everyday-actions-title"
          >
            <span>Useful alongside the roadmap</span>
            <h3 id="planner-everyday-actions-title">
              Helpful things you can try now
            </h3>
            <p>{plan.everydayActionsBoundary}</p>
            <div>
              {plan.everydayActions.map((action) => (
                <article key={action.id}>
                  <small>{action.category}</small>
                  <h4>{action.title}</h4>
                  <p>{action.text}</p>
                </article>
              ))}
            </div>
          </section>
        )}
        {plan.nextQuestions.length > 0 && (
          <section className="planner-next-questions">
            <span>Best next information</span>
            <h3>Questions that could change the order</h3>
            <p>
              Not sure is a valid answer. Use the more detailed private
              workspace when you want to record evidence against a home fact.
            </p>
            <ol>
              {plan.nextQuestions.map((question) => (
                <li key={question.id}>
                  <strong>{question.prompt}</strong>
                  <p>{question.whyItMatters}</p>
                  <small>Not sure is allowed</small>
                </li>
              ))}
            </ol>
          </section>
        )}
        <ol>
          {plan.items.map((item, index) => (
            <li key={item.id}>
              <span className="planner-order">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <small>{item.stage}</small>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                {item.href ? <a href={item.href}>{item.action}</a> : null}
                {item.guidance && (
                  <details className="planner-item-rationale">
                    <summary>Why this is in the plan</summary>
                    <div>
                      {[
                        ["Based on", item.guidance.basedOn],
                        ["Still uncertain", item.guidance.stillUncertain],
                        ["Could change if", item.guidance.reconsiderIf],
                      ].map(([heading, reasons]) => (
                        <section key={heading as string}>
                          <strong>{heading as string}</strong>
                          <ul>
                            {(reasons as string[]).map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                        </section>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </li>
          ))}
        </ol>
        <div className="planner-boundary">
          <strong>Make the plan more specific in your private account</strong>
          <p>
            Add controlled home evidence, room comfort details, a matching
            postcode and permission questions without putting those details in
            this shareable link.
          </p>
        </div>
        <div className="planner-boundary">
          <strong>Before committing</strong>
          <p>
            Replace indicative assumptions with current written quotes, confirm
            official incentives and approvals, and use licensed professionals
            for regulated work.
          </p>
        </div>
      </section>
    </section>
  );
}
