"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { HomeEnergyScene } from "@/lib/home-energy-scene";
import styles from "./GettingStarted.module.css";

export function HomeHeroScene({ children }: { children: ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLDivElement>(null);
  const controller = useRef<HomeEnergyScene | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [roofOpen, setRoofOpen] = useState(false);

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
      const progress = motion.matches ? 0 : Math.min(1, Math.max(0, -heroBounds.top / (heroBounds.height * .75)));
      const backgroundWidth = Math.min(window.innerWidth, 1600);
      const backgroundHeight = window.innerHeight * .95;
      const mix = (from: number, to: number) => from + (to - from) * progress;
      const width = Math.min(window.innerWidth, mix(bounds.width, backgroundWidth));
      Object.assign(backdrop.current.style, {
        left: `${Math.max(0, Math.min(window.innerWidth - width, mix(bounds.left, (window.innerWidth - backgroundWidth) / 2)))}px`,
        top: `${mix(bounds.top, window.innerHeight * .08)}px`,
        width: `${width}px`,
        height: `${mix(bounds.height, backgroundHeight)}px`,
        opacity: String(1 - progress * .86),
        pointerEvents: progress < .1 ? "auto" : "none",
      });
      if (canvas.current) canvas.current.tabIndex = progress < .1 && controller.current ? 0 : -1;
      controller.current?.setScrollTurn(window.scrollY * .002);
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
        controller.current = createHomeEnergyScene(element, () => { controller.current = null; element.tabIndex = -1; setStatus("unavailable"); });
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
      <canvas ref={canvas} className={styles.modelCanvas} data-ready={status === "ready"} tabIndex={-1} role="img" aria-label="Interactive 3D home. Drag left or right to turn. Use arrow keys to rotate and tilt, or Home to reset." onKeyDown={(event) => {
        if (!controller.current || event.currentTarget.tabIndex < 0) return;
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) event.preventDefault();
        if (event.key === "ArrowLeft") controller.current.rotate(-.3);
        if (event.key === "ArrowRight") controller.current.rotate(.3);
        if (event.key === "ArrowUp") controller.current.tilt(.12);
        if (event.key === "ArrowDown") controller.current.tilt(-.12);
        if (event.key === "Home") controller.current.reset();
      }} />
    </div>
    <div className={styles.heroScene} ref={hero}>
    {children}
    <div className={styles.modelStage} ref={anchor} aria-hidden="true" />
    <div className={styles.modelToolbar}>
      <p role="status">{status === "ready" ? "Drag to explore in 3D" : status === "loading" ? "Preparing your 3D home…" : "A smarter home, from every angle"}</p>
      {status === "ready" ? <div className={styles.modelControls}>
        <button type="button" aria-label="Rotate home left" onClick={() => controller.current?.rotate(-Math.PI / 4)}>↶</button>
        <button type="button" aria-label="Rotate home right" onClick={() => controller.current?.rotate(Math.PI / 4)}>↷</button>
        <button type="button" aria-pressed={roofOpen} onClick={() => { controller.current?.setRoofOpen(!roofOpen); setRoofOpen(!roofOpen); }}>{roofOpen ? "Close roof" : "Look inside"}</button>
        <button type="button" aria-label="Reset home view" onClick={() => controller.current?.reset()}>Reset</button>
      </div> : null}
    </div>
    </div>
  </>;
}
