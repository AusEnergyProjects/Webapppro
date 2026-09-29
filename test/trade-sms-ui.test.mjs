import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as sms from "../src/lib/trade-sms.ts";
import * as reminders from "../src/lib/service-reminder-delivery.ts";
import * as followUps from "../src/lib/trade-follow-ups.ts";

const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, name) => nodes(tree, node => node.type === "button" && text(node) === name)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const connection = { provider: "twilio", number: "+61400000000", accountLabel: "Test trade", accountType: "Full", dailyLimit: 100, usedSegments: 0, status: "connected" };
const conversation = (overrides = {}) => ({ ok: true, connection, customerPhone: "+61400000001", consent: "allowed", messages: [], canManageConnection: true, jobNumber: "", jobs: [], businessName: "Test trade", marketingConsent: "required", partPriceMicro: 99000, balanceMicro: 50000000, ...overrides });
const reply = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
const fixtureComponents = { TradeSmsDashboard: () => null, TradeSmsAutomationPanel: () => null };

function harness(component, responder, props = {}) {
  const source = fs.readFileSync(new URL(`../src/components/${component}.tsx`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText.replaceAll('require("./TradeBusinessProvider")', '({ useTradeBusinessFetch: () => fetch, useTradeBusiness: () => null })');
  const slots = [], effects = [], callbacks = [], pending = [], requests = [];
  let cursor = 0;
  const changed = (before, after) => !before || after.some((value, index) => value !== before[index]);
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useId() { return `fixture-${cursor++}`; },
    useCallback(callback, deps) { const index = cursor++; if (changed(callbacks[index]?.deps, deps)) callbacks[index] = { callback, deps }; return callbacks[index].callback; },
    useEffect(callback, deps) { const index = cursor++; if (changed(effects[index]?.deps, deps)) { effects[index]?.cleanup?.(); effects[index] = { deps }; pending.push(() => { effects[index].cleanup = callback(); }); } },
  };
  const exports = {};
  const user = { getIdToken: async () => "fixture-token" };
  const router = { push() {} }, alerts = { refresh() {}, setActiveThread() {} };
  const require = id => id === "react" ? hooks : id === "react/jsx-runtime" ? jsx : id === "@/lib/trade-sms" ? sms : id === "@/lib/service-reminder-delivery" ? reminders : id === "@/lib/trade-follow-ups" ? followUps
    : id === "next/navigation" ? { useRouter: () => router } : id === "./TradeMessageAlerts" ? { useTradeMessageAlerts: () => alerts }
    : id === "./TradeSmsDashboard" || id === "./TradeSmsAutomationPanel" ? fixtureComponents : id === "./TradeEmailSettings" ? { TRADE_EMAIL_SETTINGS_HREF: "/settings" }
    : id.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : {};
  const fetch = async (url, init) => { const payload = init.body ? JSON.parse(init.body) : null; requests.push({ url, init, payload }); return responder(payload, requests); };
  class FormDataFixture { constructor(values) { this.values = values; } get(key) { return this.values[key]; } }
  const navigations = [];
  Function("require", "exports", "fetch", "window", "document", "FormData", compiled)(require, exports, fetch, { location: { search: "", assign: url => navigations.push(url) }, addEventListener() {}, removeEventListener() {}, setTimeout: callback => setTimeout(callback, 0), clearTimeout, setInterval() {}, clearInterval() {}, confirm: () => true }, { visibilityState: "visible", addEventListener() {}, removeEventListener() {} }, FormDataFixture);
  const render = () => { cursor = 0; const tree = exports[component]({ user, customerId: "customer-a", onOpenIntegrations() {}, ...props }); for (const effect of pending.splice(0)) effect(); return tree; };
  return { render, requests, navigations, async mount() { render(); await flush(); return render(); }, async settle() { await flush(); render(); return render(); }, cleanup() { for (const effect of effects) effect?.cleanup?.(); } };
}

function draft(h, tree, body = "Appointment tomorrow at 9am.") {
  nodes(tree, node => node.type === "textarea").at(-1).props.onChange({ target: { value: body } });
  return h.render();
}
function submit(tree, currentTarget = {}) { nodes(tree, node => node.type === "form").at(-1).props.onSubmit({ preventDefault() {}, currentTarget }); }

test("uncertain SMS retries retain the original request ID and body, then show real delivery status", async () => {
  let attempts = 0;
  const h = harness("TradeCustomerSmsPanel", async payload => {
    if (!payload) return reply(conversation());
    attempts++;
    if (attempts === 1) throw new Error("Network lost after dispatch");
    return reply({ ok: true, message: { id: "m1", requestId: payload.requestId, direction: "outbound", body: payload.body, status: "unknown", createdAt: "2026-09-21T01:00:00Z" } });
  });
  let tree = draft(h, await h.mount()); submit(tree); tree = await h.settle();
  assert.match(text(tree), /result is not confirmed/);
  assert.ok(button(tree, "Check this message"));
  assert.equal(nodes(tree, node => node.type === "textarea")[0].props.disabled, true);
  submit(tree); tree = await h.settle();
  const sends = h.requests.filter(item => item.payload?.action === "send");
  assert.equal(sends.length, 2);
  assert.equal(sends[0].payload.requestId, sends[1].payload.requestId);
  assert.equal(sends[0].payload.body, sends[1].payload.body);
  assert.match(text(tree), /Delivery is not confirmed/);
  assert.doesNotMatch(text(tree), /SMS sent|Message sent successfully/);
  h.cleanup();
});

test("rapid double submit sends one request while the first is in flight", async () => {
  let release;
  const h = harness("TradeCustomerSmsPanel", async payload => payload ? new Promise(resolve => { release = resolve; }) : reply(conversation()));
  const tree = draft(h, await h.mount()); submit(tree); submit(tree); await flush();
  assert.equal(h.requests.filter(item => item.payload?.action === "send").length, 1);
  release(reply({ ok: false, error: "Daily SMS limit reached." }, 429));
  const result = await h.settle(); assert.match(text(result), /Daily SMS limit reached/);
  assert.equal(nodes(result, node => node.type === "textarea")[0].props.disabled, false);
  h.cleanup();
});

test("customer STOP blocks sending and cannot be replaced with trade-recorded permission", async () => {
  const h = harness("TradeCustomerSmsPanel", async () => reply(conversation({ consent: "opted_out" })));
  const tree = await h.mount();
  assert.match(text(tree), /opted out/);
  assert.equal(button(tree, "Record permission"), undefined);
  assert.equal(button(tree, "Send SMS"), undefined);
  assert.equal(nodes(tree, node => node.type === "textarea").length, 0);
  assert.equal(h.requests[0].init.headers.Authorization, "Bearer fixture-token");
  assert.equal(h.requests[0].init.cache, "no-store"); h.cleanup();
});

test("unconfirmed routing prevents the SMS composer and offers connection recovery", async () => {
  const h = harness("TradeCustomerSmsPanel", async () => reply(conversation({ connection: { ...connection, status: "connecting" } })));
  const tree = await h.mount(); assert.match(text(tree), /routing is not confirmed/);
  assert.ok(button(tree, "Check SMS connection")); assert.equal(button(tree, "Send SMS"), undefined); h.cleanup();
});

test("history refresh reconciles an uncertain submission using its request ID", async () => {
  let accepted;
  const h = harness("TradeCustomerSmsPanel", async payload => {
    if (!payload) return reply(conversation({ messages: accepted ? [accepted] : [] }));
    accepted = { id: "m1", requestId: payload.requestId, direction: "outbound", body: payload.body, status: "delivered", createdAt: "2026-09-21T01:00:00Z" };
    throw new Error("Lost acknowledgement");
  });
  let tree = draft(h, await h.mount()); submit(tree); tree = await h.settle();
  button(tree, "Refresh").props.onClick(); tree = await h.settle();
  assert.match(text(tree), /Message found in your history/); assert.match(text(tree), /Delivered/);
  assert.equal(nodes(tree, node => node.type === "textarea")[0].props.value, "");
  assert.equal(h.requests.filter(item => item.payload).length, 1); h.cleanup();
});

test("a single verified number is preselected with the daily cap and direct billing made visible", async () => {
  const h = harness("TradeLegacySmsConnectionPanel", async payload => payload ? reply({ ok: true, accountLabel: "Test trade", accountType: "Trial", numbers: [{ sid: "PNfixture", number: "+61400000000", label: "Business" }] }) : reply({ ok: true, connection: null }));
  let tree = await h.mount(); submit(tree, { accountSid: "AC" + "a".repeat(32), authToken: "fixture-token" }); tree = await h.settle();
  assert.equal(nodes(tree, node => node.type === "select")[0].props.value, "PNfixture");
  assert.equal(nodes(tree, node => node.type === "input" && node.props.type === "number")[0].props.value, "100");
  assert.match(text(tree), /Twilio bills you directly/); assert.match(text(tree), /Only recipients verified in Twilio/);
  assert.equal(button(tree, "Connect SMS").props.disabled, false); h.cleanup();
});

test("a saved connection with failed status refresh provides recovery without a dead Connect button", async () => {
  let saved = false, refreshFailed = false;
  const h = harness("TradeLegacySmsConnectionPanel", async payload => {
    if (payload?.action === "inspect") return reply({ ok: true, numbers: [{ sid: "PNfixture", number: "+61400000000", label: "Business" }] });
    if (payload?.action === "connect") { saved = true; return reply({ ok: true }); }
    if (saved && !refreshFailed) { refreshFailed = true; throw new Error("Offline"); }
    return reply({ ok: true, connection: saved ? connection : null });
  });
  let tree = await h.mount(); submit(tree, { accountSid: "AC" + "a".repeat(32), authToken: "fixture-token" }); tree = await h.settle();
  button(tree, "Connect SMS").props.onClick(); tree = await h.settle();
  assert.match(text(tree), /connection was saved/); assert.equal(button(tree, "Connect SMS"), undefined);
  button(tree, "Refresh connection").props.onClick(); tree = await h.settle();
  assert.match(text(tree), /Connected/); assert.match(text(tree), /\+61400000000/);
  assert.equal(h.requests.filter(item => item.payload?.action === "connect").length, 1); h.cleanup();
});

test("staff job SMS uses field-session authentication and sends the exact job while hiding owner setup", async () => {
  const h = harness("TradeCustomerSmsPanel", async payload => payload ? reply({ ok: false, error: "Test only" }, 409) : reply(conversation({ canManageConnection: false, jobNumber: "TLJ-12345678" })),
    { user: undefined, workOrderId: "job-1", getAuthHeaders: async () => ({ Authorization: "TLinkField fixture", "x-aea-device-id": "device-1" }) });
  let tree = await h.mount();
  assert.match(text(tree), /business can see and reply/); assert.match(text(tree), /TLJ-12345678/);
  assert.equal(h.requests[0].init.headers.Authorization, "TLinkField fixture");
  assert.equal(h.requests[0].init.headers["x-aea-device-id"], "device-1");
  assert.match(h.requests[0].url, /workOrderId=job-1/);
  tree = draft(h, tree); submit(tree); await h.settle();
  assert.equal(h.requests.find(item => item.payload?.action === "send").payload.workOrderId, "job-1");
  h.cleanup();
  const unconnected = harness("TradeCustomerSmsPanel", async () => reply(conversation({ canManageConnection: false, connection: null })));
  tree = await unconnected.mount(); assert.match(text(tree), /Ask the business owner/); assert.equal(button(tree, "Set up SMS"), undefined); unconnected.cleanup();
});

test("shared history labels actual staff senders and lets only the owner link an ambiguous reply", async () => {
  let linked = false;
  const messages = [{ id: "sent-1", senderName: "Jane Installer", workOrderId: "job-1", direction: "outbound", body: "Hello", status: "delivered", createdAt: "2026-09-28T00:00:00Z" },
    { id: "reply-1", senderName: "", workOrderId: "", direction: "inbound", body: "Which date?", status: "received", createdAt: "2026-09-28T00:01:00Z" }];
  const h = harness("TradeCustomerSmsPanel", async payload => {
    if (payload) { assert.equal(payload.action, "link_reply"); assert.equal(payload.workOrderId, "job-2"); assert.equal(payload.messageId, "reply-1"); linked = true; return reply({ ok: true }); }
    return reply(conversation({ messages: messages.map(message => message.id === "reply-1" && linked ? { ...message, workOrderId: "job-2" } : message), jobs: [{ id: "job-2", jobNumber: "TLJ-12345678" }] }));
  });
  let tree = await h.mount(); assert.match(text(tree), /Jane Installer/); assert.match(text(tree), /Business only/);
  assert.equal(button(tree, "Link reply").props.disabled, true);
  nodes(tree, node => node.type === "select")[0].props.onChange({ target: { value: "job-2" } });
  tree = h.render(); button(tree, "Link reply").props.onClick(); tree = await h.settle();
  assert.equal(button(tree, "Link reply"), undefined); assert.match(text(tree), /Reply shared/); h.cleanup();
  const staff = harness("TradeCustomerSmsPanel", async () => reply(conversation({ canManageConnection: false, messages, jobs: [] })));
  tree = await staff.mount(); assert.equal(button(tree, "Link reply"), undefined); staff.cleanup();
});

const managedConversation = (overrides = {}) => conversation({ connection: { ...connection, provider: "clicksend" }, ...overrides });
const smsAccount = (overrides = {}) => ({ ok: true, configured: true, billingConfigured: true, urlsEnabled: true,
  pricing: { partPriceMicro: 99000, taxLabel: "9¢ + GST per SMS part", minimumTopUpCents: 5000 },
  wallet: { balanceMicro: 50000000, reservedMicro: 1000000 }, connection: null, order: null, ledger: [],
  setup: { businessName: "Test trade", contactName: "Sam", email: "sam@example.test", phone: "0412345678", address: "1 Example St", suburb: "Sydney", state: "NSW", postcode: "2000" }, ...overrides });
const australianNumber = { number: "+61412345678", monthlyMicro: 22000000, setupMicro: 5500000, totalMicro: 27500000, currency: "AUD" };

test("managed composer prices the final GSM or Unicode body including sender, job and STOP footer", async () => {
  const h = harness("TradeCustomerSmsPanel", async () => reply(managedConversation({ businessName: "A".repeat(80), jobNumber: "TLJ-12345678" })), { workOrderId: "job-1" });
  let tree = draft(h, await h.mount(), "Hello ".repeat(15));
  const gsmParts = sms.smsSegments(sms.tradeSmsBody("Hello ".repeat(15), "A".repeat(80)) + "\nJob TLJ-12345678");
  assert.match(text(tree).replace(/\s+/g, " "), new RegExp(`${gsmParts} SMS parts.*\\$0\\.198 including GST`));
  tree = draft(h, tree, "😀".repeat(36));
  const unicodeParts = sms.smsSegments(sms.tradeSmsBody("😀".repeat(36), "A".repeat(80)) + "\nJob TLJ-12345678");
  assert.match(text(tree).replace(/\s+/g, " "), new RegExp(`${unicodeParts} SMS parts`));
  assert.match(text(tree), /9¢ \+ GST/); h.cleanup();
});

test("managed low balance blocks new sends but preserves an unknown request for status checking", async () => {
  let attempts = 0, low = false;
  const h = harness("TradeCustomerSmsPanel", async payload => {
    if (!payload) return reply(managedConversation({ marketingConsent: "allowed", balanceMicro: low ? 0 : 50000000 }));
    attempts++; low = true; throw new Error("Connection lost after send");
  });
  let tree = draft(h, await h.mount()); submit(tree); tree = await h.settle();
  button(tree, "Refresh").props.onClick(); tree = await h.settle();
  assert.equal(button(tree, "Check this message").props.disabled, false);
  submit(tree); await h.settle();
  assert.equal(attempts, 2); assert.deepEqual(h.requests.filter(item => item.payload).map(item => item.payload.requestId), [h.requests.find(item => item.payload).payload.requestId, h.requests.find(item => item.payload).payload.requestId]); h.cleanup();
  const empty = harness("TradeCustomerSmsPanel", async () => reply(managedConversation({ balanceMicro: 0 })));
  tree = draft(empty, await empty.mount()); assert.equal(button(tree, "Send SMS").props.disabled, true);
  submit(tree); await empty.settle(); assert.equal(empty.requests.filter(item => item.payload).length, 0); empty.cleanup();
});

test("review permission must be separately saved before choosing marketing and STOP suppresses both", async () => {
  let permission = false;
  const h = harness("TradeCustomerSmsPanel", async payload => {
    if (!payload) return reply(managedConversation({ marketingConsent: permission ? "allowed" : "required" }));
    assert.equal(payload.action, "marketing_consent"); assert.equal(payload.consentNote, "Customer agreed on their booking form."); permission = true; return reply({ ok: true });
  });
  let tree = await h.mount();
  assert.equal(nodes(tree, node => node.type === "option" && node.props.value === "marketing")[0].props.disabled, true);
  nodes(tree, node => node.type === "textarea")[0].props.onChange({ target: { value: "Customer agreed on their booking form." } }); tree = h.render();
  nodes(tree, node => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); tree = await h.settle();
  assert.equal(nodes(tree, node => node.type === "option" && node.props.value === "marketing")[0].props.disabled, false);
  assert.equal(button(tree, "Record review permission"), undefined); h.cleanup();
  const stopped = harness("TradeCustomerSmsPanel", async () => reply(managedConversation({ consent: "opted_out", marketingConsent: "allowed" })));
  tree = await stopped.mount(); assert.equal(nodes(tree, node => node.type === "textarea").length, 0); assert.equal(button(tree, "Send SMS"), undefined); assert.equal(button(tree, "Record review permission"), undefined); stopped.cleanup();
});

test("an uncertain marketing send freezes the original purpose as well as body and request ID", async () => {
  const h = harness("TradeCustomerSmsPanel", async payload => payload ? Promise.reject(new Error("Lost acknowledgement")) : reply(managedConversation({ marketingConsent: "allowed" })));
  let tree = await h.mount(); nodes(tree, node => node.type === "select")[0].props.onChange({ target: { value: "marketing" } });
  tree = draft(h, h.render(), "Would you share feedback on our visit?"); submit(tree); tree = await h.settle();
  assert.equal(nodes(tree, node => node.type === "select")[0].props.disabled, true);
  submit(tree); await h.settle(); const sends = h.requests.filter(item => item.payload?.action === "send");
  assert.equal(sends[0].payload.purpose, "marketing"); assert.deepEqual(sends[1].payload, sends[0].payload); h.cleanup();
});

test("managed dashboard shows available balance once, honest setup state and no provider credentials", async () => {
  const h = harness("TradeSmsDashboard", async () => reply(smsAccount({ configured: false, billingConfigured: false, urlsEnabled: false })));
  const tree = await h.mount(); assert.match(text(tree), /\$50\.00/); assert.doesNotMatch(text(tree), /\$49\.00/);
  assert.match(text(tree), /setup is being completed/); assert.equal(button(tree, "Top up credit").props.disabled, true);
  assert.match(text(tree), /SMS links are awaiting provider approval/);
  assert.equal(button(tree, "Find an Australian number").props.disabled, true);
  assert.equal(nodes(tree, node => node.type === "input" && node.props.type === "password").length, 0);
  assert.equal(h.requests[0].url, "/api/trade-sms/account"); assert.equal(h.requests[0].init.headers.Authorization, "Bearer fixture-token"); h.cleanup();
  const staff = harness("TradeSmsDashboard", async () => { throw new Error("Must not load owner SMS wallet"); }, { canManage: false });
  assert.equal(await staff.mount(), null); assert.equal(staff.requests.length, 0); staff.cleanup();
});

test("topups use fixed $50 minimum amounts and preserve one request through unknown responses", async () => {
  let attempts = 0;
  const h = harness("TradeSmsDashboard", async payload => {
    if (!payload) return reply(smsAccount());
    attempts++; assert.equal(payload.action, "top_up"); assert.equal(payload.amountCents, 5000);
    if (attempts === 1) throw new Error("Checkout response lost");
    return reply({ ok: true, checkoutUrl: "https://checkout.stripe.com/c/pay/fixture" });
  });
  let tree = await h.mount(); button(tree, "Top up credit").props.onClick(); tree = h.render();
  assert.deepEqual(nodes(tree, node => node.type === "input" && node.props.type === "radio").length, 3);
  assert.match(text(tree), /Minimum top-up \$50/); assert.match(text(tree), /No automatic card charges/);
  button(tree, "Continue with $50").props.onClick(); tree = await h.settle();
  assert.equal(nodes(tree, node => node.type === "fieldset")[0].props.disabled, true);
  button(tree, "Continue $50 checkout").props.onClick(); await h.settle();
  const topups = h.requests.filter(item => item.payload); assert.equal(topups[0].payload.requestId, topups[1].payload.requestId);
  assert.deepEqual(h.navigations, ["https://checkout.stripe.com/c/pay/fixture"]); h.cleanup();
});

test("checkout only navigates to Stripe and never redirects after dashboard unmount", async () => {
  const foreign = harness("TradeSmsDashboard", async payload => reply(payload ? { ok: true, checkoutUrl: "https://checkout.stripe.com.evil.test/pay" } : smsAccount()));
  let tree = await foreign.mount(); button(tree, "Top up credit").props.onClick(); tree = foreign.render(); button(tree, "Continue with $50").props.onClick(); tree = await foreign.settle();
  assert.match(text(tree), /could not be verified/); assert.equal(foreign.navigations.length, 0); foreign.cleanup();
  let release;
  const closed = harness("TradeSmsDashboard", payload => payload ? new Promise(resolve => { release = resolve; }) : reply(smsAccount()));
  tree = await closed.mount(); button(tree, "Top up credit").props.onClick(); tree = closed.render(); button(tree, "Continue with $50").props.onClick(); await flush(); closed.cleanup();
  release(reply({ ok: true, checkoutUrl: "https://checkout.stripe.com/c/pay/fixture" })); await flush(); assert.equal(closed.navigations.length, 0);
});

test("rental presents only AU inventory, price review and explicit recurring charge agreement", async () => {
  const h = harness("TradeSmsDashboard", async (payload, requests) => {
    if (requests.at(-1).url.endsWith("/numbers")) return reply({ ok: true, numbers: [australianNumber, { ...australianNumber, number: "+12025550100", currency: "AUD" }] });
    return reply(smsAccount());
  });
  let tree = await h.mount(); button(tree, "Find an Australian number").props.onClick(); tree = await h.settle();
  assert.equal(nodes(tree, node => node.type === "option" && node.props.value === "+12025550100").length, 0);
  assert.equal(nodes(tree, node => node.type === "select")[0].props.value, australianNumber.number);
  assert.match(text(tree), /\$27\.50/); submit(tree); tree = h.render();
  assert.match(text(tree), /Rental renews monthly/); assert.match(text(tree), /Your card is never charged automatically/);
  assert.equal(button(tree, "Confirm $27.50 reservation").props.disabled, true);
  assert.equal(h.requests.filter(item => item.payload).length, 0); h.cleanup();
});

test("an uncertain number rental freezes the number, charges, registration and request for safe retry", async () => {
  let attempts = 0;
  const h = harness("TradeSmsDashboard", async (payload, requests) => {
    if (requests.at(-1).url.endsWith("/numbers")) return reply({ ok: true, numbers: [australianNumber] });
    if (payload) { attempts++; throw new Error("Number response lost"); }
    return reply(smsAccount());
  });
  let tree = await h.mount(); button(tree, "Find an Australian number").props.onClick(); tree = await h.settle(); submit(tree); tree = h.render();
  nodes(tree, node => node.type === "input" && node.props.type === "checkbox")[0].props.onChange({ target: { checked: true } }); tree = h.render();
  button(tree, "Confirm $27.50 reservation").props.onClick(); tree = await h.settle();
  assert.equal(nodes(tree, node => node.type === "select")[0].props.disabled, true); assert.equal(button(tree, "Refresh numbers").props.disabled, true);
  button(tree, "Check this rental request").props.onClick(); await h.settle();
  const rentals = h.requests.filter(item => item.payload); assert.equal(attempts, 2); assert.deepEqual(rentals[0].payload, rentals[1].payload);
  assert.equal(rentals[0].payload.acceptedMonthlyMicro, australianNumber.monthlyMicro); assert.equal(rentals[0].payload.acceptedSetupMicro, australianNumber.setupMicro);
  assert.equal(rentals[0].payload.acceptedInitialReservedMicro, australianNumber.totalMicro);
  assert.equal(rentals[0].payload.termsAccepted, true); assert.equal(rentals[0].payload.registration.businessName, "Test trade"); h.cleanup();
});

test("rental reserves the quoted maximum rather than presenting a prorated quote as the final charge", async () => {
  for (const [totalMicro, expectedMaximum] of [[6500000, 27500000], [30000000, 30000000]]) {
    const quote = { ...australianNumber, totalMicro };
    const h = harness("TradeSmsDashboard", async (payload, requests) => {
      if (requests.at(-1).url.endsWith("/numbers")) return reply({ ok: true, numbers: [quote] });
      if (payload) throw new Error("Provider response pending");
      return reply(smsAccount());
    });
    let tree = await h.mount(); button(tree, "Find an Australian number").props.onClick(); tree = await h.settle();
    assert.match(text(tree), /Maximum initial reservation/); submit(tree); tree = h.render();
    assert.match(text(tree), /prorated to the first day of next month \(AEST\)/);
    assert.match(text(tree), /Unused reservation is returned.*after the provider confirms the initial charge/);
    assert.match(text(tree), /no TLink markup/);
    nodes(tree, node => node.type === "input" && node.props.type === "checkbox")[0].props.onChange({ target: { checked: true } }); tree = h.render();
    button(tree, `Confirm $${(expectedMaximum / 1000000).toFixed(2)} reservation`).props.onClick(); await h.settle();
    assert.equal(h.requests.find(item => item.payload).payload.acceptedInitialReservedMicro, expectedMaximum);
    h.cleanup();
  }
  const low = harness("TradeSmsDashboard", async (_payload, requests) => reply(requests.at(-1).url.endsWith("/numbers")
    ? { ok: true, numbers: [{ ...australianNumber, totalMicro: 6500000 }] }
    : smsAccount({ wallet: { balanceMicro: 10000000, reservedMicro: 0 } })));
  let tree = await low.mount(); button(tree, "Find an Australian number").props.onClick(); tree = await low.settle();
  assert.equal(button(tree, "Review number rental").props.disabled, true);
  assert.match(text(tree).replace(/\s+/g, " "), /Add \$17\.50 or more to cover the maximum initial rental reservation/);
  assert.equal(low.requests.filter(item => item.payload).length, 0); low.cleanup();
});

test("rental status distinguishes unknown initial charges from confirmed zero and uses the provider renewal timezone", async () => {
  const order = { id: "order-1", status: "active", number: australianNumber.number, monthlyMicro: 22000000, setupMicro: 5500000,
    initialReservedMicro: 27500000, initialChargeMicro: null, initialChargeSettled: true, renewalAt: "2026-09-30T14:00:00Z", error: "" };
  for (const initialChargeMicro of [null, 0, 6500000]) {
    const h = harness("TradeSmsDashboard", async () => reply(smsAccount({ order: { ...order, initialChargeMicro } })));
    const tree = await h.mount();
    assert.match(text(tree), /Next rental renewal \(AEST\):\s*01\/10\/2026/);
    if (initialChargeMicro === null) {
      assert.match(text(tree), /Initial rental reservation: up to\s*\$27\.50/);
      assert.doesNotMatch(text(tree), /Confirmed initial charge/);
    } else {
      assert.match(text(tree).replace(/\s+/g, " "), new RegExp(`Confirmed initial charge: \\$${(initialChargeMicro / 1000000).toFixed(2).replace(".", "\\.")} including GST`));
      assert.match(text(tree), new RegExp(`\\$${((27500000 - initialChargeMicro) / 1000000).toFixed(2).replace(".", "\\.")} of unused reservation returned`));
    }
    h.cleanup();
  }
  const pending = harness("TradeSmsDashboard", async () => reply(smsAccount({ order: { ...order, status: "registering", initialChargeMicro: 6500000, initialChargeSettled: false, renewalAt: "" } })));
  const tree = await pending.mount();
  assert.match(text(tree), /\$21\.00 of unused reservation will return.*once number setup is confirmed/);
  assert.doesNotMatch(text(tree), /unused reservation returned/); pending.cleanup();
});

test("number rental cannot proceed without sufficient credit and cancellation remains pending release", async () => {
  const empty = harness("TradeSmsDashboard", async (payload, requests) => reply(requests.at(-1).url.endsWith("/numbers") ? { ok: true, numbers: [australianNumber] } : smsAccount({ wallet: { balanceMicro: 0, reservedMicro: 0 } })));
  let tree = await empty.mount(); button(tree, "Find an Australian number").props.onClick(); tree = await empty.settle();
  assert.equal(button(tree, "Review number rental").props.disabled, true); assert.ok(button(tree, "Add credit for this number")); empty.cleanup();
  const order = { id: "order-1", status: "active", number: australianNumber.number, monthlyMicro: 22000000, setupMicro: 5500000, renewalAt: "2026-10-29T00:00:00Z", error: "" };
  const h = harness("TradeSmsDashboard", async payload => reply(payload ? { ok: true, order: { ...order, status: "cancel_pending" } } : smsAccount({ order, connection: { ...connection, provider: "clicksend" } })));
  tree = await h.mount(); button(tree, "Cancel rental").props.onClick(); tree = h.render();
  assert.equal(h.requests.filter(item => item.payload).length, 0); button(tree, "Request cancellation").props.onClick(); tree = await h.settle();
  assert.match(text(tree), /Cancellation requested/); assert.match(text(tree), /provider confirms release/); assert.equal(button(tree, "Cancel rental"), undefined); h.cleanup();
});

test("a definitive validation failure unlocks rental details and a changed price requires a fresh quote", async () => {
  for (const code of ["SMS_REGISTRATION_INVALID", "SMS_NUMBER_PRICE_CHANGED"]) {
    const h = harness("TradeSmsDashboard", async (payload, requests) => {
      if (requests.at(-1).url.endsWith("/numbers")) return reply({ ok: true, numbers: [australianNumber] });
      return reply(payload ? { ok: false, code, error: "Correct the rental details." } : smsAccount(), payload ? 422 : 200);
    });
    let tree = await h.mount(); button(tree, "Find an Australian number").props.onClick(); tree = await h.settle(); submit(tree); tree = h.render();
    nodes(tree, node => node.type === "input" && node.props.type === "checkbox")[0].props.onChange({ target: { checked: true } }); tree = h.render();
    button(tree, "Confirm $27.50 reservation").props.onClick(); tree = await h.settle();
    assert.equal(button(tree, "Check this rental request"), undefined);
    if (code === "SMS_NUMBER_PRICE_CHANGED") assert.ok(button(tree, "Find an Australian number"));
    else assert.equal(nodes(tree, node => node.type === "input" && node.props.name === "businessName")[0].props.disabled, false);
    h.cleanup();
  }
});

test("an already paid topup refreshes credit and releases its intent for a later purchase", async () => {
  let paid = false;
  const h = harness("TradeSmsDashboard", async payload => {
    if (payload) { paid = true; return reply({ ok: false, code: "SMS_TOPUP_ALREADY_PAID", error: "This top-up is already paid." }, 409); }
    return reply(smsAccount({ wallet: { balanceMicro: paid ? 100000000 : 50000000, reservedMicro: 0 } }));
  });
  let tree = await h.mount(); button(tree, "Top up credit").props.onClick(); tree = h.render(); button(tree, "Continue with $50").props.onClick(); tree = await h.settle();
  assert.match(text(tree), /\$100\.00/); assert.equal(nodes(tree, node => node.type === "fieldset")[0].props.disabled, false);
  assert.ok(button(tree, "Continue with $50")); h.cleanup();
});

const messagesOverview = (overrides = {}) => ({ ok: true, memberId: "own-member", members: [{ id: "own-member", name: "Business owner", isOwner: true }], threads: [],
  canUseSms: true, canUseQuotes: true, canCreateSmsContact: true, canManageTeam: true, ...overrides });
async function messagesReady(h) { await h.mount(); await new Promise(resolve => setTimeout(resolve, 5)); return h.settle(); }

test("normal web Messages opens customers after loading identity and mounts SMS management only for its actual owner", async () => {
  for (const isOwner of [true, false]) {
    const h = harness("TradeMessagesWorkspace", async (_payload, requests) => reply(requests.at(-1).url.includes("view=customers")
      ? { ok: true, customerThreads: [], questions: [] }
      : messagesOverview({ members: [{ id: "own-member", name: "Current member", isOwner }, { id: "other-member", name: "Another owner", isOwner: true }] })));
    const tree = await messagesReady(h);
    assert.equal(button(tree, "Customers").props["aria-pressed"], true);
    assert.equal(h.requests[0].url, "/api/trade-messages"); assert.match(h.requests[1].url, /view=customers/);
    assert.equal(nodes(tree, node => node.type === fixtureComponents.TradeSmsDashboard).length, isOwner ? 1 : 0);
    h.cleanup();
  }
});

test("native handoff and explicit team entry remain team-only without requesting paid SMS", async () => {
  for (const props of [{ teamOnly: true, user: undefined, getAuthHeaders: async () => ({ "x-tlink-comms-member": "own-member" }) }, { initialThreadId: "thread-123456" }]) {
    const h = harness("TradeMessagesWorkspace", async (_payload, requests) => reply(requests.at(-1).url.includes("view=thread")
      ? { ok: true, thread: { id: "thread-123456", kind: "group", subject: "Crew", members: [], latest: "", unread: 0 } } : messagesOverview()), props);
    const tree = await messagesReady(h);
    assert.equal(button(tree, "Team").props["aria-pressed"], true);
    assert.equal(h.requests.some(item => item.url.includes("view=customers")), false);
    assert.equal(nodes(tree, node => node.type === fixtureComponents.TradeSmsDashboard).length, 0); h.cleanup();
  }
});

test("staff without customer access stay in team messages and do not fetch customer conversations", async () => {
  const h = harness("TradeMessagesWorkspace", async () => reply(messagesOverview({ canUseSms: false, canUseQuotes: false, members: [{ id: "own-member", name: "Staff", isOwner: false }] })));
  const tree = await messagesReady(h); assert.equal(button(tree, "Team").props["aria-pressed"], true);
  assert.equal(button(tree, "Customers"), undefined); assert.equal(h.requests.some(item => item.url.includes("view=customers")), false); h.cleanup();
});

test("Follow-ups opens auto texts for owners and preserves email templates and reminder controls", async () => {
  const h = harness("TradeEmailTemplatesWorkspace", async () => reply({ ok: true, canManage: true, connection: null, templates: followUps.DEFAULT_FOLLOW_UP_TEMPLATES, settings: followUps.DEFAULT_FOLLOW_UP_SETTINGS, history: [] }));
  let tree = await h.mount(); assert.match(text(tree), /Follow-ups/); assert.equal(button(tree, "Auto texts").props["aria-pressed"], true);
  assert.equal(nodes(tree, node => node.type === fixtureComponents.TradeSmsAutomationPanel).length, 1);
  button(tree, "Email templates").props.onClick(); tree = h.render();
  assert.ok(button(tree, "New template")); assert.ok(button(tree, "Save template")); assert.match(text(tree), /Email subject/);
  button(tree, "Email reminders").props.onClick(); tree = h.render();
  assert.match(text(tree), /Invoice reminders/); assert.match(text(tree), /Appointment emails/); assert.ok(button(tree, "Save reminder settings"));
  assert.equal(nodes(tree, node => node.type === fixtureComponents.TradeSmsAutomationPanel).length, 1, "SMS editor stays mounted so channel switches preserve its draft"); h.cleanup();
});
