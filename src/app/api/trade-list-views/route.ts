import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { deleteListView, readListView, saveListView, TRADE_LIST_VIEWS } from "@/lib/workspace-list-views";

export const runtime = "edge";

async function access(request: Request) {
  if (!sameOrigin(request)) return { response: adminJson({ ok: false, error: "Request origin was not accepted." }, 403) };
  let identity;
  try { identity = await requireFirebaseIdentity(request); }
  catch { return { response: adminJson({ ok: false, error: "Sign in to continue." }, 401) }; }
  const account = await getD1().prepare("SELECT account_status FROM trade_accounts WHERE firebase_uid = ?")
    .bind(identity.uid).first<Record<string, unknown>>();
  if (!account || account.account_status !== "active") {
    return { response: adminJson({ ok: false, error: "An active business account is required." }, 403) };
  }
  return { identity };
}

function viewKey(request: Request) {
  return cleanAdminText(new URL(request.url).searchParams.get("view"), 50);
}

export async function GET(request: Request) {
  const authorised = await access(request);
  if (authorised.response || !authorised.identity) return authorised.response;
  const view = viewKey(request);
  if (!TRADE_LIST_VIEWS.has(view)) return adminJson({ ok: false, error: "Choose a valid business list view." }, 400);
  const result = await readListView(authorised.identity.uid, "trade", view);
  return adminJson({ ok: true, ...result });
}

export async function PATCH(request: Request) {
  const authorised = await access(request);
  if (authorised.response || !authorised.identity) return authorised.response;
  const view = viewKey(request);
  if (!TRADE_LIST_VIEWS.has(view)) return adminJson({ ok: false, error: "Choose a valid business list view." }, 400);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return adminJson({ ok: false, error: "Invalid saved view." }, 400); }
  const preferences = await saveListView(authorised.identity.uid, "trade", view, body);
  return adminJson({ ok: true, preferences, saved: true });
}

export async function DELETE(request: Request) {
  const authorised = await access(request);
  if (authorised.response || !authorised.identity) return authorised.response;
  const view = viewKey(request);
  if (!TRADE_LIST_VIEWS.has(view)) return adminJson({ ok: false, error: "Choose a valid business list view." }, 400);
  const preferences = await deleteListView(authorised.identity.uid, "trade", view);
  return adminJson({ ok: true, preferences, saved: false });
}
