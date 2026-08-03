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

function required(value: unknown) {
  return String(value || "").trim();
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
        "Creditex intake starts with the job. TLink must resolve the exact published government rule and evidence policy before a regulated case opens.",
    },
  };
  return { program, activity, snapshot };
}

export function stableTradeComplianceIntentJson(
  snapshot: TradeComplianceIntentSnapshot,
) {
  return JSON.stringify(snapshot);
}
