import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PRIMARY_STORAGE_KEY = "aea-energy-guide-v1";
const BACKUP_STORAGE_KEY = "aea-energy-guide-profile-backup-v1";
const SYNTHETIC_MARKER = "SYNTHETIC CONTINUITY REHEARSAL";
const SYNTHETIC_ANSWER = "Synthetic continuity answer.";

const INSTALLED_BROWSER_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

function printHelp() {
  process.stdout.write(`Usage: node scripts/rehearse-surge-browser-continuity.mjs [options]\n\nOptions:\n  --base-url <url>       Local Surge application URL (default: http://127.0.0.1:3000)\n  --browser-path <path>  Installed Chrome or Edge executable\n  --headed               Show the browser while rehearsing\n  --help                  Show this help\n\nScenarios:\n  restart                 Reopen one persistent browser profile\n  duplicate-tab           Rehydrate a duplicate tab in the same profile\n  fresh-profile           Keep a separate browser profile isolated\n  corrupt-primary         Recover from the profile backup when primary storage is corrupt\n  scroll-handoff          Hand wheel scrolling from the chat boundary to the page\n\nThe Surge API is intercepted with a synthetic answer. No external model is called and no\nconversation transcript or home-context value is written to the report.\n`);
}

function readOption(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parseOptions(argv) {
  if (argv.includes("--help")) {
    printHelp();
    return null;
  }

  const known = new Set(["--base-url", "--browser-path", "--headed"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!known.has(argument)) throw new Error(`Unknown option: ${argument}`);
    if (argument !== "--headed") index += 1;
  }

  const baseUrl = new URL(readOption(argv, "--base-url", "http://127.0.0.1:3000"));
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new Error("--base-url must use http or https");
  }

  const browserPath = readOption(argv, "--browser-path", "") || INSTALLED_BROWSER_PATHS.find(existsSync);
  if (!browserPath || !existsSync(browserPath)) {
    throw new Error("No installed Chrome or Edge executable was found. Supply --browser-path.");
  }

  return {
    baseUrl: baseUrl.href.replace(/\/$/, ""),
    browserPath,
    headed: argv.includes("--headed"),
  };
}

function syntheticReply() {
  return {
    ok: true,
    reply: {
      id: "synthetic-continuity-answer",
      role: "assistant",
      createdAt: "2026-01-01T00:00:00.000Z",
      content: SYNTHETIC_ANSWER,
      directAnswer: SYNTHETIC_ANSWER,
      status: "answered",
      followUpQuestion: "",
    },
    continuation: null,
  };
}

async function installSyntheticRoute(context) {
  await context.route("**/api/energy-assistant", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(syntheticReply()),
    });
  });
}

async function waitForStoredMarker(page) {
  await page.waitForFunction(
    ({ primaryKey, backupKey, marker }) => {
      const values = [
        localStorage.getItem(primaryKey),
        localStorage.getItem(backupKey),
        sessionStorage.getItem(primaryKey),
        sessionStorage.getItem(backupKey),
      ];
      return values.every((value) => typeof value === "string" && value.includes(marker));
    },
    { primaryKey: PRIMARY_STORAGE_KEY, backupKey: BACKUP_STORAGE_KEY, marker: SYNTHETIC_MARKER },
  );
}

async function assertConversationHydrated(page) {
  await page.getByText(SYNTHETIC_MARKER, { exact: true }).waitFor({ state: "visible" });
  await page.getByText(SYNTHETIC_ANSWER, { exact: true }).waitFor({ state: "visible" });
  await waitForStoredMarker(page);
}

async function selectFirstConfirmedOption(select) {
  const option = await select.locator("option").evaluateAll((options) => {
    const disallowed = /not sure|skip|prefer not|select/i;
    const found = options.find((candidate) => candidate.value && !candidate.disabled && !disallowed.test(candidate.textContent || ""));
    return found ? found.value : "";
  });
  if (!option) throw new Error("The first context step has no confirmed select option");
  await select.selectOption(option);
}

async function seedSyntheticSession(page, surgeUrl) {
  await page.goto(surgeUrl, { waitUntil: "domcontentloaded" });
  await page.getByTestId("surge-context-intake").waitFor({ state: "visible" });
  const isProfileComplete = () => page.evaluate(() => Array.from(document.querySelectorAll("progress"))
    .some((progress) => progress.getAttribute("aria-label") === "45 of 45 home details confirmed"));
  for (let attempt = 0; attempt < 26; attempt += 1) {
    if (await isProfileComplete()) break;
    const intake = page.getByTestId("surge-context-intake");
    if (!(await intake.count())) break;
    await intake.waitFor({ state: "visible" });

    const postcode = intake.locator('input[pattern="[0-9]{4}"]');
    if (await postcode.count()) await postcode.fill("3000");

    const selects = intake.locator("select");
    for (let index = 0; index < await selects.count(); index += 1) {
      await selectFirstConfirmedOption(selects.nth(index));
    }

    const checkboxGroups = intake.locator('fieldset:has(input[type="checkbox"])');
    for (let groupIndex = 0; groupIndex < await checkboxGroups.count(); groupIndex += 1) {
      const group = checkboxGroups.nth(groupIndex);
      if (await group.locator('input[type="checkbox"]:checked').count()) continue;

      const options = group.locator("label");
      let selected = false;
      for (let optionIndex = 0; optionIndex < await options.count(); optionIndex += 1) {
        const option = options.nth(optionIndex);
        const label = (await option.innerText()).trim();
        if (/not sure|none|skip|prefer not/i.test(label)) continue;
        await option.locator('input[type="checkbox"]').check();
        selected = true;
        break;
      }
      if (!selected) throw new Error("A context checkbox group has no confirmed option");
    }

    if (await isProfileComplete()) break;
    const submit = intake.locator('button[type="submit"]');
    if (!(await submit.count())) break;
    await submit.click();
  }

  if (!(await isProfileComplete())) {
    const progress = await page.locator('[data-testid="surge-context-scroll"]').innerText().catch(() => "Context rail unavailable");
    const intake = await page.getByTestId("surge-context-intake").innerText().catch(() => "Context intake unavailable");
    throw new Error(`Synthetic profile did not reach 45 of 45. Context: ${progress.replace(/\s+/g, " ").trim()}. Intake: ${intake.replace(/\s+/g, " ").trim()}`);
  }

  const composer = page.getByTestId("surge-composer-input");
  await composer.waitFor({ state: "visible" });
  await composer.fill(SYNTHETIC_MARKER);
  await page.getByTestId("surge-composer-submit").click();
  await assertConversationHydrated(page);
}

async function assertFreshProfile(page, surgeUrl) {
  await page.goto(surgeUrl, { waitUntil: "domcontentloaded" });
  await page.getByTestId("surge-context-intake").waitFor({ state: "visible" });
  const leaked = await page.evaluate(
    ({ primaryKey, backupKey, marker }) => [
      localStorage.getItem(primaryKey),
      localStorage.getItem(backupKey),
      sessionStorage.getItem(primaryKey),
      sessionStorage.getItem(backupKey),
    ].some((value) => value?.includes(marker)),
    { primaryKey: PRIMARY_STORAGE_KEY, backupKey: BACKUP_STORAGE_KEY, marker: SYNTHETIC_MARKER },
  );
  if (leaked) throw new Error("The synthetic conversation leaked into a fresh browser profile");
}

async function corruptPrimaryAndVerifyRecovery(page) {
  await page.evaluate((primaryKey) => {
    localStorage.setItem(primaryKey, "{invalid");
    sessionStorage.setItem(primaryKey, "{invalid");
  }, PRIMARY_STORAGE_KEY);
  await page.reload({ waitUntil: "domcontentloaded" });
  await assertConversationHydrated(page);
  const repaired = await page.evaluate(
    ({ primaryKey, marker }) => [localStorage.getItem(primaryKey), sessionStorage.getItem(primaryKey)]
      .every((value) => typeof value === "string" && value.includes(marker)),
    { primaryKey: PRIMARY_STORAGE_KEY, marker: SYNTHETIC_MARKER },
  );
  if (!repaired) throw new Error("Backup recovery did not repair primary storage");
}

async function verifyScrollHandoff(page) {
  const conversation = page.getByTestId("surge-conversation-scroll");
  await conversation.evaluate((element) => {
    const spacer = document.createElement("div");
    spacer.dataset.continuityRehearsalSpacer = "true";
    spacer.style.height = "2400px";
    document.body.append(spacer);
    element.scrollTop = element.scrollHeight;
    window.scrollTo(0, 0);
  });
  await conversation.hover();
  await page.mouse.wheel(0, 640);
  await page.waitForFunction(() => window.scrollY > 0);

  const pageBottom = await conversation.evaluate((element) => {
    element.scrollTop = 0;
    window.scrollTo(0, document.body.scrollHeight);
    return window.scrollY;
  });
  await page.mouse.wheel(0, -640);
  await page.waitForFunction((previous) => window.scrollY < previous, pageBottom);
}

async function launchPersistent(chromium, profilePath, options) {
  const context = await chromium.launchPersistentContext(profilePath, {
    executablePath: options.browserPath,
    headless: !options.headed,
    viewport: { width: 1280, height: 900 },
    args: ["--no-first-run", "--no-default-browser-check", "--disable-component-update"],
  });
  await installSyntheticRoute(context);
  return context;
}

async function runScenario(results, name, callback) {
  const startedAt = performance.now();
  try {
    await callback();
    results.push({ name, status: "passed", latencyMs: Math.round(performance.now() - startedAt) });
  } catch (error) {
    results.push({ name, status: "failed", latencyMs: Math.round(performance.now() - startedAt) });
    throw error;
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (!options) return;

  // Dynamic import keeps non-browser CI usable. The project supplies playwright-core,
  // while Chrome or Edge comes from the workstation rather than a browser download.
  const { chromium } = await import("playwright-core");
  const primaryProfile = await mkdtemp(join(tmpdir(), "surge-continuity-primary-"));
  const freshProfile = await mkdtemp(join(tmpdir(), "surge-continuity-fresh-"));
  const surgeUrl = `${options.baseUrl}/surge?continuity-rehearsal=1`;
  const scenarios = [];
  let context;
  let freshContext;

  try {
    context = await launchPersistent(chromium, primaryProfile, options);
    const primaryPage = context.pages()[0] ?? await context.newPage();
    await seedSyntheticSession(primaryPage, surgeUrl);

    await runScenario(scenarios, "duplicate-tab", async () => {
      const duplicate = await context.newPage();
      await duplicate.goto(surgeUrl, { waitUntil: "domcontentloaded" });
      await assertConversationHydrated(duplicate);
      await duplicate.close();
    });

    await context.close();
    context = undefined;
    await runScenario(scenarios, "restart", async () => {
      context = await launchPersistent(chromium, primaryProfile, options);
      const restarted = context.pages()[0] ?? await context.newPage();
      await restarted.goto(surgeUrl, { waitUntil: "domcontentloaded" });
      await assertConversationHydrated(restarted);
    });

    await runScenario(scenarios, "fresh-profile", async () => {
      freshContext = await launchPersistent(chromium, freshProfile, options);
      const freshPage = freshContext.pages()[0] ?? await freshContext.newPage();
      await assertFreshProfile(freshPage, surgeUrl);
      await freshContext.close();
      freshContext = undefined;
    });

    const restartedPage = context.pages()[0];
    await runScenario(scenarios, "corrupt-primary", () => corruptPrimaryAndVerifyRecovery(restartedPage));
    await runScenario(scenarios, "scroll-handoff", () => verifyScrollHandoff(restartedPage));

    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      aggregateOnly: true,
      browser: options.browserPath.toLowerCase().includes("msedge") ? "installed-edge" : "installed-chrome",
      scenarioCount: scenarios.length,
      passed: scenarios.every((scenario) => scenario.status === "passed"),
      scenarios,
    }, null, 2)}\n`);
  } finally {
    await freshContext?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
    await rm(primaryProfile, { recursive: true, force: true });
    await rm(freshProfile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`Surge browser continuity rehearsal failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
