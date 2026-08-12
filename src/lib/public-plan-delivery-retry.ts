const RETRY_DELAYS_MINUTES = [5, 30, 120, 240, 480, 960, 1_440] as const;

export const PUBLIC_PLAN_DELIVERY_DISPATCH_HEADER =
  "X-AEA-Public-Plan-Delivery-Dispatch";

export function publicPlanDeliveryRetryAt(attempts: number, now = Date.now()) {
  const index = Math.max(0, Math.floor(Number(attempts) || 1) - 1);
  const minutes = RETRY_DELAYS_MINUTES[Math.min(index, RETRY_DELAYS_MINUTES.length - 1)];
  return new Date(now + minutes * 60 * 1000).toISOString();
}

export function shouldDrainPublicPlanDeliveryBacklog(input: {
  method: string;
  pathname: string;
  responseOk: boolean;
}) {
  if (!input.responseOk) return false;
  return (input.method === "POST" && input.pathname === "/api/leads")
    || (input.method === "GET" && input.pathname === "/api/health");
}

export function takePublicPlanDeliveryDispatch(
  response: Response,
  headerName = PUBLIC_PLAN_DELIVERY_DISPATCH_HEADER,
) {
  const intakeId = response.headers.get(headerName) || "";
  if (!intakeId) return { intakeId: "", response };
  const headers = new Headers(response.headers);
  headers.delete(headerName);
  return {
    intakeId,
    response: new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
  };
}
