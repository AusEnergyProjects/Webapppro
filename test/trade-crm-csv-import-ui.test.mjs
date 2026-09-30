import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as csvTools from "../src/lib/creditex-dataforce-job-csv.ts";
import * as csvMetadata from "../src/lib/trade-crm-csv-import-metadata.ts";
import * as categories from "../src/lib/trade-dataforce-import-metadata.ts";

const source = fs.readFileSync(new URL("../src/components/TradeCrmCsvImportSetup.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const rawText = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(rawText).join(" ") : rawText(node.props?.children);
const text = node => rawText(node).replace(/\s+/g, " ").trim();
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const flush = () => new Promise(resolve => setImmediate(resolve));
const file = (name, csv) => ({ name, size: Buffer.byteLength(csv), text: async () => csv });
const clients = file("clients.csv", "Name,Company Address,Email Address\r\nCLIENT-01,1 Main St,client@example.test\r\n");
const jobs = file("jobs.csv", "Job Number,Company,Job Category,Job Address,Contact First,Contact Last,Custom detail\r\nJOB-001,CLIENT-01,Assessment,2 Main St,Example,Contact,Keep this exact value\r\n");

function harness(responder = () => ({ ok: true, batch: { id: "batch-1" }, rows: [] }), options = {}) {
  const state = []; let cursor = 0; const requests = []; const previews = [];
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in state)) state[index] = { current: initial }; return state[index]; }, useMemo(fn) { return fn(); }, useEffect() {},
  };
  const scopedFetch = async (url, init) => { const body = JSON.parse(init.body); requests.push({ url, init, body }); const result = await responder(body); return { ok: result.ok !== false, json: async () => result }; };
  const require = id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id === "./TradeBusinessProvider" ? { useTradeBusinessFetch: () => scopedFetch } : id === "@/lib/creditex-dataforce-job-csv" ? csvTools : id === "@/lib/trade-crm-csv-import-metadata" ? csvMetadata : id === "@/lib/trade-dataforce-import-metadata" ? categories : (() => { throw new Error(`Unexpected import ${id}`); })();
  const exports = {}; Function("require", "exports", compiled)(require, exports);
  const render = () => { cursor = 0; return exports.TradeCrmCsvImportSetup({ user: { getIdToken: options.getIdToken || (async () => "token") }, initialSource: options.initialSource, onPreview(result) { previews.push(result); } }); };
  const previewButton = () => nodes(render(), node => node.type === "button" && text(node) === "Preview mapped files")[0];
  return { requests, previews, render, previewButton,
    async upload(files) { nodes(render(), node => node.type === "input" && node.props.type === "file")[0].props.onChange({ target: { files }, currentTarget: { value: "" } }); await flush(); return render(); },
    change(label, value) { const field = nodes(render(), node => node.type === "select" && node.props["aria-label"] === label)[0]; assert.ok(field, label); field.props.onChange({ target: { value } }); return render(); },
    confirm() { nodes(render(), node => node.type === "input" && node.props.type === "checkbox" && !node.props["aria-label"])[0].props.onChange({ target: { checked: true } }); return render(); },
    async preview() { const button = previewButton(); assert.equal(button.props.disabled, false); button.props.onClick(); await flush(); return render(); },
  };
}

test("paired customer and job files require mapping review and submit exact original CSV with explicit join choices", async () => {
  const app = harness();
  let tree = await app.upload([clients, jobs]);
  assert.equal(app.requests.length, 0);
  assert.equal(app.previewButton().props.disabled, true);
  assert.match(text(tree), /Kept in the original record: Custom detail/);
  assert.equal(nodes(tree, node => node.props?.["aria-label"] === "Record type for clients.csv")[0].props.value, "customers");
  assert.equal(nodes(tree, node => node.props?.["aria-label"] === "Record type for jobs.csv")[0].props.value, "jobs");
  const unmatched = nodes(tree, node => node.type === "select" && node.props.value === "block")[0];
  unmatched.props.onChange({ target: { value: "use_job_contacts" } });
  app.change("TLink service category for Assessment", "assessment");
  app.confirm(); await app.preview();
  assert.equal(app.previews.length, 1);
  const { url, init, body } = app.requests[0];
  assert.equal(url, "/api/trade-imports/csv"); assert.equal(init.headers.Authorization, "Bearer token");
  assert.equal(body.files[0].csvText, await clients.text()); assert.equal(body.files[1].csvText, await jobs.text());
  assert.equal(body.files[0].mapping["customer.externalId"], "Name");
  assert.equal(body.files[1].mapping["job.customerReference"], "Company");
  assert.deepEqual(body.options, { sourceNamespace: "Previous CRM", unmatchedJobs: "use_job_contacts", serviceCategoryMappings: { Assessment: "assessment" }, excludedRows: {} });
  assert.equal(Object.hasOwn(body.files[1].mapping, "Custom detail"), false);
});

test("an unfamiliar customer CSV can be mapped manually and mapping edits clear the confirmation", async () => {
  const app = harness();
  await app.upload([file("other.csv", "record_ref,full_contact,street\n0007,Example Person,3 Main St\n")]);
  app.change("Record type for other.csv", "customers");
  assert.equal(app.previewButton().props.disabled, true);
  app.change("Unique source client ID / key in other.csv", "record_ref");
  app.change("Contact full name in other.csv", "full_contact");
  app.confirm();
  assert.equal(app.previewButton().props.disabled, false);
  app.change("Customer / company full address in other.csv", "street");
  assert.equal(app.previewButton().props.disabled, true);
  app.confirm(); await app.preview();
  assert.equal(app.requests[0].body.files[0].role, "customers");
  assert.equal(app.requests[0].body.files[0].mapping["customer.externalId"], "record_ref");
  assert.match(app.requests[0].body.files[0].csvText, /0007/);
});

test("duplicate file roles and too many files cannot create a preview", async () => {
  const app = harness();
  let tree = await app.upload([jobs, file("second.csv", await jobs.text())]);
  app.confirm(); assert.equal(app.previewButton().props.disabled, true);
  assert.match(text(tree), /Choose one file per record type/);
  tree = await app.upload([clients]);
  assert.match(text(tree), /Remove a file before replacing it/);
  assert.equal(app.requests.length, 0);
});

test("an initial source from generic upload is prepared without a preview or data loss", () => {
  const csv = "Job Number,Job Title\n0001,An exact title\n";
  const app = harness(undefined, { initialSource: { name: "source.csv", csv } });
  const tree = app.render();
  assert.match(text(tree), /1 source record/);
  assert.match(text(tree), /An exact title/);
  assert.equal(app.requests.length, 0);
  assert.equal(app.previewButton().props.disabled, true);
});

test("preview and authentication failures are visible and never report success", async () => {
  const app = harness(() => ({ ok: false, error: "Review the unmatched client key." }));
  await app.upload([jobs]); app.confirm();
  assert.match(text(await app.preview()), /Review the unmatched client key/);
  assert.equal(app.previews.length, 0);
  const signedOut = harness(undefined, { getIdToken: async () => { throw new Error("Sign in again"); } });
  await signedOut.upload([jobs]); signedOut.confirm();
  assert.match(text(await signedOut.preview()), /Sign in again/);
  assert.equal(signedOut.requests.length, 0);
});

test("oversized files are rejected before reading and original unmapped values remain unchanged", async () => {
  const app = harness();
  const tree = await app.upload([{ name: "large.csv", size: 10 * 1024 * 1024 + 1, text() { throw new Error("must not read"); } }]);
  assert.match(text(tree), /no larger than 10 MB/); assert.equal(app.requests.length, 0);
  const csv = "Job Number,Job Title,Unknown field\nDataforce-01,Exact source wording,Preserve Dataforce in original cells\n";
  await app.upload([file("dataforce.csv", csv)]); app.confirm(); await app.preview();
  assert.equal(app.requests[0].body.files[0].csvText, csv);
  assert.equal(app.requests[0].body.files[0].fileName, "dataforce.csv");
});

test("source row exclusions are explicit, paginated, and preserve the complete original file", async () => {
  const csv = `Job Number,Job Title\n${Array.from({ length: 51 }, (_, index) => `${index === 50 ? "Guide" : `JOB-${index}`},Example title ${index}`).join("\n")}\n`;
  const app = harness();
  let tree = await app.upload([file("jobs.csv", csv)]);
  assert.equal(nodes(tree, node => node.type === "input" && node.props["aria-label"]?.startsWith("Include row")).length, 50);
  nodes(tree, node => node.type === "button" && text(node) === "Next source rows")[0].props.onClick();
  tree = app.render();
  assert.match(text(tree), /Rows 51 to 51 of 51/);
  app.confirm();
  const include = nodes(app.render(), node => node.type === "input" && node.props["aria-label"] === "Include row 52 in jobs.csv")[0];
  include.props.onChange({ target: { checked: false } });
  tree = app.render();
  assert.match(text(tree), /1 excluded/);
  assert.match(text(tree), /Row 52 · Guide · Excluded/);
  assert.equal(app.previewButton().props.disabled, true, "Changing row selection requires fresh review");
  app.confirm(); await app.preview();
  assert.deepEqual(app.requests[0].body.options.excludedRows, { "file-1": [52] });
  assert.equal(app.requests[0].body.files[0].csvText, csv);
});

test("paired files enforce the combined size limit before either file is read", async () => {
  const app = harness();
  const oversizedPair = ["clients.csv", "jobs.csv"].map(name => ({ name, size: 6 * 1024 * 1024, text() { throw new Error("must not read"); } }));
  const tree = await app.upload(oversizedPair);
  assert.match(text(tree), /no larger than 10 MB combined/);
  assert.equal(app.requests.length, 0);
  assert.equal(app.previewButton(), undefined);
});
