import { type ReactNode } from "react";

export function ResponsiveSiteNav({ children }: { children: ReactNode }) {
  return (
    <div className="site-nav-shell">
      <nav aria-label="Primary navigation" className="comparator-nav">
        {children}
      </nav>
      <span className="site-nav-scroll-cue" aria-hidden="true">Swipe <b>&rsaquo;</b></span>
    </div>
  );
}
