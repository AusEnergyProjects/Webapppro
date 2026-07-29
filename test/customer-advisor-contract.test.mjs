import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  CUSTOMER_ADVISOR_PROFILE_VERSION,
  CUSTOMER_LEGACY_PLAN_VERSIONS,
  CUSTOMER_PLAN_VERSION,
  CUSTOMER_PROFESSIONAL_REVIEW_DECLARATION_VERSION,
  buildAnonymizedOpportunity,
  createCustomerPermissionPack,
  createCustomerProjectPlan,
  customerAdvisorOptions,
  derivePlanningClimateProfile,
  normalizeCustomerAdvisorProfile,
  normalizeCustomerProfessionalReview,
  normalizeCustomerProject,
  resetCustomerProfessionalReviewDeclaration,
  validateCustomerProfessionalReview,
} from "../src/lib/customer-projects.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../drizzle/0082_customer_advisor_profile.sql");
const route = read("../src/app/api/customer-projects/route.ts");
const schema = read("../db/schema.ts");

const project = {
  title: "Comfort priorities",
  postcode: "3000",
  addressState: "VIC",
  propertyType: "house",
  householdSituation: "renter",
  goals: ["improve-comfort"],
  pace: "staged",
};

test("important home facts derive customer reports without claiming validation", () => {
  assert.equal(CUSTOMER_PLAN_VERSION, "2026-07-29-adviser-print-comfort-v3");
  assert.equal(CUSTOMER_ADVISOR_PROFILE_VERSION, "2026-07-29-advisor-profile-v4");
  assert.equal(
    CUSTOMER_PROFESSIONAL_REVIEW_DECLARATION_VERSION,
    "2026-07-29-self-declared-adviser-v1",
  );
  assert.ok(CUSTOMER_LEGACY_PLAN_VERSIONS.includes("2026-07-29-decision-support-advisor"));
  assert.ok(CUSTOMER_LEGACY_PLAN_VERSIONS.includes("2026-07-29-home-advisor"));
  assert.ok(CUSTOMER_LEGACY_PLAN_VERSIONS.includes("2026-07-29-evidence-climate-advisor"));
  assert.ok(CUSTOMER_LEGACY_PLAN_VERSIONS.includes("2026-07-29-home-feature-taxonomy-v2"));
  assert.deepEqual(
    customerAdvisorOptions.evidenceSources.find(([value]) => value === "photo-supported"),
    ["photo-supported", "Photo available for review"],
  );
  assert.deepEqual(
    customerAdvisorOptions.evidenceSources.find(([value]) => value === "document-supported"),
    ["document-supported", "Document available for review"],
  );
  const normalized = normalizeCustomerProject({
    ...project,
    existingFeatures: ["single-glazing", "ceiling-insulation-limited"],
    evidence: [{ category: "property-photo" }],
    advisorProfile: {
      climate: { code: "hot-humid", notNatHERSAssessment: false },
      factEvidence: [
        { factKey: "glazing", source: "photo-supported" },
        { factKey: "roof", source: "professionally-verified" },
        { factKey: "private-routine", source: "document-supported" },
      ],
    },
  });
  assert.equal(normalized.ok, true);
  assert.equal(normalized.project.advisorProfile.version, CUSTOMER_ADVISOR_PROFILE_VERSION);
  assert.equal(
    normalized.project.advisorProfile.factEvidence.length,
    customerAdvisorOptions.factKeys.length,
  );
  assert.deepEqual(
    normalized.project.advisorProfile.factEvidence.find((item) => item.factKey === "glazing"),
    { factKey: "glazing", source: "photo-supported" },
  );
  assert.deepEqual(
    normalized.project.advisorProfile.factEvidence.find((item) => item.factKey === "roof"),
    { factKey: "roof", source: "unknown" },
  );
  assert.deepEqual(
    normalized.project.advisorProfile.factEvidence.find((item) => item.factKey === "ceiling-insulation"),
    { factKey: "ceiling-insulation", source: "customer-reported" },
  );
  assert.equal(
    normalized.project.advisorProfile.factEvidence.some((item) => item.factKey === "private-routine"),
    false,
  );
  assert.equal(normalized.project.advisorProfile.climate.code, "cool-temperate");
  assert.equal(normalized.project.advisorProfile.climate.notNatHERSAssessment, true);
});

test("professional review is a bounded self-declaration and disabled records clear safely", () => {
  const suppliedReview = {
    enabled: true,
    role: "accredited-energy-adviser",
    adviserName: "  Alex   Adviser  ",
    accreditationScheme: "  Independent Energy Assessors  ",
    accreditationReference: "IEA / 123-45",
    notes: "  Reviewed the household answers; roof access remains unknown.  ",
    declarationAccepted: true,
    declarationVersion: CUSTOMER_PROFESSIONAL_REVIEW_DECLARATION_VERSION,
    verified: true,
    approvedBy: "Australian Energy Assessments",
    email: "private@example.com",
  };
  const validation = validateCustomerProfessionalReview(suppliedReview);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.review, {
    enabled: true,
    role: "accredited-energy-adviser",
    adviserName: "Alex Adviser",
    accreditationScheme: "Independent Energy Assessors",
    accreditationReference: "IEA / 123-45",
    notes: "Reviewed the household answers; roof access remains unknown.",
    declarationAccepted: true,
    declarationVersion: CUSTOMER_PROFESSIONAL_REVIEW_DECLARATION_VERSION,
  });
  for (const unsafeKey of ["verified", "approvedBy", "email"]) {
    assert.equal(unsafeKey in validation.review, false);
  }

  const normalized = normalizeCustomerProject({
    ...project,
    serviceCategories: ["insulation"],
    priorities: ["comfort"],
    advisorProfile: { professionalReview: suppliedReview },
  });
  assert.equal(normalized.ok, true);
  assert.deepEqual(
    normalized.project.advisorProfile.professionalReview,
    validation.review,
  );
  const opportunity = buildAnonymizedOpportunity(
    normalized.project,
    "professional-review-private",
  );
  assert.doesNotMatch(
    JSON.stringify(opportunity),
    /Alex Adviser|Independent Energy Assessors|IEA \/ 123-45|private@example\.com/,
  );

  const disabled = normalizeCustomerProject({
    ...project,
    advisorProfile: {
      professionalReview: {
        ...suppliedReview,
        enabled: false,
      },
    },
  });
  assert.equal(disabled.ok, true);
  assert.equal("professionalReview" in disabled.project.advisorProfile, false);
  assert.equal(
    normalizeCustomerProfessionalReview({
      ...suppliedReview,
      enabled: false,
    }),
    null,
  );
});

test("incomplete professional review declarations fail instead of being silently published", () => {
  const complete = {
    enabled: true,
    role: "accredited-home-comfort-adviser",
    adviserName: "Casey Reviewer",
    accreditationScheme: "Home Comfort Association",
    accreditationReference: "HCA-2048",
    notes: "",
    declarationAccepted: true,
    declarationVersion: CUSTOMER_PROFESSIONAL_REVIEW_DECLARATION_VERSION,
  };
  const cases = [
    [{ ...complete, role: "unverified-role" }, /Choose the accredited adviser role/i],
    [{ ...complete, adviserName: " " }, /Enter the adviser name/i],
    [{ ...complete, accreditationScheme: "" }, /accreditation scheme or professional body/i],
    [{ ...complete, accreditationReference: "<script>" }, /valid accreditation or membership reference/i],
    [{ ...complete, declarationAccepted: false }, /Confirm the professional review declaration/i],
    [{ ...complete, declarationVersion: undefined }, /current professional review declaration/i],
    [{ ...complete, declarationVersion: "retired-declaration" }, /current professional review declaration/i],
  ];
  for (const [professionalReview, expectedError] of cases) {
    const result = normalizeCustomerProject({
      ...project,
      advisorProfile: { professionalReview },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, expectedError);
    assert.equal(normalizeCustomerProfessionalReview(professionalReview), null);
  }
});

test("professional review confirmation is invalidated without changing the declared identity", () => {
  const profile = {
    rooms: [{ id: "living", name: "Living room" }],
    professionalReview: {
      enabled: true,
      role: "accredited-energy-adviser",
      adviserName: "Alex Adviser",
      accreditationScheme: "Independent Energy Assessors",
      accreditationReference: "IEA-123",
      notes: "Reviewed from the household record.",
      declarationAccepted: true,
      declarationVersion: CUSTOMER_PROFESSIONAL_REVIEW_DECLARATION_VERSION,
    },
  };
  const reset = resetCustomerProfessionalReviewDeclaration(profile);
  assert.notEqual(reset, profile);
  assert.deepEqual(reset.rooms, profile.rooms);
  assert.deepEqual(reset.professionalReview, {
    enabled: true,
    role: "accredited-energy-adviser",
    adviserName: "Alex Adviser",
    accreditationScheme: "Independent Energy Assessors",
    accreditationReference: "IEA-123",
    notes: "Reviewed from the household record.",
    declarationAccepted: false,
  });
  assert.equal(
    "declarationVersion" in reset.professionalReview,
    false,
  );
  assert.equal(validateCustomerProfessionalReview(reset.professionalReview).ok, false);
});

test("professional review attribution cannot change generated advice", () => {
  const input = {
    ...project,
    goals: ["improve-comfort", "lower-bills"],
    existingFeatures: [
      "comfort-too-cold",
      "single-glazing",
      "ceiling-insulation-limited",
      "reverse-cycle",
    ],
    budgetRange: "under_2k",
  };
  const withoutReview = createCustomerProjectPlan(input);
  const withReview = createCustomerProjectPlan({
    ...input,
    advisorProfile: {
      professionalReview: {
        enabled: true,
        role: "accredited-energy-adviser",
        adviserName: "Advice Invariant Canary",
        accreditationScheme: "Independent Scheme",
        accreditationReference: "IS-100",
        notes: "This wording must not enter advice.",
        declarationAccepted: true,
      },
    },
  });
  assert.deepEqual(withReview, withoutReview);
  assert.doesNotMatch(
    JSON.stringify(withReview),
    /Advice Invariant Canary|Independent Scheme|IS-100|must not enter advice/,
  );
});

test("installer opportunity summaries cannot disclose private room names or permission notes", () => {
  const normalized = normalizeCustomerProject({
    ...project,
    serviceCategories: ["draught-proofing"],
    priorities: ["comfort"],
    advisorProfile: {
      factEvidence: [{ factKey: "glazing", source: "customer-reported" }],
      rooms: [{
        id: "private-bedroom",
        name: "Jamie private bedroom",
        roomType: "bedroom",
        concerns: ["too-cold"],
        usePeriods: ["overnight"],
      }],
      permissionItems: [{
        id: "private-note",
        title: "Ask about bedroom work",
        classification: "permission-needed",
        note: "Call Sarah at the private address",
      }],
    },
  });
  assert.equal(normalized.ok, true);
  const opportunity = buildAnonymizedOpportunity(
    normalized.project,
    "customer-project-private-advisor",
  );
  const serialized = JSON.stringify(opportunity);
  assert.doesNotMatch(serialized, /Jamie private bedroom|Call Sarah|private address/);
  assert.equal("advisorProfile" in opportunity, false);
  assert.match(opportunity.summary, /cool temperate planning profile/i);
  assert.match(opportunity.summary, /room types: bedroom/i);
  assert.match(opportunity.summary, /reported concerns: too cold/i);
  assert.match(
    opportunity.summary,
    /0 tracked home facts have a household answer or linked evidence and 16 remain not known or not checked/i,
  );
  assert.doesNotMatch(opportunity.summary, /overnight|permission-needed/i);
});

test("room profiles are bounded, deduplicated and stripped to safe advisor choices", () => {
  const rooms = Array.from({ length: 15 }, (_, index) => ({
    id: index < 2 ? "same-room" : `room-${index}`,
    name: index === 1 ? "  Second   bedroom  " : `Room ${index + 1}`,
    roomType: index === 2 ? "server-room" : "bedroom",
    concerns: ["too-cold", "too-cold", "unsafe-concern"],
    usePeriods: ["overnight", "private-routine"],
    privateOccupancyNotes: "must not persist",
  }));
  const profile = normalizeCustomerAdvisorProfile(
    { rooms },
    { postcode: "7000", addressState: "TAS" },
  );
  assert.equal(profile.rooms.length, 12);
  assert.equal(new Set(profile.rooms.map((room) => room.id)).size, 12);
  assert.equal(profile.rooms[1].name, "Second bedroom");
  assert.equal(profile.rooms[0].name.length <= 60, true);
  assert.equal(profile.rooms[2].roomType, "other");
  assert.deepEqual(profile.rooms[0].concerns, ["too-cold"]);
  assert.deepEqual(profile.rooms[0].usePeriods, ["overnight"]);
  assert.equal("privateOccupancyNotes" in profile.rooms[0], false);
});

test("controlled room concerns and use periods change advice text and safe sequencing", () => {
  const common = {
    ...project,
    existingFeatures: [
      "draughty",
      "single-glazing",
      "roof-insulation",
      "external-shading",
    ],
  };
  const hotDaytime = createCustomerProjectPlan({
    ...common,
    advisorProfile: {
      rooms: [{
        id: "living",
        name: "Private north living room",
        roomType: "living",
        concerns: ["too-hot"],
        usePeriods: ["daytime"],
      }],
    },
  });
  const coldOvernight = createCustomerProjectPlan({
    ...common,
    advisorProfile: {
      rooms: [{
        id: "bedroom",
        name: "Private rear bedroom",
        roomType: "bedroom",
        concerns: ["too-cold"],
        usePeriods: ["overnight"],
      }],
    },
  });
  const hotRoomStep = hotDaytime.items.find((item) => item.id === "room-comfort-profile");
  const coldRoomStep = coldOvernight.items.find((item) => item.id === "room-comfort-profile");
  assert.match(hotRoomStep.title, /daytime heat and sun/i);
  assert.match(hotRoomStep.text, /too hot[\s\S]*daytime[\s\S]*shade/i);
  assert.match(coldRoomStep.title, /overnight heat retention/i);
  assert.match(coldRoomStep.text, /too cold[\s\S]*overnight[\s\S]*draught control/i);
  assert.notEqual(hotRoomStep.text, coldRoomStep.text);
  assert.doesNotMatch(
    JSON.stringify([hotRoomStep, coldRoomStep]),
    /Private north living room|Private rear bedroom/,
  );
  assert.ok(
    hotDaytime.items.findIndex((item) => item.id === "window-shading")
      < hotDaytime.items.findIndex((item) => item.id === "draught-proofing"),
  );
  assert.ok(
    coldOvernight.items.findIndex((item) => item.id === "draught-proofing")
      < coldOvernight.items.findIndex((item) => item.id === "window-shading"),
  );

  const separateRoomSignals = createCustomerProjectPlan({
    ...common,
    advisorProfile: {
      rooms: [
        {
          id: "hot-overnight",
          name: "Private hot overnight room",
          roomType: "bedroom",
          concerns: ["too-hot"],
          usePeriods: ["overnight"],
        },
        {
          id: "neutral-daytime",
          name: "Private neutral daytime room",
          roomType: "living",
          concerns: [],
          usePeriods: ["daytime"],
        },
      ],
    },
  });
  const separateRoomStep = separateRoomSignals.items
    .find((item) => item.id === "room-comfort-profile");
  assert.doesNotMatch(separateRoomStep.title, /daytime heat and sun/i);
  assert.doesNotMatch(
    JSON.stringify(separateRoomStep),
    /Private hot overnight room|Private neutral daytime room/,
  );
});

test("renter portable actions stay ahead of permission and fixed shell work", () => {
  const plan = createCustomerProjectPlan({
    ...project,
    goals: ["renter-friendly", "improve-comfort"],
    existingFeatures: ["draughty", "single-glazing", "roof-insulation"],
  });
  const portableIndex = plan.items.findIndex((item) => item.id === "renter-friendly-actions");
  assert.ok(portableIndex >= 0);
  for (const id of [
    "authority",
    "draught-proofing",
    "insulation-review",
    "windows-glazing",
  ]) {
    assert.ok(
      portableIndex < plan.items.findIndex((item) => item.id === id),
      `expected renter-friendly-actions before ${id}`,
    );
  }
});

test("postcode and state produce deterministic broad planning profiles and plan sequencing", () => {
  const cases = [
    ["3000", "VIC", "cool-temperate"],
    ["4870", "QLD", "hot-humid"],
    ["4000", "QLD", "warm-humid"],
    ["0870", "NT", "hot-dry"],
    ["5000", "SA", "temperate-dry"],
    ["2000", "NSW", "temperate-mixed"],
  ];
  for (const [postcode, state, code] of cases) {
    const first = derivePlanningClimateProfile(postcode, state);
    const second = derivePlanningClimateProfile(postcode, state);
    assert.deepEqual(first, second);
    assert.equal(first.code, code);
    assert.equal(first.basis, "postcode-state-planning");
    assert.equal(first.notNatHERSAssessment, true);
    assert.match(first.disclaimer, /not a NatHERS climate zone/i);
  }
  for (const [postcode, state] of [
    ["", "VIC"],
    ["0000", "VIC"],
    ["3000", ""],
    ["3000", "NSW"],
    ["9999", "NT"],
  ]) {
    assert.equal(derivePlanningClimateProfile(postcode, state), null);
  }
  const unmatchedProfile = normalizeCustomerAdvisorProfile(
    { climate: { code: "hot-humid" } },
    { postcode: "3000", addressState: "NSW" },
  );
  assert.equal("climate" in unmatchedProfile, false);
  const noClimatePlan = createCustomerProjectPlan({
    ...project,
    postcode: "3000",
    addressState: "NSW",
  });
  assert.equal(
    noClimatePlan.items.some((item) => item.id === "climate-sequence"),
    false,
  );
  const coolPlan = createCustomerProjectPlan({
    ...project,
    advisorProfile: {},
  });
  const hotPlan = createCustomerProjectPlan({
    ...project,
    postcode: "4870",
    addressState: "QLD",
    existingFeatures: [
      "draughty",
      "single-glazing",
      "roof-insulation",
      "external-shading",
    ],
    advisorProfile: {},
  });
  const coolSequencedPlan = createCustomerProjectPlan({
    ...project,
    existingFeatures: [
      "draughty",
      "single-glazing",
      "roof-insulation",
      "external-shading",
    ],
    advisorProfile: {},
  });
  const coolClimate = coolPlan.items.find((item) => item.id === "climate-sequence");
  const hotClimate = hotPlan.items.find((item) => item.id === "climate-sequence");
  assert.ok(coolClimate);
  assert.ok(hotClimate);
  assert.notEqual(coolClimate.title, hotClimate.title);
  assert.equal(coolClimate.href, "/guides/project-preparation#climate-planning");
  assert.equal(
    coolPlan.items.some((item) => item.id === "evidence-confidence"),
    false,
  );
  assert.ok(coolPlan.nextQuestions.some((item) => item.id.startsWith("fact-")));
  assert.ok(
    hotPlan.items.findIndex((item) => item.id === "window-shading")
      < hotPlan.items.findIndex((item) => item.id === "draught-proofing"),
  );
  assert.ok(
    coolSequencedPlan.items.findIndex((item) => item.id === "draught-proofing")
      < coolSequencedPlan.items.findIndex((item) => item.id === "window-shading"),
  );
  assert.ok(
    hotPlan.items.every((item) => Boolean(item.href && item.action)),
  );
  assert.ok(coolPlan.items.findIndex((item) => item.id === "climate-sequence")
    < coolPlan.items.findIndex((item) => item.id === "heating"));
});

test("permission items are bounded and create a tenure, strata and plan-aware checklist", () => {
  const supplied = Array.from({ length: 34 }, (_, index) => ({
    id: `item-${index}`,
    title: `  Improvement   ${index + 1}  `,
    classification: index === 0
      ? "portable"
      : index === 1
        ? "permission-needed"
        : index === 2
          ? "fixed-or-shared"
          : index === 3
            ? "not-sure"
            : "untrusted",
    note: index === 2
      ? "12 Smith Street 3000 BrandCo $25,000 Overnight routine"
      : ` Ask the relevant decision maker ${"x".repeat(400)}`,
  }));
  const profile = normalizeCustomerAdvisorProfile(
    { permissionItems: supplied },
    { postcode: "3000", addressState: "VIC" },
  );
  assert.equal(profile.permissionItems.length, 30);
  assert.equal(profile.permissionItems[0].title, "Improvement 1");
  assert.equal(profile.permissionItems[1].classification, "permission-needed");
  assert.equal(profile.permissionItems[2].classification, "fixed-or-shared");
  assert.equal(profile.permissionItems[3].classification, "not-sure");
  assert.equal(profile.permissionItems[4].classification, "not-sure");
  assert.equal(profile.permissionItems[0].note.length, 300);

  const pack = createCustomerPermissionPack(profile, {
    householdSituation: "renter",
    approvalContext: "strata",
    postcode: "3000",
    addressState: "VIC",
    privateNotes: "Private household note at 12 Smith Street",
    planItems: [
      { id: "renter-friendly-actions", title: "untrusted title", text: "$99 BrandCo" },
      { id: "solar", title: "Install BrandCo at 12 Smith Street", text: "$25,000" },
      { id: "room-comfort-profile", title: "Private room detail", text: "Overnight routine" },
      { id: "custom-private", title: "Private budget note", text: "Keep $8,000 for BrandCo" },
    ],
  });
  assert.equal(pack.sections.length, 5);
  assert.deepEqual(
    pack.sections.map((section) => section.classification),
    [
      "portable",
      "owner-agent",
      "strata-shared",
      "licensed-site-checks",
      "evidence-questions",
    ],
  );
  assert.deepEqual(pack.context, {
    householdSituation: "renter",
    approvalContext: "strata",
  });
  const portable = pack.sections.find((section) => section.classification === "portable");
  const ownerAgent = pack.sections.find((section) => section.classification === "owner-agent");
  const strata = pack.sections.find((section) => section.classification === "strata-shared");
  const licensed = pack.sections.find((section) => section.classification === "licensed-site-checks");
  const evidence = pack.sections.find((section) => section.classification === "evidence-questions");
  assert.ok(portable.items.some((item) => item.id === "tenure-portable-first"));
  assert.ok(portable.items.some((item) => item.id === "plan-renter-friendly-actions"));
  assert.ok(portable.items.some((item) => item.id === "customer-private-item-1"));
  assert.ok(ownerAgent.items.some((item) => item.id === "tenure-owner-agent"));
  assert.ok(ownerAgent.items.some((item) => item.id === "customer-private-item-2"));
  assert.ok(strata.items.some((item) => item.id === "approval-strata"));
  assert.ok(strata.items.some((item) => item.id === "strata-solar"));
  assert.ok(licensed.items.some((item) => item.id === "plan-solar"));
  assert.ok(evidence.items.some((item) => item.id === "plan-room-comfort-profile"));
  assert.ok(evidence.items.some((item) => item.id === "custom-plan-items"));
  assert.ok(
    evidence.items.some((item) => item.id === "unknown-home-facts"),
  );
  assert.ok(
    strata.items.some((item) =>
      item.id === "customer-private-item-3"
      && item.note.includes("wording is not copied here")),
  );
  assert.match(pack.disclaimer, /not legal advice/i);
  assert.match(pack.disclaimer, /does not grant or confirm permission/i);
  assert.doesNotMatch(
    JSON.stringify(pack),
    /12 Smith Street|Private household note|BrandCo|\$25,000|\$8,000|Overnight routine/,
  );

  const overridePack = createCustomerPermissionPack({
    permissionItems: [
      {
        id: "plan-solar",
        title: "Untrusted brand and price",
        classification: "portable",
        note: "Customer wants this reviewed as a portable option",
      },
      {
        id: "plan-custom-private",
        title: "Private custom title",
        classification: "permission-needed",
        note: "Private custom note",
      },
    ],
  }, {
    householdSituation: "owner",
    approvalContext: "none",
    postcode: "3000",
    addressState: "VIC",
    planItems: [
      { id: "solar", title: "Malicious BrandCo title", text: "$30,000" },
      { id: "custom-private", title: "Private custom title", text: "Private custom note" },
    ],
  });
  const overridePortable = overridePack.sections
    .find((section) => section.classification === "portable");
  const overrideLicensed = overridePack.sections
    .find((section) => section.classification === "licensed-site-checks");
  assert.ok(
    overridePortable.items.some((item) =>
      item.id === "customer-plan-solar"
      && item.note.includes("private project note")
      && item.note.includes("wording is not copied here")),
  );
  assert.equal(
    overrideLicensed.items.some((item) => item.id === "plan-solar"),
    true,
  );
  assert.doesNotMatch(
    JSON.stringify(overridePack),
    /Untrusted brand and price|Malicious BrandCo|\$30,000|Private custom title|Private custom note|Customer wants this reviewed as a portable option/,
  );

  const unreviewedPack = createCustomerPermissionPack({
    permissionItems: [{
      id: "plan-solar",
      title: "Old solar title",
      classification: "not-sure",
      note: "",
    }],
  }, {
    householdSituation: "renter",
    approvalContext: "strata",
    planItems: [{ id: "solar" }],
  });
  assert.ok(
    unreviewedPack.sections
      .find((section) => section.classification === "licensed-site-checks")
      .items.some((item) => item.id === "plan-solar"),
  );
  assert.ok(
    unreviewedPack.sections
      .find((section) => section.classification === "evidence-questions")
      .items.some((item) => item.id === "confirm-solar"),
  );
  assert.doesNotMatch(JSON.stringify(unreviewedPack), /Old solar title/);
});

test("the additive migration and owner-scoped API persist the advisor profile", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE customer_projects (id text PRIMARY KEY NOT NULL)");
  for (const statement of migration
    .split("--> statement-breakpoint")
    .map((item) => item.trim())
    .filter(Boolean)) {
    db.exec(statement);
  }
  const column = db.prepare("PRAGMA table_info(customer_projects)").all()
    .find((item) => item.name === "advisor_profile");
  assert.ok(column);
  assert.equal(column.notnull, 1);
  assert.equal(column.dflt_value, "'{}'");
  db.close();

  assert.match(schema, /advisorProfile: text\("advisor_profile"\)\.notNull\(\)\.default\("\{\}"\)/);
  assert.match(route, /advisorProfile: normalizeCustomerAdvisorProfile/);
  assert.match(route, /JSON\.stringify\(project\.advisorProfile\)/);
  assert.match(route, /advisor_profile = \?/);
  assert.match(route, /private_notes, advisor_profile, plan_snapshot/);
  assert.match(route, /WHERE id = \? AND firebase_uid = \?/);
});
