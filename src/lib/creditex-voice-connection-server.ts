import { decryptProtectedPayload, encryptProtectedPayload, integrationStateHash } from "./trade-integration-crypto";
import { CREDITEX_VOICE_WEBHOOK, creditexVoiceAssignments, type CreditexVoiceAssignment, type CreditexVoiceNumber, type CreditexVoiceWorkspace } from "./creditex-voice-connection";
import type { AuditCallConfiguration } from "./creditex-audit-call-provider";

type Credentials = { apiKey: string; publicKey: string; sipUsername?: string; sipPassword?: string };
type Connection = { id: string; organisation_id: string; account_label: string; encrypted_credentials: string; credential_connection_id: string; call_control_application_id: string; outbound_voice_profile_id: string; default_number_id: string; status: string; provision_stage: string; error_code: string };
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const resourceId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9-]{1,80}$/.test(value);
const ACTIVE_CALLS = "SELECT 1 FROM creditex_audit_calls WHERE connection_id = creditex_voice_connections.id AND (end_requested = 1 OR status IN ('prepared','dialing','ringing','awaiting_consent','in_progress') OR recording_status IN ('starting','recording','pending','saving','failed','unknown'))";

class ProviderFailure extends Error {
  constructor(readonly uncertain: boolean, readonly rejected: boolean = false) { super(rejected ? "VOICE_CREDENTIALS_REJECTED" : "VOICE_PROVIDER_UNAVAILABLE"); }
}

export function voiceCredentials(apiKey: unknown, publicKey: unknown): Credentials {
  if (typeof apiKey !== "string" || !/^[\x21-\x7e]{20,512}$/.test(apiKey.trim()) || typeof publicKey !== "string") throw new Error("VOICE_CREDENTIALS_INVALID");
  const key = publicKey.trim();
  try { if (!/^[A-Za-z0-9+/]{43}=$/.test(key) || atob(key).length !== 32) throw new Error(); }
  catch { throw new Error("VOICE_CREDENTIALS_INVALID"); }
  return { apiKey: apiKey.trim(), publicKey: key };
}

async function provider(credentials: Credentials, path: string, fetchImpl: typeof fetch, body?: ObjectValue) {
  if (!/^\/[a-z_]+(?:\/[A-Za-z0-9-]+)?(?:\/voice)?(?:\?page\[size\]=100&page\[number\]=\d+)?$/.test(path)) throw new Error("VOICE_PROVIDER_RESPONSE_INVALID");
  let response: Response;
  try {
    response = await fetchImpl(`https://api.telnyx.com/v2${path}`, { method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${credentials.apiKey}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch { throw new ProviderFailure(Boolean(body)); }
  if (!response.ok) throw new ProviderFailure(Boolean(body) && (response.status >= 500 || [408,409,429].includes(response.status)), [401,403].includes(response.status));
  try { return object(await response.json()); } catch { throw new ProviderFailure(Boolean(body)); }
}

async function list(credentials: Credentials, path: string, fetchImpl: typeof fetch) {
  const values: ObjectValue[] = [];
  for (let page = 1; page <= 20; page++) {
    const response = await provider(credentials, `${path}?page[size]=100&page[number]=${page}`, fetchImpl);
    if (!Array.isArray(response.data)) throw new Error("VOICE_PROVIDER_RESPONSE_INVALID");
    values.push(...response.data.map(object));
    const meta = object(response.meta);
    if (!Number.isInteger(meta.total_pages) || Number(meta.total_pages) < 0 || Number(meta.total_pages) > 20 || Number(meta.page_number) !== page) throw new Error("VOICE_PROVIDER_RESPONSE_INVALID");
    if (page >= Number(meta.total_pages)) return values;
  }
  throw new Error("VOICE_ACCOUNT_TOO_LARGE");
}

function eligibleNumber(value: ObjectValue): CreditexVoiceNumber | null {
  if (!resourceId(value.id) || value.status !== "active" || value.country_iso_alpha2 !== "AU" || !["local", "mobile"].includes(String(value.phone_number_type)) || typeof value.phone_number !== "string" || !/^\+61[23478]\d{8}$/.test(value.phone_number)) return null;
  return { id: value.id, number: value.phone_number, label: String(value.customer_reference || value.phone_number).slice(0, 120) };
}

async function ownedNumbers(credentials: Credentials, fetchImpl: typeof fetch) {
  const values = await list(credentials, "/phone_numbers", fetchImpl);
  return values.map(eligibleNumber).filter((value): value is CreditexVoiceNumber => value !== null);
}

async function verifyNumber(credentials: Credentials, number: CreditexVoiceNumber, fetchImpl: typeof fetch) {
  const [identity, voice] = await Promise.all([
    provider(credentials, `/phone_numbers/${number.id}`, fetchImpl),
    provider(credentials, `/phone_numbers/${number.id}/voice`, fetchImpl),
  ]);
  const current = eligibleNumber(object(identity.data));
  if (!current || current.number !== number.number || object(voice.data).phone_number !== number.number) throw new Error("VOICE_NUMBER_INVALID");
}

export async function inspectVoiceAccount(credentials: Credentials, fetchImpl: typeof fetch = fetch) {
  await provider(credentials, "/balance", fetchImpl);
  return { numbers: await ownedNumbers(credentials, fetchImpl) };
}

async function activeConnection(database: D1Database, organisationId: string) {
  return database.prepare("SELECT * FROM creditex_voice_connections WHERE organisation_id = ? AND status IN ('connecting','connected')").bind(organisationId).first<Connection>();
}

async function readCredentials(connection: Connection) {
  const value = await decryptProtectedPayload(connection.encrypted_credentials);
  return { ...voiceCredentials(value.apiKey, value.publicKey), sipUsername: String(value.sipUsername || ""), sipPassword: String(value.sipPassword || "") };
}

export async function voiceWorkspace(database: D1Database, organisationId: string): Promise<CreditexVoiceWorkspace> {
  const connection = await activeConnection(database, organisationId);
  const staff = await database.prepare("SELECT id, display_name AS displayName, role FROM compliance_users WHERE organisation_id = ? AND status = 'active' ORDER BY display_name, id").bind(organisationId).all<{ id: string; displayName: string; role: string }>();
  if (!connection) return { connection: null, numbers: [], staff: staff.results, assignments: [] };
  const [numbers, assignments] = await Promise.all([
    database.prepare("SELECT number_id AS id, phone_number AS number, label FROM creditex_voice_numbers WHERE connection_id = ? AND active = 1 ORDER BY phone_number").bind(connection.id).all<CreditexVoiceNumber>(),
    database.prepare("SELECT a.member_id AS memberId, a.number_id AS numberId FROM creditex_voice_assignments a JOIN compliance_users u ON u.id = a.member_id AND u.organisation_id = ? AND u.status = 'active' WHERE a.connection_id = ?").bind(organisationId, connection.id).all<CreditexVoiceAssignment>(),
  ]);
  return { connection: { id: connection.id, status: connection.status === "connected" ? "connected" : "connecting", accountLabel: connection.account_label, defaultNumberId: connection.default_number_id, defaultNumber: numbers.results.find((item) => item.id === connection.default_number_id)?.number || "", errorCode: connection.error_code }, numbers: numbers.results, staff: staff.results, assignments: assignments.results };
}

function resourceName(connection: Connection, kind: string) { return `TLink Creditex ${connection.id} ${kind}`; }

function resourceMatches(value: ObjectValue, name: string, kind: "profile" | "credential" | "application", connection: Connection) {
  if (!resourceId(value.id)) return false;
  if (kind === "profile") return value.name === name && value.enabled === true && Array.isArray(value.whitelisted_destinations) && value.whitelisted_destinations.length === 1 && value.whitelisted_destinations[0] === "AU" && object(value.call_recording).call_recording_type === "none";
  if (value[kind === "credential" ? "connection_name" : "application_name"] !== name || value.active !== true || value.webhook_event_url !== CREDITEX_VOICE_WEBHOOK || String(value.webhook_api_version) !== "2" || object(value.outbound).outbound_voice_profile_id !== connection.outbound_voice_profile_id) return false;
  return kind !== "credential" || (object(value.outbound).call_parking_enabled === true && value.sip_uri_calling_preference === "disabled");
}

async function provision(database: D1Database, connection: Connection, credentials: Credentials, fetchImpl: typeof fetch) {
  const stages = [
    { kind: "profile" as const, previous: "new", pending: "profile_pending", done: "profile_ready", column: "outbound_voice_profile_id", path: "/outbound_voice_profiles" },
    { kind: "credential" as const, previous: "profile_ready", pending: "credential_pending", done: "credential_ready", column: "credential_connection_id", path: "/credential_connections" },
    { kind: "application" as const, previous: "credential_ready", pending: "application_pending", done: "ready", column: "call_control_application_id", path: "/call_control_applications" },
  ];
  for (const stage of stages) {
    if (![stage.previous, stage.pending].includes(connection.provision_stage)) continue;
    const name = resourceName(connection, stage.kind);
    let resource: ObjectValue | undefined;
    if (connection.provision_stage === stage.pending) {
      const candidates = (await list(credentials, stage.path, fetchImpl)).filter((item) => item[stage.kind === "profile" ? "name" : stage.kind === "credential" ? "connection_name" : "application_name"] === name);
      if (candidates.length !== 1 || !resourceMatches(candidates[0], name, stage.kind, connection)) throw new Error("VOICE_SETUP_PENDING");
      resource = candidates[0];
    } else {
      const claim = await database.prepare("UPDATE creditex_voice_connections SET provision_stage = ?, updated_at = ? WHERE id = ? AND status = 'connecting' AND provision_stage = ?").bind(stage.pending, new Date().toISOString(), connection.id, stage.previous).run();
      if (!claim.meta.changes) throw new Error("VOICE_SETUP_PENDING");
      const body: ObjectValue = stage.kind === "profile"
        ? { name, enabled: true, traffic_type: "conversational", service_plan: "global", usage_payment_method: "rate-deck", whitelisted_destinations: ["AU"], call_recording: { call_recording_type: "none", call_recording_channels: "dual", call_recording_format: "mp3" } }
        : stage.kind === "credential"
          ? { connection_name: name, active: true, user_name: credentials.sipUsername, password: credentials.sipPassword, sip_uri_calling_preference: "disabled", encrypted_media: "SRTP", webhook_event_url: CREDITEX_VOICE_WEBHOOK, webhook_api_version: "2", outbound: { call_parking_enabled: true, outbound_voice_profile_id: connection.outbound_voice_profile_id } }
          : { application_name: name, active: true, webhook_event_url: CREDITEX_VOICE_WEBHOOK, webhook_api_version: "2", outbound: { outbound_voice_profile_id: connection.outbound_voice_profile_id } };
      try { resource = object((await provider(credentials, stage.path, fetchImpl, body)).data); }
      catch (error) {
        if (error instanceof ProviderFailure && !error.uncertain) await database.prepare("UPDATE creditex_voice_connections SET provision_stage = ? WHERE id = ? AND provision_stage = ? AND status = 'connecting'").bind(stage.previous, connection.id, stage.pending).run();
        throw error;
      }
      if (!resourceMatches(resource, name, stage.kind, connection)) throw new Error("VOICE_SETUP_PENDING");
    }
    const saved = await database.prepare(`UPDATE creditex_voice_connections SET ${stage.column} = ?, provision_stage = ?, error_code = '', updated_at = ? WHERE id = ? AND provision_stage = ? AND status = 'connecting'`).bind(resource.id, stage.done, new Date().toISOString(), connection.id, stage.pending).run();
    if (!saved.meta.changes) throw new Error("VOICE_SETUP_PENDING");
    connection = { ...connection, [stage.column]: String(resource.id), provision_stage: stage.done };
  }
  if (connection.provision_stage !== "ready") throw new Error("VOICE_SETUP_PENDING");
  return connection;
}

async function saveNumbers(database: D1Database, connection: Connection, credentials: Credentials, defaultNumberId: string, assignments: CreditexVoiceAssignment[], fetchImpl: typeof fetch) {
  const numbers = await ownedNumbers(credentials, fetchImpl);
  const selectedIds = new Set([defaultNumberId, ...assignments.map((item) => item.numberId)]);
  if (!defaultNumberId || [...selectedIds].some((id) => !numbers.some((item) => item.id === id))) throw new Error("VOICE_NUMBER_INVALID");
  const staff = await database.prepare("SELECT id FROM compliance_users WHERE organisation_id = ? AND status = 'active'").bind(connection.organisation_id).all<{ id: string }>();
  if (assignments.some((item) => !staff.results.some((member) => member.id === item.memberId))) throw new Error("VOICE_ASSIGNMENTS_INVALID");
  for (const number of numbers.filter((item) => selectedIds.has(item.id))) await verifyNumber(credentials, number, fetchImpl);
  const state = await activeConnection(database, connection.organisation_id);
  if (state?.id !== connection.id) throw new Error("VOICE_CONNECTION_REQUIRED");
  const history = await database.prepare("SELECT number_id AS id, phone_number AS number FROM creditex_voice_numbers WHERE connection_id = ?").bind(connection.id).all<{ id: string; number: string }>();
  if (numbers.some((number) => history.results.some((old) => old.id === number.id && old.number !== number.number))) throw new Error("VOICE_NUMBER_INVALID");
  await database.batch([
    database.prepare("UPDATE creditex_voice_numbers SET active = 0 WHERE connection_id = ?").bind(connection.id),
    ...numbers.map((number) => database.prepare("INSERT INTO creditex_voice_numbers (connection_id, number_id, phone_number, label, active) VALUES (?, ?, ?, ?, 1) ON CONFLICT(connection_id, number_id) DO UPDATE SET label = excluded.label, active = 1").bind(connection.id, number.id, number.number, number.label)),
    database.prepare("DELETE FROM creditex_voice_assignments WHERE connection_id = ?").bind(connection.id),
    ...assignments.map((assignment) => database.prepare("INSERT INTO creditex_voice_assignments (connection_id, member_id, number_id) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM compliance_users WHERE id = ? AND organisation_id = ? AND status = 'active')").bind(connection.id, assignment.memberId, assignment.numberId, assignment.memberId, connection.organisation_id)),
    database.prepare("UPDATE creditex_voice_connections SET default_number_id = ?, updated_at = ? WHERE id = ? AND status IN ('connecting','connected')").bind(defaultNumberId, new Date().toISOString(), connection.id),
  ]);
}

export async function connectVoiceAccount(database: D1Database, owner: { organisationId: string; membershipId: string; organisationLegalName: string }, input: Record<string, unknown>, fetchImpl: typeof fetch = fetch) {
  let connection = await activeConnection(database, owner.organisationId);
  if (connection?.status === "connected") throw new Error("VOICE_DISCONNECT_FIRST");
  if (!connection) {
    if (input.ownsAccount !== true) throw new Error("VOICE_OWNERSHIP_REQUIRED");
    const credentials = voiceCredentials(input.apiKey, input.publicKey);
    const inspected = await inspectVoiceAccount(credentials, fetchImpl);
    if (!inspected.numbers.some((number) => number.id === input.defaultNumberId)) throw new Error("VOICE_NUMBER_INVALID");
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const encrypted = await encryptProtectedPayload({ ...credentials, sipUsername: `tl${id.replaceAll("-", "").slice(0, 28)}`, sipPassword: `Aa1${crypto.randomUUID()}${crypto.randomUUID()}` });
    try {
      await database.prepare("INSERT INTO creditex_voice_connections (id, organisation_id, account_key_hash, account_label, encrypted_credentials, default_number_id, authorised_by_member_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, owner.organisationId, await integrationStateHash(credentials.publicKey), `${owner.organisationLegalName} Telnyx`.slice(0, 160), encrypted, String(input.defaultNumberId), owner.membershipId, now, now).run();
    } catch { throw new Error("VOICE_ACCOUNT_ALREADY_CONNECTED"); }
    connection = await activeConnection(database, owner.organisationId);
    if (!connection || connection.id !== id) throw new Error("VOICE_SETUP_PENDING");
  }
  const credentials = await readCredentials(connection);
  try {
    await saveNumbers(database, connection, credentials, String(input.defaultNumberId || connection.default_number_id), creditexVoiceAssignments(input.assignments || []), fetchImpl);
    connection = await provision(database, connection, credentials, fetchImpl);
    await database.prepare("UPDATE creditex_voice_connections SET status = 'connected', error_code = '', updated_at = ? WHERE id = ? AND status = 'connecting' AND provision_stage = 'ready'").bind(new Date().toISOString(), connection.id).run();
  } catch (error) {
    const code = error instanceof Error && /^VOICE_[A-Z_]+$/.test(error.message) ? error.message : "VOICE_SETUP_PENDING";
    await database.prepare("UPDATE creditex_voice_connections SET error_code = ?, updated_at = ? WHERE id = ? AND status = 'connecting'").bind(code, new Date().toISOString(), connection.id).run();
    throw error;
  }
}

export async function updateVoiceNumbers(database: D1Database, organisationId: string, input: Record<string, unknown>, fetchImpl: typeof fetch = fetch) {
  const connection = await activeConnection(database, organisationId);
  if (!connection || connection.status !== "connected") throw new Error("VOICE_CONNECTION_REQUIRED");
  await saveNumbers(database, connection, await readCredentials(connection), String(input.defaultNumberId || ""), creditexVoiceAssignments(input.assignments), fetchImpl);
}

export async function refreshVoiceNumbers(database: D1Database, organisationId: string, fetchImpl: typeof fetch = fetch) {
  const connection = await activeConnection(database, organisationId);
  if (!connection) throw new Error("VOICE_CONNECTION_REQUIRED");
  return { numbers: await ownedNumbers(await readCredentials(connection), fetchImpl) };
}

export async function disconnectVoiceAccount(database: D1Database, organisationId: string) {
  const changed = await database.prepare(`UPDATE creditex_voice_connections SET status = 'disconnected', updated_at = ? WHERE organisation_id = ? AND status IN ('connecting','connected') AND NOT EXISTS (${ACTIVE_CALLS}) AND provision_stage NOT IN ('profile_pending','credential_pending','application_pending')`).bind(new Date().toISOString(), organisationId).run();
  if (!changed.meta.changes && await activeConnection(database, organisationId)) throw new Error("VOICE_DISCONNECT_BUSY");
}

function configuration(connection: Connection, credentials: Credentials, callerId: string): AuditCallConfiguration {
  return { connectionId: connection.id, organisationId: connection.organisation_id, apiKey: credentials.apiKey, publicKey: credentials.publicKey, credentialConnectionId: connection.credential_connection_id, callControlApplicationId: connection.call_control_application_id, outboundVoiceProfileId: connection.outbound_voice_profile_id, callerId };
}

export async function resolveAuditCallConfiguration(database: D1Database, organisationId: string, memberId: string, options: { verifyProvider?: boolean } = {}): Promise<{ configured: boolean; unavailableReason: string; configuration: AuditCallConfiguration | null }> {
  const unavailable = (reason: string) => ({ configured: false, unavailableReason: reason, configuration: null });
  const connection = await activeConnection(database, organisationId);
  if (!connection || connection.status !== "connected") return unavailable("Ask a Creditex administrator to connect Creditex's Telnyx account and caller numbers.");
  const member = await database.prepare("SELECT id FROM compliance_users WHERE id = ? AND organisation_id = ? AND status = 'active'").bind(memberId, organisationId).first();
  if (!member) return unavailable("An active Creditex membership is required.");
  const number = await database.prepare("SELECT n.number_id AS id, n.phone_number AS number, n.label FROM creditex_voice_numbers n WHERE n.connection_id = ? AND n.active = 1 AND n.number_id = COALESCE((SELECT number_id FROM creditex_voice_assignments WHERE connection_id = ? AND member_id = ?), ?) LIMIT 1").bind(connection.id, connection.id, memberId, connection.default_number_id).first<CreditexVoiceNumber>();
  if (!number) return unavailable("Ask a Creditex administrator to check your assigned caller number.");
  const credentials = await readCredentials(connection);
  // History polling needs local readiness only; every new call uses the verified default.
  if (options.verifyProvider === false) return { configured: true, unavailableReason: "", configuration: configuration(connection, credentials, number.number) };
  try {
    await verifyNumber(credentials, number, fetch);
    const [profile, browser, app] = await Promise.all([
      provider(credentials, `/outbound_voice_profiles/${connection.outbound_voice_profile_id}`, fetch),
      provider(credentials, `/credential_connections/${connection.credential_connection_id}`, fetch),
      provider(credentials, `/call_control_applications/${connection.call_control_application_id}`, fetch),
    ]);
    if (!resourceMatches(object(profile.data), resourceName(connection, "profile"), "profile", connection) || !resourceMatches(object(browser.data), resourceName(connection, "credential"), "credential", connection) || !resourceMatches(object(app.data), resourceName(connection, "application"), "application", connection)) return unavailable("Creditex calling settings changed in Telnyx. Ask your administrator to check the connection.");
  } catch { return unavailable("Creditex's Telnyx account or caller number could not be verified. Ask your administrator to check the connection."); }
  return { configured: true, unavailableReason: "", configuration: configuration(connection, credentials, number.number) };
}

export async function resolveStoredAuditCallConfiguration(database: D1Database, binding: { organisationId: string; connectionId: string; credentialConnectionId: string; callControlApplicationId: string; callerId: string }): Promise<AuditCallConfiguration | null> {
  const connection = await database.prepare("SELECT c.* FROM creditex_voice_connections c WHERE c.id = ? AND c.organisation_id = ? AND c.credential_connection_id = ? AND c.call_control_application_id = ? AND EXISTS (SELECT 1 FROM creditex_voice_numbers n WHERE n.connection_id = c.id AND n.phone_number = ?)").bind(binding.connectionId, binding.organisationId, binding.credentialConnectionId, binding.callControlApplicationId, binding.callerId).first<Connection>();
  if (!connection) return null;
  return configuration(connection, await readCredentials(connection), binding.callerId);
}
