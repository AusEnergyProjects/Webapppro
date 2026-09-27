import { env } from 'cloudflare:workers';
import { getD1 } from '../../db';
import { encryptProtectedPayload, decryptProtectedPayload, integrationStateHash, newIntegrationState } from './trade-integration-crypto';
import { verifiedTradeAccountPredicate } from './trade-access-server';
import { ReminderProviderDeliveryError, sendServiceReminderProviderMessage, serviceReminderProviderConfiguration, type ReminderProviderMessage } from './service-reminder-delivery';
import { buildEmailAuthorizationUrl, exchangeEmailCode, getEmailIdentity, refreshEmailCredentials, sendMailboxEmail, TradeEmailProviderError, type TradeEmailProvider, type EmailCredentials } from './trade-email-provider';

type EmailEnvironment = {
  CRM_INTEGRATION_ENCRYPTION_KEY?: string;
  GOOGLE_EMAIL_CLIENT_ID?: string; GOOGLE_EMAIL_CLIENT_SECRET?: string; GOOGLE_EMAIL_ENABLED?: string;
  MICROSOFT_EMAIL_CLIENT_ID?: string; MICROSOFT_EMAIL_CLIENT_SECRET?: string; MICROSOFT_EMAIL_ENABLED?: string;
};
type Connection = {
  owner_uid: string; id: string; provider: TradeEmailProvider; external_id: string;
  sender_email: string; display_name: string; encrypted_credentials: string;
  status: 'connected' | 'reconnect_required' | 'disconnected'; last_test_at: string; last_error: string;
};
type Submission = {
  id: string; content_hash: string; status: 'sending' | 'accepted' | 'failed' | 'uncertain';
  provider: TradeEmailProvider | 'resend'; provider_message_id: string; retry_after: string; sender_email: string; error_code: string;
};
type State = { owner_uid: string; provider: TradeEmailProvider; encrypted_verifier: string; redirect_uri: string };

export function isTradeEmailProvider(value: unknown): value is TradeEmailProvider { return value === 'google' || value === 'microsoft'; }
function settings(provider: TradeEmailProvider) {
  const values: EmailEnvironment = env;
  return provider === 'google'
    ? { clientId: values.GOOGLE_EMAIL_CLIENT_ID || '', clientSecret: values.GOOGLE_EMAIL_CLIENT_SECRET || '', enabled: values.GOOGLE_EMAIL_ENABLED === 'true' }
    : { clientId: values.MICROSOFT_EMAIL_CLIENT_ID || '', clientSecret: values.MICROSOFT_EMAIL_CLIENT_SECRET || '', enabled: values.MICROSOFT_EMAIL_ENABLED === 'true' };
}
function configured(provider: TradeEmailProvider) {
  const value = settings(provider);
  const values: EmailEnvironment = env;
  return Boolean(value.enabled && value.clientId && value.clientSecret && values.CRM_INTEGRATION_ENCRYPTION_KEY);
}
async function connection(ownerUid: string, db: D1Database) {
  return db.prepare('SELECT * FROM trade_email_connections WHERE owner_uid = ?').bind(ownerUid).first<Connection>();
}
export async function tradeEmailSettings(ownerUid: string, db: D1Database = getD1()) {
  const row = await connection(ownerUid, db);
  return {
    providers: (['google', 'microsoft'] as const).map(id => ({ id, label: id === 'google' ? 'Google' : 'Microsoft', available: configured(id) })),
    connection: row ? { provider: row.provider, email: row.sender_email, displayName: row.display_name, status: row.status,
      lastTestAt: row.last_test_at, lastError: row.last_error } : null,
  };
}
export async function tradeCustomerEmailReadiness(ownerUid: string, db: D1Database = getD1()) {
  const row = await connection(ownerUid, db);
  if (row) return { configured: row.status === 'connected' && configured(row.provider), from: row.sender_email, provider: row.provider };
  const legacy = serviceReminderProviderConfiguration().email;
  return { configured: legacy.configured, from: legacy.from, provider: legacy.provider };
}

export async function beginTradeEmailConnection(ownerUid: string, provider: TradeEmailProvider, origin: string, db: D1Database = getD1()) {
  if (!configured(provider)) throw new Error('EMAIL_SETUP_UNAVAILABLE');
  const url = new URL(origin);
  if (url.origin !== origin || (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('EMAIL_ORIGIN_INVALID');
  const state = newIntegrationState();
  const browser = newIntegrationState();
  const verifier = newIntegrationState();
  const redirectUri = `${origin}/api/trade-email/callback/${provider}`;
  await db.prepare(`INSERT INTO trade_email_oauth_states (owner_uid, provider, state_hash, browser_hash, encrypted_verifier, redirect_uri, expires_at, consumed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, '') ON CONFLICT(owner_uid) DO UPDATE SET provider = excluded.provider, state_hash = excluded.state_hash,
    browser_hash = excluded.browser_hash, encrypted_verifier = excluded.encrypted_verifier, redirect_uri = excluded.redirect_uri, expires_at = excluded.expires_at, consumed_at = ''`)
    .bind(ownerUid, provider, await integrationStateHash(state), await integrationStateHash(browser), await encryptProtectedPayload({ verifier }),
      redirectUri, new Date(Date.now() + 600_000).toISOString()).run();
  return { browser, authorizationUrl: buildEmailAuthorizationUrl(settings(provider), provider, redirectUri, state, await integrationStateHash(verifier)) };
}

export async function completeTradeEmailConnection(provider: TradeEmailProvider, state: string, browser: string, code: string, redirectUri: string, db: D1Database = getD1()) {
  if (!state || !browser || !code || !configured(provider)) throw new Error('EMAIL_CONNECTION_INVALID');
  const row = await db.prepare(`UPDATE trade_email_oauth_states SET consumed_at = ? WHERE provider = ? AND state_hash = ?
    AND browser_hash = ? AND redirect_uri = ? AND consumed_at = '' AND expires_at > ? RETURNING owner_uid, provider, encrypted_verifier, redirect_uri`)
    .bind(new Date().toISOString(), provider, await integrationStateHash(state), await integrationStateHash(browser), redirectUri, new Date().toISOString()).first<State>();
  if (!row) throw new Error('EMAIL_CONNECTION_INVALID');
  const owner = await db.prepare(`SELECT business_name FROM trade_accounts a WHERE a.firebase_uid = ? AND a.partner_type = 'installer'
    AND ${verifiedTradeAccountPredicate('a')}`).bind(row.owner_uid).first<{ business_name: string }>();
  if (!owner) throw new Error('EMAIL_CONNECTION_INVALID');
  const payload = await decryptProtectedPayload(row.encrypted_verifier);
  if (typeof payload.verifier !== 'string') throw new Error('EMAIL_CONNECTION_INVALID');
  const credentials = await exchangeEmailCode(provider, settings(provider), { code, redirectUri, verifier: payload.verifier });
  const identity = await getEmailIdentity(provider, credentials.accessToken);
  const now = new Date().toISOString();
  // The consumed state must still exist: disconnect/new connect invalidates an in-flight callback.
  await db.prepare(`INSERT INTO trade_email_connections
    (owner_uid, id, provider, external_id, sender_email, display_name, encrypted_credentials, status, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, 'connected', ?, ? WHERE EXISTS
      (SELECT 1 FROM trade_email_oauth_states s JOIN trade_accounts a ON a.firebase_uid = s.owner_uid
       WHERE s.owner_uid = ? AND s.state_hash = ? AND s.consumed_at <> '' AND a.partner_type = 'installer'
         AND ${verifiedTradeAccountPredicate('a')})
    ON CONFLICT(owner_uid) DO UPDATE SET id = excluded.id, provider = excluded.provider, external_id = excluded.external_id,
      sender_email = excluded.sender_email, display_name = excluded.display_name, encrypted_credentials = excluded.encrypted_credentials,
      status = 'connected', refresh_lock = '', refresh_lock_until = '', last_test_at = '', last_error = '', updated_at = excluded.updated_at`)
    .bind(row.owner_uid, crypto.randomUUID(), provider, identity.id, identity.email, owner.business_name,
      await encryptProtectedPayload({ ...credentials }), now, now, row.owner_uid, await integrationStateHash(state)).run()
    .then(result => { if (!result.meta.changes) throw new Error('EMAIL_CONNECTION_INVALID'); });
}

export async function disconnectTradeEmail(ownerUid: string, db: D1Database = getD1()) {
  await db.batch([
    db.prepare('DELETE FROM trade_email_oauth_states WHERE owner_uid = ?').bind(ownerUid),
    db.prepare(`UPDATE trade_email_connections SET status = 'disconnected', encrypted_credentials = '', refresh_lock = '', refresh_lock_until = '',
      last_error = '', updated_at = ? WHERE owner_uid = ?`).bind(new Date().toISOString(), ownerUid),
  ]);
}

function credentialsPayload(value: Record<string, unknown>): EmailCredentials {
  if (typeof value.accessToken !== 'string' || typeof value.refreshToken !== 'string' || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) throw new Error('EMAIL_CREDENTIALS_INVALID');
  return { accessToken: value.accessToken, refreshToken: value.refreshToken, expiresAt: value.expiresAt };
}
async function activeCredentials(row: Connection, db: D1Database) {
  const credentials = credentialsPayload(await decryptProtectedPayload(row.encrypted_credentials));
  if (Date.parse(credentials.expiresAt) > Date.now() + 120_000) return credentials;
  const lease = crypto.randomUUID();
  const now = new Date().toISOString();
  const claim = await db.prepare(`UPDATE trade_email_connections SET refresh_lock = ?, refresh_lock_until = ? WHERE owner_uid = ? AND id = ?
    AND status = 'connected' AND encrypted_credentials = ? AND (refresh_lock_until = '' OR refresh_lock_until < ?)`)
    .bind(lease, new Date(Date.now() + 60_000).toISOString(), row.owner_uid, row.id, row.encrypted_credentials, now).run();
  if (!claim.meta.changes) {
    const current = await connection(row.owner_uid, db);
    if (current?.id !== row.id || current.status !== 'connected') throw new Error('EMAIL_CONNECTION_CHANGED');
    const latest = credentialsPayload(await decryptProtectedPayload(current.encrypted_credentials));
    if (Date.parse(latest.expiresAt) > Date.now() + 120_000) return latest;
    throw new Error('EMAIL_REFRESH_BUSY');
  }
  try {
    const refreshed = await refreshEmailCredentials(row.provider, settings(row.provider), credentials);
    const saved = await db.prepare(`UPDATE trade_email_connections SET encrypted_credentials = ?, refresh_lock = '', refresh_lock_until = '', updated_at = ?
      WHERE owner_uid = ? AND id = ? AND status = 'connected' AND refresh_lock = ?`)
      .bind(await encryptProtectedPayload({ ...refreshed }), new Date().toISOString(), row.owner_uid, row.id, lease).run();
    if (!saved.meta.changes) throw new Error('EMAIL_CONNECTION_CHANGED');
    return refreshed;
  } catch (error) {
    const revoked = error instanceof TradeEmailProviderError && error.outcome === 'reconnect';
    await db.prepare(`UPDATE trade_email_connections SET refresh_lock = '', refresh_lock_until = '', status = ?, last_error = ?
      WHERE owner_uid = ? AND id = ? AND refresh_lock = ?`)
      .bind(revoked ? 'reconnect_required' : 'connected', revoked ? 'Reconnect your email account to resume sending.' : '', row.owner_uid, row.id, lease).run();
    throw error;
  }
}

function submissionResult(row: Pick<Submission, 'id' | 'provider' | 'provider_message_id'>) {
  return { provider: row.provider, providerMessageId: row.provider_message_id || `submission:${row.id}`, providerStatus: 'accepted' };
}

export async function sendTradeCustomerEmail(ownerUid: string, actorUid: string, message: ReminderProviderMessage,
  options: { db?: D1Database; requireConnection?: boolean; previouslyAttempted?: boolean; beforeSend?: () => Promise<void> } = {}) {
  const db = options.db || getD1();
  if (!ownerUid || !actorUid || message.channel !== 'email' || !message.idempotencyKey || message.idempotencyKey.length > 300) throw new Error('EMAIL_INPUT_INVALID');
  const hash = await integrationStateHash(JSON.stringify({ recipient: message.recipient, subject: message.subject,
    body: message.body, html: message.html || '', attachments: message.attachments || [] }));
  let previous = await db.prepare('SELECT * FROM trade_email_submissions WHERE owner_uid = ? AND request_key = ?')
    .bind(ownerUid, message.idempotencyKey).first<Submission>();
  if (previous) {
    if (previous.content_hash !== hash) throw new Error('EMAIL_REQUEST_CONFLICT');
    if (previous.status === 'accepted') return submissionResult(previous);
    if (previous.status !== 'failed') throw new ReminderProviderDeliveryError('indeterminate', 'EMAIL_SEND_UNCERTAIN');
    if (previous.retry_after > new Date().toISOString()) throw new Error('EMAIL_RETRY_LATER');
  }
  const row = await connection(ownerUid, db);
  // An attempt made before the journal existed cannot be safely retried through a new provider.
  if (row && !previous && options.previouslyAttempted) throw new ReminderProviderDeliveryError('indeterminate', 'EMAIL_LEGACY_SEND_UNCERTAIN');
  const legacy = serviceReminderProviderConfiguration().email;
  const provider = row?.provider || 'resend';
  const sender = row?.sender_email || legacy.from;
  const connectionId = row?.id || 'platform';
  if (previous && (previous.provider !== provider || previous.sender_email !== sender)) throw new Error('EMAIL_CONNECTION_CHANGED');
  // Persist proof that a new request has not reached a transport before any
  // refresh or recipient preflight can fail. Caller retry counters cannot
  // distinguish this safe failure from an unjournalled historical send.
  // Historical platform retries remain conservative until actually claimed.
  if (!previous && !options.previouslyAttempted) {
    const preparedAt = new Date().toISOString();
    await db.prepare(`INSERT OR IGNORE INTO trade_email_submissions
      (id, owner_uid, actor_uid, connection_id, request_key, content_hash, sender_email, recipient_email, subject, provider,
        status, error_code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'failed', 'email_preflight_not_sent', ?, ?)`)
      .bind(crypto.randomUUID(), ownerUid, actorUid, connectionId, message.idempotencyKey, hash, sender,
        message.recipient, message.subject, provider, preparedAt, preparedAt).run();
    previous = await db.prepare('SELECT * FROM trade_email_submissions WHERE owner_uid = ? AND request_key = ?')
      .bind(ownerUid, message.idempotencyKey).first<Submission>();
    if (!previous) throw new Error('EMAIL_PREFLIGHT_FAILED');
    if (previous.content_hash !== hash) throw new Error('EMAIL_REQUEST_CONFLICT');
    if (previous.status === 'accepted') return submissionResult(previous);
    if (previous.status !== 'failed') throw new ReminderProviderDeliveryError('indeterminate', 'EMAIL_SEND_UNCERTAIN');
    if (previous.retry_after > new Date().toISOString()) throw new Error('EMAIL_RETRY_LATER');
    if (previous.provider !== provider || previous.sender_email !== sender) throw new Error('EMAIL_CONNECTION_CHANGED');
  }
  if (!row && options.requireConnection) throw new Error('EMAIL_CONNECTION_REQUIRED');
  if (row && (row.status !== 'connected' || !configured(row.provider))) throw new Error('EMAIL_RECONNECT_REQUIRED');
  if (!row && !legacy.configured) throw new Error('EMAIL_SETUP_UNAVAILABLE');
  let credentials: EmailCredentials | null = null;
  if (row) {
    const ownerActive = await db.prepare(`SELECT 1 FROM trade_accounts a WHERE a.firebase_uid = ? AND a.partner_type = 'installer'
      AND ${verifiedTradeAccountPredicate('a')}`).bind(ownerUid).first();
    if (!ownerActive) throw new Error('EMAIL_ACCESS_REQUIRED');
    try { credentials = await activeCredentials(row, db); }
    catch (error) {
      if (error instanceof TradeEmailProviderError) throw new Error(error.outcome === 'reconnect' ? 'EMAIL_RECONNECT_REQUIRED' : 'EMAIL_PREFLIGHT_FAILED');
      throw error;
    }
  }
  await options.beforeSend?.();
  const id = previous?.id || crypto.randomUUID();
  const now = new Date().toISOString();
  const claim = previous
    ? await db.prepare(`UPDATE trade_email_submissions SET status = 'sending', actor_uid = ?, connection_id = ?, provider = ?, error_code = '', updated_at = ?
      WHERE id = ? AND owner_uid = ? AND status = 'failed' AND retry_after <= ? AND
      ((? = 'platform' AND NOT EXISTS (SELECT 1 FROM trade_email_connections WHERE owner_uid = ?)) OR EXISTS
      (SELECT 1 FROM trade_email_connections WHERE owner_uid = ? AND id = ? AND status = 'connected'))
      AND EXISTS (SELECT 1 FROM trade_accounts a WHERE a.firebase_uid = ? AND a.partner_type = 'installer'
        AND ${verifiedTradeAccountPredicate('a')})`)
      .bind(actorUid, connectionId, provider, now, id, ownerUid, now, connectionId, ownerUid, ownerUid, connectionId, ownerUid).run()
    : await db.prepare(`INSERT OR IGNORE INTO trade_email_submissions
      (id, owner_uid, actor_uid, connection_id, request_key, content_hash, sender_email, recipient_email, subject, provider, status, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sending', ?, ? WHERE
      ((? = 'platform' AND NOT EXISTS (SELECT 1 FROM trade_email_connections WHERE owner_uid = ?)) OR EXISTS
      (SELECT 1 FROM trade_email_connections WHERE owner_uid = ? AND id = ? AND status = 'connected'))
      AND EXISTS (SELECT 1 FROM trade_accounts a WHERE a.firebase_uid = ? AND a.partner_type = 'installer'
        AND ${verifiedTradeAccountPredicate('a')})`)
      .bind(id, ownerUid, actorUid, connectionId, message.idempotencyKey, hash, sender, message.recipient, message.subject, provider, now, now, connectionId, ownerUid, ownerUid, connectionId, ownerUid).run();
  if (!claim.meta.changes) throw new ReminderProviderDeliveryError('indeterminate', 'EMAIL_SEND_IN_PROGRESS');
  let sent: { providerMessageId: string; providerStatus: string };
  try {
    sent = row && credentials ? await sendMailboxEmail(row.provider, credentials.accessToken, { senderEmail: row.sender_email, senderName: row.display_name,
      recipient: message.recipient, subject: message.subject, text: message.body, html: message.html,
      attachments: message.attachments, messageId: `<${id}@tlink.ausenergyassessments.com>` }) : await sendServiceReminderProviderMessage(message,
        { fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20_000), redirect: 'error' }) });
  } catch (error) {
    const known = error instanceof TradeEmailProviderError;
    const uncertain = error instanceof ReminderProviderDeliveryError ? error.outcome === 'indeterminate' : !known || error.outcome === 'uncertain';
    try {
      await db.prepare(`UPDATE trade_email_submissions SET status = ?, error_code = ?, retry_after = ?, updated_at = ?
        WHERE id = ? AND owner_uid = ? AND status = 'sending'`)
        .bind(uncertain ? 'uncertain' : 'failed', known ? error.message : 'email_send_unknown', new Date(Date.now() + 60_000).toISOString(), new Date().toISOString(), id, ownerUid).run();
      if (row && known && error.outcome === 'reconnect') await db.prepare(`UPDATE trade_email_connections SET status = 'reconnect_required',
        last_error = 'Reconnect your email account to resume sending.' WHERE owner_uid = ? AND id = ? AND status = 'connected'`).bind(ownerUid, row.id).run();
    } catch { throw new ReminderProviderDeliveryError('indeterminate', 'EMAIL_SEND_UNCERTAIN'); }
    throw new ReminderProviderDeliveryError(uncertain ? 'indeterminate' : 'definite_failure', uncertain ? 'EMAIL_SEND_UNCERTAIN' : 'EMAIL_SEND_REJECTED');
  }
  // A database failure after acceptance must never be reported as a definite provider rejection.
  try {
    const saved = await db.prepare(`UPDATE trade_email_submissions SET status = 'accepted', provider_message_id = ?, error_code = '', updated_at = ?
      WHERE id = ? AND owner_uid = ? AND status = 'sending'`).bind(sent.providerMessageId, new Date().toISOString(), id, ownerUid).run();
    if (!saved.meta.changes) throw new Error('EMAIL_RESULT_NOT_SAVED');
  } catch { throw new ReminderProviderDeliveryError('indeterminate', 'EMAIL_SEND_UNCERTAIN'); }
  return submissionResult({ id, provider, provider_message_id: sent.providerMessageId });
}

export async function testTradeEmail(ownerUid: string, actorUid: string, requestId: string, db: D1Database = getD1()) {
  const row = await connection(ownerUid, db);
  if (!row) throw new Error('EMAIL_CONNECTION_REQUIRED');
  const result = await sendTradeCustomerEmail(ownerUid, actorUid, { channel: 'email', recipient: row.sender_email,
    subject: 'Your TLink business email is connected', body: `This test was sent through your ${row.sender_email} account. Your authorised TLink team can use this address for customer emails.`,
    idempotencyKey: `email-test:${requestId}`, callbackUrl: '', messageType: 'business_email_test' }, { db, requireConnection: true });
  await db.prepare('UPDATE trade_email_connections SET last_test_at = ? WHERE owner_uid = ? AND id = ? AND status = ?')
    .bind(new Date().toISOString(), ownerUid, row.id, 'connected').run();
  return result;
}
