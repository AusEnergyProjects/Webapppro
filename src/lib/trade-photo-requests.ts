export const PHOTO_REQUEST_CHECKLIST_VERSION = "2026-07-18-customer-photo-self-review";
export const PHOTO_REQUEST_MAX_REQUIREMENTS = 12;
export const PHOTO_REQUEST_LINK_DAYS = 30;

export type PhotoRequirement = {
  id: string;
  label: string;
  guidance: string;
  usefulExample: string;
  avoidExample: string;
  required: boolean;
};

const sharedPrivacyGuidance = "Use good light and keep people, documents, street numbers and unrelated belongings out of frame.";

const defaults: Record<string, PhotoRequirement[]> = {
  solar: [
    { id: "roof-overview", label: "Roof overview", guidance: `Stand back far enough to show the roof shape, orientation and nearby shade. ${sharedPrivacyGuidance}`, usefulExample: "A clear landscape photo showing the full roof and nearby trees.", avoidExample: "Close-ups that hide the roof layout or include a visible street number.", required: true },
    { id: "meter-box", label: "Meter box", guidance: `Photograph the whole open meter enclosure only when it is safe to do so. ${sharedPrivacyGuidance}`, usefulExample: "The full meter box with labels readable from a safe distance.", avoidExample: "Personal bills, account numbers or unsafe access near live equipment.", required: true },
    { id: "switchboard", label: "Switchboard", guidance: `Show the whole switchboard and available space without removing covers. ${sharedPrivacyGuidance}`, usefulExample: "A straight, well-lit photo of the closed switchboard and circuit labels.", avoidExample: "Removed covers, exposed wiring or a blurred close-up.", required: true },
  ],
  battery: [
    { id: "battery-location", label: "Proposed battery location", guidance: `Show the wall, floor, clearances and nearby doors or windows. ${sharedPrivacyGuidance}`, usefulExample: "A wide photo showing the proposed wall and surrounding access.", avoidExample: "A tight wall photo that hides exits, windows or obstructions.", required: true },
    { id: "switchboard", label: "Switchboard", guidance: `Show the whole closed switchboard and available space. ${sharedPrivacyGuidance}`, usefulExample: "A clear front-on view with circuit labels visible.", avoidExample: "Open covers, exposed wiring or personal documents.", required: true },
    { id: "existing-solar", label: "Existing solar equipment", guidance: `Include the inverter and any readable model label. ${sharedPrivacyGuidance}`, usefulExample: "One context photo and one clear equipment-label photo.", avoidExample: "A label-only photo with no indication where the equipment is installed.", required: false },
  ],
  "heating-cooling": [
    { id: "existing-unit", label: "Existing unit", guidance: `Show the whole indoor or outdoor unit and how it is installed. ${sharedPrivacyGuidance}`, usefulExample: "A clear context photo showing the unit and surrounding clearance.", avoidExample: "A close-up that hides access, airflow or mounting conditions.", required: true },
    { id: "model-label", label: "Equipment model label", guidance: `Take a straight, well-lit photo of the model and serial label. ${sharedPrivacyGuidance}`, usefulExample: "The complete label is in focus and readable.", avoidExample: "A cropped, reflective or blurred label.", required: true },
    { id: "rooms-or-zone", label: "Room or zone overview", guidance: `Show the room size, outlet position or proposed installation area. ${sharedPrivacyGuidance}`, usefulExample: "A wide room view showing the relevant wall, ceiling or outlets.", avoidExample: "People, family photos or unrelated private belongings.", required: false },
  ],
  "hot-water": [
    { id: "existing-system", label: "Existing hot water system", guidance: `Show the whole unit, pipework and surrounding access. ${sharedPrivacyGuidance}`, usefulExample: "A clear wide photo of the tank or unit and connections.", avoidExample: "A close-up that hides access or drainage conditions.", required: true },
    { id: "model-label", label: "System model label", guidance: `Take a straight, readable photo of the rating or model label. ${sharedPrivacyGuidance}`, usefulExample: "The complete model and electrical details are in focus.", avoidExample: "A blurred label or an unrelated energy bill.", required: true },
    { id: "replacement-location", label: "Replacement location", guidance: `Show available space, ventilation, drainage and access. ${sharedPrivacyGuidance}`, usefulExample: "A wide photo showing the proposed area and surrounding clearances.", avoidExample: "A tight photo that hides doors, windows or access paths.", required: false },
  ],
  "insulation-draughts": [
    { id: "roof-or-ceiling-access", label: "Roof or ceiling access", guidance: `Photograph the access opening from a safe standing position. Do not enter a roof space. ${sharedPrivacyGuidance}`, usefulExample: "A well-lit context photo showing the access size and location.", avoidExample: "Entering an unsafe roof space or showing personal storage items.", required: true },
    { id: "existing-insulation", label: "Existing insulation visible from access", guidance: `Only if safely visible, show the material and approximate coverage without disturbing it. ${sharedPrivacyGuidance}`, usefulExample: "A clear view from the access opening with material coverage visible.", avoidExample: "Moving insulation, touching wiring or entering the roof space.", required: false },
    { id: "draught-area", label: "Main draught or comfort area", guidance: `Show the door, window or gap in its surrounding wall or floor context. ${sharedPrivacyGuidance}`, usefulExample: "A wide photo plus a closer view of the relevant gap.", avoidExample: "A close-up with no indication where the gap is located.", required: false },
  ],
  "ev-charging": [
    { id: "parking-location", label: "Parking and charger location", guidance: `Show the vehicle parking position, proposed charger wall and cable path. ${sharedPrivacyGuidance}`, usefulExample: "A wide photo showing the bay, wall and likely cable route.", avoidExample: "Vehicle number plates, street numbers or a wall-only close-up.", required: true },
    { id: "switchboard", label: "Switchboard", guidance: `Show the whole closed switchboard and available space. ${sharedPrivacyGuidance}`, usefulExample: "A straight, well-lit photo with circuit labels readable.", avoidExample: "Removed covers, exposed wiring or unsafe access.", required: true },
    { id: "meter-or-supply", label: "Meter or supply equipment", guidance: `Show the complete enclosure from a safe position. ${sharedPrivacyGuidance}`, usefulExample: "The enclosure and relevant labels are visible without personal bills.", avoidExample: "Account paperwork or unsafe access near live equipment.", required: false },
  ],
  assessment: [
    { id: "home-exterior", label: "Home exterior overview", guidance: `Show the building form, roof and major shade without including a street number. ${sharedPrivacyGuidance}`, usefulExample: "A wide view showing the home form and surrounding shade.", avoidExample: "People, number plates or an identifiable street number.", required: true },
    { id: "main-living-area", label: "Main living area", guidance: `Show the room size, windows and fixed heating or cooling equipment. ${sharedPrivacyGuidance}`, usefulExample: "A wide, well-lit view of the relevant room and fixed equipment.", avoidExample: "People, documents, family photos or unrelated belongings.", required: false },
    { id: "switchboard", label: "Switchboard", guidance: `Show the whole closed switchboard and circuit labels. ${sharedPrivacyGuidance}`, usefulExample: "A straight, readable view without removing any cover.", avoidExample: "Exposed wiring or personal account documents.", required: false },
  ],
};

defaults.other = defaults.assessment;

export function defaultPhotoRequirements(serviceCategory: string): PhotoRequirement[] {
  return (defaults[serviceCategory] || defaults.assessment).map((item) => ({ ...item }));
}

function clean(value: unknown, maximum: number) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, maximum);
}

export function normalisePhotoRequirements(value: unknown): PhotoRequirement[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > PHOTO_REQUEST_MAX_REQUIREMENTS) {
    throw new Error("INVALID_PHOTO_REQUIREMENTS");
  }
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const id = clean(item.id, 80).toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || `photo-${index + 1}`;
    const label = clean(item.label, 120);
    const guidance = clean(item.guidance, 500);
    const usefulExample = clean(item.usefulExample, 300);
    const avoidExample = clean(item.avoidExample, 300);
    if (!label || !guidance || !usefulExample || !avoidExample || seen.has(id)) throw new Error("INVALID_PHOTO_REQUIREMENTS");
    seen.add(id);
    return { id, label, guidance, usefulExample, avoidExample, required: item.required === true };
  });
}

export function newPhotoRequestSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function hashPhotoRequestSecret(secret: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
  return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function parsePhotoRequestToken(token: string) {
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{40,})$/.exec(token);
  return match ? { requestId: match[1], secret: match[2] } : null;
}

export function photoRequestExpiry(from = new Date()) {
  return new Date(from.getTime() + PHOTO_REQUEST_LINK_DAYS * 24 * 60 * 60 * 1000).toISOString();
}
