"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { HomeEnergyScene } from "@/lib/home-energy-scene";
import styles from "./GettingStarted.module.css";

const featureLabels = [
  ["solar", "Solar generation"], ["ev", "EV + wall charger"],
  ["hotWater", "Heat-pump hot water"], ["battery", "Home battery"],
  ["insulation", "Insulated envelope"], ["glazing", "Double glazing"],
  ["airConditioning", "Reverse-cycle air con"], ["ventilation", "Heat-recovery ventilation"],
] as const;

export function HomeHeroScene({ children }: { children: ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLSpanElement>());
  const controller = useRef<HomeEnergyScene | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let disposed = false;
    let layoutFrame = 0;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    function updateLayout() {
      layoutFrame = 0;
      if (!anchor.current || !backdrop.current || !hero.current) return;
      const bounds = anchor.current.getBoundingClientRect();
      const heroBounds = hero.current.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const progress = motion.matches ? 0 : Math.min(1, Math.max(0, -heroBounds.top / (heroBounds.height * .75)));
      const backgroundWidth = Math.min(viewportWidth, 1600);
      const backgroundHeight = window.innerHeight * .95;
      const mix = (from: number, to: number) => from + (to - from) * progress;
      const width = Math.min(viewportWidth, mix(bounds.width, backgroundWidth));
      Object.assign(backdrop.current.style, {
        left: `${Math.max(0, Math.min(viewportWidth - width, mix(bounds.left, (viewportWidth - backgroundWidth) / 2)))}px`,
        top: `${mix(bounds.top, window.innerHeight * .08)}px`,
        width: `${width}px`,
        height: `${mix(bounds.height, backgroundHeight)}px`,
        opacity: String(1 - progress * .86),
        pointerEvents: progress < .1 ? "auto" : "none",
      });
      controller.current?.setScrollProgress(window.scrollY * .00045, Math.min(1, Math.max(0, (window.scrollY - 40) / 360)));
    }
    function scheduleLayout() { if (!layoutFrame) layoutFrame = window.requestAnimationFrame(updateLayout); }
    const sizeObserver = new ResizeObserver(scheduleLayout);
    if (hero.current) sizeObserver.observe(hero.current);
    window.addEventListener("scroll", scheduleLayout, { passive: true });
    window.addEventListener("resize", scheduleLayout, { passive: true });
    motion.addEventListener("change", scheduleLayout);
    updateLayout();
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void import("@/lib/home-energy-scene").then(({ createHomeEnergyScene }) => {
        if (disposed) return;
        controller.current = createHomeEnergyScene(element, () => { controller.current = null; setStatus("unavailable"); }, (positions) => {
          for (const [key, label] of labels.current) {
            const position = positions.find((entry) => entry.key === key);
            label.style.opacity = position ? "1" : "0";
            if (position) { label.style.left = `${position.x}px`; label.style.top = `${position.y}px`; }
          }
        });
        setStatus("ready");
        updateLayout();
      }).catch(() => { if (!disposed) setStatus("unavailable"); });
    }, { rootMargin: "100px" });
    observer.observe(element);
    return () => {
      disposed = true;
      observer.disconnect();
      sizeObserver.disconnect();
      window.cancelAnimationFrame(layoutFrame);
      window.removeEventListener("scroll", scheduleLayout);
      window.removeEventListener("resize", scheduleLayout);
      motion.removeEventListener("change", scheduleLayout);
      controller.current?.dispose();
      controller.current = null;
    };
  }, []);

  return <>
    <div className={styles.modelBackdrop} ref={backdrop}>
      {/* The fallback is already compressed WebP and stays outside the image runtime. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {status !== "ready" ? <img className={styles.modelFallback} src="/aea-home-future.webp" alt="Conceptual energy-efficient home with rooftop solar and a home battery" width={1536} height={1024} fetchPriority="high" /> : null}
      <canvas ref={canvas} className={styles.modelCanvas} data-ready={status === "ready"} role="img" aria-hidden={status !== "ready"} aria-label="3D cutaway of an all-electric home with insulation, double glazing, solar panels, a battery, heat-pump hot water, EV charging, air conditioning and heat-recovery ventilation. The roof opens as you scroll." />
      {status === "ready" ? featureLabels.map(([key, label]) => <span key={key} ref={(element) => { if (element) labels.current.set(key, element); else labels.current.delete(key); }} className={styles.featureLabel} aria-hidden="true">{label}</span>) : null}
    </div>
    <div className={styles.heroScene} ref={hero}>
    {children}
    <div className={styles.modelStage} ref={anchor} aria-hidden="true" />
    </div>
  </>;
}
