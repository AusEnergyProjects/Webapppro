"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

function internalUrl(anchor: HTMLAnchorElement): URL | null {
  if (anchor.target && anchor.target !== "_self") return null;
  if (anchor.hasAttribute("download") || anchor.dataset.nativeNavigation === "true") return null;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return null;
  return url;
}

function anchorFromTarget(target: EventTarget | null): HTMLAnchorElement | null {
  return target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
}

export function FastNavigation() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    document.documentElement.classList.remove("route-loading");
  }, [pathname]);

  useEffect(() => {
    const prefetch = (event: PointerEvent | FocusEvent) => {
      const anchor = anchorFromTarget(event.target);
      if (!anchor) return;
      const url = internalUrl(anchor);
      if (!url || url.pathname === window.location.pathname) return;
      router.prefetch(`${url.pathname}${url.search}`);
    };

    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = anchorFromTarget(event.target);
      if (!anchor) return;
      const url = internalUrl(anchor);
      if (!url) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      document.documentElement.classList.add("route-loading");
      router.push(`${url.pathname}${url.search}${url.hash}`);
      window.setTimeout(() => document.documentElement.classList.remove("route-loading"), 5000);
    };

    document.addEventListener("pointerover", prefetch, { passive: true });
    document.addEventListener("focusin", prefetch);
    document.addEventListener("click", navigate);
    return () => {
      document.removeEventListener("pointerover", prefetch);
      document.removeEventListener("focusin", prefetch);
      document.removeEventListener("click", navigate);
    };
  }, [router]);

  return null;
}
