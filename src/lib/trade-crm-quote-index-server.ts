import { jobMemberSql } from "./trade-job-collaboration.ts";
import { JOB_REGISTER_CUSTOMER_CONTEXT_SQL, protectedJobCustomerText } from "./trade-crm-job-register.ts";
import { decodeKeysetCursor, encodeKeysetCursor, keysetAfter } from "./keyset-pagination.ts";
import { tradeQuoteDeliveryPresentation } from "./trade-quote-delivery-policy.mjs";
import { TRADE_QUOTE_VIEWS, type TradeQuoteIndex, type TradeQuoteIndexItem, type TradeQuoteView } from "./trade-crm-quote-index.ts";
import type { TeamAccess } from "./trade-team-server";

type QuoteAccess = Pick<TeamAccess, "ownerUid" | "memberId" | "isOwner" | "jobScope" | "canViewQuotes">;
type Row = Record<string, unknown>;

// One row per job. A replacement draft does not overwrite the decision or delivery
// of the last issued version. The Bin is excluded independently of sales outcomes.
const JOINS = `FROM trade_work_orders w
  LEFT JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
  LEFT JOIN trade_crm_customers c ON c.id=d.crm_customer_id AND c.firebase_uid=w.firebase_uid
  LEFT JOIN trade_crm_quotes q ON q.work_order_id=w.id AND q.firebase_uid=w.firebase_uid
  LEFT JOIN trade_crm_quote_versions current ON current.quote_id=q.id AND current.firebase_uid=q.firebase_uid
    AND current.version_number=q.current_version_number
  LEFT JOIN trade_crm_quote_acceptances decision ON decision.quote_id=q.id AND decision.quote_version_id=current.id
    AND decision.work_order_id=w.id AND decision.firebase_uid=w.firebase_uid
    AND decision.crm_customer_id=q.crm_customer_id AND decision.crm_customer_id=d.crm_customer_id
  LEFT JOIN trade_crm_quote_versions draft ON draft.id=(SELECT pending.id FROM trade_crm_quote_versions pending
    WHERE pending.quote_id=q.id AND pending.firebase_uid=q.firebase_uid AND pending.status IN ('draft','issuing')
    ORDER BY pending.version_number DESC LIMIT 1) AND draft.firebase_uid=w.firebase_uid`;

const VIEW_SQL = `CASE
  WHEN d.pipeline_stage='lost' OR w.stage='cancelled' THEN 'history'
  WHEN q.crm_customer_id<>COALESCE(d.crm_customer_id,'') THEN 'history'
  WHEN decision.decision='accepted' THEN 'accepted'
  WHEN current.status='accepted' THEN 'history'
  WHEN draft.id IS NOT NULL THEN 'preparing'
  WHEN COALESCE(decision.decision,current.status)='declined' THEN 'history'
  WHEN current.status='issued' THEN 'awaiting'
  ELSE 'preparing' END`;

const STATUS_SQL = `CASE WHEN d.pipeline_stage='lost' THEN 'lost' WHEN w.stage='cancelled' THEN 'cancelled'
  WHEN q.crm_customer_id<>COALESCE(d.crm_customer_id,'') THEN 'customer_changed'
  WHEN decision.decision='accepted' THEN 'accepted'
  WHEN current.status='accepted' THEN 'decision_missing'
  WHEN draft.id IS NOT NULL THEN draft.status ELSE COALESCE(decision.decision,current.status,'not_started') END`;

function text(value: unknown) { return String(value || ""); }

export async function loadTradeQuoteIndex(db: D1Database, access: QuoteAccess, params: URLSearchParams): Promise<TradeQuoteIndex> {
  // This gate covers counts, customer context and amounts, not only presentation.
  if (!access.canViewQuotes) throw new Error("QUOTE_VIEW_REQUIRED");
  const requestedView = params.get("view") || "preparing";
  const view = TRADE_QUOTE_VIEWS.find(item => item.key === requestedView)?.key;
  if (!view) throw new Error("INVALID_QUOTE_VIEW");
  const search = (params.get("search") || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 100).toLowerCase();
  const page = Math.max(1, Number.isSafeInteger(Number(params.get("page"))) ? Number(params.get("page")) : 1);
  const requestedSize = Number(params.get("pageSize"));
  const pageSize = [25, 50, 100].includes(requestedSize) ? requestedSize : 25;
  const conditions = ["w.firebase_uid=?", "w.partner_type='installer'", "w.record_status='active'",
    "(q.id IS NOT NULL OR w.source_reference LIKE 'quick-quote:%' OR d.pipeline_stage IN ('quoting','lost'))"];
  const bindings: (string | number)[] = [access.ownerUid];
  if (!access.isOwner && access.jobScope === "own") {
    conditions.push(jobMemberSql("w"));
    bindings.push(access.memberId);
  }
  if (search) {
    conditions.push(`instr(LOWER(COALESCE(w.work_number,'') || ' ' || COALESCE(q.quote_number,'') || ' ' ||
      ${protectedJobCustomerText("w.title")} || ' ' || CASE WHEN q.id IS NULL OR q.crm_customer_id=d.crm_customer_id
        THEN ${protectedJobCustomerText("c.first_name")} || ' ' || ${protectedJobCustomerText("c.last_name")} || ' ' || ${protectedJobCustomerText("c.business_name")} ELSE '' END),?)>0`);
    bindings.push(search);
  }
  const cte = `WITH quotes AS MATERIALIZED (SELECT w.id,w.work_number,
    CASE WHEN ${JOB_REGISTER_CUSTOMER_CONTEXT_SQL} THEN w.title ELSE 'Protected job' END title,
    CASE WHEN (${JOB_REGISTER_CUSTOMER_CONTEXT_SQL}) AND (q.id IS NULL OR q.crm_customer_id=d.crm_customer_id) THEN
      CASE WHEN c.business_name<>'' THEN c.business_name ELSE trim(c.first_name || ' ' || c.last_name) END ELSE '' END customer_name,
    q.id quote_id,q.quote_number,${VIEW_SQL} quote_view,${STATUS_SQL} quote_status,
    CASE WHEN d.pipeline_stage='lost' OR w.stage='cancelled' OR COALESCE(decision.decision,current.status)='accepted'
      THEN current.id ELSE COALESCE(draft.id,current.id) END display_version_id,
    CASE WHEN decision.decision='accepted' THEN decision.selected_total_cents ELSE NULL END accepted_total_cents,
    MAX(w.updated_at,COALESCE(q.updated_at,''),COALESCE(draft.updated_at,''),COALESCE(decision.decided_at,'')) updated_at
    ${JOINS} WHERE ${conditions.join(" AND ")})`;
  const cursorScope = JSON.stringify(["quotes", access.ownerUid, access.memberId, access.isOwner, access.jobScope, view, search]);
  const cursor = decodeKeysetCursor(params.get("cursor") || "", cursorScope, 2);
  if (page > 1 && !cursor) throw new Error("INVALID_CURSOR");
  const after = cursor ? keysetAfter([{ expression: "quotes.updated_at", direction: "desc" }, { expression: "quotes.id", direction: "desc" }], cursor) : null;
  const [countRows, result] = await Promise.all([
    db.prepare(`${cte} SELECT quote_view,COUNT(*) total FROM quotes GROUP BY quote_view`).bind(...bindings).all<Row>(),
    db.prepare(`${cte} SELECT quotes.*,version.version_number,
      CASE WHEN quotes.accepted_total_cents IS NOT NULL THEN quotes.accepted_total_cents
        WHEN version.id IS NULL THEN NULL ELSE MAX(0,version.total_cents)+COALESCE((
          SELECT SUM(MAX(0,choice.total_cents)) FROM trade_crm_quote_choices choice
          WHERE choice.quote_version_id=version.id AND choice.firebase_uid=version.firebase_uid AND choice.choice_kind<>'addon'
            AND choice.id=(SELECT preferred.id FROM trade_crm_quote_choices preferred
              WHERE preferred.quote_version_id=choice.quote_version_id AND preferred.firebase_uid=choice.firebase_uid
                AND preferred.choice_kind=choice.choice_kind AND preferred.group_key=choice.group_key
              ORDER BY preferred.recommended DESC,CASE WHEN preferred.recommended<>0 THEN preferred.position END DESC,preferred.position ASC LIMIT 1)
        ),0) END total_cents,
      EXISTS(SELECT 1 FROM trade_crm_quote_choices choice WHERE choice.quote_version_id=version.id AND choice.firebase_uid=version.firebase_uid) has_choices,
      issued.version_number issued_version_number,issued.issued_at,
      COALESCE(issued_decision.decision,issued.status) issued_status,issued_decision.decided_at,
      delivery.status delivery_status,delivery.attempts,delivery.next_attempt_at,delivery.failure_code,delivery.delivery_generation,
      delivery.sent_at,delivery.delivered_at
      FROM quotes
      LEFT JOIN trade_crm_quote_versions version ON version.id=quotes.display_version_id AND version.firebase_uid=?
      LEFT JOIN trade_crm_quote_versions issued ON issued.id=(SELECT latest.id FROM trade_crm_quote_versions latest
        WHERE latest.quote_id=quotes.quote_id AND latest.firebase_uid=version.firebase_uid AND latest.issued_at<>''
        ORDER BY latest.version_number DESC LIMIT 1) AND issued.firebase_uid=version.firebase_uid
      LEFT JOIN trade_crm_quote_acceptances issued_decision ON issued_decision.quote_version_id=issued.id
        AND issued_decision.quote_id=quotes.quote_id AND issued_decision.work_order_id=quotes.id AND issued_decision.firebase_uid=issued.firebase_uid
      LEFT JOIN trade_crm_quote_deliveries delivery ON delivery.id=(SELECT latest.id FROM trade_crm_quote_deliveries latest
        WHERE latest.quote_version_id=issued.id AND latest.work_order_id=quotes.id AND latest.firebase_uid=issued.firebase_uid
          AND latest.channel='email' AND latest.recipient_role IN ('acceptance','primary_customer','authorised_contact')
        ORDER BY latest.created_at DESC,latest.delivery_generation DESC,latest.id DESC LIMIT 1) AND delivery.firebase_uid=issued.firebase_uid
      WHERE quotes.quote_view=? ${after ? `AND (${after.sql})` : ""}
      ORDER BY quotes.updated_at DESC,quotes.id DESC LIMIT ?`)
      .bind(...bindings, access.ownerUid, view, ...(after?.bindings || []), pageSize + 1).all<Row>(),
  ]);
  const counts: Record<TradeQuoteView, number> = { preparing: 0, awaiting: 0, accepted: 0, history: 0 };
  for (const row of countRows.results) {
    const key = TRADE_QUOTE_VIEWS.find(item => item.key === row.quote_view)?.key;
    if (key) counts[key] = Number(row.total);
  }
  const hasNext = result.results.length > pageSize;
  const rows = result.results.slice(0, pageSize);
  const items: TradeQuoteIndexItem[] = rows.map(row => ({
    id: text(row.id), workNumber: text(row.work_number), title: text(row.title), customerName: text(row.customer_name),
    quoteNumber: text(row.quote_number), view, status: text(row.quote_status),
    versionNumber: row.version_number === null ? null : Number(row.version_number),
    totalCents: row.total_cents === null ? null : Number(row.total_cents), hasChoices: Boolean(row.has_choices),
    latestIssued: row.issued_version_number === null ? null : {
      versionNumber: Number(row.issued_version_number), status: text(row.issued_status), issuedAt: text(row.issued_at), decidedAt: text(row.decided_at),
    },
    delivery: row.delivery_status === null ? null : {
      status: text(row.delivery_status), label: tradeQuoteDeliveryPresentation(text(row.delivery_status), Number(row.attempts), text(row.next_attempt_at), text(row.failure_code), Number(row.delivery_generation)).label,
      sentAt: text(row.sent_at), deliveredAt: text(row.delivered_at),
    },
  }));
  const last = rows.at(-1);
  return { items, counts, pagination: { page, pageSize, total: counts[view], pageCount: Math.max(1, Math.ceil(counts[view] / pageSize)), hasNext,
    nextCursor: hasNext && last ? encodeKeysetCursor(cursorScope, [text(last.updated_at), text(last.id)]) : "" } };
}
