import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const supplierCatalogue = read(
  "../src/components/SupplierCatalogueWorkspace.tsx",
);
const verification = read(
  "../src/components/DirectTradeVerificationCentre.tsx",
);
const membership = read("../src/app/direct-trade/membership/page.tsx");
const profileRoute = read("../src/app/api/trade-profile/route.ts");
const verificationRoute = read(
  "../src/app/api/trade-verification/documents/route.ts",
);
const schema = read("../db/schema.ts");
const hosting = read("../.openai/hosting.json");
const standards = read("../src/app/direct-trade/standards/page.tsx");
const partners = read("../src/components/DirectTradePartnerForm.tsx");

test("dashboard availability and email preferences are durable and owner protected", () => {
  assert.match(schema, /availabilityStatus: text\("availability_status"\)/);
  assert.match(schema, /emailOpportunities: integer\("email_opportunities"/);
  assert.match(schema, /emailWeeklySummary: integer\("email_weekly_summary"/);
  assert.match(profileRoute, /export async function PATCH/);
  assert.match(profileRoute, /requireFirebaseIdentity/);
  assert.match(profileRoute, /sameOrigin/);
  assert.match(profileRoute, /\["open", "limited", "paused"\]/);
  assert.match(profileRoute, /WHERE firebase_uid = \?/);
  assert.match(dashboard, /Save dashboard preferences/);
  assert.match(
    dashboard,
    /Future allocation will use the service-base postcode, radius, verified capability and recent opportunity load/,
  );
  assert.match(
    supplierCatalogue,
    /Wholesaler accounts never receive or view household opportunities/,
  );
});

test("verification centre changes private evidence workflow by business role", () => {
  assert.match(verification, /const installerChecks/);
  assert.match(verification, /const supplierChecks/);
  assert.match(verification, /profile\?\.partnerType === "supplier"/);
  assert.match(verification, /Trade licence or registration/);
  assert.match(verification, /Product compliance evidence/);
  assert.match(verification, /type="file"/);
  assert.match(verification, /accept="application\/pdf,image\/jpeg,image\/png/);
  assert.match(verification, /Store document privately/);
  assert.match(verification, /No public file links/);
  assert.match(
    verification,
    /Keep personal identity records out unless requested/,
  );
});

test("verification evidence is private, bounded and owner protected", () => {
  assert.match(hosting, /"r2": "EVIDENCE"/);
  assert.match(schema, /sqliteTable\("verification_documents"/);
  assert.match(schema, /verification_documents_owner_idx/);
  assert.match(verificationRoute, /MAX_FILE_BYTES = 8 \* 1024 \* 1024/);
  assert.match(verificationRoute, /application\/pdf/);
  assert.match(verificationRoute, /image\/jpeg/);
  assert.match(verificationRoute, /image\/png/);
  assert.match(verificationRoute, /requireFirebaseIdentity/);
  assert.match(verificationRoute, /sameOrigin/);
  assert.match(verificationRoute, /WHERE id = \? AND firebase_uid = \?/);
  assert.match(verificationRoute, /WHERE firebase_uid = \?/);
  assert.match(
    verificationRoute,
    /verification\/\$\{identity\.uid\}\/\$\{crypto\.randomUUID\(\)\}/,
  );
  assert.match(verificationRoute, /Cache-Control": "private, no-store"/);
  assert.doesNotMatch(verificationRoute, /publicUrl|signedUrl/);
});

test("membership page presents all approved prices and no per-lead model", () => {
  assert.match(membership, /\$99/);
  assert.match(membership, /\$1,188 billed once per year/);
  assert.match(membership, /\$199/);
  assert.match(membership, /\$2,388 billed once per year/);
  assert.match(membership, /\$399/);
  assert.match(membership, /All prices include GST/);
  assert.match(membership, /One subscription, no per-lead fees/);
  assert.match(membership, /Secure Stripe billing is live/);
  assert.match(
    membership,
    /monthly member receives the second month free/,
  );
  assert.match(
    membership,
    /Self-referrals and duplicate businesses are excluded/,
  );
  assert.match(dashboard, /Generate my referral link/);
  assert.match(dashboard, /Annual plan: the next renewal moves out to month 13/);
});

test("membership and verification routes are connected across the account journey", () => {
  assert.match(dashboard, /href="\/direct-trade\/dashboard\/verification"/);
  assert.match(dashboard, /href="\/direct-trade\/membership"/);
  assert.match(partners, /View membership pricing/);
  assert.match(standards, /Membership and referrals/);
});

test("installer leads can be narrowed without exposing household details", () => {
  assert.match(dashboard, /dashboard-lead-filters/);
  assert.match(dashboard, /Search leads/);
  assert.match(dashboard, /leadStatusFilter/);
  assert.match(dashboard, /leadServiceFilter/);
  assert.match(dashboard, /leadStateFilter/);
  assert.match(dashboard, /No leads match these filters/);
  assert.doesNotMatch(dashboard, /customerEmail|customerPhone|streetAddress/);
});

test("new dashboard, verification and membership copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(dashboard + verification + membership, /[\u2013\u2014]/);
});
