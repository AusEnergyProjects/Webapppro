import type { ComplianceIdentity } from "./compliance-access-server";
import { creditexPermissionSql, hasCreditexPermission } from "./creditex-permissions.ts";
import {
  reminderProviderFailureOutcome,
  sendServiceReminderProviderMessage,
  serviceReminderProviderConfiguration,
  type ReminderProviderMessage,
} from "./service-reminder-delivery.ts";

export type CreditexInvitationEmailDelivery = {
  status: "not_sent" | "submitted" | "failed" | "unknown" | "sending";
  message: string;
  attemptedAt?: string;
};

type Row = Record<string, unknown>;
type Runtime = Record<string, string | undefined>;
type EmailInput = { invitationId: string; displayName: string; email: string; workspaceName: string; expiresAt: string; origin: string };
type DispatchOptions = { origin: string; runtime?: Runtime; fetchImpl?: typeof fetch };
const REQUEST_EVENT = "membership.invitation_email_requested";
const RESULT_EVENT = "membership.invitation_email_result";
const COOLDOWN_MS = 2 * 60 * 1000;
// Resend retains idempotency keys for 24 hours. Leave margin before that boundary.
const SAFE_RETRY_MS = 23 * 60 * 60 * 1000;

export class CreditexInvitationEmailError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) { super(message); this.code = code; this.status = status; }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
}

/** The invitation contains no login token, password or customer/work information. */
export function creditexInvitationEmail(input: EmailInput) {
  const setupUrl = new URL("/creditex/compliance", input.origin);
  setupUrl.searchParams.set("invite", input.invitationId);
  const url = setupUrl.href;
  const expires = new Intl.DateTimeFormat("en-AU", {
    dateStyle: "long", timeStyle: "short", timeZone: "Australia/Sydney",
  }).format(new Date(input.expiresAt));
  const expiry = `${expires} (Sydney time)`;
  const subject = `You're invited to ${input.workspaceName} on TLink`;
  const body = `Hi ${input.displayName},\n\nYou've been invited to join ${input.workspaceName} on TLink.\n\nAccept your invitation: ${url}\n\nYour invited email: ${input.email}\n\nNew to TLink? Choose Create account and enter a password. You'll be signed in automatically. Confirm your email using the verification link we send, then return to open Creditex.\n\nAlready use TLink? Choose Sign in and use your existing password, or Continue with Google using your invited email. Use Forgot password? to email yourself a reset link.\n\nAccept your invitation before ${expiry}.\n\nNeed help? Contact the person who invited you. If you weren't expecting this invitation, you can ignore this email.\n\nTLink | Australian Energy Assessments`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:#eef3f5;color:#183b42;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">You've been invited to ${escapeHtml(input.workspaceName)}. Create an account or sign in.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef3f5;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;border-collapse:separate;background:#ffffff;border-radius:18px;overflow:hidden;">
<tr><td style="padding:30px 32px;background:#082d37;border-top:5px solid #9368bc;color:#ffffff;"><div style="font-size:27px;font-weight:bold;letter-spacing:-1px;">TLink<span style="color:#74ddc4;">.</span></div><p style="margin:22px 0 10px;font-size:12px;font-weight:bold;letter-spacing:2px;color:#74ddc4;">YOU'RE INVITED</p><h1 style="margin:0;font-size:29px;line-height:1.2;color:#ffffff;">Your ${escapeHtml(input.workspaceName)} team is waiting.</h1><p style="margin:14px 0 0;font-size:17px;line-height:1.6;color:#dcecf0;">Join ${escapeHtml(input.workspaceName)} on TLink.</p></td></tr>
<tr><td style="padding:30px 32px;"><p style="margin:0 0 18px;font-size:18px;line-height:1.6;">Hi ${escapeHtml(input.displayName)},</p><p style="margin:0 0 24px;font-size:16px;line-height:1.7;">You've been invited to your team's workspace. Open your invitation below to create an account or sign in.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" bgcolor="#087a68" style="border-radius:10px;"><a href="${escapeHtml(url)}" style="display:block;padding:18px 20px;font-size:17px;font-weight:bold;text-decoration:none;color:#ffffff;">Accept your invitation</a></td></tr></table>
<div style="margin:26px 0 22px;padding:18px 20px;background:#f2f8f7;border-left:4px solid #087a68;border-radius:8px;"><p style="margin:0 0 6px;font-size:13px;font-weight:bold;color:#42646a;">YOUR INVITED EMAIL</p><p style="margin:0;font-size:16px;font-weight:bold;overflow-wrap:anywhere;">${escapeHtml(input.email)}</p></div>
<p style="margin:0 0 14px;font-size:15px;line-height:1.7;"><strong>New to TLink?</strong> Choose <strong>Create account</strong> and enter a password. You'll be signed in automatically. Confirm your email using the verification link we send, then return to open Creditex.</p>
<p style="margin:0 0 14px;font-size:15px;line-height:1.7;"><strong>Already use TLink?</strong> Choose <strong>Sign in</strong> and use your existing password, or <strong>Continue with Google</strong> using your invited email.</p><p style="margin:0 0 22px;font-size:15px;line-height:1.7;">Use <strong>Forgot password?</strong> to email yourself a reset link. Need help? Contact the person who invited you.</p>
<p style="margin:0;padding-top:20px;border-top:1px solid #e3ecee;font-size:14px;line-height:1.7;color:#526b71;">Accept before <strong>${escapeHtml(expiry)}</strong>.</p></td></tr>
<tr><td style="padding:22px 32px;background:#f6f8fa;font-size:12px;line-height:1.7;color:#61757b;">If you weren't expecting this invitation, you can ignore this email.<br><br>Button not opening? Copy this link into your browser:<br><a href="${escapeHtml(url)}" style="color:#087a68;overflow-wrap:anywhere;">${escapeHtml(url)}</a><br><br><strong>TLink</strong> · Australian Energy Assessments</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, body, html };
}

function metadata(value: unknown): Row {
  try { const parsed: unknown = JSON.parse(String(value || "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Row : {}; }
  catch { return {}; }
}

function deliveryFor(request: Row | null, now = Date.now()): CreditexInvitationEmailDelivery {
  if (!request) return { status: "not_sent", message: "Invitation saved. No email has been submitted." };
  const result = metadata(request.result_metadata);
  const attemptedAt = String(request.created_at);
  const status = result.status;
  if (status === "submitted") return { status, attemptedAt, message: "Invitation email submitted. Inbox delivery is not confirmed." };
  if (status === "failed") return { status, attemptedAt, message: String(result.message || "The invitation email could not be submitted. Try again.") };
  if (status === "unknown") return { status, attemptedAt, message: "The email provider's response could not be confirmed. Retry to check the same email request." };
  if (now - Date.parse(attemptedAt) < COOLDOWN_MS) return { status: "sending", attemptedAt, message: "Invitation email is being submitted. Refresh shortly." };
  return { status: "unknown", attemptedAt, message: "The last email request has no confirmed result. Retry to check the same request." };
}

async function latestRequest(database: D1Database, organisationId: string, invitationId: string) {
  return database.prepare(`SELECT requested.id, requested.metadata, requested.created_at, result.metadata result_metadata
    FROM compliance_audit_events requested
    LEFT JOIN compliance_audit_events result ON result.id = requested.id || ':result'
      AND result.organisation_id = requested.organisation_id AND result.event_type = ?
    WHERE requested.organisation_id = ? AND requested.target_type = 'compliance_invitation'
      AND requested.target_id = ? AND requested.event_type = ?
    ORDER BY requested.created_at DESC, requested.id DESC LIMIT 1`)
    .bind(RESULT_EVENT, organisationId, invitationId, REQUEST_EVENT).first<Row>();
}

export async function loadCreditexInvitationEmailDelivery(database: D1Database, organisationId: string, invitationId: string) {
  return deliveryFor(await latestRequest(database, organisationId, invitationId));
}

export async function loadCreditexInvitationEmailDeliveries(database: D1Database, organisationId: string, invitationIds: string[]) {
  if (!invitationIds.length) return new Map<string, CreditexInvitationEmailDelivery>();
  // D1 allows 100 bindings per statement; leave three for organisation/event scope.
  const requestGroups = await Promise.all(Array.from({ length: Math.ceil(invitationIds.length / 97) }, (_, index) => {
    const targets = invitationIds.slice(index * 97, (index + 1) * 97);
    return database.prepare(`SELECT requested.target_id, requested.id, requested.metadata, requested.created_at, result.metadata result_metadata
    FROM compliance_audit_events requested
    LEFT JOIN compliance_audit_events result ON result.id = requested.id || ':result'
      AND result.organisation_id = requested.organisation_id AND result.event_type = ?
    WHERE requested.organisation_id = ? AND requested.target_type = 'compliance_invitation'
      AND requested.target_id IN (${targets.map(() => "?").join(",")}) AND requested.event_type = ?
      AND NOT EXISTS (SELECT 1 FROM compliance_audit_events newer WHERE newer.organisation_id = requested.organisation_id
        AND newer.target_type = requested.target_type AND newer.target_id = requested.target_id AND newer.event_type = requested.event_type
        AND (newer.created_at > requested.created_at OR (newer.created_at = requested.created_at AND newer.id > requested.id)))`)
      .bind(RESULT_EVENT, organisationId, ...targets, REQUEST_EVENT).all<Row>();
  }));
  const deliveries = new Map(requestGroups.flatMap(requests => requests.results.map(request => [String(request.target_id), deliveryFor(request)] as const)));
  return new Map(invitationIds.map(id => [id, deliveries.get(id) || deliveryFor(null)]));
}

function authoritySql() {
  return `EXISTS (SELECT 1 FROM compliance_users member JOIN compliance_organisations organisation ON organisation.id = member.organisation_id
    WHERE member.id = ? AND member.firebase_uid = ? AND member.organisation_id = ? AND member.role = ?
      AND member.status = 'active' AND organisation.status = 'active' AND ${creditexPermissionSql("team_access")})`;
}

async function currentInvitation(database: D1Database, identity: ComplianceIdentity, invitationId: string, now: string) {
  const row = await database.prepare(`SELECT invitation.id, invitation.email, invitation.display_name, invitation.expires_at,
      organisation.trading_name, organisation.legal_name
    FROM compliance_invitations invitation JOIN compliance_organisations organisation ON organisation.id = invitation.organisation_id
    WHERE invitation.id = ? AND invitation.organisation_id = ? AND invitation.status = 'pending'
      AND invitation.claimed_by_uid = '' AND invitation.claimed_at = '' AND invitation.expires_at > ? AND ${authoritySql()}`)
    .bind(invitationId, identity.organisationId, now, identity.membershipId, identity.uid, identity.organisationId, identity.role).first<Row>();
  if (!row) throw new CreditexInvitationEmailError("CREDITEX_INVITATION_EMAIL_UNAVAILABLE", 409, "The pending invitation or your team access has changed. Refresh the team list.");
  return row;
}

/** Atomic append-only reservation, followed by a current-authority check before provider dispatch. */
export async function sendCreditexInvitationEmail(database: D1Database, identity: ComplianceIdentity, invitationId: string, options: DispatchOptions) {
  if (!hasCreditexPermission(identity, "team_access")) throw new CreditexInvitationEmailError("CREDITEX_ROLE_REQUIRED", 403, "Your team access does not include sending invitations.");
  if (!invitationId || invitationId.length > 180) throw new CreditexInvitationEmailError("CREDITEX_REQUEST_INVALID", 400, "Choose a valid invitation.");
  const now = new Date().toISOString();
  const invitation = await currentInvitation(database, identity, invitationId, now);
  const previous = await latestRequest(database, identity.organisationId, invitationId);
  const previousDelivery = deliveryFor(previous);
  if (previous && Date.now() - Date.parse(String(previous.created_at)) < COOLDOWN_MS) return previousDelivery;
  const prior = metadata(previous?.metadata);
  const retryUncertain = previous && (previousDelivery.status === "unknown" || previousDelivery.status === "sending");
  if (retryUncertain && Date.now() - Date.parse(String(prior.firstAttemptAt || previous.created_at)) >= SAFE_RETRY_MS) {
    return { ...previousDelivery, status: "unknown" as const, message: "The previous provider result is still unconfirmed. Check it with your email administrator before sending another invitation." };
  }
  const requestId = crypto.randomUUID();
  const idempotencyKey = retryUncertain ? String(prior.idempotencyKey) : `creditex-invitation-${requestId}`;
  const firstAttemptAt = retryUncertain ? String(prior.firstAttemptAt) : now;
  let message: ReminderProviderMessage;
  if (retryUncertain) {
    const saved = prior.message;
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw new CreditexInvitationEmailError("CREDITEX_INVITATION_EMAIL_UNAVAILABLE", 409, "The previous email request needs administrator review.");
    const fields = saved as Record<string, unknown>;
    if (fields.recipient !== String(invitation.email) || fields.idempotencyKey !== idempotencyKey || fields.channel !== "email"
      || typeof fields.subject !== "string" || typeof fields.body !== "string" || typeof fields.html !== "string") {
      throw new CreditexInvitationEmailError("CREDITEX_INVITATION_EMAIL_UNAVAILABLE", 409, "The previous email request no longer matches the invitation.");
    }
    message = { channel: "email", recipient: String(invitation.email), subject: fields.subject, body: fields.body, html: fields.html,
      idempotencyKey, callbackUrl: "", messageType: "creditex_invitation" };
  } else {
    message = { channel: "email", recipient: String(invitation.email), ...creditexInvitationEmail({
      invitationId: String(invitation.id),
      displayName: String(invitation.display_name), email: String(invitation.email),
      workspaceName: String(invitation.trading_name || invitation.legal_name), expiresAt: String(invitation.expires_at), origin: options.origin,
    }), idempotencyKey, callbackUrl: "", messageType: "creditex_invitation" };
  }
  const reservation = await database.prepare(`INSERT INTO compliance_audit_events
      (id, organisation_id, actor_type, actor_uid, event_type, target_type, target_id, summary, metadata, created_at)
    SELECT ?, ?, 'compliance', ?, ?, 'compliance_invitation', ?, 'A named TLink invitation email was requested.', ?, ?
    WHERE ${authoritySql()} AND EXISTS (SELECT 1 FROM compliance_invitations invitation WHERE invitation.id = ?
      AND invitation.organisation_id = ? AND invitation.status = 'pending' AND invitation.claimed_by_uid = ''
      AND invitation.claimed_at = '' AND invitation.expires_at > ?)
      AND COALESCE((SELECT id FROM compliance_audit_events WHERE organisation_id = ? AND target_type = 'compliance_invitation'
        AND target_id = ? AND event_type = ? ORDER BY created_at DESC, id DESC LIMIT 1), '') = ?`)
    .bind(requestId, identity.organisationId, identity.uid, REQUEST_EVENT, invitationId, JSON.stringify({ idempotencyKey, firstAttemptAt, message }), now,
      identity.membershipId, identity.uid, identity.organisationId, identity.role, invitationId, identity.organisationId, now,
      identity.organisationId, invitationId, REQUEST_EVENT, String(previous?.id || "")).run();
  if (Number(reservation.meta.changes) !== 1) {
    await currentInvitation(database, identity, invitationId, new Date().toISOString());
    return loadCreditexInvitationEmailDelivery(database, identity.organisationId, invitationId);
  }
  let delivery: CreditexInvitationEmailDelivery;
  let providerMessageId = "";
  try {
    await currentInvitation(database, identity, invitationId, new Date().toISOString());
    if (!serviceReminderProviderConfiguration(options.runtime).email.configured) {
      delivery = { status: "failed", attemptedAt: now, message: "The invitation is saved, but outgoing email is not configured. Ask your administrator to check the email connection." };
    } else {
      const result = await sendServiceReminderProviderMessage(message, { runtime: options.runtime,
        fetchImpl: (url, init) => (options.fetchImpl || fetch)(url, { ...init, signal: AbortSignal.timeout(15_000) }) });
      providerMessageId = result.providerMessageId;
      delivery = { status: "submitted", attemptedAt: now, message: "Invitation email submitted. Inbox delivery is not confirmed." };
    }
  } catch (error) {
    delivery = { status: reminderProviderFailureOutcome(error) === "indeterminate" ? "unknown" : "failed", attemptedAt: now,
      message: error instanceof CreditexInvitationEmailError ? "Team access or invitation changed before the email was submitted. Refresh the team list."
        : reminderProviderFailureOutcome(error) === "indeterminate" ? "The email provider's response could not be confirmed. Retry to check the same email request."
          : "The email provider rejected the invitation. Ask your administrator to check the email connection, then try again." };
  }
  // Results remain recorded even if permissions changed while the provider processed the email.
  try { await database.prepare(`INSERT INTO compliance_audit_events
      (id, organisation_id, actor_type, actor_uid, event_type, target_type, target_id, summary, metadata, created_at)
    VALUES (?, ?, 'compliance', ?, ?, 'compliance_invitation', ?, 'A TLink invitation email request result was recorded.', ?, ?)`)
    .bind(`${requestId}:result`, identity.organisationId, identity.uid, RESULT_EVENT, invitationId,
      JSON.stringify({ status: delivery.status, message: delivery.message, provider: "resend", providerMessageId, requestId, idempotencyKey }), new Date().toISOString()).run(); }
  catch {
    console.error("Creditex invitation email result could not be recorded.");
    return { status: "unknown" as const, attemptedAt: now, message: "The invitation is saved, but the email result could not be recorded. Refresh before retrying." };
  }
  return delivery;
}
