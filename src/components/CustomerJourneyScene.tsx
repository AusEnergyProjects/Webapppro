"use client";

import Image from "next/image";
import type { PointerEvent } from "react";
import { HolographicEnergyField } from "@/components/HolographicEnergyField";

const journeyStages = [
  { number: "01", title: "Understand", text: "Tell us what matters at home." },
  { number: "02", title: "Prioritise", text: "See the right order for upgrades." },
  { number: "03", title: "Take action", text: "Leave with one clear next move." },
] as const;

export function CustomerJourneyScene() {
  function moveScene(event: PointerEvent<HTMLDivElement>) {
    if (
      event.pointerType === "touch"
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
    event.currentTarget.style.setProperty("--scene-shift-x", `${(x * 16).toFixed(2)}px`);
    event.currentTarget.style.setProperty("--scene-shift-y", `${(y * 12).toFixed(2)}px`);
    event.currentTarget.style.setProperty("--scene-rotate-x", `${(y * -2).toFixed(2)}deg`);
    event.currentTarget.style.setProperty("--scene-rotate-y", `${(x * 3).toFixed(2)}deg`);
  }

  function resetScene(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.style.setProperty("--scene-shift-x", "0px");
    event.currentTarget.style.setProperty("--scene-shift-y", "0px");
    event.currentTarget.style.setProperty("--scene-rotate-x", "0deg");
    event.currentTarget.style.setProperty("--scene-rotate-y", "0deg");
  }

  return (
    <section
      className="customer-journey-scene"
      onPointerMove={moveScene}
      onPointerLeave={resetScene}
      aria-labelledby="customer-journey-title"
    >
      <div className="customer-scene-volume" aria-hidden="true">
        <HolographicEnergyField
          className="customer-scene-energy-field"
          focusX={0.7}
          focusY={0.53}
          intensity={1.08}
        />
        <span className="customer-scene-halo customer-scene-halo-one" />
        <span className="customer-scene-halo customer-scene-halo-two" />
        <span className="customer-scene-grid" />
        <span className="customer-scene-particle customer-scene-particle-one" />
        <span className="customer-scene-particle customer-scene-particle-two" />
        <span className="customer-scene-particle customer-scene-particle-three" />
        <span className="customer-scene-particle customer-scene-particle-four" />
        <span className="customer-scene-particle customer-scene-particle-five" />
        <span className="customer-scene-particle customer-scene-particle-six" />
        <div className="customer-scene-home">
          <Image
            className="customer-scene-render"
            src="/aea-immersive-home-journey.png"
            alt=""
            width="2048"
            height="1146"
            sizes="(max-width: 720px) 100vw, 55vw"
            priority
          />
        </div>
        <span className="customer-scene-scan" />
        <span className="customer-scene-data customer-scene-data-live">Live home model</span>
        <span className="customer-scene-data customer-scene-data-private">Private by design</span>
        <span className="customer-scene-signal customer-scene-signal-comfort">Comfort</span>
        <span className="customer-scene-signal customer-scene-signal-energy">Energy</span>
        <span className="customer-scene-signal customer-scene-signal-action">Action</span>
      </div>

      <div className="customer-journey-route">
        <h2 id="customer-journey-title" className="customer-route-eyebrow">Your journey</h2>
        <ol>
          {journeyStages.map((stage) => (
            <li key={stage.number}>
              <b>{stage.number}</b>
              <span><strong>{stage.title}</strong><small>{stage.text}</small></span>
            </li>
          ))}
        </ol>
        <p><span aria-hidden="true" /> Private from the first step</p>
      </div>
    </section>
  );
}
