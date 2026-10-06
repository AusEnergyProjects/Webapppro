import type { WattzunHat as Hat } from "@/lib/wattzun-appearance";
import styles from "./WattzunMascot.module.css";

export function WattzunHat({ hat = "none" }: { hat?: Hat }) {
  if (hat === "none") return null;
  return <svg className={styles.hat} data-wattzun-hat={hat} viewBox="0 0 100 50" aria-hidden="true" focusable="false">
    {hat === "hard-hat" && <g fill="#f2bc36" stroke="#755715" strokeWidth="2.5"><path d="M20 36V27a30 26 0 0 1 60 0v9Z" /><path d="M44 4h12v29H44Z" fill="#ffda63" /><path d="M12 34h76v9H12Z" /></g>}
    {hat === "cap" && <g fill="#268dca" stroke="#15496b" strokeWidth="2.5"><path d="M20 35V25a29 23 0 0 1 58 0v10Z" /><path d="M44 4v28" fill="none" /><path d="M18 33h60l17 10H18Z" fill="#1a68a0" /></g>}
    {hat === "cowboy" && <g fill="#b78350" stroke="#654127" strokeWidth="2.5"><path d="m27 34 6-27q8-5 17 3 9-8 17-3l6 27Z" /><path d="M27 28h46v7H27Z" fill="#513e30" /><path d="M5 29q17 15 45 8 28 7 45-8v8q-45 19-90 0Z" /></g>}
    {hat === "viking" && <g stroke="#6d532b" strokeWidth="2.5"><path d="M25 28Q2 27 5 3q6 15 24 12M75 28q23-1 20-25-6 15-24 12" fill="#fff2cb" /><path d="M20 38V28a30 24 0 0 1 60 0v10Z" fill="#bfa36b" /><path d="M46 5h8v29h-8Z" fill="#f4d48d" /><path d="M16 33h68v10H16Z" fill="#967942" /></g>}
    {hat === "pirate" && <g><path d="M5 37 19 15q8-7 19 3Q50 0 62 18q11-10 19-3l14 22-15 8H20Z" fill="#25333b" stroke="#d8b35c" strokeWidth="3" /><path d="m41 23 18 10m-18 0 18-10" stroke="#fff5dd" strokeWidth="3" /><path d="M44 17q6-5 12 0v8H44Z" fill="#fff5dd" /><circle cx="48" cy="20" r="1.5" fill="#25333b" /><circle cx="53" cy="20" r="1.5" fill="#25333b" /></g>}
  </svg>;
}
export function WattzunMascot({ hat = "none", className = "" }: { hat?: Hat; className?: string }) {
  return <span className={`${styles.mascot} ${className}`} aria-hidden="true"><WattzunHat hat={hat} /></span>;
}
