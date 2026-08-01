import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPLIANCE_OUTCOME_CLASSES,
  GOVERNMENT_ACTIVITY_TEMPLATES,
  GOVERNMENT_CATALOGUE_REVIEWED_ON,
  GOVERNMENT_PROGRAM_TEMPLATES,
  governmentActivityTemplates,
} from "../src/lib/australian-government-program-catalogue.ts";

const JURISDICTIONS = new Set([
  "AU",
  "ACT",
  "NSW",
  "NT",
  "QLD",
  "SA",
  "TAS",
  "VIC",
  "WA",
]);
const CATALOGUE_STATES = new Set([
  "current",
  "limited",
  "future",
  "specialist",
  "closed",
]);

test("government discovery catalogue covers every Australian jurisdiction", () => {
  assert.equal(GOVERNMENT_CATALOGUE_REVIEWED_ON, "2026-08-01");
  assert.ok(GOVERNMENT_PROGRAM_TEMPLATES.length >= 30);
  assert.ok(GOVERNMENT_ACTIVITY_TEMPLATES.length >= 150);
  assert.deepEqual(
    new Set(GOVERNMENT_PROGRAM_TEMPLATES.map((program) => program.jurisdiction)),
    JURISDICTIONS,
  );
});

test("program templates are unique, source-backed and use controlled outcomes", () => {
  assert.equal(
    new Set(
      GOVERNMENT_PROGRAM_TEMPLATES.map((program) => program.templateId),
    ).size,
    GOVERNMENT_PROGRAM_TEMPLATES.length,
  );
  assert.equal(
    new Set(
      GOVERNMENT_PROGRAM_TEMPLATES.map((program) => program.programCode),
    ).size,
    GOVERNMENT_PROGRAM_TEMPLATES.length,
  );
  for (const program of GOVERNMENT_PROGRAM_TEMPLATES) {
    assert.ok(JURISDICTIONS.has(program.jurisdiction));
    assert.ok(COMPLIANCE_OUTCOME_CLASSES.includes(program.outcomeClass));
    assert.ok(CATALOGUE_STATES.has(program.catalogueState));
    assert.match(program.officialSourceUrl, /^https:\/\//);
    assert.ok(program.officialSourceTitle.trim());
    assert.ok(program.operatingNote.trim());
  }
});

test("every activity belongs to a catalogued program and has a unique key", () => {
  const programCodes = new Set(
    GOVERNMENT_PROGRAM_TEMPLATES.map((program) => program.programCode),
  );
  assert.equal(
    new Set(
      GOVERNMENT_ACTIVITY_TEMPLATES.map(
        (activityTemplate) => activityTemplate.templateId,
      ),
    ).size,
    GOVERNMENT_ACTIVITY_TEMPLATES.length,
  );
  for (const activityTemplate of GOVERNMENT_ACTIVITY_TEMPLATES) {
    assert.ok(programCodes.has(activityTemplate.programCode));
    assert.ok(CATALOGUE_STATES.has(activityTemplate.catalogueState));
    assert.ok(activityTemplate.activityKey.trim());
    assert.ok(activityTemplate.registryActivityCode.trim());
    assert.ok(activityTemplate.title.trim());
  }
});

test("the example VEU activity is ordinary catalogue data and incomplete variants fail closed", () => {
  const examples = governmentActivityTemplates("VEU").filter(
    (activityTemplate) => activityTemplate.registryActivityCode === "6(23)",
  );
  assert.equal(examples.length, 1);
  assert.equal(examples[0].productCategory, "");
  assert.equal(examples[0].scenario, "");
});
