import { getD1 } from "../../../../../../db";
import {
  CREDITEX_MANUAL_FIELD_CONTRACT_VERSION,
  manualFieldAssignedJobs,
  manualFieldErrorResponse,
  requireManualFieldDevice,
  requireManualFieldMember,
  saveManualFieldForm,
} from "@/lib/creditex-manual-field-server";
import {
  BoundedJsonRequestError,
  readBoundedJsonRequest,
} from "@/lib/bounded-json-request";
import { mobileAppPolicy } from "@/lib/trade-mobile-server";

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

function deviceId(request: Request) {
  return String(
    new URL(request.url).searchParams.get("deviceId")
      || request.headers.get("x-aea-device-id")
      || "",
  ).trim();
}

export async function GET(request: Request) {
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
    const device = await requireManualFieldDevice(
      request,
      database,
      member,
      deviceId(request),
    );
    const jobs = await manualFieldAssignedJobs(database, member);
    const serverTime = new Date().toISOString();
    return json({
      ok: true,
      contractVersion: CREDITEX_MANUAL_FIELD_CONTRACT_VERSION,
      bootstrap: true,
      serverTime,
      nextCursor: `manual:${serverTime}`,
      hasMore: false,
      changes: jobs.map((job, index) => ({
        sequence: index + 1,
        entityType: "job",
        entityId: job.id,
        operation: "upsert",
        revision: job.revision,
        changedAt: job.updatedAt,
        entity: job,
      })),
      devicePolicy: mobileAppPolicy(device.platform),
      recordMode: "synthetic_test",
      externalActionsEnabled: false,
    });
  } catch (error) {
    const response = manualFieldErrorResponse(error);
    return json(response.body, response.status);
  }
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
    await requireManualFieldDevice(
      request,
      database,
      member,
      deviceId(request),
    );
    const body = await readBoundedJsonRequest(request);
    const actions = body
      && typeof body === "object"
      && !Array.isArray(body)
      && Array.isArray((body as Record<string, unknown>).actions)
      ? (body as { actions: unknown[] }).actions
      : [];
    if (actions.length > 50) {
      return json({
        ok: false,
        code: "MANUAL_FIELD_ACTION_LIMIT",
        error: "Sync up to 50 saved field actions at a time.",
      }, 400);
    }
    const results = [];
    for (const action of actions) {
      if (!action || typeof action !== "object" || Array.isArray(action)) {
        results.push({
          clientActionId: "",
          status: "rejected",
          code: "MANUAL_FIELD_ACTION_INVALID",
          error: "A saved field action is invalid.",
        });
        continue;
      }
      results.push(await saveManualFieldForm(
        database,
        member,
        action as Record<string, unknown>,
      ));
    }
    return json({
      ok: true,
      contractVersion: CREDITEX_MANUAL_FIELD_CONTRACT_VERSION,
      results,
      recordMode: "synthetic_test",
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
