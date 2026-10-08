"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { useTradeBusiness, useTradeBusinessFetch } from "./TradeBusinessProvider";
import styles from "./TradeTrainingSummary.module.css";

type Module = {
  id: string; title: string; programCode?: string; status: string; assessmentAvailable: boolean;
  assessmentUnavailableReason?: string; completion: null | { reference: string; expiresAt: string };
};
type TrainingSummary = {
  ok: boolean; error?: string; memberId: string; canTakeTraining: boolean; officeOnly?: boolean;
  selectedMember: { memberId: string; isSelf: boolean; isOwner: boolean };
  business: { status: string; approved: boolean; blockedReasons: string[] };
  modules: Module[];
  unavailableActivities: { id: string; title: string; programCode: string; message: string }[];
};
type Snapshot = { actorUid: string; ownerUid: string; expectedMemberId?: string; data: TrainingSummary | null; error: string };

export function TradeTrainingSummary({ user, onOpenTraining }: { user: User; onOpenTraining: () => void }) {
  const fetch = useTradeBusinessFetch();
  const business = useTradeBusiness();
  const ownerUid = business?.ownerUid || user.uid;
  const expectedMemberId = business?.memberId;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Loading your training and setup status took too long. Check your connection, then try again."));
      }, 25000);
    });
    void (async () => {
      try {
        const result = await Promise.race([timeout, (async () => {
          const token = await user.getIdToken();
          if (!active || controller.signal.aborted) return null;
          const response = await fetch("/api/trade-training", {
            headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
          });
          const result = await response.json() as TrainingSummary;
          if (!response.ok || !result.ok) throw new Error(result.error || "Your training and setup status could not be loaded.");
          if (!result.memberId || (expectedMemberId && result.memberId !== expectedMemberId)
            || result.selectedMember?.memberId !== result.memberId
            || result.selectedMember.isSelf !== true || result.canTakeTraining !== true
            || !Array.isArray(result.modules) || !Array.isArray(result.unavailableActivities)
            || !result.business || !Array.isArray(result.business.blockedReasons)) {
            throw new Error("Your own training status could not be confirmed. Refresh and try again.");
          }
          return result;
        })()]);
        if (active && result) setSnapshot({ actorUid: user.uid, ownerUid, expectedMemberId, data: result, error: "" });
      } catch (error) {
        if (active) setSnapshot({ actorUid: user.uid, ownerUid, expectedMemberId, data: null,
          error: error instanceof Error ? error.message : "Your training and setup status could not be loaded." });
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    })();
    return () => { active = false; controller.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, [expectedMemberId, fetch, ownerUid, refresh, user]);

  const current = snapshot?.actorUid === user.uid && snapshot.ownerUid === ownerUid
    && snapshot.expectedMemberId === expectedMemberId ? snapshot : null;
  const data = current?.data;
  const pending = data?.modules.filter(module => module.status !== "passed") || [];
  const passed = data?.modules.filter(module => module.status === "passed").length || 0;
  const unavailable = (data?.modules.filter(module => !module.assessmentAvailable).length || 0) + (data?.unavailableActivities.length || 0);
  const setupStatus = data?.business.approved ? "Setup complete"
    : data?.business.status === "suspended" ? "Setup suspended" : "Finish setup";

  return <section className={styles.panel} aria-label="Your training and Creditex setup">
    <header className={styles.heading}><div><h2>Your training and Creditex setup</h2><p>Required learning and business setup are tracked here separately from the tasks you add below.</p></div>
      <div className={styles.actions}><button type="button" className={styles.primary} onClick={onOpenTraining}>Open my training</button>
        <button type="button" className={styles.secondary} disabled={!current} onClick={() => { setSnapshot(null); setRefresh(value => value + 1); }}>Refresh training</button></div>
    </header>
    {!current && <p role="status">Loading your saved training and setup status...</p>}
    {current?.error && <p role="alert" className={styles.error}>{current.error} <button type="button" className={styles.secondary} onClick={() => { setSnapshot(null); setRefresh(value => value + 1); }}>Try again</button></p>}
    {data && <div className={styles.grid}>
      <article className={styles.card}><h3>My activity training</h3>
        {data.officeOnly ? <><strong>No installation training needed</strong><p>No on-site services are assigned to your Team profile. You can manage eligible work within your permissions; the business and the technician doing the work still need to meet the activity requirements.</p></>
          : <><p className={styles.count}><strong>{pending.length} {pending.length === 1 ? "module" : "modules"} to do</strong><span>{passed} of {data.modules.length} modules passed</span></p>
            {pending.length > 0 && <><p>Open My training to work through your assigned activities.</p><ul className={styles.list}>{pending.slice(0, 3).map(module => <li key={module.id}><strong>{module.title}</strong>{module.programCode && <span>{module.programCode}</span>}<small>{module.assessmentAvailable ? module.status === "expired" ? "Pass expired" : module.status === "revoked" ? "Pass revoked" : "To do" : "Assessment unavailable"}</small></li>)}</ul>{pending.length > 3 && <p>{pending.length - 3} more assigned modules in My training.</p>}</>}
            {!pending.length && data.modules.length > 0 && <p>Your assigned learning passes are current. You can review your saved learning and completion records in My training.</p>}
            {!data.modules.length && !data.unavailableActivities.length && <p>No activity modules match your saved services and service regions. Check Business settings and your Team service selections. An empty list does not approve government program work.</p>}
            {unavailable > 0 && <p>{unavailable} {unavailable === 1 ? "activity assessment is" : "activity assessments are"} unavailable. My training shows the current reasons. These activities remain blocked until their requirements are met.</p>}
            <p className={styles.note}>A learning pass does not replace business setup, insurance, licences or job evidence.</p>
          </>}
      </article>
      <article className={styles.card}><h3>Creditex business setup</h3><strong>{setupStatus}</strong>
        {data.business.approved ? <p>Your saved business setup is complete. Activity training and current compliance requirements still apply.</p>
          : <><p>{data.selectedMember.isOwner ? "Open My training, then Creditex onboarding to finish your business setup." : "The business owner manages Creditex onboarding and private documents. You can view the setup status in My training."}</p>
            {data.business.blockedReasons.length > 0 && <ul>{data.business.blockedReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}</>}
      </article>
    </div>}
  </section>;
}
