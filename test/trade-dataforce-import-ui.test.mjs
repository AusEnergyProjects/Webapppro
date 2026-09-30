import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as csvTools from "../src/lib/creditex-dataforce-job-csv.ts";
import * as metadata from "../src/lib/trade-dataforce-import-metadata.ts";

const source = fs.readFileSync(new URL("../src/components/TradeDataforceImportWorkspace.tsx", import.meta.url), "utf8");
const importer = fs.readFileSync(new URL("../src/components/TradeDataImportWorkspace.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const rawText = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(rawText).join(" ") : rawText(node.props?.children);
const text = node => rawText(node).replace(/\s+/g, " ").trim();
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const csvSource = (workTypes = ["Home Energy Rating Assessment"]) => [csvTools.DATAFORCE_JOB_CSV_HEADERS, ...workTypes.map((workType, index) => csvTools.DATAFORCE_JOB_CSV_HEADERS.map(header => header === "Work Type" ? workType : header === "Job Id" ? `JOB-${index}` : ""))].map(values => values.map(value => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
const batch = (extra = {}) => ({ id: "batch-1", fileName: "dataforce.csv", rowCount: 40, readyCount: 39, warningCount: 1, duplicateCount: 0, errorCount: 0, conflictCount: 0, importedCount: 0, skippedCount: 0, failedCount: 0, pendingCount: 40, status: "preview", createdAt: "2026-09-30T01:00:00.000Z", updatedAt: "2026-09-30T01:00:00.000Z", committedAt: "", ...extra });
const row = (index, extra = {}) => ({ id: `row-${index}`, rowNumber: index + 2, key: `source-${index}`, values: { record: { "Job Id": String(1000 + index), "App Id": String(5000 + index), Customer: "Example customer", Address: "1 Example St", Suburb: "Melbourne", Postcode: "3000" } }, status: "ready", issues: [], resultStatus: "pending", targetEntityId: "", error: "", ...extra });
const preview = (extra = {}) => ({ ok: true, batch: batch(), rows: [row(0)], nextOffset: null, fieldMappings: [{ header: "Job Id", target: "Original source job reference", note: "TLink assigns a separate job number." }], ...extra });

function harness(responder, options = {}) {
  const state = []; let cursor = 0; const requests = []; const refreshes = []; const downloads = [];
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
    useCallback(fn) { return fn; }, useEffect() {},
  };
  const scopedFetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, init, body });
    const result = await responder({ url, init, body });
    return { ok: result.ok !== false, json: async () => result, blob: async () => new Blob(["source"]) };
  };
  const require = id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id === "./TradeBusinessProvider" ? { useTradeBusinessFetch: () => scopedFetch } : id === "@/lib/creditex-dataforce-job-csv" ? csvTools : id === "@/lib/trade-dataforce-import-metadata" ? metadata : (() => { throw new Error(`Unexpected import ${id}`); })();
  const exports = {};
  const document = { createElement: () => ({ click() {} }) };
  const urlApi = { createObjectURL(blob) { downloads.push(blob); return "blob:test"; }, revokeObjectURL() {} };
  Function("require", "exports", "document", "URL", "setTimeout", compiled)(require, exports, document, urlApi, fn => fn());
  const user = { getIdToken: options.getIdToken || (async () => "test-token") };
  const render = () => { cursor = 0; return exports.TradeDataforceImportWorkspace({ user, onBack() {}, onImported: async () => { refreshes.push(true); await options.onImported?.(); } }); };
  return { requests, refreshes, downloads, render,
    async upload(file = { name: "dataforce.csv", size: 100, text: async () => csvSource() }, prepareOnly = false) {
      nodes(render(), node => node.type === "input" && node.props.type === "file")[0].props.onChange({ target: { files: [file] }, currentTarget: { value: "" } });
      await flush();
      const previewButton = button(render(), "Preview Dataforce mapping");
      if (!prepareOnly && previewButton) { previewButton.props.onClick(); await flush(); }
      return render();
    },
    async click(label) { const target = button(render(), label); assert.ok(target, `Button: ${label}`); assert.ok(!target.props.disabled, `Enabled: ${label}`); target.props.onClick(); await flush(); return render(); },
  };
}

test("Dataforce is detected before generic column mapping and remains installer-only", () => {
  assert.match(importer, /partnerType === "installer" && isTradeDataforceImport\(headers\)/);
  assert.ok(importer.indexOf("isTradeDataforceImport(headers)") < importer.indexOf("const normalized = new Map"));
  assert.match(importer, /dataforceMode && partnerType === "installer"/);
  assert.match(importer, /import \{ isTradeDataforceImport \} from "@\/lib\/trade-dataforce-import-metadata"/);
});

test("upload waits for category review and sends only this file's explicit work type selections", async () => {
  const app = harness(() => preview());
  const csv = csvSource(["Home Energy Rating Assessment", "Standard Install", "Standard Install"]);
  const file = { name: "migration.csv", size: csv.length, text: async () => csv };
  let tree = await app.upload(file, true);
  assert.equal(app.requests.length, 0, "Selecting a file must not create a server preview yet");
  assert.match(text(tree), /Standard Install \(\s*2 jobs\s*\)/);
  const choices = nodes(tree, node => node.type === "select");
  const standard = choices.find(node => node.props["aria-label"] === "TLink service category for Standard Install");
  const assessment = choices.find(node => node.props["aria-label"] === "TLink service category for Home Energy Rating Assessment");
  assert.equal(standard.props.value, "");
  assert.equal(assessment.props.value, "");
  assert.match(text(nodes(standard, node => node.type === "option" && node.props.value === "")), /Other.*\(needs review\)/);
  assert.doesNotMatch(text(nodes(assessment, node => node.type === "option" && node.props.value === "")), /needs review/);
  standard.props.onChange({ target: { value: "assessment" } });
  tree = await app.click("Preview Dataforce mapping");
  assert.deepEqual(app.requests[0].body.serviceCategoryMappings, { "Standard Install": "assessment" });
  assert.equal(app.requests[0].body.csvText, csv);
  assert.ok(button(tree, "Import reviewed Dataforce rows"));
  tree = await app.upload(file, true);
  const nextChoice = nodes(tree, node => node.type === "select" && node.props["aria-label"] === "TLink service category for Standard Install")[0];
  assert.equal(nextChoice.props.value, "", "A category choice must not become a global classification");
  await app.click("Preview Dataforce mapping");
  assert.deepEqual(app.requests[1].body.serviceCategoryMappings, {});
});

test("explicit Other is reviewable and unsupported categories never enter the preview request", async () => {
  const app = harness(() => preview());
  const csv = csvSource(["Different trade work"]);
  let tree = await app.upload({ name: "trade.csv", size: csv.length, text: async () => csv }, true);
  let choice = nodes(tree, node => node.type === "select")[0];
  choice.props.onChange({ target: { value: "not-a-service" } });
  tree = app.render();
  choice = nodes(tree, node => node.type === "select")[0];
  assert.equal(choice.props.value, "");
  choice.props.onChange({ target: { value: "other" } });
  await app.click("Preview Dataforce mapping");
  assert.deepEqual(app.requests[0].body.serviceCategoryMappings, { "Different trade work": "other" });
});

test("work type names are treated as data even when they match object property names", async () => {
  const app = harness(() => preview());
  const csv = csvSource(["__proto__"]);
  const tree = await app.upload({ name: "trade.csv", size: csv.length, text: async () => csv }, true);
  const choice = nodes(tree, node => node.type === "select")[0];
  assert.equal(choice.props.value, "");
  choice.props.onChange({ target: { value: "other" } });
  await app.click("Preview Dataforce mapping");
  assert.equal(Object.hasOwn(app.requests[0].body.serviceCategoryMappings, "__proto__"), true);
  assert.equal(app.requests[0].body.serviceCategoryMappings["__proto__"], "other");
});

test("reviewed upload previews exact source without committing and shows mappings and source values", async () => {
  const app = harness(() => preview());
  let tree = await app.upload();
  assert.equal(app.requests.length, 1);
  assert.deepEqual(app.requests[0].body, { action: "preview", csvText: csvSource(), fileName: "dataforce.csv", serviceCategoryMappings: {} });
  assert.equal(app.requests[0].init.headers.get("Authorization"), "Bearer test-token");
  assert.match(text(tree), /View all 1 column mappings/);
  assert.match(text(tree), /Original source job reference/);
  assert.match(text(tree), /Dataforce job 1000/);
  assert.ok(button(tree, "Import reviewed Dataforce rows"));
  tree = await app.upload({ name: "too-large.csv", size: 10 * 1024 * 1024 + 1, text() { throw new Error("must not read"); } });
  assert.equal(app.requests.length, 1);
  assert.match(text(nodes(tree, node => node.props?.role === "alert")), /no larger than 10 MB/);
});

test("commit processes every group, refreshes saved reconciliation and reports workspace refresh failure separately", async () => {
  let commits = 0;
  const app = harness(({ body }) => {
    if (body?.action === "preview") return preview();
    if (body?.action === "commit") { commits++; return { ok: true, batch: batch({ status: commits === 2 ? "committed" : "committing", importedCount: commits * 20, pendingCount: 40 - commits * 20 }), processedCount: 20, hasMore: commits < 2 }; }
    return preview({ batch: batch({ status: "committed", importedCount: 40, pendingCount: 0 }) });
  }, { onImported: async () => { throw new Error("refresh failed"); } });
  await app.upload();
  const tree = await app.click("Import reviewed Dataforce rows");
  assert.equal(commits, 2);
  assert.equal(app.refreshes.length, 1);
  assert.match(text(tree), /Import complete/);
  assert.match(text(tree), /import progress is saved, but the workspace could not refresh/);
  assert.equal(button(tree, "Resume import"), undefined);
});

test("network interruption preserves completed progress and exposes resume without automatic retry", async () => {
  let commits = 0;
  const app = harness(({ body }) => {
    if (body?.action === "preview") return preview();
    commits++;
    if (commits === 2) throw new Error("Connection lost");
    return { ok: true, batch: batch({ status: "committing", importedCount: 20, pendingCount: 20 }), processedCount: 20, hasMore: true };
  });
  await app.upload();
  const tree = await app.click("Import reviewed Dataforce rows");
  assert.equal(commits, 2);
  assert.match(text(tree), /Connection lost/);
  assert.match(text(tree), /Completed records remain saved/);
  assert.ok(button(tree, "Resume import"));
  assert.equal(app.refreshes.length, 0);
});

test("a non-progressing server response stops the loop and does not pretend completion", async () => {
  const app = harness(({ body }) => body.action === "preview" ? preview() : ({ ok: true, batch: batch({ status: "committing" }), processedCount: 0, hasMore: true }));
  await app.upload();
  const tree = await app.click("Import reviewed Dataforce rows");
  assert.equal(app.requests.filter(request => request.body?.action === "commit").length, 1);
  assert.match(text(tree), /no rows progressed/);
  assert.ok(button(tree, "Resume import"));
});

test("pause waits for the active group to save, then resumes from its saved batch", async () => {
  let finishGroup;
  let commits = 0;
  let current = batch();
  const app = harness(async ({ body }) => {
    if (body?.action === "preview") return preview();
    if (body?.action === "commit") {
      commits++;
      if (commits === 1) await new Promise(resolve => { finishGroup = resolve; });
      current = batch({ status: commits === 2 ? "committed" : "committing", pendingCount: 40 - commits * 20, importedCount: commits * 20 });
      return { ok: true, batch: current, processedCount: 20, hasMore: commits < 2 };
    }
    return preview({ batch: current });
  });
  await app.upload();
  await app.click("Import reviewed Dataforce rows");
  await app.click("Pause after this group");
  assert.equal(commits, 1);
  finishGroup();
  await flush();
  assert.equal(commits, 1);
  assert.match(text(app.render()), /Import paused. Completed records are saved/);
  const tree = await app.click("Resume import");
  assert.equal(commits, 2);
  assert.match(text(tree), /Import complete/);
  assert.equal(button(tree, "Resume import"), undefined);
});

test("row pagination loads the server's next page and retains conflict explanations", async () => {
  const app = harness(({ body }) => body?.action === "preview" ? preview({ batch: batch({ rowCount: 101 }), nextOffset: 100 }) : preview({ batch: batch({ rowCount: 101, conflictCount: 1 }), rows: [row(100, { status: "conflict", resultStatus: "conflict", issues: [{ level: "error", message: "This source job has changed since its earlier import." }] })] }));
  await app.upload();
  const tree = await app.click("Next");
  assert.match(app.requests[1].url, /offset=100&limit=100$/);
  assert.match(text(tree), /This source job has changed/);
  assert.match(text(tree), /Rows 101 to 101 of 101/);
  assert.ok(button(tree, "Next").props.disabled);
});

test("reconciliation downloads all pages and protects formula-like source IDs", async () => {
  const exportRows = [row(0), row(1, { values: { record: { "Job Id": "=1+1", "App Id": "0007" } }, resultStatus: "imported", targetEntityId: "tlink-job-2" })];
  const app = harness(({ body, url }) => body?.action === "preview" ? preview({ batch: batch({ rowCount: 2 }) }) : preview({ batch: batch({ rowCount: 2 }), rows: [url.includes("offset=0") ? exportRows[0] : exportRows[1]], nextOffset: url.includes("offset=0") ? 1 : null }));
  await app.upload();
  await app.click("Download reconciliation");
  assert.equal(app.downloads.length, 1);
  const csv = await app.downloads[0].text();
  assert.match(csv, /Dataforce Job Id/);
  assert.match(csv, /tlink-job-2/);
  assert.match(csv, /"'=1\+1"/);
  assert.match(csv, /"0007"/);
});

test("preview API failures are visible and cannot enable an import", async () => {
  const app = harness(() => ({ ok: false, error: "Unexpected Dataforce columns" }));
  const tree = await app.upload();
  assert.match(text(nodes(tree, node => node.props?.role === "alert")), /Unexpected Dataforce columns/);
  assert.equal(button(tree, "Import reviewed Dataforce rows"), undefined);
});

test("a partial reconciliation is rejected instead of downloading a misleading report", async () => {
  const app = harness(() => preview());
  await app.upload();
  const tree = await app.click("Download reconciliation");
  assert.equal(app.downloads.length, 0);
  assert.match(text(tree), /did not include every source row/);
});

test("token failures show an error and never submit data", async () => {
  const app = harness(() => preview(), { getIdToken: async () => { throw new Error("Sign in again"); } });
  const tree = await app.upload();
  assert.equal(app.requests.length, 0);
  assert.match(text(tree), /Sign in again/);
  assert.equal(button(tree, "Import reviewed Dataforce rows"), undefined);
});

test("saved batches surface broken CRM links instead of presenting historical receipts as current success", async () => {
  const warning = "A previously imported customer or service site has been removed.";
  const app = harness(() => preview({ batch: batch({ status: "needs_review", pendingCount: 0, importedCount: 40, integrityWarning: warning }), reconciliation: { jobs: 40, customers: 38, sites: 40, appointments: 40, contacts: 38, brokenLinks: 1 } }));
  const tree = await app.upload();
  assert.match(text(nodes(tree, node => node.props?.role === "alert")), /previously imported customer or service site has been removed/);
  assert.match(text(tree), /Records linked by this batch/);
  assert.match(text(tree), /1 source record has links requiring review/);
  assert.equal(button(tree, "Resume import"), undefined);
  assert.match(text(tree), /Imported appointments do not send automatic reminders or follow-ups/);
});

test("imported rows open their exact TLink job and source-value reconciliation is visible", async () => {
  const app = harness(() => preview({ batch: batch({ status: "committed", pendingCount: 0, importedCount: 40 }), rows: [row(0, { resultStatus: "imported", targetEntityId: "job/one?value=2" })], reconciliation: { jobs: 40, customers: 38, sites: 40, appointments: 40, contacts: 38, brokenLinks: 0, sourceRows: 40, sourceCells: 920, mismatchedSourceRows: 0 } }));
  const tree = await app.upload();
  const link = nodes(tree, node => node.type === "a" && text(node) === "Open TLink job")[0];
  assert.equal(link.props.href, "/direct-trade/dashboard?workspace=work&crm=jobs&jobId=job%2Fone%3Fvalue%3D2");
  assert.match(link.props["aria-label"], /Dataforce 1000/);
  assert.match(text(tree), /40 source rows and 920 original field values reconciled/);
});
