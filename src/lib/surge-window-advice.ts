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

export const SURGE_CHEAP_WINDOW_HEAT_LOSS_EXPLAINER = [
  "Start by checking for moving air around opening windows. Where you find a gap, fit removable draught or weather seals, because stopping draughts gives the cheapest immediate comfort gain.",
  "For single glazing, clear heat-shrink window-insulation film traps a still-air layer, acting like temporary secondary glazing while keeping the view. Bubble wrap uses the same idea and makes sense on a laundry, bathroom or rarely used window where losing a clear view and some daylight is acceptable.",
  "At night, use close-fitting honeycomb blinds or lined curtains that overlap the frame. Add a pelmet over the top gap: it slows air circulation past the cold glass instead of letting warm room air fall behind the curtain. Keep opening windows and required ventilation usable.",
].join(" ");
