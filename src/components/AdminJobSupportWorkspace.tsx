"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { User } from "firebase/auth";
import type { AdminJobRow } from "@/lib/admin-job-register";
import type { CrmDetailResult } from "./InstallerCrmWorkspace";
import type { TradeTeamPermissions } from "./TradeTeamSettings";
import { TradeReadOnlySupportProvider, useTradeBusinessFetch } from "./TradeBusinessProvider";
import styles from "./AdminJobSupportWorkspace.module.css";

const JobDetail = dynamic(() => import("./InstallerCrmWorkspace").then(module => module.JobDetail), {
  loading: () => <p role="status">Opening the job workspace...</p>,
});

const supportPermissions: TradeTeamPermissions = {
  jobScope: "team", scheduleScope: "team", canViewCustomers: true,
  canViewQuotes: true, canViewInvoices: true, canViewFieldEvidence: true,
  canCreateJobs: false, canManageJobs: false, canAssignJobs: false,
  canManageCustomers: false, canSearchCustomers: false, canViewLeads: false,
  canManageLeads: false, canManageQuotes: false, canSendQuotes: false,
  canSendSms: false, canReceiveCustomerQaNotifications: false,
  canApplyDiscounts: false, canManageInvoices: false, canViewPriceBook: false,
  canManagePriceBook: false, canRescheduleJobs: false, canManageTeam: false,
  canEditTeamPermissions: false, canManageFieldEvidence: false,
  canManageForms: false, canRunReports: false,
};

type Props = { user: User; job: AdminJobRow; onBack: () => void };

export function AdminJobSupportWorkspace(props: Props) {
  return <TradeReadOnlySupportProvider key={`${props.user.uid}:${props.job.id}`} workOrderId={props.job.id}>
    <SupportJob {...props} />
  </TradeReadOnlySupportProvider>;
}

function SupportJob({ user, job, onBack }: Props) {
  const request = useTradeBusinessFetch();
  const [result, setResult] = useState<CrmDetailResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const active = useRef(true);
  const generation = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const load = useCallback(async () => {
    const version = ++generation.current;
    setLoading(true); setError("");
    try {
      const token = await user.getIdToken();
      if (!active.current || version !== generation.current) return;
      const response = await request(`/api/trade-crm?mode=detail&resource=job&id=${encodeURIComponent(job.id)}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      const payload = await response.json() as CrmDetailResult;
      if (!response.ok || !payload.ok || payload.job?.id !== job.id) throw new Error(payload.error || "The full job could not be loaded.");
      if (active.current && version === generation.current) { setResult(payload); setRevision(value => value + 1); }
    } catch (cause) {
      if (active.current && version === generation.current) {
        setResult(null); setError(cause instanceof Error ? cause.message : "The full job could not be loaded.");
      }
    } finally { if (active.current && version === generation.current) setLoading(false); }
  }, [job.id, request, user]);
  useEffect(() => {
    active.current = true; generation.current++; heading.current?.focus();
    const frame = window.requestAnimationFrame(() => void load());
    return () => { active.current = false; window.cancelAnimationFrame(frame); };
  }, [load]);
  const unavailable = () => { throw new Error("This support view is read only."); };
  const blockMutation = async () => { throw new Error("This support view is read only."); };

  return <section className={styles.workspace} aria-labelledby="admin-support-job-title">
    <header className={styles.heading}>
      <div><span>Job support</span><h1 id="admin-support-job-title" ref={heading} tabIndex={-1}>{job.workNumber}</h1><p>{job.installerBusiness}</p></div>
      <div className={styles.actions}><button type="button" onClick={onBack}>Back to jobs</button><button type="button" onClick={() => void load()} disabled={loading}>Refresh job</button></div>
    </header>
    <p className={styles.notice}>Viewing the business&apos;s saved job records. This support view is read only and access is recorded against your admin account.</p>
    {loading ? <p role="status">Loading job details...</p> : error ? <div role="alert" className={styles.error}><strong>The job could not be opened</strong><p>{error}</p><button type="button" onClick={() => void load()}>Try again</button></div> : result?.job &&
      <JobDetail key={`${job.id}:${revision}`} job={result.job} customer={result.customer || undefined} sites={result.sites || []}
        user={user} busy="" teamMembers={[]} permissions={supportPermissions} supportReadOnly
        onSalesOutcome={unavailable} onEditPayment={unavailable} onCrm={blockMutation} onWorkOrder={blockMutation}
        onOpenJob={unavailable} onOpenPriceBook={unavailable} onOpenCustomer={unavailable} onOpenIntegrations={unavailable} onReload={load} />}
  </section>;
}
