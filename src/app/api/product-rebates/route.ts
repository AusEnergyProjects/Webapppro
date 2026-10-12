import { getD1 } from "../../../../db";
import { BoundedJsonRequestError, readBoundedJsonRequest } from "@/lib/bounded-json-request";
import { parseProductRebateCheckRequest, ProductRebateCheckError } from "@/lib/product-rebate-check";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: {
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ ok: false, code: "ORIGIN_REJECTED", error: "Request origin was not accepted." }, 403);
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return json({ ok: false, code: "CONTENT_TYPE_INVALID", error: "Send the rebate check as JSON." }, 415);
  }
  try {
    const input = parseProductRebateCheckRequest(await readBoundedJsonRequest(request, 2048));
    const { checkProductRebates } = await import("@/lib/product-rebate-check-server");
    const result = await checkProductRebates(getD1(), input);
    return json(result);
  } catch (error) {
    if (error instanceof BoundedJsonRequestError || error instanceof ProductRebateCheckError) {
      return json({ ok: false, code: error.code, error: error.message }, error.status);
    }
    console.error("Product rebate check failed.", error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : "Unknown error");
    return json({ ok: false, code: "PRODUCT_REBATE_UNAVAILABLE", error: "The rebate check could not be completed. Try again." }, 503);
  }
}
