import assert from "node:assert/strict";
import test from "node:test";
import {
  CERTIFICATE_CALCULATION_CATALOGUE_REVIEWED_ON,
  CERTIFICATE_CALCULATION_PATHWAYS,
  CERTIFICATE_CALCULATION_STATES,
  GOVERNMENT_ACTIVITY_CALCULATION_METHODS,
  GOVERNMENT_CALCULATION_SOURCE_WINDOWS,
  GOVERNMENT_PROGRAM_SUBMISSION_ROUTES,
  GOVERNMENT_SUBMISSION_ROUTE_STATES,
  governmentActivityCalculationMethods,
} from "../src/lib/australian-certificate-calculation-catalogue.ts";
import {
  GOVERNMENT_ACTIVITY_TEMPLATES,
  GOVERNMENT_PROGRAM_TEMPLATES,
} from "../src/lib/australian-government-program-catalogue.ts";

test("every controlled government activity has exactly one fail-closed calculation method", () => {
  assert.equal(CERTIFICATE_CALCULATION_CATALOGUE_REVIEWED_ON, "2026-08-02");
  assert.equal(
    GOVERNMENT_ACTIVITY_CALCULATION_METHODS.length,
    GOVERNMENT_ACTIVITY_TEMPLATES.length,
  );
  assert.equal(
    new Set(
      GOVERNMENT_ACTIVITY_CALCULATION_METHODS.map(
        (method) => method.activityTemplateId,
      ),
    ).size,
    GOVERNMENT_ACTIVITY_TEMPLATES.length,
  );
  const activityIds = new Set(
    GOVERNMENT_ACTIVITY_TEMPLATES.map((activity) => activity.templateId),
  );
  const programCodes = new Set(
    GOVERNMENT_PROGRAM_TEMPLATES.map((program) => program.programCode),
  );
  for (const method of GOVERNMENT_ACTIVITY_CALCULATION_METHODS) {
    assert.ok(activityIds.has(method.activityTemplateId));
    assert.ok(programCodes.has(method.programCode));
    assert.ok(CERTIFICATE_CALCULATION_STATES.includes(method.state));
    assert.ok(CERTIFICATE_CALCULATION_PATHWAYS.includes(method.pathway));
    assert.ok(method.catalogueState);
    assert.equal(method.certificateActionEnabled, false);
    assert.match(method.officialSourceUrl, /^https:\/\//);
    assert.ok(method.operatorMessage.trim());
  }
});

test("current SRES, VEU and NSW pathways expose only their verified readiness state", () => {
  const sres = governmentActivityCalculationMethods("SRES");
  assert.equal(sres.length, 6);
  assert.equal(
    sres.filter((method) => method.state === "estimate_available").length,
    2,
  );
  assert.equal(
    sres.filter(
      (method) => method.state === "official_registry_required",
    ).length,
    4,
  );
  assert.ok(sres.every((method) => method.unit === "STC"));
  assert.ok(
    sres.every((method) => method.officialReconciliationRequired === true),
  );

  for (const code of ["VEU", "NSW-ESS", "NSW-PDRS"]) {
    const methods = governmentActivityCalculationMethods(code);
    assert.ok(methods.length > 0);
    const current = methods.filter(
      (method) => method.catalogueState === "current",
    );
    assert.ok(current.length > 0);
    assert.ok(
      current.every(
        (method) => [
          "estimate_available",
          "official_registry_required",
          "governed_formula_required",
        ].includes(method.state),
      ),
    );
    assert.ok(current.some((method) => method.state === "estimate_available"));
    assert.ok(methods.every((method) => method.certificateActionEnabled === false));
  }
});

test("closed and future activities are visibly unavailable rather than formula-pending", () => {
  const unavailable = GOVERNMENT_ACTIVITY_CALCULATION_METHODS.filter(
    (method) => ["closed", "future"].includes(method.catalogueState),
  );
  assert.ok(unavailable.length > 0);
  for (const method of unavailable) {
    assert.equal(method.pathway, "unavailable_activity");
    assert.equal(
      method.state,
      method.catalogueState === "closed"
        ? "activity_closed"
        : "activity_not_commenced",
    );
    assert.equal(method.officialReconciliationRequired, false);
    assert.equal(method.certificateActionEnabled, false);
  }
});

test("non-certificate programs expose AUD estimates or an explicit administrative pathway", () => {
  const nonCertificateOutcomes = new Set([
    "rebate",
    "grant",
    "loan",
    "tariff_only",
    "procurement_only",
  ]);
  const outcomeByProgram = new Map(
    GOVERNMENT_PROGRAM_TEMPLATES.map((program) => [
      program.programCode,
      program.outcomeClass,
    ]),
  );
  const nonCertificateMethods = GOVERNMENT_ACTIVITY_CALCULATION_METHODS.filter(
    (method) => nonCertificateOutcomes.has(
      outcomeByProgram.get(method.programCode),
    ),
  );
  assert.ok(nonCertificateMethods.length > 0);
  assert.ok(
    nonCertificateMethods.every(
      (method) =>
        (
          method.state === "not_applicable"
          && method.unit === "none"
          && method.formulaKey === "no-certificate-calculation"
        )
        || (
          ["estimate_available", "official_registry_required"].includes(
            method.state,
          )
          && method.unit === "AUD"
          && method.formulaKey !== "no-certificate-calculation"
          && method.officialReconciliationRequired === true
        ),
    ),
  );
  assert.ok(
    nonCertificateMethods.every(
      (method) => !method.operatorMessage.includes("zero"),
    ),
  );
});

test("current VEU and NSW calculation windows retain the date-sensitive official boundaries", () => {
  const window = (sourceKey) =>
    GOVERNMENT_CALCULATION_SOURCE_WINDOWS.find(
      (candidate) => candidate.sourceKey === sourceKey,
    );
  assert.deepEqual(
    {
      from: window("veu-specifications-v24")?.effectiveFrom,
      to: window("veu-specifications-v24")?.effectiveTo,
    },
    { from: "2026-06-30", to: "2026-07-20" },
  );
  assert.equal(
    window("veu-specifications-v25")?.effectiveFrom,
    "2026-07-21",
  );
  assert.match(
    window("veu-specifications-v25")?.scope || "",
    /30 September 2026/,
  );
  assert.equal(
    window("nsw-ess-rule-2026-07-01")?.effectiveFrom,
    "2026-07-01",
  );
  assert.equal(
    window("nsw-pdrs-rule-2026-07-01")?.effectiveFrom,
    "2026-07-01",
  );
  assert.ok(
    GOVERNMENT_CALCULATION_SOURCE_WINDOWS.every(
      (source) =>
        source.independentApprovalRequired
        && source.officialSourceUrl.startsWith("https://"),
    ),
  );
});

test("every program has one explicit fail-closed submission or administrative route", () => {
  assert.equal(
    GOVERNMENT_PROGRAM_SUBMISSION_ROUTES.length,
    GOVERNMENT_PROGRAM_TEMPLATES.length,
  );
  assert.equal(
    new Set(
      GOVERNMENT_PROGRAM_SUBMISSION_ROUTES.map((route) => route.programCode),
    ).size,
    GOVERNMENT_PROGRAM_TEMPLATES.length,
  );
  for (const route of GOVERNMENT_PROGRAM_SUBMISSION_ROUTES) {
    assert.ok(GOVERNMENT_SUBMISSION_ROUTE_STATES.includes(route.routeState));
    assert.equal(route.externalSubmissionEnabled, false);
    assert.ok(route.channel.trim());
    assert.ok(route.adapterBoundary.trim());
    assert.ok(route.operatorMessage.trim());
  }
  assert.match(
    GOVERNMENT_PROGRAM_SUBMISSION_ROUTES.find(
      (route) => route.programCode === "VEU",
    )?.channel || "",
    /ESC VEU Registry/,
  );
  assert.match(
    GOVERNMENT_PROGRAM_SUBMISSION_ROUTES.find(
      (route) => route.programCode === "NSW-ESS",
    )?.channel || "",
    /TESSA CSV version 1\.7/,
  );
});
