import { getD1 } from "../../../../../db";
import {
  adminError,
  adminJson,
  cleanAdminText,
  parseJsonList,
  requireAdminIdentity,
  sameOrigin,
  writeAdminAudit,
} from "@/lib/admin-server";

export const runtime = "edge";

const STATUSES = new Set([
  "new",
  "needs_information",
  "acknowledged",
  "contacting",
  "quote_ready",
  "shared_with_trades",
  "resolved",
  "withdrawn",
]);
const MUTABLE_STATUSES = new Set([
  "acknowledged",
  "contacting",
  "quote_ready",
  "resolved",
  "withdrawn",
]);
const TRANSITIONS: Record<string, ReadonlySet<string>> = {
  new: new Set(["acknowledged", "contacting", "quote_ready", "resolved", "withdrawn"]),
  needs_information: new Set(["acknowledged", "contacting", "resolved", "withdrawn"]),
  acknowledged: new Set(["contacting", "quote_ready", "resolved", "withdrawn"]),
  contacting: new Set(["acknowledged", "quote_ready", "resolved", "withdrawn"]),
  quote_ready: new Set(["acknowledged", "contacting", "resolved", "withdrawn"]),
  shared_with_trades: new Set(["contacting", "resolved"]),
  resolved: new Set(["acknowledged", "contacting"]),
  withdrawn: new Set([]),
};

function parseJson(value: unknown, fallback: unknown) {
  try {
    return JSON.parse(String(value || "")) as unknown;
  } catch {
    return fallback;
  }
}

function shapeLead(row: Record<string, unknown>, detail = false) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    postcode: row.postcode,
    suburb: row.suburb,
    state: row.residential_state,
    services: parseJsonList(row.service_categories_json),
    quoteBrief: parseJson(row.quote_brief_json, {}),
    interestConfirmed: Boolean(row.interest_confirmed),
    sourceRequestId: row.source_request_id,
    serviceConsent: {
      noticeVersion: row.service_consent_version,
      purpose: row.service_consent_purpose,
      grantedAt: row.service_consent_granted_at,
    },
    marketingConsent: Boolean(row.marketing_consent),
    marketingConsentGrantedAt: row.marketing_consent_granted_at,
    tradeSharing: {
      accepted: Boolean(row.trade_sharing_consent),
      noticeVersion: row.trade_sharing_notice_version,
      purpose: row.trade_sharing_purpose,
      grantedAt: row.trade_sharing_granted_at,
      disclosedFields: parseJsonList(row.trade_disclosed_fields_json),
      snapshotSha256: row.trade_disclosed_snapshot_sha256,
      ...(detail ? { snapshot: parseJson(row.trade_disclosed_snapshot_json, {}) } : {}),
    },
    opportunityId: row.opportunity_id,
    status: row.status,
    assignedToUid: row.assigned_to_uid,
    assigneeName: row.assignee_name,
    dueAt: row.due_at,
    latestNote: row.latest_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function detailFor(id: string) {
  const db = getD1();
  const lead = await db.prepare(`SELECT lead.*,
      assignee.display_name assignee_name,
      (SELECT note FROM energy_assistant_lead_events latest
       WHERE latest.lead_id = lead.id AND latest.note <> ''
       ORDER BY datetime(latest.created_at) DESC, latest.id DESC LIMIT 1) latest_note
    FROM energy_assistant_leads lead
    LEFT JOIN admin_users assignee
      ON assignee.firebase_uid = lead.assigned_to_uid
    WHERE lead.id = ? LIMIT 1`).bind(id).first<Record<string, unknown>>();
  if (!lead) return null;
  const events = await db.prepare(`SELECT event.id, event.actor_type, event.actor_uid,
      event.action, event.note, event.metadata_json, event.created_at,
      administrator.display_name actor_name
    FROM energy_assistant_lead_events event
    LEFT JOIN admin_users administrator
      ON administrator.firebase_uid = event.actor_uid
    WHERE event.lead_id = ?
    ORDER BY datetime(event.created_at) DESC, event.id DESC
    LIMIT 200`).bind(id).all<Record<string, unknown>>();
  return {
    ...shapeLead(lead, true),
    events: events.results.map((event) => ({
      id: event.id,
      actorType: event.actor_type,
      actorUid: event.actor_uid,
      actorName: event.actor_name,
      action: event.action,
      note: event.note,
      metadata: parseJson(event.metadata_json, {}),
      createdAt: event.created_at,
    })),
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request);
    const url = new URL(request.url);
    const id = cleanAdminText(url.searchParams.get("id"), 180);
    if (id) {
      const lead = await detailFor(id);
      return lead
        ? adminJson({ ok: true, lead })
        : adminJson({ ok: false, error: "Energy Guide follow-up request not found." }, 404);
    }

    const status = cleanAdminText(url.searchParams.get("status"), 30);
    const search = cleanAdminText(url.searchParams.get("search"), 100).toLowerCase();
    const assignment = cleanAdminText(url.searchParams.get("assignment"), 30);
    const clauses: string[] = [];
    const bindings: unknown[] = [];
    if (STATUSES.has(status)) {
      clauses.push("lead.status = ?");
      bindings.push(status);
    }
    if (assignment === "unassigned") clauses.push("lead.assigned_to_uid = ''");
    if (assignment === "assigned") clauses.push("lead.assigned_to_uid <> ''");
    if (search) {
      const term = `%${search}%`;
      clauses.push(`(
        LOWER(lead.name) LIKE ? OR LOWER(COALESCE(lead.email, '')) LIKE ?
        OR LOWER(COALESCE(lead.phone, '')) LIKE ? OR lead.postcode LIKE ?
        OR LOWER(lead.suburb) LIKE ?
      )`);
      bindings.push(term, term, term, term, term);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await getD1().prepare(`SELECT lead.*,
      assignee.display_name assignee_name,
      (SELECT note FROM energy_assistant_lead_events latest
       WHERE latest.lead_id = lead.id AND latest.note <> ''
       ORDER BY datetime(latest.created_at) DESC, latest.id DESC LIMIT 1) latest_note
      FROM energy_assistant_leads lead
      LEFT JOIN admin_users assignee ON assignee.firebase_uid = lead.assigned_to_uid
      ${where}
      ORDER BY
        CASE lead.status
          WHEN 'needs_information' THEN 0 WHEN 'quote_ready' THEN 1 WHEN 'new' THEN 2
          WHEN 'acknowledged' THEN 3 WHEN 'contacting' THEN 4
          WHEN 'shared_with_trades' THEN 5 WHEN 'resolved' THEN 6 ELSE 7 END,
        CASE WHEN lead.due_at = '' THEN 1 ELSE 0 END,
        datetime(lead.due_at), datetime(lead.created_at) DESC
      LIMIT 200`).bind(...bindings).all<Record<string, unknown>>();
    return adminJson({ ok: true, leads: rows.results.map((row) => shapeLead(row)) });
  } catch (error) {
    return adminError(error);
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin", "support"]);
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return adminJson({ ok: false, error: "Invalid follow-up update." }, 400);
    }
    const allowedKeys = new Set(["id", "status", "assignedToUid", "dueAt", "note"]);
    if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
      return adminJson({ ok: false, error: "The follow-up update contained an unsupported field." }, 400);
    }
    const id = cleanAdminText(body.id, 180);
    const status = body.status === undefined ? "" : cleanAdminText(body.status, 30);
    let assignedToUid = body.assignedToUid === undefined
      ? undefined
      : cleanAdminText(body.assignedToUid, 180);
    if (assignedToUid === "self") assignedToUid = admin.uid;
    const dueAtInput = body.dueAt === undefined ? undefined : cleanAdminText(body.dueAt, 50);
    const note = body.note === undefined ? "" : cleanAdminText(body.note, 1_000);
    if (!id || (status && (!STATUSES.has(status) || !MUTABLE_STATUSES.has(status)))) {
      return adminJson({ ok: false, error: "Choose a valid follow-up request and status." }, 400);
    }
    let dueAt: string | undefined;
    if (dueAtInput !== undefined) {
      if (!dueAtInput) dueAt = "";
      else if (!Number.isFinite(Date.parse(dueAtInput))) {
        return adminJson({ ok: false, error: "Choose a valid follow-up due time." }, 400);
      } else dueAt = new Date(dueAtInput).toISOString();
    }
    if (!status && assignedToUid === undefined && dueAt === undefined && !note) {
      return adminJson({ ok: false, error: "Choose a status, assignment, due time or note to update." }, 400);
    }

    const db = getD1();
    const current = await db.prepare(`SELECT id, status, assigned_to_uid, due_at,
        quote_brief_json, updated_at
      FROM energy_assistant_leads WHERE id = ? LIMIT 1`)
      .bind(id).first<Record<string, unknown>>();
    if (!current) return adminJson({ ok: false, error: "Energy Guide follow-up request not found." }, 404);
    if (status && status !== current.status && !TRANSITIONS[String(current.status)]?.has(status)) {
      return adminJson({ ok: false, error: "That follow-up status change is not permitted." }, 409);
    }
    const currentQuoteBrief = parseJson(current.quote_brief_json, {}) as Record<string, unknown>;
    const currentReadiness = currentQuoteBrief.readiness && typeof currentQuoteBrief.readiness === "object"
      ? currentQuoteBrief.readiness as Record<string, unknown>
      : {};
    const currentMissingQuestions = Array.isArray(currentReadiness.missingQuestionIds)
      ? currentReadiness.missingQuestionIds
      : [];
    const currentInsufficientServices = Array.isArray(currentReadiness.insufficientKnownServiceIds)
      ? currentReadiness.insufficientKnownServiceIds
      : [];
    if (
      status === "quote_ready"
      && (
        currentReadiness.state !== "quote_ready"
        || currentMissingQuestions.length > 0
        || currentInsufficientServices.length > 0
      )
    ) {
      return adminJson({
        ok: false,
        error: "The structured brief still has required unanswered items and cannot be marked quote ready.",
      }, 409);
    }
    if (assignedToUid) {
      const assignee = await db.prepare(`SELECT firebase_uid FROM admin_users
        WHERE firebase_uid = ? AND status = 'active' LIMIT 1`)
        .bind(assignedToUid).first();
      if (!assignee) return adminJson({ ok: false, error: "Choose an active operations user." }, 400);
    }

    const currentStatus = String(current.status);
    const currentAssignedToUid = String(current.assigned_to_uid);
    const currentDueAt = String(current.due_at);
    const currentUpdatedAt = String(current.updated_at);
    const statusChanged = Boolean(status && status !== currentStatus);
    const assignmentChanged = assignedToUid !== undefined
      && assignedToUid !== currentAssignedToUid;
    const dueChanged = dueAt !== undefined && dueAt !== currentDueAt;
    if (!statusChanged && !assignmentChanged && !dueChanged && !note) {
      return adminJson({ ok: false, error: "No follow-up changes were supplied." }, 400);
    }

    const currentUpdatedTime = Date.parse(currentUpdatedAt);
    const nowBase = new Date(Number.isFinite(currentUpdatedTime)
      ? Math.max(Date.now(), currentUpdatedTime + 1)
      : Date.now()).toISOString();
    const revisionDigits = crypto.randomUUID()
      .replaceAll("-", "")
      .split("")
      .map((character) => String(Number.parseInt(character, 16) % 10))
      .join("");
    const now = `${nowBase.slice(0, -1)}${revisionDigits}Z`;
    const nextStatus = statusChanged ? status : currentStatus;
    const nextAssignedToUid = assignmentChanged
      ? String(assignedToUid)
      : currentAssignedToUid;
    const nextDueAt = dueChanged ? String(dueAt) : currentDueAt;
    const committedStateGuardSql = `EXISTS (
      SELECT 1 FROM energy_assistant_leads committed
      WHERE committed.id = ? AND committed.status = ?
        AND committed.assigned_to_uid = ? AND committed.due_at = ?
        AND committed.updated_at = ?
    )`;
    const committedStateBindings = [
      id,
      nextStatus,
      nextAssignedToUid,
      nextDueAt,
      now,
    ];
    const assignments: string[] = [];
    const updateBindings: unknown[] = [];
    const eventStatements: D1PreparedStatement[] = [];
    if (statusChanged) {
      assignments.push("status = ?");
      updateBindings.push(status);
      eventStatements.push(db.prepare(`INSERT INTO energy_assistant_lead_events
        (id, lead_id, actor_type, actor_uid, action, note, metadata_json, created_at)
        SELECT ?, ?, 'admin', ?, 'status_changed', '', ?, ?
        WHERE ${committedStateGuardSql}`)
        .bind(
          crypto.randomUUID(),
          id,
          admin.uid,
          JSON.stringify({ from: currentStatus, to: status }),
          now,
          ...committedStateBindings,
        ));
    }
    if (assignmentChanged) {
      assignments.push("assigned_to_uid = ?");
      updateBindings.push(assignedToUid);
      eventStatements.push(db.prepare(`INSERT INTO energy_assistant_lead_events
        (id, lead_id, actor_type, actor_uid, action, note, metadata_json, created_at)
        SELECT ?, ?, 'admin', ?, 'assigned', '', ?, ?
        WHERE ${committedStateGuardSql}`)
        .bind(
          crypto.randomUUID(),
          id,
          admin.uid,
          JSON.stringify({ from: currentAssignedToUid, to: assignedToUid }),
          now,
          ...committedStateBindings,
        ));
    }
    if (dueChanged) {
      assignments.push("due_at = ?");
      updateBindings.push(dueAt);
      eventStatements.push(db.prepare(`INSERT INTO energy_assistant_lead_events
        (id, lead_id, actor_type, actor_uid, action, note, metadata_json, created_at)
        SELECT ?, ?, 'admin', ?, 'due_changed', '', ?, ?
        WHERE ${committedStateGuardSql}`)
        .bind(
          crypto.randomUUID(),
          id,
          admin.uid,
          JSON.stringify({ from: currentDueAt, to: dueAt }),
          now,
          ...committedStateBindings,
        ));
    }
    if (note) {
      eventStatements.push(db.prepare(`INSERT INTO energy_assistant_lead_events
        (id, lead_id, actor_type, actor_uid, action, note, metadata_json, created_at)
        SELECT ?, ?, 'admin', ?, 'note_added', ?, '{}', ?
        WHERE ${committedStateGuardSql}`)
        .bind(
          crypto.randomUUID(),
          id,
          admin.uid,
          note,
          now,
          ...committedStateBindings,
        ));
    }
    assignments.push("updated_at = ?");
    updateBindings.push(now);
    const updateStatement = db.prepare(`UPDATE energy_assistant_leads
      SET ${assignments.join(", ")}
      WHERE id = ? AND status = ? AND assigned_to_uid = ? AND due_at = ?
        AND updated_at = ?`)
      .bind(
        ...updateBindings,
        id,
        currentStatus,
        currentAssignedToUid,
        currentDueAt,
        currentUpdatedAt,
      );
    const [updateResult] = await db.batch([updateStatement, ...eventStatements]);
    if (Number(updateResult.meta?.changes || 0) !== 1) {
      return adminJson({
        ok: false,
        error: "This follow-up changed while you were editing it. Reload it and try again.",
      }, 409);
    }
    await writeAdminAudit(
      admin,
      "energy_assistant_lead.update",
      "energy_assistant_lead",
      id,
      `Updated Energy Guide follow-up request${status ? ` to ${status}` : ""}.`,
      {
        status: nextStatus,
        assignmentChanged,
        dueChanged,
        noteAdded: Boolean(note),
      },
    );
    const lead = await detailFor(id);
    return adminJson({ ok: true, lead });
  } catch (error) {
    return adminError(error);
  }
}
