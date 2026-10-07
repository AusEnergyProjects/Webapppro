import censusSnapshot from "../../public/data/council-demographics/abs-2021.json";
import { parseCouncilDemographics, COUNCIL_DEMOGRAPHICS_SOURCE, COUNCIL_DEMOGRAPHIC_METRICS } from "./council-demographics";
import { requireCouncilAccess } from "./council-access-server";
import { WattzunAccessError, type WattzunAccess } from "./wattzun-portal-access-server";
import type { WattzunWorkContext, WattzunWorkReference } from "./wattzun-work-context";

/** Only one validated public aggregate row and its state benchmark enter the conversation. */
export async function loadWattzunCouncilDemographics(request: Request, access: WattzunAccess,
  reference: Extract<WattzunWorkReference, { kind: "council_postcode" }>): Promise<WattzunWorkContext> {
  if (access.scope.portal !== "council") throw new WattzunAccessError(403, "Choose your Council workspace.");
  const selected = await requireCouncilAccess(request, access.scope.scopeId);
  if (!selected.ok || selected.identity.uid !== access.actorUid || selected.council.id !== access.scope.scopeId
    || !selected.council.postcodes.includes(reference.postcode)) throw new WattzunAccessError(403, "Choose a postcode in your current Council reporting area.");
  const data = parseCouncilDemographics(censusSnapshot);
  const facts = { councilName: selected.council.name, state: selected.council.state,
    source: COUNCIL_DEMOGRAPHICS_SOURCE, measures: COUNCIL_DEMOGRAPHIC_METRICS,
    postcode: data.rows.find(row => row.code === reference.postcode) ?? null,
    stateBenchmark: data.states.find(row => row.code === selected.council.state) ?? null };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ actorUid: access.actorUid,
    councilId: selected.council.id, role: selected.council.role, reference, facts })));
  return { reference, title: `${selected.council.name}: postcode ${reference.postcode} demographics`,
    sourceSha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""), facts,
    sources: [{ id: "council_postcode_demographics", label: `Postcode ${reference.postcode} Census profile`, href: "/council?workspace=map",
      description: "ABS 2021 Census whole Postal Area figures and state benchmark, including their units and source date." }],
    limitations: [
      "Census date is 10 August 2021. These are historical whole Postal Area figures, not current population estimates or just the Council portion; Postal Areas can cross Council and state boundaries.",
      "Aggregate demographics do not describe a particular resident or prove eligibility, individual preferences or why upgrades occurred. Present outreach ideas as planning hypotheses, not causal conclusions.",
      "Null or missing figures are unavailable, not zero. Census privacy adjustments can make totals differ. Housing percentages use occupied private dwellings excluding visitor-only and other non-classifiable households.",
      "This selected snapshot contains Census figures only, not private resident records, current energy-upgrade counts or campaign results. Use the map's separately dated upgrade data for comparison; repeat activities and different time periods prevent calling upgrades per dwelling household adoption.",
    ] };
}
