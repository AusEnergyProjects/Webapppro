import { SiteHeader } from "@/components/ComparatorChrome";
import { buildPlatformMetadata } from "@/lib/public-site";
import styles from "../surge/surge-page.module.css";

export const metadata = buildPlatformMetadata({
  path: "/wattzun",
  title: "Wattzun AI | Australian Energy Assessments",
  description: "Talk with Wattzun AI about Australian home energy upgrades, comfort, bills, electrification, solar, batteries, rebates and project decisions.",
});

export default function WattzunPage() {
  return (
    <div className={styles.chrome}>
      <SiteHeader active="surge" />
      <h1 style={{ clipPath: "inset(50%)", height: 1, overflow: "hidden", position: "absolute", whiteSpace: "nowrap", width: 1 }}>
        Wattzun AI home energy guide
      </h1>
    </div>
  );
}
