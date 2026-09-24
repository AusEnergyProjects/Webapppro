import assert from "node:assert/strict";
import test from "node:test";
import {
  editorFormPages, addEditorPage, addEditorPageQuestion, moveEditorQuestion, renameEditorPage, deleteEditorPage,
  editorQuestionDeleteReason, editorPageDeleteReason, editorPageRenameReason, editorQuestionMoveReason,
} from "../src/lib/creditex-form-pages.ts";
import { activityWizardPages } from "../src/lib/trade-activity-form-flow.ts";
import { activityFieldWorkerForm } from "../src/lib/trade-activity-field-policy.ts";
import { applyDefaultActivityFormPolicy, defaultActivityFieldForm } from "../src/lib/trade-activity-forms-library.ts";

const field = (key, section = "Page A", extra = {}) => ({ key, section, label: key, type: "text", required: false, options: [], help: "", phase: "before", ...extra });
const form = (fields, declarations = []) => ({ id: "test", title: "Test", activityTemplateId: "test", programCode: "TEST", version: 1,
  variantId: "", variantOptions: [], fields, declarations, sources: [], reviewNotes: [] });
const keys = value => value.fields.map(item => item.key);
const pages = value => editorFormPages(value).map(page => ({ key: page.key, keys: page.fieldKeys, section: page.section, phase: page.phase, repeatGroup: page.repeatGroup }));

test("editor pages use actual worker visibility, potential conditions, repeat boundaries and the eight-question limit", () => {
  const original = form([
    field("custom.hidden", "Hidden", { presentation: "derived" }),
    field("custom.profile", "Hidden", { autofill: "job.assignee.fullName" }),
    ...Array.from({ length: 9 }, (_, index) => field(`custom.q${index}`, "Long page", index === 2 ? { condition: { fieldKey: "custom.q0", equals: "yes" } } : {})),
    field("custom.repeated", "Long page", { repeatGroup: "systems" }),
    field("custom.other-repeat", "Long page", { repeatGroup: "rooms" }),
    field("custom.after", "Long page", { phase: "after" }),
  ], [{ key: "sign", title: "Sign", text: "Agree", phase: "before", role: "customer", required: true }]);
  const before = structuredClone(original);
  const projection = activityFieldWorkerForm(original);
  const expected = activityWizardPages({ ...projection, fields: projection.fields.map(item => ({ ...item, condition: undefined })) }, {}).filter(page => page.kind === "fields");
  assert.deepEqual(editorFormPages(original).map(page => page.fieldKeys), expected.map(page => page.fields.map(item => item.baseKey)));
  assert.deepEqual(editorFormPages(original).map(page => page.fieldKeys.length), [8, 1, 1, 1, 1]);
  assert.equal(editorFormPages(original)[0].key, "custom.q0");
  assert.deepEqual(editorFormPages(original).slice(2).map(page => page.repeatGroup), ["systems", "rooms", undefined]);
  assert.deepEqual(original, before);
});

test("new pages follow the whole selected section and keep the selected stage without inheriting repetition", () => {
  const original = form([
    ...Array.from({ length: 9 }, (_, index) => field(`custom.q${index}`, "Long page", { repeatGroup: "systems" })),
    field("custom.next", "New page 1"), field("custom.after", "After", { phase: "after" }),
  ]);
  const result = addEditorPage(original, "custom.q0");
  const added = result.form.fields.find(item => item.key === result.selectedFieldKey);
  assert.equal(added.section, "New page 2"); assert.equal(added.phase, "before"); assert.equal(added.repeatGroup, undefined);
  assert.equal(added.required, false); assert.equal(added.type, "text"); assert.match(added.key, /^custom\.[0-9a-f-]{36}$/);
  assert.equal(keys(result.form).indexOf(added.key), 9);
  assert.deepEqual(keys(result.form).filter(key => key !== added.key), keys(original));
  const final = addEditorPage(result.form);
  assert.equal(final.form.fields.at(-1).phase, "after");
  assert.throws(() => addEditorPage(original, "missing"), /no longer available/);
});

test("adding questions uses the target page section, phase and repeat group and refuses a full page", () => {
  const original = form([field("custom.a", "Machines", { phase: "after", repeatGroup: "machines" }),
    field("custom.b", "Machines", { phase: "after", repeatGroup: "machines" }), field("custom.next", "Next", { phase: "after" })]);
  const result = addEditorPageQuestion(original, "custom.a");
  const added = result.form.fields.find(item => item.key === result.selectedFieldKey);
  assert.deepEqual([added.section, added.phase, added.repeatGroup], ["Machines", "after", "machines"]);
  assert.deepEqual(keys(result.form), ["custom.a", "custom.b", added.key, "custom.next"]);
  const full = form(Array.from({ length: 8 }, (_, index) => field(`custom.${index}`)));
  assert.throws(() => addEditorPageQuestion(full, "custom.0"), /8 questions/);
});

test("moving a question preserves every key and reference while appending within a compatible page", () => {
  const original = form([field("custom.a"), field("custom.b"), field("custom.c", "Page B"),
    field("custom.d", "Page C", { condition: { all: [{ fieldKey: "custom.a", equals: "yes" }] } })]);
  const result = moveEditorQuestion(original, "custom.a", "custom.c");
  assert.deepEqual(keys(result.form), ["custom.b", "custom.c", "custom.a", "custom.d"]);
  assert.deepEqual([...keys(result.form)].sort(), [...keys(original)].sort());
  assert.equal(result.form.fields.find(item => item.key === "custom.a").section, "Page B");
  assert.deepEqual(result.form.fields.at(-1).condition, original.fields.at(-1).condition);
  assert.equal(result.selectedFieldKey, "custom.a");
  assert.equal(moveEditorQuestion(original, "custom.a", "custom.a").form, original);
  const other = form([field("custom.a"), field("custom.b", "After", { phase: "after" }), field("custom.c", "Repeat", { repeatGroup: "rooms" })]);
  assert.match(editorQuestionMoveReason(other, "custom.a", "custom.b"), /same before-work or after-work/);
  assert.throws(() => moveEditorQuestion(other, "custom.a", "custom.c"), /same repeated item/);
  const full = form([field("custom.a", "Source"), ...Array.from({ length: 8 }, (_, index) => field(`custom.${index}`))]);
  assert.match(editorQuestionMoveReason(full, "custom.a", "custom.0"), /8 questions/);
});

test("section dependency cycles are rejected even when the individual question graph is acyclic", () => {
  const original = form([field("custom.a", "A"), field("custom.b", "A"),
    field("custom.c", "B", { condition: { fieldKey: "custom.a", equals: "yes" } }),
    field("custom.d", "C", { condition: { fieldKey: "custom.c", equals: "yes" } })]);
  assert.match(editorQuestionMoveReason(original, "custom.d", "custom.a"), /loop/);
  assert.throws(() => moveEditorQuestion(original, "custom.d", "custom.a"), /loop/);
  assert.deepEqual(keys(original), ["custom.a", "custom.b", "custom.c", "custom.d"]);
});

test("repeated questions move only within the same item group and page-boundary reflow is explicit", () => {
  const original = form([field("custom.a", "First", { repeatGroup: "machines" }),
    field("custom.b", "Second", { repeatGroup: "machines" })]);
  const moved = moveEditorQuestion(original, "custom.a", "custom.b");
  assert.deepEqual(editorFormPages(moved.form)[0].fieldKeys, ["custom.b", "custom.a"]);
  assert.equal(moved.form.fields[1].repeatGroup, "machines");
  const long = form(Array.from({ length: 9 }, (_, index) => field(`custom.${index}`)));
  assert.match(editorQuestionMoveReason(long, "custom.0", "custom.8"), /page boundary/);
  assert.throws(() => moveEditorQuestion(long, "custom.0", "custom.8"), /section name first/);
  const separate = renameEditorPage(long, "custom.8", "Separate destination");
  assert.deepEqual(editorFormPages(moveEditorQuestion(separate.form, "custom.0", "custom.8").form).at(-1).fieldKeys, ["custom.8", "custom.0"]);
});

test("page names are trimmed, bounded, unique within the stage and preserve all question keys and order", () => {
  const original = form([field("custom.a"), field("custom.b"), field("custom.c", "Page B"), field("custom.after", "Later", { phase: "after" })]);
  const result = renameEditorPage(original, "custom.a", "  Site checks  ");
  assert.deepEqual(keys(result.form), keys(original)); assert.equal(result.selectedFieldKey, "custom.a");
  assert.deepEqual(result.form.fields.map(item => item.section), ["Site checks", "Site checks", "Page B", "Later"]);
  assert.throws(() => renameEditorPage(original, "custom.a", " page b "), /unique page name/);
  for (const title of [" ", "x".repeat(161)]) assert.throws(() => renameEditorPage(original, "custom.a", title), /1 and 160/);
  assert.doesNotThrow(() => renameEditorPage(original, "custom.a", "Later"));
});

test("dependency sorting cannot silently change a destination in a section spanning multiple screens", () => {
  const original = form([field("custom.a", "Review A"),
    ...Array.from({ length: 9 }, (_, index) => field(`custom.b${index}`, "Review B",
      index === 0 ? { condition: { fieldKey: "custom.a", equals: "yes" } } : {}))]);
  assert.match(editorQuestionMoveReason(original, "custom.a", "custom.b8"), /own section name first/);
  assert.throws(() => moveEditorQuestion(original, "custom.a", "custom.b8"), /saving cannot regroup/);
  // A dedicated destination has at most eight fields. Topological ordering may
  // reorder its questions, but it cannot split them into different screens.
  const separate = renameEditorPage(original, "custom.b8", "Review C");
  const moved = moveEditorQuestion(separate.form, "custom.a", "custom.b8");
  const persisted = applyDefaultActivityFormPolicy(moved.form, original);
  assert.deepEqual(new Set(editorFormPages(persisted).find(page => page.fieldKeys.includes("custom.a")).fieldKeys), new Set(["custom.b8", "custom.a"]));
  const mixed = form([field("custom.b0", "Mixed"), field("custom.b1", "Mixed"),
    field("custom.repeat", "Mixed", { repeatGroup: "machines" }),
    field("custom.a", "Later", { condition: { fieldKey: "custom.repeat", equals: "yes" } })]);
  assert.match(editorQuestionMoveReason(mixed, "custom.a", "custom.b0"), /own section name first/,
    "a repeated unit must not split an ordinary destination during server dependency ordering");
});

test("governed, derived, prefilled, approved-product, required-value and installer-selfie fields are protected", () => {
  for (const special of [
    { sourceRequirementId: "requirement" }, { presentation: "derived" }, { presentation: "prefilled" }, { autofill: "job.assignee.fullName" },
    { approvedProduct: { role: "brand", productKind: "veu_air_conditioner", veuActivityCodes: ["6"] } },
    { requiredValue: false }, { key: "evidence.tlink-installer-id-selfie", type: "photo" },
    { type: "photo", label: "Installer selfie holding licence" },
  ]) {
    const protectedItem = field("custom.protected", "Protected", special), original = form([protectedItem, field("custom.other", "Other")]);
    assert.match(editorQuestionDeleteReason(original, protectedItem.key), /governed evidence or profile/);
    assert.match(editorQuestionMoveReason(original, protectedItem.key, "custom.other"), /cannot move/);
    if (editorFormPages(original).some(page => page.key === protectedItem.key)) {
      assert.match(editorPageRenameReason(original, protectedItem.key), /fixed/);
      assert.throws(() => deleteEditorPage(original, protectedItem.key), /cannot be deleted/);
    }
  }
});

test("deletion checks surviving cross-page question, evidence and declaration dependencies", () => {
  const base = field("binding.name", "Delete me");
  const declaration = extra => ({ key: "signature", phase: "after", role: "customer", title: "Sign", text: "Agree", required: true, ...extra });
  for (const original of [
    form([base, field("custom.other", "Other", { condition: { any: [{ all: [{ fieldKey: base.key, equals: "yes" }] }] } })]),
    form([base, field("custom.other", "Other", { evidenceFor: [base.key] })]),
    form([base, field("custom.other", "Other")], [declaration({ condition: { fieldKey: base.key, equals: "yes" } })]),
    form([base, field("custom.other", "Other")], [declaration({ text: "I confirm {{name}}." })]),
  ]) {
    assert.match(editorQuestionDeleteReason(original, base.key), /reference/);
    assert.match(editorPageDeleteReason(original, base.key), /reference/);
    assert.throws(() => deleteEditorPage(original, base.key), /reference/);
  }
});

test("a whole optional page can be deleted with its internal dependencies; required custom questions are deletable", () => {
  const original = form([field("custom.a", "Delete", { required: true }),
    field("custom.b", "Delete", { condition: { fieldKey: "custom.a", equals: "yes" } }), field("custom.next", "Keep")]);
  assert.match(editorQuestionDeleteReason(original, "custom.a"), /reference/);
  assert.equal(editorPageDeleteReason(original, "custom.a"), "");
  const result = deleteEditorPage(original, "custom.a");
  assert.deepEqual(keys(result.form), ["custom.next"]); assert.equal(result.selectedFieldKey, "custom.next");
  assert.match(editorPageDeleteReason(result.form, "custom.next"), /at least one/);
  assert.match(editorQuestionDeleteReason(result.form, "custom.next"), /at least one/);
});

test("add, move and rename operations retain their pages after real publication policy normalisation", () => {
  const baseline = defaultActivityFieldForm("veu-6");
  const first = addEditorPage(baseline, undefined, "Creditex extra checks");
  const second = addEditorPage(first.form, first.selectedFieldKey, "Creditex follow-up");
  const added = addEditorPageQuestion(first.form, first.selectedFieldKey);
  const combined = { ...second.form, fields: second.form.fields.flatMap(item => item.key === first.selectedFieldKey ? [item, added.form.fields.find(field => field.key === added.selectedFieldKey)] : [item]) };
  const moved = moveEditorQuestion(combined, added.selectedFieldKey, second.selectedFieldKey);
  const renamed = renameEditorPage(moved.form, second.selectedFieldKey, "Final Creditex checks");
  const persisted = applyDefaultActivityFormPolicy(renamed.form, baseline);
  const customPages = value => pages(value).filter(page => page.keys.some(key => [first.selectedFieldKey, second.selectedFieldKey, added.selectedFieldKey].includes(key)));
  assert.deepEqual(customPages(persisted), customPages(renamed.form));
  assert.deepEqual([...keys(persisted)].sort(), [...keys(renamed.form)].sort());
  assert.deepEqual(persisted.declarations, renamed.form.declarations);
});
