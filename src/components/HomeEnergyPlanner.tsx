"use client";

import { useMemo, useState } from "react";
import { createHomeEnergyPlan, homeEnergyPlanOptions } from "@/lib/home-energy-plan.mjs";

type InitialPlannerSelection = { goal: string; pace: string; situation: string; features: string[] };

export function HomeEnergyPlanner({ initialSelection }: { initialSelection?: InitialPlannerSelection }) {
  const [goal, setGoal] = useState(initialSelection?.goal ?? "lower-bills");
  const [pace, setPace] = useState(initialSelection?.pace ?? "staged");
  const [situation, setSituation] = useState(initialSelection?.situation ?? "owner");
  const [features, setFeatures] = useState<string[]>(initialSelection?.features ?? []);
  const plan = useMemo(() => createHomeEnergyPlan({ goal, pace, situation, features }), [goal, pace, situation, features]);
  const printableHref = useMemo(() => {
    const params = new URLSearchParams({ goal, pace, situation });
    features.forEach((feature) => params.append("feature", feature));
    return `/plan/print?${params.toString()}`;
  }, [goal, pace, situation, features]);

  function toggleFeature(value: string) {
    setFeatures((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  function resetPlan() {
    setGoal("lower-bills");
    setPace("staged");
    setSituation("owner");
    setFeatures([]);
  }

  return <section className="planner-layout" aria-label="Home energy planning tool">
      <form className="planner-controls" onSubmit={(event) => event.preventDefault()}>
        <fieldset><legend><span>1</span>What matters most today?</legend><div className="planner-choice-grid">{homeEnergyPlanOptions.goals.map(([value, label]) => <label className={goal === value ? "selected" : ""} key={value}><input type="radio" name="planner-goal" checked={goal === value} onChange={() => setGoal(value)} /><span>{label}</span></label>)}</div></fieldset>
        <fieldset><legend><span>2</span>What is your property situation?</legend><div className="planner-choice-grid planner-choice-grid-compact">{homeEnergyPlanOptions.situations.map(([value, label]) => <label className={situation === value ? "selected" : ""} key={value}><input type="radio" name="planner-situation" checked={situation === value} onChange={() => setSituation(value)} /><span>{label}</span></label>)}</div></fieldset>
        <fieldset><legend><span>3</span>What is already in the home?</legend><p>Select only what is relevant. Leaving a choice blank is fine.</p><div className="planner-choice-grid">{homeEnergyPlanOptions.features.map(([value, label]) => <label className={features.includes(value) ? "selected" : ""} key={value}><input type="checkbox" checked={features.includes(value)} onChange={() => toggleFeature(value)} /><span>{label}</span></label>)}</div></fieldset>
        <fieldset><legend><span>4</span>How do you want to proceed?</legend><div className="planner-choice-grid planner-choice-grid-compact">{homeEnergyPlanOptions.paces.map(([value, label]) => <label className={pace === value ? "selected" : ""} key={value}><input type="radio" name="planner-pace" checked={pace === value} onChange={() => setPace(value)} /><span>{label}</span></label>)}</div></fieldset>
      </form>

      <section className="planner-results" aria-live="polite" aria-labelledby="planner-results-title"><div className="planner-results-heading"><span>Your ordered roadmap</span><h2 id="planner-results-title">{plan.title}</h2><p>{plan.summary}</p></div><div className="planner-result-actions"><a href={printableHref}>Open fast print view</a><button type="button" className="planner-reset" onClick={resetPlan}>Start over</button></div><ol>{plan.items.map((item, index) => <li key={item.id}><span className="planner-order">{String(index + 1).padStart(2, "0")}</span><div><small>{item.stage}</small><h3>{item.title}</h3><p>{item.text}</p><a href={item.href}>{item.action}</a></div></li>)}</ol><div className="planner-boundary"><strong>Before committing</strong><p>Replace indicative assumptions with current written quotes, confirm official incentives and approvals, and use licensed professionals for regulated work.</p></div></section>
    </section>;
}
