"use client";

import { lazy, Suspense } from "react";
import { usePathname } from "next/navigation";
import { wattzunPortalForPath } from "@/lib/wattzun-portal-path";
const DeferredWattzunPortalAssistant = lazy(() => import("./WattzunPortalAssistant").then((module) => ({ default: module.WattzunPortalAssistant })));
const DeferredPublicEnergyAssistantWidget = lazy(() => import("./LazyPublicEnergyAssistantWidget").then((module) => ({ default: module.LazyPublicEnergyAssistantWidget })));

const hiddenRoute = (pathname: string) => /\/(print|pdf|reset-password|customer-hub|council)(\/|$)/.test(pathname);

export function LazyEnergyAssistantWidget() {
  const pathname = usePathname() || "/";
  const portal = wattzunPortalForPath(pathname);
  if (portal) return <Suspense fallback={null}><DeferredWattzunPortalAssistant key={portal} portal={portal} /></Suspense>;

  if (hiddenRoute(pathname)) return null;

  return <Suspense fallback={null}><DeferredPublicEnergyAssistantWidget /></Suspense>;
}
