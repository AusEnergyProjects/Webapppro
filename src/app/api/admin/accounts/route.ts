import { getD1 } from "../../../../../db";
import {
  adminAuditStatement,
  adminError,
  adminJson,
  cleanAdminText,
  parseJsonList,
  requireAdminIdentity,
  sameOrigin,
} from "@/lib/admin-server";
import {
  resolveEntitlements,
  type PartnerType,
} from "@/lib/direct-trade-entitlements";
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  keysetAfter,
  type KeysetDirection,
} from "@/lib/keyset-pagination";
import { performanceJson, routeTimer } from "@/lib/route-performance";
import { ftsPrefixQuery } from "@/lib/fts-search";
import { isValidAbn, normalizeAbn, officialAbnLookupUrl } from "@/lib/trade-abn";
import {
  approvedAbnAccess,
  approvedTradeReviewPredicate,
  verifiedTradeAccountPredicate,
} from "@/lib/trade-access-server";

export const runtime = "edge";

const ACCOUNT_STATUSES = new Set(["active", "suspended", "closed"]);
const VERIFICATION_STATUSES = new Set([
  "submitted",
  "under_review",
  "needs_information",
  "approved",
  "rejected",
  "expired",
]);
const REVIEW_METHODS = new Set(["official_abr_lookup", "document_review"]);
const TERMINAL_REVIEW_DECISIONS = new Set([
  "approved",
  "needs_information",
  "rejected",
  "expired",
]);
const AVAILABILITY_STATUSES = new Set(["open", "limited", "paused"]);
const PAGE_SIZES = new Set([25, 50, 100]);

type AccountSortTerm = {
  expression: string;
  direction: KeysetDirection;
  rowKey: string;
};
type AccountSort = { orderBy: string; terms: AccountSortTerm[] };
const term = (
  expression: string,
  direction: KeysetDirection,
  rowKey: string,
): AccountSortTerm => ({ expression, direction, rowKey });
const makeSort = (terms: AccountSortTerm[]): AccountSort => {
  const stable = [
    ...terms,
    term("firebase_uid", terms.at(-1)?.direction || "asc", "firebase_uid"),
  ];
  return {
    orderBy: stable
      .map((item) => `${item.expression} ${item.direction.toUpperCase()}`)
      .join(", "),
    terms: stable,
  };
};
const SORTS: Record<string, AccountSort> = {
  "updated-desc": makeSort([term("updated_at", "desc", "updated_at")]),
  "updated-asc": makeSort([term("updated_at", "asc", "updated_at")]),
  "name-asc": makeSort([
    term("business_name COLLATE NOCASE", "asc", "business_name"),
    term("updated_at", "desc", "updated_at"),
  ]),
  "name-desc": makeSort([
    term("business_name COLLATE NOCASE", "desc", "business_name"),
    term("updated_at", "desc", "updated_at"),
  ]),
  "type-asc": makeSort([
    term("partner_type COLLATE NOCASE", "asc", "partner_type"),
    term("business_name COLLATE NOCASE", "asc", "business_name"),
  ]),
  "type-desc": makeSort([
    term("partner_type COLLATE NOCASE", "desc", "partner_type"),
    term("business_name COLLATE NOCASE", "asc", "business_name"),
  ]),
  "verification-asc": makeSort([
    term("verification_status COLLATE NOCASE", "asc", "verification_status"),
    term("business_name COLLATE NOCASE", "asc", "business_name"),
  ]),
  "status-asc": makeSort([
    term("account_status COLLATE NOCASE", "asc", "account_status"),
    term("business_name COLLATE NOCASE", "asc", "business_name"),
  ]),
  "status-desc": makeSort([
    term("account_status COLLATE NOCASE", "desc", "account_status"),
    term("business_name COLLATE NOCASE", "asc", "business_name"),
  ]),
};

function cursorValues(sort: AccountSort, row: Record<string, unknown>) {
  return sort.terms.map((item) => String(row[item.rowKey] || ""));
}

function shapeAccount(row: Record<string, unknown>) {
  const account = {
    firebaseUid: String(row.firebase_uid || ""),
    email: String(row.email || ""),
    businessName: String(row.business_name || ""),
    abn: normalizeAbn(row.abn),
    contactName: String(row.contact_name || ""),
    phone: String(row.phone || ""),
    partnerType:
      row.partner_type === "supplier"
        ? "supplier"
        : row.partner_type === "installer"
          ? "installer"
          : "invalid",
    businessWebsite: String(row.business_website || ""),
    addressLine1: String(row.address_line_1 || ""),
    suburb: String(row.suburb || ""),
    addressState: String(row.address_state || ""),
    postcode: String(row.postcode || ""),
    serviceStates: parseJsonList(row.service_states),
    capabilities: parseJsonList(row.capabilities),
    summary: String(row.summary || ""),
    accountStatus: String(row.account_status || ""),
    verificationStatus: String(row.verification_status || ""),
    verifiedAbn: normalizeAbn(row.verified_abn),
    verificationReviewId: String(row.verification_review_id || ""),
    verificationReviewedAt: String(row.verification_reviewed_at || ""),
    verificationReviewedByUid: String(row.verification_reviewed_by_uid || ""),
    approvalReviewExists: Boolean(row.approval_review_exists),
    availabilityStatus: String(row.availability_status || ""),
    serviceBasePostcode: String(row.service_base_postcode || row.postcode || ""),
    serviceRadiusKm: Number(row.service_radius_km || 50),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
  };
  return {
    ...account,
    accessApproved: approvedAbnAccess(account),
    officialAbnLookupUrl: officialAbnLookupUrl(account.abn),
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) {
    return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  }
  try {
    await requireAdminIdentity(request);
    const db = getD1();
    const url = new URL(request.url);
    const uid = cleanAdminText(url.searchParams.get("uid"), 180);
    if (uid) {
      const account = await db
        .prepare(`SELECT account.*,
          CASE WHEN ${approvedTradeReviewPredicate("account")} THEN 1 ELSE 0 END approval_review_exists
          FROM trade_accounts account WHERE account.firebase_uid = ? LIMIT 1`)
        .bind(uid)
        .first<Record<string, unknown>>();
      if (!account) {
        return adminJson({ ok: false, error: "Business account not found." }, 404);
      }
      const [documents, notes, matches, reviews] = await Promise.all([
        db
          .prepare(`SELECT id, category, file_name, content_type, size_bytes, expiry_date, status, created_at, updated_at
            FROM verification_documents WHERE firebase_uid = ? ORDER BY created_at DESC LIMIT 100`)
          .bind(uid)
          .all<Record<string, unknown>>(),
        db
          .prepare(`SELECT n.id, n.note, n.created_at, COALESCE(a.display_name, a.email, 'Operations team') author
            FROM trade_account_notes n LEFT JOIN admin_users a ON a.firebase_uid = n.created_by_uid
            WHERE n.firebase_uid = ? ORDER BY n.created_at DESC LIMIT 100`)
          .bind(uid)
          .all<Record<string, unknown>>(),
        db
          .prepare(`SELECT m.id, m.status match_status, m.admin_note, m.partner_note, m.matched_at, m.updated_at,
            o.id opportunity_id, o.title, o.project_type, o.state, o.postcode, o.priority, o.timing, o.status opportunity_status
            FROM trade_opportunity_matches m JOIN trade_opportunities o ON o.id = m.opportunity_id
            WHERE m.firebase_uid = ? ORDER BY m.updated_at DESC LIMIT 100`)
          .bind(uid)
          .all<Record<string, unknown>>(),
        db
          .prepare(`SELECT id, abn, business_name, partner_type, legal_entity_name,
            decision, review_method, source_reference, note,
            reviewed_by_uid, reviewed_at
            FROM trade_account_verification_reviews
            WHERE firebase_uid = ? ORDER BY reviewed_at DESC LIMIT 100`)
          .bind(uid)
          .all<Record<string, unknown>>(),
      ]);
      const shaped = shapeAccount(account);
      return adminJson({
        ok: true,
        account: shaped,
        documents: documents.results,
        notes: notes.results,
        matches: matches.results,
        reviews: reviews.results,
        entitlements: resolveEntitlements(
          shaped.partnerType as PartnerType,
          shaped.accessApproved,
        ),
      });
    }

    const search = cleanAdminText(url.searchParams.get("search"), 100).toLowerCase();
    const status = cleanAdminText(url.searchParams.get("status"), 30);
    const partnerType = cleanAdminText(url.searchParams.get("partnerType"), 20);
    const verification = cleanAdminText(url.searchParams.get("verification"), 30);
    const timer = routeTimer();
    const sortValue = cleanAdminText(url.searchParams.get("sort"), 30);
    const sort = SORTS[sortValue] ? sortValue : "updated-desc";
    const requestedPage = Number(url.searchParams.get("page"));
    const requestedPageSize = Number(url.searchParams.get("pageSize"));
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const pageSize = PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : 25;
    const includeTotal = url.searchParams.get("total") !== "0";
    const cursorInput = cleanAdminText(url.searchParams.get("cursor"), 2000);
    const clauses: string[] = [];
    const bindings: unknown[] = [];
    if (search) {
      clauses.push(
        "firebase_uid IN (SELECT entity_id FROM tlink_account_search WHERE tlink_account_search MATCH ?)",
      );
      bindings.push(ftsPrefixQuery(search));
    }
    if (ACCOUNT_STATUSES.has(status)) {
      clauses.push("account_status = ?");
      bindings.push(status);
    }
    if (["installer", "supplier"].includes(partnerType)) {
      clauses.push("partner_type = ?");
      bindings.push(partnerType);
    }
    if (VERIFICATION_STATUSES.has(verification)) {
      clauses.push("verification_status = ?");
      bindings.push(verification);
    }
    const selectedSort = SORTS[sort];
    let cursor;
    try {
      cursor = decodeKeysetCursor(cursorInput, sort, selectedSort.terms.length);
    } catch {
      return adminJson(
        {
          ok: false,
          error: "This account page link has expired. Start again from the first page.",
        },
        400,
      );
    }
    if (page > 1 && !cursor) {
      return adminJson(
        {
          ok: false,
          error: "This account page link has expired. Start again from the first page.",
        },
        400,
      );
    }
    const rowClauses = [...clauses];
    const rowBindings = [...bindings];
    if (cursor) {
      const after = keysetAfter(selectedSort.terms, cursor);
      rowClauses.push(`(${after.sql})`);
      rowBindings.push(...after.bindings);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rowWhere = rowClauses.length
      ? `WHERE ${rowClauses.join(" AND ")}`
      : "";
    const [countRow, rows, counts] = await timer.databases([
      includeTotal
        ? db
            .prepare(`SELECT COUNT(*) total FROM trade_accounts ${where}`)
            .bind(...bindings)
            .first<Record<string, unknown>>()
        : Promise.resolve(null),
      db
        .prepare(`SELECT firebase_uid, email, business_name, abn, contact_name, phone, partner_type,
          address_state, postcode, service_states, capabilities, account_status, verification_status,
          verified_abn, verification_review_id, verification_reviewed_at,
          verification_reviewed_by_uid, availability_status,
          service_base_postcode, service_radius_km, created_at, updated_at
          , CASE WHEN ${approvedTradeReviewPredicate("trade_accounts")}
            THEN 1 ELSE 0 END approval_review_exists
          FROM trade_accounts ${rowWhere} ORDER BY ${selectedSort.orderBy} LIMIT ?`)
        .bind(...rowBindings, pageSize + 1)
        .all<Record<string, unknown>>(),
      db
        .prepare(`SELECT COUNT(*) total,
          SUM(CASE WHEN ${verifiedTradeAccountPredicate("trade_accounts")}
            THEN 1 ELSE 0 END) approved_access,
          SUM(CASE WHEN verification_status IN ('submitted', 'under_review', 'needs_information')
            OR (verification_status = 'approved'
              AND NOT (${verifiedTradeAccountPredicate("trade_accounts")}))
            THEN 1 ELSE 0 END) review_required,
          SUM(CASE WHEN account_status = 'suspended' THEN 1 ELSE 0 END) suspended
          FROM trade_accounts`)
        .first<Record<string, unknown>>(),
    ]);
    const total = countRow ? Number(countRow.total || 0) : undefined;
    const hasNext = rows.results.length > pageSize;
    const pageRows = rows.results.slice(0, pageSize);
    const nextCursor =
      hasNext && pageRows.length
        ? encodeKeysetCursor(
            sort,
            cursorValues(selectedSort, pageRows.at(-1)!),
          )
        : "";
    return performanceJson(
      {
        ok: true,
        accounts: pageRows.map(shapeAccount),
        counts: {
          total: Number(counts?.total || 0),
          approvedAccess: Number(counts?.approved_access || 0),
          reviewRequired: Number(counts?.review_required || 0),
          suspended: Number(counts?.suspended || 0),
        },
        pagination: {
          page,
          pageSize,
          total,
          pageCount:
            total === undefined ? undefined : Math.max(1, Math.ceil(total / pageSize)),
          hasNext,
          nextCursor,
        },
      },
      {
        db,
        routeKey: "admin.accounts",
        startedAt: timer.startedAt,
        dbDurationMs: timer.dbDurationMs,
        resultCount: pageRows.length,
        cursorUsed: Boolean(cursor),
      },
    );
  } catch (error) {
    return adminError(error);
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) {
    return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  }
  try {
    const admin = await requireAdminIdentity(request, [
      "owner",
      "admin",
      "reviewer",
    ]);
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return adminJson({ ok: false, error: "Invalid account update." }, 400);
    }
    const uid = cleanAdminText(body.firebaseUid, 180);
    if (!uid) {
      return adminJson({ ok: false, error: "Choose a business account." }, 400);
    }

    const db = getD1();
    const current = await db
      .prepare(`SELECT account.firebase_uid, account.business_name, account.abn,
        account.partner_type, account.account_status, account.verification_status,
        account.verified_abn, account.verification_review_id,
        account.verification_reviewed_at, account.verification_reviewed_by_uid,
        account.availability_status,
        CASE WHEN ${approvedTradeReviewPredicate("account")} THEN 1 ELSE 0 END approval_review_exists
        FROM trade_accounts account WHERE account.firebase_uid = ?`)
      .bind(uid)
      .first<Record<string, unknown>>();
    if (!current) {
      return adminJson({ ok: false, error: "Business account not found." }, 404);
    }

    const accountStatus =
      cleanAdminText(body.accountStatus, 30) || String(current.account_status);
    const verificationStatus =
      cleanAdminText(body.verificationStatus, 30) ||
      String(current.verification_status);
    const availabilityStatus =
      cleanAdminText(body.availabilityStatus, 30) ||
      String(current.availability_status);
    if (
      !ACCOUNT_STATUSES.has(accountStatus) ||
      !VERIFICATION_STATUSES.has(verificationStatus) ||
      !AVAILABILITY_STATUSES.has(availabilityStatus)
    ) {
      return adminJson(
        { ok: false, error: "One or more account settings are invalid." },
        400,
      );
    }
    if (
      admin.role === "reviewer" &&
      (accountStatus !== current.account_status ||
        availabilityStatus !== current.availability_status)
    ) {
      return adminJson(
        {
          ok: false,
          error:
            "Reviewers can record ABN verification decisions and internal notes only.",
        },
        403,
      );
    }

    const abn = normalizeAbn(current.abn);
    const legalEntityName = cleanAdminText(body.legalEntityName, 180);
    const reviewMethod = cleanAdminText(body.reviewMethod, 40);
    const sourceReference = cleanAdminText(body.sourceReference, 500);
    const note = cleanAdminText(body.note, 1200);
    const decisionChanged =
      verificationStatus !== String(current.verification_status);
    const currentApprovalProjectionValid =
      String(current.verification_status) === "approved" &&
      isValidAbn(abn) &&
      normalizeAbn(current.verified_abn) === abn &&
      Boolean(String(current.verification_review_id || "")) &&
      Boolean(String(current.verification_reviewed_at || "")) &&
      Boolean(String(current.verification_reviewed_by_uid || "")) &&
      Boolean(current.approval_review_exists);
    const approvalRequested =
      verificationStatus === "approved" &&
      (decisionChanged || !currentApprovalProjectionValid);
    const terminalDecisionChanged =
      decisionChanged && TERMINAL_REVIEW_DECISIONS.has(verificationStatus);
    const reviewRecordRequired = approvalRequested || terminalDecisionChanged;

    if (reviewRecordRequired && !note) {
      return adminJson(
        { ok: false, error: "Record the evidence and reason for this decision." },
        400,
      );
    }
    if (reviewRecordRequired && !REVIEW_METHODS.has(reviewMethod)) {
      return adminJson(
        {
          ok: false,
          error: "Choose how the ABN and business identity were reviewed.",
        },
        400,
      );
    }
    if (approvalRequested) {
      if (!isValidAbn(abn)) {
        return adminJson(
          {
            ok: false,
            error: "This account does not have a valid 11-digit ABN.",
          },
          400,
        );
      }
      if (!legalEntityName) {
        return adminJson(
          {
            ok: false,
            error: "Record the legal entity name shown in the ABN register.",
          },
          400,
        );
      }
      if (reviewMethod !== "official_abr_lookup") {
        return adminJson(
          {
            ok: false,
            error:
              "Approval requires confirmation against the official ABN Register record.",
          },
          400,
        );
      }
      const officialReference = officialAbnLookupUrl(abn);
      if (sourceReference !== officialReference) {
        return adminJson(
          {
            ok: false,
            error: "Confirm the account against its official ABN Register record.",
          },
          400,
        );
      }
      const duplicate = await db
        .prepare(
          "SELECT firebase_uid, business_name FROM trade_accounts WHERE verified_abn = ? AND firebase_uid <> ? LIMIT 1",
        )
        .bind(abn, uid)
        .first<Record<string, unknown>>();
      if (duplicate) {
        return adminJson(
          {
            ok: false,
            code: "ABN_ALREADY_APPROVED",
            error: `ABN ${abn} is already approved for ${String(
              duplicate.business_name || "another business account",
            )}. Add authorised people through team access instead.`,
          },
          409,
        );
      }
    }

    const now = new Date().toISOString();
    const reviewId = approvalRequested
      ? crypto.randomUUID()
      : verificationStatus === "approved"
        ? String(current.verification_review_id || "")
        : "";
    const reviewRecordId = reviewRecordRequired
      ? reviewId || crypto.randomUUID()
      : "";
    const verifiedAbn =
      verificationStatus === "approved"
        ? approvalRequested
          ? abn
          : normalizeAbn(current.verified_abn)
        : "";
    const verificationReviewedAt =
      verificationStatus === "approved"
        ? approvalRequested
          ? now
          : String(current.verification_reviewed_at || "")
        : "";
    const verificationReviewedByUid =
      verificationStatus === "approved"
        ? approvalRequested
          ? admin.uid
          : String(current.verification_reviewed_by_uid || "")
        : "";
    const statements = [
      db
        .prepare(`UPDATE trade_accounts SET account_status = ?, verification_status = ?,
          verified_abn = ?, verification_review_id = ?, verification_reviewed_at = ?,
          verification_reviewed_by_uid = ?, availability_status = ?, updated_at = ?
          WHERE firebase_uid = ? AND abn = ? AND business_name = ? AND partner_type = ?`)
        .bind(
          accountStatus,
          verificationStatus,
          verifiedAbn,
          reviewId,
          verificationReviewedAt,
          verificationReviewedByUid,
          availabilityStatus,
          now,
          uid,
          abn,
          String(current.business_name || ""),
          String(current.partner_type || ""),
        ),
    ];
    if (reviewRecordRequired) {
      statements.push(
        db
          .prepare(`INSERT INTO trade_account_verification_reviews
            (id, firebase_uid, abn, business_name, partner_type, legal_entity_name,
              decision, review_method,
              source_reference, note, reviewed_by_uid, reviewed_at)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM trade_accounts reviewed_account
              WHERE reviewed_account.firebase_uid = ?
                AND reviewed_account.abn = ?
                AND reviewed_account.business_name = ?
                AND reviewed_account.partner_type = ?
                AND reviewed_account.verification_status = ?
                AND reviewed_account.verification_review_id = ?
            )`)
          .bind(
            reviewRecordId,
            uid,
            abn,
            String(current.business_name || ""),
            String(current.partner_type || ""),
            legalEntityName || String(current.business_name || ""),
            verificationStatus,
            reviewMethod,
            sourceReference,
            note,
            admin.uid,
            now,
            uid,
            abn,
            String(current.business_name || ""),
            String(current.partner_type || ""),
            verificationStatus,
            reviewId,
          ),
      );
    }
    if (note) {
      if (reviewRecordRequired) {
        statements.push(
          db
            .prepare(`INSERT INTO trade_account_notes
              (id, firebase_uid, note, created_by_uid, created_at)
              SELECT ?, ?, ?, ?, ?
              WHERE EXISTS (
                SELECT 1 FROM trade_account_verification_reviews
                WHERE id = ? AND firebase_uid = ?
              )`)
            .bind(
              crypto.randomUUID(),
              uid,
              note,
              admin.uid,
              now,
              reviewRecordId,
              uid,
            ),
        );
      } else {
        statements.push(
          db
            .prepare(`INSERT INTO trade_account_notes
              (id, firebase_uid, note, created_by_uid, created_at)
              VALUES (?, ?, ?, ?, ?)`)
            .bind(crypto.randomUUID(), uid, note, admin.uid, now),
        );
      }
    }
    if (reviewRecordRequired) {
      statements.push(
        db
          .prepare(`UPDATE admin_notifications SET status = 'resolved',
            read_at = CASE WHEN read_at = '' THEN ? ELSE read_at END,
            read_by_uid = CASE WHEN read_by_uid = '' THEN ? ELSE read_by_uid END,
            resolved_at = ?, resolved_by_uid = ?, resolution_note = ?, updated_at = ?
            WHERE actor_uid = ? AND category = 'approval' AND status != 'resolved'
              AND event_type IN (
                'trade.signup',
                'trade.identity_review_required',
                'trade.verification_evidence_uploaded'
              )
              AND EXISTS (
                SELECT 1 FROM trade_accounts reviewed_account
                WHERE reviewed_account.firebase_uid = ?
                  AND reviewed_account.abn = ?
                  AND reviewed_account.business_name = ?
                  AND reviewed_account.partner_type = ?
                  AND reviewed_account.verification_status = ?
              )`)
          .bind(
            now,
            admin.uid,
            now,
            admin.uid,
            `ABN review: ${verificationStatus}`,
            now,
            uid,
            uid,
            abn,
            String(current.business_name || ""),
            String(current.partner_type || ""),
            verificationStatus,
          ),
      );
    }
    const auditAction = reviewRecordRequired
      ? "trade_account.abn_review"
      : "trade_account.update";
    const auditSummary = reviewRecordRequired
      ? `Recorded ${verificationStatus} ABN review decision for the reviewed identity snapshot.`
      : "Updated the trade account without changing its ABN review decision.";
    const auditMetadata = {
      before: current,
      after: {
        accountStatus,
        verificationStatus,
        verifiedAbn,
        availabilityStatus,
        legalEntityName,
        reviewMethod,
        sourceReference,
      },
      noteAdded: Boolean(note),
    };
    if (reviewRecordRequired) {
      statements.push(
        db
          .prepare(`INSERT INTO admin_audit_log
            (id, admin_uid, action, entity_type, entity_id, summary, metadata, created_at)
            SELECT ?, ?, ?, 'trade_account', ?, ?, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM trade_account_verification_reviews
              WHERE id = ? AND firebase_uid = ?
            )`)
          .bind(
            crypto.randomUUID(),
            admin.uid,
            auditAction,
            uid,
            auditSummary,
            JSON.stringify(auditMetadata).slice(0, 4000),
            now,
            reviewRecordId,
            uid,
          ),
      );
    } else {
      statements.push(
        adminAuditStatement(
          db,
          admin,
          auditAction,
          "trade_account",
          uid,
          auditSummary,
          auditMetadata,
        ),
      );
    }
    const results = await db.batch(statements);
    if (!results[0]?.meta.changes) {
      return adminJson(
        {
          ok: false,
          code: "ACCOUNT_IDENTITY_CHANGED",
          error:
            "The business identity changed while this review was open. Reload the account and review the current ABN, business name and account type.",
        },
        409,
      );
    }
    return adminJson({ ok: true });
  } catch (error) {
    if (
      error instanceof Error &&
      /UNIQUE constraint failed: trade_accounts\.verified_abn/.test(error.message)
    ) {
      return adminJson(
        {
          ok: false,
          code: "ABN_ALREADY_APPROVED",
          error:
            "That ABN was approved for another business account while this review was being saved. Add authorised people through team access instead.",
        },
        409,
      );
    }
    return adminError(error);
  }
}
