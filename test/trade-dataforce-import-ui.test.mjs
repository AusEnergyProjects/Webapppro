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
  const state = []; let cursor = 0; const requests = []; const refreshes = []; const downloads = []; const downloadNames = [];
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
  const require = id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id === "./TradeBusinessProvider" ? { useTradeBusinessFetch: () => scopedFetch } : id === "./TradeCrmCsvImportSetup" ? { TradeCrmCsvImportSetup() {} } : id === "@/lib/creditex-dataforce-job-csv" ? csvTools : id === "@/lib/trade-dataforce-import-metadata" ? metadata : (() => { throw new Error(`Unexpected import ${id}`); })();
  const exports = {};
  const document = { createElement: () => ({ click() { downloadNames.push(this.download); } }) };
  const urlApi = { createObjectURL(blob) { downloads.push(blob); return "blob:test"; }, revokeObjectURL() {} };
  Function("require", "exports", "document", "URL", "setTimeout", compiled)(require, exports, document, urlApi, fn => fn());
  const user = { getIdToken: options.getIdToken || (async () => "test-token") };
  const render = () => { cursor = 0; return exports.TradeDataforceImportWorkspace({ user, importFormat: options.importFormat, onBack() {}, onImported: async () => { refreshes.push(true); await options.onImported?.(); } }); };
  return { requests, refreshes, downloads, downloadNames, render,
    async upload(file = { name: "dataforce.csv", size: 100, text: async () => csvSource() }, prepareOnly = false) {
      nodes(render(), node => node.type === "input" && node.props.type === "file")[0].props.onChange({ target: { files: [file] }, currentTarget: { value: "" } });
      await flush();
      const previewButton = button(render(), "Preview job mapping");
      if (!prepareOnly && previewButton) { previewButton.props.onClick(); await flush(); }
      return render();
    },
    async click(label) { const target = button(render(), label); assert.ok(target, `Button: ${label}`); assert.ok(!target.props.disabled, `Enabled: ${label}`); target.props.onClick(); await flush(); return render(); },
    async clickAria(label) { const target = nodes(render(), node => node.type === "button" && node.props["aria-label"] === label)[0]; assert.ok(target, `Button label: ${label}`); assert.ok(!target.props.disabled); target.props.onClick(); await flush(); return render(); },
    applyPreview(result) { nodes(render(), node => typeof node.props?.onPreview === "function")[0].props.onPreview(result); return render(); },
  };
}

test("Dataforce is detected before generic column mapping and remains installer-only", () => {
  assert.match(importer, /partnerType === "installer" && isTradeDataforceImport\(headers\)/);
  assert.ok(importer.indexOf("isTradeDataforceImport(headers)") < importer.indexOf("const normalized = new Map"));
  assert.match(importer, /dataforceMode && partnerType === "installer"/);
  assert.match(importer, /import \{ isTradeDataforceImport \} from "@\/lib\/trade-dataforce-import-metadata"/);
});

test("job import uses neutral product copy and accessible labels while preserving upload metadata", async () => {
  for (const [name, contents] of [["TradeDataImportWorkspace.tsx", importer], ["TradeDataforceImportWorkspace.tsx", source]]) {
    const ast = ts.createSourceFile(name, contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = node => {
      if (ts.isJsxText(node)) assert.doesNotMatch(node.text, /dataforce/i, "Visible product copy must be neutral");
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  const app = harness(() => preview());
  let tree = await app.upload(undefined, true);
  assert.match(text(tree), /job-import\.csv/);
  assert.doesNotMatch(text(tree), /dataforce/i);
  tree = await app.click("Preview job mapping");
  assert.match(text(tree), /Original imported record/);
  assert.doesNotMatch(text(tree), /dataforce/i);
  for (const element of nodes(tree, node => typeof node.props?.["aria-label"] === "string")) {
    assert.doesNotMatch(element.props["aria-label"], /dataforce/i);
  }
  assert.equal(app.requests[0].url, "/api/trade-imports/dataforce");
  assert.equal(app.requests[0].body.fileName, "dataforce.csv");
  assert.equal(app.requests[0].body.csvText, csvSource());
  await app.click("Download saved source");
  assert.deepEqual(app.downloadNames, ["job-import-source.csv"]);
  assert.equal(await app.downloads[0].text(), "source", "Source download contents must not be rewritten");
});

test("neutral product wording never rewrites original imported values", async () => {
  const originalRecord = { "Job Id": "Dataforce-0007", Customer: "Dataforce Electrical", "Work Type": "Dataforce service" };
  const app = harness(() => preview({ rows: [row(0, { values: { record: originalRecord } })] }));
  const tree = await app.upload();
  const sourceValues = nodes(tree, node => node.type === "dd").map(text);
  assert.deepEqual(sourceValues, Object.values(originalRecord));
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
  tree = await app.click("Preview job mapping");
  assert.deepEqual(app.requests[0].body.serviceCategoryMappings, { "Standard Install": "assessment" });
  assert.equal(app.requests[0].body.csvText, csv);
  assert.ok(button(tree, "Import reviewed job rows"));
  tree = await app.upload(file, true);
  const nextChoice = nodes(tree, node => node.type === "select" && node.props["aria-label"] === "TLink service category for Standard Install")[0];
  assert.equal(nextChoice.props.value, "", "A category choice must not become a global classification");
  await app.click("Preview job mapping");
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
  await app.click("Preview job mapping");
  assert.deepEqual(app.requests[0].body.serviceCategoryMappings, { "Different trade work": "other" });
});

test("work type names are treated as data even when they match object property names", async () => {
  const app = harness(() => preview());
  const csv = csvSource(["__proto__"]);
  const tree = await app.upload({ name: "trade.csv", size: csv.length, text: async () => csv }, true);
  const choice = nodes(tree, node => node.type === "select")[0];
  assert.equal(choice.props.value, "");
  choice.props.onChange({ target: { value: "other" } });
  await app.click("Preview job mapping");
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
  assert.match(text(tree), /Original job ID 1000/);
  assert.ok(button(tree, "Import reviewed job rows"));
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
  const tree = await app.click("Import reviewed job rows");
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
  const tree = await app.click("Import reviewed job rows");
  assert.equal(commits, 2);
  assert.match(text(tree), /Connection lost/);
  assert.match(text(tree), /Completed records remain saved/);
  assert.ok(button(tree, "Resume import"));
  assert.equal(app.refreshes.length, 0);
});

test("a non-progressing server response stops the loop and does not pretend completion", async () => {
  const app = harness(({ body }) => body.action === "preview" ? preview() : ({ ok: true, batch: batch({ status: "committing" }), processedCount: 0, hasMore: true }));
  await app.upload();
  const tree = await app.click("Import reviewed job rows");
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
  await app.click("Import reviewed job rows");
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
  assert.match(csv, /Original job ID/);
  assert.match(csv, /Original app ID/);
  assert.doesNotMatch(csv, /dataforce/i);
  assert.deepEqual(app.downloadNames, ["job-import-reconciliation.csv"]);
  assert.match(csv, /tlink-job-2/);
  assert.match(csv, /"'=1\+1"/);
  assert.match(csv, /"0007"/);
});

test("preview API failures are visible and cannot enable an import", async () => {
  const app = harness(() => ({ ok: false, error: "Unexpected job export columns" }));
  const tree = await app.upload();
  assert.match(text(nodes(tree, node => node.props?.role === "alert")), /Unexpected job export columns/);
  assert.equal(button(tree, "Import reviewed job rows"), undefined);
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
  assert.equal(button(tree, "Import reviewed job rows"), undefined);
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
  assert.match(link.props["aria-label"], /original job ID 1000/);
  assert.match(text(tree), /40 source rows and 920 original field values reconciled/);
});

test("summary tiles request matching filtered pages and retain the filter when paging", async () => {
  const app = harness(({ body, url }) => {
    if (body?.action === "preview") return preview({ batch: batch({ warningCount: 101 }) });
    assert.match(url, /batchId=batch-1&rowFilter=warning&offset=/);
    const nextPage = url.includes("offset=100");
    return preview({ total: 101, nextOffset: nextPage ? null : 100, rows: [row(nextPage ? 100 : 0, { status: "warning" })] });
  });
  await app.upload();
  let tree = await app.clickAria("Show warnings (101)");
  assert.match(text(tree), /Rows 1 to 1 of 101/);
  assert.equal(nodes(tree, node => node.props?.["aria-label"] === "Show warnings (1)")[0].props["aria-pressed"], true);
  tree = await app.click("Next");
  assert.match(app.requests[2].url, /rowFilter=warning&offset=100&limit=100$/);
  assert.match(text(tree), /Rows 101 to 101 of 101/);
});

test("every source total opens its own filter, including empty invalid and conflict selections", async () => {
  const filters = [["Source rows", ""], ["Ready", "ready"], ["Warnings", "warning"], ["Already imported", "duplicate"], ["Invalid", "invalid"], ["Conflicts", "conflict"]];
  for (const [label, filter] of filters) {
    const fixture = batch({ rowCount: 0, readyCount: 0, warningCount: 0, duplicateCount: 0, errorCount: 0, conflictCount: 0 });
    const app = harness(({ body }) => body?.action === "preview" ? preview({ batch: fixture }) : preview({ batch: fixture, total: 0, rows: [] }));
    await app.upload();
    const tree = await app.clickAria(`Show ${label.toLowerCase()} (0)`);
    const url = new URL(app.requests[1].url, "https://tlink.example");
    assert.equal(url.searchParams.get("rowFilter") || "", filter);
    assert.match(text(tree), /No rows match this selection/);
  }
  const app = harness(({ body }) => body?.action === "preview" ? preview({ batch: batch({ status: "committed", importedCount: 40 }) }) : preview({ total: 40 }));
  await app.upload(); await app.clickAria("Show imported (40)");
  assert.match(app.requests[1].url, /rowFilter=imported/);
});

test("linked tiles show only returned batch records and use the record total for pagination", async () => {
  const reconciliation = { jobs: 40, customers: 1, sites: 40, appointments: 40, contacts: 1, brokenLinks: 0 };
  const app = harness(({ body }) => body?.action === "preview" ? preview({ batch: batch({ status: "committed", importedCount: 40 }), reconciliation }) : ({ ok: true, batch: batch({ status: "committed", importedCount: 40 }), records: [{ id: "customer-1", label: "Batch customer", detail: "Original contact details" }], total: 1, nextOffset: null }));
  await app.upload();
  const tree = await app.clickAria("Show linked customers (1)");
  assert.match(app.requests[1].url, /batchId=batch-1&records=customers&offset=0&limit=100$/);
  assert.match(text(tree), /Records 1 to 1 of 1/);
  assert.match(text(tree), /Batch customer/);
  assert.doesNotMatch(text(tree), /Example customer/);
  assert.equal(button(tree, "Next").props.disabled, true);
  for (const [label, key, count] of [["jobs", "jobs", 40], ["service sites", "sites", 40], ["appointments", "appointments", 40], ["contacts", "contacts", 1]]) {
    await app.clickAria(`Show linked ${label} (${count})`);
    assert.match(app.requests.at(-1).url, new RegExp(`records=${key}&`));
  }
});

test("failed or incomplete record requests retain the previous rows and expose the error", async () => {
  const app = harness(({ body }) => body?.action === "preview" ? preview({ batch: batch({ status: "committed", importedCount: 40 }), reconciliation: { jobs: 40, customers: 1, sites: 40, appointments: 40, contacts: 1, brokenLinks: 0 } }) : ({ ok: true, batch: batch(), rows: [], total: 1 }));
  await app.upload();
  const tree = await app.clickAria("Show linked customers (1)");
  assert.match(text(tree), /linked record list was incomplete/);
  assert.match(text(tree), /Example customer/);
});

test("mapped paired imports use their endpoint and download each original file separately", async () => {
  const app = harness(() => ({ ok: true }), { importFormat: "csv" });
  const tree = app.applyPreview(preview({ sourceFiles: [{ id: "file-1", fileName: "clients.csv", role: "customers", rowCount: 2 }, { id: "file-2", fileName: "jobs.csv", role: "jobs", rowCount: 2 }], rows: [row(0, { values: { record: { Name: "Original client" }, customer: { businessName: "Original client" }, entityType: "customer", sourceFileId: "file-1", sourceRowNumber: 2, sourceId: "client-key" }, targetEntityId: "customer-id" })] }));
  assert.match(text(tree), /Original customer ID client-key/);
  assert.equal(nodes(tree, node => node.type === "a" && text(node) === "Open TLink job").length, 0);
  await app.click("Download customers source");
  await app.click("Download jobs source");
  assert.match(app.requests[0].url, /^\/api\/trade-imports\/csv\?batchId=batch-1&format=source&fileId=file-1$/);
  assert.match(app.requests[1].url, /fileId=file-2$/);
  assert.deepEqual(app.downloadNames, ["job-import-customers-source.csv", "job-import-jobs-source.csv"]);
});
