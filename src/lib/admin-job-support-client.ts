/** Scope every support read to one job without changing the signed-in identity. */
export function createAdminJobSupportFetch(workOrderId: string, origin: string, request: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), origin);
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (url.origin !== origin || !url.pathname.startsWith("/api/")) {
      throw new Error("Support files must be opened through the authenticated job view.");
    }
    if (method !== "GET") throw new Error("This support view is read only.");
    const scoped = new Request(input instanceof Request ? input : url, init);
    const headers = new Headers(scoped.headers);
    headers.delete("X-TLink-Business");
    headers.set("X-TLink-Admin-Job", workOrderId);
    return request(new Request(scoped, { headers, cache: "no-store" }));
  };
}
