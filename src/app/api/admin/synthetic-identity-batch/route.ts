export const runtime = "edge";

const FIREBASE_WEB_API_KEY = "AIzaSyBL9P793q5z7o6Baqg-o2yuIteYU6IHrug";
const SYNTHETIC_EMAIL = /^aea-demo-20260716\.(installer|wholesaler|consumer)\.\d{3}@example\.com$/;

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const configured = process.env.SYNTHETIC_SEED_SECRET || "";
  const supplied = request.headers.get("x-synthetic-seed-secret") || "";
  if (!configured || supplied.length < 32 || supplied !== configured) return json({ ok: false, error: "Not found." }, 404);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ ok: false, error: "Invalid synthetic identity request." }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const displayName = String(body.displayName || "").trim().slice(0, 100);
  if (!SYNTHETIC_EMAIL.test(email) || password.length < 12 || password.length > 128 || !displayName) {
    return json({ ok: false, error: "Only the controlled synthetic benchmark identity range is accepted." }, 400);
  }
  const signup = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_WEB_API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  let result = await signup.json().catch(() => ({})) as Record<string, unknown>;
  if (!signup.ok && (result.error as { message?: string } | undefined)?.message === "EMAIL_EXISTS") {
    const signin = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_WEB_API_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    result = await signin.json().catch(() => ({})) as Record<string, unknown>;
    if (!signin.ok) return json({ ok: false, error: "The existing synthetic identity could not be recovered." }, 409);
  } else if (!signup.ok) {
    return json({ ok: false, error: "The synthetic identity provider request was paused." }, 503);
  }
  const localId = String(result.localId || "");
  const idToken = String(result.idToken || "");
  if (!localId || !idToken) return json({ ok: false, error: "The synthetic identity response was incomplete." }, 502);
  await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${FIREBASE_WEB_API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, displayName, returnSecureToken: false }),
  }).catch(() => null);
  return json({ ok: true, firebaseUid: localId });
}
