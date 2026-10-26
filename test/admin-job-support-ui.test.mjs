import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { createAdminJobSupportFetch } from "../src/lib/admin-job-support-client.ts";

test("support requests retain the real admin authorization and bind GET reads to one job", async () => {
  const calls = [];
  const read = createAdminJobSupportFetch("synthetic-job", "https://fixture.invalid", async request => { calls.push(request); return new Response("{}"); });
  await read("/api/trade-crm?id=synthetic-job", { headers: { Authorization: "Bearer synthetic-admin", "X-TLink-Business": "another-business", "X-TLink-Admin-Job": "another-job" } });
  await read(new Request("https://fixture.invalid/api/trade-field-work?preview=photo", { headers: { Authorization: "Bearer original", "X-TLink-Business": "another-business" }, cache: "force-cache" }), { headers: { Authorization: "Bearer override" } });
  assert.equal(calls.length, 2);
  for (const request of calls) {
    assert.equal(request.method, "GET"); assert.equal(request.headers.get("X-TLink-Admin-Job"), "synthetic-job");
    assert.equal(request.headers.get("X-TLink-Business"), null); assert.equal(request.cache, "no-store");
  }
  assert.equal(calls[0].headers.get("Authorization"), "Bearer synthetic-admin");
  assert.equal(calls[1].headers.get("Authorization"), "Bearer override");
});

test("support request boundary blocks writes, external resources and public links before network access", async () => {
  let calls = 0;
  const read = createAdminJobSupportFetch("synthetic-job", "https://fixture.invalid", async () => { calls++; return new Response("{}"); });
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    await assert.rejects(read("/api/trade-crm", { method }), /read only/);
  }
  await assert.rejects(read(new Request("https://fixture.invalid/api/trade-crm", { method: "POST", body: "{}" })), /read only/);
  for (const url of ["https://external.invalid/api/report", "/customer/report/token", "//external.invalid/api/file", "blob:https://fixture.invalid/file"]) {
    await assert.rejects(read(url), /authenticated job view/);
  }
  assert.equal(calls, 0);
});

const executablePath = [process.env.FORM_QA_BROWSER, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(value => value && fs.existsSync(value));
const jobId = "synthetic-support-job", stamp = "2026-10-26T01:00:00Z";
const customer = { id: "synthetic-customer", customerNumber: "C-SYNTHETIC", customerType: "individual", displayName: "Sample Customer", firstName: "Sample", lastName: "Customer", businessName: "", email: "customer@example.invalid", phone: "0399990000", addressLine1: "1 Example Street", addressLine2: "", suburb: "Melbourne", addressState: "VIC", postcode: "3000", tags: [], privateNotes: "Synthetic saved customer note", createdAt: stamp, updatedAt: stamp };
const job = { id: jobId, workNumber: "TLJ-SYNTHETIC", title: "Synthetic rental inspection", serviceCategory: "rental-inspection", siteArea: "Melbourne VIC 3000", stage: "complete", priority: "normal", scheduledStart: "2026-10-27T00:00:00Z", scheduledEnd: "2026-10-27T01:00:00Z", revision: 1, assigneeMemberId: "synthetic-tech", assigneeLabel: "Sample Technician", sourceType: "trade_crm", customerSource: "trade_owned", crmCustomerId: customer.id, serviceSiteId: "synthetic-site", pipelineStage: "complete", buildingType: "house", description: "Synthetic saved inspection details", customerReference: "REF-SYNTHETIC", nextAction: "Review saved report", tags: [], estimatedValueCents: 10000, quotedValueCents: 10000, invoicedValueCents: 10000, paidValueCents: 0, quoteStatus: "issued", scheduleReady: true, invoiceStatus: "sent", paymentDueAt: "2026-11-01", handoverStatus: "not_started", tasks: [{ id: "synthetic-task", title: "Synthetic follow-up task", dueAt: "2026-10-28", status: "pending", completedAt: "" }], appointments: [{ id: "synthetic-appointment", appointmentType: "inspection", title: "Synthetic inspection appointment", startsAt: "2026-10-27T00:00:00Z", endsAt: "2026-10-27T01:00:00Z", assigneeMemberId: "synthetic-tech", assigneeLabel: "Sample Technician", status: "scheduled", notes: "Synthetic appointment note" }], notes: [{ id: "synthetic-note", noteType: "internal", body: "Synthetic saved support note", issueStatus: "", createdAt: stamp, updatedAt: stamp }], complianceCases: [], complianceIntents: [], complianceIntent: null, customerDocuments: null, createdAt: stamp, updatedAt: stamp, dataforceRecord: null, jobRegister: { operationalStatus: "complete", auditOutcome: "" } };
const row = { ...job, installerBusiness: "Synthetic Trade Services", customerFirstName: "Sample", customerLastName: "Customer", recordStatus: "active", createdAt: stamp };
const site = { id: "synthetic-site", customerId: customer.id, siteLabel: "Example property", addressLine1: "1 Example Street", addressLine2: "", suburb: "Melbourne", addressState: "VIC", postcode: "3000", accessInstructions: "Synthetic access note", parkingInstructions: "Synthetic parking note", hazardNotes: "Synthetic hazard note", contacts: [], isPrimary: true, createdAt: stamp, updatedAt: stamp };
const assessmentModule = { id: "synthetic-module", key: "minimum_standards", title: "Synthetic rental assessment", required: true, status: "complete", requiredCapability: "", answers: {}, revision: 1, completedAt: stamp,
  template: { assessmentScope: "current_minimum_standards", templateVersion: 1, key: "minimum_standards", title: "Synthetic rental assessment", credentialGate: "", reportBoundary: "Synthetic inspection boundary", metadataFields: [], sections: [{ key: "example", title: "Synthetic inspection checks", summary: "Saved synthetic checks", checks: [{ key: "example_check", prompt: "Synthetic fixture condition", required: true, requiredEvidenceCount: 0, responseType: "pass_fail", repeatBy: "", photoGuidance: "", help: "", credentialGate: "" }] }] } };
const rental = { ok: true, inspection: { id: "synthetic-inspection", inspectionNumber: "RI-SYNTHETIC", status: "complete", rulesEffectiveFrom: "2026-10-01", revision: 1 }, modules: [assessmentModule], items: [{ id: "synthetic-item", moduleId: assessmentModule.id, itemKey: "example_check", sectionKey: "example", checkKey: "example_check", instanceKey: "", locationLabel: "Example room", outcome: "pass", response: {}, publicNotes: "Synthetic saved observation", internalNotes: "Synthetic private observation", requiredEvidenceCount: 0, sortOrder: 1, revision: 1 }], findings: [], evidence: [], completion: { [assessmentModule.id]: { blockers: [], complete: true } }, reports: [{ id: "synthetic-report", reportNumber: "RPT-SYNTHETIC", status: "issued", issuedAt: stamp, internalPdfUrl: `/api/trade-rental-inspections/report/synthetic-report/pdf?workOrderId=${jobId}`, link: null }], permissions: { canEdit: false, canManageDeliveryReview: false }, deliveryRecipient: { email: customer.email }, reportDelivery: { message: "Synthetic report accepted for delivery", status: "accepted", reportId: "synthetic-report" } };
const invoice = { id: "synthetic-invoice", invoiceNumber: "INV-SYNTHETIC", lines: [{ lineId: "synthetic-line", description: "Synthetic inspection charge", quantity: 1, unitPriceCentsExGst: 10000, subtotalCents: 10000, taxCents: 1000, totalCents: 11000, taxCode: "gst" }], subtotalCents: 10000, discountCents: 0, taxCents: 1000, totalCents: 11000, dueAt: "2026-11-01", status: "sent", deliveryStatus: "accepted", attempts: 1, sentAt: stamp, revision: 1, deliveryEmail: customer.email, creditedCents: 0, paidCents: 0, netCents: 11000, outstandingCents: 11000, canCorrect: false, canDownloadPdf: true, document: null, creditBlockedReason: "", credits: [], revisions: [] };
const quote = { id: "synthetic-quote", quoteNumber: "Q-SYNTHETIC", currentVersionNumber: 1, status: "issued", editableDraft: null, link: null, questions: [], timeline: [], deliveries: [], versions: [{ id: "synthetic-quote-version", versionNumber: 1, status: "issued", customerEmail: customer.email, subtotalCents: 10000, taxCents: 1000, totalCents: 11000, terms: "Synthetic agreed scope", customerMessage: "Synthetic saved quote message", validUntil: "2026-11-01", consentStatement: "Synthetic consent", issuedAt: stamp, choices: [], acceptance: null, productDocuments: [], items: [{ id: "synthetic-quote-line", priceBookItemId: "", jobPacketId: "", jobPacketLineId: "", lineType: "labour", description: "Synthetic rental assessment service", quantityMilli: 1000, unitPriceCents: 10000, taxCode: "gst", sectionHeading: "Included work", totalCents: 11000 }] }] };

async function browserBundle() {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {AdminJobDirectory} from './src/components/AdminJobDirectory';
    import './src/app/protected-workspaces.css';
    const user={uid:'synthetic-admin',emailVerified:true,getIdToken:async()=> 'synthetic-admin-token'};
    window.fixtureUser=user;
    const api=async(path,init={})=>{const response=await fetch(path,init);const value=await response.json();if(!response.ok)throw new Error(value.error);return value;};
    createRoot(document.getElementById('root')).render(<AdminJobDirectory api={api} user={user} canAudit={false} initialSearch="Synthetic"/>);
  ` }, bundle: true, write: false, outfile: "admin-support-fixture.js", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "synthetic-browser-runtime", setup(builder) {
      builder.onResolve({ filter: /^\/.*\.(png|svg|webp)$/ }, args => ({ path: args.path, external: true }));
      builder.onResolve({ filter: /\/(CreditexJobAuditDesk|AdminCertificateJobActions)$/ }, args => ({ path: args.path.split("/").at(-1), namespace: "unrendered-admin-actions" }));
      builder.onLoad({ filter: /.*/, namespace: "unrendered-admin-actions" }, args => ({ contents: `export function ${args.path}(){throw new Error('Admin mutation component must not mount in support fixture');}` }));
      builder.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: "dynamic", namespace: "fixture" }));
      // Shared work-pack contracts import a server-only hash helper; support reads must never invoke it.
      builder.onResolve({ filter: /^node:crypto$/ }, () => ({ path: "crypto", namespace: "fixture" }));
      builder.onResolve({ filter: /firebase-client$/ }, () => ({ path: "firebase-client", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "jsx", resolveDir: process.cwd(), contents: args.path === "dynamic"
        ? "import React from 'react';export default function dynamic(loader,options={}){const Lazy=React.lazy(()=>loader().then(value=>({default:value.default||value})));return props=><React.Suspense fallback={options.loading?React.createElement(options.loading,{}):null}><Lazy {...props}/></React.Suspense>}"
        : args.path === "crypto" ? "export function createHash(){throw new Error('Server hashing must not run in the support browser');}"
        : "export const firebaseAuth={get currentUser(){return window.fixtureUser||null},onIdTokenChanged(callback){callback(this.currentUser);return ()=>{};}};export const firebaseApp={};export const firebaseStorage={};export const firebaseDb={};" }));
    } }] });
  const globalCss = fs.readFileSync("src/app/globals.css", "utf8").replace(/^@import[^;]*;/gm, "");
  return { js: bundle.outputFiles.find(item => item.path.endsWith(".js")).text, css: globalCss + "\n" + bundle.outputFiles.filter(item => item.path.endsWith(".css")).map(item => item.text).join("\n") };
}

async function setup(browser, width, bundle) {
  const page = await browser.newPage({ viewport: { width, height: 920 } }), requests = [], errors = [], unexpected = [], state = { reject: false, wrongJob: false, noQuote: false };
  page.setDefaultTimeout(7000); page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== "https://fixture.invalid") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" });
    requests.push({ path: url.pathname, method: request.method(), headers: request.headers() });
    if (request.method() !== "GET") { unexpected.push(`${request.method()} ${url.pathname}`); return route.fulfill({ status: 405, body: "{}" }); }
    let result;
    switch (url.pathname) {
      case "/api/trade-rental-inspections/report/synthetic-report/pdf":
        assert.equal(url.searchParams.get("workOrderId"), jobId);
        return route.fulfill({ contentType: "application/pdf", body: "%PDF-1.4\n% Synthetic report fixture\n%%EOF" });
      case "/api/admin/jobs": result = { jobs: [row], facets: { stages: ["complete"], services: ["rental-inspection"], installers: [row.installerBusiness] }, pagination: { total: 1, pageSize: 50, hasNext: false } }; break;
      case "/api/trade-crm": if (state.reject) return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Synthetic support access denied." }) }); result = { ok: true, job: { ...job, id: state.wrongJob ? "wrong-job" : job.id }, customer, sites: [site] }; break;
      case "/api/trade-field-work": result = { protectedJob: false, timeEntries: [], media: [{ id: "synthetic-photo", caption: "Synthetic evidence photo", fileName: "synthetic.png", category: "site", contentType: "image/png", sizeBytes: 100, createdAt: stamp }], signoffs: [] }; break;
      case "/api/trade-activity-forms": result = { records: [] }; break;
      case "/api/trade-team/work-packs": result = { ok: true, instances: [] }; break;
      case "/api/trade-rental-inspections": result = rental; break;
      case "/api/field/job-activities": result = { ok: true, revision: 1, canAdd: false, rentalModules: [{ id: "minimum_standards", title: assessmentModule.title, added: true, unavailableReason: "" }] }; break;
      case "/api/trade-job-forms": result = { ok: true, templates: [], forms: [] }; break;
      case "/api/trade-safety-checks": result = { ok: true, records: [], canManage: false }; break;
      case "/api/trade-job-quote-photos": result = { ok: true, acceptedPhotos: [] }; break;
      case "/api/trade-swms": result = { ok: true, record: null, available: false, capabilities: { canEdit: false, canSign: false, reason: "No SWMS has been added to this job." } }; break;
      case "/api/trade-veu-electrical-assessments": result = { ok: true, records: [], canManage: false }; break;
      case "/api/trade-handover": result = { ok: true, pack: null }; break;
      case "/api/trade-quotes": result = { ok: true, quote: state.noQuote ? null : quote, authorisedEmails: [customer.email], job: { customerId: customer.id, customerName: customer.displayName, workNumber: job.workNumber, title: job.title, publicLead: false, enquiryServices: [] }, access: { canManageQuotes: false, canSendQuotes: false } }; break;
      case "/api/trade-quick-invoices": result = { invoice, access: { canManageInvoices: false } }; break;
      case "/api/trade-message-job-files": result = { files: [] }; break;
      case "/api/trade-job-review": result = { state: { workOrderId: jobId, revision: 1, activities: [], canReview: false, reviewed: true, notifications: [], history: [{ id: "synthetic-review", action: "reviewed", note: "Synthetic saved review note" }] } }; break;
      case "/api/trade-customer-delivery-exceptions": result = { ok: true, items: [], total: 0, page: 1, pageSize: 20 }; break;
      case "/api/trade-customer-hub": result = { ok: true, available: true, accepting: true, canAsk: false, questions: [] }; break;
      case "/api/trade-sms": result = { ok: true, consent: "allowed", messages: [{ id: "synthetic-message", direction: "outbound", body: "Synthetic saved customer message", status: "delivered", createdAt: stamp, workOrderId: jobId, senderName: "Synthetic Trade" }], customerPhone: customer.phone, jobs: [], jobNumber: job.workNumber }; break;
      default: unexpected.push(`${request.method()} ${url.pathname}`); return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Synthetic endpoint not defined." }) });
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) });
  });
  await page.goto("https://fixture.invalid/");
  await page.setContent(`<style>${bundle.css}</style><style>body{margin:0;padding:20px;background:#f4f8f6;font-family:Arial,sans-serif;color:#173e30}*{box-sizing:border-box}#root{max-width:1400px;margin:auto}</style><div id="root"></div>`);
  await page.addScriptTag({ content: bundle.js });
  await page.getByRole("button", { name: "TLJ-SYNTHETIC", exact: true }).click();
  return { page, requests, errors, unexpected, state };
}

test("admin row opens the shared read-only job, all support tabs work at desktop and mobile, and return preserves search", { skip: !executablePath && "Native browser unavailable", timeout: 90000 }, async () => {
  const bundle = await browserBundle(), browser = await chromium.launch({ executablePath, headless: true });
  try { for (const width of [1440, 390]) {
    const f = await setup(browser, width, bundle), { page } = f;
    await page.getByText("Synthetic rental inspection", { exact: true }).waitFor();
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(await page.locator("#admin-support-job-title").evaluate(element => element === document.activeElement), true);
    const screenshot = async name => {
      if (!process.env.ADMIN_SUPPORT_SCREENSHOTS) return;
      fs.mkdirSync(process.env.ADMIN_SUPPORT_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.ADMIN_SUPPORT_SCREENSHOTS, `${name}-${width}.png`), fullPage: true });
    };
    await screenshot("overview");
    for (const [tab, text] of [["Files", "RI-SYNTHETIC"], ["Answers", "Synthetic fixture condition"], ["Quote", "Q-SYNTHETIC"], ["Invoice", "INV-SYNTHETIC"], ["Schedule", "Synthetic inspection appointment"], ["Review", "Synthetic saved review note"], ["Messages", "Synthetic saved customer message"]]) {
      await page.getByRole("button", { name: tab === "Schedule" ? /^Schedule \(/ : tab, exact: true }).click();
      if (tab === "Messages") await page.getByText("Text messages", { exact: true }).click();
      await page.getByText(text, { exact: false }).first().waitFor().catch(async error => { throw new Error(`${tab}: ${error.message}\n${JSON.stringify(f.errors)}\n${await page.locator('body').innerText()}`); });
      if (tab === "Files") await page.getByRole("region", { name: "Job files", exact: true }).getByText("Synthetic evidence photo", { exact: true }).waitFor().catch(async error => { throw new Error(`${error.message}\n${JSON.stringify(f.errors)}\n${await page.locator('body').innerText()}`); });
      if (tab === "Files") {
        const downloadPromise = page.waitForEvent("download");
        await page.getByRole("button", { name: "Download issued PDF", exact: true }).click();
        const download = await downloadPromise; assert.equal(download.suggestedFilename(), "RPT-SYNTHETIC.pdf");
        assert.equal(await download.failure(), null);
        await page.getByText("Issued report PDF downloaded.", { exact: true }).waitFor();
      }
      if (tab === "Quote") { assert.equal(await page.getByRole("button", { name: "View complete PDF", exact: true }).isVisible(), true); assert.equal(await page.getByRole("button", { name: "Add included line", exact: true }).count(), 0); assert.equal(await page.locator(".trade-quote-validation-summary").count(), 0); }
      assert.equal(await page.getByRole("button", { name: /^(Save|Send|Add task|Add note|Pass$|Correction required$|Ask Wattzun|Start timer|Create share link|Email report|Revoke|Mark as paid)/ }).count(), 0, `${tab} must not expose mutation controls`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tab} overflows at ${width}px`);
      if (["Files", "Answers", "Quote", "Invoice"].includes(tab)) await screenshot(tab.toLowerCase());
    }
    for (const [tab, text] of [["Tasks", "Synthetic follow-up task"], ["Notes", "Synthetic saved support note"]]) {
      await page.locator(".crm-job-more > button").click();
      await page.getByRole("menuitem", { name: tab === "Tasks" ? /^Tasks \(/ : tab, exact: true }).click();
      await page.getByText(text, { exact: true }).waitFor();
    }
    assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
    const reads = f.requests.filter(request => request.path !== "/api/admin/jobs");
    assert.ok(reads.length > 10); assert.ok(reads.every(request => request.method === "GET" && request.headers["x-tlink-admin-job"] === jobId && request.headers.authorization === "Bearer synthetic-admin-token"));
    assert.ok(!reads.some(request => /work-time|\/voice|wattzun/.test(request.path)));
    f.state.noQuote = true; await page.getByRole("button", { name: "Quote", exact: true }).click();
    await page.getByRole("heading", { name: "No quote saved", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Add included line", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Back to jobs", exact: true }).click();
    assert.equal(await page.getByLabel("Search jobs", { exact: true }).inputValue(), "Synthetic");
    assert.equal(await page.getByRole("button", { name: "TLJ-SYNTHETIC", exact: true }).evaluate(element => element === document.activeElement), true);
    await page.close();
  } } finally { await browser.close(); }
});

test("denied or mismatched support jobs show an error instead of previous customer data", { skip: !executablePath && "Native browser unavailable", timeout: 30000 }, async () => {
  const bundle = await browserBundle(), browser = await chromium.launch({ executablePath, headless: true });
  try {
    const f = await setup(browser, 1280, bundle), { page } = f;
    await page.getByText("Synthetic rental inspection", { exact: true }).waitFor();
    f.state.reject = true; await page.getByRole("button", { name: "Refresh job", exact: true }).click();
    await page.getByRole("alert").getByText("Synthetic support access denied.", { exact: true }).waitFor();
    assert.equal(await page.getByText("Synthetic rental inspection", { exact: true }).count(), 0);
    f.state.reject = false; f.state.wrongJob = true; await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.getByRole("alert").getByText("The full job could not be loaded.", { exact: true }).waitFor();
    assert.equal(await page.getByText("Sample Customer", { exact: true }).count(), 0);
    f.state.wrongJob = false; await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.getByText("Synthetic rental inspection", { exact: true }).waitFor();
    assert.deepEqual(f.errors, []);
  } finally { await browser.close(); }
});
