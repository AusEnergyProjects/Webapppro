/* eslint-disable @next/next/no-img-element -- This fixed local transparent mascot must keep its exact silhouette inside the compact header control. */

import Link from "next/link";

export function SurgeHeaderButton({ active = false }: { active?: boolean }) {
  return (
    <Link
      aria-label="Open Wattzun AI energy guide"
      aria-current={active ? "page" : undefined}
      className={`site-surge-link${active ? " active" : ""}`}
      href="/wattzun"
      prefetch={false}
    >
      <span className="site-surge-core" aria-hidden="true">
        <img src="/surge-mascot.webp" alt="" width="28" height="35" decoding="async" />
      </span>
      <span className="site-surge-copy">
        <strong>Wattzun AI</strong>
      </span>
    </Link>
  );
}
