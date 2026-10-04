import type { TeamAccess } from "./trade-team-server";
import { tradeHubScope, tradeHubView, type TradeHubContext } from "./trade-customer-hub-server";
import { parseTradeHubAssistDraft, tradeHubAssistSchema } from "./trade-customer-hub-assist";
import { requestWorkflowAi, workflowAiSourceHash } from "./workflow-ai-server";

export async function tradeHubAssistSource(db: D1Database, access: TeamAccess, workOrderId: string) {
  if (!access.canViewQuotes || !access.canManageQuotes) throw new Error("WORKFLOW_AI_FORBIDDEN");
  const view = await tradeHubView(db, access, workOrderId);
  if (!view.available || !view.interested || !view.canAsk || view.workOrderId !== workOrderId) throw new Error("WORKFLOW_AI_FORBIDDEN");
  // Re-read management permission from the current member row, not the earlier access snapshot.
  const scope = tradeHubScope(access, workOrderId, true);
  const current = await db.prepare(scope.sql).bind(...scope.values).first<TradeHubContext>();
  if (!current?.interested || current.work_order_id !== workOrderId) throw new Error("WORKFLOW_AI_FORBIDDEN");
  const job = await db.prepare(`SELECT work.title,detail.description FROM trade_work_orders work
    JOIN trade_crm_job_details detail ON detail.work_order_id=work.id AND detail.firebase_uid=work.firebase_uid
    WHERE work.id=? AND work.firebase_uid=? AND work.record_status='active' AND work.source_type='public_lead'
      AND work.source_reference=? AND detail.customer_source='public_lead_released'`)
    .bind(workOrderId, access.ownerUid, current.match_id).first<{ title: string; description: string }>();
  if (!job) throw new Error("WORKFLOW_AI_FORBIDDEN");
  const questions = (view.questions || []).map(question => ({
    id: question.id, prompt: question.prompt, answer: question.answer, authorType: question.authorType,
    services: question.services, revision: question.revision, closed: question.closed,
    replies: question.replies.map(reply => ({ id: reply.id, body: reply.body, authorType: reply.authorType })),
    // Attachment availability is useful context. Names, paths and bytes are unnecessary.
    attachments: question.files.map(file => ({ id: file.id, type: file.type })),
  }));
  const input = { job: { id: "job", title: job.title, description: job.description }, questions,
    attachmentContentsReviewed: false };
  const sourceHash = await workflowAiSourceHash({ ownerUid: access.ownerUid, workOrderId, interestRevision: current.interest_revision, input });
  const attachmentIds = questions.flatMap(question => question.attachments.map(file => file.id));
  // The file list precedes other awaited reads. A removal during those reads must
  // invalidate the draft even when this is the final source check after generation.
  if (attachmentIds.length) {
    const active = await db.prepare(`SELECT count(*) total FROM customer_hub_files WHERE opportunity_id=? AND removed_at=''
      AND id IN (SELECT value FROM json_each(?))`).bind(current.opportunity_id, JSON.stringify(attachmentIds)).first<{ total: number }>();
    if (active?.total !== attachmentIds.length) throw new Error("WORKFLOW_AI_SOURCE_CHANGED");
  }
  return { input, sourceIds: ["job", ...questions.map(question => question.id)], sourceHash };
}

export async function createTradeHubAssist(db: D1Database, access: TeamAccess, workOrderId: string, requestId: string) {
  const before = await tradeHubAssistSource(db, access, workOrderId);
  const generated = await requestWorkflowAi({ db, actorUid: access.actorUid, scopeUid: access.ownerUid, requestId,
    name: "trade_customer_qa_brief", schema: tradeHubAssistSchema(before.sourceIds), input: before.input,
    instructions: "Prepare a short job brief and draft work scope for an Australian trade business to review. Use only the supplied job and shared questions, answers and replies. Cite each item using supplied source IDs, using job for the job record. Distinguish customer requests from confirmed facts. If information is missing or conflicting, state what needs confirmation instead of making an assumption. Do not invent products, quantities, dates, prices, savings, rebates, legal or regulatory requirements, compliance conclusions or guarantees. Do not claim an attachment was read: only its availability is supplied. Do not identify or compare businesses. No messages will be sent and no quote will be changed. Use clear plain English, short statements, and no em or en dashes." });
  const draft = parseTradeHubAssistDraft(generated, before.sourceIds);
  const after = await tradeHubAssistSource(db, access, workOrderId);
  if (before.sourceHash !== after.sourceHash) throw new Error("WORKFLOW_AI_SOURCE_CHANGED");
  return { ...draft, sourceHash: after.sourceHash };
}
