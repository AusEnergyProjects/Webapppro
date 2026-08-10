import type { Metadata } from "next";
import {
  CustomerPlanReportPreview,
} from "@/components/CustomerPlanReportPreview";
import {
  DownloadCustomerPlanPdfButton,
} from "@/components/DownloadCustomerPlanPdfButton";
import { createCustomerPlanReportView } from "@/lib/customer-plan-document.mjs";
import {
  buildInstallerPropertyContext,
  createCustomerProjectPlan,
  customerProjectOptions,
  MAX_HOME_FEATURE_SELECTIONS,
} from "@/lib/customer-projects.mjs";

export const metadata: Metadata = {
  title: "Download Home Energy Roadmap | Australian Energy Assessments",
  description: "Preview and download a private, well-formatted home energy roadmap.",
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
  propertyContext: {
    propertyType?: string;
    storeys: string;
    floorArea: string;
    occupants?: string;
    sharedWalls?: string;
  };
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
  const suppliedPropertyContext = buildInstallerPropertyContext({
    propertyType: value(params.propertyType),
    storeys: value(params.storeys),
    floorArea: value(params.floorArea),
    occupants: value(params.occupants),
    sharedWalls: value(params.sharedWalls),
  });
  const plan = createCustomerProjectPlan({
    goals: suppliedGoals.length ? suppliedGoals : ["lower-bills"],
    pace: value(params.pace),
    situation: value(params.situation),
    approvalContext: value(params.approvalContext) || "not_sure",
    budgetRange: suppliedBudget,
    addressState: suppliedState,
    features: values(params.feature, MAX_HOME_FEATURE_SELECTIONS),
    propertyContext: suppliedPropertyContext,
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
  if (plan.propertyContext.propertyType) {
    returnParams.set("propertyType", plan.propertyContext.propertyType);
  }
  if (plan.propertyContext.storeys) {
    returnParams.set("storeys", plan.propertyContext.storeys);
  }
  if (plan.propertyContext.floorArea) {
    returnParams.set("floorArea", plan.propertyContext.floorArea);
  }
  if (plan.propertyContext.occupants) {
    returnParams.set("occupants", plan.propertyContext.occupants);
  }
  if (plan.propertyContext.sharedWalls) {
    returnParams.set("sharedWalls", plan.propertyContext.sharedWalls);
  }

  const propertyType = optionLabel(
    customerProjectOptions.propertyTypes,
    plan.propertyContext.propertyType || "",
  );
  const homeDetails = [
    optionLabel(customerProjectOptions.storeys, plan.propertyContext.storeys),
    optionLabel(customerProjectOptions.floorAreas, plan.propertyContext.floorArea),
    optionLabel(customerProjectOptions.occupants, plan.propertyContext.occupants || ""),
    optionLabel(customerProjectOptions.sharedWalls, plan.propertyContext.sharedWalls || ""),
  ].filter(Boolean);

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
    propertyType,
    ...homeDetails,
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
      propertyType: propertyType || "Home",
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
      homeDetails,
    },
    evidence: null,
    existingFeatures: plan.features,
    climate: null,
    questions: plan.nextQuestions,
    everydayActions: plan.everydayActions.map((action) => ({
      ...action,
      description: action.text,
    })),
    everydayActionsBoundary: plan.everydayActionsBoundary,
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
      <nav className="planner-print-actions" aria-label="Plan download actions">
        <DownloadCustomerPlanPdfButton report={report} />
        <a href={`/plan?${returnParams.toString()}`}>Return to planner</a>
        <span>{context.join(" | ")}</span>
      </nav>
      <CustomerPlanReportPreview report={report} />
    </main>
  );
}
