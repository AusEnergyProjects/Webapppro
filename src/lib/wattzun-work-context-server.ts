import type { WattzunAccess } from "./wattzun-portal-access-server";
import { loadWattzunTradeContext } from "./wattzun-trade-context-server";
import { loadWattzunCreditexContext } from "./wattzun-creditex-context-server";
import { loadWattzunCouncilContext } from "./wattzun-council-context-server";
import { loadWattzunFormContext } from "./wattzun-form-server";
import { loadWattzunCouncilDemographics } from "./wattzun-council-demographics-server";
import { readWattzunWorkContextInfo, readWattzunWorkReference, WattzunWorkContextError,
  type WattzunWorkContext, type WattzunWorkContextInfo, type WattzunWorkReference } from "./wattzun-work-context";

/** Server-only projections. Browser input selects a reference, never supplies facts. */
export async function loadWattzunWorkContext(request: Request, access: WattzunAccess, reference: WattzunWorkReference): Promise<WattzunWorkContext> {
  if (!readWattzunWorkReference(reference, access.scope.portal)) throw new WattzunWorkContextError(403, "Choose a work item in your current workspace.");
  const context = reference.kind === "trade_form" ? await loadWattzunFormContext(request, access, reference)
    : reference.kind === "council_postcode" ? await loadWattzunCouncilDemographics(request, access, reference)
    : reference.kind === "trade_job" ? await loadWattzunTradeContext(request, access, reference)
    : reference.kind === "creditex_audit" ? await loadWattzunCreditexContext(request, access, reference)
      : await loadWattzunCouncilContext(request, access, reference);
  validateWattzunWorkContext(context, access, reference);
  return context;
}

export function validateWattzunWorkContext(context: WattzunWorkContext, access: WattzunAccess, reference: WattzunWorkReference): void {
  if (!readWattzunWorkContextInfo(context, access.scope.portal) || JSON.stringify(context.reference) !== JSON.stringify(reference)
    || context.sources.some(source => !/^[a-z][a-z0-9_]{0,79}$/.test(source.id) || !source.description.trim() || source.description.length > 1000)
    || new Set(context.sources.map(source => source.id)).size !== context.sources.length) {
    throw new WattzunWorkContextError(503, "The selected work item could not be read safely. Open it and try again.");
  }
  if (new TextEncoder().encode(JSON.stringify(context)).byteLength > 24_000) {
    throw new WattzunWorkContextError(413, "This work item is too large for one Wattzun exchange. Open its workspace to review the full detail.");
  }
}

export function wattzunWorkContextInfo(context: WattzunWorkContext): WattzunWorkContextInfo {
  return { reference: context.reference, title: context.title, sourceSha256: context.sourceSha256,
    sources: context.sources.map(({ label, href }) => ({ label, href })), limitations: [...context.limitations] };
}
