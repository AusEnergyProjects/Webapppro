import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const accountPanel = read("../src/components/FirebaseAccountPanel.tsx");
const dashboard = read("../src/components/CustomerDashboard.tsx");
const actionSettings = read("../src/lib/firebase-email-actions.ts");

test("Firebase handles customer verification codes and returns to the current site", () => {
  assert.match(actionSettings, /handleCodeInApp: false/);
  assert.match(actionSettings, /\/account\?verification=complete/);
  assert.match(accountPanel, /customerEmailVerificationSettings/);
  assert.match(accountPanel, /sendEmailVerification\([\s\S]*customerEmailVerificationSettings/);
  assert.match(dashboard, /customerEmailVerificationSettings/);
  assert.match(dashboard, /sendEmailVerification\([\s\S]*customerEmailVerificationSettings/);
});

test("the dashboard refreshes Firebase state and the ID token before trusting verification", () => {
  assert.match(
    dashboard,
    /await nextUser\.reload\(\);[\s\S]*if \(!nextUser\.emailVerified\) return false;[\s\S]*await nextUser\.getIdToken\(true\);/,
  );
  assert.match(
    dashboard,
    /refreshEmailVerification\(user\)[\s\S]*\.then\(\(\) => load\(user\)\)/,
  );
  assert.match(
    dashboard,
    /if \(account\.emailVerified\) \{[\s\S]*refreshProjects\(user\)[\s\S]*return;/,
  );
});

test("verification errors are not silently reported as successful delivery", () => {
  assert.doesNotMatch(
    accountPanel,
    /sendEmailVerification\([^)]*\)\.catch\(\(\) => undefined\)/,
  );
  assert.match(
    accountPanel,
    /The verification email could not be sent|verification link could not be sent/i,
  );
});
