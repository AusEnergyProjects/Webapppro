import { getD1 } from "../../../../../../db";
import {
  manualFieldErrorResponse,
  registerManualFieldDevice,
  requireManualFieldMember,
  revokeManualFieldDevice,
} from "@/lib/creditex-manual-field-server";
import {
  BoundedJsonRequestError,
  readBoundedJsonRequest,
} from "@/lib/bounded-json-request";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return json({
      ok: false,
      code: "ORIGIN_REJECTED",
      error: "Request origin was not accepted.",
    }, 403);
  }
  try {
    const database = getD1();
    const member = await requireManualFieldMember(request, database);
    const body = await readBoundedJsonRequest(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json({
        ok: false,
        code: "MANUAL_FIELD_DEVICE_INVALID",
        error: "The TLink test-device registration is invalid.",
      }, 400);
    }
    return json({
      ok: true,
      ...(await registerManualFieldDevice(
        database,
        member,
        body as Record<string, unknown>,
      )),
    }, 201);
  } catch (error) {
    if (error instanceof BoundedJsonRequestError) {
      return json({
        ok: false,
        code: error.code,
        error: error.message,
      }, error.status);
    }
    const response = manualFieldErrorResponse(error);
    return json(response.body, response.status);
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) {
    return json({
      ok: false,
      code: "ORIGIN_REJECTED",
      error: "Request origin was not accepted.",
    }, 403);
  }
  try {
    const database = getD1();
    const member = await requireManualFieldMember(request, database);
    const body = await readBoundedJsonRequest(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json({
        ok: false,
        code: "MANUAL_FIELD_DEVICE_INVALID",
        error: "The TLink test-device sign-out is invalid.",
      }, 400);
    }
    return json({
      ok: true,
      ...(await revokeManualFieldDevice(
        database,
        member,
        body as Record<string, unknown>,
      )),
    });
  } catch (error) {
    if (error instanceof BoundedJsonRequestError) {
      return json({
        ok: false,
        code: error.code,
        error: error.message,
      }, error.status);
    }
    const response = manualFieldErrorResponse(error);
    return json(response.body, response.status);
  }
}
