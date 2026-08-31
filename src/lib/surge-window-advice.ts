const SURGE_SPECIFIC_WINDOW_TREATMENT = /\b(?:bubble wrap|window[- ]insulation film|heat[- ]?shrink film|draught seals?|draft seals?|weather seals?|curtains?|blinds?|pelmets?|secondary glazing|double glazing)\b/i;

export function isSurgeBroadCheapWindowHeatLossOptionsRequest(message: string) {
  const namesSpecificTreatment = SURGE_SPECIFIC_WINDOW_TREATMENT.test(message);
  const asksForSeveralOptions = /\b(?:ways|options|tips|ideas|suggestions)\b/i.test(message)
    || (!namesSpecificTreatment
      && /\b(?:what|how)\b[^?]{0,45}\b(?:can|could|should)\s+(?:I|we)\b/i.test(message));
  return asksForSeveralOptions
    && /\b(?:cheap|low[- ]cost|budget|inexpensive|affordable)\b/i.test(message)
    && /\b(?:windows?|glazing|glass)\b/i.test(message)
    && /\b(?:heat loss|keep(?:ing)? (?:the )?(?:heat|home|house|room) (?:in|warm)|warmer|cold)\b/i.test(message);
}

export function isSurgePelmetWhyAndFirstStepFollowUp(message: string) {
  const asksWhyPelmetMatters = (
    /\bwhy\b[^?\n]{0,80}\bpelmets?\b|\bpelmets?\b[^?\n]{0,80}\b(?:why|matter|help|work)\b/i
  ).test(message);
  const asksWhatToTryFirst = (
    /\b(?:which|what)\b[^?\n]{0,90}\b(?:try|do|start|use)\b[^?\n]{0,35}\bfirst\b|\b(?:try|do|start|use)\b[^?\n]{0,35}\bfirst\b/i
  ).test(message);
  return asksWhyPelmetMatters && asksWhatToTryFirst;
}

export const SURGE_CHEAP_WINDOW_HEAT_LOSS_EXPLAINER = [
  "Start by checking for moving air around opening windows. Where you find a gap, fit removable draught or weather seals, because stopping draughts gives the cheapest immediate comfort gain.",
  "For single glazing, clear heat-shrink window-insulation film traps a still-air layer, acting like temporary secondary glazing while keeping the view. Bubble wrap uses the same idea and makes sense on a laundry, bathroom or rarely used window where losing a clear view and some daylight is acceptable.",
  "At night, use close-fitting honeycomb blinds or lined curtains that overlap the frame. Add a pelmet over the top gap: it slows air circulation past the cold glass instead of letting warm room air fall behind the curtain. Keep opening windows and required ventilation usable.",
].join(" ");

export const SURGE_PELMET_WHY_AND_FIRST_STEP_EXPLAINER = [
  "A pelmet closes the gap above a curtain, slowing the convection loop that otherwise lets warm room air pass behind the curtain, cool against the cold glass and fall back into the room.",
  "First check the opening sash and frame for moving air and fit removable weather seals only where there is a real leak.",
  "If there is no draught, trial a close-fitting honeycomb blind or lined curtain with a pelmet on the coldest problem window. Keep the window and required ventilation usable, and let condensation dry.",
].join(" ");
