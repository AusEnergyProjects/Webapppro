/* eslint-disable @next/next/no-img-element -- This fixed local transparent mascot must keep its exact silhouette inside the compact header control. */

export function SurgeHeaderButton({ active = false }: { active?: boolean }) {
  return (
    <a
      aria-label="Open Surge AI energy guide"
      aria-current={active ? "page" : undefined}
      className={`site-surge-link${active ? " active" : ""}`}
      href="/surge"
    >
      <span className="site-surge-core" aria-hidden="true">
        <img src="/surge-mascot.png" alt="" width="28" height="35" decoding="async" />
      </span>
      <span className="site-surge-copy">
        <strong>Surge AI</strong>
        <small>Energy upgrade guide</small>
      </span>
      <span className="site-surge-status" aria-hidden="true">AI guide</span>
    </a>
  );
}
