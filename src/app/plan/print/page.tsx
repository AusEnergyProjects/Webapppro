import type { Metadata } from "next";
import {
  CustomerPlanReportPreview,
} from "@/components/CustomerPlanReportPreview";
import {
  DownloadCustomerPlanPdfButton,
} from "@/components/DownloadCustomerPlanPdfButton";
import {
  createPublicPlanCustomerReportView,
} from "@/lib/customer-plan-document.mjs";
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
    ageBand?: string;
    roofType?: string;
    roofColour?: string;
    roofForm?: string;
    roofCondition?: string;
    switchboard?: string;
    wallConstruction?: string;
    floorConstruction?: string;
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
  const suppliedPostcode = value(params.postcode).replace(/\D/g, "").slice(0, 4);
  const suppliedState = value(params.addressState).toUpperCase();
  const suppliedPropertyContext = buildInstallerPropertyContext({
    propertyType: value(params.propertyType),
    storeys: value(params.storeys),
    floorArea: value(params.floorArea),
    occupants: value(params.occupants),
    sharedWalls: value(params.sharedWalls),
    ageBand: value(params.ageBand),
    roofType: value(params.roofType),
    roofColour: value(params.roofColour),
    roofForm: value(params.roofForm),
    roofCondition: value(params.roofCondition),
    switchboard: value(params.switchboard),
    wallConstruction: value(params.wallConstruction),
    floorConstruction: value(params.floorConstruction),
  });
  const plan = createCustomerProjectPlan({
    goals: suppliedGoals.length ? suppliedGoals : ["lower-bills"],
    pace: value(params.pace),
    situation: value(params.situation),
    approvalContext: value(params.approvalContext) || "not_sure",
    budgetRange: suppliedBudget,
    postcode: suppliedPostcode,
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
  if (/^\d{4}$/.test(suppliedPostcode)) returnParams.set("postcode", suppliedPostcode);
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
  if (plan.propertyContext.ageBand) {
    returnParams.set("ageBand", plan.propertyContext.ageBand);
  }
  if (plan.propertyContext.roofType) {
    returnParams.set("roofType", plan.propertyContext.roofType);
  }
  if (plan.propertyContext.roofColour) {
    returnParams.set("roofColour", plan.propertyContext.roofColour);
  }
  if (plan.propertyContext.roofForm) {
    returnParams.set("roofForm", plan.propertyContext.roofForm);
  }
  if (plan.propertyContext.roofCondition) {
    returnParams.set("roofCondition", plan.propertyContext.roofCondition);
  }
  if (plan.propertyContext.switchboard) {
    returnParams.set("switchboard", plan.propertyContext.switchboard);
  }
  if (plan.propertyContext.wallConstruction) {
    returnParams.set("wallConstruction", plan.propertyContext.wallConstruction);
  }
  if (plan.propertyContext.floorConstruction) {
    returnParams.set("floorConstruction", plan.propertyContext.floorConstruction);
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
    optionLabel(customerProjectOptions.ageBands, plan.propertyContext.ageBand || ""),
    optionLabel(customerProjectOptions.roofTypes, plan.propertyContext.roofType || ""),
    optionLabel(customerProjectOptions.roofColours, plan.propertyContext.roofColour || ""),
    optionLabel(customerProjectOptions.roofForms, plan.propertyContext.roofForm || ""),
    optionLabel(customerProjectOptions.roofConditions, plan.propertyContext.roofCondition || ""),
    optionLabel(customerProjectOptions.switchboards, plan.propertyContext.switchboard || ""),
    optionLabel(customerProjectOptions.wallConstructions, plan.propertyContext.wallConstruction || ""),
    optionLabel(customerProjectOptions.floorConstructions, plan.propertyContext.floorConstruction || ""),
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
  const report = createPublicPlanCustomerReportView({
    postcode: suppliedPostcode,
    snapshot: {
      goals: plan.goals,
      pace: plan.pace,
      situation: plan.situation,
      approvalContext: plan.approvalContext,
      budgetRange,
      addressState,
      features: plan.features,
      propertyContext: plan.propertyContext,
    },
    preparedAt: new Date().toISOString(),
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
