"use client";

import { lazy, Suspense, useState } from "react";
import { usePathname } from "next/navigation";
import styles from "./LazyEnergyAssistantWidget.module.css";

function loadEnergyAssistant() {
  return import("./EnergyAssistantWidget").then((module) => ({ default: module.EnergyAssistantWidget }));
}

const DeferredEnergyAssistantWidget = lazy(loadEnergyAssistant);
const DeferredEnergyAssistantLauncher = lazy(() => import("./EnergyAssistantLauncher").then((module) => ({ default: module.EnergyAssistantLauncher })));

function QuickChatLoader() {
  return <div className={styles.root} data-surge-loader role="status" aria-label="Opening Wattzun AI chat">
    <span className={styles.launcher}><span className={styles.mascot} aria-hidden="true" /></span>
  </div>;
}

export function LazyPublicEnergyAssistantWidget() {
  const pathname = usePathname() || "/";
  const dedicated = pathname === "/wattzun";
  const [quickChatMounted, setQuickChatMounted] = useState(false);
  if (dedicated || quickChatMounted) {
    return <Suspense fallback={dedicated ? <div className={styles.dedicatedLoading} role="status">Loading Wattzun AI...</div> : <QuickChatLoader />}>
      <DeferredEnergyAssistantWidget initialOpen={!dedicated} />
    </Suspense>;
  }
  return <Suspense fallback={<QuickChatLoader />}>
    <DeferredEnergyAssistantLauncher onPreload={loadEnergyAssistant} onOpen={() => setQuickChatMounted(true)} />
  </Suspense>;
}
