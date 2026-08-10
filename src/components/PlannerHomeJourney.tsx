"use client";

import Image from "next/image";
import type { CSSProperties, PointerEvent } from "react";
import { HolographicEnergyField } from "@/components/HolographicEnergyField";

export type PlannerJourneyStage = "understand" | "home" | "direction" | "plan";

type PlannerHomeJourneyProps = {
  stage: PlannerJourneyStage;
  progress: number;
  focusLabel: string;
  focusKey?: string;
  selectedFeatureCount?: number;
};

type PlannerHomeFocus =
  | "overview"
  | "comfort"
  | "insulation"
  | "windows"
  | "ventilation"
  | "heating-cooling"
  | "hot-water"
  | "cooking"
  | "electrical"
  | "solar"
  | "battery"
  | "ev";

const stages: Array<{
  id: PlannerJourneyStage;
  label: string;
  sceneLabel: string;
  detail: string;
}> = [
  {
    id: "understand",
    label: "Understand",
    sceneLabel: "Your priorities",
    detail: "Start with the home and the outcomes that matter to you.",
  },
  {
    id: "home",
    label: "Explore your home",
    sceneLabel: "Your home, brought to life",
    detail: "Move through comfort, hot water, draughts, appliances and energy systems.",
  },
  {
    id: "direction",
    label: "Choose direction",
    sceneLabel: "Your practical route",
    detail: "Connect the home to your preferred timing, location and investment range.",
  },
  {
    id: "plan",
    label: "Take action",
    sceneLabel: "Your whole-home plan",
    detail: "Bring the answers together into clear quick wins and ordered next moves.",
  },
];

function boundedProgress(progress: number) {
  return Math.max(0, Math.min(100, Math.round(progress)));
}

function homeFocus(focusKey: string | undefined, stage: PlannerJourneyStage): PlannerHomeFocus {
  const key = focusKey?.toLowerCase() ?? "";
  if (key.includes("insulation")) return "insulation";
  if (key === "glazing" || key.includes("window") || key.includes("shading")) return "windows";
  if (key.includes("ventilation") || key.includes("exhaust") || key.includes("draught")) return "ventilation";
  if (key.includes("heating-cooling")) return "heating-cooling";
  if (key.includes("hot-water")) return "hot-water";
  if (key.includes("cooking")) return "cooking";
  if (key.includes("electrical")) return "electrical";
  if (key.includes("solar")) return "solar";
  if (key.includes("battery")) return "battery";
  if (key === "ev" || key.includes("vehicle")) return "ev";
  if (key.includes("comfort")) return "comfort";
  return stage === "home" ? "comfort" : "overview";
}

const focusLabels: Record<PlannerHomeFocus, string> = {
  overview: "Whole home",
  comfort: "Comfort",
  insulation: "Roof, walls and floors",
  windows: "Windows and shade",
  ventilation: "Draughts and airflow",
  "heating-cooling": "Heating and cooling",
  "hot-water": "Hot water",
  cooking: "Kitchen",
  electrical: "Electrical supply",
  solar: "Rooftop solar",
  battery: "Home battery",
  ev: "Electric vehicle",
};

const focusPositions: Record<PlannerHomeFocus, readonly [number, number]> = {
  overview: [0.68, 0.51],
  comfort: [0.57, 0.34],
  insulation: [0.69, 0.15],
  windows: [0.57, 0.43],
  ventilation: [0.7, 0.3],
  "heating-cooling": [0.51, 0.31],
  "hot-water": [0.57, 0.72],
  cooking: [0.79, 0.5],
  electrical: [0.79, 0.21],
  solar: [0.72, 0.1],
  battery: [0.52, 0.77],
  ev: [0.87, 0.77],
};

export function PlannerHomeJourney({
  stage,
  progress,
  focusLabel,
  focusKey,
  selectedFeatureCount = 0,
}: PlannerHomeJourneyProps) {
  const stageIndex = Math.max(0, stages.findIndex((item) => item.id === stage));
  const activeStage = stages[stageIndex];
  const safeProgress = boundedProgress(progress);
  const activeFocus = homeFocus(focusKey, stage);
  const [focusX, focusY] = focusPositions[activeFocus];
  const spatialStyle: CSSProperties & {
    "--planner-focus-x": string;
    "--planner-focus-y": string;
    "--planner-progress": number;
  } = {
    "--planner-focus-x": `${focusX * 100}%`,
    "--planner-focus-y": `${focusY * 100}%`,
    "--planner-progress": safeProgress / 100,
  };

  function moveScene(event: PointerEvent<HTMLElement>) {
    if (
      event.pointerType === "touch"
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
    event.currentTarget.style.setProperty("--planner-scene-x", `${(x * 18).toFixed(2)}px`);
    event.currentTarget.style.setProperty("--planner-scene-y", `${(y * 13).toFixed(2)}px`);
    event.currentTarget.style.setProperty("--planner-scene-tilt-x", `${(y * -2).toFixed(2)}deg`);
    event.currentTarget.style.setProperty("--planner-scene-tilt-y", `${(x * 3).toFixed(2)}deg`);
  }

  function resetScene(event: PointerEvent<HTMLElement>) {
    event.currentTarget.style.setProperty("--planner-scene-x", "0px");
    event.currentTarget.style.setProperty("--planner-scene-y", "0px");
    event.currentTarget.style.setProperty("--planner-scene-tilt-x", "0deg");
    event.currentTarget.style.setProperty("--planner-scene-tilt-y", "0deg");
  }

  return (
    <section
      className="planner-home-journey"
      data-stage={stage}
      data-focus={activeFocus}
      data-entry={safeProgress <= 5 ? "true" : "false"}
      data-spatial-scene="planner"
      style={spatialStyle}
      onPointerMove={moveScene}
      onPointerLeave={resetScene}
      aria-labelledby="planner-home-journey-title"
      aria-describedby="planner-home-journey-detail"
    >
      <div className="planner-home-journey-scene" aria-hidden="true">
        <div className="planner-home-journey-depth">
          <span className="planner-home-nebula planner-home-nebula-one" />
          <span className="planner-home-nebula planner-home-nebula-two" />
          <span className="planner-home-depth-grid" />
          <HolographicEnergyField
            className="planner-home-energy-field"
            density="rich"
            focusX={focusX}
            focusY={focusY}
            intensity={stage === "plan" ? 1.48 : 1.26}
            mode={stage}
            progress={safeProgress}
          />
          <div className="planner-home-render-volume">
            <Image
              src="/aea-immersive-home-journey.png"
              alt=""
              width="2048"
              height="1146"
              sizes="(max-width: 720px) 110vw, 100vw"
              priority
            />
          </div>
          <span className="planner-home-energy-trace planner-home-energy-trace-one" />
          <span className="planner-home-energy-trace planner-home-energy-trace-two" />
          <span className="planner-home-energy-trace planner-home-energy-trace-three" />
          <span className="planner-home-orbit planner-home-orbit-one" />
          <span className="planner-home-orbit planner-home-orbit-two" />
          <span className="planner-home-orbit planner-home-orbit-three" />
          <span className="planner-home-focus-beam" />
          <span className="planner-home-scan-plane" />
          <span className="planner-home-readout planner-home-readout-stage">Spatial layer {String(stageIndex + 1).padStart(2, "0")}</span>
          <span className="planner-home-readout planner-home-readout-progress">Plan model {safeProgress}%</span>
          <span className="planner-home-focus-marker">{focusLabels[activeFocus]}</span>
          <span className="planner-home-hotspot planner-home-hotspot-comfort">Comfort</span>
          <span className="planner-home-hotspot planner-home-hotspot-systems">Systems</span>
          <span className="planner-home-hotspot planner-home-hotspot-action">Action</span>
        </div>
      </div>

      <div className="planner-home-journey-copy">
        <span className="planner-home-journey-eyebrow">Interactive whole-home model</span>
        <h2 id="planner-home-journey-title">{activeStage.sceneLabel}</h2>
        <p id="planner-home-journey-detail">{activeStage.detail}</p>
        <p className="planner-home-journey-focus">
          <span aria-hidden="true" />
          Now exploring <strong>{focusLabel}</strong>
        </p>
        <ol aria-label="Home planning journey">
          {stages.map((item, index) => (
            <li
              key={item.id}
              className={index < stageIndex ? "complete" : index === stageIndex ? "current" : "upcoming"}
              aria-current={index === stageIndex ? "step" : undefined}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{item.label}</strong>
            </li>
          ))}
        </ol>
        <div className="planner-home-journey-progress" aria-hidden="true">
          <span style={{ width: `${safeProgress}%` }} />
        </div>
        <small>
          {selectedFeatureCount > 0
            ? `${selectedFeatureCount} home detail${selectedFeatureCount === 1 ? "" : "s"} shaping this model`
            : "Your answers move the camera through the home"}
        </small>
      </div>

      <div className="planner-home-telemetry" aria-hidden="true">
        <span><b>{String(stageIndex + 1).padStart(2, "0")}</b> Journey stage</span>
        <span><b>{safeProgress}%</b> Plan mapped</span>
        <span><b>Live</b> Focus transition</span>
      </div>
      {safeProgress <= 5 ? (
        <p className="planner-home-question-cue">
          Start with the question below
          <span aria-hidden="true" />
        </p>
      ) : null}
    </section>
  );
}
