import type { Metadata } from "next";
import { HomeEnergyPlanner } from "@/components/HomeEnergyPlanner";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { createHomeEnergyPlan } from "@/lib/home-energy-plan.mjs";

export const metadata: Metadata = {
  title: "Build My Home Energy Plan | Australian Energy Assessments",
  description: "Create a private, ordered roadmap for home comfort, electrification, solar, storage, energy plans, assessments and project-ready next steps.",
};

type PlanSearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function HomeEnergyPlanPage({ searchParams }: { searchParams: PlanSearchParams }) {
  const params = await searchParams;
  const feature = params.feature;
  const initialPlan = createHomeEnergyPlan({
    goal: typeof params.goal === "string" ? params.goal : undefined,
    pace: typeof params.pace === "string" ? params.pace : undefined,
    situation: typeof params.situation === "string" ? params.situation : undefined,
    features: Array.isArray(feature) ? feature : typeof feature === "string" ? [feature] : [],
  });

  return <main className="wrap planner-page">
    <SiteHeader active="plan" />
    <header className="planner-hero"><div><span>Your home energy roadmap</span><h1>Work out what to do first</h1><p>Choose the decision, property situation and equipment that apply. The roadmap updates on this device and directs you to the right comparison, guide, assessment or project brief.</p></div><aside><strong>Private by design</strong><p>No account, address, bill, meter identifier or contact details are needed. These choices are not sent anywhere.</p></aside></header>
    <HomeEnergyPlanner initialSelection={{ goal: initialPlan.goal, pace: initialPlan.pace, situation: initialPlan.situation, features: initialPlan.features }} />
    <SiteFooter>This roadmap is general guidance, not a site assessment, quote, eligibility decision or guarantee of savings. Confirm the property, products, approvals and complete installed scope before committing.</SiteFooter>
  </main>;
}
