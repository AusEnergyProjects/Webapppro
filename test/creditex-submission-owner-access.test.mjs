import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const source = readFileSync(new URL("../src/components/CreditexCompliancePortal.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("CreditexCompliancePortal.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const endpointStatements = [];
let workspaceElement;
function visit(node) {
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration =>
    ["usePlatformSubmissionAccess", "registryEndpoint", "outputEndpoint"].includes(declaration.name.getText(ast)))) {
    endpointStatements.push(node.getText(ast));
  }
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "CreditexRegistryWorkspace") workspaceElement = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(endpointStatements.length, 3);
assert.ok(workspaceElement, "The test must render the actual submissions workspace props.");
const compiled = ts.transpileModule(`export function render(session, api) {
  ${endpointStatements.join("\n")}
  return (${workspaceElement.getText(ast)});
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exports = {};
Function("require", "exports", "CreditexRegistryWorkspace", "CreditexOutputActions", compiled)(
  name => { assert.equal(name, "react/jsx-runtime"); return jsx; }, exports, "registry-workspace", "output-actions",
);

const owner = Object.freeze({ email: "info@ausenergyassessments.com", displayName: "James Morris", role: "admin",
  namedOwnerConfirmed: true, governanceIdentityVerified: false, organisation: { code: "CREDITEX-AU" } });
const api = () => { throw new Error("Rendering submission controls must not send a request."); };

function assertEndpoints(session, registryEndpoint, outputEndpoint) {
  const tree = exports.render(session, api);
  assert.equal(tree.type, "registry-workspace");
  assert.equal(tree.props.api, api);
  assert.equal(tree.props.endpoint, registryEndpoint);
  assert.equal(tree.props.outputEndpoint, outputEndpoint);
  assert.equal(tree.props.children.type, "output-actions");
  assert.equal(tree.props.children.props.api, api);
  assert.equal(tree.props.children.props.endpoint, outputEndpoint, "Registry and claim preparation must use the same server-verified actor.");
  return tree;
}

test("the confirmed Creditex owner uses existing platform submission access without changing governance identity", () => {
  const tree = assertEndpoints(owner, "/api/admin/compliance-registry", "/api/admin/compliance-output-actions");
  assert.equal(tree.props.children.props.contextLabel, "Australian Energy Assessments administration");
  assert.equal(owner.governanceIdentityVerified, false);
});

test("ordinary and unconfirmed members retain compliance endpoints even when their name or email matches", () => {
  for (const patch of [{ namedOwnerConfirmed: false }, { namedOwnerConfirmed: undefined },
    { namedOwnerConfirmed: "true" }, { role: "reviewer" }, { role: "case_manager" }, { role: "auditor" },
    { organisation: { code: "OTHER" } }]) {
    const tree = assertEndpoints({ ...owner, ...patch }, "/api/creditex/registry", "/api/creditex/output-actions");
    assert.equal(tree.props.children.props.contextLabel, "Creditex compliance");
  }
});
