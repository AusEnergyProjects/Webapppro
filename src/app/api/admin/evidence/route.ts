import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../db";
import { adminError, adminJson, cleanAdminText, requireAdminIdentity, sameOrigin, writeAdminAudit } from "@/lib/admin-server";

export const runtime = "edge";

type EvidenceBucket = {
  get(key: string): Promise<{ body: BodyInit } | null>;
};

function safeFileName(value: string) {
  return value.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "verification-document";
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin", "reviewer"]);
    const id = cleanAdminText(new URL(request.url).searchParams.get("id"), 180);
    if (!id) return adminJson({ ok: false, error: "Choose a verification document." }, 400);
    const record = await getD1().prepare(`SELECT id, firebase_uid, file_name, content_type, object_key
      FROM verification_documents WHERE id = ?`).bind(id).first<Record<string, unknown>>();
    if (!record) return adminJson({ ok: false, error: "Verification document not found." }, 404);
    const bucket = (env as unknown as { EVIDENCE?: EvidenceBucket }).EVIDENCE;
    if (!bucket) return adminJson({ ok: false, error: "Verification storage is unavailable." }, 503);
    const object = await bucket.get(String(record.object_key));
    if (!object) return adminJson({ ok: false, error: "The stored document could not be found." }, 404);
    await writeAdminAudit(admin, "verification.download", "verification_document", id, "Downloaded a verification document for review.", { firebaseUid: record.firebase_uid });
    return new Response(object.body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": String(record.content_type || "application/octet-stream"),
        "Content-Disposition": `attachment; filename="${safeFileName(String(record.file_name))}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) { return adminError(error); }
}
