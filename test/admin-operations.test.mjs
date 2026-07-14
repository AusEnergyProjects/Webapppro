import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const adminServer = read("../src/lib/admin-server.ts");
const sessionRoute = read("../src/app/api/admin/session/route.ts");
const accountsRoute = read("../src/app/api/admin/accounts/route.ts");
const adminsRoute = read("../src/app/api/admin/admins/route.ts");
const evidenceRoute = read("../src/app/api/admin/evidence/route.ts");
const opportunitiesRoute = read("../src/app/api/admin/opportunities/route.ts");
const matchesRoute = read(
  "../src/app/api/admin/opportunities/matches/route.ts",
);
const allocationRoute = read(
  "../src/app/api/admin/opportunities/allocate/route.ts",
);
const productRoute = read("../src/app/api/admin/products/route.ts");
const referralsRoute = read("../src/app/api/admin/referrals/route.ts");
const partnerOpportunities = read(
  "../src/app/api/trade-opportunities/route.ts",
);
const portal = read("../src/components/AdminOperationsPortal.tsx");
const portalPage = read("../src/app/operations/control-centre/page.tsx");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");

test("operations portal is unlisted and every administrator API has server-side roles", () => {
  assert.match(
    portalPage,
    /robots: \{ index: false, follow: false, noarchive: true, nosnippet: true \}/,
  );
  for (const route of [
    sessionRoute,
    accountsRoute,
    adminsRoute,
    evidenceRoute,
    opportunitiesRoute,
    matchesRoute,
    allocationRoute,
    productRoute,
    referralsRoute,
  ]) {
    assert.match(route, /sameOrigin\(request\)/);
    assert.match(route, /requireAdminIdentity\(request/);
    assert.match(route, /Cache-Control.*no-store|adminJson/);
  }
  assert.match(adminServer, /emailVerified/);
  assert.match(adminServer, /ADMIN_SUSPENDED/);
  assert.match(adminServer, /ROLE_REQUIRED/);
});

test("first owner setup is one-time, secret-backed and verified", () => {
  assert.match(sessionRoute, /AEA_ADMIN_BOOTSTRAP_TOKEN/);
  assert.match(sessionRoute, /timingSafeMatch/);
  assert.match(sessionRoute, /identity\.emailVerified/);
  assert.match(sessionRoute, /WHERE NOT EXISTS \(SELECT 1 FROM admin_users\)/);
  assert.match(sessionRoute, /admin\.bootstrap/);
  assert.doesNotMatch(sessionRoute, /AEA_ADMIN_BOOTSTRAP_TOKEN\s*=\s*["']/);
});

test("administration is least privilege and protects the final owner", () => {
  assert.match(adminServer, /"owner", "admin", "reviewer", "support"/);
  assert.match(
    accountsRoute,
    /Reviewers can update verification status and internal notes only/,
  );
  assert.match(adminsRoute, /requireAdminIdentity\(request, \["owner"\]\)/);
  assert.match(adminsRoute, /At least one active owner account is required/);
  assert.match(adminsRoute, /cannot suspend or demote your own owner account/);
  assert.match(adminsRoute, /pending:\$\{id\}/);
});

test("moderation, evidence and matching actions have durable audit records", () => {
  assert.match(schema, /sqliteTable\("admin_audit_log"/);
  assert.match(schema, /sqliteTable\("trade_account_notes"/);
  assert.match(accountsRoute, /writeAdminAudit/);
  assert.match(opportunitiesRoute, /writeAdminAudit/);
  assert.match(matchesRoute, /writeAdminAudit/);
  assert.match(evidenceRoute, /verification\.download/);
  assert.match(evidenceRoute, /Content-Disposition/);
  assert.doesNotMatch(evidenceRoute, /publicUrl|signedUrl/);
});

test("opportunities remain privacy-safe and partner responses stay owner scoped", () => {
  assert.match(schema, /sqliteTable\("trade_opportunities"/);
  assert.match(schema, /trade_opportunity_matches_unique_idx/);
  assert.match(opportunitiesRoute, /privacy-safe project summary/i);
  assert.doesNotMatch(
    schema,
    /household_name|customer_email|customer_phone|street_address/,
  );
  assert.match(partnerOpportunities, /WHERE m\.firebase_uid = \?/);
  assert.match(partnerOpportunities, /WHERE id = \? AND firebase_uid = \?/);
  assert.match(
    dashboard,
    /Household identity and street\s+address are not exposed/,
  );
  assert.match(dashboard, /I’m interested/);
});

test("operations UI covers accounts, evidence, projects, access and audit", () => {
  assert.match(portal, /Network overview/);
  assert.match(
    portal,
    /www\.gstatic\.com\/firebasejs\/ui\/2\.0\.0\/images\/auth\/google\.svg/,
  );
  assert.match(portal, /Partner and wholesaler accounts/);
  assert.match(portal, /Protected download/);
  assert.match(portal, /Create an opportunity/);
  assert.match(portal, /Allocate nearest eligible installers/);
  assert.match(portal, /Catalogue review and availability/);
  assert.match(portal, /Referral rewards and eligibility/);
  assert.match(portal, /Operations team/);
  assert.match(portal, /Recent administrator activity/);
  assert.doesNotMatch(portal, /[\u2013\u2014]/);
});
