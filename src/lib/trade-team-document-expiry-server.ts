const WARNING_WINDOW_DAYS = 30;
const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;
const TEAM_WORKSPACE_URL =
  "https://compare.ausenergyassessments.com/direct-trade/dashboard?workspace=team";

type ExpiryCandidate = {
  owner_uid: string;
  team_member_id: string;
  file_id: string;
  document_title: string;
  member_name: string;
  expires_at: string;
};

export type TradeTeamDocumentExpiryWarningRow = ExpiryCandidate & {
  id: string;
  created_at: string;
};

type ExpiryDeliveryRow = TradeTeamDocumentExpiryWarningRow & {
  email_status: string;
  email_attempts: number;
  email_idempotency_key: string;
};

type ExpiryDeliveryContext = {
  owner_email: string;
  business_name: string;
  member_status: string;
};

type EmailMessage = {
  channel: "email";
  recipient: string;
  subject: string;
  body: string;
  callbackUrl: string;
  idempotencyKey: string;
  messageType: string;
};

type EmailResult = {
  provider: string;
  providerMessageId: string;
  providerStatus: string;
};

type SendEmail = (message: EmailMessage) => Promise<EmailResult>;

function boundedLimit(value: number, maximum: number, fallback: number) {
  return Math.max(1, Math.min(maximum, Math.floor(Number(value) || fallback)));
}

function isoDate(now: Date) {
  return now.toISOString().slice(0, 10);
}

function boundedError(error: unknown) {
  return (error instanceof Error ? error.message : "Document expiry email failed.")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, 300);
}

function validEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function retryAt(attempts: number, now: Date) {
  const minutes = [5, 30, 120, 360, 720][
    Math.min(Math.max(Number(attempts) - 1, 0), 4)
  ];
  return new Date(now.getTime() + minutes * 60 * 1000).toISOString();
}

function eventKey(candidate: ExpiryCandidate) {
  return `team-document-expiry:${candidate.owner_uid}:${candidate.file_id}:${candidate.expires_at}`;
}

async function idempotencyKey(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export function tradeTeamDocumentExpiryEmail(row: ExpiryDeliveryRow, businessName: string) {
  const expiry = displayDate(row.expires_at);
  const teamUrl = `${TEAM_WORKSPACE_URL}&teamMemberId=${encodeURIComponent(row.team_member_id)}`;
  return {
    subject: `${row.member_name}: ${row.document_title} expires soon`,
    body: `${row.document_title} for ${row.member_name} expires on ${expiry}.\n\nOpen Team in TLink to review or replace the document:\n${teamUrl}\n\n${businessName || "TLink"}`,
    teamUrl,
  };
}

export async function enqueueTradeTeamDocumentExpiryWarnings({
  db,
  now = new Date(),
  limit = 200,
}: {
  db: D1Database;
  now?: Date;
  limit?: number;
}) {
  const today = isoDate(now);
  const candidates = await db.prepare(`SELECT file.owner_uid, file.team_member_id, file.id file_id,
      COALESCE(NULLIF(trim(file.title), ''), file.file_name) document_title,
      COALESCE(NULLIF(trim(member.first_name || ' ' || member.last_name), ''),
        NULLIF(trim(member.display_name), ''), 'Team member') member_name,
      file.expires_at
    FROM trade_team_member_files file
    JOIN trade_team_members member
      ON member.id = file.team_member_id AND member.owner_uid = file.owner_uid
    WHERE file.status = 'active'
      AND file.expires_at <> ''
      AND date(file.expires_at) = file.expires_at
      AND date(file.expires_at) BETWEEN date(?) AND date(?, '+' || ? || ' days')
      AND member.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM trade_team_document_expiry_warnings warning
        WHERE warning.owner_uid = file.owner_uid
          AND warning.file_id = file.id
          AND warning.expires_at = file.expires_at
      )
    ORDER BY file.expires_at, file.owner_uid, file.id
    LIMIT ?`)
    .bind(today, today, WARNING_WINDOW_DAYS, boundedLimit(limit, 500, 200))
    .all<ExpiryCandidate>();

  let enqueued = 0;
  for (const candidate of candidates.results) {
    const key = eventKey(candidate);
    const createdAt = now.toISOString();
    const result = await db.prepare(`INSERT OR IGNORE INTO trade_team_document_expiry_warnings
      (id, event_key, owner_uid, team_member_id, file_id, document_title, member_name,
       expires_at, email_status, email_attempts, email_next_attempt_at,
       email_last_attempt_at, email_provider, email_provider_message_id,
       email_idempotency_key, email_last_error, emailed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, '', '', '', '', ?, '', '', ?, ?)`)
      .bind(crypto.randomUUID(), key, candidate.owner_uid, candidate.team_member_id,
        candidate.file_id, candidate.document_title, candidate.member_name,
        candidate.expires_at, await idempotencyKey(key), createdAt, createdAt)
      .run();
    enqueued += Number(result.meta.changes || 0);
  }
  return { scanned: candidates.results.length, enqueued };
}

export async function listTradeTeamDocumentExpiryWarnings(
  db: D1Database,
  ownerUid: string,
  limit = 80,
) {
  const rows = await db.prepare(`SELECT warning.id, warning.owner_uid,
      warning.team_member_id, warning.file_id, warning.document_title,
      warning.member_name, warning.expires_at, warning.created_at
    FROM trade_team_document_expiry_warnings warning
    JOIN trade_team_member_files file
      ON file.id = warning.file_id AND file.owner_uid = warning.owner_uid
        AND file.team_member_id = warning.team_member_id
        AND file.status = 'active' AND file.expires_at = warning.expires_at
    JOIN trade_team_members member
      ON member.id = warning.team_member_id AND member.owner_uid = warning.owner_uid
        AND member.status = 'active'
    WHERE warning.owner_uid = ?
    ORDER BY warning.created_at DESC, warning.id DESC
    LIMIT ?`)
    .bind(ownerUid, boundedLimit(limit, 100, 80))
    .all<TradeTeamDocumentExpiryWarningRow>();
  return rows.results;
}

async function recoverInterruptedDeliveries(db: D1Database, now: Date) {
  const current = now.toISOString();
  const cutoff = new Date(now.getTime() - CLAIM_TIMEOUT_MS).toISOString();
  await db.prepare(`UPDATE trade_team_document_expiry_warnings
    SET email_status = 'failed', email_next_attempt_at = ?,
      email_last_error = 'Recovered an interrupted email attempt.', updated_at = ?
    WHERE email_status = 'sending'
      AND email_last_attempt_at <> ''
      AND email_last_attempt_at <= ?`)
    .bind(current, current, cutoff)
    .run();
}

async function deliveryContext(db: D1Database, row: ExpiryDeliveryRow, today: string) {
  return db.prepare(`SELECT account.email owner_email, account.business_name,
      member.status member_status
    FROM trade_accounts account
    JOIN trade_team_member_files file
      ON file.id = ? AND file.owner_uid = account.firebase_uid
        AND file.team_member_id = ? AND file.status = 'active'
        AND file.expires_at = ?
        AND date(file.expires_at) BETWEEN date(?) AND date(?, '+' || ? || ' days')
    JOIN trade_team_members member
      ON member.id = file.team_member_id AND member.owner_uid = file.owner_uid
    WHERE account.firebase_uid = ? AND account.account_status = 'active'`)
    .bind(row.file_id, row.team_member_id, row.expires_at, today, today,
      WARNING_WINDOW_DAYS, row.owner_uid)
    .first<ExpiryDeliveryContext>();
}

export async function drainTradeTeamDocumentExpiryEmails({
  db,
  emailConfigured,
  sendEmail,
  now = new Date(),
  limit = 20,
}: {
  db: D1Database;
  emailConfigured: boolean;
  sendEmail: SendEmail;
  now?: Date;
  limit?: number;
}) {
  if (!emailConfigured) return { attempted: 0, sent: 0, failed: 0, skipped: 0, deferred: 0, configured: false };
  await recoverInterruptedDeliveries(db, now);
  const current = now.toISOString();
  const rows = await db.prepare(`SELECT id, owner_uid, team_member_id, file_id,
      document_title, member_name, expires_at, email_status, email_attempts,
      email_idempotency_key, created_at
    FROM trade_team_document_expiry_warnings
    WHERE email_status IN ('pending', 'failed')
      AND (email_next_attempt_at = '' OR email_next_attempt_at <= ?)
    ORDER BY created_at, id
    LIMIT ?`)
    .bind(current, boundedLimit(limit, 50, 20))
    .all<ExpiryDeliveryRow>();

  let attempted = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let deferred = 0;
  const today = isoDate(now);
  for (const row of rows.results) {
    const attempts = Number(row.email_attempts || 0) + 1;
    const claim = await db.prepare(`UPDATE trade_team_document_expiry_warnings
      SET email_status = 'sending', email_attempts = ?, email_next_attempt_at = '',
        email_last_attempt_at = ?, email_last_error = '', updated_at = ?
      WHERE id = ? AND owner_uid = ? AND email_status = ? AND email_attempts = ?`)
      .bind(attempts, current, current, row.id, row.owner_uid,
        row.email_status, Number(row.email_attempts || 0))
      .run();
    if (Number(claim.meta.changes || 0) !== 1) continue;
    attempted += 1;

    const context = await deliveryContext(db, row, today);
    if (!context) {
      await db.prepare(`UPDATE trade_team_document_expiry_warnings
        SET email_status = 'skipped', email_last_error = 'The document expiry changed or is no longer active.',
          updated_at = ?
        WHERE id = ? AND owner_uid = ? AND email_status = 'sending' AND email_attempts = ?`)
        .bind(current, row.id, row.owner_uid, attempts)
        .run();
      skipped += 1;
      continue;
    }

    if (String(context.member_status || "") !== "active") {
      const expired = row.expires_at < today;
      await db.prepare(`UPDATE trade_team_document_expiry_warnings
        SET email_status = ?, email_next_attempt_at = ?, email_last_error = ?, updated_at = ?
        WHERE id = ? AND owner_uid = ? AND email_status = 'sending' AND email_attempts = ?`)
        .bind(expired ? "skipped" : "failed",
          expired ? "" : new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(),
          expired
            ? "The former team member document expired while access was inactive."
            : "Email deferred while team member access is inactive.",
          current, row.id, row.owner_uid, attempts)
        .run();
      if (expired) skipped += 1;
      else deferred += 1;
      continue;
    }

    const ownerEmail = String(context.owner_email || "").trim().toLowerCase();
    if (!validEmail(ownerEmail)) {
      await db.prepare(`UPDATE trade_team_document_expiry_warnings
        SET email_status = 'failed', email_next_attempt_at = ?,
          email_last_error = 'The business owner email is not valid.', updated_at = ?
        WHERE id = ? AND owner_uid = ? AND email_status = 'sending' AND email_attempts = ?`)
        .bind(retryAt(attempts, now), current, row.id, row.owner_uid, attempts)
        .run();
      failed += 1;
      continue;
    }

    try {
      const draft = tradeTeamDocumentExpiryEmail(row, String(context.business_name || ""));
      const result = await sendEmail({
        channel: "email",
        recipient: ownerEmail,
        subject: draft.subject,
        body: draft.body,
        callbackUrl: draft.teamUrl,
        idempotencyKey: row.email_idempotency_key,
        messageType: "team_document_expiry",
      });
      const completed = await db.prepare(`UPDATE trade_team_document_expiry_warnings
        SET email_status = 'sent', email_provider = ?, email_provider_message_id = ?,
          email_last_error = '', emailed_at = ?, updated_at = ?
        WHERE id = ? AND owner_uid = ? AND email_status = 'sending' AND email_attempts = ?`)
        .bind(result.provider, result.providerMessageId, current, current,
          row.id, row.owner_uid, attempts)
        .run();
      if (Number(completed.meta.changes || 0) === 1) sent += 1;
    } catch (error) {
      await db.prepare(`UPDATE trade_team_document_expiry_warnings
        SET email_status = 'failed', email_next_attempt_at = ?, email_last_error = ?,
          updated_at = ?
        WHERE id = ? AND owner_uid = ? AND email_status = 'sending' AND email_attempts = ?`)
        .bind(retryAt(attempts, now), boundedError(error), current,
          row.id, row.owner_uid, attempts)
        .run();
      failed += 1;
    }
  }
  return { attempted, sent, failed, skipped, deferred, configured: true };
}
