import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const styles = read("../src/app/globals.css");
const supplierCatalogue = read(
  "../src/components/SupplierCatalogueWorkspace.tsx",
);
const purchasing = read("../src/components/TradePurchasingWorkspace.tsx");
const businessHub = read("../src/components/TradeBusinessHub.tsx");
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
const tlinkChrome = read("../src/components/TLinkChrome.tsx");
const manifest = read("../src/app/manifest.ts");
const appLayout = read("../src/app/layout.tsx");

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

test("trade access page presents the free verified operating model", () => {
  assert.match(membership, /Run the core trade workflow for A\$0/);
  assert.match(membership, /without a card, subscription, seat fee, job fee, quote fee or/);
  assert.match(membership, /Free and previously paid businesses use the same core data, screens and workflow/);
  assert.match(membership, /No new subscription is required for core access/);
  assert.match(membership, /Manage an existing Stripe membership/);
  assert.doesNotMatch(membership, /Sign in to choose this plan|\$99|\$399/);
  assert.match(dashboard, /Unlimited users, leads, jobs and quotes remain A\$0/);
  assert.doesNotMatch(dashboard, /Start annual membership|Generate my referral link/);
});

test("free access and verification routes are connected across the account journey", () => {
  assert.match(dashboard, /href="\/direct-trade\/dashboard\/verification"/);
  assert.match(partners, /See what is included for free/);
  assert.match(standards, /Free trade access/);
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

test("installer and wholesaler dashboards share the clean operations shell", () => {
  assert.match(dashboard, /trade-portal-shell/);
  assert.match(dashboard, /TLinkBrand/);
  assert.match(dashboard, /Wholesaler control centre/);
  assert.match(dashboard, /Installer control centre/);
  assert.match(dashboard, /dashboard-rail-note/);
  assert.match(styles, /Admin-inspired trade CRM shell/);
  assert.match(styles, /grid-template-columns: 244px minmax\(0, 1fr\)/);
  assert.match(styles, /@media \(max-width: 780px\)/);
  assert.match(styles, /dashboard-workspace-nav button\.active/);
  assert.match(dashboard, /dashboard-workspace-shortcuts/);
  for (const shortcut of ["Jobs", "Customers", "Price book"]) assert.match(dashboard, new RegExp(`'${shortcut}'`));
  assert.match(dashboard, /kind: "crm-view"/);
  assert.match(styles, /dashboard-workspace-shortcuts/);
});

test("TLink has a consistent trade platform identity and installable app icon", () => {
  assert.match(tlinkChrome, />TLink</);
  assert.match(tlinkChrome, /tlink-icon-192\.png/);
  assert.match(tlinkChrome, /TLink trade ecosystem dashboard/);
  assert.match(manifest, /tlink-icon-192\.png/);
  assert.match(manifest, /tlink-icon-512\.png/);
  assert.match(appLayout, /tlink-icon-192\.png/);
  assert.ok(fs.statSync(new URL("../public/tlink-icon-192.png", import.meta.url)).size > 10_000);
  assert.ok(fs.statSync(new URL("../public/tlink-icon-512.png", import.meta.url)).size > 50_000);
});

test("the mobile More menu opens above the CRM view instead of being clipped", () => {
  assert.match(styles, /\.trade-portal-shell \.crm-nav \{ overflow: visible;/);
  assert.match(styles, /\.trade-portal-shell \.crm-more-nav\[data-open\] \{ z-index: 25;/);
  assert.match(styles, /max-width: calc\(100vw - 30px\)/);
});

test("wholesaler work is progressive instead of one crowded catalogue page", () => {
  assert.match(supplierCatalogue, /supplier-command-nav/);
  assert.match(supplierCatalogue, /"overview" \| "enquiries" \| "catalogue" \| "editor"/);
  assert.match(supplierCatalogue, /Readiness and visibility/);
  assert.match(supplierCatalogue, /Installer product requests/);
  assert.match(supplierCatalogue, /One focused listing form/);
  assert.match(supplierCatalogue, /supplier-product-library-focused/);
  assert.match(styles, /supplier-overview-actions/);
  assert.match(styles, /supplier-command-nav button\.active/);
  assert.match(purchasing, /purchasing-flow-strip/);
  assert.match(purchasing, /Wholesaler order desk/);
  assert.match(businessHub, /Move supply work from request to completion/);
});

test("new dashboard, verification and membership copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(
    dashboard + supplierCatalogue + purchasing + businessHub + verification + membership,
    /[\u2013\u2014]/,
  );
});
