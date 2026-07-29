import type { Metadata } from "next";
import { HomeEnergyPlanner } from "@/components/HomeEnergyPlanner";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import {
  createCustomerProjectPlan,
  customerProjectOptions,
} from "@/lib/customer-projects.mjs";

export const metadata: Metadata = {
  title: "Build My Home Energy Plan | Australian Energy Assessments",
  description:
    "Create a private, ordered roadmap for home comfort, electrification, solar, storage, energy plans, assessments and project-ready next steps.",
};

type PlanSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

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

export default async function HomeEnergyPlanPage({
  searchParams,
}: {
  searchParams: PlanSearchParams;
}) {
  const params = await searchParams;
  const suppliedGoals = values(params.goal, 10);
  const suppliedFeatures = values(params.feature, 24);
  const suppliedBudget = value(params.budgetRange);
  const suppliedState = value(params.addressState).toUpperCase();
  const plan = createCustomerProjectPlan({
    goals: suppliedGoals.length ? suppliedGoals : ["lower-bills"],
    pace: value(params.pace),
    situation: value(params.situation),
    approvalContext: value(params.approvalContext) || "not_sure",
    budgetRange: suppliedBudget,
    addressState: suppliedState,
    features: suppliedFeatures,
  });
  const validBudgets = new Set(
    customerProjectOptions.budgets.map(([optionValue]) => optionValue),
  );

  return (
    <main className="wrap planner-page">
      <SiteHeader active="plan" />
      <header className="planner-hero">
        <div>
          <span>Your home energy roadmap</span>
          <h1>Work out what to do first</h1>
          <p>
            Combine several household goals with ownership, approval, budget
            and existing-home information. The roadmap uses the same independent
            advisor engine as the private project workspace.
          </p>
        </div>
        <aside>
          <strong>Private by design</strong>
          <p>
            No account, address, bill, postcode, meter identifier or contact
            details are needed. These quick-plan choices are not sent anywhere.
          </p>
        </aside>
      </header>
      <HomeEnergyPlanner
        initialSelection={{
          goals: plan.goals.length ? plan.goals : ["lower-bills"],
          pace: plan.pace,
          situation: plan.situation,
          approvalContext: plan.approvalContext,
          budgetRange: validBudgets.has(suppliedBudget)
            ? suppliedBudget
            : "not_set",
          addressState: customerProjectOptions.states.includes(suppliedState)
            ? suppliedState
            : "",
          features: plan.features,
        }}
      />
      <SiteFooter>
        This roadmap is general guidance, not a site assessment, quote,
        eligibility decision or guarantee of savings. Confirm the property,
        products, approvals and complete installed scope before committing.
      </SiteFooter>
    </main>
  );
}
