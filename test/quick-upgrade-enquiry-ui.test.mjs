import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL("../src/components/QuickUpgradeEnquiry.tsx", import.meta.url), "utf8");
const dialog = await readFile(new URL("../src/components/QuickUpgradeEnquiryDialog.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/components/QuickUpgradeEnquiry.module.css", import.meta.url), "utf8");
const homepage = await readFile(new URL("../src/components/GettingStarted.tsx", import.meta.url), "utf8");

test("homepage offers a direct independent upgrade request without replacing planning help", () => {
  assert.match(homepage, /<QuickUpgradeEnquiry \/>/);
  assert.match(homepage, /Build my home energy plan/);
  assert.match(homepage, /Ask Wattzun AI first/);
  assert.match(homepage, /Already know what you need\?/);
  assert.match(dialog, /do not sell leads or let businesses pay for placement/);
});

test("quick request uses a short two-step service and contact flow", () => {
  assert.match(component, /Get independent upgrade options/);
  assert.match(component, /dynamic\(/);
  assert.match(component, /ssr: false/);
  assert.match(dialog, /Step 1 of 2/);
  assert.match(dialog, /Step 2 of 2/);
  assert.match(dialog, /ENERGY_SERVICE_CATALOGUE\.map/);
  assert.match(dialog, /Something else or not sure/);
  assert.match(dialog, /\/api\/address-localities\?postcode=/);
  assert.match(dialog, /fetch\("\/api\/leads"/);
});

test("quick request makes required and optional sharing explicit", () => {
  assert.match(dialog, /Australian Energy Assessments needs these details to manage the request/);
  assert.match(dialog, /Your selected services, full property address/);
  assert.match(dialog, /Your email, name and phone are included only if you tick them/);
  assert.match(dialog, /Share my email/);
  assert.match(dialog, /Share my name/);
  assert.match(dialog, /Share my phone number/);
  assert.match(dialog, /<span>First name \*<\/span>[\s\S]*?required/);
  assert.match(dialog, /<span>Last name \*<\/span>[\s\S]*?required/);
  assert.match(dialog, /<span>Phone \*<\/span>[\s\S]*?required/);
  assert.match(dialog, /const \[shareEmail, setShareEmail\] = useState\(false\)/);
  assert.match(dialog, /QUICK_UPGRADE_CONSENT_PURPOSE/);
  assert.match(dialog, /consentAccepted/);
  assert.match(dialog, /type="checkbox"/);
  assert.doesNotMatch(dialog, /defaultChecked/);
  assert.doesNotMatch(dialog, /matchedBusinessCount|matching \$\{matchedCount\}/);
  assert.match(dialog, /Your request has been saved for matching\. Australian Energy Assessments will help if no suitable business is available/);
});

test("quick request modal has keyboard and mobile safeguards", () => {
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /event\.key !== "Tab"/);
  assert.match(dialog, /document\.body\.style\.overflow = "hidden"/);
  assert.match(styles, /@media \(max-width: 640px\)/);
  assert.match(styles, /min-height: 2\.75rem/);
});
