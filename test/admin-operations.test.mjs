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
const ecosystemHealthRoute = read(
  "../src/app/api/admin/ecosystem-health/route.ts",
);
const recoveryRoute = read("../src/app/api/admin/recovery/route.ts");
const firebaseServer = read("../src/lib/firebase-server.ts");
const productRoute = read("../src/app/api/admin/products/route.ts");
const referralsRoute = read("../src/app/api/admin/referrals/route.ts");
const partnerOpportunities = read(
  "../src/app/api/trade-opportunities/route.ts",
);
const portal = read("../src/components/AdminOperationsPortal.tsx");
const opportunityWorkspace = read("../src/components/AdminOpportunityWorkspace.tsx");
const catalogueWorkspace = read("../src/components/AdminCatalogueWorkspace.tsx");
const accountWorkspace = read("../src/components/AdminAccountWorkspace.tsx");
const sharedWorkspace = read("../src/components/admin-workspace.ts");
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
    ecosystemHealthRoute,
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
  assert.match(adminServer, /Operations data could not be loaded/);
  assert.match(adminServer, /code === "ADMIN_REQUIRED"/);
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

test("owner identity recovery is explicit, recent, password based and audited", () => {
  assert.match(firebaseServer, /authTime: number/);
  assert.match(firebaseServer, /signInProvider: string/);
  assert.match(firebaseServer, /payload\.auth_time/);
  assert.match(firebaseServer, /sign_in_provider/);
  assert.match(sessionRoute, /canRecoverOwner: true/);
  assert.match(sessionRoute, /lower\(trim\(email\)\) = \?/);
  assert.match(sessionRoute, /role = 'owner' AND status = 'active'/);
  assert.match(recoveryRoute, /identity\.emailVerified/);
  assert.match(recoveryRoute, /lower\(trim\(email\)\) = \?/);
  assert.match(recoveryRoute, /identity\.signInProvider !== "password"/);
  assert.match(recoveryRoute, /RECENT_AUTH_SECONDS = 60 \* 60/);
  assert.match(recoveryRoute, /firebase_uid = \?/);
  assert.doesNotMatch(recoveryRoute, /record\.firebase_uid, identity\.email/);
  assert.match(recoveryRoute, /admin\.owner_recovery/);
  assert.match(recoveryRoute, /security\.owner_identity_recovered/);
  assert.match(recoveryRoute, /recoveryStage = "owner record update"/);
  assert.match(recoveryRoute, /recentPasswordAuthentication: true/);
  assert.doesNotMatch(recoveryRoute, /export async function GET/);
  assert.match(portal, /Reconnect owner access/);
  assert.match(portal, /admin-inline-status/);
  assert.match(portal, /Owner access is active\. Some workspace data could not be loaded/);
  assert.doesNotMatch(recoveryRoute + portal, /[\u2013\u2014]/);
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
  assert.match(schema, /sqliteTable\("customer_project_quotes"/);
  assert.match(opportunitiesRoute, /privacy-safe project summary/i);
  assert.doesNotMatch(
    schema,
    /household_name|customer_email|customer_phone|street_address/,
  );
  assert.match(partnerOpportunities, /WHERE m\.firebase_uid = \?/);
  assert.match(partnerOpportunities, /WHERE id = \? AND firebase_uid = \?/);
  assert.match(partnerOpportunities, /postcode: ""/);
  assert.match(
    partnerOpportunities,
    /distanceBand: distanceBand\(row\.distance_metres\)/,
  );
  assert.match(
    partnerOpportunities,
    /Direct customer contact is not available\. Respond through the structured platform workflow/,
  );
  assert.match(
    partnerOpportunities,
    /Wholesalers cannot access or respond to household opportunities/,
  );
  assert.match(partnerOpportunities, /action === "submit_quote"/);
  assert.match(
    dashboard,
    /Household identity, exact location and contact details\s+stay outside the trade workspace/,
  );
  assert.match(dashboard, /structured platform controls only/);
  assert.match(dashboard, /Platform coordination active/);
  assert.match(dashboard, /Customer contact details remain private/);
  assert.match(dashboard, /<InstallerPlatformQuote/);
  assert.match(dashboard, /I’m interested/);
});

test("operations UI covers accounts, evidence, projects, access and audit", () => {
  assert.match(portal, /Network overview/);
  assert.match(portal, /tlink-icon-192\.png/);
  assert.match(portal, /AdminTLinkBrand/);
  assert.match(portal, /fixedType="customer"/);
  assert.match(portal, /Promise\.allSettled/);
  assert.match(
    portal,
    /www\.gstatic\.com\/firebasejs\/ui\/2\.0\.0\/images\/auth\/google\.svg/,
  );
  assert.match(accountWorkspace, /Partner and wholesaler accounts/);
  assert.match(accountWorkspace, /Protected download/);
  assert.match(opportunityWorkspace, /Create an opportunity/);
  assert.match(opportunityWorkspace, /Allocate nearest eligible installers/);
  assert.match(catalogueWorkspace, /Product catalogue and availability/);
  assert.match(portal, /Leads and opportunities/);
  assert.match(catalogueWorkspace, /Product name/);
  assert.match(catalogueWorkspace, /Wholesaler/);
  assert.match(catalogueWorkspace, /Model code/);
  assert.match(catalogueWorkspace, /Minimum price ex GST/);
  assert.match(catalogueWorkspace, /Maximum price ex GST/);
  assert.match(catalogueWorkspace, /Minimum order/);
  assert.match(catalogueWorkspace, /Lead time/);
  assert.match(catalogueWorkspace, /Warranty/);
  assert.match(portal, /Referral rewards and eligibility/);
  assert.match(portal, /Operations team/);
  assert.match(portal, /Recent administrator activity/);
  assert.match(portal, /sendPasswordResetEmail/);
  assert.match(portal, /Forgot password\?/);
  assert.match(portal, /href="#operations-inbox"/);
  assert.match(portal, /aria-label=\{`Open operations inbox/);
  assert.match(portal, /Ecosystem walkthrough/);
  assert.match(portal, /Owner recovery readiness/);
  assert.match(opportunityWorkspace, /Search opportunities/);
  assert.match(accountWorkspace, /Export visible partners CSV/);
  assert.match(opportunityWorkspace, /Export visible leads CSV/);
  assert.match(catalogueWorkspace, /Export visible products CSV/);
  assert.match(accountWorkspace, /downloadWorkspaceCsv/);
  assert.doesNotMatch(portal, /[\u2013\u2014]/);
});

test("the extracted account workspace preserves saved filters, cursors, moderation and privacy boundaries", () => {
  assert.match(portal, /<AdminAccountWorkspace api=\{api\} role=\{session\.role\} setStatus=\{setStatus\} onCounts=\{setAccountListCounts\}/);
  for (const parameter of ["search", "partnerType", "verification", "synthetic", "cursor", "total"]) {
    assert.match(accountWorkspace, new RegExp(`params\\.set\\("${parameter}"`));
  }
  assert.match(accountWorkspace, /cursors\.current\[accountPage\] = next\.nextCursor/);
  assert.match(accountWorkspace, /view=admin-partners/);
  assert.match(accountWorkspace, /api\("\/api\/admin\/accounts", \{ method: "PATCH"/);
  assert.match(accountWorkspace, /Export visible partners CSV/);
  assert.match(accountWorkspace, /Protected document download started/);
  assert.doesNotMatch(accountWorkspace, /household_name|customer_email|customer_phone|street_address/);
});

test("admin list workspaces share only proven formatting and saved-view helpers", () => {
  assert.match(sharedWorkspace, /saveWorkspaceListView/);
  assert.match(sharedWorkspace, /resetWorkspaceListView/);
  assert.match(sharedWorkspace, /workspaceError/);
  for (const workspace of [accountWorkspace, opportunityWorkspace, catalogueWorkspace]) {
    assert.match(workspace, /@\/components\/admin-workspace/);
    assert.match(workspace, /saveWorkspaceListView/);
    assert.match(workspace, /resetWorkspaceListView/);
  }
});

test("the extracted opportunity workspace preserves filters, cursors, actions and privacy-safe rendering", () => {
  assert.match(portal, /<AdminOpportunityWorkspace api=\{api\} demoOnlyRequest=\{opportunityDemoRequest\} role=\{session\.role\} setStatus=\{setStatus\}/);
  for (const parameter of ["search", "status", "service", "state", "synthetic", "cursor", "total"]) {
    assert.match(opportunityWorkspace, new RegExp(`params\\.set\\("${parameter}"`));
  }
  assert.match(opportunityWorkspace, /opportunityCursors\.current\[opportunityPage\] = next\.nextCursor/);
  assert.match(opportunityWorkspace, /view=admin-opportunities/);
  assert.match(opportunityWorkspace, /method: "POST"[\s\S]*serviceCategories: opportunityDraft\.categories/);
  assert.match(opportunityWorkspace, /api\("\/api\/admin\/opportunities\/allocate"/);
  assert.match(opportunityWorkspace, /api\("\/api\/admin\/opportunities\/matches"/);
  assert.match(opportunityWorkspace, /Privacy-safe summary/);
  assert.doesNotMatch(opportunityWorkspace, /household_name|customer_email|customer_phone|street_address/);
});

test("the extracted catalogue workspace preserves filters, cursors, reviews and protected boundaries", () => {
  assert.match(portal, /<AdminCatalogueWorkspace api=\{api\} role=\{session\.role\} setStatus=\{setStatus\}/);
  for (const parameter of ["search", "supplier", "brand", "model", "category", "stock", "review", "listing", "minPrice", "maxPrice", "synthetic", "cursor", "total"]) {
    assert.match(catalogueWorkspace, new RegExp(`params\\.set\\("${parameter}"`));
  }
  assert.match(catalogueWorkspace, /productCursors\.current\[productPage\] = next\.nextCursor/);
  assert.match(catalogueWorkspace, /view=admin-products/);
  assert.match(catalogueWorkspace, /method: "PATCH"[\s\S]*id: product\.id/);
  assert.match(catalogueWorkspace, /Export visible products CSV/);
  assert.match(catalogueWorkspace, /no household lead data/i);
  assert.doesNotMatch(catalogueWorkspace, /customer_email|customer_phone|street_address|household_name/);
});

test("large opportunity sets use cursor pages with bounded allocation lookups", () => {
  assert.match(opportunitiesRoute, /decodeKeysetCursor/);
  assert.match(opportunitiesRoute, /keysetAfter/);
  assert.match(opportunitiesRoute, /LIMIT \?`\)/);
  assert.match(opportunitiesRoute, /pageRows\.map\(\(\) => "\?"\)/);
  assert.doesNotMatch(opportunitiesRoute, /LIMIT \? OFFSET \?/);
});

test("the ecosystem walkthrough is read only, privacy safe and checks every platform role", () => {
  assert.match(ecosystemHealthRoute, /requireAdminIdentity\(request\)/);
  assert.match(ecosystemHealthRoute, /sameOrigin\(request\)/);
  assert.match(ecosystemHealthRoute, /COALESCE\(is_synthetic, 0\) = 1/);
  assert.match(ecosystemHealthRoute, /match_count >= 6/);
  assert.match(ecosystemHealthRoute, /listing_status = 'published'/);
  assert.match(ecosystemHealthRoute, /customer_project_quotes/);
  assert.doesNotMatch(ecosystemHealthRoute, /export async function POST|export async function PATCH/);
  assert.doesNotMatch(ecosystemHealthRoute, /customer_email|customer_phone|address_line_1|private_notes/);
  assert.doesNotMatch(ecosystemHealthRoute, /[\u2013\u2014]/);
});
