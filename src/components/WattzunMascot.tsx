import type { WattzunHat as Hat } from "@/lib/wattzun-appearance";
import styles from "./WattzunMascot.module.css";

export function WattzunMascot({ hat = "none", className = "" }: { hat?: Hat; className?: string }) {
  return <span
    className={`${styles.mascot} ${className}`}
    data-wattzun-hat={hat === "none" ? undefined : hat}
    style={hat === "none" ? undefined : { backgroundImage: `url("/wattzun/${hat}.webp")` }}
    aria-hidden="true"
  />;
}
