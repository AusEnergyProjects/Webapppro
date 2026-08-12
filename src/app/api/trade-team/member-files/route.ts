import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { requireInstallerTeamAccess, type TeamAccess } from "@/lib/trade-team-server";
import {
  inspectTeamMemberFile,
  safeTeamMemberFileName,
  TEAM_MEMBER_FILE_CATEGORIES,
  TEAM_MEMBER_FILE_LIMIT,
  TeamMemberFileError,
} from "@/lib/trade-team-member-files-server";
import { drainTradeTeamMemberFileCleanup } from "@/lib/trade-team-member-file-cleanup";

export const runtime = "edge";

type MemberFileBucket = {
  put(key: string, value: ArrayBuffer, options?: {
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  }): Promise<unknown>;
  get(key: string): Promise<{
    body: BodyInit;
    httpMetadata?: { contentType?: string };
  } | null>;
  delete(key: string): Promise<void>;
};

type MemberFileRow = {
  id: string;
  owner_uid: string;
  team_member_id: string;
  category: string;
  description: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  object_key: string;
  status: string;
  cleanup_attempts: number;
  next_cleanup_at: string;
  last_cleanup_error: string;
  uploaded_by_uid: string;
  created_at: string;
  updated_at: string;
  deleted_at: string;
};

function memberFileBucket() {
  const bucket = (env as unknown as { EVIDENCE?: MemberFileBucket }).EVIDENCE;
  if (!bucket) throw new Error("STORAGE_UNAVAILABLE");
  return bucket;
}

function errorResponse(error: unknown) {
  if (error instanceof TeamMemberFileError) {
    return adminJson({ ok: false, code: error.code, error: error.message }, error.status);
  }
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "OWNER_REQUIRED") return adminJson({ ok: false, error: "Only the business owner can access team member files." }, 403);
  if (code === "MEMBER_NOT_FOUND") return adminJson({ ok: false, error: "Team member not found." }, 404);
  if (code === "FILE_NOT_FOUND") return adminJson({ ok: false, error: "Team member file not found." }, 404);
  if (code === "FILE_LIMIT_REACHED") return adminJson({ ok: false, error: `This team member already has ${TEAM_MEMBER_FILE_LIMIT} active files.` }, 409);
  if (code === "STORAGE_UNAVAILABLE") return adminJson({ ok: false, error: "Private file storage is temporarily unavailable." }, 503);
  const requestId = crypto.randomUUID();
  console.error("Team member file request failed", { requestId, code: code || "UNKNOWN" });
  const response = adminJson({ ok: false, error: "The private team member file request could not be completed.", requestId }, 500);
  response.headers.set("X-TLink-Request-Id", requestId);
  return response;
}

async function ownerAccess(request: Request) {
  const access = await requireInstallerTeamAccess(request);
  if (!access.isOwner) throw new Error("OWNER_REQUIRED");
  return access;
}

async function ownedMember(access: TeamAccess, memberId: string) {
  const member = await getD1().prepare(`SELECT id, display_name, status
    FROM trade_team_members WHERE id = ? AND owner_uid = ? AND status <> 'removed'`)
    .bind(memberId, access.ownerUid).first<Record<string, unknown>>();
  if (!member) throw new Error("MEMBER_NOT_FOUND");
  return member;
}

function auditStatement(
  access: TeamAccess,
  memberId: string,
  entityId: string,
  eventType: string,
  metadata: Record<string, unknown>,
) {
  return getD1().prepare(`INSERT INTO trade_team_member_events
    (id, owner_uid, team_member_id, actor_uid, entity_type, entity_id, event_type, metadata, created_at)
    VALUES (?, ?, ?, ?, 'file', ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), access.ownerUid, memberId, access.actorUid, entityId,
      eventType, JSON.stringify(metadata), new Date().toISOString());
}

function conditionalFileAuditStatement(
  access: TeamAccess,
  memberId: string,
  entityId: string,
  eventType: string,
  metadata: Record<string, unknown>,
  expectedStatus: "active" | "cleanup_pending",
  updatedAt: string,
) {
  return getD1().prepare(`INSERT INTO trade_team_member_events
    (id, owner_uid, team_member_id, actor_uid, entity_type, entity_id, event_type, metadata, created_at)
    SELECT ?, ?, ?, ?, 'file', ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM trade_team_member_files file
      WHERE file.id = ? AND file.owner_uid = ? AND file.team_member_id = ?
        AND file.status = ? AND file.updated_at = ?)`)
    .bind(crypto.randomUUID(), access.ownerUid, memberId, access.actorUid, entityId,
      eventType, JSON.stringify(metadata), updatedAt, entityId, access.ownerUid, memberId,
      expectedStatus, updatedAt);
}

async function sweepCleanup(access: TeamAccess, specificFileId = "") {
  return drainTradeTeamMemberFileCleanup({
    db: getD1(),
    bucket: memberFileBucket(),
    ownerUid: access.ownerUid,
    fileId: specificFileId,
    limit: 5,
  });
}

function filePayload(row: MemberFileRow) {
  return {
    id: row.id,
    memberId: row.team_member_id,
    category: row.category,
    description: row.description,
    fileName: row.file_name,
    contentType: row.content_type,
    mimeType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    byteSize: Number(row.size_bytes),
    sha256: row.sha256,
    createdAt: row.created_at,
    uploadedAt: row.created_at,
    updatedAt: row.updated_at,
    viewPath: `/api/trade-team/member-files?memberId=${encodeURIComponent(row.team_member_id)}&fileId=${encodeURIComponent(row.id)}`,
    downloadPath: `/api/trade-team/member-files?memberId=${encodeURIComponent(row.team_member_id)}&fileId=${encodeURIComponent(row.id)}&download=1`,
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await ownerAccess(request);
    await sweepCleanup(access);
    const search = new URL(request.url).searchParams;
    const memberId = cleanAdminText(search.get("memberId"), 180);
    await ownedMember(access, memberId);
    const fileId = cleanAdminText(search.get("fileId"), 180);
    if (!fileId) {
      const rows = await getD1().prepare(`SELECT * FROM trade_team_member_files
        WHERE owner_uid = ? AND team_member_id = ? AND status = 'active'
        ORDER BY created_at DESC, id DESC`)
        .bind(access.ownerUid, memberId).all<MemberFileRow>();
      await auditStatement(access, memberId, memberId, "vault.viewed", { fileCount: rows.results.length }).run();
      return adminJson({ ok: true, memberId, files: rows.results.map(filePayload) });
    }
    const row = await getD1().prepare(`SELECT * FROM trade_team_member_files
      WHERE id = ? AND owner_uid = ? AND team_member_id = ? AND status = 'active'`)
      .bind(fileId, access.ownerUid, memberId).first<MemberFileRow>();
    if (!row) throw new Error("FILE_NOT_FOUND");
    const object = await memberFileBucket().get(row.object_key);
    if (!object) throw new Error("FILE_NOT_FOUND");
    const download = search.get("download") === "1";
    await auditStatement(access, memberId, row.id, download ? "file.downloaded" : "file.viewed", {
      category: row.category,
      sizeBytes: Number(row.size_bytes),
    }).run();
    return new Response(object.body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeTeamMemberFileName(row.file_name)}"`,
        "Content-Type": object.httpMetadata?.contentType || row.content_type,
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await ownerAccess(request);
    await sweepCleanup(access);
    const contentType = request.headers.get("content-type") || "";
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (!contentType.toLowerCase().startsWith("multipart/form-data; boundary=")
      || !Number.isFinite(contentLength) || contentLength <= 0
      || contentLength > 13 * 1024 * 1024) {
      return adminJson({ ok: false, error: "Upload one PDF, JPEG or PNG file no larger than 12 MB." }, 400);
    }
    let form: FormData;
    try { form = await request.formData(); }
    catch { return adminJson({ ok: false, error: "The team member file upload could not be read." }, 400); }
    const action = cleanAdminText(form.get("action"), 30) || "upload";
    const memberId = cleanAdminText(form.get("memberId"), 180);
    await ownedMember(access, memberId);
    if (action === "retry_cleanup") {
      const fileId = cleanAdminText(form.get("fileId"), 180);
      const result = await sweepCleanup(access, fileId);
      return adminJson({ ok: true, cleanup: result });
    }
    if (action !== "upload") return adminJson({ ok: false, error: "Unsupported team member file action." }, 400);
    const category = cleanAdminText(form.get("category"), 30);
    const description = cleanAdminText(form.get("description"), 500);
    if (!TEAM_MEMBER_FILE_CATEGORIES.has(category)) {
      return adminJson({ ok: false, error: "Choose ID, licence, compliance, training, insurance or other." }, 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) return adminJson({ ok: false, error: "Choose a team member file." }, 400);
    const activeCount = await getD1().prepare(`SELECT COUNT(*) count FROM trade_team_member_files
      WHERE owner_uid = ? AND team_member_id = ? AND status IN ('uploading', 'active')`)
      .bind(access.ownerUid, memberId).first<Record<string, unknown>>();
    if (Number(activeCount?.count || 0) >= TEAM_MEMBER_FILE_LIMIT) throw new Error("FILE_LIMIT_REACHED");
    const inspected = await inspectTeamMemberFile(file);
    const id = crypto.randomUUID();
    const objectKey = `trade-team-members/${access.ownerUid}/${memberId}/${id}`;
    const now = new Date().toISOString();
    await getD1().batch([
      getD1().prepare(`INSERT INTO trade_team_member_files
        (id, owner_uid, team_member_id, category, description, file_name, content_type,
         size_bytes, sha256, object_key, status, cleanup_attempts, next_cleanup_at,
         last_cleanup_error, uploaded_by_uid, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', 0, '', '', ?, ?, ?, '')`)
        .bind(id, access.ownerUid, memberId, category, description, inspected.fileName,
          inspected.contentType, inspected.sizeBytes, inspected.sha256, objectKey,
          access.actorUid, now, now),
      auditStatement(access, memberId, id, "file.upload_started", {
        category, contentType: inspected.contentType, sizeBytes: inspected.sizeBytes,
      }),
    ]);
    try {
      await memberFileBucket().put(objectKey, inspected.value, {
        httpMetadata: { contentType: inspected.contentType },
        customMetadata: { ownerUid: access.ownerUid, teamMemberId: memberId, fileId: id },
      });
      const results = await getD1().batch([
        getD1().prepare(`UPDATE trade_team_member_files SET status = 'active', updated_at = ?
          WHERE id = ? AND owner_uid = ? AND team_member_id = ? AND status = 'uploading'`)
          .bind(now, id, access.ownerUid, memberId),
        conditionalFileAuditStatement(access, memberId, id, "file.uploaded", {
          category, contentType: inspected.contentType, sizeBytes: inspected.sizeBytes,
        }, "active", now),
      ]);
      if (Number(results[0]?.meta.changes || 0) !== 1) throw new Error("FILE_UPLOAD_STATE_CHANGED");
    } catch (error) {
      try {
        await getD1().prepare(`UPDATE trade_team_member_files SET status = 'cleanup_pending',
          next_cleanup_at = ?, last_cleanup_error = 'upload_finalisation_failed', updated_at = ?
          WHERE id = ? AND owner_uid = ? AND team_member_id = ? AND status IN ('uploading', 'active')`)
          .bind(now, now, id, access.ownerUid, memberId).run();
        await sweepCleanup(access, id);
      } catch (cleanupError) {
        console.error("Team member file cleanup intent could not be persisted", {
          fileId: id, memberId, objectKey, error: cleanupError instanceof Error ? cleanupError.name : "CleanupError",
        });
      }
      throw error;
    }
    const row = await getD1().prepare(`SELECT * FROM trade_team_member_files
      WHERE id = ? AND owner_uid = ? AND team_member_id = ? AND status = 'active'`)
      .bind(id, access.ownerUid, memberId).first<MemberFileRow>();
    if (!row) throw new Error("FILE_UPLOAD_STATE_CHANGED");
    return adminJson({ ok: true, file: filePayload(row) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await ownerAccess(request);
    await sweepCleanup(access);
    const search = new URL(request.url).searchParams;
    const memberId = cleanAdminText(search.get("memberId"), 180);
    await ownedMember(access, memberId);
    const fileId = cleanAdminText(search.get("fileId"), 180);
    const current = await getD1().prepare(`SELECT * FROM trade_team_member_files
      WHERE id = ? AND owner_uid = ? AND team_member_id = ? AND status = 'active'`)
      .bind(fileId, access.ownerUid, memberId).first<MemberFileRow>();
    if (!current) throw new Error("FILE_NOT_FOUND");
    const now = new Date().toISOString();
    const results = await getD1().batch([
      getD1().prepare(`UPDATE trade_team_member_files SET status = 'cleanup_pending',
        next_cleanup_at = ?, last_cleanup_error = 'delete_requested', updated_at = ?
        WHERE id = ? AND owner_uid = ? AND team_member_id = ? AND status = 'active'`)
        .bind(now, now, fileId, access.ownerUid, memberId),
      getD1().prepare(`UPDATE trade_team_member_credentials SET file_id = '', updated_at = ?
        WHERE owner_uid = ? AND team_member_id = ? AND file_id = ?
          AND EXISTS (SELECT 1 FROM trade_team_member_files file
            WHERE file.id = ? AND file.owner_uid = trade_team_member_credentials.owner_uid
              AND file.team_member_id = trade_team_member_credentials.team_member_id
              AND file.status = 'cleanup_pending' AND file.updated_at = ?)`)
        .bind(now, access.ownerUid, memberId, fileId, fileId, now),
      conditionalFileAuditStatement(access, memberId, fileId, "file.delete_requested", {
        category: current.category,
      }, "cleanup_pending", now),
    ]);
    if (Number(results[0]?.meta.changes || 0) !== 1) throw new Error("FILE_NOT_FOUND");
    const cleanup = await sweepCleanup(access, fileId);
    const deleted = cleanup.completed === 1;
    return adminJson({ ok: true, deleted, cleanupPending: !deleted }, deleted ? 200 : 202);
  } catch (error) {
    return errorResponse(error);
  }
}
