import type { CSSProperties } from "react";
import type { WattzunHat as Hat } from "@/lib/wattzun-appearance";
import styles from "./WattzunMascot.module.css";

// Face-window midpoint and foot sole measured in the existing source portraits.
// Headgear and costume outlines deliberately do not determine the character size.
const landmarks: Record<Hat, { faceX: number; faceY: number; feetY: number }> = {
  none: { faceX: 423.5, faceY: 471.5, feetY: 1046 },
  "hard-hat": { faceX: 382, faceY: 419.5, feetY: 917 },
  cap: { faceX: 381.5, faceY: 418, feetY: 908 },
  cowboy: { faceX: 382.5, faceY: 442, feetY: 901 },
  viking: { faceX: 383.5, faceY: 455.5, feetY: 888 },
  pirate: { faceX: 381, faceY: 455, feetY: 883 },
  sausage: { faceX: 379, faceY: 421.5, feetY: 938 },
  tinfoil: { faceX: 383.5, faceY: 497.5, feetY: 936 },
  "safety-plug": { faceX: 383.5, faceY: 485, feetY: 937 },
  party: { faceX: 380.5, faceY: 551.5, feetY: 925 },
  pumpkin: { faceX: 382.5, faceY: 396.5, feetY: 914 },
  ghost: { faceX: 383, faceY: 358.5, feetY: 911 },
};
type ArtStyle = CSSProperties & Record<"--wattzun-width" | "--wattzun-height" | "--wattzun-x" | "--wattzun-y", number>;

export function WattzunMascot({ hat = "none", className = "" }: { hat?: Hat; className?: string }) {
  const original = landmarks.none, selected = landmarks[hat];
  const scale = (original.feetY - original.faceY) / (selected.feetY - selected.faceY);
  const sourceWidth = hat === "none" ? 848 : 768, sourceHeight = hat === "none" ? 1072 : 970;
  const art: ArtStyle = {
    backgroundImage: `url("${hat === "none" ? "/surge-mascot.webp" : `/wattzun/${hat}.webp`}")`,
    "--wattzun-width": sourceWidth * scale / 848,
    "--wattzun-height": sourceHeight * scale / 1072,
    "--wattzun-x": (original.faceX - selected.faceX * scale) / 848,
    "--wattzun-y": (original.feetY - selected.feetY * scale) / 1072,
  };
  return <span
    className={`${styles.mascot} ${className}`}
    style={{ backgroundImage: "none" }}
    aria-hidden="true"
  ><span className={styles.art} data-wattzun-hat={hat === "none" ? undefined : hat} style={art} /></span>;
}
