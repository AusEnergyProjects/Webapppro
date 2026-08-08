import {
  GOVERNMENT_ACTIVITY_CALCULATION_METHODS,
} from "./australian-certificate-calculation-catalogue.ts";
import {
  GOVERNMENT_ACTIVITY_TEMPLATES,
  GOVERNMENT_PROGRAM_TEMPLATES,
} from "./australian-government-program-catalogue.ts";
import {
  creditexCanonicalSha256,
} from "./creditex-interchange-preflight.ts";

export const CREDITEX_CALCULATION_COVERAGE_CONTRACT =
  "creditex-calculation-coverage/v1";
export const CREDITEX_CALCULATION_COVERAGE_REVIEWED_ON = "2026-08-08";

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

const methodByActivity = new Map(
  GOVERNMENT_ACTIVITY_CALCULATION_METHODS.map((method) => [
    method.activityTemplateId,
    method,
  ]),
);

if (
  methodByActivity.size !== GOVERNMENT_ACTIVITY_TEMPLATES.length
  || GOVERNMENT_ACTIVITY_CALCULATION_METHODS.length
    !== GOVERNMENT_ACTIVITY_TEMPLATES.length
) {
  throw new Error(
    "Calculation coverage requires exactly one method per activity template.",
  );
}

export const CREDITEX_CALCULATION_COVERAGE = Object.freeze(
  GOVERNMENT_ACTIVITY_TEMPLATES
    .map((activity) => {
      const method = methodByActivity.get(activity.templateId);
      if (!method || method.programCode !== activity.programCode) {
        throw new Error(
          `Calculation coverage is missing ${activity.templateId}.`,
        );
      }
      const estimateExecutable =
        method.state === "estimate_available"
        && method.pathway === "deterministic_local_estimate";
      return Object.freeze({
        activityTemplateId: activity.templateId,
        programCode: activity.programCode,
        registryActivityCode: activity.registryActivityCode,
        catalogueState: activity.catalogueState,
        outcomeClass: method.outcomeClass,
        calculationState: method.state,
        calculationPathway: method.pathway,
        formulaKey: method.formulaKey,
        unit: method.unit,
        estimateExecutable,
        officialReconciliationRequired:
          method.officialReconciliationRequired,
        certificateActionEnabled: false as const,
        officialSourceUrl: method.officialSourceUrl,
        sourceVersion: method.sourceVersion,
        sourceEffectiveFrom: method.sourceEffectiveFrom,
        sourceEffectiveTo: method.sourceEffectiveTo,
      });
    })
    .sort((left, right) =>
      compareText(left.activityTemplateId, right.activityTemplateId)),
);

const stateCounts = Object.freeze(
  Object.entries(
    Object.groupBy(
      CREDITEX_CALCULATION_COVERAGE,
      (row) => row.calculationState,
    ),
  )
    .map(([state, rows]) => Object.freeze({
      state,
      count: rows?.length || 0,
    }))
    .sort((left, right) => compareText(left.state, right.state)),
);

const coverageCore = Object.freeze({
  contract: CREDITEX_CALCULATION_COVERAGE_CONTRACT,
  programs: GOVERNMENT_PROGRAM_TEMPLATES.length,
  activities: CREDITEX_CALCULATION_COVERAGE.length,
  estimateExecutable: CREDITEX_CALCULATION_COVERAGE.filter(
    (row) => row.estimateExecutable,
  ).length,
  certificateActionsEnabled: CREDITEX_CALCULATION_COVERAGE.filter(
    (row) => row.certificateActionEnabled,
  ).length,
  stateCounts,
  rows: CREDITEX_CALCULATION_COVERAGE,
});

export const CREDITEX_CALCULATION_COVERAGE_SUMMARY = Object.freeze({
  ...coverageCore,
  blockedOrNonExecutable:
    coverageCore.activities - coverageCore.estimateExecutable,
  coverageSha256: creditexCanonicalSha256(coverageCore),
});
