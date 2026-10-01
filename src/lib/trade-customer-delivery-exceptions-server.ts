import type { TeamAccess } from "./trade-team-server";
import type { CustomerDeliveryException, CustomerDeliveryExceptions } from "./trade-customer-delivery-exceptions.ts";

type Row = { id: string; work_order_id: string; work_number: string; title: string; label: string; status: string; updated_at: string; tab: CustomerDeliveryException["tab"]; total: number };
const CURRENT_SALES = "w.stage<>'cancelled' AND COALESCE(w.pipeline_stage,'')<>'lost'";
const FAILED_DELIVERY = "('failed','bounced','complained','opted_out','suppressed','reconciliation_required','waiting_for_channel')";

/** Structural diagnostics only: never log SQL, bindings, recipients or provider error text. */
export function customerDeliveryFailureDiagnostic(error: unknown): { code: string } {
  const causes: string[] = [];
  for (let current = error, depth = 0; current instanceof Error && depth < 3; current = current.cause, depth++) causes.push(current.message.slice(0, 2000));
  const message = causes.join(" ");
  for (const [pattern, code] of [
    [/no such table/i, "missing_table"], [/no such column/i, "missing_column"],
    [/malformed JSON/i, "malformed_json"], [/too many SQL variables/i, "sql_variable_limit"],
    [/too many terms in compound SELECT/i, "compound_select_limit"], [/too many (?:tables|joins)/i, "join_limit"],
    [/expression tree is too large|parser stack overflow/i, "expression_depth_limit"],
    [/SQLITE_TOOBIG|statement (?:is )?too long|string or blob too big/i, "statement_size_limit"],
    [/not authorized|authorization denied|SQLITE_AUTH/i, "database_authorization"],
    [/syntax error/i, "sql_syntax"], [/no such function/i, "sql_function_unavailable"],
    [/SQLITE_BUSY|database is locked/i, "database_busy"], [/D1.*(?:timed out|timeout)|query.*(?:timed out|timeout)/i, "database_timeout"],
    [/D1_TYPE_ERROR|D1_COLUMN_NOTFOUND|datatype mismatch|unsupported type/i, "database_type"],
    [/D1.*(?:BIND|PARAM)|SQLITE_RANGE|bind(?:ing)? (?:parameter|count)|incorrect number of bindings/i, "database_binding"],
    [/SQLITE_CONSTRAINT|constraint failed/i, "database_constraint"],
    [/D1_ERROR|SQLITE_ERROR/i, "database_error"],
  ] as const) if (pattern.test(message)) return { code };
  return { code: "unexpected_error" };
}

/** Read-only projection of current source receipts. No send or retry is performed. */
export async function loadCustomerDeliveryExceptions(db: D1Database, access: Pick<TeamAccess, "ownerUid" | "isOwner">,
  options: { workOrderId?: string; page?: number } = {}): Promise<CustomerDeliveryExceptions> {
  if (!access.isOwner) throw new Error("EMAIL_OWNER_REQUIRED");
  const workOrderId = options.workOrderId || "";
  const page = Math.max(1, Math.min(10000, Number.isSafeInteger(options.page) ? Number(options.page) : 1));
  const pageSize = 10;
  // workerd limits each compound SELECT to five terms. Materialized source groups
  // preserve one database snapshot and global ordering/counts without flattening seven terms.
  const result = await db.prepare(`WITH jobs AS MATERIALIZED (
    SELECT w.id,w.firebase_uid,w.work_number,w.title,w.stage,d.pipeline_stage,d.crm_customer_id,
      (SELECT lower(trim(customer.email)) FROM trade_crm_customers customer
        WHERE customer.id=d.crm_customer_id AND customer.firebase_uid=w.firebase_uid AND customer.record_status='active') customer_email
    FROM trade_work_orders w JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
    WHERE w.firebase_uid=? AND w.partner_type='installer' AND w.record_status='active'
      AND w.source_type<>'opportunity' AND d.customer_source IN ('trade_owned','public_lead_released')
      AND (?='' OR w.id=?)
  ), commercial_exceptions AS MATERIALIZED (
    SELECT 'quote:'||delivery.id id,w.id work_order_id,'Quote email' label,delivery.status,delivery.updated_at,'quote' tab
    FROM jobs w JOIN trade_crm_quotes quote ON quote.work_order_id=w.id AND quote.firebase_uid=w.firebase_uid AND quote.crm_customer_id=w.crm_customer_id
    JOIN trade_crm_quote_versions version ON version.quote_id=quote.id AND version.firebase_uid=quote.firebase_uid
      AND version.version_number=quote.current_version_number AND version.status='issued'
    JOIN trade_crm_quote_deliveries delivery ON delivery.id=(SELECT latest.id FROM trade_crm_quote_deliveries latest
      WHERE latest.quote_version_id=version.id AND latest.firebase_uid=w.firebase_uid AND latest.work_order_id=w.id
        AND latest.channel='email' AND latest.recipient_role IN ('acceptance','primary_customer','authorised_contact')
      ORDER BY latest.created_at DESC,latest.delivery_generation DESC,latest.id DESC LIMIT 1)
    WHERE ${CURRENT_SALES} AND delivery.status IN ${FAILED_DELIVERY}
      AND (delivery.status<>'failed' OR delivery.next_attempt_at='')
      AND NOT EXISTS(SELECT 1 FROM trade_crm_quote_acceptances a WHERE a.quote_version_id=version.id AND a.firebase_uid=w.firebase_uid AND a.work_order_id=w.id AND a.decision IN ('accepted','declined'))
    UNION ALL
    SELECT 'invoice:'||invoice.id,w.id,'Invoice email',invoice.delivery_status,invoice.updated_at,'invoice'
    FROM jobs w JOIN trade_crm_quick_invoices invoice ON invoice.work_order_id=w.id AND invoice.firebase_uid=w.firebase_uid AND invoice.crm_customer_id=w.crm_customer_id
    WHERE invoice.status IN ('issued','part_credited') AND invoice.delivery_status IN ${FAILED_DELIVERY}
    UNION ALL
    SELECT 'accepted-invoice:'||invoice.id,w.id,'Accepted invoice email',delivery.status,delivery.updated_at,'invoice'
    FROM jobs w JOIN trade_crm_accepted_invoices invoice ON invoice.work_order_id=w.id AND invoice.firebase_uid=w.firebase_uid AND invoice.crm_customer_id=w.crm_customer_id
    JOIN trade_crm_accepted_invoice_deliveries delivery ON delivery.invoice_id=invoice.id AND delivery.firebase_uid=invoice.firebase_uid
    WHERE invoice.status='issued' AND delivery.status IN ('failed','reconciliation_required')
      AND (delivery.status<>'failed' OR delivery.next_attempt_at='')
      AND NOT EXISTS(SELECT 1 FROM trade_crm_quick_invoices newer WHERE newer.work_order_id=w.id AND newer.firebase_uid=w.firebase_uid AND newer.status<>'void')
      AND NOT EXISTS(SELECT 1 FROM trade_crm_accounting_documents newer WHERE newer.work_order_id=w.id AND newer.firebase_uid=w.firebase_uid
        AND newer.document_type='invoice' AND newer.status NOT IN ('void','cancelled') AND newer.commercial_handoff_id<>invoice.commercial_handoff_id)
  ), operational_exceptions(id,work_order_id,label,status,updated_at,tab) AS MATERIALIZED (
    SELECT 'booking:'||event.id,w.id,'Booking email',substr(event.event_type,length('customer_calendar_invite_')+1),event.created_at,'summary'
    FROM jobs w JOIN trade_crm_appointments appointment ON appointment.work_order_id=w.id AND appointment.firebase_uid=w.firebase_uid
    JOIN trade_work_order_events event ON event.id=(SELECT latest.id FROM trade_work_order_events latest
      WHERE latest.work_order_id=w.id AND latest.firebase_uid=w.firebase_uid
        AND latest.id>='calendar-invite:'||appointment.id||':'||appointment.revision||':'
        AND latest.id<'calendar-invite:'||appointment.id||':'||appointment.revision||';'
      ORDER BY latest.id DESC LIMIT 1)
    WHERE appointment.status IN ('scheduled','cancelled') AND (${CURRENT_SALES} OR appointment.status='cancelled')
      AND event.event_type IN ('customer_calendar_invite_failed','customer_calendar_invite_unavailable','customer_calendar_invite_reconciliation_required')
    UNION ALL
    SELECT 'documents:'||delivery.id,w.id,'Booking documents',
      CASE WHEN delivery.provider_status='reconciliation_required' THEN 'reconciliation_required' ELSE delivery.status END,delivery.updated_at,'summary'
    FROM jobs w JOIN trade_crm_appointments appointment ON appointment.work_order_id=w.id AND appointment.firebase_uid=w.firebase_uid AND appointment.status='scheduled'
    JOIN trade_activity_customer_document_deliveries delivery ON delivery.id=(SELECT latest.id FROM trade_activity_customer_document_deliveries latest
      WHERE latest.work_order_id=w.id AND latest.appointment_id=appointment.id AND latest.firebase_uid=w.firebase_uid
      ORDER BY latest.created_at DESC,latest.delivery_generation DESC,latest.id DESC LIMIT 1)
    WHERE ${CURRENT_SALES} AND (delivery.status IN ('failed','bounced','complained','suppressed') OR delivery.provider_status='reconciliation_required')
      AND NOT EXISTS(SELECT 1 FROM json_each(delivery.activity_bindings) binding WHERE NOT EXISTS(
        SELECT 1 FROM trade_work_order_compliance_intents intent WHERE intent.work_order_id=w.id AND intent.installer_uid=w.firebase_uid
          AND intent.status IN ('planned','case_linked') AND intent.activity_template_id=json_extract(binding.value,'$.activityTemplateId')
          AND COALESCE(json_extract(intent.intent_snapshot,'$.activity.variantId'),'')=COALESCE(json_extract(binding.value,'$.variantId'),'')))
    UNION ALL
    SELECT 'report:'||event.id,w.id,'Completed assessment report',
      CASE WHEN json_extract(event.metadata,'$.outcome')='indeterminate' THEN 'reconciliation_required' ELSE 'failed' END,event.created_at,'files'
    FROM jobs w JOIN trade_rental_inspections inspection ON inspection.work_order_id=w.id AND inspection.firebase_uid=w.firebase_uid AND inspection.status='issued'
    JOIN trade_rental_inspection_events event ON event.id=(SELECT latest.id FROM trade_rental_inspection_events latest
      WHERE latest.inspection_id=inspection.id AND latest.firebase_uid=w.firebase_uid AND latest.report_id=inspection.issued_report_id
        AND latest.event_type IN ('report_email_requested','report_email_accepted','report_email_failed')
      ORDER BY latest.created_at DESC,CASE latest.event_type WHEN 'report_email_accepted' THEN 0 WHEN 'report_email_failed' THEN 1 ELSE 2 END,latest.id DESC LIMIT 1)
    WHERE event.event_type='report_email_failed'
    UNION ALL
    SELECT 'follow-up:'||message.id,w.id,'Customer follow-up',message.status,message.updated_at,'messages'
    FROM jobs w JOIN trade_follow_up_messages message ON message.owner_uid=w.firebase_uid AND message.work_order_id=w.id
    WHERE ${CURRENT_SALES} AND message.status IN ('failed','uncertain') AND (message.status='uncertain' OR message.next_attempt_at='')
      AND w.customer_email<>'' AND lower(trim(message.recipient))=w.customer_email
      AND message.id=(SELECT latest.id FROM trade_follow_up_messages latest WHERE latest.owner_uid=w.firebase_uid AND latest.work_order_id=w.id
        AND latest.template_id=message.template_id AND latest.context_json=message.context_json
        AND lower(trim(latest.recipient))=w.customer_email ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
      AND (COALESCE(json_extract(message.context_json,'$.appointmentId'),'')='' OR EXISTS(
        SELECT 1 FROM trade_crm_appointments a WHERE a.id=json_extract(message.context_json,'$.appointmentId') AND a.work_order_id=w.id AND a.firebase_uid=w.firebase_uid AND a.status<>'cancelled'))
      AND (COALESCE(json_extract(message.context_json,'$.invoiceId'),'')='' OR EXISTS(
        SELECT 1 FROM trade_crm_quick_invoices i WHERE i.id=json_extract(message.context_json,'$.invoiceId') AND i.work_order_id=w.id AND i.firebase_uid=w.firebase_uid AND i.crm_customer_id=w.crm_customer_id AND i.status IN ('issued','part_credited')
        UNION ALL SELECT 1 FROM trade_crm_accepted_invoices i WHERE i.id=json_extract(message.context_json,'$.invoiceId') AND i.work_order_id=w.id AND i.firebase_uid=w.firebase_uid AND i.crm_customer_id=w.crm_customer_id AND i.status='issued'))
  ), exceptions AS (
    SELECT * FROM commercial_exceptions UNION ALL SELECT * FROM operational_exceptions
  ) SELECT exceptions.*,jobs.work_number,jobs.title,COUNT(*) OVER() total FROM exceptions JOIN jobs ON jobs.id=exceptions.work_order_id
    ORDER BY exceptions.updated_at DESC,exceptions.id DESC LIMIT ? OFFSET ?`)
    .bind(access.ownerUid, workOrderId, workOrderId, pageSize, (page - 1) * pageSize).all<Row>();
  const items: CustomerDeliveryException[] = result.results.map(row => {
    const status = ["uncertain", "reconciliation_required"].includes(row.status) ? "uncertain"
      : ["unavailable", "waiting_for_channel", "complained", "opted_out", "suppressed"].includes(row.status) ? "blocked" : "failed";
    return { id: row.id, workOrderId: row.work_order_id, workNumber: row.work_number, jobTitle: row.title,
      label: row.label, status, updatedAt: row.updated_at, tab: row.tab,
      message: status === "uncertain" ? "Check the outgoing mailbox before sending another copy."
        : ["complained", "opted_out", "suppressed"].includes(row.status) ? "Email is blocked for this recipient. Review their contact preferences."
        : status === "blocked" ? "Review the customer email and business email connection."
        : row.status === "bounced" ? "The email bounced. Check the customer address." : "The email was not accepted. Open the record to review delivery." };
  });
  const total = Number(result.results[0]?.total || 0);
  return { items, total, page, hasNext: page * pageSize < total };
}
