import type { WattzunPortal } from "./wattzun-portal";

// This small route boundary is eager in the public launcher. Voice contracts stay deferred.
export function wattzunPortalForPath(pathname: string): WattzunPortal | null {
  if (/^\/direct-trade\/(dashboard|team|messages)\/?$/.test(pathname)) return "trade";
  if (/^\/creditex\/compliance\/?$/.test(pathname)) return "creditex";
  if (/^\/council\/?$/.test(pathname)) return "council";
  return null;
}
