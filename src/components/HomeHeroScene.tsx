"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./GettingStarted.module.css";

export function HomeHeroScene({ children }: { children: ReactNode }) {
  const atmosphere = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = atmosphere.current;
    if (!element) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    function update() {
      frame = 0;
      if (!element) return;
      const scrollRange = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const progress = motion.matches ? 0 : Math.min(1, Math.max(0, window.scrollY / scrollRange));
      element.style.setProperty("--aurora-shift", `${progress * -180}px`);
      element.style.setProperty("--aurora-turn", `${progress * 24}deg`);
      element.style.setProperty("--aurora-bloom", String(.2 + progress * .38));
    }
    function schedule() { if (!frame) frame = window.requestAnimationFrame(update); }
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    motion.addEventListener("change", schedule);
    update();
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      motion.removeEventListener("change", schedule);
    };
  }, []);

  return <>
    <div className={styles.auroraBackdrop} ref={atmosphere} aria-hidden="true">
      <svg className={styles.auroraVeil} viewBox="0 0 1600 1000" fill="none" preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <linearGradient id="home-aurora-mint" x1="0" y1="900" x2="1400" y2="100" gradientUnits="userSpaceOnUse">
            <stop stopColor="#078586" stopOpacity="0" />
            <stop offset=".38" stopColor="#26dfad" stopOpacity=".55" />
            <stop offset=".66" stopColor="#7bfde1" stopOpacity=".8" />
            <stop offset="1" stopColor="#2853a4" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="home-aurora-violet" x1="150" y1="100" x2="1300" y2="850" gradientUnits="userSpaceOnUse">
            <stop stopColor="#24769e" stopOpacity="0" />
            <stop offset=".45" stopColor="#8471df" stopOpacity=".7" />
            <stop offset=".8" stopColor="#248fbe" stopOpacity=".45" />
            <stop offset="1" stopColor="#0a3850" stopOpacity="0" />
          </linearGradient>
          <filter id="home-aurora-smoke" x="-20%" y="-30%" width="140%" height="160%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency=".005 .012" numOctaves="2" seed="8" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="110" xChannelSelector="R" yChannelSelector="G" />
            <feGaussianBlur stdDeviation="13" />
          </filter>
        </defs>
        <g filter="url(#home-aurora-smoke)">
          <path d="M-220 970C230 780 340 220 820 270S1250 650 1810-180C1290 470 1140 190 800 180S230 640-220 790Z" fill="url(#home-aurora-mint)" />
          <path d="M-100 830C300 620 470 100 850 190S1330 490 1770-70" stroke="url(#home-aurora-mint)" strokeWidth="15" />
          <path className={styles.auroraEcho} d="M-180 50C240 70 410 730 840 720S1280 210 1780 350C1280 160 1190 610 830 590S290-70-180-40Z" fill="url(#home-aurora-violet)" />
        </g>
      </svg>
      <div className={styles.auroraGlow} />
    </div>
    <div className={styles.heroScene}>
      {children}
      <div className={styles.heroImage}>
        <picture>
          <source media="(max-width: 560px)" srcSet="/aea-home-architecture-mobile.webp" />
          {/* Responsive WebP assets are compressed at publication time. */}
          <img src="/aea-home-architecture.webp" alt="Architectural concept of a contemporary all-electric Australian home with rooftop solar, warm interiors and electric vehicle charging." width={1920} height={1081} fetchPriority="high" draggable={false} />
        </picture>
      </div>
    </div>
  </>;
}
