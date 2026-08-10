"use client";

import { useEffect, useRef } from "react";

type HolographicEnergyFieldProps = {
  className?: string;
  focusX?: number;
  focusY?: number;
  intensity?: number;
};

type Particle = {
  x: number;
  y: number;
  z: number;
  speed: number;
  phase: number;
};

function bounded(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
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

export function HolographicEnergyField({
  className = "",
  focusX = 0.68,
  focusY = 0.52,
  intensity = 1,
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
    const random = seededRandom(0xa3e2026);
    let width = 1;
    let height = 1;
    let deviceScale = 1;
    let frame = 0;
    let previousTime = performance.now();
    let particles: Particle[] = [];

    function resetParticle(particle: Particle, initial = false) {
      particle.x = random() * 1.25 - 0.12;
      particle.y = random() * 1.18 - 0.09;
      particle.z = initial ? random() * 0.9 + 0.1 : 1;
      particle.speed = 0.045 + random() * 0.12;
      particle.phase = random() * Math.PI * 2;
    }

    function resetParticles() {
      const count = compact.matches ? 34 : 72;
      particles = Array.from({ length: count }, () => {
        const particle = { x: 0, y: 0, z: 1, speed: 0, phase: 0 };
        resetParticle(particle, true);
        return particle;
      });
    }

    function resize() {
      const bounds = canvasElement.getBoundingClientRect();
      width = Math.max(1, Math.round(bounds.width));
      height = Math.max(1, Math.round(bounds.height));
      deviceScale = bounded(window.devicePixelRatio || 1, 1, compact.matches ? 1.15 : 1.6);
      canvasElement.width = Math.max(1, Math.round(width * deviceScale));
      canvasElement.height = Math.max(1, Math.round(height * deviceScale));
      drawingContext.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
      resetParticles();
    }

    function line(x1: number, y1: number, x2: number, y2: number, alpha: number, lineWidth = 1) {
      drawingContext.beginPath();
      drawingContext.moveTo(x1, y1);
      drawingContext.lineTo(x2, y2);
      drawingContext.strokeStyle = `rgba(102, 244, 218, ${alpha})`;
      drawingContext.lineWidth = lineWidth;
      drawingContext.stroke();
    }

    function drawRing(x: number, y: number, radius: number, rotation: number, alpha: number) {
      drawingContext.lineCap = "round";
      for (let segment = 0; segment < 4; segment += 1) {
        const start = rotation + segment * Math.PI * 0.5;
        drawingContext.beginPath();
        drawingContext.arc(x, y, radius, start, start + Math.PI * (0.24 + segment * 0.025));
        drawingContext.strokeStyle = segment % 2
          ? `rgba(108, 194, 255, ${alpha * 0.75})`
          : `rgba(112, 255, 218, ${alpha})`;
        drawingContext.lineWidth = segment === 0 ? 1.7 : 0.8;
        drawingContext.stroke();
      }
    }

    function render(time: number) {
      const elapsed = Math.min(48, time - previousTime) / 1000;
      previousTime = time;
      const motion = reduceMotion.matches ? 0 : 1;
      const power = bounded(intensity, 0.35, 1.6);
      const focalX = bounded(focusX, 0.08, 0.92) * width;
      const focalY = bounded(focusY, 0.08, 0.92) * height;
      const phase = time * 0.00036;

      drawingContext.clearRect(0, 0, width, height);
      drawingContext.save();
      drawingContext.globalCompositeOperation = "screen";

      const aura = drawingContext.createRadialGradient(
        focalX,
        focalY,
        0,
        focalX,
        focalY,
        Math.max(width, height) * 0.34,
      );
      aura.addColorStop(0, `rgba(57, 244, 211, ${0.085 * power})`);
      aura.addColorStop(0.42, `rgba(18, 173, 221, ${0.035 * power})`);
      aura.addColorStop(1, "rgba(3, 25, 45, 0)");
      drawingContext.fillStyle = aura;
      drawingContext.fillRect(0, 0, width, height);

      for (const particle of particles) {
        if (motion) particle.z -= particle.speed * elapsed;
        if (particle.z < 0.08) resetParticle(particle);
        const perspective = 0.44 / particle.z;
        const x = width * 0.5 + (particle.x - 0.5) * width * perspective;
        const y = height * 0.5 + (particle.y - 0.5) * height * perspective;
        if (x < -20 || x > width + 20 || y < -20 || y > height + 20) {
          if (motion) resetParticle(particle);
          continue;
        }
        const alpha = bounded((1 - particle.z) * 0.48 + 0.08, 0.05, 0.52) * power;
        const radius = bounded((1 - particle.z) * 2.5 + 0.6, 0.55, 3.4);
        drawingContext.beginPath();
        drawingContext.arc(x, y, radius, 0, Math.PI * 2);
        drawingContext.fillStyle = `rgba(129, 255, 225, ${alpha})`;
        drawingContext.shadowBlur = radius * 4;
        drawingContext.shadowColor = "rgba(89, 255, 218, .8)";
        drawingContext.fill();
        drawingContext.shadowBlur = 0;
        const distance = Math.hypot(x - focalX, y - focalY);
        if (distance < Math.min(width, height) * 0.24 && particle.z < 0.64) {
          line(x, y, focalX, focalY, alpha * 0.15, 0.5);
        }
      }

      const ringBase = bounded(Math.min(width, height) * 0.125, 38, 116);
      drawRing(focalX, focalY, ringBase, phase, 0.55 * power);
      drawRing(focalX, focalY, ringBase * 1.34, -phase * 0.72, 0.3 * power);
      drawRing(focalX, focalY, ringBase * 1.72, phase * 0.42, 0.17 * power);

      const scanLength = ringBase * 1.58;
      line(
        focalX,
        focalY,
        focalX + Math.cos(phase * 1.8) * scanLength,
        focalY + Math.sin(phase * 1.8) * scanLength,
        0.34 * power,
        0.8,
      );
      line(focalX - 12, focalY, focalX + 12, focalY, 0.48 * power, 0.7);
      line(focalX, focalY - 12, focalX, focalY + 12, 0.48 * power, 0.7);

      const pathPulse = motion ? (time * 0.00016) % 1 : 0.62;
      drawingContext.beginPath();
      drawingContext.moveTo(width * 0.08, height * 0.9);
      drawingContext.bezierCurveTo(
        width * 0.27,
        height * 0.72,
        focalX - width * 0.16,
        focalY + height * 0.22,
        focalX,
        focalY,
      );
      drawingContext.strokeStyle = `rgba(81, 244, 215, ${0.2 * power})`;
      drawingContext.lineWidth = 1;
      drawingContext.stroke();
      const pulseX = width * (0.08 + (focusX - 0.08) * pathPulse);
      const pulseY = height * (0.9 + (focusY - 0.9) * pathPulse);
      drawingContext.beginPath();
      drawingContext.arc(pulseX, pulseY, 2.6, 0, Math.PI * 2);
      drawingContext.fillStyle = `rgba(165, 255, 234, ${0.85 * power})`;
      drawingContext.shadowBlur = 16;
      drawingContext.shadowColor = "#5fffd9";
      drawingContext.fill();
      drawingContext.shadowBlur = 0;

      const tick = Math.max(14, Math.min(width, height) * 0.035);
      line(12, 12, 12 + tick, 12, 0.28 * power);
      line(12, 12, 12, 12 + tick, 0.28 * power);
      line(width - 12, height - 12, width - 12 - tick, height - 12, 0.28 * power);
      line(width - 12, height - 12, width - 12, height - 12 - tick, 0.28 * power);

      drawingContext.restore();
      if (!reduceMotion.matches) frame = window.requestAnimationFrame(render);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvasElement);
    resize();
    render(performance.now());

    function handleMotionChange() {
      window.cancelAnimationFrame(frame);
      previousTime = performance.now();
      render(previousTime);
    }

    reduceMotion.addEventListener("change", handleMotionChange);
    compact.addEventListener("change", resize);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      reduceMotion.removeEventListener("change", handleMotionChange);
      compact.removeEventListener("change", resize);
    };
  }, [focusX, focusY, intensity]);

  return (
    <canvas
      ref={canvasRef}
      className={`holographic-energy-field ${className}`.trim()}
      aria-hidden="true"
    />
  );
}
