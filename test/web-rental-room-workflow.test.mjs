import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as quotation from "../src/lib/rental-quotation.mjs";
import * as assessment from "../src/lib/trade-rental-assessment.mjs";
import * as workflowHelpers from "../src/lib/rental-assessor-workflow.mjs";

const source = readFileSync(new URL("../src/components/TradeRentalInspectionPanel.tsx", import.meta.url), "utf8");
const exposed = source.replace(/function (assessmentGroups|groupItems|RoomRosterForm|AssessmentItemCard)\(/g, "export function $1(");
const compiled = ts.transpileModule(exposed, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const output = { exports: {} };
const dependencies = {
  react: React, "react/jsx-runtime": jsxRuntime,
  "@/lib/rental-quotation.mjs": quotation,
  "@/lib/trade-rental-assessment.mjs": assessment,
  "@/lib/rental-assessor-workflow.mjs": workflowHelpers,
  "./TradeRentalInspectionPanel.module.css": { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) },
};
new Function("require", "module", "exports", compiled)((id) => {
  assert.ok(id in dependencies, `Unexpected dependency ${id}`);
  return dependencies[id];
}, output, output.exports);
const { assessmentGroups, groupItems, RoomRosterForm, AssessmentItemCard } = output.exports;
const template = assessment.rentalAssessmentTemplateSnapshot(["minimum_standards"]).modules.minimum_standards;
const bedroom = { id: "room-bedroom", label: "Bedroom 1", type: "bedroom" };
const bathroom = { id: "room-bathroom", label: "Bathroom 1", type: "bathroom" };
const assessmentModule = (rooms = [bedroom, bathroom]) => ({
  id: "module", key: "minimum_standards", template, answers: { roomRoster: rooms }, revision: 1, status: "draft",
});
const item = (checkKey, room = bedroom, extra = {}) => ({
  id: `saved-${room.id}-${checkKey}`, moduleId: "module", itemKey: `${room.id}-${checkKey}`, sectionKey: workflowHelpers.RENTAL_ROOM_CHECKS.find((entry) => entry.checkKey === checkKey)?.sectionKey || "heating",
  checkKey, instanceKey: room.id, locationLabel: room.label, outcome: "meets", response: {}, publicNotes: "", internalNotes: "", revision: 1, requiredEvidenceCount: 1, sortOrder: 0, ...extra,
});
function renderCard(group, entry, outcome = "meets") {
  const cardItem = item(entry.check.key, group.room || bedroom, { sectionKey: entry.section.key, outcome });
  return renderToStaticMarkup(React.createElement(AssessmentItemCard, {
    module: assessmentModule(), section: entry.section, check: entry.check, item: cardItem, roomLabel: group.room?.label,
    evidence: [], observationCandidates: [], busy: "", readOnly: false,
    onSave() {}, onUpload() {}, onUnlink() {}, onDirtyChange() {}, onRegisterDraft() {}, onObservationChange() {},
  }));
}

test("web rooms reuse one identity across the applicable checks while retaining every full assessment check", () => {
  const workflow = assessmentGroups(assessmentModule(), []);
  const bedroomGroup = workflow.groups.find((group) => group.room?.id === bedroom.id);
  const bathroomGroup = workflow.groups.find((group) => group.room?.id === bathroom.id);
  assert.deepEqual(bedroomGroup.entries.map((entry) => entry.check.key), workflowHelpers.RENTAL_ROOM_CHECKS.map((entry) => entry.checkKey));
  assert.ok(!bathroomGroup.entries.some((entry) => entry.check.key === "habitable_daylight"));
  assert.equal(workflow.rooms.length, 2);
  assert.deepEqual(new Set(workflow.groups.flatMap((group) => group.entries.map((entry) => entry.check.key))),
    new Set(template.sections.flatMap((section) => section.checks.map((check) => check.key))));
  for (const entry of bedroomGroup.entries) {
    const markup = renderCard(bedroomGroup, entry);
    assert.match(markup, /<input type="hidden" name="locationLabel" value="Bedroom 1"/);
    assert.doesNotMatch(markup, /Exact location|Repeatable check|placeholder="For example, Bedroom 2 north window"/);
    assert.match(markup, new RegExp(workflowHelpers.rentalAssessorCheckPresentation(entry.check).prompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("a clear mould or visible damage observation needs no compulsory photo or repeated location entry", () => {
  const group = assessmentGroups(assessmentModule(), []).groups[0];
  for (const checkKey of ["mould_damp_observation", "structure_weatherproofing"]) {
    const entry = group.entries.find((candidate) => candidate.check.key === checkKey);
    const clear = renderCard(group, entry);
    assert.match(clear, /Photos are optional for this answer/);
    assert.match(clear, /0 optional files/);
    assert.doesNotMatch(clear, /of [12] required|Include an overview and close photo/);
    const defect = renderCard(group, entry, "does_not_meet");
    assert.match(defect, /0 of 2 required photos/);
    assert.match(defect, /Include an overview and close photo/);
    const inaccessible = renderCard(group, entry, "not_accessible");
    assert.match(inaccessible, /0 optional files/);
    assert.doesNotMatch(inaccessible, /of 2 required photos|Include an overview and close photo/);
  }
});

test("room answers do not inherit another room's outcome or hide ambiguous historical observations", () => {
  const saved = item("artificial_lighting", bedroom);
  const workflow = assessmentGroups(assessmentModule(), [saved]);
  const otherRoom = workflow.groups.find((group) => group.room?.id === bathroom.id);
  const light = otherRoom.entries.find((entry) => entry.check.key === "artificial_lighting");
  assert.deepEqual(groupItems(otherRoom, light.section, light.check, [saved]), []);

  const first = item("mould_damp_observation", bedroom, { id: "legacy-one", instanceKey: "legacy-first" });
  const duplicate = item("mould_damp_observation", bedroom, { id: "legacy-two", instanceKey: "legacy-second", outcome: "does_not_meet" });
  const legacy = assessmentGroups(assessmentModule([]), [first, duplicate]);
  const reachable = legacy.groups.flatMap((group) => group.entries.flatMap(({ section, check }) => groupItems(group, section, check, [first, duplicate])));
  assert.deepEqual(new Set(reachable.map((entry) => entry.id)), new Set(["legacy-one", "legacy-two"]));
  assert.ok(legacy.groups.some((group) => group.retainedItems?.length));
  assert.equal(reachable.find((entry) => entry.id === "legacy-two").outcome, "does_not_meet");
});

test("legacy first-instance IDs cannot attach a different room's observation to the active room", () => {
  const lighting = item("artificial_lighting", bedroom, { id: "light-bedroom", instanceKey: "first" });
  const mould = item("mould_damp_observation", bathroom, { id: "mould-bathroom", instanceKey: "first", outcome: "does_not_meet" });
  const saved = [lighting, mould];
  const workflow = assessmentGroups(assessmentModule([]), saved);
  const bedroomGroup = workflow.groups.find((group) => group.room?.label === bedroom.label);
  const entry = bedroomGroup.entries.find((candidate) => candidate.check.key === "mould_damp_observation");
  assert.deepEqual(groupItems(bedroomGroup, entry.section, entry.check, saved), []);
  const bathroomGroup = workflow.groups.find((group) => group.room?.label === bathroom.label);
  const ownEntry = bathroomGroup.entries.find((candidate) => candidate.check.key === "mould_damp_observation");
  assert.deepEqual(groupItems(bathroomGroup, ownEntry.section, ownEntry.check, saved).map((result) => result.id), [mould.id]);
});

test("new assessments without a roster open safely and historical narrow or licensed forms keep their actual sections", () => {
  assert.deepEqual(assessmentGroups({ ...assessmentModule(), answers: {} }, []).rooms, []);
  const oldTemplate = assessment.rentalAssessmentTemplateSnapshot(["minimum_standards"], "energy_readiness_2027").modules.minimum_standards;
  const historical = assessmentGroups({ ...assessmentModule(), template: oldTemplate, answers: {} }, []);
  assert.equal(historical.usesRooms, false);
  assert.deepEqual(historical.groups.map((group) => group.key), oldTemplate.sections.map((section) => section.key));
  const electrical = assessment.rentalAssessmentTemplateSnapshot(["electrical_safety_check"]).modules.electrical_safety_check;
  const safety = assessmentGroups({ ...assessmentModule(), key: "electrical_safety_check", template: electrical }, []);
  assert.equal(safety.usesRooms, false);
  assert.deepEqual(safety.groups.flatMap((group) => group.entries.map((entry) => entry.check.key)), electrical.sections.flatMap((section) => section.checks.map((check) => check.key)));
});

test("room setup labels its controls, supports confirming legacy room use and protects rooms with saved observations", () => {
  const markup = renderToStaticMarkup(React.createElement(RoomRosterForm, {
    rooms: [bedroom, bathroom], roomTypes: workflowHelpers.RENTAL_ROOM_TYPES,
    lockedRoomIds: new Set([bedroom.id]), busy: false, readOnly: false, onSave() {},
  }));
  assert.match(markup, /Room use for Bedroom 1/);
  assert.match(markup, /name="roomType"/);
  assert.equal((markup.match(/name="roomLabel"/g) || []).length, 1);
  assert.doesNotMatch(markup, /aria-label="Remove Bedroom 1"/);
  assert.match(markup, /aria-label="Remove Bathroom 1"/);
  assert.match(markup, /Names are generated automatically/);
  const earlier = renderToStaticMarkup(React.createElement(RoomRosterForm, {
    rooms: [bedroom], roomTypes: workflowHelpers.RENTAL_ROOM_TYPES, needsConfirmation: true,
    lockedRoomIds: new Set([bedroom.id]), busy: false, readOnly: false, onSave() {},
  }));
  assert.match(earlier, /Confirm room list/);
  assert.match(earlier, /These rooms come from earlier observations/);
});

test("new mobile rental jobs request the single full form while retaining separate safety services", () => {
  const mobile = readFileSync(new URL("../mobile/src/app/new-job.tsx", import.meta.url), "utf8");
  assert.match(mobile, /rentalAssessmentScope: 'current_minimum_standards'/);
  assert.doesNotMatch(mobile, /Rental assessment scope|setRentalAssessmentScope|energy_readiness_2027/);
  assert.match(mobile, /electrical_safety_check/);
  assert.match(mobile, /gas_safety_check/);
});
