import type {
  OfficialSourceBaseline,
  OfficialSourceCustodyFixture,
} from "../lib/energy-assistant-official-source-custody.ts";

/**
 * Reviewed upstream byte baselines belong here only after a preparer records
 * the captured artifact and an independent reviewer approves the matching
 * hashes. An empty manifest deliberately makes current-fact use fail closed.
 */
export const ENERGY_ASSISTANT_OFFICIAL_SOURCE_BASELINES = Object.freeze(
  [] as const satisfies readonly OfficialSourceBaseline[],
);

/**
 * Exact fixture bytes are checked in only after preparation. A fixture does
 * not approve itself. The release audit also requires a matching independent
 * approval record.
 */
export const ENERGY_ASSISTANT_OFFICIAL_SOURCE_CUSTODY_FIXTURES = Object.freeze(
  [] as const satisfies readonly OfficialSourceCustodyFixture[],
);

/**
 * No registry source has completed exact-byte baseline and independent
 * custody approval yet. This explicit state lets the offline audit distinguish
 * an intentional empty scope from a missing manifest.
 */
export const ENERGY_ASSISTANT_OFFICIAL_SOURCE_CUSTODY_RELEASE_SCOPE = Object.freeze({
  contractVersion: "official-source-custody-release-scope-v1",
  status: "not_yet_required",
  requiredSourceIds: [] as const,
  reason:
    "No official registry source has a reviewed exact-byte baseline and matching independent custody approval.",
} as const);
