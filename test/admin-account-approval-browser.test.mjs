import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const executablePath = [process.env.FORM_QA_BROWSER, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(value => value && fs.existsSync(value));
const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {AdminAccountWorkspace} from './src/components/AdminAccountWorkspace';
    const api=async(path,init={})=>{const response=await fetch(path,init);const value=await response.json();if(!response.ok)throw new Error(value.error);return value;};
    createRoot(document.getElementById('root')).render(<AdminAccountWorkspace api={api} role="owner" setStatus={()=>{}} onCounts={()=>{}}/>);
  ` },
  bundle: true, write: false, outfile: "admin-approval.js", format: "iife", jsx: "automatic",
  plugins: [{ name: "synthetic-auth", setup(builder) {
    builder.onResolve({ filter: /firebase-client$/ }, () => ({ path: "firebase-client", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const firebaseAuth={currentUser:null};" }));
  } }],
});
const js = bundle.outputFiles.find(value => value.path.endsWith(".js")).text;
const css = bundle.outputFiles.find(value => value.path.endsWith(".css")).text;

function fixtureAccount(overrides = {}) {
  return {
    firebaseUid: "synthetic-installer", email: "synthetic@example.invalid", businessName: "Synthetic Business", contactName: "Synthetic Trader", phone: "0399990000", partnerType: "installer",
    abn: "51824753556", addressLine1: "12 Synthetic Street", suburb: "Melbourne", addressState: "VIC", postcode: "3000", serviceBasePostcode: "3000", serviceRadiusKm: 50,
    serviceStates: ["VIC"], capabilities: ["insulation"], accountStatus: "active", verificationStatus: "submitted", availabilityStatus: "open",
    verifiedAbn: "", verificationReviewId: "", verificationReviewedAt: "", verificationReviewedByUid: "", approvalReviewExists: false, accessApproved: false,
    officialAbnLookupUrl: "https://abr.business.gov.au/ABN/View?abn=51824753556", createdAt: "2026-10-08T00:00:00Z", updatedAt: "2026-10-08T00:00:00Z", ...overrides,
  };
}

async function setup(browser, width, overrides = {}) {
  const page = await browser.newPage({ viewport: { width, height: 850 } });
  const account = fixtureAccount(overrides), writes = [], errors = [], state = { reject: "", hold: null, failRefresh: false };
  page.on("pageerror", error => errors.push(error.message)); page.setDefaultTimeout(6000);
  await page.route("https://fixture.invalid/**", async route => {
    const request = route.request(), url = new URL(request.url()); let result;
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><body></body></html>" });
    if (request.method() === "PATCH") {
      const payload = request.postDataJSON(); writes.push(payload);
      if (state.hold) await state.hold;
      if (state.reject) return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: state.reject }) });
      Object.assign(account, { accountStatus: payload.accountStatus, verificationStatus: payload.verificationStatus, availabilityStatus: payload.availabilityStatus,
        verifiedAbn: account.abn, verificationReviewId: "synthetic-review", verificationReviewedAt: "2026-10-08T01:00:00Z", verificationReviewedByUid: "synthetic-admin", approvalReviewExists: true,
        accessApproved: payload.accountStatus === "active" && payload.verificationStatus === "approved" });
      result = { ok: true };
    } else if (state.failRefresh && writes.length && url.searchParams.has("uid")) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic detail refresh unavailable." }) });
    else if (url.pathname.endsWith("list-views")) result = { preferences: {}, saved: false };
    else if (url.searchParams.has("uid")) result = { account, documents: [], notes: [], matches: [], reviews: [], entitlements: { verified: account.accessApproved, accessLabel: account.accessApproved ? "Verified trade access" : "ABN review required", features: {} } };
    else result = { accounts: [account], counts: {}, pagination: { page: 1, pageSize: 25, total: 1, pageCount: 1 } };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
  });
  await page.goto("https://fixture.invalid/"); await page.setContent(`<div id="root"></div><style>${css}</style>`); await page.addScriptTag({ content: js });
  await page.getByRole("button", { name: /Synthetic Business.*synthetic@example.invalid/ }).click();
  await page.getByLabel("Verification", { exact: true }).waitFor();
  return { page, account, writes, state, errors };
}

test("new approval requires genuine evidence beside Save and then reloads the approved server record", { skip: !executablePath && "Native browser unavailable", timeout: 30000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try { for (const width of [1280, 390]) {
    const f = await setup(browser, width), { page } = f;
    await page.getByLabel("Verification", { exact: true }).selectOption("approved");
    const note = page.getByLabel(/^Internal moderation note/);
    assert.equal(await note.getAttribute("required"), "");
    assert.equal(await page.getByLabel(/^Registered legal entity name/).getAttribute("required"), "");
    await page.getByRole("button", { name: "Save and audit decision", exact: true }).click();
    await page.getByRole("alert").getByText("Record the evidence and reason for this decision.", { exact: true }).waitFor();
    assert.equal(await note.evaluate(element => element === document.activeElement), true); assert.equal(f.writes.length, 0);
    await note.fill("   "); await page.getByRole("button", { name: "Save and audit decision", exact: true }).click(); assert.equal(f.writes.length, 0);
    await note.fill("Synthetic fixture: official business identity evidence reviewed by synthetic administrator.");
    await page.getByLabel(/^Registered legal entity name/).fill("");
    await page.getByRole("button", { name: "Save and audit decision", exact: true }).click();
    await page.getByRole("alert").getByText("Record the legal entity name shown in the ABN register.", { exact: true }).waitFor(); assert.equal(f.writes.length, 0);
    assert.equal(await page.getByLabel(/^Registered legal entity name/).evaluate(element => element === document.activeElement), true);
    await page.getByLabel(/^Registered legal entity name/).fill("Synthetic Legal Entity");
    await page.getByRole("button", { name: "Save and audit decision", exact: true }).click();
    await page.getByRole("status").getByText("Account decision saved and recorded in the audit history.", { exact: true }).waitFor();
    assert.equal(f.writes.length, 1); assert.equal(f.writes[0].sourceReference, f.account.officialAbnLookupUrl); assert.equal(f.writes[0].reviewMethod, "official_abr_lookup");
    assert.equal(await page.getByLabel("Verification", { exact: true }).inputValue(), "approved"); assert.equal(await note.inputValue(), ""); assert.equal(await note.getAttribute("required"), null);
    await page.getByText("Approved ABN access", { exact: true }).waitFor(); assert.deepEqual(f.errors, []); await page.close();
  } } finally { await browser.close(); }
});

test("backend rejection stays visible at Save with entered evidence preserved and duplicate saves blocked", { skip: !executablePath && "Native browser unavailable", timeout: 20000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const f = await setup(browser, 390), { page } = f;
    await page.getByLabel("Verification", { exact: true }).selectOption("approved");
    const note = page.getByLabel(/^Internal moderation note/); await note.fill("Synthetic review evidence.");
    let release; f.state.hold = new Promise(resolve => { release = resolve; }); f.state.reject = "This account does not have a valid 11-digit ABN.";
    await page.getByRole("button", { name: "Save and audit decision", exact: true }).click();
    await page.getByRole("button", { name: "Saving decision...", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Saving decision...", exact: true }).isDisabled(), true);
    await page.locator('form[aria-busy="true"]').evaluate(element => { element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    release();
    await page.getByRole("alert").getByText(f.state.reject, { exact: true }).waitFor();
    assert.equal(f.writes.length, 1); assert.equal(f.account.verificationStatus, "submitted"); assert.equal(await note.inputValue(), "Synthetic review evidence.");
    assert.equal(await page.getByRole("button", { name: "Save and audit decision", exact: true }).isEnabled(), true); assert.deepEqual(f.errors, []);
  } finally { await browser.close(); }
});

test("an existing valid approval remains note optional even when its account is suspended", { skip: !executablePath && "Native browser unavailable", timeout: 20000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const f = await setup(browser, 1280, { accountStatus: "suspended", verificationStatus: "approved", verifiedAbn: "51824753556", verificationReviewId: "synthetic-existing", verificationReviewedAt: "2026-10-07T01:00:00Z", verificationReviewedByUid: "synthetic-admin", approvalReviewExists: true });
    assert.equal(await f.page.getByLabel(/^Internal moderation note/).getAttribute("required"), null);
    await f.page.getByRole("button", { name: "Save and audit decision", exact: true }).click();
    await f.page.getByRole("status").getByText("Account decision saved and recorded in the audit history.", { exact: true }).waitFor();
    assert.equal(f.writes.length, 1); assert.equal(f.writes[0].note, ""); assert.deepEqual(f.errors, []);
  } finally { await browser.close(); }
});

test("a successful save followed by a failed detail refresh is reported as saved and needing refresh", { skip: !executablePath && "Native browser unavailable", timeout: 20000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const f = await setup(browser, 390); f.state.failRefresh = true;
    await f.page.getByLabel("Verification", { exact: true }).selectOption("approved");
    await f.page.getByLabel(/^Internal moderation note/).fill("Synthetic review evidence.");
    await f.page.getByRole("button", { name: "Save and audit decision", exact: true }).click();
    await f.page.getByRole("status").getByText("Account decision saved. Reopen the account to refresh its current details.", { exact: true }).waitFor();
    assert.equal(f.writes.length, 1); assert.equal(f.account.verificationStatus, "approved");
    assert.equal(await f.page.getByLabel(/^Internal moderation note/).inputValue(), "Synthetic review evidence."); assert.deepEqual(f.errors, []);
  } finally { await browser.close(); }
});
