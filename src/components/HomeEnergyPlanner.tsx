"use client";

import { useMemo, useState } from "react";
import { SiteFooter, SiteHeader } from "./ComparatorChrome";
import { createHomeEnergyPlan, homeEnergyPlanOptions } from "@/lib/home-energy-plan.mjs";

export function HomeEnergyPlanner() {
  const [goal, setGoal] = useState("lower-bills");
  const [pace, setPace] = useState("staged");
  const [situation, setSituation] = useState("owner");
  const [features, setFeatures] = useState<string[]>([]);
  const plan = useMemo(() => createHomeEnergyPlan({ goal, pace, situation, features }), [goal, pace, situation, features]);

  function toggleFeature(value: string) {
    setFeatures((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  return <main className="wrap planner-page">
    <SiteHeader active="plan" />
    <header className="planner-hero"><div><span>Your home energy roadmap</span><h1>Work out what to do first</h1><p>Choose the decision, property situation and equipment that apply. The roadmap updates on this device and directs you to the right comparison, guide, assessment or project brief.</p></div><aside><strong>Private by design</strong><p>No account, address, bill, meter identifier or contact details are needed. These choices are not sent anywhere.</p></aside></header>

    <section className="planner-layout" aria-label="Home energy planning tool">
      <form className="planner-controls" onSubmit={(event) => event.preventDefault()}>
        <fieldset><legend><span>1</span>What matters most today?</legend><div className="planner-choice-grid">{homeEnergyPlanOptions.goals.map(([value, label]) => <label className={goal === value ? "selected" : ""} key={value}><input type="radio" name="planner-goal" checked={goal === value} onChange={() => setGoal(value)} /><span>{label}</span></label>)}</div></fieldset>
        <fieldset><legend><span>2</span>What is your property situation?</legend><div className="planner-choice-grid planner-choice-grid-compact">{homeEnergyPlanOptions.situations.map(([value, label]) => <label className={situation === value ? "selected" : ""} key={value}><input type="radio" name="planner-situation" checked={situation === value} onChange={() => setSituation(value)} /><span>{label}</span></label>)}</div></fieldset>
        <fieldset><legend><span>3</span>What is already in the home?</legend><p>Select only what is relevant. Leaving a choice blank is fine.</p><div className="planner-choice-grid">{homeEnergyPlanOptions.features.map(([value, label]) => <label className={features.includes(value) ? "selected" : ""} key={value}><input type="checkbox" checked={features.includes(value)} onChange={() => toggleFeature(value)} /><span>{label}</span></label>)}</div></fieldset>
        <fieldset><legend><span>4</span>How do you want to proceed?</legend><div className="planner-choice-grid planner-choice-grid-compact">{homeEnergyPlanOptions.paces.map(([value, label]) => <label className={pace === value ? "selected" : ""} key={value}><input type="radio" name="planner-pace" checked={pace === value} onChange={() => setPace(value)} /><span>{label}</span></label>)}</div></fieldset>
      </form>

      <section className="planner-results" aria-live="polite" aria-labelledby="planner-results-title"><div className="planner-results-heading"><span>Your ordered roadmap</span><h2 id="planner-results-title">{plan.title}</h2><p>{plan.summary}</p></div><ol>{plan.items.map((item, index) => <li key={item.id}><span className="planner-order">{String(index + 1).padStart(2, "0")}</span><div><small>{item.stage}</small><h3>{item.title}</h3><p>{item.text}</p><a href={item.href}>{item.action}</a></div></li>)}</ol><div className="planner-boundary"><strong>Before committing</strong><p>Replace indicative assumptions with current written quotes, confirm official incentives and approvals, and use licensed professionals for regulated work.</p></div></section>
    </section>
    <SiteFooter>This roadmap is general guidance, not a site assessment, quote, eligibility decision or guarantee of savings. Confirm the property, products, approvals and complete installed scope before committing.</SiteFooter>
  </main>;
}
