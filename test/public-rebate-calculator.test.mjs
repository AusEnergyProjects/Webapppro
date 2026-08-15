import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const page = read("../src/app/calculator/page.tsx");
const workspace = read(
  "../src/components/PublicRebateCalculatorWorkspace.tsx",
);
const calculator = read("../src/components/CreditexAllProgramCalculator.tsx");
const access = read("../src/lib/creditex-calculator-access-server.ts");
const officialProducts = read(
  "../src/app/api/creditex/official-products/route.ts",
);
const stcProducts = read("../src/app/api/creditex/stc-products/route.ts");
const programEstimates = read(
  "../src/app/api/creditex/program-estimates/route.ts",
);
const stcEstimates = read("../src/app/api/creditex/stc-estimates/route.ts");

test("the public calculator is a direct no-account quote flow", () => {
  assert.match(page, /PublicRebateCalculatorWorkspace/);
  assert.match(workspace, /No account is needed/);
  assert.match(workspace, /<CreditexAllProgramCalculator api=\{api\} role="public"/);
  assert.doesNotMatch(workspace, /Authorization|firebase|sign.?in/i);
  assert.match(calculator, /estimatePurpose: "quote"/);
});

test("public product reads are redacted and registry refresh stays admin-only", () => {
  assert.match(access, /allowPublicQuote/);
  for (const route of [officialProducts, stcProducts]) {
    const get = route.slice(
      route.indexOf("export async function GET"),
      route.indexOf("export async function POST"),
    );
    const post = route.slice(route.indexOf("export async function POST"));
    assert.match(get, /allowPublicQuote: true/);
    assert.match(get, /projectCreditexCalculatorReadResponse/);
    assert.match(post, /requireComplianceAccess/);
    assert.match(post, /allowedRoles: \["admin"\]/);
    assert.doesNotMatch(post, /allowPublicQuote/);
  }
});

test("public requests have bounded retries and no refresh control", () => {
  assert.match(workspace, /PUBLIC_CALCULATOR_RECOVERY_TIMEOUT_MS = 180_000/);
  assert.match(workspace, /PUBLIC_CALCULATOR_MAXIMUM_ATTEMPTS = 20/);
  assert.match(workspace, /CREDITEX_SCHEMA_GUARDS_INSTALLING/);
  assert.match(workspace, /OFFICIAL_PRODUCT_FLEET_BUSY/);
  assert.match(workspace, /recoveryDeadline - Date\.now\(\)/);
  assert.match(workspace, /response\.headers\.get\("Retry-After"\)/);
  assert.match(workspace, /options\.requestTimeoutMs \|\| 25_000/);
  assert.doesNotMatch(workspace, /action: "refresh"/);
});

test("public calculator states the exact calculation boundary", () => {
  assert.match(
    workspace,
    /exact,\s+source-verified calculation for your selected inputs, installation\s+date and source version/,
  );
  assert.match(
    workspace,
    /Certificate creation, eligibility and\s+provider acceptance are separate/,
  );
});

test("anonymous estimate access is enabled only for explicit quote requests", () => {
  assert.match(
    programEstimates,
    /allowPublicQuote: accessPurpose === "quote"/,
  );
  assert.match(
    stcEstimates,
    /allowPublicQuote: estimatePurpose === "quote"/,
  );
  assert.match(programEstimates, /requestEstimatePurpose\(raw\)/);
  assert.match(stcEstimates, /estimatePurpose !== "quote"/);
});
