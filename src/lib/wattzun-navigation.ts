import { WATTZUN_PORTAL_GUIDE } from "./wattzun-portal-guide.ts";
import type { WattzunPortal } from "./wattzun-portal";

export type WattzunNavigationAction = { kind: "open_workspace"; destinationId: string };

/** Navigation can select existing destinations, never provider-supplied URLs. */
export function isWattzunNavigationAction(value: unknown, portal: WattzunPortal): value is WattzunNavigationAction {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 2
    && "kind" in value && value.kind === "open_workspace" && "destinationId" in value
    && WATTZUN_PORTAL_GUIDE[portal].some(link => link.id === value.destinationId);
}

export function wattzunNavigationDestination(action: WattzunNavigationAction, portal: WattzunPortal) {
  return WATTZUN_PORTAL_GUIDE[portal].find(link => link.id === action.destinationId);
}
