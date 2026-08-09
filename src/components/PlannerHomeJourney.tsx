"use client";

import Image from "next/image";
import type { PointerEvent } from "react";

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
    sceneLabel: "Rooms and systems",
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

  function moveScene(event: PointerEvent<HTMLElement>) {
    if (
      event.pointerType === "touch"
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
    event.currentTarget.style.setProperty("--planner-scene-x", `${(x * 10).toFixed(2)}px`);
    event.currentTarget.style.setProperty("--planner-scene-y", `${(y * 7).toFixed(2)}px`);
    event.currentTarget.style.setProperty("--planner-scene-tilt-x", `${(y * -1.2).toFixed(2)}deg`);
    event.currentTarget.style.setProperty("--planner-scene-tilt-y", `${(x * 1.8).toFixed(2)}deg`);
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
      onPointerMove={moveScene}
      onPointerLeave={resetScene}
      aria-labelledby="planner-home-journey-title"
    >
      <div className="planner-home-journey-copy">
        <span className="planner-home-journey-eyebrow">Explore your home</span>
        <h2 id="planner-home-journey-title">{activeStage.sceneLabel}</h2>
        <p>{activeStage.detail}</p>
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
        <div
          className="planner-home-journey-progress"
          aria-hidden="true"
        >
          <span style={{ width: `${safeProgress}%` }} />
        </div>
        <small>
          {selectedFeatureCount > 0
            ? `${selectedFeatureCount} home detail${selectedFeatureCount === 1 ? "" : "s"} shaping this plan`
            : "Your answers shape the home as you move through it"}
        </small>
      </div>

      <div className="planner-home-journey-scene" aria-hidden="true">
        <div className="planner-home-journey-depth">
          <Image
            src="/aea-immersive-home-journey.png"
            alt=""
            width="2048"
            height="1146"
            sizes="(max-width: 720px) 100vw, 64vw"
            priority
          />
          <span className="planner-home-orbit planner-home-orbit-one" />
          <span className="planner-home-orbit planner-home-orbit-two" />
          <span className="planner-home-focus-marker">{focusLabels[activeFocus]}</span>
          <span className="planner-home-hotspot planner-home-hotspot-comfort">Comfort</span>
          <span className="planner-home-hotspot planner-home-hotspot-systems">Systems</span>
          <span className="planner-home-hotspot planner-home-hotspot-action">Action</span>
        </div>
      </div>
    </section>
  );
}
