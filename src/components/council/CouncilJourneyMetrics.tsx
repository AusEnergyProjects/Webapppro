"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { CouncilApi } from "@/components/CouncilPortal";
import type { CouncilProfile } from "@/lib/council-profile";
import { firebaseAuth } from "@/lib/firebase-client";
import { councilJourneyScopeKey, isCouncilJourneyMetrics, type CouncilJourneyMetrics as JourneyMetrics } from "@/lib/council-journey-metrics";
import { CouncilIcon, CouncilPanel, councilDateTime, councilNumber } from "./CouncilPrimitives";
import styles from "./CouncilJourneyMetrics.module.css";

type CounterState = { identity: string; metrics: JourneyMetrics | null; loading: boolean; error: string };

export function CouncilJourneyMetrics({ profile, user, demonstration, api }: {
  profile: CouncilProfile; user: User | null; demonstration: boolean; api?: CouncilApi;
}) {
  const actorUid = user?.uid ?? "";
  const activeActorUid = firebaseAuth.currentUser?.uid ?? "";
  const identity = JSON.stringify([actorUid, activeActorUid, profile.councilId, profile.state, [...profile.postcodes].sort(),
    profile.publicJourney?.sharePath, profile.publicJourney?.enabled, demonstration]);
  const [state, setState] = useState<CounterState | null>(null);
  const refresh = useRef<(() => void) | null>(null);

  useEffect(() => {
    const request = api;
    if (demonstration || !request || !actorUid) return;
    const fetchMetrics: CouncilApi = request;
    let active = true, inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    function stopTimer() { if (timer !== undefined) clearTimeout(timer); timer = undefined; }
    function schedule() {
      stopTimer();
      if (active && document.visibilityState === "visible") timer = setTimeout(() => { void load(); }, 20_000);
    }
    async function load() {
      if (!active || inFlight || document.visibilityState !== "visible") return;
      stopTimer();
      if (firebaseAuth.currentUser?.uid !== actorUid) {
        setState({ identity, metrics: null, loading: false, error: "Sign in to your council account to view its counters." });
        return;
      }
      inFlight = true;
      controller = new AbortController();
      setState(previous => ({ identity, metrics: previous?.identity === identity ? previous.metrics : null, loading: true, error: "" }));
      try {
        const expectedScopeKey = await councilJourneyScopeKey({ councilId: profile.councilId, state: profile.state, postcodes: profile.postcodes });
        if (!active) return;
        const result = await fetchMetrics<{ metrics: unknown; scopeKey: string }>(`/api/council/journey-metrics?councilId=${encodeURIComponent(profile.councilId)}`, { signal: controller.signal });
        if (!active) return;
        if (firebaseAuth.currentUser?.uid !== actorUid) {
          setState({ identity, metrics: null, loading: false, error: "Sign in to your council account to view its counters." });
          return;
        }
        if (result.scopeKey !== expectedScopeKey) throw new Error("Your council reporting area changed. Refresh the workspace before loading these counters.");
        if (!isCouncilJourneyMetrics(result.metrics)) throw new Error("Council page counters could not be verified. Try refreshing.");
        setState({ identity, metrics: result.metrics, loading: false, error: "" });
      } catch (error) {
        if (active) setState({ identity, metrics: null, loading: false, error: error instanceof Error ? error.message : "Council page counters could not be loaded." });
      } finally {
        inFlight = false;
        if (active && firebaseAuth.currentUser?.uid === actorUid) schedule();
      }
    }
    function visibilityChanged() { if (document.visibilityState === "visible") void load(); else stopTimer(); }
    refresh.current = () => { void load(); };
    document.addEventListener("visibilitychange", visibilityChanged);
    void load();
    return () => {
      active = false; stopTimer(); controller?.abort(); refresh.current = null;
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [actorUid, api, demonstration, identity, profile.councilId, profile.state, profile.postcodes]);

  const visible = state?.identity === identity ? state : null;
  const metrics = demonstration ? { submittedEnquiries: 0, enquiriesQuoted: 0, quotesSent: 0, checkedAt: "" } : visible?.metrics;
  const canLoad = Boolean(api && actorUid && actorUid === activeActorUid);
  const loading = !demonstration && canLoad && (!visible || visible.loading);
  return <CouncilPanel title="Your customer page" subtitle="All-time enquiries and quotes through your council's own page, within your current reporting area."
    action={<button type="button" className={styles.refresh} disabled={demonstration || !canLoad || loading} onClick={() => refresh.current?.()}><CouncilIcon name="refresh" size={17} />{loading ? "Checking…" : "Refresh"}</button>}>
    <div className={styles.cards}>
      <div><span>Enquiries submitted</span><strong>{councilNumber(metrics?.submittedEnquiries)}</strong></div>
      <div><span>Enquiries with a quote</span><strong>{councilNumber(metrics?.enquiriesQuoted)}</strong></div>
      <div><span>Quotes sent</span><strong>{councilNumber(metrics?.quotesSent)}</strong></div>
    </div>
    {demonstration ? <p className={styles.note}>Demonstration only. These counters are inactive and show no actual enquiries or quotes.</p>
      : <><p className={styles.note}>Quotes count once per issued version accepted by the email provider. Re-sending the same version does not add another quote. Acceptance does not confirm arrival in the customer&apos;s inbox.</p>
        {visible?.error && <p role="alert" className={styles.error}>{visible.error}</p>}
        {!canLoad ? <p className={styles.note}>Sign in to your council account to view its counters.</p>
          : visible?.metrics && <p className={styles.checked}>Checked {councilDateTime(visible.metrics.checkedAt)}. Updates every 20 seconds while this tab is visible.</p>}</>}
  </CouncilPanel>;
}
