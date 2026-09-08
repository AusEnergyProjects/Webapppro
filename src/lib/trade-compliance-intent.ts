import {
  GOVERNMENT_ACTIVITY_TEMPLATES,
  GOVERNMENT_CATALOGUE_REVIEWED_ON,
  GOVERNMENT_PROGRAM_TEMPLATES,
  type GovernmentActivityTemplate,
  type GovernmentProgramTemplate,
} from "./australian-government-program-catalogue";

export const TRADE_COMPLIANCE_INTENT_CONTRACT =
  "tlink-creditex-job-intent-v1";
export const CREDITEX_PARTNER_ORGANISATION_CODE = "CREDITEX-AU";
export const MAX_TRADE_COMPLIANCE_ACTIVITIES = 12;
const MAX_ACTIVITY_SELECTION_BYTES = 20_000;
const MAX_ACTIVITY_SELECTION_ID_LENGTH = 180;

export type TradeComplianceIntentMode = "none" | "planned";

export type TradeComplianceIntentSnapshot = {
  contract: typeof TRADE_COMPLIANCE_INTENT_CONTRACT;
  catalogueReviewedOn: string;
  plannedStart: string;
  siteJurisdiction: string;
  program: {
    templateId: string;
    programCode: string;
    name: string;
    jurisdiction: string;
    outcomeClass: string;
    claimOutputCode: string;
    claimOutputLabel: string;
    administeringBody: string;
    officialSourceUrl: string;
    officialSourceTitle: string;
    catalogueState: string;
    operatingNote: string;
  };
  activity: {
    templateId: string;
    variantId?: string;
    activityKey: string;
    registryActivityCode: string;
    title: string;
    serviceCategory: string;
    specificationPart: string;
    productCategory: string;
    scenarioCode: string;
    scenario: string;
    catalogueState: string;
  };
  governance: {
    state: "setup_required";
    message: string;
  };
};

export type ResolvedTradeComplianceIntent = {
  program: GovernmentProgramTemplate;
  activity: GovernmentActivityTemplate;
  snapshot: TradeComplianceIntentSnapshot;
};

export type TradeComplianceActivitySelection = {
  programTemplateId: string;
  activityTemplateId: string;
  variantId?: string;
};

export class TradeComplianceIntentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const SITE_JURISDICTIONS = new Set([
  "ACT",
  "NSW",
  "NT",
  "QLD",
  "SA",
  "TAS",
  "VIC",
  "WA",
]);

const PREMISES_VARIANT_ACTIVITY_TEMPLATE_IDS = new Set([
  "veu-1",
  "veu-3",
  "veu-6",
]);
const RESIDENTIAL_BUILDING_TYPES = new Set([
  "house_townhouse",
  "apartment_unit",
]);
const BUSINESS_BUILDING_TYPES = new Set([
  "commercial_office",
  "retail_hospitality",
  "industrial_warehouse",
  "institutional_community_health",
]);

function required(value: unknown) {
  return String(value || "").trim();
}

export function activityRequiresPremisesVariant(activityTemplateId: unknown) {
  return PREMISES_VARIANT_ACTIVITY_TEMPLATE_IDS.has(required(activityTemplateId));
}

export function activityPremisesVariantId(
  activityTemplateId: unknown,
  buildingType: unknown,
) {
  const templateId = required(activityTemplateId);
  if (!activityRequiresPremisesVariant(templateId)) return "";
  const type = required(buildingType);
  const premises = RESIDENTIAL_BUILDING_TYPES.has(type)
    ? "residential"
    : BUSINESS_BUILDING_TYPES.has(type)
      ? "business"
      : "";
  return premises ? `${templateId.replaceAll("-", "_")}_${premises}` : "";
}

function assertPlanningState(
  item: GovernmentProgramTemplate | GovernmentActivityTemplate,
) {
  if (item.catalogueState === "closed") {
    throw new TradeComplianceIntentError(
      "ACTIVITY_CLOSED",
      "That government program or activity is closed and cannot be selected for new work.",
    );
  }
  if (item.catalogueState === "future") {
    throw new TradeComplianceIntentError(
      "ACTIVITY_NOT_COMMENCED",
      "That government program or activity has not commenced.",
    );
  }
  if (item.catalogueState === "specialist") {
    throw new TradeComplianceIntentError(
      "SPECIALIST_WORKFLOW_REQUIRED",
      "That activity requires a specialist workflow and is not available in the standard installer job setup.",
    );
  }
}

export function resolveTradeComplianceIntent(input: {
  mode: unknown;
  programTemplateId?: unknown;
  activityTemplateId?: unknown;
  variantId?: unknown;
  buildingType?: unknown;
  siteJurisdiction?: unknown;
  plannedStart?: unknown;
}): ResolvedTradeComplianceIntent | null {
  const mode = required(input.mode) || "none";
  if (mode === "none") return null;
  if (mode !== "planned") {
    throw new TradeComplianceIntentError(
      "COMPLIANCE_INTENT_INVALID",
      "Choose whether this job is ordinary work or planned certificate work.",
    );
  }

  const siteJurisdiction = required(input.siteJurisdiction).toUpperCase();
  if (!SITE_JURISDICTIONS.has(siteJurisdiction)) {
    throw new TradeComplianceIntentError(
      "INVALID_SITE_JURISDICTION",
      "Choose a valid Australian service-site state before selecting a program.",
    );
  }

  const programTemplateId = required(input.programTemplateId);
  const activityTemplateId = required(input.activityTemplateId);
  const program = GOVERNMENT_PROGRAM_TEMPLATES.find(
    (item) => item.templateId === programTemplateId,
  );
  const activity = GOVERNMENT_ACTIVITY_TEMPLATES.find(
    (item) => item.templateId === activityTemplateId,
  );
  if (!program) {
    throw new TradeComplianceIntentError(
      "GOVERNMENT_PROGRAM_NOT_FOUND",
      "Choose a government program from the controlled list.",
    );
  }
  if (!activity || activity.programCode !== program.programCode) {
    throw new TradeComplianceIntentError(
      "GOVERNMENT_ACTIVITY_NOT_FOUND",
      "Choose an activity that belongs to the selected government program.",
    );
  }
  assertPlanningState(program);
  assertPlanningState(activity);
  if (
    program.jurisdiction !== "AU"
    && program.jurisdiction !== siteJurisdiction
  ) {
    throw new TradeComplianceIntentError(
      "PROGRAM_JURISDICTION_MISMATCH",
      `${program.programCode} is not available for a ${siteJurisdiction} service site.`,
    );
  }

  const requestedVariantId = required(input.variantId);
  const variantRequired = activityRequiresPremisesVariant(activity.templateId);
  const derivedVariantId = activityPremisesVariantId(
    activity.templateId,
    input.buildingType,
  );
  let variantId = "";
  if (variantRequired) {
    const allowedVariantIds = new Set([
      `${activity.templateId.replaceAll("-", "_")}_residential`,
      `${activity.templateId.replaceAll("-", "_")}_business`,
    ]);
    if (requestedVariantId && !allowedVariantIds.has(requestedVariantId)) {
      throw new TradeComplianceIntentError(
        "ACTIVITY_PREMISES_VARIANT_INVALID",
        "Choose whether this activity is for residential or business premises.",
      );
    }
    if (input.buildingType !== undefined && !derivedVariantId) {
      throw new TradeComplianceIntentError(
        "ACTIVITY_PREMISES_TYPE_REQUIRED",
        "Choose residential or business premises before adding this activity.",
      );
    }
    if (
      requestedVariantId
      && derivedVariantId
      && requestedVariantId !== derivedVariantId
    ) {
      throw new TradeComplianceIntentError(
        "ACTIVITY_PREMISES_VARIANT_INVALID",
        "The activity form does not match the job premises type.",
      );
    }
    variantId = requestedVariantId || derivedVariantId;
  } else if (requestedVariantId) {
    throw new TradeComplianceIntentError(
      "ACTIVITY_PREMISES_VARIANT_INVALID",
      "That activity does not have a residential or business premises form.",
    );
  }

  const plannedStart = required(input.plannedStart);
  const snapshot: TradeComplianceIntentSnapshot = {
    contract: TRADE_COMPLIANCE_INTENT_CONTRACT,
    catalogueReviewedOn: GOVERNMENT_CATALOGUE_REVIEWED_ON,
    plannedStart,
    siteJurisdiction,
    program: {
      templateId: program.templateId,
      programCode: program.programCode,
      name: program.name,
      jurisdiction: program.jurisdiction,
      outcomeClass: program.outcomeClass,
      claimOutputCode: program.claimOutputCode,
      claimOutputLabel: program.claimOutputLabel,
      administeringBody: program.administeringBody,
      officialSourceUrl: program.officialSourceUrl,
      officialSourceTitle: program.officialSourceTitle,
      catalogueState: program.catalogueState,
      operatingNote: program.operatingNote,
    },
    activity: {
      templateId: activity.templateId,
      ...(variantId ? { variantId } : {}),
      activityKey: activity.activityKey,
      registryActivityCode: activity.registryActivityCode,
      title: activity.title,
      serviceCategory: activity.serviceCategory,
      specificationPart: activity.specificationPart,
      productCategory: activity.productCategory,
      scenarioCode: activity.scenarioCode,
      scenario: activity.scenario,
      catalogueState: activity.catalogueState,
    },
    governance: {
      state: "setup_required",
      message:
        "Compliance intake starts with the job. TLink must resolve the exact published government rule and evidence policy before a regulated case opens.",
    },
  };
  return { program, activity, snapshot };
}

function activitySelections(value: unknown): TradeComplianceActivitySelection[] {
  let parsed = value;
  if (typeof parsed === "string") {
    if (parsed.length > MAX_ACTIVITY_SELECTION_BYTES) {
      throw new TradeComplianceIntentError(
        "COMPLIANCE_ACTIVITY_LIMIT",
        `Add no more than ${MAX_TRADE_COMPLIANCE_ACTIVITIES} government activities to one job.`,
      );
    }
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new TradeComplianceIntentError(
        "COMPLIANCE_ACTIVITIES_INVALID",
        "The selected government activities could not be read.",
      );
    }
  }
  if (parsed === undefined || parsed === null || parsed === "") return [];
  if (!Array.isArray(parsed)) {
    throw new TradeComplianceIntentError(
      "COMPLIANCE_ACTIVITIES_INVALID",
      "Government activities must be supplied as a list.",
    );
  }
  if (parsed.length > MAX_TRADE_COMPLIANCE_ACTIVITIES) {
    throw new TradeComplianceIntentError(
      "COMPLIANCE_ACTIVITY_LIMIT",
      `Add no more than ${MAX_TRADE_COMPLIANCE_ACTIVITIES} government activities to one job.`,
    );
  }
  let serialisedSelections = "";
  try {
    serialisedSelections = JSON.stringify(parsed);
  } catch {
    throw new TradeComplianceIntentError(
      "COMPLIANCE_ACTIVITIES_INVALID",
      "The selected government activities could not be read.",
    );
  }
  if (serialisedSelections.length > MAX_ACTIVITY_SELECTION_BYTES) {
    throw new TradeComplianceIntentError(
      "COMPLIANCE_ACTIVITY_LIMIT",
      `Add no more than ${MAX_TRADE_COMPLIANCE_ACTIVITIES} government activities to one job.`,
    );
  }
  return parsed.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new TradeComplianceIntentError(
        "COMPLIANCE_ACTIVITIES_INVALID",
        "Each government activity must identify one controlled program and activity.",
      );
    }
    const selection = item as Record<string, unknown>;
    if (
      Object.keys(selection).some((key) =>
        key !== "programTemplateId"
        && key !== "activityTemplateId"
        && key !== "variantId"
      )
    ) {
      throw new TradeComplianceIntentError(
        "COMPLIANCE_ACTIVITIES_INVALID",
        "Each government activity may only identify one controlled program and activity.",
      );
    }
    const programTemplateId = typeof selection.programTemplateId === "string"
      ? selection.programTemplateId.trim()
      : "";
    const activityTemplateId = typeof selection.activityTemplateId === "string"
      ? selection.activityTemplateId.trim()
      : "";
    const variantId = typeof selection.variantId === "string"
      ? selection.variantId.trim()
      : "";
    if (
      !programTemplateId
      || !activityTemplateId
      || programTemplateId.length > MAX_ACTIVITY_SELECTION_ID_LENGTH
      || activityTemplateId.length > MAX_ACTIVITY_SELECTION_ID_LENGTH
      || variantId.length > MAX_ACTIVITY_SELECTION_ID_LENGTH
    ) {
      throw new TradeComplianceIntentError(
        "COMPLIANCE_ACTIVITIES_INVALID",
        "Each government activity must identify one controlled program and activity.",
      );
    }
    return {
      programTemplateId,
      activityTemplateId,
      ...(variantId ? { variantId } : {}),
    };
  });
}

export function resolveTradeComplianceIntents(input: {
  mode?: unknown;
  activities?: unknown;
  programTemplateId?: unknown;
  activityTemplateId?: unknown;
  variantId?: unknown;
  buildingType?: unknown;
  siteJurisdiction?: unknown;
  plannedStart?: unknown;
}): ResolvedTradeComplianceIntent[] {
  const selections = activitySelections(input.activities);
  if (!selections.length) {
    const legacy = resolveTradeComplianceIntent({
      mode: input.mode,
      programTemplateId: input.programTemplateId,
      activityTemplateId: input.activityTemplateId,
      variantId: input.variantId,
      buildingType: input.buildingType,
      siteJurisdiction: input.siteJurisdiction,
      plannedStart: input.plannedStart,
    });
    return legacy ? [legacy] : [];
  }

  const seen = new Set<string>();
  return selections.map((selection) => {
    const duplicateKey =
      `${selection.programTemplateId}\n${selection.activityTemplateId}`;
    if (seen.has(duplicateKey)) {
      throw new TradeComplianceIntentError(
        "COMPLIANCE_ACTIVITY_DUPLICATE",
        "The same government activity cannot be added to a job more than once.",
      );
    }
    seen.add(duplicateKey);
    const resolved = resolveTradeComplianceIntent({
      mode: "planned",
      ...selection,
      buildingType: input.buildingType,
      siteJurisdiction: input.siteJurisdiction,
      plannedStart: input.plannedStart,
    });
    if (!resolved) {
      throw new TradeComplianceIntentError(
        "COMPLIANCE_ACTIVITIES_INVALID",
        "The selected government activity could not be resolved.",
      );
    }
    return resolved;
  });
}

export function stableTradeComplianceIntentJson(
  snapshot: TradeComplianceIntentSnapshot,
) {
  return JSON.stringify(snapshot);
}
