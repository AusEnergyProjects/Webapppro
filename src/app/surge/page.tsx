import type { Metadata } from "next";
import { SiteHeader } from "@/components/ComparatorChrome";
import styles from "./surge-page.module.css";

export const metadata: Metadata = {
  title: "Ask Surge | Australian Energy Assessments",
  description: "Talk with Surge about Australian home energy upgrades, comfort, bills, electrification, solar, batteries, rebates and project decisions.",
};

export default function SurgePage() {
  return (
    <div className={styles.chrome}>
      <SiteHeader active="surge" />
    </div>
  );
}
