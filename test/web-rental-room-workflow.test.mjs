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
const exposed = source.replace(/function (assessmentGroups|groupItems|roomWindowsGroup|localRoomWindow|RoomRosterForm|AssessmentItemCard)\(/g, "export function $1(");
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
const { assessmentGroups, groupItems, roomWindowsGroup, localRoomWindow, RoomRosterForm, AssessmentItemCard } = output.exports;
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

test("web rooms reuse one identity and keep all full assessment checks across rooms, windows and property", () => {
  const windowItem = item("window_operation_security", bedroom, { sectionKey: "windows", instanceKey: "window-1", locationLabel: "Bedroom 1 - Window 1", response: { roomId: bedroom.id } });
  const workflow = assessmentGroups(assessmentModule(), [windowItem]);
  const bedroomGroup = workflow.groups.find((group) => group.room?.id === bedroom.id);
  const bathroomGroup = workflow.groups.find((group) => group.room?.id === bathroom.id);
  assert.deepEqual(bedroomGroup.entries.map((entry) => entry.check.key), workflowHelpers.RENTAL_ROOM_CHECKS.map((entry) => entry.checkKey));
  assert.ok(!bathroomGroup.entries.some((entry) => entry.check.key === "habitable_daylight"));
  assert.equal(workflow.rooms.length, 2);
  assert.deepEqual(new Set([...workflow.groups, ...workflow.windowGroups].flatMap((group) => group.entries.map((entry) => entry.check.key))),
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

test("each named window groups its own four checks without duplicating them in property sections", () => {
  const first = item("window_operation_security", bedroom, { id: "window-one", sectionKey: "windows", instanceKey: "window-one", locationLabel: "Bedroom 1 - Window 1", response: { roomId: bedroom.id } });
  const second = item("window_operation_security", bedroom, { id: "window-two", sectionKey: "windows", instanceKey: "window-two", locationLabel: "Bedroom 1 - Window 2", response: { roomId: bedroom.id } });
  const covering = item("window_covering", bedroom, { id: "covering-one", sectionKey: "window_coverings", instanceKey: "window-one", locationLabel: first.locationLabel, outcome: "does_not_meet", response: { roomId: bedroom.id } });
  const unrelated = item("window_covering", bedroom, { id: "earlier-covering", sectionKey: "window_coverings", instanceKey: "unmatched", locationLabel: "North upstairs window" });
  const saved = [first, second, covering, unrelated];
  const workflow = assessmentGroups(assessmentModule(), saved);
  assert.equal(workflow.windowGroups.length, 2);
  for (const group of workflow.windowGroups) {
    assert.deepEqual(group.entries.map(({ check }) => check.key), workflowHelpers.RENTAL_WINDOW_CHECKS.map((check) => check.checkKey));
    assert.equal(group.title, group.windowItem.locationLabel);
  }
  const firstGroup = roomWindowsGroup(assessmentModule(), bedroom, first);
  const secondGroup = roomWindowsGroup(assessmentModule(), bedroom, second);
  const entry = firstGroup.entries.find(({ check }) => check.key === "window_covering");
  assert.deepEqual(groupItems(firstGroup, entry.section, entry.check, saved).map((answer) => answer.id), [covering.id]);
  assert.deepEqual(groupItems(secondGroup, entry.section, entry.check, saved), []);
  const ordinary = workflow.groups.filter((group) => !group.retainedItems);
  assert.ok(!ordinary.some((group) => group.entries.some(({ check }) => workflowHelpers.RENTAL_WINDOW_CHECKS.some((windowCheck) => windowCheck.checkKey === check.key))));
  const reachableEarlier = workflow.groups.flatMap((group) => group.entries.flatMap(({ section, check }) => groupItems(group, section, check, saved)));
  assert.ok(reachableEarlier.some((answer) => answer.id === unrelated.id));
  assert.ok(!reachableEarlier.some((answer) => answer.id === covering.id));
});

test("adding another room window creates a new identity and numbered location without renaming saved windows", () => {
  const section = template.sections.find((entry) => entry.key === "windows");
  const check = section.checks.find((entry) => entry.key === "window_operation_security");
  const earlier = item(check.key, bedroom, { sectionKey: section.key, instanceKey: "legacy", locationLabel: bedroom.label });
  const first = localRoomWindow(assessmentModule(), section, check, bedroom, [earlier]);
  const second = localRoomWindow(assessmentModule(), section, check, bedroom, [earlier, first]);
  assert.equal(first.locationLabel, "Bedroom 1 - Window 1");
  assert.equal(second.locationLabel, "Bedroom 1 - Window 2");
  assert.notEqual(first.instanceKey, second.instanceKey);
  assert.deepEqual(first.response, { roomId: bedroom.id });
  assert.equal(earlier.locationLabel, bedroom.label);
  assert.equal(earlier.instanceKey, "legacy");
});

function renderWindowCard(checkKey, extra = {}) {
  const section = template.sections.find((entry) => entry.checks.some((check) => check.key === checkKey));
  const check = section.checks.find((entry) => entry.key === checkKey);
  return renderToStaticMarkup(React.createElement(AssessmentItemCard, {
    module: assessmentModule(), section, check,
    item: item(checkKey, bedroom, { sectionKey: section.key, instanceKey: "window-one", locationLabel: "Bedroom 1 - Window 1", ...extra }),
    roomLabel: "Bedroom 1 - Window 1", evidence: [], observationCandidates: [], busy: "", readOnly: false,
    onSave() {}, onUpload() {}, onUnlink() {}, onDirtyChange() {}, onRegisterDraft() {}, onObservationChange() {},
  }));
}

test("window operation uses four plain answers and records fixed glazing without another required text field", () => {
  const ordinary = renderWindowCard("window_operation_security");
  assert.equal((ordinary.match(/type="radio"/g) || []).length, 4);
  assert.match(ordinary, /Does this window open and close properly\?/);
  assert.doesNotMatch(ordinary, /Needs verification|Possible exception|Exact location/);
  const patch = workflowHelpers.rentalAssessorOutcomePatch("window_operation_security", "not_applicable");
  const fixed = renderWindowCard("window_operation_security", patch);
  assert.match(fixed, /name="publicNotes" value="Fixed glazing; this window is not designed to open\."/);
  assert.doesNotMatch(fixed, /textarea name="publicNotes"|Explain why this standard/);
  const legacy = renderWindowCard("window_operation_security", { outcome: "not_applicable", publicNotes: "No window in this location." });
  assert.match(legacy, /Does not apply \(saved answer\)/);
  assert.match(legacy, /No window in this location/);
  const specialist = renderWindowCard("window_operation_security", { outcome: "specialist_verification_required" });
  assert.match(specialist, /Needs verification/);
  assert.equal((specialist.match(/type="radio"/g) || []).length, 5);
});

test("successful window covering and draught checks hide measurement inputs even when earlier measurements exist", () => {
  for (const checkKey of ["window_covering", "windows_2027_readiness"]) {
    const response = { widthMm: "2400", heightMm: "1200", sealLengthMetres: "7.2" };
    const clear = renderWindowCard(checkKey, { response });
    assert.doesNotMatch(clear, /name="widthMm"|name="heightMm"|name="sealLengthMetres"/);
    assert.match(clear, /type="hidden" name="locationLabel" value="Bedroom 1 - Window 1"/);
    const defect = renderWindowCard(checkKey, { response, outcome: "does_not_meet" });
    assert.match(defect, /name="widthMm"[^>]*value="2400"/);
    assert.match(defect, /name="heightMm"[^>]*value="1200"/);
  }
});

test("the real window shortcut saves dirty room answers before creating or opening a window", async () => {
  const start = source.indexOf("  async function openRoomWindows(");
  const end = source.indexOf("\n  function returnToSectionOverview", start);
  const navigateCode = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls = [];
  let finishSave;
  let local = {};
  const environment = {
    activeModule: assessmentModule(), windowCandidates: [], dirtyItems: new Set(["changed-room-answer"]),
    rentalRoomWindowItems: workflowHelpers.rentalRoomWindowItems, localRoomWindow,
    setLocalItems: (update) => { local = update(local); calls.push("created"); },
    setActiveWindowInstanceKey: () => calls.push("selected-window"), setActiveSectionKey: (key) => calls.push(key),
    window: { scrollTo() {} },
    saveSectionAndContinue: (afterSave) => new Promise((resolve) => { calls.push("save-first"); finishSave = () => { afterSave(); resolve(); }; }),
  };
  const open = new Function(...Object.keys(environment), `${navigateCode}; return openRoomWindows;`)(...Object.values(environment));
  const opening = open(bedroom);
  assert.deepEqual(calls, ["save-first"]);
  assert.deepEqual(local, {});
  finishSave();
  await opening;
  assert.deepEqual(calls, ["save-first", "created", "selected-window", `windows:${bedroom.id}`]);
  assert.equal(Object.values(local).flat()[0].locationLabel, "Bedroom 1 - Window 1");
});
