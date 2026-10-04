"use client";

import { lazy, Suspense, type ComponentProps } from "react";

const CouncilPortal = lazy(() => import("./CouncilPortal").then((module) => ({ default: module.CouncilPortal })));
const CouncilProgram = lazy(() => import("./CouncilProgram").then((module) => ({ default: module.CouncilProgram })));

function CouncilLoading() {
  return <main id="site-content" aria-busy="true"><p role="status">Loading TLink council workspace...</p></main>;
}

export function CouncilPortalEntry(props: ComponentProps<typeof CouncilPortal>) {
  return <Suspense fallback={<CouncilLoading />}><CouncilPortal {...props} /></Suspense>;
}

export function CouncilProgramEntry(props: ComponentProps<typeof CouncilProgram>) {
  return <Suspense fallback={<CouncilLoading />}><CouncilProgram {...props} /></Suspense>;
}
