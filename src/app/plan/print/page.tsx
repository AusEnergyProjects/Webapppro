import type { Metadata } from "next";
import { PrintRoadmapButton } from "@/components/PrintRoadmapButton";
import { createHomeEnergyPlan } from "@/lib/home-energy-plan.mjs";

export const metadata: Metadata = {
  title: "Printable Home Energy Roadmap | Australian Energy Assessments",
  description: "A lightweight printable copy of your private home energy roadmap.",
  robots: { index: false, follow: false },
};

type PrintSearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PrintableHomeEnergyPlanPage({ searchParams }: { searchParams: PrintSearchParams }) {
  const params = await searchParams;
  const feature = params.feature;
  const plan = createHomeEnergyPlan({
    goal: typeof params.goal === "string" ? params.goal : undefined,
    pace: typeof params.pace === "string" ? params.pace : undefined,
    situation: typeof params.situation === "string" ? params.situation : undefined,
    features: Array.isArray(feature) ? feature : typeof feature === "string" ? [feature] : [],
  });
  const returnParams = new URLSearchParams({ goal: plan.goal, pace: plan.pace, situation: plan.situation });
  plan.features.forEach((item) => returnParams.append("feature", item));

  return <main className="planner-print-page">
    <header><span>Australian Energy Assessments</span><strong>Private home energy roadmap</strong><h1>{plan.title}</h1><p>{plan.summary}</p><div className="planner-print-actions"><PrintRoadmapButton /><a href={`/plan?${returnParams.toString()}`}>Return to planner</a></div></header>
    <ol>{plan.items.map((item, index) => <li key={item.id}><span>{String(index + 1).padStart(2, "0")}</span><div><small>{item.stage}</small><h2>{item.title}</h2><p>{item.text}</p><a href={item.href}>{item.action}</a></div></li>)}</ol>
    <aside><strong>Before committing</strong><p>Replace indicative assumptions with current written quotes, confirm official incentives and approvals, and use licensed professionals for regulated work.</p></aside>
    <footer>This roadmap is general guidance, not a site assessment, quote, eligibility decision or guarantee of savings.</footer>
  </main>;
}
