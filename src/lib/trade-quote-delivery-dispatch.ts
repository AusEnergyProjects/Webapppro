export const TRADE_QUOTE_DELIVERY_DISPATCH_HEADER =
  "X-AEA-Trade-Quote-Delivery-Dispatch";

type DispatchContext = {
  waitUntil: (promise: Promise<unknown>) => void;
  drain: (deliveryId: string) => Promise<unknown>;
  onError?: (error: unknown) => void;
};

export function withTradeQuoteDeliveryDispatch(
  response: Response,
  deliveryId: string,
) {
  const exactDeliveryId = String(deliveryId || "").trim();
  if (response.status !== 202 || !exactDeliveryId) return response;
  const headers = new Headers(response.headers);
  headers.set(TRADE_QUOTE_DELIVERY_DISPATCH_HEADER, exactDeliveryId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function takeTradeQuoteDeliveryDispatch(response: Response) {
  const headerDeliveryId = String(
    response.headers.get(TRADE_QUOTE_DELIVERY_DISPATCH_HEADER) || "",
  ).trim();
  const headers = new Headers(response.headers);
  headers.delete(TRADE_QUOTE_DELIVERY_DISPATCH_HEADER);
  return {
    deliveryId: response.status === 202 ? headerDeliveryId : "",
    response: new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
  };
}

export function queueTradeQuoteDeliveryDispatch(
  response: Response,
  context: DispatchContext,
) {
  const dispatch = takeTradeQuoteDeliveryDispatch(response);
  if (!dispatch.deliveryId) return dispatch.response;
  const pending = Promise.resolve()
    .then(() => context.drain(dispatch.deliveryId))
    .catch((error) => context.onError?.(error));
  context.waitUntil(pending);
  return dispatch.response;
}
