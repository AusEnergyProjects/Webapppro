import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { ENERGY_SERVICE_CATALOGUE } from "../src/lib/energy-service-catalogue.mjs";

const origin = new URL(process.argv[2] || "http://localhost:5184");
if (!["localhost", "127.0.0.1"].includes(origin.hostname)) throw new Error("Synthetic journey checks require a local preview.");
const output = process.argv[3];
if (output) fs.mkdirSync(output, { recursive: true });
const executablePath = [process.env.FORM_QA_BROWSER, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(value => value && fs.existsSync(value));
const browser = await chromium.launch({ executablePath, headless: true });
const electricity = { planId: "synthetic-electricity", name: "Synthetic test plan", brand: "Synthetic Energy", type: "MARKET", distributors: ["CitiPower"], link: "https://example.invalid/plan", contract: { tariffPeriod: [{ startDate: "01-01", endDate: "12-31", dailySupplyCharge: 1, rateBlockUType: "singleRate", singleRate: { rates: [{ unitPrice: 0.25 }] } }], solarFeedInTariff: [{ scheme: "CURRENT", singleTariff: { rates: [{ unitPrice: 0.05 }] } }] } };
const gas = { id: "synthetic-gas", name: "Synthetic gas plan", brand: "Synthetic Energy", type: "MARKET", distributors: ["Multinet"], annualCost: 1100, supply: 300, usage: 800, discounts: 0, supplyChargeDaily: 82, rates: [{ label: "Usage", centsPerMj: 4 }], conditionalDiscounts: [], eligibility: [], eligibilityConfirmations: [], limitations: [], feeCount: 0, incentiveCount: 0, link: "https://example.invalid/plan" };

async function setup(width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [], state = { requests: 0, writes: 0, release: null };
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/electricity-plans?**", async route => {
    state.requests++;
    if (state.release) await state.release;
    await route.fulfill({ json: { plans: [electricity], fetchedAt: "2026-10-09T00:00:00Z" } });
  });
  await page.route("**/api/gas-plans?**", async route => {
    state.requests++;
    await route.fulfill({ json: { plans: [gas], fetchedAt: "2026-10-09T00:00:00Z" } });
  });
  await page.route("**/api/address-localities?**", route => route.fulfill({ json: { ok: true, postcode: "3000", localities: [{ suburb: "MELBOURNE", state: "VIC" }] } }));
  await page.route("**/api/leads", route => { state.writes++; return route.fulfill({ status: 503, json: { error: "No leads may be sent by synthetic QA." } }); });
  await page.route("https://www.googletagmanager.com/**", route => route.fulfill({ body: "", contentType: "application/javascript" }));
  return { page, errors, state };
}

async function assertFits(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "No horizontal page overflow");
}

async function checkDialog(page, expected) {
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  for (const service of ENERGY_SERVICE_CATALOGUE) {
    const checkbox = dialog.getByRole("checkbox", { name: service.id === "other" ? "Something else or not sure" : service.label, exact: true });
    assert.equal(await checkbox.isChecked(), expected.includes(service.id), `Selection for ${service.id} carried across`);
  }
  assert.equal(await page.locator("form form").count(), 0, "No nested enquiry form");
  await assertFits(page);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
}

try {
  for (const width of [1440, 390]) {
    const { page, errors, state } = await setup(width);
    await page.goto(new URL("/compare", origin).href);
    await page.waitForFunction(() => typeof window.gtag === "function");
    const form = page.getByRole("form", { name: "Electricity plan comparison" });
    await form.getByLabel("Postcode", { exact: true }).fill("3000");
    await form.getByRole("button", { name: "Continue", exact: true }).click();
    await form.locator('input[value="bill"][name="usage-evidence"]').check();
    await form.locator('input[value="annual"][name="manual-usage-mode"]').check();
    await form.locator('input[type="number"]').first().fill("6240");
    await form.getByRole("button", { name: "Continue", exact: true }).click();
    const back = form.getByRole("button", { name: "Back", exact: true });
    const compare = form.getByRole("button", { name: "Compare electricity plans", exact: true });
    assert.equal(await back.evaluate(el => el.parentElement === el.parentElement.querySelector('button[type="submit"]')?.parentElement), true, "Back and compare share one action group");
    let release;
    state.release = new Promise(resolve => { release = resolve; });
    await compare.click();
    const working = page.getByRole("status").filter({ hasText: "Wattzun is on the case" });
    await working.waitFor();
    assert.ok(await working.locator('span[aria-hidden="true"] > span').count());
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await working.locator('span[aria-hidden="true"] > span').evaluate(el => getComputedStyle(el.parentElement).animationName), "none");
    await assertFits(page);
    if (output) await page.screenshot({ path: path.join(output, `electricity-loading-${width}.png`), fullPage: true });
    release(); state.release = null;
    await page.getByRole("heading", { name: "Your electricity plan results", exact: true }).waitFor();
    assert.equal(await page.getByText(/Direct Trade project brief/).count(), 0);
    assert.equal(await page.getByLabel(/solar yield|round.trip efficiency/i).count(), 0);
    assert.equal(await page.locator(".native-scenarios details").count(), 0);
    const price = page.getByLabel("Solar installed price ($)", { exact: false });
    await price.fill("4500.12");
    await page.getByLabel("Solar size on your quote (kW)", { exact: false }).fill("6.6");
    assert.equal(await price.inputValue(), "4500.12", "Changing size retains the customer's price");
    await page.getByLabel("Solar + storage installed price ($)", { exact: false }).fill("12000.25");
    await page.getByLabel("Battery size on your quote (kWh)", { exact: false }).fill("13.5");
    assert.equal(await page.getByLabel("Solar + storage installed price ($)", { exact: false }).inputValue(), "12000.25");
    await price.fill("0.001");
    await page.getByText("Enter an installed quote to calculate payback", { exact: true }).waitFor();
    await price.fill("");
    await page.getByText("Enter an installed quote to calculate payback", { exact: true }).waitFor();
    await price.fill("4500.12");
    await page.getByRole("button", { name: "Edit answers", exact: true }).click();
    await form.getByRole("button", { name: "Compare electricity plans", exact: true }).click();
    await page.getByRole("heading", { name: "Your electricity plan results", exact: true }).waitFor();
    assert.equal(await price.inputValue(), "4500.12", "Recomparison retains the customer's price");
    await page.getByRole("button", { name: "Enquire about solar", exact: true }).click();
    await checkDialog(page, ["solar"]);
    assert.equal(await page.getByRole("button", { name: "Enquire about solar", exact: true }).evaluate(el => el === document.activeElement), true);
    await page.getByRole("button", { name: "Enquire about solar + storage", exact: true }).click();
    await checkDialog(page, ["solar", "battery"]);
    await assertFits(page);
    if (output) { await page.locator(".native-scenarios").screenshot({ path: path.join(output, `solar-options-${width}.png`) }); }
    assert.equal(state.writes, 0);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`Electricity ${width}px: navigation, loading, reduced motion, quotes and enquiries passed.`);
  }
  for (const width of [1440, 390]) {
    const { page, errors, state } = await setup(width);
    await page.goto(new URL("/gas-compare", origin).href);
    assert.equal(new URL(page.url()).origin, origin.origin, "Gas QA remains on the local preview");
    await page.waitForFunction(() => typeof window.gtag === "function");
    const form = page.getByRole("form", { name: "Gas plan comparison" });
    await form.getByLabel("Postcode", { exact: true }).fill("3000");
    await form.getByRole("button", { name: "Continue", exact: true }).click();
    await form.getByLabel("Gas use (MJ per year)", { exact: false }).fill("58000");
    await form.getByRole("button", { name: "Continue", exact: true }).click();
    const refinement = page.locator(".gas-questionnaire");
    await refinement.getByRole("checkbox", { name: "Gas ducted central heating", exact: true }).check();
    assert.equal(await page.locator("details.comparison-refinement").count(), 0, "Main appliance questions are never collapsed");
    const prices = refinement.getByLabel("Installed price after discounts ($)", { exact: false });
    await prices.nth(0).fill("5200.50");
    await prices.nth(1).fill("3150.25");
    await prices.nth(0).fill("5200.123");
    await form.getByRole("button", { name: "Back", exact: true }).click();
    await form.getByLabel("Gas use (MJ per year)", { exact: false }).press("Enter");
    await refinement.getByRole("checkbox", { name: "Gas ducted central heating", exact: true }).waitFor();
    await prices.nth(0).fill("5200.50");
    await refinement.getByRole("button", { name: "Enquire about reverse cycle heating", exact: true }).click();
    await checkDialog(page, ["heating-cooling"]);
    assert.equal(state.requests, 0, "Opening an enquiry does not submit the comparison");
    await refinement.getByRole("checkbox", { name: "Gas ducted central heating", exact: true }).uncheck();
    await form.getByRole("button", { name: "Compare gas plans", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Choose your heating system" }).waitFor();
    assert.equal(state.requests, 0, "Clearing the last heating option requires a fresh answer");
    await refinement.getByRole("checkbox", { name: "None", exact: true }).check();
    await form.getByRole("button", { name: "Compare gas plans", exact: true }).click();
    await page.getByRole("heading", { name: "Your gas plan results", exact: true }).waitFor();
    await page.getByRole("heading", { name: "What could switching to electric save?", exact: true }).waitFor();
    if (output) await page.locator(".gas-savings").screenshot({ path: path.join(output, `gas-electrification-${width}.png`) });
    assert.equal(await page.getByRole("button", { name: "Enquire about reverse cycle heating", exact: true }).count(), 0, "None excludes a gas-heating upgrade");
    await page.getByRole("button", { name: "Enquire about heat pump hot water", exact: true }).click();
    await checkDialog(page, ["hot-water"]);
    await page.getByRole("button", { name: "Edit answers", exact: true }).click();
    await refinement.getByRole("checkbox", { name: "Gas ducted central heating", exact: true }).check();
    assert.equal(await prices.nth(0).inputValue(), "5200.50", "Gas heating price survives results and editing");
    assert.equal(await prices.nth(1).inputValue(), "3150.25", "Hot-water price survives results and editing");
    assert.equal(await page.getByText(/Direct Trade project brief/).count(), 0);
    await assertFits(page);
    if (output) await refinement.screenshot({ path: path.join(output, `gas-upgrades-${width}.png`) });
    assert.equal(state.writes, 0);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`Gas ${width}px: quotes, results, editing and enquiries passed.`);
  }
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    console.error((await page.locator("main").innerText()).slice(-9000));
    if (output) await page.screenshot({ path: path.join(output, "journey-failure.png"), fullPage: true });
  }
  throw error;
} finally { await browser.close(); }
