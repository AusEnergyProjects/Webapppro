"use client";

import { useState } from "react";
import { ENERGY_SERVICE_CATALOGUE } from "@/lib/energy-service-catalogue.mjs";
import { trainingServiceSection } from "@/lib/training-service-sections.mjs";
import styles from "./TrainingServiceGuide.module.css";

type Course = { id: string; title: string; serviceCategory?: string; trainingSection?: string; activityTemplateIds: string[]; programCode?: string; kind?: string; jurisdictions?: string[]; status: string; assessmentAvailable: boolean; assessmentUnavailableReason?: string };
type Unavailable = { id: string; title: string; serviceCategory: string; programCode: string; message: string };

export function TrainingServiceGuide<T extends Course>({ services, states, modules, unavailable, busy, onOpen }: {
  services: string[]; states: string[]; modules: T[]; unavailable: Unavailable[]; busy: boolean; onOpen: (module: T) => void;
}) {
  const [choice, setChoice] = useState("");
  const assigned = ENERGY_SERVICE_CATALOGUE.filter(service => services.includes(service.id));
  const selected = assigned.find(service => service.id === choice) || assigned.find(service => modules.some(module => module.serviceCategory === service.id && module.status !== "passed")) || assigned[0];
  const courses = modules.filter(module => module.serviceCategory === selected?.id);
  const missing = unavailable.filter(module => module.serviceCategory === selected?.id);
  return <section className={styles.guide} aria-label="Training needed for your services">
    <header><h3>Training needed for your services</h3><p>Choose the work you do. The modules below cover your saved regions: {states.join(", ") || "none selected"}, plus relevant national programs.</p></header>
    <div className={styles.services} role="group" aria-label="Your services">{assigned.map(service => {
      const list = modules.filter(module => module.serviceCategory === service.id);
      const todo = list.filter(module => module.status !== "passed").length;
      const notAvailable = list.filter(module => !module.assessmentAvailable).length + unavailable.filter(module => module.serviceCategory === service.id).length;
      return <button type="button" key={service.id} aria-pressed={selected?.id === service.id} onClick={() => setChoice(service.id)}><strong>{service.label}</strong><small>{todo ? `${todo} to complete` : list.length ? "✓ Training passed" : "No modules assigned"}{notAvailable ? ` · ${notAvailable} unavailable` : ""}</small></button>;
    })}</div>
    {selected && <div className={styles.requirements}><h4>{selected.label}</h4><p>Complete the module for the government activity used on the job before carrying out that work. You do not need every activity in this service for every job.</p>
      {courses.map(module => <article key={module.id}><div><small>{selected.id === "other" ? `${trainingServiceSection(module).label} · ` : ""}{module.programCode} · {module.jurisdictions?.map(state => state === "AU" ? "Australia wide" : state).join(", ") || states.join(", ")}</small><strong>{module.title}</strong><span>{module.kind === "additional" ? "Additional training required for this service in the listed regions." : `Required for ${selected.label.toLowerCase()} jobs using ${module.activityTemplateIds.join(", ") || module.title}.`}</span>{!module.assessmentAvailable && <span>Currently unavailable. {module.assessmentUnavailableReason || "This activity cannot currently be booked."}</span>}</div><div className={styles.action}><span>{module.status === "passed" ? "✓ Passed" : module.assessmentAvailable ? "To complete" : "Assessment unavailable"}</span><button type="button" disabled={busy} onClick={() => onOpen(module)}>{module.status === "passed" ? "Review" : module.assessmentAvailable ? "Start / continue" : "View requirements"}</button></div></article>)}
      {missing.map(module => <article key={module.id}><div><strong>{module.title}</strong><span>{module.message}</span></div><span>Unavailable</span></article>)}
      {!courses.length && !missing.length && <p>No government activity training is assigned for this service in your regions. Any required licences, qualifications and job evidence still apply.</p>}
      <p className={styles.note}>Training does not stop incoming TLink leads. If a program booking needs training, the booking screen will name the module to complete. Office staff do not repeat the technician&apos;s training.</p>
    </div>}
  </section>;
}
