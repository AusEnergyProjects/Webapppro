import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { deleteListView, deleteNamedListView, readListView, readNamedListViews, saveListView, saveNamedListView, TRADE_LIST_VIEWS } from "@/lib/workspace-list-views";
import { requireVerifiedTradeAccess, TradeAccessError } from "@/lib/trade-access-server";

export const runtime = "edge";

async function access(request: Request) {
  if (!sameOrigin(request)) return { response: adminJson({ ok: false, error: "Request origin was not accepted." }, 403) };
  try {
    const verified = await requireVerifiedTradeAccess(request);
    return { identity: verified.identity };
  } catch (error) {
    if (error instanceof TradeAccessError) {
      return { response: adminJson({ ok: false, code: error.code, error: error.message }, error.status) };
    }
    return { response: adminJson({ ok: false, error: "Sign in to continue." }, 401) };
  }
}

function viewKey(request: Request) {
  return cleanAdminText(new URL(request.url).searchParams.get("view"), 50);
}

function presetId(request: Request) {
  return cleanAdminText(new URL(request.url).searchParams.get("preset"), 80);
}

function savedViewError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "SAVED_VIEW_NAME_REQUIRED") return adminJson({ ok: false, error: "Name this saved view." }, 400);
  if (message === "SAVED_VIEW_LIMIT") return adminJson({ ok: false, error: "You can keep up to 12 saved views for this list." }, 409);
  if (message === "SAVED_VIEW_NOT_FOUND") return adminJson({ ok: false, error: "That saved view no longer exists. Refresh and try again." }, 404);
  if (message.includes("UNIQUE constraint failed")) return adminJson({ ok: false, error: "A saved view with that name already exists." }, 409);
  return adminJson({ ok: false, error: "The saved view could not be updated." }, 500);
}

export async function GET(request: Request) {
  const authorised = await access(request);
  if (authorised.response || !authorised.identity) return authorised.response;
  const view = viewKey(request);
  if (!TRADE_LIST_VIEWS.has(view)) return adminJson({ ok: false, error: "Choose a valid business list view." }, 400);
  const [result, presets] = await Promise.all([
    readListView(authorised.identity.uid, "trade", view),
    readNamedListViews(authorised.identity.uid, "trade", view),
  ]);
  return adminJson({ ok: true, ...result, presets });
}

export async function POST(request: Request) {
  const authorised = await access(request);
  if (authorised.response || !authorised.identity) return authorised.response;
  const view = viewKey(request);
  if (!TRADE_LIST_VIEWS.has(view)) return adminJson({ ok: false, error: "Choose a valid business list view." }, 400);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return adminJson({ ok: false, error: "Invalid saved view." }, 400); }
  try {
    const preset = await saveNamedListView(authorised.identity.uid, "trade", view, body);
    return adminJson({ ok: true, preset }, 201);
  } catch (error) { return savedViewError(error); }
}

export async function PATCH(request: Request) {
  const authorised = await access(request);
  if (authorised.response || !authorised.identity) return authorised.response;
  const view = viewKey(request);
  if (!TRADE_LIST_VIEWS.has(view)) return adminJson({ ok: false, error: "Choose a valid business list view." }, 400);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return adminJson({ ok: false, error: "Invalid saved view." }, 400); }
  try {
    const preset = presetId(request);
    if (preset) return adminJson({ ok: true, preset: await saveNamedListView(authorised.identity.uid, "trade", view, body, preset) });
    const preferences = await saveListView(authorised.identity.uid, "trade", view, body);
    return adminJson({ ok: true, preferences, saved: true });
  } catch (error) { return savedViewError(error); }
}

export async function DELETE(request: Request) {
  const authorised = await access(request);
  if (authorised.response || !authorised.identity) return authorised.response;
  const view = viewKey(request);
  if (!TRADE_LIST_VIEWS.has(view)) return adminJson({ ok: false, error: "Choose a valid business list view." }, 400);
  try {
    const preset = presetId(request);
    if (preset) { await deleteNamedListView(authorised.identity.uid, "trade", view, preset); return adminJson({ ok: true }); }
    const preferences = await deleteListView(authorised.identity.uid, "trade", view);
    return adminJson({ ok: true, preferences, saved: false });
  } catch (error) { return savedViewError(error); }
}
