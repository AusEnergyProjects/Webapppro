import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { normaliseTradeQuoteLineGroup } from "@/lib/trade-quote";
import { normaliseQuoteChoices } from "@/lib/trade-quote-options";
import { priceBookItemsForQuote, resolvePriceBookQuoteLines } from "@/lib/trade-price-book-server";
import { jobPacketsForQuote, resolveJobPacketQuoteLines } from "@/lib/trade-job-packet-server";
import { canDispatch, requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { newQuoteLinkSecret, hashQuoteLinkSecret, protectQuoteLinkSecret, quoteReviewPath, recoverQuoteLinkSecret } from "@/lib/trade-quote-links";
import { maskPhotoRequestEmail } from "@/lib/trade-photo-request-delivery";
import { sendServiceReminderProviderMessage, serviceReminderProviderConfiguration } from "@/lib/service-reminder-delivery";

export const runtime = "edge";

type Row = Record<string, unknown>;
type ResolvedGroup = Awaited<ReturnType<typeof resolveLineGroup>>;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

async function installerAccess(request: Request) {
  const access = await requireInstallerTeamAccess(request, false);
  if (!canDispatch(access)) throw new Error("QUOTE_MANAGEMENT_REQUIRED");
  return access;
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["ACCOUNT_INACTIVE", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED", "TEAM_ACCESS_REQUIRED", "TEAM_MEMBERSHIP_REQUIRED"].includes(code)) return adminJson({ ok: false, error: "An active verified installer account is required." }, 403);
  if (code === "QUOTE_MANAGEMENT_REQUIRED") return adminJson({ ok: false, error: "Only the owner, manager or coordinator can prepare customer quotes." }, 403);
  if (code === "JOB_NOT_FOUND") return adminJson({ ok: false, error: "Choose a direct customer job with an authoritative service site." }, 404);
  if (code === "QUOTE_NOT_FOUND") return adminJson({ ok: false, error: "Quote not found." }, 404);
  if (code === "IMMUTABLE_VERSION") return adminJson({ ok: false, error: "Issued quote versions cannot be changed. Create the next version instead." }, 409);
  if (code === "PRICE_BOOK_ITEM_UNAVAILABLE") return adminJson({ ok: false, error: "A saved item is no longer active. Remove it or add its replacement from the price book." }, 409);
  if (["JOB_PACKET_UNAVAILABLE", "JOB_PACKET_DUPLICATE_LINE"].includes(code)) return adminJson({ ok: false, error: "That job packet changed or is no longer ready. Apply its current version again." }, 409);
  if (code === "INVALID_QUOTE_CHOICES") return adminJson({ ok: false, error: "Each customer choice needs a clear name, valid group and at least one priced line." }, 400);
  if (["INVALID_LINES", "INVALID_DECIMAL", "INVALID_QUANTITY", "INVALID_MONEY", "INVALID_TAX", "INVALID_TOTAL", "QUOTE_TOTAL_TOO_LARGE"].includes(code)) return adminJson({ ok: false, error: "Check every line description, quantity, price and tax selection." }, 400);
  return adminJson({ ok: false, error: "The private quote request could not be completed." }, 500);
}

async function directJob(ownerUid: string, workOrderId: string) {
  const row = await getD1().prepare(`SELECT w.id, w.work_number, w.title, d.crm_customer_id, d.service_site_id,
      c.customer_number, c.first_name, c.last_name, c.business_name, c.email customer_email,
      s.site_label, s.address_line_1, s.suburb, s.address_state, s.postcode
    FROM trade_work_orders w JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid AND c.record_status = 'active'
    JOIN trade_crm_service_sites s ON s.id = d.service_site_id AND s.customer_id = c.id AND s.firebase_uid = w.firebase_uid AND s.record_status = 'active'
    WHERE w.id = ? AND w.firebase_uid = ? AND w.record_status = 'active' AND d.customer_source = 'trade_owned'`)
    .bind(workOrderId, ownerUid).first<Row>();
  if (!row) throw new Error("JOB_NOT_FOUND");
  return row;
}

async function authorisedEmails(ownerUid: string, customerId: string) {
  const rows = await getD1().prepare(`SELECT email FROM trade_crm_customers WHERE id = ? AND firebase_uid = ? AND record_status = 'active' AND email != ''
    UNION SELECT email FROM trade_crm_customer_contacts WHERE customer_id = ? AND firebase_uid = ? AND record_status = 'active' AND email != ''`)
    .bind(customerId, ownerUid, customerId, ownerUid).all<Row>();
  return [...new Set(rows.results.map((row) => String(row.email || "").trim().toLowerCase()).filter(Boolean))].sort();
}

function itemPayload(item: Row, includeInternal: boolean) {
  const payload: Row = {
    id: String(item.id), position: Number(item.position), lineType: String(item.line_type), description: String(item.description),
    quantityMilli: Number(item.quantity_milli), unitPriceCents: Number(item.unit_price_cents), taxCode: String(item.tax_code),
    subtotalCents: Number(item.subtotal_cents), taxCents: Number(item.tax_cents), totalCents: Number(item.total_cents),
    priceBookItemId: String(item.price_book_item_id || ""), priceBookItemType: String(item.price_book_item_type || ""),
    jobPacketId: String(item.job_packet_id || ""), jobPacketRevision: Number(item.job_packet_revision || 0), jobPacketLineId: String(item.job_packet_line_id || ""),
    sectionHeading: String(item.section_heading || "Included work"), quoteChoiceId: String(item.quote_choice_id || ""),
  };
  if (includeInternal) {
    payload.unitCostCentsExGst = Number(item.unit_cost_cents_ex_gst || 0);
    payload.marginBasisPoints = Number(item.margin_basis_points || 0);
  }
  return payload;
}

async function quotePayload(ownerUid: string, workOrderId: string, includeInternal = true, origin = "") {
  const db = getD1();
  const quote = await db.prepare(`SELECT * FROM trade_crm_quotes WHERE work_order_id = ? AND firebase_uid = ?`).bind(workOrderId, ownerUid).first<Row>();
  if (!quote) return null;
  const versions = await db.prepare(`SELECT * FROM trade_crm_quote_versions WHERE quote_id = ? AND firebase_uid = ? ORDER BY version_number DESC`).bind(quote.id, ownerUid).all<Row>();
  const versionIds = versions.results.map((row) => String(row.id));
  const placeholders = versionIds.map(() => "?").join(",");
  const items = versionIds.length ? await db.prepare(`SELECT * FROM trade_crm_quote_items WHERE firebase_uid = ? AND quote_version_id IN (${placeholders}) ORDER BY quote_version_id, position`).bind(ownerUid, ...versionIds).all<Row>() : { results: [] as Row[] };
  const choices = versionIds.length ? await db.prepare(`SELECT * FROM trade_crm_quote_choices WHERE firebase_uid = ? AND quote_version_id IN (${placeholders}) ORDER BY quote_version_id, position`).bind(ownerUid, ...versionIds).all<Row>() : { results: [] as Row[] };
  const acceptances = versionIds.length ? await db.prepare(`SELECT * FROM trade_crm_quote_acceptances WHERE firebase_uid = ? AND quote_version_id IN (${placeholders})`).bind(ownerUid, ...versionIds).all<Row>() : { results: [] as Row[] };
  const currentVersion = versions.results.find((row) => Number(row.version_number) === Number(quote.current_version_number));
  let link = currentVersion ? await db.prepare("SELECT * FROM trade_crm_quote_links WHERE quote_version_id = ? AND firebase_uid = ?").bind(currentVersion.id, ownerUid).first<Row>() : null;
  if (link && link.status === "active" && String(link.expires_at) <= new Date().toISOString()) {
    const expiredAt = new Date().toISOString();
    await db.batch([
      db.prepare("UPDATE trade_crm_quote_links SET status = 'expired', token_hash = '', encrypted_token = '', updated_at = ? WHERE id = ? AND firebase_uid = ? AND status = 'active'")
        .bind(expiredAt, link.id, ownerUid),
      db.prepare(`INSERT OR IGNORE INTO trade_crm_quote_events (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid, event_type, actor_type, summary, evidence_key, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, 'expired', 'system', 'Secure quote link expired.', ?, ?)`)
        .bind(crypto.randomUUID(), link.id, link.quote_id, link.quote_version_id, link.work_order_id, ownerUid, `expired:${link.id}:${link.token_issue}`, expiredAt),
    ]);
    link = { ...link, status: "expired", token_hash: "", encrypted_token: "", updated_at: expiredAt };
  }
  const [events, questions, deliveries] = currentVersion ? await Promise.all([
    db.prepare("SELECT event_type, actor_type, summary, occurred_at FROM trade_crm_quote_events WHERE quote_version_id = ? AND firebase_uid = ? ORDER BY occurred_at DESC LIMIT 100").bind(currentVersion.id, ownerUid).all<Row>(),
    db.prepare("SELECT id, question, answer, status, asked_at, answered_at FROM trade_crm_quote_questions WHERE quote_version_id = ? AND firebase_uid = ? ORDER BY asked_at").bind(currentVersion.id, ownerUid).all<Row>(),
    db.prepare("SELECT id, channel, provider, status, recipient_preview, attempts, provider_status, last_error, sent_at, delivered_at, created_at FROM trade_crm_quote_deliveries WHERE quote_version_id = ? AND firebase_uid = ? ORDER BY created_at DESC").bind(currentVersion.id, ownerUid).all<Row>(),
  ]) : [{ results: [] as Row[] }, { results: [] as Row[] }, { results: [] as Row[] }];
  let shareUrl = "";
  if (link && link.status === "active" && link.token_hash && origin) {
    try { shareUrl = `${origin}${quoteReviewPath(String(link.id), await recoverQuoteLinkSecret(String(link.encrypted_token), String(link.id), Number(link.token_issue), String(link.token_hash)))}`; } catch { shareUrl = ""; }
  }
  return {
    id: String(quote.id), workOrderId: String(quote.work_order_id), customerId: String(quote.crm_customer_id), serviceSiteId: String(quote.service_site_id),
    quoteNumber: String(quote.quote_number), currentVersionNumber: Number(quote.current_version_number), status: String(quote.status),
    link: link ? { id: String(link.id), status: String(link.status), expiresAt: String(link.expires_at), tokenIssue: Number(link.token_issue), shareUrl,
      recipientPreview: maskPhotoRequestEmail(String(currentVersion?.acceptance_email || "")) } : null,
    timeline: events.results.map((event) => ({ type: String(event.event_type), actorType: String(event.actor_type), summary: String(event.summary), occurredAt: String(event.occurred_at) })),
    questions: questions.results.map((question) => ({ id: String(question.id), question: String(question.question), answer: String(question.answer || ""), status: String(question.status), askedAt: String(question.asked_at), answeredAt: String(question.answered_at || "") })),
    deliveries: deliveries.results.map((delivery) => ({ id: String(delivery.id), channel: String(delivery.channel), provider: String(delivery.provider), status: String(delivery.status), recipientPreview: String(delivery.recipient_preview), attempts: Number(delivery.attempts), providerStatus: String(delivery.provider_status || ""), lastError: String(delivery.last_error || ""), sentAt: String(delivery.sent_at || ""), deliveredAt: String(delivery.delivered_at || ""), createdAt: String(delivery.created_at) })),
    versions: versions.results.map((version) => {
      const versionItems = items.results.filter((item) => item.quote_version_id === version.id);
      const versionChoices = choices.results.filter((choice) => choice.quote_version_id === version.id);
      const acceptance = acceptances.results.find((item) => item.quote_version_id === version.id);
      const internalCostCents = versionItems.reduce((sum, item) => sum + Math.round(Number(item.quantity_milli) * Number(item.unit_cost_cents_ex_gst || 0) / 1000), 0);
      return {
        id: String(version.id), versionNumber: Number(version.version_number), status: String(version.status), customerEmail: String(version.acceptance_email || ""),
        subtotalCents: Number(version.subtotal_cents), taxCents: Number(version.tax_cents), totalCents: Number(version.total_cents), terms: String(version.terms || ""),
        validUntil: String(version.valid_until || ""), consentStatement: String(version.consent_statement || ""), issuedAt: String(version.issued_at || ""),
        createdAt: String(version.created_at), updatedAt: String(version.updated_at),
        items: versionItems.filter((item) => !item.quote_choice_id).map((item) => itemPayload(item, includeInternal)),
        choices: versionChoices.map((choice) => ({ id: String(choice.id), clientKey: String(choice.choice_key), kind: String(choice.choice_kind),
          groupKey: String(choice.group_key), name: String(choice.name), summary: String(choice.summary || ""), recommended: Boolean(choice.recommended),
          subtotalCents: Number(choice.subtotal_cents), taxCents: Number(choice.tax_cents), totalCents: Number(choice.total_cents),
          items: versionItems.filter((item) => item.quote_choice_id === choice.id).map((item) => itemPayload(item, includeInternal)) })),
        ...(includeInternal ? { internalSummary: { costCentsExGst: internalCostCents,
          sellCentsExGst: versionItems.reduce((sum, item) => sum + Number(item.subtotal_cents), 0),
          marginCentsExGst: versionItems.reduce((sum, item) => sum + Number(item.subtotal_cents), 0) - internalCostCents } } : {}),
        acceptance: acceptance ? { decision: String(acceptance.decision), actorEmail: String(acceptance.actor_email), decidedAt: String(acceptance.decided_at),
          actorType: String(acceptance.actor_type || "verified_account"), signerName: String(acceptance.signer_name || ""), consentStatement: String(acceptance.consent_statement),
          selectionSummary: String(acceptance.selection_summary || ""), selectedTotalCents: Number(acceptance.selected_total_cents || 0) } : null,
      };
    }),
  };
}

async function resolveLineGroup(ownerUid: string, rawLines: unknown, allowEmpty = false) {
  const packet = await resolveJobPacketQuoteLines(ownerUid, rawLines);
  const priceBook = await resolvePriceBookQuoteLines(ownerUid, packet.lines);
  const calculated = normaliseTradeQuoteLineGroup(priceBook.lines, (value) => cleanAdminText(value, 500), allowEmpty);
  const raw = Array.isArray(priceBook.lines) ? priceBook.lines as Row[] : [];
  return { calculated, priceReferences: priceBook.references, packetReferences: packet.references,
    sectionHeadings: raw.map((line) => cleanAdminText(line.sectionHeading, 120) || "Included work") };
}

function choiceDefaultTotal(base: ResolvedGroup, choices: Array<{ input: ReturnType<typeof normaliseQuoteChoices>[number]; resolved: ResolvedGroup }>) {
  const selected = new Map<string, typeof choices[number]>();
  for (const choice of choices.filter((item) => item.input.kind !== "addon")) {
    const key = `${choice.input.kind}:${choice.input.groupKey}`;
    const current = selected.get(key);
    if (!current || choice.input.recommended) selected.set(key, choice);
  }
  return base.calculated.totalCents + [...selected.values()].reduce((sum, item) => sum + item.resolved.calculated.totalCents, 0);
}

function appendItems(db: D1Database, statements: D1PreparedStatement[], ownerUid: string,
  versionId: string, choiceId: string, resolved: ResolvedGroup, startPosition: number, now: string) {
  resolved.calculated.lines.forEach((line, index) => {
    const price = resolved.priceReferences[index]; const packet = resolved.packetReferences[index];
    statements.push(db.prepare(`INSERT INTO trade_crm_quote_items
      (id, quote_version_id, firebase_uid, position, line_type, description, quantity_milli, unit_price_cents, tax_code,
       subtotal_cents, tax_cents, total_cents, price_book_item_id, price_book_item_type, unit_cost_cents_ex_gst,
       markup_basis_points, margin_basis_points, job_packet_id, job_packet_revision, job_packet_line_id, section_heading, quote_choice_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), versionId, ownerUid, startPosition + index, line.lineType, line.description, line.quantityMilli,
        line.unitPriceCents, line.taxCode, line.subtotalCents, line.taxCents, line.totalCents, price?.id || "", price?.itemType || "",
        price?.unitCostCentsExGst || 0, price?.markupBasisPoints || 0, price?.marginBasisPoints || 0, packet?.packetId || "",
        packet?.packetRevision || 0, packet?.packetLineId || "", resolved.sectionHeadings[index], choiceId, now));
  });
  return startPosition + resolved.calculated.lines.length;
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await installerAccess(request); const url = new URL(request.url); const workOrderId = cleanAdminText(url.searchParams.get("workOrderId"), 180);
    const job = await directJob(access.ownerUid, workOrderId); const emails = await authorisedEmails(access.ownerUid, String(job.crm_customer_id));
    return adminJson({ ok: true, access: { role: access.role, canViewInternal: true }, job: { workNumber: job.work_number, title: job.title,
      customerNumber: job.customer_number, customerName: job.business_name || [job.first_name, job.last_name].filter(Boolean).join(" "), siteLabel: job.site_label,
      siteSummary: [job.address_line_1, job.suburb, job.address_state, job.postcode].filter(Boolean).join(", ") }, authorisedEmails: emails,
      priceBookItems: await priceBookItemsForQuote(access.ownerUid), jobPackets: await jobPacketsForQuote(access.ownerUid), quote: await quotePayload(access.ownerUid, workOrderId, true, new URL(request.url).origin) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await installerAccess(request); const body = await request.json() as Row;
    const action = cleanAdminText(body.action, 40); const workOrderId = cleanAdminText(body.workOrderId, 180); const job = await directJob(access.ownerUid, workOrderId);
    const db = getD1(); const now = new Date().toISOString();
    if (action === "save_draft") {
      const choiceInputs = normaliseQuoteChoices(body.choices, (value, maximum = 500) => cleanAdminText(value, maximum));
      const base = await resolveLineGroup(access.ownerUid, body.lines, choiceInputs.length > 0);
      const choices = await Promise.all(choiceInputs.map(async (input) => ({ input, resolved: await resolveLineGroup(access.ownerUid, input.lines) })));
      if (!base.calculated.lines.length && !choices.length) throw new Error("INVALID_LINES");
      const customerEmail = cleanAdminText(body.customerEmail, 180).toLowerCase(); const emails = await authorisedEmails(access.ownerUid, String(job.crm_customer_id));
      if (customerEmail && !emails.includes(customerEmail)) return adminJson({ ok: false, error: "Choose an email from this customer's authorised contacts." }, 400);
      const validUntil = cleanAdminText(body.validUntil, 10); if (validUntil && !DATE_PATTERN.test(validUntil)) return adminJson({ ok: false, error: "Choose a valid quote expiry date." }, 400);
      const terms = cleanAdminText(body.terms, 4000);
      const quote = await db.prepare(`SELECT * FROM trade_crm_quotes WHERE work_order_id = ? AND firebase_uid = ?`).bind(workOrderId, access.ownerUid).first<Row>();
      const quoteId = String(quote?.id || crypto.randomUUID()); let versionNumber = Number(quote?.current_version_number || 1); let versionId = ""; const statements: D1PreparedStatement[] = [];
      if (!quote) {
        const quoteNumber = `Q-${String(job.work_number).replace(/^JOB-/, "")}`;
        statements.push(db.prepare(`INSERT INTO trade_crm_quotes (id, work_order_id, firebase_uid, crm_customer_id, service_site_id, quote_number, current_version_number, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, 'draft', ?, ?)`).bind(quoteId, workOrderId, access.ownerUid, job.crm_customer_id, job.service_site_id, quoteNumber, now, now));
        versionId = crypto.randomUUID();
        statements.push(db.prepare(`INSERT INTO trade_crm_quote_versions (id, quote_id, firebase_uid, version_number, status, acceptance_email, subtotal_cents, tax_cents, total_cents, terms, valid_until, consent_statement, issued_at, created_at, updated_at)
          VALUES (?, ?, ?, 1, 'draft', ?, ?, ?, ?, ?, ?, '', '', ?, ?)`).bind(versionId, quoteId, access.ownerUid, customerEmail, base.calculated.subtotalCents, base.calculated.taxCents, base.calculated.totalCents, terms, validUntil, now, now));
      } else {
        const current = await db.prepare(`SELECT * FROM trade_crm_quote_versions WHERE quote_id = ? AND firebase_uid = ? AND version_number = ?`).bind(quoteId, access.ownerUid, versionNumber).first<Row>();
        if (!current) throw new Error("QUOTE_NOT_FOUND");
        if (current.status === "draft") {
          versionId = String(current.id);
          statements.push(db.prepare(`UPDATE trade_crm_quote_versions SET acceptance_email = ?, subtotal_cents = ?, tax_cents = ?, total_cents = ?, terms = ?, valid_until = ?, updated_at = ? WHERE id = ? AND firebase_uid = ? AND status = 'draft'`)
            .bind(customerEmail, base.calculated.subtotalCents, base.calculated.taxCents, base.calculated.totalCents, terms, validUntil, now, versionId, access.ownerUid));
          statements.push(db.prepare(`DELETE FROM trade_crm_quote_items WHERE quote_version_id = ? AND firebase_uid = ?`).bind(versionId, access.ownerUid));
          statements.push(db.prepare(`DELETE FROM trade_crm_quote_choices WHERE quote_version_id = ? AND firebase_uid = ?`).bind(versionId, access.ownerUid));
        } else {
          versionNumber += 1; versionId = crypto.randomUUID();
          if (current.status === "issued") {
            statements.push(db.prepare(`UPDATE trade_crm_quote_versions SET status = 'superseded', updated_at = ? WHERE id = ? AND firebase_uid = ? AND status = 'issued'`).bind(now, current.id, access.ownerUid));
            statements.push(db.prepare("UPDATE trade_crm_quote_links SET status = 'superseded', token_hash = '', encrypted_token = '', updated_at = ? WHERE quote_version_id = ? AND firebase_uid = ? AND status = 'active'").bind(now, current.id, access.ownerUid));
            statements.push(db.prepare(`INSERT OR IGNORE INTO trade_crm_quote_events (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid, event_type, actor_type, summary, evidence_key, occurred_at)
              SELECT ?, link.id, link.quote_id, link.quote_version_id, link.work_order_id, link.firebase_uid, 'superseded', 'office', 'A new quote draft superseded this secure link.', ?, ? FROM trade_crm_quote_links link WHERE link.quote_version_id = ? AND link.firebase_uid = ?`)
              .bind(crypto.randomUUID(), `superseded:${current.id}`, now, current.id, access.ownerUid));
          }
          statements.push(db.prepare(`INSERT INTO trade_crm_quote_versions (id, quote_id, firebase_uid, version_number, status, acceptance_email, subtotal_cents, tax_cents, total_cents, terms, valid_until, consent_statement, issued_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, '', '', ?, ?)`).bind(versionId, quoteId, access.ownerUid, versionNumber, customerEmail, base.calculated.subtotalCents, base.calculated.taxCents, base.calculated.totalCents, terms, validUntil, now, now));
          statements.push(db.prepare(`UPDATE trade_crm_quotes SET current_version_number = ?, status = 'draft', crm_customer_id = ?, service_site_id = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?`).bind(versionNumber, job.crm_customer_id, job.service_site_id, now, quoteId, access.ownerUid));
        }
      }
      let position = appendItems(db, statements, access.ownerUid, versionId, "", base, 1, now);
      choices.forEach(({ input, resolved }, index) => {
        const choiceId = crypto.randomUUID();
        statements.push(db.prepare(`INSERT INTO trade_crm_quote_choices (id, quote_version_id, firebase_uid, position, choice_key, choice_kind, group_key, name, summary, recommended, subtotal_cents, tax_cents, total_cents, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(choiceId, versionId, access.ownerUid, index + 1, input.clientKey, input.kind, input.groupKey, input.name, input.summary, input.recommended ? 1 : 0, resolved.calculated.subtotalCents, resolved.calculated.taxCents, resolved.calculated.totalCents, now));
        position = appendItems(db, statements, access.ownerUid, versionId, choiceId, resolved, position, now);
      });
      const displayTotal = choiceDefaultTotal(base, choices);
      statements.push(db.prepare(`UPDATE trade_crm_job_details SET quoted_value_cents = ?, quote_status = 'draft', updated_at = ? WHERE work_order_id = ? AND firebase_uid = ?`).bind(displayTotal, now, workOrderId, access.ownerUid));
      await db.batch(statements);
      return adminJson({ ok: true, quote: await quotePayload(access.ownerUid, workOrderId, true, new URL(request.url).origin) });
    }
    if (action === "issue_quote") {
      const quote = await db.prepare(`SELECT * FROM trade_crm_quotes WHERE work_order_id = ? AND firebase_uid = ?`).bind(workOrderId, access.ownerUid).first<Row>();
      if (!quote) throw new Error("QUOTE_NOT_FOUND");
      const version = await db.prepare(`SELECT * FROM trade_crm_quote_versions WHERE quote_id = ? AND firebase_uid = ? AND version_number = ? AND status = 'draft'`).bind(quote.id, access.ownerUid, quote.current_version_number).first<Row>();
      if (!version) throw new Error("IMMUTABLE_VERSION");
      const customerEmail = String(version.acceptance_email || ""); const emails = await authorisedEmails(access.ownerUid, String(job.crm_customer_id));
      if (!customerEmail || !emails.includes(customerEmail)) return adminJson({ ok: false, error: "Choose an authorised customer email before issuing this quote." }, 400);
      if (!String(version.terms || "").trim()) return adminJson({ ok: false, error: "Record the quote scope, exclusions and completion terms before issuing." }, 400);
      if (version.valid_until && String(version.valid_until) < now.slice(0, 10)) return adminJson({ ok: false, error: "The quote expiry date must not be in the past." }, 400);
      const itemCount = await db.prepare(`SELECT COUNT(*) count FROM trade_crm_quote_items WHERE quote_version_id = ? AND firebase_uid = ?`).bind(version.id, access.ownerUid).first<Row>();
      if (!Number(itemCount?.count)) return adminJson({ ok: false, error: "Add at least one quote line before issuing." }, 400);
      const consentStatement = `I accept quote ${quote.quote_number} version ${version.version_number}, including my recorded choices and final server-calculated total, subject to its recorded terms.`;
      const linkId = crypto.randomUUID(); const secret = newQuoteLinkSecret(); const tokenIssue = 1;
      const validExpiry = version.valid_until ? new Date(`${version.valid_until}T23:59:59.999Z`) : new Date(Date.now() + 30 * 86400000);
      const expiresAt = new Date(Math.min(validExpiry.getTime(), Date.now() + 30 * 86400000)).toISOString();
      await db.batch([
        db.prepare(`UPDATE trade_crm_quote_versions SET status = 'superseded', updated_at = ? WHERE quote_id = ? AND firebase_uid = ? AND status = 'issued'`).bind(now, quote.id, access.ownerUid),
        db.prepare(`UPDATE trade_crm_quote_versions SET status = 'issued', consent_statement = ?, issued_at = ?, updated_at = ? WHERE id = ? AND firebase_uid = ? AND status = 'draft'`).bind(consentStatement, now, now, version.id, access.ownerUid),
        db.prepare(`UPDATE trade_crm_quotes SET status = 'issued', crm_customer_id = ?, service_site_id = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?`).bind(job.crm_customer_id, job.service_site_id, now, quote.id, access.ownerUid),
        db.prepare(`UPDATE trade_crm_job_details SET quote_status = 'sent', updated_at = ? WHERE work_order_id = ? AND firebase_uid = ?`).bind(now, workOrderId, access.ownerUid),
        db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at) VALUES (?, ?, ?, 'quote_issued', ?, ?)`).bind(crypto.randomUUID(), workOrderId, access.ownerUid, `${quote.quote_number} version ${version.version_number} issued with secure customer review.`, now),
        db.prepare(`INSERT INTO trade_crm_quote_links (id, quote_id, quote_version_id, work_order_id, firebase_uid, crm_customer_id, token_hash, encrypted_token, token_issue, status, expires_at, revoked_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, '', ?, ?)`)
          .bind(linkId, quote.id, version.id, workOrderId, access.ownerUid, job.crm_customer_id, await hashQuoteLinkSecret(secret), await protectQuoteLinkSecret(linkId, tokenIssue, secret), tokenIssue, expiresAt, now, now),
        db.prepare(`INSERT INTO trade_crm_quote_events (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid, event_type, actor_type, summary, evidence_key, occurred_at)
          VALUES (?, ?, ?, ?, ?, ?, 'issued', 'office', 'Secure quote link issued.', ?, ?)`)
          .bind(crypto.randomUUID(), linkId, quote.id, version.id, workOrderId, access.ownerUid, `issued:${version.id}`, now),
      ]);
      return adminJson({ ok: true, quote: await quotePayload(access.ownerUid, workOrderId, true, new URL(request.url).origin) });
    }
    if (["replace_link", "revoke_link", "send_quote", "answer_question"].includes(action)) {
      const quote = await db.prepare("SELECT * FROM trade_crm_quotes WHERE work_order_id = ? AND firebase_uid = ?").bind(workOrderId, access.ownerUid).first<Row>();
      if (!quote) throw new Error("QUOTE_NOT_FOUND");
      const version = await db.prepare("SELECT * FROM trade_crm_quote_versions WHERE quote_id = ? AND firebase_uid = ? AND version_number = ? AND status = 'issued'").bind(quote.id, access.ownerUid, quote.current_version_number).first<Row>();
      if (!version) throw new Error("IMMUTABLE_VERSION");
      const link = await db.prepare("SELECT * FROM trade_crm_quote_links WHERE quote_version_id = ? AND firebase_uid = ?").bind(version.id, access.ownerUid).first<Row>();
      if (!link) throw new Error("QUOTE_NOT_FOUND");
      if (action === "revoke_link") {
        await db.batch([
          db.prepare("UPDATE trade_crm_quote_links SET status = 'revoked', token_hash = '', encrypted_token = '', revoked_at = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?").bind(now, now, link.id, access.ownerUid),
          db.prepare(`INSERT OR IGNORE INTO trade_crm_quote_events (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid, event_type, actor_type, summary, evidence_key, occurred_at) VALUES (?, ?, ?, ?, ?, ?, 'revoked', 'office', 'Secure quote link revoked.', ?, ?)`)
            .bind(crypto.randomUUID(), link.id, quote.id, version.id, workOrderId, access.ownerUid, `revoked:${version.id}:${link.token_issue}`, now),
        ]);
      } else if (action === "replace_link") {
        const secret = newQuoteLinkSecret(); const tokenIssue = Number(link.token_issue) + 1;
        const validExpiry = version.valid_until ? new Date(`${version.valid_until}T23:59:59.999Z`) : new Date(Date.now() + 30 * 86400000);
        const expiresAt = new Date(Math.min(validExpiry.getTime(), Date.now() + 30 * 86400000)).toISOString();
        await db.batch([
          db.prepare("UPDATE trade_crm_quote_links SET token_hash = ?, encrypted_token = ?, token_issue = ?, status = 'active', expires_at = ?, revoked_at = '', updated_at = ? WHERE id = ? AND firebase_uid = ?")
            .bind(await hashQuoteLinkSecret(secret), await protectQuoteLinkSecret(String(link.id), tokenIssue, secret), tokenIssue, expiresAt, now, link.id, access.ownerUid),
          db.prepare("UPDATE trade_crm_quote_deliveries SET status = 'replaced', updated_at = ? WHERE quote_link_id = ? AND status IN ('queued','sending','failed')").bind(now, link.id),
          db.prepare(`INSERT INTO trade_crm_quote_events (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid, event_type, actor_type, summary, evidence_key, occurred_at) VALUES (?, ?, ?, ?, ?, ?, 'replaced', 'office', 'Secure quote link replaced.', ?, ?)`)
            .bind(crypto.randomUUID(), link.id, quote.id, version.id, workOrderId, access.ownerUid, `replaced:${version.id}:${tokenIssue}`, now),
        ]);
      } else if (action === "answer_question") {
        const questionId = cleanAdminText(body.questionId, 180); const answer = cleanAdminText(body.answer, 1000); if (!questionId || answer.length < 2) return adminJson({ ok: false, error: "Enter a clear response." }, 400);
        const result = await db.prepare("UPDATE trade_crm_quote_questions SET answer = ?, status = 'answered', answered_at = ?, answered_by_uid = ? WHERE id = ? AND quote_version_id = ? AND firebase_uid = ? AND status = 'open'")
          .bind(answer, now, access.actorUid, questionId, version.id, access.ownerUid).run(); if (Number(result.meta.changes || 0) !== 1) return adminJson({ ok: false, error: "That question is no longer awaiting a response." }, 409);
        await db.prepare(`INSERT INTO trade_crm_quote_events (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid, event_type, actor_type, summary, evidence_key, occurred_at) VALUES (?, ?, ?, ?, ?, ?, 'question_answered', 'office', 'Trade office answered the customer question.', ?, ?)`)
          .bind(crypto.randomUUID(), link.id, quote.id, version.id, workOrderId, access.ownerUid, `answer:${questionId}`, now).run();
      } else {
        const channel = cleanAdminText(body.channel, 20) || "email";
        if (channel === "sms") {
          if (process.env.TLINK_SMS_SENDER_APPROVED !== "true") return adminJson({ ok: false, error: "Quote SMS stays unavailable until the approved sender gate is enabled." }, 409);
          return adminJson({ ok: false, error: "Quote SMS delivery is not enabled for this release." }, 409);
        }
        if (channel !== "email") return adminJson({ ok: false, error: "Choose email delivery or copy the secure link." }, 400);
        if (body.consentConfirmed !== true) return adminJson({ ok: false, error: "Confirm that this customer asked to receive the current quote by email." }, 400);
        if (link.status !== "active" || !link.token_hash) return adminJson({ ok: false, error: "Replace the secure link before sending it." }, 409);
        const providers = serviceReminderProviderConfiguration(); if (!providers.email.configured || !providers.email.callbacks) return adminJson({ ok: false, error: "The authenticated email provider is not ready." }, 503);
        const priorOptOut = await db.prepare("SELECT 1 stopped FROM trade_crm_quote_deliveries WHERE firebase_uid = ? AND crm_customer_id = ? AND channel = 'email' AND status = 'opted_out' LIMIT 1").bind(access.ownerUid, job.crm_customer_id).first<Row>();
        if (priorOptOut) return adminJson({ ok: false, error: "This customer has opted out of quote email delivery." }, 409);
        const idempotencyKey = `quote:${version.id}:${link.token_issue}:email:initial`; const existing = await db.prepare("SELECT id FROM trade_crm_quote_deliveries WHERE idempotency_key = ?").bind(idempotencyKey).first<Row>();
        if (!existing) {
          const secret = await recoverQuoteLinkSecret(String(link.encrypted_token), String(link.id), Number(link.token_issue), String(link.token_hash)); const shareUrl = `${new URL(request.url).origin}${quoteReviewPath(String(link.id), secret)}`; const email = String(version.acceptance_email || ""); const deliveryId = crypto.randomUUID();
          await db.prepare(`INSERT INTO trade_crm_quote_deliveries (id, quote_link_id, quote_version_id, work_order_id, firebase_uid, crm_customer_id, channel, provider, status, recipient_preview, consent_basis, idempotency_key, provider_message_id, provider_status, attempts, last_error, sent_at, delivered_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'email', 'resend', 'sending', ?, 'installer_confirmed_current_quote', ?, '', '', 1, '', '', '', ?, ?)`)
            .bind(deliveryId, link.id, version.id, workOrderId, access.ownerUid, job.crm_customer_id, maskPhotoRequestEmail(email), idempotencyKey, now, now).run();
          try {
            const sent = await sendServiceReminderProviderMessage({ channel: "email", recipient: email, subject: `Quote ${quote.quote_number} ready for review`, body: `Your quote is ready to review, ask questions, sign or decline:\n\n${shareUrl}\n\nThis private link expires ${String(link.expires_at).slice(0, 10)}.`, idempotencyKey, callbackUrl: `${new URL(request.url).origin}/api/service-reminder-provider-events/resend`, messageType: "trade_quote" });
            await db.batch([
              db.prepare("UPDATE trade_crm_quote_deliveries SET status = 'sent', provider_message_id = ?, provider_status = ?, sent_at = ?, updated_at = ? WHERE id = ?").bind(sent.providerMessageId, sent.providerStatus, now, now, deliveryId),
              db.prepare(`INSERT INTO trade_crm_quote_events (id, quote_link_id, quote_id, quote_version_id, work_order_id, firebase_uid, event_type, actor_type, summary, evidence_key, occurred_at) VALUES (?, ?, ?, ?, ?, ?, 'sent', 'office', 'Secure quote email sent.', ?, ?)`)
                .bind(crypto.randomUUID(), link.id, quote.id, version.id, workOrderId, access.ownerUid, `sent:${idempotencyKey}`, now),
            ]);
          } catch (error) { await db.prepare("UPDATE trade_crm_quote_deliveries SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?").bind(error instanceof Error ? error.message.slice(0, 180) : "Provider send failed.", now, deliveryId).run(); throw error; }
        }
      }
      return adminJson({ ok: true, quote: await quotePayload(access.ownerUid, workOrderId, true, new URL(request.url).origin) });
    }
    return adminJson({ ok: false, error: "Unsupported quote action." }, 400);
  } catch (error) { return errorResponse(error); }
}
