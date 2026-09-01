import type { Metadata } from "next";
import { SiteHeader } from "@/components/ComparatorChrome";
import styles from "../surge/surge-page.module.css";

export const metadata: Metadata = {
  title: "Wattzun AI | Australian Energy Assessments",
  description: "Talk with Wattzun AI about Australian home energy upgrades, comfort, bills, electrification, solar, batteries, rebates and project decisions.",
  alternates: { canonical: "/wattzun" },
};

export default function WattzunPage() {
  return (
    <div className={styles.chrome}>
      <SiteHeader active="surge" />
    </div>
  );
}
