import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { createPortal } from "react-dom";

const source = name => fs.readFileSync(new URL(`../src/components/${name}.tsx`, import.meta.url), "utf8");
const connected = { provider: "google", email: "team@example.com", displayName: "Our business", status: "connected", lastTestAt: "", lastError: "" };
const providers = [{ id: "google", label: "Google", available: true }, { id: "microsoft", label: "Microsoft", available: true }];
const user = { getIdToken: async () => "test-auth" };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Execute production event handlers with a deterministic hook lifecycle. No
// network request or real mailbox is used by these component interaction tests.
function component(name, props, fetchImpl) {
  let cursor = 0;
  let tree;
  const slots = [];
  const effects = [];
  const documentBody = { nodeType: 1 };
  const location = { search: "", href: "https://example.com/direct-trade/dashboard?workspace=account", assign: value => { location.assigned = value; } };
  const same = (left, right) => left?.length === right?.length && left.every((value, index) => Object.is(value, right[index]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useId() { const index = cursor++; return `test-${index}`; },
    useCallback(callback, dependencies) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].dependencies, dependencies)) slots[index] = { dependencies, callback };
      return slots[index].callback;
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (slots[index] && same(slots[index].dependencies, dependencies)) return;
      slots[index]?.cleanup?.();
      slots[index] = { dependencies };
      effects.push(() => { slots[index].cleanup = effect(); });
    },
  };
  const compiled = ts.transpileModule(source(name), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText.replaceAll('require("./TradeBusinessProvider")', '({ useTradeBusinessFetch: () => fetch, useTradeBusiness: () => null })');
  const exported = {};
  Function("exports", "require", "fetch", "window", "document", compiled)(exported, id => {
    if (id === "react") return hooks;
    if (id === "react-dom") return { createPortal };
    if (id === "react/jsx-runtime") return jsx;
    if (id === "./TradeEmailSettings") return { TRADE_EMAIL_SETTINGS_HREF: "/direct-trade/dashboard?workspace=account#business-settings-email" };
    if (id.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
    throw new Error(`Unexpected dependency: ${id}`);
  }, fetchImpl, { location, history: { replaceState() {} } }, { body: documentBody, getElementById() { return null; } });
  function render() { cursor = 0; tree = exported[name](props); return tree; }
  function all(predicate) {
    const matches = [];
    function visit(node) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (predicate(node)) matches.push(node);
      visit(node.props?.children);
      if (node.$$typeof === Symbol.for("react.portal")) visit(node.children);
    }
    visit(tree); return matches;
  }
  const content = node => typeof node === "string" || typeof node === "number" ? String(node)
    : Array.isArray(node) ? node.map(content).join("") : node?.props ? content(node.props.children)
      : node?.$$typeof === Symbol.for("react.portal") ? content(node.children) : "";
  async function settle() {
    for (let index = 0; index < 5; index++) {
      while (effects.length) effects.shift()();
      await new Promise(resolve => setImmediate(resolve));
      render();
    }
  }
  render();
  return { all, content, render, settle, location, documentBody,
    button: label => { const button = all(node => node.type === "button" && content(node) === label)[0]; assert.ok(button, `Missing button ${label}`); return button; },
    form: () => all(node => node.type === "form")[0],
    text: () => content(tree),
  };
}

async function compose(fetchImpl, target = { customerId: "customer-1" }, workspaceScope = null) {
  const ui = component("TradeCustomerEmailComposer", { user, recipient: "customer@example.com", ...target }, fetchImpl);
  ui.button("customer@example.com").props.onClick({ stopPropagation() {}, currentTarget: { closest: selector => { assert.equal(selector, ".trade-portal-shell"); return workspaceScope; } } }); ui.render(); await ui.settle();
  ui.all(node => node.type === "input")[0].props.onChange({ target: { value: "About your quote" } });
  ui.all(node => node.type === "textarea")[0].props.onChange({ target: { value: "Hello, here is the update you requested." } });
  ui.render();
  return ui;
}

test("business setup connects with one provider action and no typed sender or credentials", async () => {
  const calls = [];
  const ui = component("TradeEmailSettings", { user }, async (url, options) => {
    calls.push([url, options]);
    return options.method === "POST" ? response({ ok: true, authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=test" })
      : response({ ok: true, providers, connection: null });
  });
  await ui.settle();
  assert.equal(ui.all(node => node.type === "input").length, 0);
  assert.equal(ui.all(node => node.type === "section" || node.type === "header" || node.type === "h3").length, 0);
  assert.equal(ui.content(ui.all(node => node.type === "h4")[0]), "Outgoing email");
  assert.equal(ui.all(node => node.type === "button").length, 2);
  assert.ok(ui.button("Connect Microsoft"));
  await ui.button("Connect Google").props.onClick(); await ui.settle();
  const posted = JSON.parse(calls.find(([, options]) => options.method === "POST")[1].body);
  assert.deepEqual(posted, { action: "connect", provider: "google" });
  assert.match(ui.location.assigned, /^https:\/\/accounts\.google\.com\//);
});

test("unavailable providers and disconnected mailboxes never appear ready", async () => {
  const ui = component("TradeEmailSettings", { user }, async () => response({ ok: true, providers: providers.map(provider => ({ ...provider, available: false })), connection: { ...connected, status: "disconnected" } }));
  await ui.settle();
  assert.equal(ui.button("Connect Google").props.disabled, true);
  assert.equal(ui.button("Connect Microsoft").props.disabled, true);
  assert.match(ui.text(), /Disconnected/);
  assert.match(ui.text(), /Email connection is currently unavailable/);
  assert.equal(ui.all(node => node.type === "button" && ui.content(node) === "Test").length, 0);
});

test("a connected outgoing email row shows the sender and compact test and disconnect controls", async () => {
  const requests = [];
  const ui = component("TradeEmailSettings", { user }, async (url, options) => {
    if (options.method === "POST") {
      requests.push(JSON.parse(options.body));
      return response({ ok: true, status: "accepted" });
    }
    return response({ ok: true, providers, connection: connected });
  });
  await ui.settle();
  assert.match(ui.text(), /team@example.comConnected/);
  assert.deepEqual(ui.all(node => node.type === "button").map(ui.content), ["Test", "Disconnect"]);
  await ui.button("Test").props.onClick(); await ui.settle();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].action, "test");
  assert.ok(requests[0].requestId);
  assert.equal(requests[0].recipient, undefined);
  assert.match(ui.text(), /Test email accepted/);
});

test("outgoing email lives inside the existing Account section without a separate navigation entry", () => {
  const content = source("TradeBusinessSettingsWorkspace");
  const parsed = ts.createSourceFile("TradeBusinessSettingsWorkspace.tsx", content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let emailSetting;
  function find(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsed) === "TradeEmailSettings") emailSetting = node;
    ts.forEachChild(node, find);
  }
  find(parsed);
  assert.ok(emailSetting);
  let section = emailSetting.parent;
  while (section && !(ts.isJsxElement(section) && section.openingElement.tagName.getText(parsed) === "section")) section = section.parent;
  assert.ok(section);
  assert.match(section.openingElement.getText(parsed), /id="business-settings-account"/);
  assert.ok(section.getText(parsed).indexOf("{profile.businessName}") < section.getText(parsed).indexOf("<TradeEmailSettings"));
  assert.doesNotMatch(content, /id: "email", label: "Email"/);
});

test("authorised connection is usable immediately without a mandatory test", async () => {
  const calls = [];
  const ui = await compose(async (url, options) => {
    calls.push([url, options]);
    return url === "/api/trade-email" ? response({ ok: true, connection: connected }) : response({ ok: true, status: "accepted" });
  });
  assert.equal(ui.button("Send email").props.disabled, false);
  assert.match(ui.text(), /team@example.com/);
  await ui.form().props.onSubmit({ preventDefault() {} }); await ui.settle();
  const [url, options] = calls.find(([url]) => url === "/api/trade-customer-email");
  assert.equal(url, "/api/trade-customer-email");
  const body = JSON.parse(options.body);
  assert.equal(body.customerId, "customer-1");
  assert.ok(body.requestId);
  assert.equal(body.recipient, undefined);
  assert.equal(body.from, undefined);
  assert.match(ui.text(), /Email accepted for sending/);
  assert.doesNotMatch(ui.text(), /Email delivered/);
});

test("network ambiguity retains content and request identity when checking again", async () => {
  const requests = [];
  const ui = await compose(async (url, options) => {
    if (url === "/api/trade-email") return response({ ok: true, connection: connected });
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) throw new TypeError("Network connection lost");
    return response({ ok: false, status: "uncertain", error: "Delivery outcome needs checking." }, 409);
  }, { enquiryId: "match-1" });
  await ui.form().props.onSubmit({ preventDefault() {} }); await ui.settle();
  assert.equal(ui.all(node => node.type === "textarea")[0].props.readOnly, true);
  assert.match(ui.text(), /not confirmed/);
  assert.equal(ui.all(node => node.type === "button" && ui.content(node) === "New email").length, 0);
  await ui.form().props.onSubmit({ preventDefault() {} }); await ui.settle();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(requests[0].enquiryId, "match-1");
  assert.ok(ui.button("Check send result"));
});

test("a double submit makes one request and changing rejected content gets a fresh identity", async () => {
  const requests = [];
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const ui = await compose(async (url, options) => {
    if (url === "/api/trade-email") return response({ ok: true, connection: connected });
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) return pending;
    return response({ ok: true, status: "accepted" });
  }, { workOrderId: "job-1" });
  const first = ui.form().props.onSubmit({ preventDefault() {} });
  const duplicate = ui.form().props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1);
  finish(response({ ok: false, error: "Please update this message." }, 400));
  await Promise.all([first, duplicate]); await ui.settle();
  assert.equal(ui.all(node => node.type === "textarea")[0].props.readOnly, false);
  ui.all(node => node.type === "textarea")[0].props.onChange({ target: { value: "Updated requested message." } }); ui.render();
  await ui.form().props.onSubmit({ preventDefault() {} }); await ui.settle();
  assert.equal(requests[1].workOrderId, "job-1");
  assert.notEqual(requests[1].requestId, requests[0].requestId);
});

test("connection absence blocks sending and points to the correct Business settings section", async () => {
  const calls = [];
  const ui = await compose(async url => { calls.push(url); return response({ ok: true, connection: null }); });
  assert.equal(ui.button("Send email").props.disabled, true);
  await ui.form().props.onSubmit({ preventDefault() {} }); await ui.settle();
  assert.deepEqual(calls, ["/api/trade-email"]);
  assert.equal(ui.all(node => node.type === "a")[0].props.href, "/direct-trade/dashboard?workspace=account#business-settings-email");
});

test("an explicit provider rejection is editable even when the API responds with HTTP 502", async () => {
  const ui = await compose(async url => url === "/api/trade-email"
    ? response({ ok: true, connection: connected })
    : response({ ok: false, status: "failed", error: "The provider rejected this email." }, 502));
  await ui.form().props.onSubmit({ preventDefault() {} }); await ui.settle();
  assert.equal(ui.all(node => node.type === "textarea")[0].props.readOnly, false);
  assert.match(ui.text(), /The provider rejected this email/);
  assert.ok(ui.button("Send email"));
  assert.equal(ui.all(node => node.type === "input")[0].props.maxLength, 200);
  assert.equal(ui.all(node => node.type === "textarea")[0].props.maxLength, 8000);
});

test("customer, job, lead and schedule email actions preserve server-owned recipient selectors", () => {
  const crm = source("InstallerCrmWorkspace");
  const dashboard = source("DirectTradeDashboard");
  const schedule = source("TradeScheduleWorkspace");
  assert.match(crm, /TradeCustomerEmailComposer user=\{user\} customerId=\{customer\.id\}/);
  assert.match(crm, /TradeCustomerEmailComposer user=\{user\} workOrderId=\{job\.id\}/);
  assert.match(dashboard, /!contactFieldIsRedacted\(releasedCustomerContact, "email"\) \? <TradeCustomerEmailComposer user=\{user\} enquiryId=\{opportunity\.matchId\}/);
  assert.match(schedule, /TradeCustomerEmailComposer user=\{user\} workOrderId=\{selectedAppointment\.workOrderId\}/);
  for (const content of [crm, dashboard, schedule]) assert.doesNotMatch(content, /href=\{`mailto:/);
  assert.match(source("TradeCustomerEmailComposer"), /showModal\(\)/);
});

test("the email dialog is a body portal while its trigger stays in the contact wrapper", async () => {
  const ui = await compose(async () => response({ ok: true, connection: connected }));
  const portals = ui.all(node => node.$$typeof === Symbol.for("react.portal"));
  assert.equal(portals.length, 1);
  assert.equal(portals[0].containerInfo, ui.documentBody);
  assert.equal(portals[0].children.type, "dialog");
  const inlineChildren = ui.render().props.children;
  assert.equal(inlineChildren[0].type, "button");
  assert.equal(inlineChildren.some(node => node?.type === "dialog"), false);
});

test("a workspace email dialog retains its theme scope without nesting in a contact row", async () => {
  const workspaceScope = { nodeType: 1, className: "trade-portal-shell" };
  const ui = await compose(async () => response({ ok: true, connection: connected }), { workOrderId: "job-1" }, workspaceScope);
  const portal = ui.all(node => node.$$typeof === Symbol.for("react.portal"))[0];
  assert.equal(portal.containerInfo, workspaceScope);
  assert.notEqual(portal.containerInfo, ui.documentBody);
  assert.equal(ui.render().props.children[0].type, "button");
});

test("customer email remains outside the disabled editing fieldset while SMS and edits retain their gate", () => {
  const parsed = ts.createSourceFile("InstallerCrmWorkspace.tsx", source("InstallerCrmWorkspace"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let customerDetail;
  function find(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "CustomerDetail") customerDetail = node;
    ts.forEachChild(node, find);
  }
  find(parsed);
  assert.ok(customerDetail);
  const returned = customerDetail.body.statements.findLast(node => ts.isReturnStatement(node));
  const children = returned.expression.children.filter(ts.isJsxElement);
  assert.equal(children[0].openingElement.tagName.getText(parsed), "header");
  assert.match(children[0].getText(parsed), /TradeCustomerEmailComposer/);
  assert.equal(children[1].openingElement.tagName.getText(parsed), "fieldset");
  assert.match(children[1].openingElement.getText(parsed), /disabled=\{readOnly\}/);
  assert.match(children[1].getText(parsed), /TradeCustomerSmsPanel/);
  assert.match(children[1].getText(parsed), /onSubmit=\{saveAccount\}/);
  assert.doesNotMatch(children[1].getText(parsed), /TradeCustomerEmailComposer/);
});
