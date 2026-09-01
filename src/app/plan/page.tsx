import { HomeEnergyPlanner } from "@/components/HomeEnergyPlanner";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { buildPlatformMetadata } from "@/lib/public-site";
import {
  MAX_HOME_FEATURE_SELECTIONS,
  createCustomerProjectPlan,
  customerProjectOptions,
} from "@/lib/customer-projects.mjs";

export const metadata = buildPlatformMetadata({
  path: "/plan",
  title: "Build My Home Energy Plan | Australian Energy Assessments",
  description:
    "Create a private, ordered roadmap for home comfort, electrification, solar, storage, energy plans, assessments and project-ready next steps.",
});

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
  const suppliedFeatures = values(
    params.feature,
    MAX_HOME_FEATURE_SELECTIONS,
  );
  const suppliedBudget = value(params.budgetRange);
  const suppliedPostcode = value(params.postcode).replace(/\D/g, "").slice(0, 4);
  const suppliedState = value(params.addressState).toUpperCase();
  const validGoals = new Set(
    customerProjectOptions.goals.map(([optionValue]) => optionValue),
  );
  const initialGoals = suppliedGoals.filter((goal) => validGoals.has(goal));
  const plan = createCustomerProjectPlan({
    goals: initialGoals.length ? initialGoals : ["lower-bills"],
    pace: value(params.pace),
    situation: value(params.situation),
    approvalContext: value(params.approvalContext),
    budgetRange: suppliedBudget,
    postcode: suppliedPostcode,
    addressState: suppliedState,
    features: suppliedFeatures,
    propertyContext: {
      propertyType: value(params.propertyType),
      storeys: value(params.storeys),
      ageBand: value(params.ageBand),
      floorArea: value(params.floorArea),
      occupants: value(params.occupants),
      sharedWalls: value(params.sharedWalls),
      roofType: value(params.roofType),
      roofColour: value(params.roofColour),
      roofForm: value(params.roofForm),
      roofCondition: value(params.roofCondition),
      switchboard: value(params.switchboard),
      wallConstruction: value(params.wallConstruction),
      floorConstruction: value(params.floorConstruction),
    },
  });
  const validBudgets = new Set(
    customerProjectOptions.budgets.map(([optionValue]) => optionValue),
  );

  return (
    <main className="wrap planner-page">
      <SiteHeader active="plan" />
      <header className="planner-hero">
        <div>
          <span>Private home energy planning</span>
          <h1>One clear step at a time. Your plan starts here.</h1>
          <p>
            No account, address, bill, meter identifier or contact details are
            needed. Four grouped steps use a postcode for local context, include
            Not sure for technical questions, and can save progress in this browser tab.
          </p>
        </div>
      </header>
      <HomeEnergyPlanner
        initialSelection={{
          goals: initialGoals,
          pace: plan.pace,
          situation: value(params.situation) ? plan.situation : "",
          approvalContext: value(params.approvalContext)
            ? plan.approvalContext
            : "",
          budgetRange: validBudgets.has(suppliedBudget)
            ? suppliedBudget
            : "not_set",
          postcode: suppliedPostcode,
          addressState: customerProjectOptions.states.includes(suppliedState)
            ? suppliedState
            : "",
          features: suppliedFeatures.length ? plan.features : [],
          propertyType: value(params.propertyType)
            ? plan.propertyContext.propertyType || ""
            : "",
          storeys: value(params.storeys) ? plan.propertyContext.storeys || "" : "",
          ageBand: value(params.ageBand) ? plan.propertyContext.ageBand || "" : "",
          floorArea: value(params.floorArea) ? plan.propertyContext.floorArea || "" : "",
          occupants: value(params.occupants) ? plan.propertyContext.occupants || "" : "",
          sharedWalls: value(params.sharedWalls) ? plan.propertyContext.sharedWalls || "" : "",
          roofType: value(params.roofType) ? plan.propertyContext.roofType || "" : "",
          roofColour: value(params.roofColour) ? plan.propertyContext.roofColour || "" : "",
          roofForm: value(params.roofForm) ? plan.propertyContext.roofForm || "" : "",
          roofCondition: value(params.roofCondition) ? plan.propertyContext.roofCondition || "" : "",
          switchboard: value(params.switchboard) ? plan.propertyContext.switchboard || "" : "",
          wallConstruction: value(params.wallConstruction)
            ? plan.propertyContext.wallConstruction || ""
            : "",
          floorConstruction: value(params.floorConstruction)
            ? plan.propertyContext.floorConstruction || ""
            : "",
          timing: "not-sure",
          occupancyPattern: "not-sure",
          energyUsePattern: "not-sure",
          billPressure: "not-sure",
          gasConnection: "not-sure",
          disruption: "not-sure",
          plannedWorks: "not-sure",
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
