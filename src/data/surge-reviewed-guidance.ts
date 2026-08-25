export type ReviewedSurgeGuidance = {
  id: string;
  title: string;
  detail: string;
  sourceIds: readonly string[];
  jurisdictions: readonly string[];
  safetyNotes: readonly string[];
  reviewedOn: string;
  reviewDue: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

const reviewed = (
  id: string,
  title: string,
  detail: string,
  sourceIds: readonly string[],
  safetyNotes: readonly string[] = [],
  reviewDue = "2027-02-20",
): ReviewedSurgeGuidance => Object.freeze({
  id,
  title,
  detail,
  reviewedOn: "2026-08-20",
  reviewDue,
  effectiveFrom: "2026-08-20",
  effectiveTo: null,
  sourceIds: Object.freeze([...sourceIds]),
  jurisdictions: Object.freeze(["Australia"]),
  safetyNotes: Object.freeze([...safetyNotes]),
});

/**
 * Reviewed, provider-neutral practical guidance. Rules select these records by
 * ID, so missing or expired records disappear instead of falling back to
 * unreviewed copy. Source IDs resolve to the official knowledge registry.
 */
export const SURGE_REVIEWED_GUIDANCE = Object.freeze([
  reviewed("missing-context", "Finish the missing context", "Resume at the next unanswered section to complete the home picture.", ["energy-gov-reduce-energy-bills"], [], "2026-11-20"),
  reviewed("ceiling-moisture-first", "Check the ceiling first", "Find the moisture source, then check insulation coverage, gaps and safe clearances before topping it up.", ["yourhome-insulation", "yourhome-condensation-moisture"], ["Do not disturb suspected asbestos. Use a qualified person for unsafe access or uncertain electrical clearances."]),
  reviewed("ceiling-topup-first", "Check the ceiling first", "Check insulation coverage, gaps and safe clearances, then top it up before buying larger heating or cooling equipment.", ["yourhome-insulation", "energy-gov-insulation-draught-proofing"], ["Do not disturb suspected asbestos. Maintain required electrical and heat-source clearances."]),
  reviewed("moisture-before-sealing", "Control moisture before sealing", "Use exhaust fans, brief airing or a dehumidifier when needed. Find leaks before sealing draughts and keep required ventilation working.", ["yourhome-condensation-moisture", "yourhome-ventilation-airtightness"], ["Do not seal required vents, combustion openings, chimneys or flues. Investigate persistent damp, mould or leaks."]),
  reviewed("easy-draughts", "Stop the easy draughts first", "Try a door snake and removable seals first. Seal only confirmed fixed gaps, never required vents, exhausts, chimneys or flues.", ["energy-gov-insulation-draught-proofing", "yourhome-ventilation-airtightness"], ["Keep required ventilation and combustion-air paths open."]),
  reviewed("avoid-portable-heaters", "Avoid portable heaters for whole rooms", "An efficient reverse-cycle air conditioner usually uses less electricity than resistance heating. An electric throw can warm a person with less energy.", ["energy-gov-heating-cooling", "energy-rating-heating-cooling"], ["Follow instructions and keep portable heaters and electric bedding clear of combustible materials."], "2026-11-20"),
  reviewed("rcac-before-gas", "Use reverse-cycle heating first", "When it can comfortably heat the occupied area, try the reverse-cycle air conditioner before gas heating and keep its filters clean.", ["energy-gov-heating-cooling", "energy-rating-heating-cooling"], ["Maintain heating equipment and never block required combustion ventilation."], "2026-11-20"),
  reviewed("evaporative-outlets", "Check unused evaporative outlets", "When the system is shut down for the season, removable outlet covers can reduce heat loss. Never block an operating or required ventilation path.", ["yourhome-ventilation-airtightness", "energy-gov-heating-cooling"], ["Remove covers before use and follow the manufacturer's shutdown instructions."], "2026-11-20"),
  reviewed("windows-basic-measures", "Improve windows without replacing them", "Start with seals, close-fitting honeycomb or thermal coverings and external summer shade. Removable low-emissivity or reflective film may help where it suits the glass and sunlight.", ["yourhome-glazing", "yourhome-shading"], ["Confirm film compatibility with the glass and any glazing warranty before installation."]),
  reviewed("windows-seals-film", "Improve windows without replacing them", "Check seals and room-by-room comfort first. Removable low-emissivity or reflective film may help where it suits the glass and sunlight.", ["yourhome-glazing", "yourhome-shading"], ["Confirm film compatibility with the glass and any glazing warranty before installation."]),
  reviewed("shade-hot-windows", "Shade hot windows before upgrading cooling", "Use external shade where practical. A well-placed deciduous tree can block summer sun and allow winter sun.", ["yourhome-shading", "yourhome-landscaping-garden-design"], ["Check services, fire risk, mature size, roots and local rules before planting."]),
  reviewed("solar-load-shift", "Use more of your solar directly", "Run flexible loads such as dishwashers, washers or heat-pump dryers during strong solar hours when safe.", ["energy-gov-solar-batteries", "energy-gov-reduce-energy-bills", "yourhome-appliances-technology"], ["Do not run appliances unattended where their instructions or conditions make that unsafe."], "2026-09-20"),
  reviewed("tariff-load-shift", "Shift flexible loads to cheaper hours", "Check the complete tariff before moving flexible loads to cheaper or free-use windows. Make sure the rest of the plan suits the home.", ["energy-gov-reduce-energy-bills"], [], "2026-11-20"),
  reviewed("mains-gas-sequence", "Sequence mains gas replacement carefully", "Reduce demand first, then confirm electrical capacity before replacing major mains gas appliances.", ["energy-gov-electrification-sequence"], ["Gas disconnection and fixed electrical work require appropriately licensed trades."], "2026-10-20"),
  reviewed("lpg-sequence", "Plan around bottled gas use", "Identify which appliances use LPG, then compare staged electric replacements after checking switchboard capacity.", ["energy-gov-electrification-sequence"], ["Gas and fixed electrical work require appropriately licensed trades."], "2026-10-20"),
  reviewed("planned-work", "Coordinate upgrades with building work", "Use planned works to improve access, insulation continuity and electrical capacity before closing finishes.", ["yourhome-renovations-additions"], ["Confirm permits, structure and regulated trade scopes before work."]),
  reviewed("context-ready", "Your context is ready", "Ask Surge AI what to prioritise from your details.", ["energy-gov-reduce-energy-bills"], [], "2026-11-20"),
] as const satisfies readonly ReviewedSurgeGuidance[]);
