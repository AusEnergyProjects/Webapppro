import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';

import { ADDRESS_MAX_AGE_MS } from '@/lib/config';
import { deleteEncryptedBundle, encryptFileForQueue, purgeEncryptedFiles, purgeEncryptionKey } from '@/lib/encrypted-files';
import { completeEvidenceEnvelope, type EvidenceCaptureEnvelope } from '@/lib/evidence';
import type { FieldAccessMode, FieldJob, OfflineAction, QueueRow, SyncChange, UploadRow } from '@/lib/types';

const DATABASE_NAME = 'aea-field.db';
const DATABASE_KEY_NAME = 'aea-field-database-key-v1';
const DATABASE_OWNER_KEY = 'aea-field-database-owner-v1';
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
let purgePromise: Promise<void> | null = null;

function fieldLane(value: unknown): FieldAccessMode {
  return value === 'creditex_manual' ? 'creditex_manual' : 'trade_team';
}

async function databaseKey() {
  const existing = await SecureStore.getItemAsync(DATABASE_KEY_NAME);
  if (existing) return existing;
  const bytes = await Crypto.getRandomBytesAsync(32);
  const key = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(DATABASE_KEY_NAME, key, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}

async function openDatabase() {
  const key = await databaseKey();
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await db.execAsync(`PRAGMA key = '${key}';`);
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY NOT NULL,
      field_lane TEXT NOT NULL DEFAULT 'trade_team',
      work_number TEXT NOT NULL,
      scheduled_start TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL,
      protected_job INTEGER NOT NULL DEFAULT 0,
      has_address INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL,
      payload TEXT NOT NULL,
      cached_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_schedule_idx ON jobs(scheduled_start, work_number);
    CREATE TABLE IF NOT EXISTS action_queue (
      id TEXT PRIMARY KEY NOT NULL,
      work_order_id TEXT NOT NULL,
      field_lane TEXT NOT NULL DEFAULT 'trade_team',
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      retry_after TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS action_queue_status_idx ON action_queue(status, created_at);
    CREATE TABLE IF NOT EXISTS upload_queue (
      id TEXT PRIMARY KEY NOT NULL,
      work_order_id TEXT NOT NULL,
      field_lane TEXT NOT NULL DEFAULT 'trade_team',
      client_upload_id TEXT NOT NULL DEFAULT '',
      local_uri TEXT NOT NULL,
      file_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      category TEXT NOT NULL,
      caption TEXT NOT NULL DEFAULT '',
      evidence_envelope TEXT NOT NULL DEFAULT '{}',
      session_id TEXT NOT NULL DEFAULT '',
      uploaded_parts TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS upload_queue_status_idx ON upload_queue(status, created_at);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
  const jobColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(jobs)');
  if (!jobColumns.some((column) => column.name === 'field_lane')) {
    await db.execAsync("ALTER TABLE jobs ADD COLUMN field_lane TEXT NOT NULL DEFAULT 'trade_team';");
  }
  const actionColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(action_queue)');
  if (!actionColumns.some((column) => column.name === 'field_lane')) {
    await db.execAsync("ALTER TABLE action_queue ADD COLUMN field_lane TEXT NOT NULL DEFAULT 'trade_team';");
  }
  const uploadColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(upload_queue)');
  if (!uploadColumns.some((column) => column.name === 'evidence_envelope')) {
    await db.execAsync("ALTER TABLE upload_queue ADD COLUMN evidence_envelope TEXT NOT NULL DEFAULT '{}';");
  }
  if (!uploadColumns.some((column) => column.name === 'field_lane')) {
    await db.execAsync("ALTER TABLE upload_queue ADD COLUMN field_lane TEXT NOT NULL DEFAULT 'trade_team';");
  }
  if (!uploadColumns.some((column) => column.name === 'client_upload_id')) {
    await db.execAsync("ALTER TABLE upload_queue ADD COLUMN client_upload_id TEXT NOT NULL DEFAULT '';");
  }
  const existingJobs = await db.getAllAsync<{ id: string; payload: string }>('SELECT id, payload FROM jobs');
  for (const row of existingJobs) {
    let lane: FieldAccessMode = 'trade_team';
    try {
      lane = fieldLane((JSON.parse(row.payload) as FieldJob).fieldLane);
    } catch {
      // A malformed cached row remains isolated in the trade lane until the
      // next authoritative bootstrap replaces it.
    }
    await db.runAsync('UPDATE jobs SET field_lane = ? WHERE id = ?', lane, row.id);
  }
  await db.execAsync(`
    UPDATE action_queue
      SET field_lane = COALESCE(
        (SELECT jobs.field_lane FROM jobs WHERE jobs.id = action_queue.work_order_id),
        'trade_team'
      );
    UPDATE upload_queue
      SET field_lane = COALESCE(
        (SELECT jobs.field_lane FROM jobs WHERE jobs.id = upload_queue.work_order_id),
        'trade_team'
      );
    UPDATE upload_queue SET client_upload_id = id WHERE client_upload_id = '';
    CREATE INDEX IF NOT EXISTS jobs_field_lane_schedule_idx
      ON jobs(field_lane, scheduled_start, work_number);
    CREATE INDEX IF NOT EXISTS action_queue_field_lane_status_idx
      ON action_queue(field_lane, status, created_at);
    CREATE INDEX IF NOT EXISTS upload_queue_field_lane_status_idx
      ON upload_queue(field_lane, status, created_at);
  `);
  return db;
}

export function getDatabase() {
  databasePromise ||= purgePromise ? purgePromise.then(openDatabase) : openDatabase();
  return databasePromise;
}

async function saveJob(db: SQLite.SQLiteDatabase, job: FieldJob, cachedAt: string) {
  const lane = fieldLane(job.fieldLane);
  const storedJob = { ...job, fieldLane: lane };
  await db.runAsync(
    `INSERT INTO jobs (id, field_lane, work_number, scheduled_start, stage, protected_job, has_address, revision, payload, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET field_lane = excluded.field_lane,
        work_number = excluded.work_number,
        scheduled_start = excluded.scheduled_start, stage = excluded.stage,
        protected_job = excluded.protected_job, has_address = excluded.has_address,
        revision = excluded.revision, payload = excluded.payload, cached_at = excluded.cached_at`,
    job.id,
    lane,
    job.workNumber,
    job.scheduledStart || '',
    job.stage,
    job.protectedJob ? 1 : 0,
    job.serviceAddress ? 1 : 0,
    job.revision,
    JSON.stringify(storedJob),
    cachedAt,
  );
}

export async function applyChanges(
  changes: SyncChange[],
  bootstrap: boolean,
  serverTime: string,
  mode: FieldAccessMode,
) {
  const db = await getDatabase();
  const bootstrapIds = new Set(changes.filter((item) => item.operation === 'upsert').map((item) => item.entityId));
  await db.withTransactionAsync(async () => {
    if (bootstrap) await db.runAsync('DELETE FROM jobs WHERE field_lane = ?', mode);
    for (const change of changes.filter((item) => item.operation === 'delete')) {
      await db.runAsync('DELETE FROM jobs WHERE id = ? AND field_lane = ?', change.entityId, mode);
      await db.runAsync(
        "DELETE FROM action_queue WHERE work_order_id = ? AND field_lane = ? AND status <> 'conflict'",
        change.entityId,
        mode,
      );
      const uploads = await db.getAllAsync<{ local_uri: string }>(
        'SELECT local_uri FROM upload_queue WHERE work_order_id = ? AND field_lane = ?',
        change.entityId,
        mode,
      );
      for (const upload of uploads) {
        deleteEncryptedBundle(upload.local_uri);
      }
      await db.runAsync(
        'DELETE FROM upload_queue WHERE work_order_id = ? AND field_lane = ?',
        change.entityId,
        mode,
      );
    }
    for (const change of changes.filter((item) => item.operation === 'upsert' && item.entity)) {
      await saveJob(db, { ...(change.entity as FieldJob), fieldLane: mode }, serverTime);
    }
    if (bootstrap) {
      const uploads = await db.getAllAsync<{ work_order_id: string; local_uri: string }>(
        'SELECT work_order_id, local_uri FROM upload_queue WHERE field_lane = ?',
        mode,
      );
      for (const upload of uploads.filter((item) => !bootstrapIds.has(item.work_order_id))) deleteEncryptedBundle(upload.local_uri);
      const allowed = [...bootstrapIds];
      if (!allowed.length) {
        await db.runAsync('DELETE FROM action_queue WHERE field_lane = ?', mode);
        await db.runAsync('DELETE FROM upload_queue WHERE field_lane = ?', mode);
      } else {
        const placeholders = allowed.map(() => '?').join(', ');
        await db.runAsync(
          `DELETE FROM action_queue WHERE field_lane = ? AND work_order_id NOT IN (${placeholders})`,
          mode,
          ...allowed,
        );
        await db.runAsync(
          `DELETE FROM upload_queue WHERE field_lane = ? AND work_order_id NOT IN (${placeholders})`,
          mode,
          ...allowed,
        );
      }
    }
  });
}

export async function purgeExpiredAddresses() {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ id: string; payload: string; cached_at: string }>(
    'SELECT id, payload, cached_at FROM jobs WHERE has_address = 1',
  );
  const now = Date.now();
  for (const row of rows) {
    if (now - Date.parse(row.cached_at) < ADDRESS_MAX_AGE_MS) continue;
    const job = JSON.parse(row.payload) as FieldJob;
    job.serviceAddress = '';
    job.offlinePolicy.containsPersonalData = false;
    await saveJob(db, job, row.cached_at);
  }
}

export async function listJobs() {
  await purgeExpiredAddresses();
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ payload: string }>(
    `SELECT payload FROM jobs
      WHERE stage NOT IN ('completed', 'cancelled')
      ORDER BY scheduled_start = '', scheduled_start, work_number`,
  );
  return rows.map((row) => JSON.parse(row.payload) as FieldJob);
}

export async function getJob(id: string) {
  await purgeExpiredAddresses();
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ payload: string }>('SELECT payload FROM jobs WHERE id = ?', id);
  return row ? JSON.parse(row.payload) as FieldJob : null;
}

async function workOrderFieldLane(
  db: SQLite.SQLiteDatabase,
  workOrderId: string,
  requested?: FieldAccessMode,
) {
  if (requested) return fieldLane(requested);
  const row = await db.getFirstAsync<{ field_lane: string }>(
    'SELECT field_lane FROM jobs WHERE id = ?',
    workOrderId,
  );
  if (!row) {
    throw new Error('This job is no longer available on this device.');
  }
  return fieldLane(row?.field_lane);
}

export async function queueAction(action: OfflineAction) {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const lane = await workOrderFieldLane(db, action.workOrderId, action.fieldLane);
  let queuedAction = { ...action, fieldLane: lane };
  if (action.type === 'save_job_form' && action.formId) {
    const candidates = await db.getAllAsync<{ id: string; payload: string }>(
      "SELECT id, payload FROM action_queue WHERE work_order_id = ? AND field_lane = ? AND status IN ('queued', 'retry')",
      action.workOrderId,
      lane,
    );
    const existing = candidates.map((row) => ({ ...row, action: JSON.parse(row.payload) as OfflineAction }))
      .find((row) => row.action.type === 'save_job_form' && row.action.formId === action.formId);
    if (existing) {
      queuedAction = {
        ...action,
        fieldLane: lane,
        clientActionId: existing.action.clientActionId,
        baseRevision: existing.action.baseRevision,
      };
      await db.runAsync("UPDATE action_queue SET payload = ?, status = 'queued', retry_after = '', updated_at = ? WHERE id = ?",
        JSON.stringify(queuedAction), now, existing.id);
    } else {
      await db.runAsync(`INSERT INTO action_queue (id, work_order_id, field_lane, payload, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
      action.clientActionId, action.workOrderId, lane, JSON.stringify(queuedAction), now, now);
    }
  } else {
    await db.runAsync(`INSERT INTO action_queue (id, work_order_id, field_lane, payload, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
    action.clientActionId, action.workOrderId, lane, JSON.stringify(queuedAction), now, now);
  }
  const row = await db.getFirstAsync<{ payload: string }>(
    'SELECT payload FROM jobs WHERE id = ? AND field_lane = ?',
    action.workOrderId,
    lane,
  );
  if (!row) return;
  const job = JSON.parse(row.payload) as FieldJob;
  if (action.type === 'set_job_stage' && action.stage) job.stage = action.stage;
  if (action.type === 'advance_field_job' && action.transition) {
    const states = { start_travel: 'en_route', arrive: 'arrived', start_work: 'in_progress', finish: 'completed' } as const;
    if (action.transition !== 'finish') job.appointmentStatus = states[action.transition];
    if (action.transition === 'start_work') job.stage = 'in_progress';
  }
  if (action.type === 'set_task_status' && action.taskId && action.status) {
    const task = job.tasks.find((item) => item.id === action.taskId);
    if (task) {
      task.status = action.status;
      task.completedAt = action.status === 'done' ? now : '';
    }
  }
  if (queuedAction.type === 'save_job_form' && queuedAction.formId && queuedAction.answers) {
    const form = job.forms.find((item) => item.id === queuedAction.formId);
    if (form) {
      form.answers = queuedAction.answers;
      form.status = queuedAction.complete ? 'complete' : 'draft';
      form.ready = form.template.fields.every((field) => !field.required || (field.type === 'checkbox' ? queuedAction.answers?.[field.key] === true : Boolean(String(queuedAction.answers?.[field.key] || '').trim())));
      form.missing = form.template.fields.filter((field) => field.required && (field.type === 'checkbox' ? queuedAction.answers?.[field.key] !== true : !String(queuedAction.answers?.[field.key] || '').trim())).map((field) => field.label);
      form.completedAt = queuedAction.complete ? now : '';
      form.updatedAt = now;
    }
  }
  await saveJob(db, job, now);
}

export async function queuedActions(mode: FieldAccessMode, limit = 50) {
  const db = await getDatabase();
  return db.getAllAsync<QueueRow>(
    `SELECT * FROM action_queue WHERE field_lane = ? AND status IN ('queued', 'retry')
      AND (retry_after = '' OR retry_after <= ?) ORDER BY created_at LIMIT ?`,
    mode,
    new Date().toISOString(),
    limit,
  );
}

export async function resolveAction(
  id: string,
  result: { status: string; code?: string; error?: string; retryAfterSeconds?: number },
) {
  const db = await getDatabase();
  const now = new Date().toISOString();
  if (result.status === 'applied' || result.status === 'duplicate') {
    await db.runAsync('DELETE FROM action_queue WHERE id = ?', id);
    return;
  }
  const status = result.status === 'conflict' ? 'conflict' : result.status === 'rejected' ? 'rejected' : 'retry';
  const retryAfter = result.retryAfterSeconds
    ? new Date(Date.now() + result.retryAfterSeconds * 1000).toISOString()
    : '';
  await db.runAsync(
    `UPDATE action_queue SET status = ?, attempts = attempts + 1, retry_after = ?,
      error_code = ?, error_message = ?, updated_at = ? WHERE id = ?`,
    status,
    retryAfter,
    result.code || '',
    result.error || '',
    now,
    id,
  );
}

export async function retryConflict(id: string, action: OfflineAction) {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const lane = await workOrderFieldLane(db, action.workOrderId, action.fieldLane);
  const queuedAction = { ...action, fieldLane: lane };
  const result = await db.runAsync(
    `UPDATE action_queue
      SET id = ?, work_order_id = ?, field_lane = ?, payload = ?, status = 'queued', attempts = 0,
        retry_after = '', error_code = '', error_message = '', created_at = ?, updated_at = ?
      WHERE id = ? AND work_order_id = ? AND field_lane = ? AND status = 'conflict'`,
    action.clientActionId,
    action.workOrderId,
    lane,
    JSON.stringify(queuedAction),
    now,
    now,
    id,
    action.workOrderId,
    lane,
  );
  if (result.changes !== 1) {
    throw new Error('This saved change was updated before it could be retried.');
  }
}

export async function discardAction(id: string) {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM action_queue WHERE id = ?', id);
}

export async function listProblemActions() {
  const db = await getDatabase();
  return db.getAllAsync<QueueRow>(
    "SELECT * FROM action_queue WHERE status IN ('conflict', 'rejected') ORDER BY updated_at DESC",
  );
}

type AddUploadInput = Omit<
  UploadRow,
  'field_lane' | 'client_upload_id' | 'evidence_envelope' | 'session_id' | 'uploaded_parts' | 'status' | 'attempts' | 'error_message' | 'created_at'
> & {
  evidenceEnvelope: Omit<EvidenceCaptureEnvelope, 'integrity'>;
  clearSettingKey?: string;
};

export async function addUpload(input: AddUploadInput) {
  const encrypted = await encryptFileForQueue(input.local_uri, input.id);
  const db = await getDatabase();
  const now = new Date().toISOString();
  const lane = await workOrderFieldLane(db, input.work_order_id);
  const evidenceEnvelope = completeEvidenceEnvelope(input.evidenceEnvelope, {
    digestHex: encrypted.sha256Hex,
    byteLength: encrypted.sizeBytes,
  });
  try {
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `INSERT INTO upload_queue
          (id, work_order_id, field_lane, client_upload_id, local_uri, file_name, content_type, size_bytes, category, caption,
           evidence_envelope, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.id,
        input.work_order_id,
        lane,
        input.id,
        encrypted.bundle,
        input.file_name,
        input.content_type,
        encrypted.sizeBytes,
        input.category,
        input.caption,
        JSON.stringify(evidenceEnvelope),
        now,
        now,
      );
      if (input.clearSettingKey) {
        await db.runAsync(
          "INSERT INTO settings (key, value) VALUES (?, '') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          input.clearSettingKey,
        );
      }
    });
  } catch (error) {
    deleteEncryptedBundle(encrypted.bundle);
    throw error;
  }
}

export async function queuedUploads(mode: FieldAccessMode) {
  const db = await getDatabase();
  return db.getAllAsync<UploadRow>(
    "SELECT * FROM upload_queue WHERE field_lane = ? AND status IN ('queued', 'uploading', 'retry') ORDER BY created_at LIMIT 10",
    mode,
  );
}

export async function listProblemUploads() {
  const db = await getDatabase();
  return db.getAllAsync<UploadRow>(
    "SELECT * FROM upload_queue WHERE status = 'rejected' ORDER BY updated_at DESC",
  );
}

export async function updateUpload(id: string, values: Partial<Pick<UploadRow, 'client_upload_id' | 'session_id' | 'uploaded_parts' | 'status' | 'attempts' | 'error_message'>>) {
  const db = await getDatabase();
  const current = await db.getFirstAsync<UploadRow>('SELECT * FROM upload_queue WHERE id = ?', id);
  if (!current) return;
  await db.runAsync(
    `UPDATE upload_queue SET client_upload_id = ?, session_id = ?, uploaded_parts = ?, status = ?, attempts = ?,
      error_message = ?, updated_at = ? WHERE id = ?`,
    values.client_upload_id ?? current.client_upload_id,
    values.session_id ?? current.session_id,
    values.uploaded_parts ?? current.uploaded_parts,
    values.status ?? current.status,
    values.attempts ?? current.attempts,
    values.error_message ?? current.error_message,
    new Date().toISOString(),
    id,
  );
}

export async function completeUpload(id: string) {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ local_uri: string }>('SELECT local_uri FROM upload_queue WHERE id = ?', id);
  if (row) {
    deleteEncryptedBundle(row.local_uri);
  }
  await db.runAsync('DELETE FROM upload_queue WHERE id = ?', id);
}

export const discardUpload = completeUpload;

export async function queueCounts() {
  const db = await getDatabase();
  const actions = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) count FROM action_queue WHERE status IN ('queued', 'retry')");
  const uploads = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) count FROM upload_queue WHERE status IN ('queued', 'uploading', 'retry')");
  const conflicts = await db.getFirstAsync<{ count: number }>(`SELECT
    (SELECT COUNT(*) FROM action_queue WHERE status IN ('conflict', 'rejected'))
    + (SELECT COUNT(*) FROM upload_queue WHERE status = 'rejected') count`);
  return { actions: actions?.count || 0, uploads: uploads?.count || 0, conflicts: conflicts?.count || 0 };
}

export async function getSetting(key: string) {
  const db = await getDatabase();
  return (await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key))?.value || '';
}

export async function setSetting(key: string, value: string) {
  const db = await getDatabase();
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

export async function prepareLocalDataOwner(firebaseUid: string) {
  const ownerUid = firebaseUid.trim();
  if (!ownerUid) throw new Error('A signed-in account is required before opening local field data.');
  const currentOwnerUid = await SecureStore.getItemAsync(DATABASE_OWNER_KEY);
  if (currentOwnerUid === ownerUid) return;
  await purgeLocalData();
  await SecureStore.setItemAsync(DATABASE_OWNER_KEY, ownerUid, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function purgeLocalData() {
  if (purgePromise) return purgePromise;
  const activeDatabase = databasePromise;
  databasePromise = null;
  purgePromise = (async () => {
    if (activeDatabase) {
      const db = await activeDatabase;
      await db.closeAsync();
    }
    await SQLite.deleteDatabaseAsync(DATABASE_NAME);
    await SecureStore.deleteItemAsync(DATABASE_KEY_NAME);
    await SecureStore.deleteItemAsync(DATABASE_OWNER_KEY);
    purgeEncryptedFiles();
    await purgeEncryptionKey();
  })().finally(() => {
    purgePromise = null;
  });
  return purgePromise;
}
