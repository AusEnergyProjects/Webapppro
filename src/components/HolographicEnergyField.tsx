"use client";

import { useEffect, useRef } from "react";

export type EnergyFieldMode = "landing" | "understand" | "home" | "direction" | "plan";

type HolographicEnergyFieldProps = {
  className?: string;
  density?: "standard" | "rich";
  focusX?: number;
  focusY?: number;
  intensity?: number;
  mode?: EnergyFieldMode;
  progress?: number;
};

type Particle = {
  drift: number;
  phase: number;
  size: number;
  speed: number;
  x: number;
  y: number;
  z: number;
};

type Palette = {
  blue: readonly [number, number, number];
  core: readonly [number, number, number];
  violet: readonly [number, number, number];
};

const palettes: Record<EnergyFieldMode, Palette> = {
  landing: { core: [105, 255, 217], blue: [94, 196, 255], violet: [176, 113, 255] },
  understand: { core: [107, 255, 215], blue: [79, 197, 255], violet: [147, 122, 255] },
  home: { core: [94, 255, 222], blue: [77, 216, 255], violet: [131, 119, 255] },
  direction: { core: [111, 241, 218], blue: [113, 189, 255], violet: [196, 116, 255] },
  plan: { core: [144, 255, 211], blue: [82, 220, 255], violet: [255, 185, 108] },
};

function bounded(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function rgba(colour: readonly [number, number, number], alpha: number) {
  return `rgba(${colour[0]}, ${colour[1]}, ${colour[2]}, ${bounded(alpha, 0, 1)})`;
}

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function cubicPoint(
  start: number,
  controlOne: number,
  controlTwo: number,
  end: number,
  position: number,
) {
  const inverse = 1 - position;
  return inverse ** 3 * start
    + 3 * inverse ** 2 * position * controlOne
    + 3 * inverse * position ** 2 * controlTwo
    + position ** 3 * end;
}

export function HolographicEnergyField({
  className = "",
  density = "standard",
  focusX = 0.68,
  focusY = 0.52,
  intensity = 1,
  mode = "home",
  progress = 0,
}: HolographicEnergyFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !context) return;

    const canvasElement = canvas;
    const drawingContext = context;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const compact = window.matchMedia("(max-width: 720px)");
    const precisePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const random = seededRandom(0xa3e2026);
    const palette = palettes[mode];
    const host = canvasElement.closest<HTMLElement>("[data-spatial-scene]") ?? canvasElement.parentElement;

    let width = 1;
    let height = 1;
    let deviceScale = 1;
    let frame = 0;
    let previousTime = performance.now();
    let particles: Particle[] = [];
    let pointerX = 0;
    let pointerY = 0;
    let pointerTargetX = 0;
    let pointerTargetY = 0;
    let scrollOffset = 0;
    let scrollTarget = 0;
    let isIntersecting = true;
    let isVisible = !document.hidden;

    function resetParticle(particle: Particle, initial = false) {
      particle.x = random() * 1.34 - 0.17;
      particle.y = random() * 1.24 - 0.12;
      particle.z = initial ? random() * 0.92 + 0.08 : 1;
      particle.speed = 0.035 + random() * 0.13;
      particle.phase = random() * Math.PI * 2;
      particle.size = 0.5 + random() * 1.75;
      particle.drift = random() * 2 - 1;
    }

    function resetParticles() {
      const areaCount = Math.round((width * height) / (density === "rich" ? 5_200 : 7_800));
      const maximum = compact.matches ? (density === "rich" ? 70 : 48) : (density === "rich" ? 170 : 116);
      const minimum = compact.matches ? 34 : 68;
      const count = bounded(areaCount, minimum, maximum);
      particles = Array.from({ length: count }, () => {
        const particle = { x: 0, y: 0, z: 1, speed: 0, phase: 0, size: 1, drift: 0 };
        resetParticle(particle, true);
        return particle;
      });
    }

    function resize() {
      const bounds = canvasElement.getBoundingClientRect();
      width = Math.max(1, Math.round(bounds.width));
      height = Math.max(1, Math.round(bounds.height));
      deviceScale = bounded(window.devicePixelRatio || 1, 1, compact.matches ? 1.15 : 1.55);
      canvasElement.width = Math.max(1, Math.round(width * deviceScale));
      canvasElement.height = Math.max(1, Math.round(height * deviceScale));
      drawingContext.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
      resetParticles();
    }

    function line(
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      alpha: number,
      lineWidth = 1,
      colour = palette.core,
    ) {
      drawingContext.beginPath();
      drawingContext.moveTo(x1, y1);
      drawingContext.lineTo(x2, y2);
      drawingContext.strokeStyle = rgba(colour, alpha);
      drawingContext.lineWidth = lineWidth;
      drawingContext.stroke();
    }

    function drawRing(
      x: number,
      y: number,
      radius: number,
      rotation: number,
      alpha: number,
      colour = palette.core,
    ) {
      drawingContext.lineCap = "round";
      for (let segment = 0; segment < 6; segment += 1) {
        const start = rotation + segment * Math.PI / 3;
        const length = Math.PI * (0.1 + segment * 0.013);
        drawingContext.beginPath();
        drawingContext.arc(x, y, radius, start, start + length);
        drawingContext.strokeStyle = rgba(segment % 2 ? palette.blue : colour, alpha * (1 - segment * 0.07));
        drawingContext.lineWidth = segment === 0 ? 1.8 : 0.75;
        drawingContext.stroke();
      }
    }

    function drawPerspectiveGrid(focalX: number, focalY: number, power: number) {
      const horizon = height * (0.54 + pointerY * 0.018 - scrollOffset * 0.015);
      const floor = height * 1.08;
      drawingContext.save();
      drawingContext.globalCompositeOperation = "screen";
      for (let index = -8; index <= 8; index += 1) {
        const floorX = width * 0.5 + index * width * 0.105;
        line(focalX + pointerX * 10, horizon, floorX, floor, 0.04 * power, 0.7, palette.blue);
      }
      for (let row = 0; row < 8; row += 1) {
        const eased = (row / 8) ** 1.85;
        const y = horizon + (floor - horizon) * eased;
        const inset = width * (0.33 - eased * 0.4);
        line(inset, y, width - inset, y, (0.03 + eased * 0.055) * power, 0.65, palette.core);
      }
      drawingContext.restore();
    }

    function drawEnergyRoute(
      route: number,
      focalX: number,
      focalY: number,
      phase: number,
      power: number,
      motion: number,
    ) {
      const routeOffset = route - 1;
      const startX = -width * 0.04;
      const startY = height * (0.72 + routeOffset * 0.11);
      const controlOneX = width * (0.24 + route * 0.04);
      const controlOneY = height * (0.42 + routeOffset * 0.09);
      const controlTwoX = focalX - width * (0.12 - route * 0.025);
      const controlTwoY = focalY + height * (0.18 + routeOffset * 0.04);
      const colour = route === 1 ? palette.violet : route === 2 ? palette.blue : palette.core;
      drawingContext.save();
      drawingContext.beginPath();
      drawingContext.moveTo(startX, startY);
      drawingContext.bezierCurveTo(controlOneX, controlOneY, controlTwoX, controlTwoY, focalX, focalY);
      drawingContext.strokeStyle = rgba(colour, (0.09 + route * 0.025) * power);
      drawingContext.lineWidth = route === 0 ? 1.2 : 0.75;
      drawingContext.setLineDash([2, 8 + route * 3]);
      drawingContext.lineDashOffset = motion ? -phase * (18 + route * 5) : -12;
      drawingContext.stroke();
      drawingContext.setLineDash([]);

      const pulsePosition = motion ? (phase * (0.12 + route * 0.018) + route * 0.27) % 1 : 0.58;
      const pulseX = cubicPoint(startX, controlOneX, controlTwoX, focalX, pulsePosition);
      const pulseY = cubicPoint(startY, controlOneY, controlTwoY, focalY, pulsePosition);
      const pulseRadius = 1.9 + route * 0.55;
      drawingContext.beginPath();
      drawingContext.arc(pulseX, pulseY, pulseRadius, 0, Math.PI * 2);
      drawingContext.fillStyle = rgba(colour, 0.9 * power);
      drawingContext.shadowBlur = 18;
      drawingContext.shadowColor = rgba(colour, 0.95);
      drawingContext.fill();
      drawingContext.restore();
    }

    function render(time: number) {
      const elapsed = Math.min(48, time - previousTime) / 1000;
      previousTime = time;
      const motion = reduceMotion.matches ? 0 : 1;
      const power = bounded(intensity, 0.35, 1.75);
      const safeProgress = bounded(progress, 0, 100) / 100;
      pointerX += (pointerTargetX - pointerX) * (motion ? 0.075 : 1);
      pointerY += (pointerTargetY - pointerY) * (motion ? 0.075 : 1);
      scrollOffset += (scrollTarget - scrollOffset) * (motion ? 0.055 : 1);

      const focalX = bounded(focusX + pointerX * 0.026, 0.06, 0.94) * width;
      const focalY = bounded(focusY + pointerY * 0.022 + scrollOffset * 0.015, 0.06, 0.94) * height;
      const phase = time * 0.00034;
      const sceneRadius = Math.max(width, height) * 0.46;

      drawingContext.clearRect(0, 0, width, height);
      drawingContext.save();
      drawingContext.globalCompositeOperation = "screen";

      const atmosphere = drawingContext.createRadialGradient(focalX, focalY, 0, focalX, focalY, sceneRadius);
      atmosphere.addColorStop(0, rgba(palette.core, 0.17 * power));
      atmosphere.addColorStop(0.22, rgba(palette.blue, 0.075 * power));
      atmosphere.addColorStop(0.48, rgba(palette.violet, 0.034 * power));
      atmosphere.addColorStop(1, "rgba(3, 25, 45, 0)");
      drawingContext.fillStyle = atmosphere;
      drawingContext.fillRect(0, 0, width, height);

      const upperGlow = drawingContext.createLinearGradient(0, 0, width, height);
      upperGlow.addColorStop(0, rgba(palette.violet, 0.015 * power));
      upperGlow.addColorStop(0.5, "rgba(0, 0, 0, 0)");
      upperGlow.addColorStop(1, rgba(palette.core, 0.045 * power));
      drawingContext.fillStyle = upperGlow;
      drawingContext.fillRect(0, 0, width, height);

      drawPerspectiveGrid(focalX, focalY, power);
      drawEnergyRoute(0, focalX, focalY, phase, power, motion);
      drawEnergyRoute(1, focalX, focalY, phase, power, motion);
      drawEnergyRoute(2, focalX, focalY, phase, power, motion);

      const projected: Array<{ x: number; y: number; alpha: number; radius: number; index: number }> = [];
      particles.forEach((particle, index) => {
        if (motion) {
          particle.z -= particle.speed * elapsed * (0.82 + safeProgress * 0.34);
          particle.phase += elapsed * (0.18 + Math.abs(particle.drift) * 0.12);
        }
        if (particle.z < 0.065) resetParticle(particle);
        const perspective = 0.43 / particle.z;
        const driftX = Math.sin(particle.phase) * particle.drift * 0.015;
        const driftY = Math.cos(particle.phase * 0.82) * 0.008;
        const x = width * 0.5 + (particle.x + driftX - 0.5) * width * perspective + pointerX * (1 - particle.z) * 17;
        const y = height * 0.5 + (particle.y + driftY - 0.5) * height * perspective + pointerY * (1 - particle.z) * 13;
        if (x < -30 || x > width + 30 || y < -30 || y > height + 30) {
          if (motion) resetParticle(particle);
          return;
        }
        const alpha = bounded((1 - particle.z) * 0.5 + 0.06, 0.045, 0.58) * power;
        const radius = bounded((1 - particle.z) * 2.65 + particle.size, 0.5, 4.25);
        const colour = index % 11 === 0 ? palette.violet : index % 4 === 0 ? palette.blue : palette.core;
        drawingContext.beginPath();
        drawingContext.arc(x, y, radius, 0, Math.PI * 2);
        drawingContext.fillStyle = rgba(colour, alpha);
        drawingContext.shadowBlur = radius * 4.5;
        drawingContext.shadowColor = rgba(colour, 0.82);
        drawingContext.fill();
        drawingContext.shadowBlur = 0;
        projected.push({ x, y, alpha, radius, index });
      });

      for (let index = 0; index < projected.length; index += 7) {
        const particle = projected[index];
        const next = projected[(index + 11) % projected.length];
        if (!next) continue;
        const distance = Math.hypot(next.x - particle.x, next.y - particle.y);
        if (distance < Math.min(width, height) * 0.22) {
          line(particle.x, particle.y, next.x, next.y, Math.min(particle.alpha, next.alpha) * 0.13, 0.45, palette.blue);
        }
        if (Math.hypot(particle.x - focalX, particle.y - focalY) < Math.min(width, height) * 0.34) {
          line(particle.x, particle.y, focalX, focalY, particle.alpha * 0.09, 0.45, palette.core);
        }
      }

      const ringBase = bounded(Math.min(width, height) * 0.135, 44, 132);
      drawRing(focalX, focalY, ringBase, phase, 0.68 * power);
      drawRing(focalX, focalY, ringBase * 1.34, -phase * 0.73, 0.39 * power, palette.blue);
      drawRing(focalX, focalY, ringBase * 1.76, phase * 0.44, 0.2 * power, palette.violet);
      drawRing(focalX, focalY, ringBase * 2.24, -phase * 0.24, 0.1 * power, palette.core);

      drawingContext.beginPath();
      drawingContext.arc(
        focalX,
        focalY,
        ringBase * 1.53,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * Math.max(0.035, safeProgress),
      );
      drawingContext.strokeStyle = rgba(palette.core, 0.67 * power);
      drawingContext.lineWidth = 2.15;
      drawingContext.shadowBlur = 13;
      drawingContext.shadowColor = rgba(palette.core, 0.8);
      drawingContext.stroke();
      drawingContext.shadowBlur = 0;

      const scanLength = ringBase * 2.1;
      line(
        focalX,
        focalY,
        focalX + Math.cos(phase * 1.75) * scanLength,
        focalY + Math.sin(phase * 1.75) * scanLength,
        0.4 * power,
        0.8,
        palette.blue,
      );
      line(focalX - 17, focalY, focalX + 17, focalY, 0.54 * power, 0.7, palette.core);
      line(focalX, focalY - 17, focalX, focalY + 17, 0.54 * power, 0.7, palette.core);

      for (let flare = 0; flare < 12; flare += 1) {
        const angle = flare * Math.PI / 6 + phase * 0.12;
        const start = ringBase * 0.22;
        const end = ringBase * (0.42 + (flare % 3) * 0.12);
        line(
          focalX + Math.cos(angle) * start,
          focalY + Math.sin(angle) * start,
          focalX + Math.cos(angle) * end,
          focalY + Math.sin(angle) * end,
          0.11 * power,
          0.5,
          flare % 2 ? palette.blue : palette.core,
        );
      }

      const tick = Math.max(18, Math.min(width, height) * 0.04);
      line(14, 14, 14 + tick, 14, 0.35 * power, 0.8, palette.core);
      line(14, 14, 14, 14 + tick, 0.35 * power, 0.8, palette.core);
      line(width - 14, height - 14, width - 14 - tick, height - 14, 0.35 * power, 0.8, palette.blue);
      line(width - 14, height - 14, width - 14, height - 14 - tick, 0.35 * power, 0.8, palette.blue);

      drawingContext.restore();
      if (motion && isVisible) frame = window.requestAnimationFrame(render);
    }

    function renderStatic() {
      window.cancelAnimationFrame(frame);
      previousTime = performance.now();
      render(previousTime);
    }

    function handlePointerMove(event: globalThis.PointerEvent) {
      if (!precisePointer.matches || event.pointerType === "touch" || !host) return;
      const bounds = host.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      pointerTargetX = bounded(((event.clientX - bounds.left) / bounds.width - 0.5) * 2, -1, 1);
      pointerTargetY = bounded(((event.clientY - bounds.top) / bounds.height - 0.5) * 2, -1, 1);
    }

    function resetPointer() {
      pointerTargetX = 0;
      pointerTargetY = 0;
    }

    function handleScroll() {
      if (!host) return;
      const bounds = host.getBoundingClientRect();
      const viewportHeight = Math.max(1, window.innerHeight);
      scrollTarget = bounded((viewportHeight * 0.5 - (bounds.top + bounds.height * 0.5)) / viewportHeight, -1, 1);
    }

    function syncAnimationState() {
      const nextVisible = !document.hidden && isIntersecting;
      if (nextVisible === isVisible) return;
      isVisible = nextVisible;
      window.cancelAnimationFrame(frame);
      if (isVisible) {
        previousTime = performance.now();
        render(previousTime);
      }
    }

    function handleVisibilityChange() {
      syncAnimationState();
    }

    function handleMotionChange() {
      renderStatic();
    }

    const observer = new ResizeObserver(() => {
      resize();
      handleScroll();
      if (reduceMotion.matches) renderStatic();
    });
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      isIntersecting = entry?.isIntersecting ?? true;
      syncAnimationState();
    }, { rootMargin: "160px 0px" });
    observer.observe(canvasElement);
    intersectionObserver.observe(canvasElement);
    host?.addEventListener("pointermove", handlePointerMove, { passive: true });
    host?.addEventListener("pointerleave", resetPointer);
    window.addEventListener("scroll", handleScroll, { passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);
    reduceMotion.addEventListener("change", handleMotionChange);
    compact.addEventListener("change", resize);
    precisePointer.addEventListener("change", resetPointer);

    resize();
    handleScroll();
    render(performance.now());

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      intersectionObserver.disconnect();
      host?.removeEventListener("pointermove", handlePointerMove);
      host?.removeEventListener("pointerleave", resetPointer);
      window.removeEventListener("scroll", handleScroll);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      reduceMotion.removeEventListener("change", handleMotionChange);
      compact.removeEventListener("change", resize);
      precisePointer.removeEventListener("change", resetPointer);
    };
  }, [density, focusX, focusY, intensity, mode, progress]);

  return (
    <canvas
      ref={canvasRef}
      className={`holographic-energy-field ${className}`.trim()}
      aria-hidden="true"
    />
  );
}
