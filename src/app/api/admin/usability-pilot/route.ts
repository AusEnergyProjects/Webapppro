import { getD1 } from "../../../../../db";
import { adminError, adminJson, cleanAdminText, requireAdminIdentity, sameOrigin, writeAdminAudit } from "@/lib/admin-server";
import { createAdminNotification } from "@/lib/admin-notifications";

export const runtime = "edge";

const PILOT_STATUSES = new Set(["recruiting", "active", "reviewing", "completed", "paused"]);
const PARTICIPANT_STATUSES = new Set(["invited", "onboarding", "active", "feedback_due", "completed", "paused", "withdrawn"]);
const SESSION_TYPES = new Set(["onboarding", "first_customer", "first_job", "field_work", "office_workflow", "weekly_review", "final_review"]);
const SESSION_STATUSES = new Set(["scheduled", "completed", "cancelled"]);

function jsonList(value: unknown) {
  try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

function pilot(row: Record<string, unknown>) {
  return {
    id: String(row.id), name: String(row.name), goal: String(row.goal), targetParticipants: Number(row.target_participants),
    status: String(row.status), startsAt: String(row.starts_at || ""), endsAt: String(row.ends_at || ""),
    successCriteria: jsonList(row.success_criteria), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function participant(row: Record<string, unknown>) {
  return {
    id: String(row.id), pilotId: String(row.pilot_id), firebaseUid: String(row.firebase_uid), slotNumber: Number(row.slot_number),
    businessName: String(row.business_name_snapshot), baselineSystem: String(row.baseline_system || ""), teamSize: Number(row.team_size || 1),
    primaryTrade: String(row.primary_trade || ""), status: String(row.status), ownerUid: String(row.owner_uid || ""),
    ownerName: String(row.owner_name || ""), nextAction: String(row.next_action || ""), invitedAt: String(row.invited_at),
    completedAt: String(row.completed_at || ""), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function session(row: Record<string, unknown>) {
  return {
    id: String(row.id), pilotId: String(row.pilot_id), participantId: String(row.participant_id), sessionType: String(row.session_type),
    status: String(row.status), scheduledAt: String(row.scheduled_at || ""), completedAt: String(row.completed_at || ""),
    durationMinutes: Number(row.duration_minutes || 0), tasksAttempted: Number(row.tasks_attempted || 0), tasksCompleted: Number(row.tasks_completed || 0),
    easeScore: Number(row.ease_score || 0), confidenceScore: Number(row.confidence_score || 0), feedback: String(row.feedback || ""),
    observedFrictions: jsonList(row.observed_frictions), nextAction: String(row.next_action || ""),
    facilitatorUid: String(row.facilitator_uid), facilitatorName: String(row.facilitator_name || ""), createdAt: String(row.created_at),
  };
}

async function payload() {
  const db = getD1();
  const [pilots, participants, sessions, candidates, admins] = await Promise.all([
    db.prepare("SELECT * FROM admin_usability_pilots ORDER BY created_at DESC").all<Record<string, unknown>>(),
    db.prepare(`SELECT p.*, COALESCE(a.display_name, a.email, '') owner_name FROM admin_usability_pilot_participants p
      LEFT JOIN admin_users a ON a.firebase_uid = p.owner_uid ORDER BY p.pilot_id, p.slot_number`).all<Record<string, unknown>>(),
    db.prepare(`SELECT s.*, COALESCE(a.display_name, a.email, '') facilitator_name FROM admin_usability_pilot_sessions s
      LEFT JOIN admin_users a ON a.firebase_uid = s.facilitator_uid ORDER BY s.scheduled_at DESC, s.created_at DESC`).all<Record<string, unknown>>(),
    db.prepare(`SELECT firebase_uid, business_name, address_state, postcode, capabilities FROM trade_accounts
      WHERE partner_type = 'installer' AND account_status = 'active' AND COALESCE(is_synthetic, 0) = 0
      ORDER BY business_name LIMIT 500`).all<Record<string, unknown>>(),
    db.prepare("SELECT firebase_uid, email, display_name, role FROM admin_users WHERE status = 'active' ORDER BY display_name, email").all<Record<string, unknown>>(),
  ]);
  const mappedSessions = sessions.results.map(session);
  const mappedParticipants = participants.results.map(participant).map((item) => ({ ...item, sessions: mappedSessions.filter((entry) => entry.participantId === item.id) }));
  const completedSessions = mappedSessions.filter((item) => item.status === "completed");
  const tasksAttempted = completedSessions.reduce((total, item) => total + item.tasksAttempted, 0);
  const scored = completedSessions.filter((item) => item.easeScore > 0);
  const confident = completedSessions.filter((item) => item.confidenceScore > 0);
  return {
    pilots: pilots.results.map(pilot), participants: mappedParticipants,
    candidates: candidates.results.map((item) => ({ firebaseUid: item.firebase_uid, businessName: item.business_name, addressState: item.address_state, postcode: item.postcode, capabilities: jsonList(item.capabilities) })),
    admins: admins.results.map((item) => ({ firebaseUid: item.firebase_uid, name: item.display_name || item.email, role: item.role })),
    metrics: {
      participantCount: mappedParticipants.length, completedParticipants: mappedParticipants.filter((item) => item.status === "completed").length,
      completedSessions: completedSessions.length, taskCompletionRate: tasksAttempted ? Math.round(completedSessions.reduce((total, item) => total + item.tasksCompleted, 0) / tasksAttempted * 100) : 0,
      averageEase: scored.length ? Number((scored.reduce((total, item) => total + item.easeScore, 0) / scored.length).toFixed(1)) : 0,
      averageConfidence: confident.length ? Number((confident.reduce((total, item) => total + item.confidenceScore, 0) / confident.length).toFixed(1)) : 0,
      openFrictions: completedSessions.reduce((total, item) => total + item.observedFrictions.length, 0),
    },
  };
}

function requestError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "PILOT_NOT_FOUND") return adminJson({ ok: false, error: "Pilot not found." }, 404);
  if (code === "PARTICIPANT_NOT_FOUND") return adminJson({ ok: false, error: "Pilot participant not found." }, 404);
  if (code === "SLOT_TAKEN") return adminJson({ ok: false, error: "That pilot slot is already assigned." }, 409);
  if (code === "ACCOUNT_ALREADY_ADDED") return adminJson({ ok: false, error: "That installer is already in this pilot." }, 409);
  if (code === "LIVE_INSTALLER_REQUIRED") return adminJson({ ok: false, error: "Choose an active live installer account." }, 400);
  return adminError(error);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try { await requireAdminIdentity(request); return adminJson({ ok: true, ...(await payload()) }); }
  catch (error) { return requestError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin", "reviewer", "support"]);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid pilot request." }, 400); }
    const action = cleanAdminText(body.action, 40);
    const db = getD1();
    const now = new Date().toISOString();
    if (action === "add_participant") {
      if (!new Set(["owner", "admin"]).has(admin.role)) return adminJson({ ok: false, error: "Only an owner or administrator can add pilot businesses." }, 403);
      const pilotId = cleanAdminText(body.pilotId, 180);
      const firebaseUid = cleanAdminText(body.firebaseUid, 180);
      const slotNumber = Math.floor(Number(body.slotNumber || 0));
      const pilotRow = await db.prepare("SELECT id, target_participants FROM admin_usability_pilots WHERE id = ?").bind(pilotId).first<Record<string, unknown>>();
      if (!pilotRow) throw new Error("PILOT_NOT_FOUND");
      if (slotNumber < 1 || slotNumber > Number(pilotRow.target_participants || 5)) return adminJson({ ok: false, error: "Choose an open pilot slot." }, 400);
      const account = await db.prepare(`SELECT firebase_uid, business_name, capabilities FROM trade_accounts WHERE firebase_uid = ?
        AND partner_type = 'installer' AND account_status = 'active' AND COALESCE(is_synthetic, 0) = 0`).bind(firebaseUid).first<Record<string, unknown>>();
      if (!account) throw new Error("LIVE_INSTALLER_REQUIRED");
      const existing = await db.prepare("SELECT firebase_uid, slot_number FROM admin_usability_pilot_participants WHERE pilot_id = ? AND (firebase_uid = ? OR slot_number = ?)")
        .bind(pilotId, firebaseUid, slotNumber).first<Record<string, unknown>>();
      if (existing?.firebase_uid === firebaseUid) throw new Error("ACCOUNT_ALREADY_ADDED");
      if (existing) throw new Error("SLOT_TAKEN");
      const id = crypto.randomUUID();
      const capabilities = jsonList(account.capabilities);
      await db.prepare(`INSERT INTO admin_usability_pilot_participants
        (id, pilot_id, firebase_uid, slot_number, business_name_snapshot, baseline_system, team_size, primary_trade,
         status, owner_uid, next_action, invited_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'invited', ?, ?, ?, ?, ?)`)
        .bind(id, pilotId, firebaseUid, slotNumber, account.business_name, cleanAdminText(body.baselineSystem, 100),
          Math.max(1, Math.min(10000, Math.floor(Number(body.teamSize || 1)))), cleanAdminText(body.primaryTrade, 80) || String(capabilities[0] || "other"),
          cleanAdminText(body.ownerUid, 180) || admin.uid, cleanAdminText(body.nextAction, 300) || "Arrange the onboarding session.", now, now, now).run();
      await writeAdminAudit(admin, "pilot.participant_added", "usability_pilot_participant", id, `Added ${String(account.business_name)} to field pilot slot ${slotNumber}.`, { pilotId, firebaseUid, slotNumber });
      return adminJson({ ok: true, ...(await payload()) }, 201);
    }
    if (action === "log_session") {
      const participantId = cleanAdminText(body.participantId, 180);
      const participantRow = await db.prepare("SELECT id, pilot_id, business_name_snapshot FROM admin_usability_pilot_participants WHERE id = ?").bind(participantId).first<Record<string, unknown>>();
      if (!participantRow) throw new Error("PARTICIPANT_NOT_FOUND");
      const sessionType = cleanAdminText(body.sessionType, 40);
      const status = cleanAdminText(body.status, 20) || "completed";
      if (!SESSION_TYPES.has(sessionType) || !SESSION_STATUSES.has(status)) return adminJson({ ok: false, error: "Choose a valid session type and status." }, 400);
      const tasksAttempted = Math.max(0, Math.min(50, Math.floor(Number(body.tasksAttempted || 0))));
      const tasksCompleted = Math.max(0, Math.min(tasksAttempted, Math.floor(Number(body.tasksCompleted || 0))));
      const easeScore = status === "completed" ? Math.max(1, Math.min(5, Math.floor(Number(body.easeScore || 0)))) : 0;
      const confidenceScore = status === "completed" ? Math.max(1, Math.min(5, Math.floor(Number(body.confidenceScore || 0)))) : 0;
      const frictions = cleanAdminText(body.observedFrictions, 3000).split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 20);
      const id = crypto.randomUUID();
      const scheduledAt = cleanAdminText(body.scheduledAt, 40);
      const completedAt = status === "completed" ? now : "";
      await db.batch([
        db.prepare(`INSERT INTO admin_usability_pilot_sessions
          (id, pilot_id, participant_id, session_type, status, scheduled_at, completed_at, duration_minutes,
           tasks_attempted, tasks_completed, ease_score, confidence_score, feedback, observed_frictions, next_action,
           facilitator_uid, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(id, participantRow.pilot_id, participantId, sessionType, status, scheduledAt, completedAt,
            Math.max(0, Math.min(480, Math.floor(Number(body.durationMinutes || 0)))), tasksAttempted, tasksCompleted,
            easeScore, confidenceScore, cleanAdminText(body.feedback, 4000), JSON.stringify(frictions), cleanAdminText(body.nextAction, 500), admin.uid, now, now),
        db.prepare(`UPDATE admin_usability_pilot_participants SET status = ?, next_action = ?, updated_at = ? WHERE id = ?`)
          .bind(status === "completed" ? (sessionType === "final_review" ? "completed" : "active") : "onboarding", cleanAdminText(body.nextAction, 500), now, participantId),
      ]);
      await writeAdminAudit(admin, "pilot.session_logged", "usability_pilot_session", id, `Logged ${sessionType.replaceAll("_", " ")} for ${String(participantRow.business_name_snapshot)}.`, { participantId, tasksAttempted, tasksCompleted, easeScore, confidenceScore });
      if (status === "completed" && (easeScore <= 2 || confidenceScore <= 2 || frictions.length >= 3)) await createAdminNotification({
        eventKey: `pilot-friction:${id}`, eventType: "pilot.usability_friction", category: "account", priority: easeScore <= 2 ? "high" : "normal",
        title: "Field pilot friction needs review", summary: `${String(participantRow.business_name_snapshot)} reported a low score or several workflow frictions. Review the session and assign a product follow-up.`,
        entityType: "usability_pilot_session", entityId: id, actorType: "admin", actorUid: admin.uid, requiresAction: true,
        metadata: { participantId, easeScore, confidenceScore, frictionCount: frictions.length }, occurredAt: now,
      });
      return adminJson({ ok: true, ...(await payload()) }, 201);
    }
    return adminJson({ ok: false, error: "Unsupported pilot action." }, 400);
  } catch (error) { return requestError(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin", "reviewer", "support"]);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid pilot update." }, 400); }
    const action = cleanAdminText(body.action, 40);
    const db = getD1();
    const now = new Date().toISOString();
    if (action === "update_pilot") {
      if (!new Set(["owner", "admin"]).has(admin.role)) return adminJson({ ok: false, error: "Only an owner or administrator can change the pilot schedule." }, 403);
      const id = cleanAdminText(body.pilotId, 180);
      const status = cleanAdminText(body.status, 20);
      if (!PILOT_STATUSES.has(status)) return adminJson({ ok: false, error: "Choose a valid pilot status." }, 400);
      const result = await db.prepare("UPDATE admin_usability_pilots SET status = ?, starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ?")
        .bind(status, cleanAdminText(body.startsAt, 40), cleanAdminText(body.endsAt, 40), now, id).run();
      if (!result.meta.changes) throw new Error("PILOT_NOT_FOUND");
      await writeAdminAudit(admin, "pilot.updated", "usability_pilot", id, `Field pilot marked ${status}.`);
      return adminJson({ ok: true, ...(await payload()) });
    }
    if (action === "update_participant") {
      const id = cleanAdminText(body.participantId, 180);
      const status = cleanAdminText(body.status, 30);
      if (!PARTICIPANT_STATUSES.has(status)) return adminJson({ ok: false, error: "Choose a valid participant status." }, 400);
      const result = await db.prepare(`UPDATE admin_usability_pilot_participants SET status = ?, baseline_system = ?, team_size = ?,
        primary_trade = ?, owner_uid = ?, next_action = ?, completed_at = ?, updated_at = ? WHERE id = ?`)
        .bind(status, cleanAdminText(body.baselineSystem, 100), Math.max(1, Math.min(10000, Math.floor(Number(body.teamSize || 1)))),
          cleanAdminText(body.primaryTrade, 80), cleanAdminText(body.ownerUid, 180), cleanAdminText(body.nextAction, 500),
          status === "completed" ? now : "", now, id).run();
      if (!result.meta.changes) throw new Error("PARTICIPANT_NOT_FOUND");
      await writeAdminAudit(admin, "pilot.participant_updated", "usability_pilot_participant", id, `Pilot participant marked ${status}.`);
      return adminJson({ ok: true, ...(await payload()) });
    }
    return adminJson({ ok: false, error: "Unsupported pilot update." }, 400);
  } catch (error) { return requestError(error); }
}
