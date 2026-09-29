import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const client = read("src/lib/firebase-client.ts");

for (const existingApp of [false, true]) {
  test(`Firebase ${existingApp ? "reuses" : "creates"} the app and restores the existing persistence hierarchy without a startup popup iframe`, () => {
    const app = { name: "[DEFAULT]" };
    const auth = { app };
    const persistence = [{ type: "indexedDB" }, { type: "localStorage" }, { type: "sessionStorage" }];
    let createCalls = 0;
    let authCalls = 0;
    const dependencies = {
      "firebase/app": {
        getApps: () => existingApp ? [app] : [],
        getApp: () => { assert.equal(existingApp, true); return app; },
        initializeApp: () => { createCalls += 1; return app; },
      },
      "firebase/auth": {
        indexedDBLocalPersistence: persistence[0],
        browserLocalPersistence: persistence[1],
        browserSessionPersistence: persistence[2],
        initializeAuth(receivedApp, options) {
          authCalls += 1;
          assert.equal(receivedApp, app);
          assert.deepEqual(Object.keys(options), ["persistence"]);
          assert.deepEqual(Array.from(options.persistence), persistence);
          return auth;
        },
      },
    };
    const exports = {};
    const compiled = ts.transpileModule(client, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    runInNewContext(compiled, {
      exports,
      require(name) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name]; },
    });
    assert.equal(exports.firebaseAuth, auth);
    assert.equal(createCalls, existingApp ? 0 : 1);
    assert.equal(authCalls, 1);
  });
}

const popupClients = [
  "TradeTeamPortal",
  "DirectTradePartnerForm",
  "AdminOperationsPortal",
  "CreditexCompliancePortal",
  "FirebaseMfa",
];

for (const name of popupClients) {
  test(`${name} supplies Firebase's browser resolver when a Google popup is requested`, () => {
    const source = ts.createSourceFile(`${name}.tsx`, read(`src/components/${name}.tsx`), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const firebaseImport = source.statements.find((statement) => ts.isImportDeclaration(statement) && statement.moduleSpecifier.text === "firebase/auth");
    assert.ok(firebaseImport?.importClause?.namedBindings && ts.isNamedImports(firebaseImport.importClause.namedBindings));
    assert.ok(firebaseImport.importClause.namedBindings.elements.some((element) => element.name.text === "browserPopupRedirectResolver"));
    const popupCalls = [];
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["signInWithPopup", "reauthenticateWithPopup"].includes(node.expression.text)) popupCalls.push(node);
      ts.forEachChild(node, visit);
    }
    visit(source);
    assert.equal(popupCalls.length, 1);
    for (const call of popupCalls) {
      assert.equal(call.arguments.length, 3);
      assert.equal(call.arguments[2].getText(source), "browserPopupRedirectResolver");
    }
  });
}
