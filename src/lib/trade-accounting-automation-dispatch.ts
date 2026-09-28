const HEADER = "X-TLink-Accounting-Dispatch";

export function withAccountingDispatch(response: Response, invoiceId: string) {
  if (!response.ok || !invoiceId) return response;
  const headers = new Headers(response.headers);
  headers.set(HEADER, invoiceId);
  return new Response(response.body, { status: response.status, headers });
}

export function queueAccountingDispatch(response: Response, context: {
  waitUntil: (promise: Promise<unknown>) => void;
  drain: (invoiceId: string) => Promise<unknown>;
  onError: (error: unknown) => void;
}) {
  const invoiceId = response.ok ? response.headers.get(HEADER) : null;
  if (!response.headers.has(HEADER)) return response;
  const headers = new Headers(response.headers);
  headers.delete(HEADER);
  if (invoiceId) context.waitUntil(Promise.resolve().then(() => context.drain(invoiceId)).catch(context.onError));
  return new Response(response.body, { status: response.status, headers });
}
