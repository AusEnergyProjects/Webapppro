// Recommended trades for an assessment finding, not worker assignments or credentials.
export const RENTAL_REFERRAL_TRADES = Object.freeze([
  "Assessor follow-up", "Builder", "Carpenter", "Electrician", "Gasfitter", "Glazier",
  "Heating and cooling technician", "Insulation installer", "Locksmith",
  "Mould or moisture specialist", "Painter", "Plumber", "Roof plumber",
  "Smoke alarm technician", "Structural engineer", "Window furnishings installer",
]);

const tradeByCheck = {
  bathroom_water: "Plumber", showerhead_rating: "Plumber", kitchen_sink_water: "Plumber",
  laundry_connections: "Plumber", toilet_function: "Plumber", hot_water_2027_readiness: "Plumber", shower_2027_readiness: "Plumber",
  outlet_lighting_protection: "Electrician", switchboard_observation: "Electrician", artificial_lighting: "Electrician",
  main_living_heater: "Heating and cooling technician", heater_operation: "Heating and cooling technician", heater_efficiency: "Heating and cooling technician",
  heating_2027_readiness: "Heating and cooling technician", cooling_2027_readiness: "Heating and cooling technician",
  ceiling_2027_readiness: "Insulation installer", external_door_lock: "Locksmith", mould_damp_observation: "Mould or moisture specialist",
  window_operation_security: "Glazier", window_covering: "Window furnishings installer", cord_anchor: "Window furnishings installer",
  doors_2027_readiness: "Carpenter", windows_2027_readiness: "Carpenter", vents_2027_readiness: "Gasfitter",
};
export function rentalSuggestedTrade(checkKey) {
  return Object.hasOwn(tradeByCheck, checkKey) ? tradeByCheck[checkKey] : "";
}
