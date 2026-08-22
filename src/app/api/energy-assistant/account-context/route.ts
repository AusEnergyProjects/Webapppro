import { getD1 } from "../../../../../db";
import { FirebaseAuthError, requireFirebaseIdentity } from "@/lib/firebase-server";
import {
  deleteSurgeAccountContext,
  loadSurgeAccountContext,
  saveSurgeAccountContext,
} from "@/lib/surge-account-context-server";

export const runtime = "edge";

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function identity(request: Request) {
  try {
    return await requireFirebaseIdentity(request);
  } catch (error) {
    if (error instanceof FirebaseAuthError) return null;
    throw error;
  }
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false }, 403);
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  const profile = await loadSurgeAccountContext(getD1(), user.uid);
  return json({ ok: true, saved: Boolean(profile), profile });
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false }, 403);
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  if (Number(request.headers.get("content-length") || 0) > 40_000) {
    return json({ ok: false, error: "The account context was too large." }, 413);
  }
  try {
    const body = await request.json() as { confirmAccountContextSave?: unknown; profile?: unknown };
    if (body.confirmAccountContextSave !== true) {
      return json({ ok: false, error: "Confirm before saving context to an account." }, 400);
    }
    const profile = await saveSurgeAccountContext(getD1(), user.uid, body.profile);
    return json({ ok: true, saved: true, profile });
  } catch (error) {
    console.error("Surge account context save failed", error);
    return json({ ok: false, error: "The account context could not be saved." }, 500);
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false }, 403);
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  try {
    const body = await request.json() as { confirmDelete?: unknown };
    if (body.confirmDelete !== true) {
      return json({ ok: false, error: "Confirm before deleting the account copy." }, 400);
    }
    await deleteSurgeAccountContext(getD1(), user.uid);
    return json({ ok: true, saved: false });
  } catch (error) {
    console.error("Surge account context deletion failed", error);
    return json({ ok: false, error: "The account context could not be deleted." }, 500);
  }
}
