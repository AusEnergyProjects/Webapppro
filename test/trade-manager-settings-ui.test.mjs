import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile("TradeBusinessSettingsWorkspace.tsx", readFileSync(new URL("../src/components/TradeBusinessSettingsWorkspace.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let save;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "saveSettings") save = node;
  ts.forEachChild(node, visit);
}
visit(source);
const compiled = ts.transpileModule(save.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test("manager form saves only its name and refreshes the welcome from the successful server result", async () => {
  for (const succeeds of [true, false]) {
    const changes = [], greetings = [], statuses = [], requests = [];
    const bindings = {
      managerName: " James   Morris ", validateSettings: () => "", setSaveSection() {}, setSaveBusy() {}, setSaveStatus: value => statuses.push(value),
      user: { getIdToken: async () => "test-identity" },
      fetch: async (url, init) => { requests.push([url, init]); return Response.json(succeeds ? { ok: true, settings: { managerName: "James Morris" } } : { ok: false, error: "Could not save." }, { status: succeeds ? 200 : 503 }); },
      onProfileChange: value => changes.push(value), setManagerName() {}, updatePersonalName: value => greetings.push(value), statusMessage: error => error.message,
    };
    const submit = Function(...Object.keys(bindings), `${compiled}\nreturn saveSettings;`)(...Object.values(bindings));
    await submit({ preventDefault() {}, currentTarget: { dataset: { settingsSection: "manager" } } });
    assert.equal(requests.length, 1);
    assert.equal(requests[0][0], "/api/trade-profile");
    assert.equal(requests[0][1].method, "PATCH");
    assert.deepEqual(JSON.parse(requests[0][1].body), { managerName: "James   Morris" });
    assert.deepEqual(changes, succeeds ? [{ managerName: "James Morris" }] : []);
    assert.deepEqual(greetings, succeeds ? ["James Morris"] : []);
    assert.equal(statuses.at(-1), succeeds ? "Business settings saved." : "Could not save.");
  }
});
