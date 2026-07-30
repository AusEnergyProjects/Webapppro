import {
  defaultPhotoRequirements,
  PHOTO_REQUEST_SERVICE_CATEGORIES,
  type PhotoRequirement,
} from "./trade-photo-requests.ts";

export const CUSTOMER_PROJECT_PHOTO_GUIDE_VERSION =
  "2026-07-30-guided-customer-capture-v1";
export const CUSTOMER_PROJECT_PHOTO_GUIDE_LIMIT = 12;

export type CustomerProjectPhotoGuideItem = PhotoRequirement & {
  id: string;
  serviceCategory: string;
  serviceLabel: string;
  evidenceCategory: "property-photo" | "existing-equipment" | "switchboard";
  factKeys: string[];
};

const serviceLabels: Record<string, string> = {
  assessment: "Whole-home assessment",
  solar: "Rooftop solar",
  battery: "Home battery",
  "heating-cooling": "Heating and cooling",
  "hot-water": "Hot water",
  "draught-proofing": "Draught-proofing",
  insulation: "Insulation",
  glazing: "Glazing",
  "window-coverings": "Blinds, shutters and shading",
  "ev-charging": "EV charging",
  other: "General home context",
};

function evidenceLink(
  serviceCategory: string,
  requirementId: string,
): Pick<CustomerProjectPhotoGuideItem, "evidenceCategory" | "factKeys"> {
  if (
    requirementId === "switchboard"
    || requirementId === "meter-box"
    || requirementId === "meter-or-supply"
  ) {
    return { evidenceCategory: "switchboard", factKeys: ["switchboard"] };
  }
  if (serviceCategory === "hot-water") {
    return { evidenceCategory: "existing-equipment", factKeys: ["hot-water"] };
  }
  if (serviceCategory === "heating-cooling") {
    return {
      evidenceCategory: "existing-equipment",
      factKeys: ["heating-cooling"],
    };
  }
  if (serviceCategory === "battery") {
    return { evidenceCategory: "existing-equipment", factKeys: ["battery"] };
  }
  if (serviceCategory === "solar") {
    return requirementId === "existing-solar"
      ? { evidenceCategory: "existing-equipment", factKeys: ["solar"] }
      : { evidenceCategory: "property-photo", factKeys: ["roof"] };
  }
  if (serviceCategory === "ev-charging") {
    return { evidenceCategory: "property-photo", factKeys: ["ev"] };
  }
  if (serviceCategory === "insulation") {
    return {
      evidenceCategory: "property-photo",
      factKeys: requirementId === "insulation-area-context"
        ? []
        : ["ceiling-insulation"],
    };
  }
  if (serviceCategory === "glazing") {
    return { evidenceCategory: "property-photo", factKeys: ["glazing"] };
  }
  if (serviceCategory === "window-coverings") {
    return {
      evidenceCategory: "property-photo",
      factKeys: [
        requirementId === "outside-shading-context"
          ? "external-shading"
          : "window-coverings",
      ],
    };
  }
  if (serviceCategory === "draught-proofing") {
    return {
      evidenceCategory: "property-photo",
      factKeys: [
        requirementId === "fixed-ventilation" ? "ventilation" : "draughts",
      ],
    };
  }
  if (requirementId === "home-exterior") {
    return { evidenceCategory: "property-photo", factKeys: ["roof"] };
  }
  return { evidenceCategory: "property-photo", factKeys: [] };
}

function guideItem(
  serviceCategory: string,
  requirement: PhotoRequirement,
): CustomerProjectPhotoGuideItem {
  const sharedId = requirement.id === "switchboard";
  const safeRequirement = requirement.id === "meter-box"
    ? {
        ...requirement,
        label: "Closed meter box exterior",
        guidance:
          "Keep the enclosure closed. From an ordinary safe standing position, show the whole outside of the meter box without touching equipment. Keep people, bills, account numbers and street numbers out of frame.",
        usefulExample:
          "A clear front-on view of the closed meter box and the wall around it.",
        avoidExample:
          "Opening the enclosure, touching electrical equipment, or including bills and account numbers.",
      }
    : requirement;
  return {
    ...safeRequirement,
    ...evidenceLink(serviceCategory, requirement.id),
    id: sharedId
      ? "shared:switchboard"
      : `${serviceCategory}:${requirement.id}`,
    serviceCategory,
    serviceLabel: serviceLabels[serviceCategory] || serviceLabels.assessment,
  };
}

export function customerProjectPhotoGuide(
  serviceCategories: string[],
): CustomerProjectPhotoGuideItem[] {
  const allowed = new Set<string>(PHOTO_REQUEST_SERVICE_CATEGORIES);
  const selected = [
    ...new Set(
      (serviceCategories || []).filter(
        (category) => allowed.has(category) && category !== "other",
      ),
    ),
  ];
  const categories = selected.length ? selected : ["assessment"];
  const buckets = categories.map((category) => ({
    required: defaultPhotoRequirements(category)
      .filter((item) => item.required)
      .map((item) => guideItem(category, item)),
    optional: defaultPhotoRequirements(category)
      .filter((item) => !item.required)
      .map((item) => guideItem(category, item)),
  }));
  const result: CustomerProjectPhotoGuideItem[] = [];
  const seen = new Set<string>();

  for (const priority of ["required", "optional"] as const) {
    const longest = Math.max(0, ...buckets.map((bucket) => bucket[priority].length));
    for (let index = 0; index < longest; index += 1) {
      for (const bucket of buckets) {
        const item = bucket[priority][index];
        if (!item || seen.has(item.id)) continue;
        seen.add(item.id);
        result.push(item);
        if (result.length === CUSTOMER_PROJECT_PHOTO_GUIDE_LIMIT) return result;
      }
    }
  }
  return result;
}
