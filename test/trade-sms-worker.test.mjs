import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("worker/index.ts", source, ts.ScriptTarget.Latest, true);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function fixture(overrides = {}) {
  const calls = [], errors = [], pending = [], database = { name: "sms-test-database" }, dependencies = new Map();
  const invoke = name => (...args) => {
    calls.push({ name, args });
    return overrides[name] ? overrides[name](...args) : Promise.resolve();
  };
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const dependency = {};
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        if (!binding.isTypeOnly) dependency[binding.propertyName?.text || binding.name.text] = invoke(binding.propertyName?.text || binding.name.text);
      }
    }
    if (statement.importClause.name) dependency.default = { fetch: invoke("handler.fetch") };
    dependencies.set(statement.moduleSpecifier.text, dependency);
  }
  dependencies.get("../db").getD1 = () => database;
  dependencies.get("../src/lib/service-reminder-delivery").serviceReminderProviderConfiguration = () => ({ email: { configured: false } });
  dependencies.get("../src/lib/creditex-product-registry-maintenance").creditexAutomaticProductRegistryMaintenanceTargets = () => [];
  const record = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: record.exports,
    module: record,
    require(name) { assert.ok(dependencies.has(name), `Unexpected worker dependency: ${name}`); return dependencies.get(name); },
    console: { error: (...args) => errors.push(args) },
  }, { filename: "worker/index.ts" });
  return {
    calls, errors, pending, database,
    schedule: cron => record.exports.default.scheduled({ cron }, {}, { waitUntil: promise => pending.push(promise) }),
  };
}

test("minute scheduler invokes each SMS processor once with D1 and keeps both alive", async () => {
  const automation = deferred(), rental = deferred();
  const f = fixture({ processSmsAutomations: () => automation.promise, processManagedSmsRentals: () => rental.promise });
  await f.schedule("* * * * *");
  for (const name of ["processSmsAutomations", "processManagedSmsRentals", "processBusinessFollowUps"]) {
    const calls = f.calls.filter(call => call.name === name);
    assert.equal(calls.length, 1, name);
    assert.equal(calls[0].args.length, 1, name);
    assert.equal(calls[0].args[0], f.database, name);
  }
  assert.equal(f.pending.length, 1);
  let complete = false;
  f.pending[0].then(() => { complete = true; });
  automation.resolve();
  await Promise.resolve();
  assert.equal(complete, false, "The rental work must remain attached to the scheduled event");
  rental.resolve();
  await f.pending[0];
  assert.equal(complete, true);
  assert.equal(f.calls.some(call => call.name === "generateDueServiceJobs"), false);
});

test("failed SMS processors do not reject other scheduled work or log provider secrets", async () => {
  const f = fixture({
    processSmsAutomations: async () => { throw new Error("private-automation-payload"); },
    processManagedSmsRentals: async () => { throw new Error("private-provider-api-key"); },
  });
  await f.schedule("* * * * *");
  await assert.doesNotReject(f.pending[0]);
  assert.equal(f.errors.length, 2);
  assert.match(f.errors.flat().join(" "), /Automatic SMS reminders/);
  assert.match(f.errors.flat().join(" "), /Managed SMS number rentals/);
  assert.doesNotMatch(f.errors.flat().join(" "), /private-/);
  for (const name of ["processBusinessFollowUps", "drainAcceptedInvoiceEmails", "drainTradeQuoteDeliveries"]) {
    assert.equal(f.calls.filter(call => call.name === name).length, 1, name);
  }
});

test("daily and unrelated cron events never invoke SMS and preserve daily job limit", async () => {
  for (const cron of ["15 20 * * *", "0 0 1 1 *"]) {
    const f = fixture();
    await f.schedule(cron);
    await f.pending[0];
    assert.equal(f.calls.some(call => ["processSmsAutomations", "processManagedSmsRentals", "processBusinessFollowUps"].includes(call.name)), false);
    const generated = f.calls.filter(call => call.name === "generateDueServiceJobs");
    assert.equal(generated.length, cron === "15 20 * * *" ? 1 : 0);
    if (generated.length) {
      assert.equal(generated[0].args[0], f.database);
      assert.equal(generated[0].args[1].limit, 200);
    }
  }
});
