"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

const OVERFLOW_TOLERANCE_PX = 1;

export function ResponsiveSiteNav({ children }: { children: ReactNode }) {
  const navRef = useRef<HTMLElement>(null);
  const [hasHiddenOptions, setHasHiddenOptions] = useState(false);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    let disposed = false;
    const updateOverflowState = () => {
      if (disposed) return;
      const remainingOverflow = nav.scrollWidth - nav.clientWidth - nav.scrollLeft;
      const nextHasHiddenOptions = remainingOverflow > OVERFLOW_TOLERANCE_PX;
      setHasHiddenOptions((current) => current === nextHasHiddenOptions ? current : nextHasHiddenOptions);
    };

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateOverflowState);
    const observeSizes = () => {
      resizeObserver?.observe(nav);
      Array.from(nav.children).forEach((child) => resizeObserver?.observe(child));
    };
    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(() => {
          observeSizes();
          updateOverflowState();
        });

    observeSizes();
    mutationObserver?.observe(nav, { childList: true, characterData: true, subtree: true });
    nav.addEventListener("scroll", updateOverflowState, { passive: true });
    window.addEventListener("resize", updateOverflowState);
    void document.fonts?.ready.then(updateOverflowState);
    updateOverflowState();

    return () => {
      disposed = true;
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      nav.removeEventListener("scroll", updateOverflowState);
      window.removeEventListener("resize", updateOverflowState);
    };
  }, []);

  return (
    <div className={`site-nav-shell${hasHiddenOptions ? " has-hidden-options" : ""}`}>
      {hasHiddenOptions ? (
        <div className="site-nav-discovery" id="site-nav-discovery">
          <span>Energy services</span>
          <span>Scroll for more options <span aria-hidden="true">&#8594;</span></span>
        </div>
      ) : null}
      <nav
        aria-describedby={hasHiddenOptions ? "site-nav-discovery" : undefined}
        aria-label="Energy services"
        className="comparator-nav"
        ref={navRef}
      >
        {children}
      </nav>
    </div>
  );
}
