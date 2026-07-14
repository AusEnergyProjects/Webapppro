import type { Metadata } from "next";
import { HomeEnergyPlanner } from "@/components/HomeEnergyPlanner";

export const metadata: Metadata = {
  title: "Build My Home Energy Plan | Australian Energy Assessments",
  description: "Create a private, ordered roadmap for home comfort, electrification, solar, storage, energy plans, assessments and project-ready next steps.",
};

export default function HomeEnergyPlanPage() {
  return <HomeEnergyPlanner />;
}
