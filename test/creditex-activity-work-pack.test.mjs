import assert from "node:assert/strict";
import test from "node:test";

import {
  CREDITEX_ACTIVITY_WORK_PACK_CONTRACT,
  CREDITEX_ACTIVITY_WORK_PACK_RESPONSE_CONTRACT,
  CREDITEX_WORK_PACK_PROMPT_TYPES,
  CREDITEX_WORK_PACK_SIGNER_IDENTITY_SOURCES,
  createCreditexActivityWorkPackVersionIdentity,
  creditexActivityWorkPackCompletion,
  creditexActivityWorkPackSha256,
  creditexActivityWorkPackVisibilityMatches,
  emptyCreditexActivityWorkPackResponse,
  validateCreditexActivityWorkPack,
} from "../src/lib/creditex-activity-work-pack.ts";

const SHA = `sha256:${"a".repeat(64)}`;

function prompt(overrides) {
  return {
    promptKey: "unused",
    order: 1,
    type: "text",
    label: "Prompt",
    instructions: "",
    required: true,
    visibility: null,
    dependencyKeys: [],
    requirementKeys: [],
    stageKey: "",
    options: [],
    signerRoleKey: "",
    attestation: null,
    minimumLength: null,
    maximumLength: null,
    minimumNumber: null,
    maximumNumber: null,
    numberStep: null,
    unit: "",
    minimumSelections: null,
    maximumSelections: null,
    fileRequirement: null,
    referenceDocument: null,
    ...overrides,
  };
}

function workPackFixture() {
  return {
    contract: CREDITEX_ACTIVITY_WORK_PACK_CONTRACT,
    activityTemplateId: "current-program-activity",
    version: 3,
    title: "Governed current-activity field work pack",
    effectiveFrom: "2026-08-01",
    effectiveTo: "",
    catalogueReviewedOn: "2026-08-14",
    stages: [
      {
        stageKey: "pre-install",
        order: 1,
        label: "Before work",
        description: "Confirm eligibility and declarations before work.",
      },
      {
        stageKey: "post-install",
        order: 2,
        label: "After work",
        description: "Capture exact installed-product evidence.",
      },
    ],
    signerRoles: [
      {
        roleKey: "customer",
        label: "Customer",
        capacity: "Energy consumer or authorised representative",
        identitySource: "customer_context",
        minimumSignatures: 1,
        maximumSignatures: 1,
        identityRequirements: [
          { fieldKey: "full-name", label: "Full name", required: true },
          { fieldKey: "authority", label: "Signing authority", required: true },
        ],
      },
      {
        roleKey: "licensed-electrician",
        label: "Licensed electrician",
        capacity: "Licensed electrician responsible for the work",
        identitySource: "assigned_worker",
        minimumSignatures: 1,
        maximumSignatures: 1,
        identityRequirements: [
          { fieldKey: "full-name", label: "Full name", required: true },
          { fieldKey: "licence-number", label: "Licence number", required: true },
        ],
      },
      {
        roleKey: "independent-witness",
        label: "Independent witness",
        capacity: "Witness where the governed activity requires one",
        identitySource: "manual_verified",
        minimumSignatures: 1,
        maximumSignatures: 1,
        identityRequirements: [
          { fieldKey: "full-name", label: "Full name", required: true },
        ],
      },
    ],
    dependencies: [
      {
        dependencyKey: "approved-products",
        kind: "product",
        label: "Approved installed products",
        required: true,
        registryCode: "official-product-register",
        productKind: "air_conditioner",
        productCategory: "Activity-specific approved products",
        selectionMode: "multiple",
        minimumCount: 1,
        maximumCount: 50,
      },
      {
        dependencyKey: "approved-scenario",
        kind: "scenario",
        label: "Approved activity scenario",
        required: true,
        scenarioCodes: ["replacement", "new-installation"],
        selectionMode: "single",
      },
      {
        dependencyKey: "certificate-calculation",
        kind: "calculator",
        label: "Governed certificate calculation",
        required: true,
        catalogueFormulaKey: "veu-part-6-equations-6.1-to-6.5/v2",
        calculatorKey: "current_activity_calculator",
        calculatorVersion: 1,
        requiredInputKeys: ["installed-capacity", "climate-zone"],
      },
    ],
    sections: [
      {
        sectionKey: "customer-and-site",
        order: 1,
        title: "Customer and site",
        description: "Confirm editable customer and job context.",
        visibility: null,
        repeatability: null,
        prompts: [
          prompt({
            promptKey: "customer-name",
            order: 1,
            type: "text",
            label: "Customer name",
            minimumLength: 2,
            maximumLength: 200,
          }),
          prompt({
            promptKey: "access-notes",
            order: 2,
            type: "textarea",
            label: "Access notes",
            required: false,
            minimumLength: 0,
            maximumLength: 2_000,
            visibility: {
              match: "all",
              conditions: [{
                promptKey: "customer-name",
                scope: "work_pack",
                operator: "answered",
                value: null,
              }],
            },
          }),
          prompt({
            promptKey: "activity-date",
            order: 3,
            type: "date",
            label: "Activity date",
          }),
          prompt({
            promptKey: "site-type",
            order: 4,
            type: "select",
            label: "Site type",
            options: [
              { value: "residential", label: "Residential" },
              { value: "business", label: "Business" },
            ],
          }),
          prompt({
            promptKey: "work-streams",
            order: 5,
            type: "multiselect",
            label: "Work streams",
            options: [
              { value: "install", label: "Installation" },
              { value: "decommission", label: "Decommissioning" },
              { value: "commission", label: "Commissioning" },
            ],
            minimumSelections: 1,
            maximumSelections: 3,
          }),
          prompt({
            promptKey: "consumer-declaration",
            order: 6,
            type: "checkbox",
            label: "Consumer declaration",
            stageKey: "pre-install",
            requirementKeys: ["DECLARATION-CONSUMER"],
            attestation: {
              text: "I confirm the information shown is correct.",
              version: "2026.08",
              sourceBindingTargetKey: "consumer-declaration",
            },
          }),
          prompt({
            promptKey: "customer-signature",
            order: 7,
            type: "signature",
            label: "Customer signature",
            stageKey: "pre-install",
            signerRoleKey: "customer",
            requirementKeys: ["SIGNATURE-CUSTOMER"],
            attestation: {
              text: "I sign the governed consumer declaration above.",
              version: "2026.08",
              sourceBindingTargetKey: "consumer-declaration",
            },
          }),
          prompt({
            promptKey: "consumer-rights-document",
            order: 8,
            type: "reference_document",
            label: "Consumer rights document",
            instructions: "Open and read the governed document before continuing.",
            stageKey: "pre-install",
            requirementKeys: ["DOCUMENT-CONSUMER-RIGHTS"],
            referenceDocument: {
              sourceBindingTargetKey: "consumer-rights-document",
              acknowledgementMode: "confirmed",
              acknowledgementText: "I confirm I opened and read this document.",
              acknowledgementVersion: "2026.08",
            },
          }),
        ],
      },
      {
        sectionKey: "installed-units",
        order: 2,
        title: "Installed units",
        description: "Repeat once for every installed product or unit.",
        visibility: {
          match: "all",
          conditions: [{
            promptKey: "site-type",
            scope: "work_pack",
            operator: "in",
            value: ["residential", "business"],
          }],
        },
        repeatability: {
          itemKey: "installed-unit",
          itemLabel: "Installed unit",
          minimumInstances: 1,
          maximumInstances: 50,
        },
        prompts: [
          prompt({
            promptKey: "unit-type",
            order: 1,
            type: "select",
            label: "Unit type",
            dependencyKeys: ["approved-products", "approved-scenario"],
            options: [
              { value: "air-conditioner", label: "Air conditioner" },
              { value: "water-heater", label: "Water heater" },
            ],
          }),
          prompt({
            promptKey: "installed-capacity",
            order: 2,
            type: "number",
            label: "Installed capacity",
            dependencyKeys: ["certificate-calculation"],
            minimumNumber: 0,
            maximumNumber: 100,
            numberStep: 0.5,
            unit: "kW",
            visibility: {
              match: "all",
              conditions: [{
                promptKey: "unit-type",
                scope: "section_instance",
                operator: "equals",
                value: "air-conditioner",
              }],
            },
          }),
          prompt({
            promptKey: "installed-photo",
            order: 3,
            type: "photo",
            label: "Installed product photo",
            stageKey: "post-install",
            requirementKeys: ["PHOTO-BEFORE", "PHOTO-INSTALLED"],
            fileRequirement: {
              minimumCount: 1,
              maximumCount: 5,
              allowedContentTypes: ["image/jpeg", "image/heic"],
              originalRequired: true,
              metadataRequired: true,
              gpsRequired: true,
              captureTimeRequired: true,
            },
          }),
          prompt({
            promptKey: "commissioning-document",
            order: 4,
            type: "document",
            label: "Commissioning document",
            stageKey: "post-install",
            requirementKeys: ["DOCUMENT-COMMISSIONING"],
            fileRequirement: {
              minimumCount: 1,
              maximumCount: 3,
              allowedContentTypes: ["application/pdf", "image/jpeg"],
              originalRequired: true,
              metadataRequired: true,
              gpsRequired: false,
              captureTimeRequired: true,
            },
          }),
        ],
      },
      {
        sectionKey: "installer-sign-off",
        order: 3,
        title: "Installer sign-off",
        description: "Sign once after every installed unit is recorded.",
        visibility: null,
        repeatability: null,
        prompts: [
          prompt({
            promptKey: "installer-signature",
            order: 1,
            type: "signature",
            label: "Licensed installer signature",
            stageKey: "post-install",
            signerRoleKey: "licensed-electrician",
            requirementKeys: ["SIGNATURE-INSTALLER"],
            attestation: {
              text: "I completed and verified every installed unit recorded above.",
              version: "2026.08",
              sourceBindingTargetKey: "installer-declaration",
            },
          }),
        ],
      },
    ],
    documentOutputs: [
      {
        outputKey: "completed-activity-form",
        title: "Completed governed activity form",
        sourceBindingTargetKey: "completed-activity-form-template",
        rendererVersion: "1.0.0",
        required: true,
        placements: [
          {
            placementKey: "customer-name",
            kind: "text",
            sourcePath: "/response/answers/customer-name",
            signaturePromptKey: "",
            signerRoleKey: "",
            pageIndex: 0,
            x: 0.1,
            y: 0.1,
            width: 0.4,
            height: 0.05,
            fontFamily: "helvetica",
            fontSize: 10,
            minimumFontSize: 6,
            overflow: "shrink",
            maximumLines: 1,
            textFormat: "text",
          },
          {
            placementKey: "customer-signature",
            kind: "signature",
            sourcePath: "",
            signaturePromptKey: "customer-signature",
            signerRoleKey: "customer",
            pageIndex: 0,
            x: 0.1,
            y: 0.7,
            width: 0.35,
            height: 0.12,
            fontFamily: "helvetica",
            fontSize: 10,
            minimumFontSize: 6,
            overflow: "shrink",
            maximumLines: 1,
            textFormat: "text",
          },
          {
            placementKey: "installer-signature",
            kind: "signature",
            sourcePath: "",
            signaturePromptKey: "installer-signature",
            signerRoleKey: "licensed-electrician",
            pageIndex: 0,
            x: 0.55,
            y: 0.7,
            width: 0.35,
            height: 0.12,
            fontFamily: "helvetica",
            fontSize: 10,
            minimumFontSize: 6,
            overflow: "shrink",
            maximumLines: 1,
            textFormat: "text",
          },
        ],
      },
    ],
  };
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).reverse().map(([key, item]) => [
      key,
      reverseObjectKeys(item),
    ]),
  );
}

test("the generic contract supports all prompt, dependency and signer shapes", () => {
  const pack = validateCreditexActivityWorkPack(workPackFixture());
  assert.deepEqual(
    new Set(pack.sections.flatMap((section) =>
      section.prompts.map((item) => item.type))),
    new Set(CREDITEX_WORK_PACK_PROMPT_TYPES),
  );
  assert.deepEqual(
    pack.dependencies.map((dependency) => dependency.kind),
    ["product", "scenario", "calculator"],
  );
  assert.deepEqual(
    pack.signerRoles.map((role) => role.roleKey),
    ["customer", "independent-witness", "licensed-electrician"],
  );
  assert.deepEqual(
    new Set(CREDITEX_WORK_PACK_SIGNER_IDENTITY_SOURCES),
    new Set([
      "customer_context",
      "assigned_worker",
      "authenticated_actor",
      "manual_verified",
    ]),
  );
  assert.deepEqual(
    pack.signerRoles.map((role) => role.identitySource),
    ["customer_context", "manual_verified", "assigned_worker"],
  );
  const repeatCondition = pack.sections[1].prompts[1].visibility.conditions[0];
  assert.equal(repeatCondition.scope, "section_instance");
  assert.deepEqual(
    pack.sections[1].prompts[2].requirementKeys,
    ["PHOTO-BEFORE", "PHOTO-INSTALLED"],
  );
  assert.ok(Object.isFrozen(pack));
  assert.ok(Object.isFrozen(pack.sections[0].prompts[0]));
  assert.equal(pack.documentOutputs.length, 1);
  assert.equal(pack.documentOutputs[0].required, true);
});

test("a governed pack has exactly one required completed PDF output", () => {
  const fixture = workPackFixture();
  assert.throws(
    () => validateCreditexActivityWorkPack({
      ...fixture,
      documentOutputs: [],
    }),
    (error) => error.code === "WORK_PACK_DOCUMENT_OUTPUT_REQUIRED",
  );
  assert.throws(
    () => validateCreditexActivityWorkPack({
      ...fixture,
      documentOutputs: [
        fixture.documentOutputs[0],
        {
          ...fixture.documentOutputs[0],
          outputKey: "second-required-output",
        },
      ],
    }),
    (error) => error.code === "WORK_PACK_DOCUMENT_OUTPUT_REQUIRED",
  );
});

test("v1 rejects signature prompts inside a repeatable section", () => {
  const fixture = structuredClone(workPackFixture());
  const installerSignature = fixture.sections[2].prompts[0];
  fixture.sections[1].prompts.push({
    ...installerSignature,
    order: 5,
  });
  fixture.sections.splice(2, 1);
  assert.throws(
    () => validateCreditexActivityWorkPack(fixture),
    (error) => error.code === "WORK_PACK_REPEATABLE_SIGNATURE_UNSUPPORTED",
  );
});

test("canonical hashes and effective-dated identities are deterministic", () => {
  const fixture = workPackFixture();
  const expected = creditexActivityWorkPackSha256(fixture);
  assert.match(expected, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    creditexActivityWorkPackSha256(reverseObjectKeys(fixture)),
    expected,
  );
  const identity = createCreditexActivityWorkPackVersionIdentity({
    organisationId: "creditex-org",
    activityVersionId: "activity-version-2026",
    workPack: fixture,
  });
  assert.equal(identity.effectiveFrom, "2026-08-01");
  assert.equal(identity.effectiveTo, "");
  assert.equal(identity.schemaSha256, expected);
  assert.match(identity.identitySha256, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(
    createCreditexActivityWorkPackVersionIdentity({
      organisationId: "another-org",
      activityVersionId: "activity-version-2026",
      workPack: fixture,
    }).identitySha256,
    identity.identitySha256,
  );
});

test("completion validates repeatable item identity, order and dependencies", () => {
  const pack = validateCreditexActivityWorkPack(workPackFixture());
  const empty = emptyCreditexActivityWorkPackResponse(pack);
  assert.equal(empty.contract, CREDITEX_ACTIVITY_WORK_PACK_RESPONSE_CONTRACT);
  assert.deepEqual(empty.repeatableSections, { "installed-units": [] });
  const response = {
    ...empty,
    answers: {
      "customer-name": "Alex Customer",
      "access-notes": "Rear access",
      "activity-date": "2026-08-14",
      "site-type": "residential",
      "work-streams": ["install", "commission"],
      "consumer-declaration": true,
      "customer-signature": ["signature-customer-1"],
      "installer-signature": ["signature-installer-1"],
      "consumer-rights-document": {
        contract:
          "creditex-activity-work-pack-reference-document-acknowledgement/v1",
        sourceBindingTargetKey: "consumer-rights-document",
        sourceArtifactId: "official-document-artifact-1",
        sourceArtifactSha256: "b".repeat(64),
        acknowledgementMode: "confirmed",
        acknowledged: true,
        acknowledgedAt: "2026-08-14T10:30:00.000Z",
      },
    },
    repeatableSections: {
      "installed-units": [
        {
          instanceKey: "unit-002",
          answers: {
            "unit-type": "air-conditioner",
            "installed-capacity": 7.5,
            "installed-photo": ["artifact-photo-2"],
            "commissioning-document": ["artifact-document-2"],
          },
        },
        {
          instanceKey: "unit-001",
          answers: {
            "unit-type": "water-heater",
            "installed-photo": ["artifact-photo-1"],
            "commissioning-document": ["artifact-document-1"],
          },
        },
      ],
    },
    dependencyResolutions: Object.fromEntries(pack.dependencies.map(
      (dependency, index) => [dependency.dependencyKey, {
        status: "resolved",
        referenceIds: [`governed-${index + 1}`],
        snapshotSha256: SHA,
      }],
    )),
  };
  const completion = creditexActivityWorkPackCompletion({ workPack: pack, response });
  assert.equal(completion.ready, true);
  assert.deepEqual(
    completion.visiblePromptKeys.filter((key) => key.endsWith(".unit-type")),
    [
      "installed-units[unit-002].unit-type",
      "installed-units[unit-001].unit-type",
    ],
  );
  assert.ok(!completion.visiblePromptKeys.includes(
    "installed-units[unit-001].installed-capacity",
  ));

  const duplicateItems = {
    ...response,
    repeatableSections: {
      "installed-units": [
        response.repeatableSections["installed-units"][0],
        {
          ...response.repeatableSections["installed-units"][1],
          instanceKey: "unit-002",
        },
      ],
    },
  };
  const invalid = creditexActivityWorkPackCompletion({
    workPack: pack,
    response: duplicateItems,
  });
  assert.equal(invalid.ready, false);
  assert.ok(invalid.blockers.some((blocker) =>
    blocker.code === "WORK_PACK_REPEATABLE_SECTION_INVALID"));

  const unacknowledged = {
    ...response,
    answers: {
      ...response.answers,
      "consumer-rights-document": {
        ...response.answers["consumer-rights-document"],
        acknowledged: false,
      },
    },
  };
  const blockedByDocument = creditexActivityWorkPackCompletion({
    workPack: pack,
    response: unacknowledged,
  });
  assert.equal(blockedByDocument.ready, false);
  assert.ok(blockedByDocument.blockers.some((blocker) =>
    blocker.key === "consumer-rights-document"));
});

test("the exported visibility evaluator handles work-pack and repeated-item scope", () => {
  const visibility = {
    match: "all",
    conditions: [
      {
        promptKey: "site-type",
        scope: "work_pack",
        operator: "equals",
        value: "residential",
      },
      {
        promptKey: "installed-capacity",
        scope: "section_instance",
        operator: "greater_than_or_equal",
        value: 5,
      },
    ],
  };
  assert.equal(
    creditexActivityWorkPackVisibilityMatches(
      visibility,
      { "site-type": "residential" },
      { "installed-capacity": 7.5 },
    ),
    true,
  );
  assert.equal(
    creditexActivityWorkPackVisibilityMatches(
      visibility,
      { "site-type": "residential" },
      { "installed-capacity": 4.5 },
    ),
    false,
  );
  assert.equal(
    creditexActivityWorkPackVisibilityMatches(null, {}, {}),
    true,
  );
});

test("schema references and governed capture stages fail closed", () => {
  const unknownRole = workPackFixture();
  unknownRole.sections[0].prompts[6].signerRoleKey = "undeclared-role";
  unknownRole.documentOutputs[0].placements.find(
    (placement) => placement.placementKey === "customer-signature",
  ).signerRoleKey = "undeclared-role";
  assert.throws(
    () => validateCreditexActivityWorkPack(unknownRole),
    (error) => error.code === "WORK_PACK_DOCUMENT_SIGNATURE_REFERENCE_INVALID",
  );

  const unstagedDeclaration = workPackFixture();
  unstagedDeclaration.sections[0].prompts[5].stageKey = "";
  assert.throws(
    () => validateCreditexActivityWorkPack(unstagedDeclaration),
    (error) => error.code === "WORK_PACK_EVIDENCE_STAGE_REQUIRED",
  );

  const forwardItemCondition = workPackFixture();
  forwardItemCondition.sections[1].prompts[0].visibility = {
    match: "all",
    conditions: [{
      promptKey: "installed-capacity",
      scope: "section_instance",
      operator: "answered",
      value: null,
    }],
  };
  assert.throws(
    () => validateCreditexActivityWorkPack(forwardItemCondition),
    (error) => error.code === "WORK_PACK_PROMPT_CONDITION_FORWARD_REFERENCE",
  );

  const mismatchedReferenceRequirement = workPackFixture();
  mismatchedReferenceRequirement.sections[0].prompts[7].required = false;
  assert.throws(
    () => validateCreditexActivityWorkPack(mismatchedReferenceRequirement),
    (error) => error.code === "WORK_PACK_REFERENCE_DOCUMENT_REQUIREMENT_INVALID",
  );

  const unknownSignerIdentitySource = workPackFixture();
  unknownSignerIdentitySource.signerRoles[0].identitySource = "capacity_guess";
  assert.throws(
    () => validateCreditexActivityWorkPack(unknownSignerIdentitySource),
    (error) => error.code === "WORK_PACK_SIGNER_IDENTITY_SOURCE_INVALID",
  );
});
