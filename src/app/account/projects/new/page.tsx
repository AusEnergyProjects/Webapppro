import type { Metadata } from "next";
import { CustomerDashboard } from "@/components/CustomerDashboard";

export const metadata: Metadata = {
  title: "Create a Home Energy Project | Australian Energy Assessments",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

type NewProjectPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function NewCustomerProjectPage({ searchParams }: NewProjectPageProps) {
  const query = await searchParams;
  const values = (value: string | string[] | undefined) => Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return <CustomerDashboard initialView="new" initialPlannerSelection={{
    goal: typeof query.goal === "string" ? query.goal : undefined,
    pace: typeof query.pace === "string" ? query.pace : undefined,
    situation: typeof query.situation === "string" ? query.situation : undefined,
    features: values(query.feature),
    categories: values(query.category),
    postcode: typeof query.postcode === "string" ? query.postcode : undefined,
  }} />;
}
