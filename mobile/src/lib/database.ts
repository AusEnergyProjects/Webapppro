import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';

import { ADDRESS_MAX_AGE_MS } from '@/lib/config';
import { deleteEncryptedBundle, encryptFileForQueue, purgeEncryptedFiles, purgeEncryptionKey } from '@/lib/encrypted-files';
import type { FieldJob, OfflineAction, QueueRow, SyncChange, UploadRow } from '@/lib/types';

const DATABASE_NAME = 'aea-field.db';
const DATABASE_KEY_NAME = 'aea-field-database-key-v1';
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

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
      local_uri TEXT NOT NULL,
      file_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      category TEXT NOT NULL,
      caption TEXT NOT NULL DEFAULT '',
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
  return db;
}

export function getDatabase() {
  databasePromise ||= openDatabase();
  return databasePromise;
}

async function saveJob(db: SQLite.SQLiteDatabase, job: FieldJob, cachedAt: string) {
  await db.runAsync(
    `INSERT INTO jobs (id, work_number, scheduled_start, stage, protected_job, has_address, revision, payload, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET work_number = excluded.work_number,
        scheduled_start = excluded.scheduled_start, stage = excluded.stage,
        protected_job = excluded.protected_job, has_address = excluded.has_address,
        revision = excluded.revision, payload = excluded.payload, cached_at = excluded.cached_at`,
    job.id,
    job.workNumber,
    job.scheduledStart || '',
    job.stage,
    job.protectedJob ? 1 : 0,
    job.serviceAddress ? 1 : 0,
    job.revision,
    JSON.stringify(job),
    cachedAt,
  );
}

export async function applyChanges(changes: SyncChange[], bootstrap: boolean, serverTime: string) {
  const db = await getDatabase();
  const bootstrapIds = new Set(changes.filter((item) => item.operation === 'upsert').map((item) => item.entityId));
  await db.withTransactionAsync(async () => {
    if (bootstrap) await db.runAsync('DELETE FROM jobs');
    for (const change of changes.filter((item) => item.operation === 'delete')) {
      await db.runAsync('DELETE FROM jobs WHERE id = ?', change.entityId);
      await db.runAsync("DELETE FROM action_queue WHERE work_order_id = ? AND status <> 'conflict'", change.entityId);
      const uploads = await db.getAllAsync<{ local_uri: string }>('SELECT local_uri FROM upload_queue WHERE work_order_id = ?', change.entityId);
      for (const upload of uploads) {
        deleteEncryptedBundle(upload.local_uri);
      }
      await db.runAsync('DELETE FROM upload_queue WHERE work_order_id = ?', change.entityId);
    }
    for (const change of changes.filter((item) => item.operation === 'upsert' && item.entity)) {
      await saveJob(db, change.entity as FieldJob, serverTime);
    }
    if (bootstrap) {
      const uploads = await db.getAllAsync<{ work_order_id: string; local_uri: string }>('SELECT work_order_id, local_uri FROM upload_queue');
      for (const upload of uploads.filter((item) => !bootstrapIds.has(item.work_order_id))) deleteEncryptedBundle(upload.local_uri);
      const allowed = [...bootstrapIds];
      if (!allowed.length) {
        await db.runAsync('DELETE FROM action_queue');
        await db.runAsync('DELETE FROM upload_queue');
      } else {
        const placeholders = allowed.map(() => '?').join(', ');
        await db.runAsync(`DELETE FROM action_queue WHERE work_order_id NOT IN (${placeholders})`, ...allowed);
        await db.runAsync(`DELETE FROM upload_queue WHERE work_order_id NOT IN (${placeholders})`, ...allowed);
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

export async function queueAction(action: OfflineAction) {
  const db = await getDatabase();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO action_queue (id, work_order_id, payload, status, created_at, updated_at)
      VALUES (?, ?, ?, 'queued', ?, ?)`,
    action.clientActionId,
    action.workOrderId,
    JSON.stringify(action),
    now,
    now,
  );
  const row = await db.getFirstAsync<{ payload: string }>('SELECT payload FROM jobs WHERE id = ?', action.workOrderId);
  if (!row) return;
  const job = JSON.parse(row.payload) as FieldJob;
  if (action.type === 'set_job_stage' && action.stage) job.stage = action.stage;
  if (action.type === 'set_task_status' && action.taskId && action.status) {
    const task = job.tasks.find((item) => item.id === action.taskId);
    if (task) {
      task.status = action.status;
      task.completedAt = action.status === 'done' ? now : '';
    }
  }
  await saveJob(db, job, now);
}

export async function queuedActions(limit = 50) {
  const db = await getDatabase();
  return db.getAllAsync<QueueRow>(
    `SELECT * FROM action_queue WHERE status IN ('queued', 'retry')
      AND (retry_after = '' OR retry_after <= ?) ORDER BY created_at LIMIT ?`,
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

export async function retryConflict(id: string) {
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE action_queue SET status = 'queued', retry_after = '', error_code = '', error_message = '', updated_at = ? WHERE id = ?",
    new Date().toISOString(),
    id,
  );
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

export async function addUpload(input: Omit<UploadRow, 'session_id' | 'uploaded_parts' | 'status' | 'attempts' | 'error_message' | 'created_at'>) {
  const encryptedBundle = await encryptFileForQueue(input.local_uri, input.id);
  const db = await getDatabase();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO upload_queue
      (id, work_order_id, local_uri, file_name, content_type, size_bytes, category, caption, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.id,
    input.work_order_id,
    encryptedBundle,
    input.file_name,
    input.content_type,
    input.size_bytes,
    input.category,
    input.caption,
    now,
    now,
  );
}

export async function queuedUploads() {
  const db = await getDatabase();
  return db.getAllAsync<UploadRow>(
    "SELECT * FROM upload_queue WHERE status IN ('queued', 'uploading', 'retry') ORDER BY created_at LIMIT 10",
  );
}

export async function updateUpload(id: string, values: Partial<Pick<UploadRow, 'session_id' | 'uploaded_parts' | 'status' | 'attempts' | 'error_message'>>) {
  const db = await getDatabase();
  const current = await db.getFirstAsync<UploadRow>('SELECT * FROM upload_queue WHERE id = ?', id);
  if (!current) return;
  await db.runAsync(
    `UPDATE upload_queue SET session_id = ?, uploaded_parts = ?, status = ?, attempts = ?,
      error_message = ?, updated_at = ? WHERE id = ?`,
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

export async function queueCounts() {
  const db = await getDatabase();
  const actions = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) count FROM action_queue WHERE status IN ('queued', 'retry')");
  const uploads = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) count FROM upload_queue WHERE status IN ('queued', 'uploading', 'retry')");
  const conflicts = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) count FROM action_queue WHERE status IN ('conflict', 'rejected')");
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

export async function purgeLocalData() {
  const db = await getDatabase();
  await db.closeAsync();
  databasePromise = null;
  await SQLite.deleteDatabaseAsync(DATABASE_NAME);
  await SecureStore.deleteItemAsync(DATABASE_KEY_NAME);
  purgeEncryptedFiles();
  await purgeEncryptionKey();
}
