import { verifiedTradeAccountPredicate } from "@/lib/trade-access-server";
import type { AuthorisedTradeQuoteDecisionLink } from "./trade-quote-decision-server";
import type { TradeQuoteQuestionPayload } from "./trade-quote-review-server";

/** Receipts remain available under their existing rules; new communication requires current business and job access. */
export function quoteQuestionScope(link: AuthorisedTradeQuoteDecisionLink, now: string) {
  return {
    sql: `FROM trade_crm_quote_links link
      JOIN trade_crm_quote_versions version ON version.id=link.quote_version_id AND version.quote_id=link.quote_id AND version.firebase_uid=link.firebase_uid
      JOIN trade_crm_quotes quote ON quote.id=link.quote_id AND quote.firebase_uid=link.firebase_uid AND quote.work_order_id=link.work_order_id AND quote.crm_customer_id=link.crm_customer_id
      JOIN trade_work_orders work ON work.id=link.work_order_id AND work.firebase_uid=link.firebase_uid AND work.record_status='active'
      JOIN trade_crm_job_details detail ON detail.work_order_id=work.id AND detail.firebase_uid=work.firebase_uid AND detail.crm_customer_id=link.crm_customer_id
        AND detail.customer_source IN ('trade_owned','public_lead_released')
      JOIN trade_accounts trade ON trade.firebase_uid=link.firebase_uid AND trade.partner_type='installer' AND ${verifiedTradeAccountPredicate("trade")}
      WHERE link.id=? AND link.quote_id=? AND link.quote_version_id=? AND link.work_order_id=? AND link.firebase_uid=? AND link.crm_customer_id=?
        AND link.token_issue=? AND link.token_hash=? AND link.token_hash<>'' AND link.revoked_at='' AND link.expires_at>?
        AND ((link.status='active' AND version.status='issued' AND quote.current_version_number=version.version_number AND (version.valid_until='' OR version.valid_until>=?))
          OR (link.status='accepted' AND version.status='accepted' AND EXISTS (
            SELECT 1 FROM trade_crm_quote_acceptances acceptance WHERE acceptance.quote_link_id=link.id
              AND acceptance.quote_id=link.quote_id AND acceptance.quote_version_id=link.quote_version_id
              AND acceptance.work_order_id=link.work_order_id AND acceptance.firebase_uid=link.firebase_uid
              AND acceptance.token_issue=link.token_issue AND acceptance.decision='accepted')))` ,
    bindings: [link.id, link.quote_id, link.quote_version_id, link.work_order_id, link.firebase_uid, link.crm_customer_id,
      link.token_issue, link.token_hash, now, now.slice(0, 10)],
  };
}

export async function quoteConversationForLink(db: D1Database, link: AuthorisedTradeQuoteDecisionLink): Promise<{ questions: TradeQuoteQuestionPayload[] } | null> {
  if (link.status !== "active" && link.status !== "accepted") return null;
  const scope = quoteQuestionScope(link, new Date().toISOString());
  if (!await db.prepare(`SELECT link.id ${scope.sql}`).bind(...scope.bindings).first()) return null;
  const questions = await db.prepare(`SELECT id,question,answer,status,asked_at,answered_at FROM trade_crm_quote_questions
    WHERE quote_version_id=? AND firebase_uid=? AND work_order_id=? AND EXISTS (SELECT 1 ${scope.sql}) ORDER BY asked_at,id`)
    .bind(link.quote_version_id, link.firebase_uid, link.work_order_id, ...scope.bindings).all<Record<string, unknown>>();
  return { questions: questions.results.map((row) => ({ id: String(row.id), question: String(row.question), answer: String(row.answer),
    status: String(row.status), askedAt: String(row.asked_at), answeredAt: String(row.answered_at) })) };
}
