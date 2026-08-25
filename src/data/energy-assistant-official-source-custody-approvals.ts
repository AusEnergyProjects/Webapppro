import type { OfficialSourceCustodyApproval } from "../lib/energy-assistant-source-review.ts";

/** Human approvals only. Capture tooling must never append to this manifest. */
export const ENERGY_ASSISTANT_OFFICIAL_SOURCE_CUSTODY_APPROVALS = Object.freeze(
  [] as const satisfies readonly OfficialSourceCustodyApproval[],
);
