import type { Metadata } from "next";
import { CustomerDashboard } from "@/components/CustomerDashboard";
import {
  MAX_HOME_FEATURE_SELECTIONS,
  customerProjectOptions,
  normalizeHomeFeatureSelections,
} from "@/lib/customer-projects.mjs";

export const metadata: Metadata = {
  title: "Create a Home Energy Project | Australian Energy Assessments",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

type NewProjectPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function NewCustomerProjectPage({ searchParams }: NewProjectPageProps) {
  const query = await searchParams;
  const values = (
    supplied: string | string[] | undefined,
    maximum: number,
  ) => {
    const entries = Array.isArray(supplied)
      ? supplied
      : typeof supplied === "string"
        ? [supplied]
        : [];
    return entries
      .flatMap((item) => item.split(","))
      .map((item) => item.trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, maximum);
  };
  const value = (supplied: string | string[] | undefined) =>
    typeof supplied === "string" ? supplied.trim().slice(0, 80) : undefined;
  const optionSet = (options: string[][]) =>
    new Set(options.map(([optionValue]) => optionValue));
  const controlledValue = (
    supplied: string | string[] | undefined,
    allowed: Set<string>,
  ) => {
    const candidate = value(supplied);
    return candidate && allowed.has(candidate) ? candidate : undefined;
  };
  const goalOptions = optionSet(customerProjectOptions.goals);
  const categoryOptions = optionSet(customerProjectOptions.serviceCategories);
  const goals = values(query.goal, 10).filter((item) =>
    goalOptions.has(item),
  );
  const postcode = value(query.postcode);
  const propertySelection = {
    propertyType: controlledValue(
      query.propertyType,
      optionSet(customerProjectOptions.propertyTypes),
    ),
    storeys: controlledValue(
      query.storeys,
      optionSet(customerProjectOptions.storeys),
    ),
    ageBand: controlledValue(
      query.ageBand,
      optionSet(customerProjectOptions.ageBands),
    ),
    floorArea: controlledValue(
      query.floorArea,
      optionSet(customerProjectOptions.floorAreas),
    ),
    occupants: controlledValue(
      query.occupants,
      optionSet(customerProjectOptions.occupants),
    ),
    sharedWalls: controlledValue(
      query.sharedWalls,
      optionSet(customerProjectOptions.sharedWalls),
    ),
    roofType: controlledValue(
      query.roofType,
      optionSet(customerProjectOptions.roofTypes),
    ),
    roofColour: controlledValue(
      query.roofColour,
      optionSet(customerProjectOptions.roofColours),
    ),
    roofForm: controlledValue(
      query.roofForm,
      optionSet(customerProjectOptions.roofForms),
    ),
    roofCondition: controlledValue(
      query.roofCondition,
      optionSet(customerProjectOptions.roofConditions),
    ),
    switchboard: controlledValue(
      query.switchboard,
      optionSet(customerProjectOptions.switchboards),
    ),
    wallConstruction: controlledValue(
      query.wallConstruction,
      optionSet(customerProjectOptions.wallConstructions),
    ),
    floorConstruction: controlledValue(
      query.floorConstruction,
      optionSet(customerProjectOptions.floorConstructions),
    ),
  };
  return <CustomerDashboard initialView="new" initialPlannerSelection={{
    goal: goals[0],
    goals,
    pace: controlledValue(query.pace, optionSet(customerProjectOptions.paces)),
    situation: controlledValue(
      query.situation,
      optionSet(customerProjectOptions.situations),
    ),
    approvalContext: controlledValue(
      query.approvalContext,
      optionSet(customerProjectOptions.approvalContexts),
    ),
    budgetRange: controlledValue(
      query.budgetRange,
      optionSet(customerProjectOptions.budgets),
    ),
    addressState: controlledValue(
      query.addressState,
      new Set(customerProjectOptions.states),
    ),
    features: normalizeHomeFeatureSelections(
      values(query.feature, MAX_HOME_FEATURE_SELECTIONS),
    ),
    categories: values(query.category, 12).filter((item) =>
      categoryOptions.has(item),
    ),
    ...propertySelection,
    postcode: postcode && /^\d{4}$/.test(postcode) ? postcode : undefined,
  }} />;
}
