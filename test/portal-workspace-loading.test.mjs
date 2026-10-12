import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const read = name => fs.readFileSync(new URL(`../src/components/${name}`, import.meta.url), "utf8");
const compile = value => ts.transpileModule(value, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exported = {};
Function("require", "exports", compile(read("PortalWorkspaceLoading.tsx")))(id => {
  assert.equal(id, "react/jsx-runtime");
  return jsx;
}, exported);
const { PortalWorkspaceLoading } = exported;

function find(element, predicate) {
  if (!element || typeof element !== "object") return null;
  if (predicate(element)) return element;
  for (const child of [element.props?.children].flat(Infinity)) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
}

test("loading keeps the existing opening message and a live status without a retry button", () => {
  const result = PortalWorkspaceLoading({ message: "Opening jobs...", error: null, retry: () => assert.fail("Still loading") });
  assert.equal(result.type, "p");
  assert.equal(result.props.role, "status");
  assert.equal(result.props.children, "Opening jobs...");
  assert.equal(find(result, element => element.type === "button"), null);
});

test("a failed chunk displays an alert and invokes the provided retry, without exposing technical error details", () => {
  let retries = 0;
  const result = PortalWorkspaceLoading({ message: "Opening jobs...", error: new Error("private internal chunk URL"), retry: () => retries++ });
  assert.equal(result.props.role, "alert");
  assert.equal(find(result, element => element.type === "p").props.children, "This workspace could not be opened.");
  const button = find(result, element => element.type === "button");
  assert.equal(button.props.type, "button");
  assert.equal(button.props.children, "Retry");
  button.props.onClick();
  assert.equal(retries, 1);
  assert.equal(find(result, element => element.props?.role === "status"), null);
});

test("an error without a framework retry offers a real page refresh instead of an inert button", () => {
  const result = PortalWorkspaceLoading({ message: "Opening jobs...", error: new Error("Unavailable") });
  assert.equal(result.props.role, "alert");
  assert.equal(find(result, element => element.type === "button"), null);
  assert.ok(find(result, element => element.type === "p" && element.props.children === "Refresh the page to try again."));
});

const registrations = {
  "AdminOperationsPortal.tsx": 22,
  "CreditexCompliancePortal.tsx": 11,
  "CouncilPortal.tsx": 7,
  "DirectTradeDashboard.tsx": 4,
  "council/CouncilWorkspace.tsx": 1,
};

for (const [file, expectedCount] of Object.entries(registrations)) {
  test(`${file} forwards chunk errors and framework retry through every new workspace boundary`, () => {
    const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declarations = ast.statements.filter(ts.isVariableStatement)
      .flatMap(statement => statement.declarationList.declarations)
      .filter(declaration => declaration.initializer?.getText(ast).includes("<PortalWorkspaceLoading"));
    assert.equal(declarations.length, expectedCount);
    for (const declaration of declarations) {
      const options = Function("dynamic", "require", "exports", "PortalWorkspaceLoading",
        compile(`const options = ${declaration.initializer.getText(ast)};`) + "\nreturn options;",
      )((loader, options) => options, id => {
        assert.equal(id, "react/jsx-runtime", "Registering the boundary must not eagerly import its workspace");
        return jsx;
      }, {}, PortalWorkspaceLoading);
      let retries = 0;
      const props = { error: new Error("Chunk failed"), isLoading: false, retry: () => retries++ };
      const failure = options.loading(props);
      assert.equal(failure.type, PortalWorkspaceLoading);
      assert.equal(failure.props.error, props.error);
      const alert = failure.type(failure.props);
      assert.equal(alert.props.role, "alert");
      find(alert, element => element.type === "button").props.onClick();
      assert.equal(retries, 1, declaration.name.getText(ast));
      const loading = options.loading({ error: null, isLoading: true, retry: props.retry });
      const status = loading.type(loading.props);
      assert.equal(status.props.role, "status");
      assert.match(status.props.children, /^Opening .+\.\.\.$/);
    }
  });
}
