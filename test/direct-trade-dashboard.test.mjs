import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const businessSettings = read(
  "../src/components/TradeBusinessSettingsWorkspace.tsx",
);
const styles = read("../src/app/globals.css");
const supplierCatalogue = read(
  "../src/components/SupplierCatalogueWorkspace.tsx",
);
const purchasing = read("../src/components/TradePurchasingWorkspace.tsx");
const businessHub = read("../src/components/TradeBusinessHub.tsx");
const installerCrm = read("../src/components/InstallerCrmWorkspace.tsx");
const verification = read(
  "../src/components/DirectTradeVerificationCentre.tsx",
);
const access = read("../src/app/direct-trade/access/page.tsx");
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

test("unified Business settings remain durable and owner protected", () => {
  assert.match(schema, /availabilityStatus: text\("availability_status"\)/);
  assert.match(schema, /emailOpportunities: integer\("email_opportunities"/);
  assert.match(schema, /emailWeeklySummary: integer\("email_weekly_summary"/);
  assert.match(profileRoute, /export async function PATCH/);
  assert.match(profileRoute, /requireFirebaseIdentity/);
  assert.match(profileRoute, /sameOrigin/);
  assert.match(profileRoute, /\["open", "limited", "paused"\]/);
  assert.match(profileRoute, /WHERE firebase_uid = \?/);
  assert.equal(
    [...dashboard.matchAll(/<TradeBusinessSettingsWorkspace/g)].length,
    2,
  );
  assert.match(businessSettings, /Save notifications/);
  assert.match(businessSettings, /emailOpportunities/);
  assert.match(businessSettings, /emailWeeklySummary/);
  assert.match(businessSettings, /serviceAreas/);
  assert.doesNotMatch(dashboard, /Save dashboard preferences/);
  assert.match(
    supplierCatalogue,
    /Wholesaler accounts never receive or view household opportunities/,
  );
});

test("Business settings expose bounded branding, service, template and closure controls", () => {
  assert.match(businessSettings, /Jump to business settings section/);
  for (const section of [
    "Account",
    "Appearance",
    "Service areas",
    "Quote defaults",
    "Notifications",
    "Templates",
    "Close account",
  ]) {
    assert.match(businessSettings, new RegExp(`label: "${section}"`));
  }
  assert.match(businessSettings, /TRADE_BRAND_THEME_KEYS/);
  assert.match(businessSettings, /TRADE_BRAND_BORDER_STYLES/);
  assert.match(businessSettings, /uploadMedia\("logo"/);
  assert.match(businessSettings, /uploadMedia\("banner"/);
  assert.match(businessSettings, /serviceAreas\.length >= 6/);
  assert.match(businessSettings, /Quote and invoice preview/);
  assert.match(businessSettings, /business-settings-document-preview-grid/);
  assert.match(businessSettings, /\["quote", "invoice"\]/);
  assert.match(businessSettings, /Default quote email subject/);
  assert.match(businessSettings, /Type CLOSE ACCOUNT to confirm/);
  assert.match(businessSettings, /Closing removes trade workspace access/);
  assert.doesNotMatch(businessSettings, /Closing removes sign-in access/);
  assert.match(businessSettings, /compliance records/);
  assert.match(businessSettings, /authorised TLink administrator/);
  assert.doesNotMatch(businessSettings, /Creditex/);
});

test("closed accounts receive a terminal dashboard state without profile recreation", () => {
  const closedStateStart = dashboard.indexOf(
    'profile?.accountStatus === "closed"',
  );
  const incompleteStateStart = dashboard.indexOf(
    "!profile || !profileComplete",
  );
  assert.ok(closedStateStart >= 0, "the dashboard must recognise a closed account");
  assert.ok(
    closedStateStart < incompleteStateStart,
    "closed accounts must not fall through to profile setup",
  );
  const closedState = dashboard.slice(closedStateStart, incompleteStateStart);
  assert.match(closedState, /This TLink account is closed/);
  assert.match(closedState, /authorised administrator\s+recovery process/);
  assert.match(closedState, /onClick=\{\(\) => void signOut\(firebaseAuth\)\}/);
  assert.doesNotMatch(closedState, /direct-trade\/partners/);
  assert.doesNotMatch(closedState, /Update business profile/);
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
  assert.match(access, /Run the core trade workflow for A\$0/);
  assert.match(access, /no card details, seat fee, job fee, quote fee/);
  assert.match(access, /A valid ABN and the required business evidence must be supplied/);
  assert.match(dashboard, /Unlimited users, leads, jobs and quotes remain A\$0/);
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
  assert.match(
    dashboard,
    /data-trade-theme=\{profile\.brandThemeKey \|\| DEFAULT_TRADE_BRAND_THEME\}/,
  );
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

test("schedule remains inside the permanent installer CRM navigation", () => {
  assert.match(
    dashboard,
    /kind: "crm-view", id: "schedule"[\s\S]*setWorkspace\("work"\)/,
  );
  assert.doesNotMatch(dashboard, /workspace === "schedule"/);
  assert.doesNotMatch(dashboard, /<TradeScheduleWorkspace/);
  assert.match(installerCrm, /navigationTarget\.id === "schedule"/);
  assert.match(
    installerCrm,
    /<nav className="crm-nav"[\s\S]*view === "schedule"[\s\S]*<TradeScheduleWorkspace/,
  );
});

test("focused jobs use the available CRM workspace width", () => {
  assert.match(installerCrm, /className="crm-view crm-job-workspace"/);
  assert.doesNotMatch(installerCrm, /className="crm-view crm-job-focus"/);
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

test("mobile CRM destinations stay visible in one horizontally scrollable navigation", () => {
  assert.doesNotMatch(styles, /crm-more-nav/);
  assert.match(styles, /\.trade-portal-shell \.crm-nav \{ display: flex; flex-wrap: nowrap;[^}]*overflow-x: auto;/);
  assert.match(styles, /scroll-snap-type: x proximity/);
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

test("new dashboard, verification and access copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(
    dashboard + businessSettings + supplierCatalogue + purchasing + businessHub + verification + access,
    /[\u2013\u2014]/,
  );
});
