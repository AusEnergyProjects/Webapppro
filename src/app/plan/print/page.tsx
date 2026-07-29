import type { Metadata } from "next";
import { CustomerPlanPrintReport } from "@/components/CustomerPlanShareDialog";
import { PrintRoadmapButton } from "@/components/PrintRoadmapButton";
import { createCustomerPlanReportView } from "@/lib/customer-plan-document.mjs";
import {
  createCustomerProjectPlan,
  customerProjectOptions,
  MAX_HOME_FEATURE_SELECTIONS,
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
    features: values(params.feature, MAX_HOME_FEATURE_SELECTIONS),
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
  const report = createCustomerPlanReportView({
    heading: "Your independent home energy plan",
    planTitle: plan.title,
    summary: plan.summary,
    preparedDate: new Date().toISOString().slice(0, 10),
    overview: {
      goals: plan.goals
        .map((item) => optionLabel(customerProjectOptions.goals, item))
        .filter(Boolean),
      propertyType: "Home",
      tenure: optionLabel(customerProjectOptions.situations, plan.situation)
        || "Not recorded",
      approval: optionLabel(
        customerProjectOptions.approvalContexts,
        plan.approvalContext,
      ) || "Not recorded",
      pace: optionLabel(customerProjectOptions.paces, plan.pace)
        || "Not recorded",
      budget: optionLabel(customerProjectOptions.budgets, budgetRange)
        || "Not recorded",
      state: addressState || "Not recorded",
    },
    evidence: null,
    existingFeatures: plan.features,
    climate: null,
    questions: plan.nextQuestions,
    actions: plan.items.map((item, index) => ({
      number: index + 1,
      id: item.id,
      stage: item.stage,
      title: item.title,
      description: item.text,
      completed: false,
      guideLabel: item.action,
      guideHref: item.href,
      guidance: item.guidance,
    })),
    privacyNote: "This public copy includes only the planning choices shown in this roadmap. It does not contain account, address, meter or private project records.",
    adviceBoundary: "This plan is independent general guidance. It is not a quote, product endorsement, home energy rating, equipment sizing result or savings promise. Confirm safety, permissions, suitability and current incentives before committing to work.",
  });

  return (
    <main className="planner-print-page">
      <nav className="planner-print-actions" aria-label="Printable plan actions">
        <PrintRoadmapButton />
        <a href={`/plan?${returnParams.toString()}`}>Return to planner</a>
        <span>{context.join(" | ")}</span>
      </nav>
      <CustomerPlanPrintReport report={report} visible />
    </main>
  );
}
