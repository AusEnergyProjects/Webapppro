

import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as pages from "../../src/lib/creditex-form-pages.ts";
import * as flow from "../../src/lib/trade-activity-form-flow.ts";

const source = fs.readFileSync(new URL("../../src/components/CreditexFieldFormMasters.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const text = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
function nodes(node, predicate) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
const catalogue = [
  { activityTemplateId: "veu-6", programCode: "VEU", activityCode: "6", title: "Heating and cooling" },
  { activityTemplateId: "sres-pv", programCode: "SRES", activityCode: "PV", title: "Solar panels" },
];
const masterForm = {
  activityTemplateId: "veu-6", programCode: "VEU", variantId: "", variantOptions: [], title: "Heating and cooling", version: 2,
  fields: [
    { key: "custom.comment", label: "Extra comment", section: "Visit", type: "text", phase: "before", required: false, options: [], help: "" },
    { key: "required.photo", label: "Required photo", section: "Visit", type: "photo", phase: "before", required: true, options: [], help: "", sourceRequirementId: "government-evidence" },
  ],
  declarations: [
    { key: "custom.confirmation", title: "Extra confirmation", text: "I confirm the extra work.", role: "customer", phase: "after", required: false, sourceUrl: "", sourceTextSha256: "" },
    { key: "program.confirmation", title: "Program confirmation", text: "Required program wording.", role: "customer", phase: "after", required: true, sourceUrl: "https://example.invalid/rule", sourceTextSha256: "source-hash" },
  ], sources: [], reviewNotes: [],
};
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const edit = tree => nodes(tree, node => node.type === "button" && node.props["aria-label"] === "Edit VEU 6: Heating and cooling")[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness({ canAuthor = true, actorMode = "admin", respond = async () => ({ catalogue }), confirm = true, onManageAccess, onDirtyChange } = {}) {
  const state = [], effects = [], requests = [], calls = [], signals = []; let cursor = 0, mounted = true, lateStateWrites = 0;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { if (!mounted) lateStateWrites++; state[i] = typeof value === "function" ? value(state[i]) : value; }]; },
    useCallback(callback, deps) { const i = cursor++; if (!state[i] || deps.some((dep, index) => dep !== state[i].deps[index])) state[i] = { deps, callback }; return state[i].callback; },
    useEffect(callback, deps) { const i = cursor++; if (!state[i] || deps.some((dep, index) => dep !== state[i].deps[index])) { state[i]?.cleanup?.(); state[i] = { deps }; effects.push(() => { state[i].cleanup = callback(); }); } },
  };
  const api = async (path, init) => { requests.push(path); calls.push({ path, body: init?.body ? JSON.parse(init.body) : undefined }); signals.push(init?.signal); return respond(path, init); };
  const exports = {};
  const window = { confirm: () => confirm, addEventListener() {}, removeEventListener() {} };
  Function("require", "exports", "window", compiled)(id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id === "./CreditexFormPhonePreview" ? { CreditexFormPhonePreview: "phone-preview" } : id.endsWith("/creditex-form-pages") ? pages : id.endsWith("/trade-activity-form-flow") ? flow : id.endsWith(".module.css") ? { default: {} } : (() => { throw Error(id); })(), exports, window);
  const render = () => { cursor = 0; const tree = exports.CreditexFieldFormMasters({ api, actorMode, canAuthor, onManageAccess, onDirtyChange }); effects.splice(0).forEach(run => run()); return tree; };
  return { requests, calls, signals, render, setConfirm(value) { confirm = value; }, get lateStateWrites() { return lateStateWrites; }, unmount() { mounted = false; for (const slot of state) slot?.cleanup?.(); }, async mount() { render(); await flush(); return render(); } };
}


export { text, nodes, catalogue, masterForm, button, edit, flush, harness };
