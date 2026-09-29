export type TradeBusinessChoice = {
  ownerUid: string;
  businessName: string;
  role: "owner" | "member";
  memberId: string;
  displayName: string;
};

const selectionKey = (uid: string) => `tlink-business:${uid}`;

export function readTradeBusinessSelection(uid: string, storage?: Pick<Storage, "getItem">): string {
  try { return (storage || sessionStorage).getItem(selectionKey(uid)) || ""; } catch { return ""; }
}

export function saveTradeBusinessSelection(uid: string, ownerUid: string, storage?: Pick<Storage, "setItem" | "removeItem">): void {
  try {
    const target = storage || sessionStorage;
    if (ownerUid) target.setItem(selectionKey(uid), ownerUid);
    else target.removeItem(selectionKey(uid));
  } catch { /* The current tab can still use its selected business without persistence. */ }
}

export function resolveTradeBusinessSelection(businesses: TradeBusinessChoice[], savedOwnerUid: string): TradeBusinessChoice | null {
  return businesses.find(business => business.ownerUid === savedOwnerUid) || (businesses.length === 1 ? businesses[0] : null);
}

export function createTradeBusinessFetch(ownerUid: string, origin: string, request: typeof fetch = fetch, onAccessLost?: () => void): typeof fetch {
  // Capture the selected business when the tenant subtree mounts. An old async
  // operation must never be retargeted to a later business selection.
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), origin);
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    if (url.origin === origin && url.pathname.startsWith("/api/") && headers.get("Authorization")?.startsWith("Bearer ")) {
      headers.set("X-TLink-Business", ownerUid);
      const response = await request(input, { ...init, headers });
      if (onAccessLost && (response.status === 403 || response.status === 409)) {
        const result = await response.clone().json().catch(() => null) as { code?: string } | null;
        if (result?.code === "BUSINESS_ACCESS_REQUIRED" || result?.code === "BUSINESS_SELECTION_REQUIRED") onAccessLost();
      }
      return response;
    }
    return request(input, init);
  };
}
