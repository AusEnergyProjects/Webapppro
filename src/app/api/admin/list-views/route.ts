import { adminError, adminJson, cleanAdminText, requireAdminIdentity, sameOrigin } from "@/lib/admin-server";
import { ADMIN_LIST_VIEWS, deleteListView, readListView, saveListView } from "@/lib/workspace-list-views";

export const runtime = "edge";

function viewKey(request: Request) {
  return cleanAdminText(new URL(request.url).searchParams.get("view"), 50);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request);
    const view = viewKey(request);
    if (!ADMIN_LIST_VIEWS.has(view)) return adminJson({ ok: false, error: "Choose a valid operations list view." }, 400);
    const result = await readListView(admin.uid, "admin", view);
    return adminJson({ ok: true, ...result });
  } catch (error) { return adminError(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request);
    const view = viewKey(request);
    if (!ADMIN_LIST_VIEWS.has(view)) return adminJson({ ok: false, error: "Choose a valid operations list view." }, 400);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid saved view." }, 400); }
    const preferences = await saveListView(admin.uid, "admin", view, body);
    return adminJson({ ok: true, preferences, saved: true });
  } catch (error) { return adminError(error); }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request);
    const view = viewKey(request);
    if (!ADMIN_LIST_VIEWS.has(view)) return adminJson({ ok: false, error: "Choose a valid operations list view." }, 400);
    const preferences = await deleteListView(admin.uid, "admin", view);
    return adminJson({ ok: true, preferences, saved: false });
  } catch (error) { return adminError(error); }
}
