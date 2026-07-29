import type { Metadata } from "next";
import { CustomerDashboard } from "@/components/CustomerDashboard";
import { customerProjectOptions } from "@/lib/customer-projects.mjs";

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
  const featureOptions = optionSet(customerProjectOptions.homeFeatures);
  const categoryOptions = optionSet(customerProjectOptions.serviceCategories);
  const goals = values(query.goal, 10).filter((item) =>
    goalOptions.has(item),
  );
  const postcode = value(query.postcode);
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
    features: values(query.feature, 24).filter((item) =>
      featureOptions.has(item),
    ),
    categories: values(query.category, 12).filter((item) =>
      categoryOptions.has(item),
    ),
    postcode: postcode && /^\d{4}$/.test(postcode) ? postcode : undefined,
  }} />;
}
