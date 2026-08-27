import { getD1 } from "../../../../../db";
import {
  adminError,
  adminJson,
  cleanAdminText,
  requireAdminIdentity,
  sameOrigin,
  writeAdminAudit,
} from "@/lib/admin-server";

export const runtime = "edge";

const STATUSES = new Set(["pending", "reviewed", "dismissed"]);

function shapeReview(row: Record<string, unknown>) {
  return {
    id: row.id,
    answerId: row.answer_id,
    question: row.question,
    answer: row.answer,
    status: row.status,
    reviewerUid: row.reviewer_uid,
    reviewNote: row.review_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request, ["owner", "admin", "reviewer"]);
    const url = new URL(request.url);
    const requestedStatus = cleanAdminText(url.searchParams.get("status"), 20);
    const status = STATUSES.has(requestedStatus) ? requestedStatus : "pending";
    const result = await getD1().prepare(`SELECT id, answer_id, question, answer, status,
        reviewer_uid, review_note, created_at, updated_at
      FROM surge_answer_reviews
      WHERE status = ?
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 100`).bind(status).all<Record<string, unknown>>();
    return adminJson({ ok: true, reviews: result.results.map(shapeReview) });
  } catch (error) {
    return adminError(error);
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin", "reviewer"]);
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return adminJson({ ok: false, error: "The review update was not valid." }, 400);
    }
    const allowedKeys = new Set(["id", "status", "reviewNote"]);
    if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
      return adminJson({ ok: false, error: "The review update contained an unsupported field." }, 400);
    }
    const id = cleanAdminText(body.id, 120);
    const status = cleanAdminText(body.status, 20);
    const reviewNote = cleanAdminText(body.reviewNote, 1_000);
    if (!id || !new Set(["reviewed", "dismissed"]).has(status)) {
      return adminJson({ ok: false, error: "Choose a valid answer review and outcome." }, 400);
    }
    const database = getD1();
    const current = await database.prepare("SELECT id, status FROM surge_answer_reviews WHERE id = ? LIMIT 1")
      .bind(id).first<Record<string, unknown>>();
    if (!current) return adminJson({ ok: false, error: "Answer review not found." }, 404);
    const now = new Date().toISOString();
    await database.prepare(`UPDATE surge_answer_reviews
      SET status = ?, reviewer_uid = ?, review_note = ?, updated_at = ?
      WHERE id = ?`).bind(status, admin.uid, reviewNote, now, id).run();
    await writeAdminAudit(admin, "surge_answer_reviewed", "surge_answer_review", id,
      `Surge answer review marked ${status}.`, { previousStatus: current.status, status });
    const updated = await database.prepare(`SELECT id, answer_id, question, answer, status,
        reviewer_uid, review_note, created_at, updated_at
      FROM surge_answer_reviews
      WHERE id = ?
      LIMIT 1`).bind(id).first<Record<string, unknown>>();
    return adminJson({ ok: true, review: updated ? shapeReview(updated) : null });
  } catch (error) {
    return adminError(error);
  }
}
