import assert from "node:assert/strict";
import test from "node:test";
import {
  RENTAL_ASSESSOR_TITLE, RENTAL_ROOM_TYPES, RENTAL_ROOM_CHECKS,
  normalizeRentalRoomRoster, rentalRoomChecks, rentalRoomsForCheck,
  rentalRoomsFromItems, rentalRoomItemInstance, rentalAssessorEvidenceRequirement,
  rentalAssessorCheckPresentation,
} from "../src/lib/rental-assessor-workflow.mjs";
import { rentalAssessmentTemplateSnapshot, RENTAL_ASSESSMENT_OUTCOMES } from "../src/lib/trade-rental-assessment.mjs";

const bedroom = { id: "bedroom_1", label: "Front bedroom", type: "bedroom" };
const keys = (type) => rentalRoomChecks(type).map((check) => check.checkKey);

test("room roster is bounded, strips unknown metadata and rejects ambiguous identities", () => {
  assert.deepEqual(normalizeRentalRoomRoster([{ ...bedroom, label: " Front   bedroom ", outcome: "meets" }]), [bedroom]);
  for (const value of [undefined, null, {}, "room", [null], [{ ...bedroom, id: "bad:key" }],
    [{ ...bedroom, label: "" }], [{ ...bedroom, label: "a".repeat(121) }], [{ ...bedroom, type: "unknown" }],
    [bedroom, { ...bedroom, label: "Different room" }], [bedroom, { ...bedroom, id: "second", label: " FRONT  BEDROOM " }],
    Array.from({ length: 81 }, (_, n) => ({ id: `room_${n}`, label: `Room ${n}`, type: "bedroom" }))]) {
    assert.throws(() => normalizeRentalRoomRoster(value), { message: "RENTAL_ROOM_ROSTER_INVALID", code: "RENTAL_ROOM_ROSTER_INVALID" });
  }
  assert.equal(normalizeRentalRoomRoster(Array.from({ length: 80 }, (_, n) => ({ id: `room_${n}`, label: `Room ${n}`, type: "bedroom" }))).length, 80);
  assert.deepEqual(normalizeRentalRoomRoster([]), []);
});

test("each room receives applicable checks while outside weatherproofing remains assessable", () => {
  assert.equal(RENTAL_ASSESSOR_TITLE, "Rental assessment + 2027");
  assert.deepEqual(keys("bedroom"), RENTAL_ROOM_CHECKS.map((check) => check.checkKey));
  assert.equal(keys("kitchen").length, 5);
  assert.equal(keys("bathroom").length, 4);
  assert.ok(keys("bathroom").includes("room_ventilation"));
  assert.ok(!keys("bathroom").includes("habitable_daylight"));
  assert.deepEqual(keys("hallway"), ["artificial_lighting", "mould_damp_observation", "structure_weatherproofing"]);
  assert.deepEqual(keys("exterior"), ["structure_weatherproofing"]);
  assert.deepEqual(keys("unknown"), []);
  const roster = [bedroom, { id: "bath", label: "Bathroom", type: "bathroom" }];
  assert.deepEqual(rentalRoomsForCheck({ key: "habitable_daylight" }, roster), [bedroom]);
  assert.deepEqual(rentalRoomsForCheck({ key: "room_ventilation" }, roster), roster);
  assert.deepEqual(rentalRoomsForCheck({ key: "heater_operation" }, roster), []);
  assert.deepEqual(rentalRoomsForCheck(null, null), []);
  assert.ok(RENTAL_ROOM_TYPES.every((type) => type.value && type.label));
});

test("legacy room observations reuse only the same check and location, with no copied answers", () => {
  const items = [
    { checkKey: "mould_damp_observation", instanceKey: "old_mould_key", locationLabel: " FRONT  bedroom ", outcome: "does_not_meet", response: { detail: "old" } },
    { checkKey: "artificial_lighting", instanceKey: "old_light_key", locationLabel: "Front bedroom", outcome: "meets" },
    { checkKey: "artificial_lighting", instanceKey: "rear_light", locationLabel: "Rear bedroom", outcome: "meets" },
  ];
  const before = structuredClone(items);
  assert.equal(rentalRoomItemInstance(bedroom, "mould_damp_observation", items), "old_mould_key");
  assert.equal(rentalRoomItemInstance(bedroom, "artificial_lighting", items), "old_light_key");
  assert.equal(rentalRoomItemInstance(bedroom, "room_ventilation", items), bedroom.id);
  const rooms = rentalRoomsFromItems([bedroom], items);
  assert.deepEqual(rooms[0], bedroom);
  assert.deepEqual(rooms[1], { id: rooms[1].id, label: "Rear bedroom", type: "other" });
  assert.match(rooms[1].id, /^legacy_room_/);
  assert.notEqual(rooms[1].id, "rear_light");
  assert.deepEqual(items, before);
  assert.ok(rooms.every((room) => Object.keys(room).sort().join(",") === "id,label,type"));
});

test("legacy ambiguity never picks an arbitrary saved result and exact room identity takes priority", () => {
  const items = [
    { checkKey: "artificial_lighting", instanceKey: "old_1", locationLabel: bedroom.label },
    { checkKey: "artificial_lighting", instanceKey: "old_2", locationLabel: bedroom.label },
  ];
  assert.equal(rentalRoomItemInstance(bedroom, "artificial_lighting", items), bedroom.id);
  items.push({ checkKey: "artificial_lighting", instanceKey: bedroom.id, locationLabel: bedroom.label });
  assert.equal(rentalRoomItemInstance(bedroom, "artificial_lighting", items), bedroom.id);
});

test("check-scoped legacy IDs never transfer another room's outcome or satisfy its coverage", () => {
  const items = [
    { checkKey: "artificial_lighting", instanceKey: "first", locationLabel: "Front bedroom", outcome: "meets" },
    { checkKey: "mould_damp_observation", instanceKey: "first", locationLabel: "Rear bedroom", outcome: "does_not_meet" },
  ];
  const rooms = rentalRoomsFromItems([], items);
  assert.equal(rooms.length, 2);
  assert.ok(rooms.every((room) => room.id !== "first"));
  assert.equal(rentalRoomItemInstance(rooms[0], "artificial_lighting", items), "first");
  const frontMould = rentalRoomItemInstance(rooms[0], "mould_damp_observation", items);
  assert.notEqual(frontMould, "first");
  assert.equal(items.find((item) => item.checkKey === "mould_damp_observation" && item.instanceKey === frontMould), undefined);
  // Recording a missing check must not change the derived room's identity mid-flow.
  items.push({ checkKey: "mould_damp_observation", instanceKey: frontMould, locationLabel: "Front bedroom", outcome: "meets" });
  assert.deepEqual(rentalRoomsFromItems([], items), rooms);
  assert.equal(rentalRoomItemInstance(rooms[0], "mould_damp_observation", items), frontMould);
});

test("an explicit roster ID collision gets an unused identity rather than another location's item", () => {
  const room = { id: "first", label: "Front bedroom", type: "bedroom" };
  const items = [
    { checkKey: "mould_damp_observation", instanceKey: "first", locationLabel: "Rear bedroom", outcome: "does_not_meet" },
    { checkKey: "artificial_lighting", instanceKey: "room_first_1", locationLabel: "Kitchen", outcome: "meets" },
  ];
  const identity = rentalRoomItemInstance(room, "mould_damp_observation", items);
  assert.equal(identity, "room_first_2");
  assert.ok(!items.some((item) => item.instanceKey === identity));
  items.push({ checkKey: "mould_damp_observation", instanceKey: identity, locationLabel: room.label, outcome: "meets" });
  assert.equal(rentalRoomItemInstance(room, "mould_damp_observation", items), identity);
});

test("generated legacy room identity avoids IDs occupied at another location and stays stable", () => {
  const original = [{ checkKey: "artificial_lighting", instanceKey: "first", locationLabel: "Front bedroom" }];
  const generated = rentalRoomsFromItems([], original)[0].id;
  const items = [...original, { checkKey: "heater_operation", instanceKey: generated, locationLabel: "Kitchen" }];
  const room = rentalRoomsFromItems([], items)[0];
  assert.notEqual(room.id, generated);
  assert.match(room.id, /^legacy_room_[A-Za-z0-9_]+$/);
  items.push({ checkKey: "mould_damp_observation", instanceKey: room.id, locationLabel: room.label });
  assert.deepEqual(rentalRoomsFromItems([], items)[0], room);
});

test("legacy room display is deterministic and does not invent a room use or import equipment locations", () => {
  const items = [null, { checkKey: "heater_operation", instanceKey: "heater", locationLabel: "Main living" },
    { checkKey: "mould_damp_observation", instanceKey: "property", locationLabel: "Bedroom 1" },
    { checkKey: "artificial_lighting", instanceKey: "property", locationLabel: "Bedroom 2" },
    { checkKey: "habitable_daylight", instanceKey: "unsafe:identifier", locationLabel: "Bedroom 3" }];
  const rooms = rentalRoomsFromItems(null, items);
  assert.equal(rooms.length, 3);
  assert.ok(rooms.every((room) => /^[A-Za-z0-9_-]{1,120}$/.test(room.id) && room.type === "other"));
  assert.equal(new Set(rooms.map((room) => room.id)).size, 3);
  assert.deepEqual(rentalRoomsFromItems(null, items), rooms);
  assert.deepEqual(rentalRoomsFromItems([null, { ...bedroom, type: "made_up" }], []), []);
});

test("clear room observations need no photos but defects require actual overview and detail evidence", () => {
  for (const key of ["mould_damp_observation", "structure_weatherproofing", "artificial_lighting", "habitable_daylight"]) {
    const check = { key, requiredEvidenceCount: 1, credentialGate: "assigned_assessor" };
    assert.equal(rentalAssessorEvidenceRequirement(check, "meets").minimumFiles, 0);
    assert.equal(rentalAssessorEvidenceRequirement(check, "meets").minimumPhotos, 0);
    assert.equal(rentalAssessorEvidenceRequirement(check, "does_not_meet").minimumFiles, 2);
    assert.equal(rentalAssessorEvidenceRequirement(check, "does_not_meet").minimumPhotos, 2);
  }
  assert.equal(rentalAssessorEvidenceRequirement({ key: "unknown", requiredEvidenceCount: 4 }, "does_not_meet").minimumFiles, 4);
});

test("inaccessible or unverified observations do not demand impossible photographs or imply a pass", () => {
  for (const outcome of ["not_accessible", "specialist_verification_required", "exemption_evidence_pending", "not_assessed"]) {
    const requirement = rentalAssessorEvidenceRequirement({ key: "ceiling_2027_readiness", requiredEvidenceCount: 1 }, outcome);
    assert.equal(requirement.minimumFiles, 0);
    assert.equal(requirement.minimumPhotos, 0);
  }
  assert.equal(rentalAssessorEvidenceRequirement({ key: "oven_function" }, "not_applicable").minimumPhotos, 0);
});

test("positive equipment evidence and specialist test proof survive the ordinary observation exception", () => {
  assert.equal(rentalAssessorEvidenceRequirement({ key: "main_living_heater" }, "meets").minimumPhotos, 1);
  assert.equal(rentalAssessorEvidenceRequirement({ key: "ceiling_2027_readiness" }, "meets").minimumPhotos, 1);
  const licensed = rentalAssessorEvidenceRequirement({ key: "artificial_lighting", credentialGate: "licensed_electrician", requiredEvidenceCount: 2 }, "meets");
  assert.equal(licensed.minimumFiles, 2);
  assert.equal(licensed.minimumPhotos, 0, "A valid test document can be the proof");
  assert.equal(rentalAssessorEvidenceRequirement({ key: "artificial_lighting", responseType: "test_result" }, "meets").minimumFiles, 1);
  assert.equal(rentalAssessorEvidenceRequirement({ key: "unknown", requiredEvidenceCount: 3 }, "meets").minimumFiles, 3);
  assert.equal(rentalAssessorEvidenceRequirement({ key: "room_ventilation", requiredEvidenceCount: 1 }, "meets").minimumFiles, 1);
});

test("plain mould and damage labels preserve saved outcome direction", () => {
  for (const [key, clear, adverse] of [
    ["mould_damp_observation", "No mould or damp seen", "Mould or damp seen"],
    ["structure_weatherproofing", "No visible issue seen", "Visible issue needs attention"],
  ]) {
    const options = rentalAssessorCheckPresentation({ key }).outcomeOptions;
    assert.equal(options.find((option) => option.value === "meets").label, clear);
    assert.equal(options.find((option) => option.value === "does_not_meet").label, adverse);
    assert.deepEqual(options.map((option) => option.value), [...RENTAL_ASSESSMENT_OUTCOMES]);
  }
});

test("plain ventilation cannot turn a working fan into a verified compliance result", () => {
  const view = rentalAssessorCheckPresentation({ key: "room_ventilation" });
  assert.match(view.help, /working fan or opening window does not by itself prove/);
  assert.match(view.outcomeOptions.find((option) => option.value === "meets").label, /verified with evidence/);
  assert.equal(view.outcomeOptions.find((option) => option.value === "specialist_verification_required").label, "Needs ventilation verification");
});

test("the full assessment keeps 24 current and eight future checks with their original legal help and outcomes", () => {
  const checks = rentalAssessmentTemplateSnapshot(["minimum_standards"]).modules.minimum_standards.sections.flatMap((section) => section.checks);
  assert.equal(checks.length, 32);
  const views = checks.map((check) => rentalAssessorCheckPresentation(check));
  assert.equal(views.filter((view) => view.phaseLabel === "Current requirement").length, 24);
  assert.equal(views.filter((view) => view.phaseLabel === "2027 readiness").length, 8);
  for (let index = 0; index < checks.length; index++) {
    assert.ok(views[index].prompt && views[index].help);
    assert.deepEqual(views[index].outcomeOptions.map((option) => option.value), [...RENTAL_ASSESSMENT_OUTCOMES]);
    if (checks[index].assessmentPhase === "energy_readiness_2027") assert.equal(views[index].help, checks[index].help);
  }
  const ceiling = views[checks.findIndex((check) => check.key === "ceiling_2027_readiness")];
  assert.match(ceiling.prompt, /insulation present throughout this accessible ceiling area/i);
  assert.match(ceiling.help, /Existing insulation need not be upgraded/);
  assert.equal(rentalAssessorCheckPresentation({ key: "unknown", prompt: "Preserved specialist question", help: "Preserved legal basis" }).help, "Preserved legal basis");
});
