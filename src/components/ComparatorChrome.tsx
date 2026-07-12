import Link from "next/link";
import { ReactNode } from "react";

export function BrandBar() {
  return (
    <Link href="/" className="brandbar">
      <span className="brandmark" aria-hidden="true">
        <span className="brandmark-inner">
          <span className="brandmark-center" />
        </span>
      </span>
      <span className="brandtext">
        <strong className="brandname">Australian Energy Assessments</strong>
        <span className="brandtag">Independent energy assessments</span>
      </span>
    </Link>
  );
}

export function ComparatorHero({ title, children }: { title: string; children: ReactNode }) {
  return (
    <header className="hero">
      <h1>{title}</h1>
      {children}
    </header>
  );
}

export function StepCard({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2>
        <span className="stepnum">{number}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Field({ label, optional, hint, children }: { label: string; optional?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="f">
      {label} {optional && <span className="opt">{optional}</span>}
      <span className="field-control">{children}</span>
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export const inputClass = "";
