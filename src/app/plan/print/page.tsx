import type { Metadata } from "next";
import { PrintRoadmapButton } from "@/components/PrintRoadmapButton";
import {
  createCustomerProjectPlan,
  customerProjectOptions,
} from "@/lib/customer-projects.mjs";

export const metadata: Metadata = {
  title: "Printable Home Energy Roadmap | Australian Energy Assessments",
  description: "A lightweight printable copy of your private home energy roadmap.",
  robots: { index: false, follow: false },
};

type PrintSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;
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
  goals: string[];
  pace: string;
  situation: string;
  approvalContext: string;
  features: string[];
  title: string;
  summary: string;
  items: CustomerPlanItem[];
  nextQuestions: Array<{
    id: string;
    prompt: string;
    whyItMatters: string;
  }>;
};

function values(
  value: string | string[] | undefined,
  maximum: number,
): string[] {
  const supplied = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
  return supplied
    .map((item) => item.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, maximum);
}

function value(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

function optionLabel(options: string[][], selected: string): string {
  return options.find(([optionValue]) => optionValue === selected)?.[1] || "";
}

export default async function PrintableHomeEnergyPlanPage({
  searchParams,
}: {
  searchParams: PrintSearchParams;
}) {
  const params = await searchParams;
  const suppliedGoals = values(params.goal, 10);
  const suppliedBudget = value(params.budgetRange);
  const suppliedState = value(params.addressState).toUpperCase();
  const plan = createCustomerProjectPlan({
    goals: suppliedGoals.length ? suppliedGoals : ["lower-bills"],
    pace: value(params.pace),
    situation: value(params.situation),
    approvalContext: value(params.approvalContext) || "not_sure",
    budgetRange: suppliedBudget,
    addressState: suppliedState,
    features: values(params.feature, 24),
  }) as CustomerPlan;
  const budgetRange = optionLabel(
    customerProjectOptions.budgets,
    suppliedBudget,
  )
    ? suppliedBudget
    : "not_set";
  const addressState = customerProjectOptions.states.includes(suppliedState)
    ? suppliedState
    : "";
  const returnParams = new URLSearchParams({
    pace: plan.pace,
    situation: plan.situation,
    approvalContext: plan.approvalContext,
    budgetRange,
  });
  plan.goals.forEach((item) => returnParams.append("goal", item));
  plan.features.forEach((item) => returnParams.append("feature", item));
  if (addressState) returnParams.set("addressState", addressState);

  const context = [
    plan.goals
      .map((item) => optionLabel(customerProjectOptions.goals, item))
      .filter(Boolean)
      .join(", "),
    optionLabel(customerProjectOptions.situations, plan.situation),
    optionLabel(
      customerProjectOptions.approvalContexts,
      plan.approvalContext,
    ),
    optionLabel(customerProjectOptions.budgets, budgetRange),
    optionLabel(customerProjectOptions.paces, plan.pace),
    addressState,
  ].filter(Boolean);

  return (
    <main className="planner-print-page">
      <header>
        <span>Australian Energy Assessments</span>
        <strong>Independent quick home energy roadmap</strong>
        <h1>{plan.title}</h1>
        <p>{plan.summary}</p>
        <div className="planner-print-actions">
          <PrintRoadmapButton />
          <a href={`/plan?${returnParams.toString()}`}>Return to planner</a>
        </div>
      </header>
      <aside>
        <strong>Plan settings</strong>
        <p>{context.join(" | ")}</p>
      </aside>
      {plan.nextQuestions.length > 0 && (
        <section className="planner-print-questions">
          <span>Best next information</span>
          <h2>Questions that could change the order</h2>
          <p>Not sure remains a valid answer.</p>
          <div>
            {plan.nextQuestions.map((question, index) => (
              <article key={question.id}>
                <strong>{index + 1}. {question.prompt}</strong>
                <p>{question.whyItMatters}</p>
              </article>
            ))}
          </div>
        </section>
      )}
      <ol>
        {plan.items.map((item, index) => (
          <li key={item.id}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <small>{item.stage}</small>
              <h2>{item.title}</h2>
              <p>{item.text}</p>
              {item.href ? <a href={item.href}>{item.action}</a> : null}
              {item.guidance && (
                <dl className="planner-print-guidance">
                  <div>
                    <dt>Based on</dt>
                    <dd>{item.guidance.basedOn.join(" ")}</dd>
                  </div>
                  <div>
                    <dt>Still uncertain</dt>
                    <dd>{item.guidance.stillUncertain.join(" ")}</dd>
                  </div>
                  <div>
                    <dt>Could change if</dt>
                    <dd>{item.guidance.reconsiderIf.join(" ")}</dd>
                  </div>
                </dl>
              )}
            </div>
          </li>
        ))}
      </ol>
      <aside>
        <strong>Before committing</strong>
        <p>
          Replace indicative assumptions with current written quotes, confirm
          official incentives and approvals, and use licensed professionals for
          regulated work.
        </p>
      </aside>
      <footer>
        This roadmap is general guidance, not a site assessment, quote,
        eligibility decision or guarantee of savings. Add controlled evidence,
        room comfort details, a matching postcode and permission questions in
        your private account when you need more specific sequencing.
      </footer>
    </main>
  );
}
