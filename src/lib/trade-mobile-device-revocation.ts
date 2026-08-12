import { env } from "cloudflare:workers";
import { getD1 } from "../../db";

type EvidenceBucket = {
  resumeMultipartUpload(key: string, uploadId: string): { abort(): Promise<void> };
  head(key: string): Promise<unknown | null>;
  delete(key: string): Promise<void>;
};

export async function abortDeviceUploads(ownerUid: string, deviceId: string) {
  const store = (env as unknown as { EVIDENCE?: EvidenceBucket }).EVIDENCE;
  while (true) {
    const rows = await getD1().prepare(`SELECT id, object_key, upload_id
      FROM trade_mobile_upload_sessions
      WHERE owner_uid = ? AND device_id = ?
        AND status IN ('initiated', 'uploading', 'completing')
        AND media_id = ''
      ORDER BY created_at, id
      LIMIT 50`)
      .bind(ownerUid, deviceId).all<Record<string, unknown>>();
    if (rows.results.length === 0) return;
    for (const row of rows.results) {
      const now = new Date().toISOString();
      const claim = await getD1().prepare(`UPDATE trade_mobile_upload_sessions
        SET status = 'aborted', last_error = 'device_revoked', updated_at = ?
        WHERE id = ? AND owner_uid = ? AND device_id = ?
          AND status IN ('initiated', 'uploading', 'completing')
          AND media_id = ''`)
        .bind(now, row.id, ownerUid, deviceId).run();
      if (Number(claim.meta.changes || 0) !== 1) continue;
      if (store) {
        try {
          await store.resumeMultipartUpload(String(row.object_key), String(row.upload_id)).abort();
        } catch { /* the claimed multipart upload may already be assembled or absent */ }
        try {
          if (await store.head(String(row.object_key))) await store.delete(String(row.object_key));
        } catch { /* durable database revocation remains authoritative if object cleanup must be retried */ }
      }
      await getD1().prepare("DELETE FROM trade_mobile_upload_parts WHERE session_id = ?")
        .bind(row.id).run();
    }
  }
}

export async function abortMemberDeviceUploads(ownerUid: string, memberId: string) {
  const devices = await getD1().prepare(`SELECT device_id FROM trade_mobile_devices
    WHERE owner_uid = ? AND member_id = ? AND status = 'revoked'`)
    .bind(ownerUid, memberId).all<Record<string, unknown>>();
  for (const device of devices.results) {
    await abortDeviceUploads(ownerUid, String(device.device_id || ""));
  }
}
