import type { WattzunAccess } from "./wattzun-portal-access-server";
import { assignedJob, requireInstallerTeamAccess, type TeamAccess } from "./trade-team-server";
import { tradeHubAssistSource } from "./trade-customer-hub-assist-server";
import { wattzunJobHref } from "./wattzun-records";
import { workflowAiSourceHash } from "./workflow-ai-server";
import { FirebaseMfaRequiredError } from "./firebase-mfa";
import { TradeAccessError } from "./trade-access-server";
import { TradeBusinessContextError } from "./trade-business-context-server";
import { WattzunWorkContextError, type WattzunWorkContext, type WattzunWorkReference } from "./wattzun-work-context";

const MAX_CONTEXT_BYTES = 24_000;
type TradeJobReference = Extract<WattzunWorkReference, { kind: "trade_job" }>;
type JobAuthority = Awaited<ReturnType<typeof assignedJob>>;
type LocalJob = {
  id: string; work_number: string; title: string; description: string | null;
  service_category: string; stage: string; revision: number;
};
type JobTask = { id: string; title: string; status: string; due_at: string; completed_at: string; revision: number };

function authority(team: TeamAccess, job: JobAuthority) {
  return { ownerUid: team.ownerUid, actorUid: team.actorUid, memberId: team.memberId,
    isOwner: team.isOwner, jobScope: team.jobScope,
    ...(job.customer_source === "public_lead_released" ? { canViewQuotes: team.canViewQuotes, canManageQuotes: team.canManageQuotes } : {}),
    job: { id: job.id, sourceType: job.source_type, sourceReference: job.source_reference,
      customerSource: job.customer_source, assigneeMemberId: job.assignee_member_id, revision: job.revision } };
}

async function currentJob(request: Request, access: WattzunAccess, reference: TradeJobReference) {
  if (access.scope.portal !== "trade" || reference.kind !== "trade_job" || !/^[A-Za-z0-9:_-]{1,180}$/.test(reference.recordId)) {
    throw new WattzunWorkContextError(403, "Choose an accessible TLink job before asking Wattzun about its records.");
  }
  const headers = new Headers(request.headers);
  headers.set("X-TLink-Business", access.scope.scopeId);
  const team = await requireInstallerTeamAccess(new Request(request.url, { headers }));
  if (team.ownerUid !== access.scope.scopeId || team.actorUid !== access.actorUid) {
    throw new WattzunWorkContextError(403, "Your TLink workspace changed. Reopen the job before asking Wattzun.");
  }
  const job = await assignedJob(team, reference.recordId);
  if (job.source_type === "opportunity" || !["trade_owned", "internal", "public_lead_released"].includes(job.customer_source)) {
    throw new WattzunWorkContextError(403, "Wattzun cannot load records from this protected job.");
  }
  // Released lead provenance is retained by CRM updates. Inconsistent flags must
  // not move a shared enquiry into the local-job branch and bypass its consent check.
  if ((job.source_type === "public_lead") !== (job.customer_source === "public_lead_released")) {
    throw new WattzunWorkContextError(403, "This job's source access could not be verified. Reopen its authorised workspace.");
  }
  return { team, job };
}

function jobDestination(team: TeamAccess, id: string) {
  const href = wattzunJobHref(id, "job");
  return team.isOwner ? href : href.replace("/direct-trade/dashboard?", "/direct-trade/team?");
}

/** Supply only the selected job's operational projection, never the whole CRM response. */
export async function loadWattzunTradeContext(request: Request, access: WattzunAccess,
  reference: TradeJobReference): Promise<WattzunWorkContext> {
  try {
    const before = await currentJob(request, access, reference);
    const href = jobDestination(before.team, reference.recordId);
    const sources: WattzunWorkContext["sources"] = [];
    let facts: unknown;
    let title: string;
    let projectionHash: string;
    const limitations = [
      "This is read-only context for the selected job. It cannot save, send, schedule, change a quote or mark work complete.",
      "Customer contacts, street addresses, private notes, imported source records and financial figures have not been loaded.",
      "Uploaded file contents, photos, signatures, form answers and compliance evidence have not been inspected. Missing information is unknown, not evidence that work is complete.",
    ];
    if (before.job.customer_source === "public_lead_released") {
      const shared = await tradeHubAssistSource(access.db, before.team, reference.recordId);
      title = shared.input.job.title;
      facts = { jobSourceId: "trade_job_overview", questionsSourceId: "trade_job_questions", ...shared.input };
      projectionHash = shared.sourceHash;
      sources.push(
        { id: "trade_job_overview", label: "Job details", href, description: "The selected customer-authorised job title and recorded scope." },
        { id: "trade_job_questions", label: "Shared customer Q&A", href, description: "Currently authorised shared questions, answers and replies. Open the job's Customer Q&A to review. Attachment availability only; file contents were not read." },
      );
      limitations.push("Shared customer statements are requests or reported facts, not independently verified observations. This context does not contain the job checklist or diary.");
    } else {
      const job = await access.db.prepare(`SELECT work.id, work.work_number, work.title, detail.description,
          work.service_category, work.stage, work.revision
        FROM trade_work_orders work
        LEFT JOIN trade_crm_job_details detail ON detail.work_order_id=work.id AND detail.firebase_uid=work.firebase_uid
        WHERE work.id=? AND work.firebase_uid=? AND work.partner_type='installer' AND work.record_status='active'
          AND work.source_type<>'opportunity' AND detail.customer_source IN ('trade_owned','internal')`)
        .bind(reference.recordId, before.team.ownerUid).first<LocalJob>();
      if (!job) throw new WattzunWorkContextError(403, "This TLink job is no longer available to Wattzun.");
      // The existing job detail grants its checklist to the same assigned-job scope.
      // Fetch one beyond the existing 50-item limit so incomplete coverage is rejected.
      const tasks = await access.db.prepare(`SELECT id,title,status,due_at,completed_at,revision
        FROM trade_work_order_tasks WHERE work_order_id=? AND firebase_uid=?
        ORDER BY sort_order,created_at,id LIMIT 51`).bind(reference.recordId, before.team.ownerUid).all<JobTask>();
      if (tasks.results.length > 50) throw new WattzunWorkContextError(413, "This job checklist is too large for Wattzun. Review its tasks directly.");
      title = job.title;
      facts = {
        job: { sourceId: "trade_job_overview", workNumber: job.work_number, title: job.title,
          description: job.description || "", serviceCategory: job.service_category, operationalStage: job.stage },
        checklist: { sourceId: "trade_job_tasks", tasks: tasks.results.map(task => ({ id: task.id, title: task.title,
          status: task.status, dueAt: task.due_at, completedAt: task.completed_at })) },
      };
      projectionHash = await workflowAiSourceHash({ job, tasks: tasks.results });
      sources.push(
        { id: "trade_job_overview", label: "Job overview", href, description: "Recorded title, work category, operational stage and scope of this job." },
        { id: "trade_job_tasks", label: "Job checklist", href, description: "The currently saved job checklist and recorded task states. Open More, Tasks in the job to review. Recorded completion is not an inspection or approval." },
      );
      limitations.push("The job's notes, customer messages, schedule, quotes and invoices have not been loaded. A checklist tick or operational stage is not compliance approval.");
    }
    const after = await currentJob(request, access, reference);
    if (JSON.stringify(authority(before.team, before.job)) !== JSON.stringify(authority(after.team, after.job))) {
      throw new WattzunWorkContextError(409, "The job or your TLink access changed. Reopen the job before asking Wattzun again.");
    }
    if (!title.trim() || title.length > 240) {
      throw new WattzunWorkContextError(503, "This job's title could not be verified. Reopen the job before asking Wattzun.");
    }
    const context: WattzunWorkContext = {
      reference: { kind: "trade_job", recordId: reference.recordId }, title, sources, facts, limitations,
      sourceSha256: "0".repeat(64),
    };
    if (new TextEncoder().encode(JSON.stringify(context)).byteLength > MAX_CONTEXT_BYTES) {
      throw new WattzunWorkContextError(413, "This job has too much information for one Wattzun request. Review its records directly.");
    }
    context.sourceSha256 = await workflowAiSourceHash({ reference: context.reference,
      authority: authority(after.team, after.job), projectionHash, facts });
    return context;
  } catch (error) {
    if (error instanceof WattzunWorkContextError) throw error;
    // Retain the portal's existing authentication, selected-business and MFA recovery.
    if (error instanceof FirebaseMfaRequiredError || error instanceof TradeAccessError || error instanceof TradeBusinessContextError) throw error;
    const code = error instanceof Error ? error.message : "";
    if (code === "WORKFLOW_AI_SOURCE_CHANGED") throw new WattzunWorkContextError(409, "The shared job records changed. Reopen Customer Q&A before asking Wattzun again.");
    if (/^(?:WORKFLOW_AI_FORBIDDEN|JOB_NOT_FOUND|JOB_NOT_ASSIGNED|AUTH_REQUIRED|EMAIL_VERIFICATION_REQUIRED|TEAM_ACCESS_RECORD_REQUIRED|ABN_REVIEW_REQUIRED)$/.test(code)) {
      throw new WattzunWorkContextError(403, "Current access to this TLink job is required. Reopen the job before asking Wattzun.");
    }
    throw new WattzunWorkContextError(503, "This job's current records could not be loaded. Try again from the job workspace.");
  }
}
