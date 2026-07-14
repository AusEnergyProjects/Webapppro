import type { Metadata } from "next";
import { CustomerDashboard } from "@/components/CustomerDashboard";

export const metadata: Metadata = {
  title: "Saved Home Energy Project | Australian Energy Assessments",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

type ProjectPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
};

export default async function CustomerProjectPage({ params, searchParams }: ProjectPageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <CustomerDashboard initialProjectId={id} initialEdit={query.edit === "1"} />;
}
