import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_QUOTE_EMAIL_INTRO,
  DEFAULT_QUOTE_EMAIL_SUBJECT,
  DEFAULT_TRADE_BRAND_BORDER,
  DEFAULT_TRADE_BRAND_THEME,
  QUOTE_SUBJECT_PLACEHOLDERS,
  TRADE_BRAND_BORDER_STYLES,
  TRADE_BRAND_THEME_KEYS,
  TRADE_BRAND_THEME_OPTIONS,
} from "../src/lib/trade-business-branding.ts";
import {
  hasAllowedSignature,
  sanitiseQuotingPhoto,
} from "../src/lib/private-image-evidence.ts";
import {
  ENERGY_SERVICE_IDS,
  normalizeEnergyServiceIds,
} from "../src/lib/energy-service-catalogue.mjs";
import { matchedServiceCategories } from "../src/lib/trade-service-matching.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const profileRoute = read("../src/app/api/trade-profile/route.ts");
const mediaRoute = read("../src/app/api/trade-profile-media/route.ts");
const migration = read("../drizzle/0120_trade_business_identity_and_quote_delivery.sql");
const customerDocumentsMigration = read("../drizzle/0121_trade_customer_documents.sql");
const schema = read("../db/schema.ts");
const settingsUi = read("../src/components/TradeBusinessSettingsWorkspace.tsx");
const enquiryRoute = read("../src/app/api/trade-enquiries/route.ts");
const enquiryInbox = read("../src/components/TradeEnquiryInbox.tsx");
const crmRoute = read("../src/app/api/trade-crm/route.ts");
const newJobUi = read("../src/components/TradeNewJobForm.tsx");
const globalStyles = [
  read("../src/app/globals.css"),
  read("../src/app/protected-workspaces.css"),
  read("../src/components/TLinkChrome.css"),
].join("\n");

function pngChunk(type, payload = []) {
  const bytes = new Uint8Array(12 + payload.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, payload.length);
  bytes.set([...type].map((value) => value.charCodeAt(0)), 4);
  bytes.set(payload, 8);
  return bytes;
}

function joinBytes(...parts) {
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function relativeLuminance(hex) {
  const channels = [1, 3, 5].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function contrastAgainstWhite(hex) {
  return 1.05 / (relativeLuminance(hex) + 0.05);
}

test("the trade account type is immutable after initial setup", () => {
  assert.match(profileRoute, /code: "ACCOUNT_TYPE_LOCKED"/);
  assert.match(profileRoute, /existingAccount\.partner_type !== requestedPartnerType/);
  assert.match(profileRoute, /\}, 409\);/);
  assert.match(
    profileRoute,
    /const partnerType = \(existingAccount\?\.partner_type === "supplier"[\s\S]*requestedPartnerType \|\| "installer"/,
  );
  assert.doesNotMatch(
    profileRoute,
    /^\s*partner_type\s*=\s*excluded\.partner_type,/m,
    "the upsert must never overwrite an existing installer or wholesaler role",
  );
  assert.doesNotMatch(
    profileRoute,
    /existingAccount\.partner_type !== partnerType[\s\S]{0,120}materialIdentityChanged/,
    "a role change is rejected rather than treated as a new reviewable identity",
  );
});

test("closed trade accounts cannot mutate retained profile identity", () => {
  assert.match(
    profileRoute,
    /SELECT firebase_uid, business_name, abn, partner_type, account_status FROM trade_accounts WHERE firebase_uid = \?/,
  );
  assert.match(
    profileRoute,
    /if \(existingAccount\?\.account_status === "closed"\) \{[\s\S]*code: "ACCOUNT_CLOSED"[\s\S]*authorised administrator recovery process[\s\S]*\}, 409\);/,
  );
  assert.ok(
    profileRoute.indexOf('existingAccount?.account_status === "closed"')
      < profileRoute.indexOf("const profileStatement = db.prepare"),
    "closed-state rejection must happen before any retained profile mutation is prepared",
  );
});

test("service areas are bounded, authoritative and saved atomically", () => {
  assert.match(
    profileRoute,
    /value\.length < 1 \|\| value\.length > 6/,
  );
  assert.match(profileRoute, /postcodeCoordinate\(postcode\)/);
  assert.match(profileRoute, /Number\.isInteger\(radiusKm\)/);
  assert.match(profileRoute, /radiusKm < 10/);
  assert.match(profileRoute, /radiusKm > 1000/);
  assert.match(profileRoute, /postcodes\.has\(postcode\)/);
  assert.match(profileRoute, /DELETE FROM trade_account_service_areas WHERE firebase_uid = \?/);
  assert.match(profileRoute, /INSERT INTO trade_account_service_areas/);
  assert.match(profileRoute, /const \[result\] = await db\.batch\(statements\)/);
  assert.match(
    profileRoute,
    /const serviceBasePostcode = serviceAreas\[0\]\?\.postcode/,
  );
  assert.match(
    profileRoute,
    /const serviceRadiusKm = serviceAreas\[0\]\?\.radiusKm/,
  );

  assert.match(schema, /sqliteTable\("trade_account_service_areas"/);
  assert.match(schema, /trade_account_service_areas_owner_position_idx/);
  assert.match(schema, /trade_account_service_areas_owner_postcode_idx/);
  assert.match(migration, /CREATE TABLE `trade_account_service_areas`/);
  assert.match(
    migration,
    /WHERE `partner_type` = 'installer'[\s\S]*length\(CASE WHEN `service_base_postcode`/,
    "the migration must preserve the existing installer service area",
  );
});

test("approved installers can save canonical lead services for future exact matching", () => {
  assert.equal(ENERGY_SERVICE_IDS.includes("electric-cooking"), true);
  assert.deepEqual(
    normalizeEnergyServiceIds(["solar", "electric-cooking", "solar"]),
    ["solar", "electric-cooking"],
  );
  assert.equal(normalizeEnergyServiceIds(["solar", "not-a-service"]), null);
  assert.equal(normalizeEnergyServiceIds("solar"), null);

  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`CREATE TABLE trade_accounts (
      firebase_uid text PRIMARY KEY NOT NULL,
      capabilities text NOT NULL,
      settings_updated_at text NOT NULL
    ); CREATE TABLE trade_opportunity_matches (
      id text PRIMARY KEY NOT NULL,
      firebase_uid text NOT NULL,
      matched_categories text NOT NULL
    )`);
    database.prepare("INSERT INTO trade_accounts VALUES (?, ?, ?)")
      .run("trade-1", JSON.stringify(["solar"]), "2026-08-12T00:00:00.000Z");
    database.prepare("INSERT INTO trade_opportunity_matches VALUES (?, ?, ?)")
      .run("existing-match", "trade-1", JSON.stringify(["solar"]));
    const saved = normalizeEnergyServiceIds(["electric-cooking"]);
    database.prepare("UPDATE trade_accounts SET capabilities = ?, settings_updated_at = ? WHERE firebase_uid = ?")
      .run(JSON.stringify(saved), "2026-08-12T01:00:00.000Z", "trade-1");
    const reloaded = JSON.parse(database.prepare("SELECT capabilities FROM trade_accounts WHERE firebase_uid = ?").get("trade-1").capabilities);
    assert.deepEqual(reloaded, ["electric-cooking"]);
    assert.deepEqual(matchedServiceCategories(["electric-cooking"], reloaded), ["electric-cooking"]);
    assert.deepEqual(matchedServiceCategories(["solar"], reloaded), []);
    assert.deepEqual(
      JSON.parse(database.prepare("SELECT matched_categories FROM trade_opportunity_matches WHERE id = ?").get("existing-match").matched_categories),
      ["solar"],
      "capability changes must not rewrite existing matches",
    );
  } finally {
    database.close();
  }

  assert.match(profileRoute, /requireVerifiedTradeIdentity\(identity\)/);
  assert.match(profileRoute, /capabilities = \?, availability_status/);
  assert.match(profileRoute, /JSON\.stringify\(capabilities\)/);
  assert.match(profileRoute, /settings_updated_at = \?, updated_at = \?/);
  assert.match(settingsUi, /TLink uses these saved services for future lead matching/);
  assert.match(settingsUi, /Changes do not remove leads already assigned/);
  assert.match(settingsUi, /Licences and[\s\S]*do not automatically add services/);
  assert.match(settingsUi, /ENERGY_SERVICE_CATALOGUE\.map/);
  assert.match(settingsUi, /capabilities,/);
  assert.match(enquiryRoute, /\.\.\.ENERGY_SERVICE_IDS/);
  assert.match(enquiryInbox, /\.\.\.ENERGY_SERVICE_OPTIONS/);
  assert.match(crmRoute, /\.\.\.ENERGY_SERVICE_IDS/);
  assert.match(newJobUi, /\.\.\.ENERGY_SERVICE_OPTIONS/);
});

test("business branding and quote defaults use one curated contract", () => {
  assert.deepEqual(TRADE_BRAND_THEME_KEYS, [
    "emerald_navy",
    "ocean_mint",
    "cobalt_aqua",
    "violet_sunset",
    "amber_ink",
    "charcoal_silver",
    "rose_plum",
    "forest_jade",
    "bronze_olive",
    "midnight_rose",
    "teal_indigo",
    "graphite_copper",
    "indigo_orchid",
    "burgundy_slate",
  ]);
  assert.equal(
    Object.keys(TRADE_BRAND_THEME_OPTIONS).length,
    TRADE_BRAND_THEME_KEYS.length,
  );
  for (const theme of Object.values(TRADE_BRAND_THEME_OPTIONS)) {
    assert.match(theme.gradient, /^linear-gradient\(135deg,/);
    assert.equal(theme.ink, "#ffffff");
    const stops = theme.gradient.match(/#[0-9a-f]{6}/gi) || [];
    assert.equal(stops.length, 2);
    for (const stop of stops) {
      assert.ok(
        contrastAgainstWhite(stop) >= 4.5,
        `${theme.label} ${stop} must retain readable white text`,
      );
    }
  }
  assert.deepEqual(TRADE_BRAND_BORDER_STYLES, [
    "soft",
    "square",
    "rounded",
  ]);
  assert.equal(DEFAULT_TRADE_BRAND_THEME, "emerald_navy");
  assert.equal(DEFAULT_TRADE_BRAND_BORDER, "soft");
  assert.equal(
    DEFAULT_QUOTE_EMAIL_SUBJECT,
    "{business_name} sent quote {quote_number}",
  );
  assert.deepEqual(
    [...QUOTE_SUBJECT_PLACEHOLDERS],
    ["business_name", "quote_number", "customer_name", "work_title"],
  );
  assert.match(DEFAULT_QUOTE_EMAIL_INTRO, /opportunity to quote/);

  assert.match(profileRoute, /BRAND_THEMES\.has\(brandThemeKey\)/);
  assert.match(profileRoute, /BRAND_BORDERS\.has\(brandBorderStyle\)/);
  assert.match(profileRoute, /value\.includes\("\{business_name\}"\)/);
  assert.match(profileRoute, /QUOTE_SUBJECT_PLACEHOLDERS\.has\(placeholder\)/);
  assert.match(profileRoute, /unmatchedBraces/);
  assert.match(profileRoute, /\{work_title\}/);
  assert.match(profileRoute, /quoteEmailIntro, 1200/);
  assert.match(profileRoute, /quoteDefaultTerms, 5000/);

  for (const column of [
    "brand_theme_key",
    "brand_border_style",
    "logo_object_key",
    "banner_object_key",
    "quote_email_subject_template",
    "quote_email_intro",
    "quote_default_terms",
  ]) {
    assert.ok(migration.includes("ADD `" + column + "`"));
  }
});

test("business settings render as one continuous page with explicit section actions", () => {
  for (const section of [
    "account",
    "appearance",
    "documents",
    "service",
    "quotes",
    "notifications",
    "templates",
    "closure",
  ]) {
    assert.match(
      settingsUi,
      new RegExp(`id="business-settings-${section}"`),
    );
  }
  assert.doesNotMatch(
    settingsUi,
    /section === "(?:account|appearance|service|quotes|notifications|templates|closure)"/,
    "settings sections must remain mounted together instead of behaving as hidden tabs",
  );
  for (const action of [
    "Save appearance",
    "Save customer document details",
    "Save services and areas",
    "Save quote defaults",
    "Save notifications",
    "Edit document appearance",
    "Close account and remove access",
  ]) {
    assert.ok(settingsUi.includes(action), `missing section action: ${action}`);
  }
  assert.match(settingsUi, /className="business-settings-jump-nav"/);
  assert.match(settingsUi, /href=\{`#business-settings-\$\{option\.id\}`\}/);
  for (const section of ["appearance", "documents", "service", "quotes", "notifications"]) {
    assert.match(
      settingsUi,
      new RegExp(`data-settings-section="${section}"`),
    );
  }
  assert.match(
    settingsUi,
    /targetSection === "appearance"[\s\S]*bannerCropXBasisPoints: bannerCrop\.x[\s\S]*bannerCropHeightBasisPoints: bannerCrop\.height/,
  );
  assert.match(
    settingsUi,
    /targetSection === "notifications"[\s\S]*availabilityStatus[\s\S]*emailOpportunities[\s\S]*emailWeeklySummary/,
  );
});

test("installer email settings explain that matched public enquiries are mandatory", () => {
  assert.match(
    settingsUi,
    /New matched public enquiries are always emailed while your approved business is open to matching\./,
  );
});

test("customer document identity, crop and payment settings have one strict owner contract", () => {
  const columns = [
    ["document_business_name", "documentBusinessName"],
    ["document_phone", "documentPhone"],
    ["document_email", "documentEmail"],
    ["banner_crop_x_basis_points", "bannerCropXBasisPoints"],
    ["banner_crop_y_basis_points", "bannerCropYBasisPoints"],
    ["banner_crop_width_basis_points", "bannerCropWidthBasisPoints"],
    ["banner_crop_height_basis_points", "bannerCropHeightBasisPoints"],
    ["invoice_payment_account_name", "invoicePaymentAccountName"],
    ["invoice_payment_bsb", "invoicePaymentBsb"],
    ["invoice_payment_account_number", "invoicePaymentAccountNumber"],
    ["invoice_payment_reference", "invoicePaymentReference"],
    ["invoice_default_terms", "invoiceDefaultTerms"],
  ];
  for (const [sqlColumn, schemaField] of columns) {
    assert.ok(
      customerDocumentsMigration.includes(`ADD COLUMN ${sqlColumn}`),
      `migration missing ${sqlColumn}`,
    );
    assert.match(
      schema,
      new RegExp(`${schemaField}: (?:text|integer)\\("${sqlColumn}"\\)`),
      `schema missing ${schemaField}`,
    );
    assert.ok(profileRoute.includes(sqlColumn), `profile route missing ${sqlColumn}`);
  }
  assert.match(profileRoute, /SELECT account\.email, account\.business_name/);
  assert.match(
    profileRoute,
    /documentDisplayBusinessName: record\.document_business_name \|\| record\.business_name/,
  );
  assert.match(
    profileRoute,
    /documentDisplayPhone: record\.document_phone \|\| record\.phone/,
  );
  assert.match(
    profileRoute,
    /documentDisplayEmail: record\.document_email \|\| record\.email/,
  );
  assert.match(profileRoute, /function normaliseOptionalPhone/);
  assert.match(profileRoute, /function normaliseOptionalEmail/);
  assert.match(profileRoute, /function normaliseBsb/);
  assert.match(profileRoute, /function normaliseAccountNumber/);
  assert.match(profileRoute, /values\.x \+ values\.width <= BANNER_CROP_SCALE/);
  assert.match(profileRoute, /values\.y \+ values\.height <= BANNER_CROP_SCALE/);
  assert.match(customerDocumentsMigration, /banner_crop_x_basis_points INTEGER NOT NULL DEFAULT 0/);
  assert.match(customerDocumentsMigration, /banner_crop_y_basis_points INTEGER NOT NULL DEFAULT 0/);
  assert.match(customerDocumentsMigration, /banner_crop_width_basis_points INTEGER NOT NULL DEFAULT 10000/);
  assert.match(customerDocumentsMigration, /banner_crop_height_basis_points INTEGER NOT NULL DEFAULT 10000/);
  assert.match(settingsUi, /x: 0,[\s\S]*y: 0,[\s\S]*width: 10_000,[\s\S]*height: 10_000/);
  assert.match(profileRoute, /bankFields\.some\(Boolean\) && !bankFields\.every\(Boolean\)/);
  assert.match(profileRoute, /document_business_name = ''/);
  assert.match(profileRoute, /invoice_payment_account_number = ''/);
});

test("business settings show crop-safe quote and invoice previews together", () => {
  assert.match(settingsUi, /function BannerCropPreview/);
  assert.match(settingsUi, /function fitCropToFiveToOne/);
  assert.match(settingsUi, /image\.naturalWidth/);
  assert.match(settingsUi, /context\.drawImage/);
  assert.match(settingsUi, /width=\{1000\}/);
  assert.match(settingsUi, /height=\{200\}/);
  assert.match(settingsUi, /Save appearance and apply crop/);
  assert.match(settingsUi, /Customer-facing business name/);
  assert.match(settingsUi, /Customer enquiries phone/);
  assert.match(settingsUi, /Customer enquiries email/);
  assert.match(settingsUi, /Invoice payment details/);
  assert.match(settingsUi, /\(\["quote", "invoice"\] as const\)\.map/);
  assert.match(settingsUi, /businessName=\{documentDisplayBusinessName\}/);
  assert.match(settingsUi, /<span>Subtotal<\/span>/);
  assert.match(settingsUi, /<span>Discount<\/span>/);
  assert.match(settingsUi, /<span>GST \(10%\)<\/span>/);
  assert.match(settingsUi, /<span className="total">Total<\/span>/);
  assert.match(settingsUi, /Payment details/);
  for (const redundantLabel of ["Always included", "Your base scope"]) {
    assert.doesNotMatch(settingsUi, new RegExp(redundantLabel, "i"));
  }
  assert.match(globalStyles, /\.business-settings-document-banner \{[^}]*aspect-ratio: 5 \/ 1/);
  assert.match(globalStyles, /\.business-settings-document-preview-grid/);
});

test("saved themes expose readable workspace, rail, search and action tokens", () => {
  for (const themeKey of TRADE_BRAND_THEME_KEYS.slice(1)) {
    assert.ok(
      globalStyles.includes(
        `.trade-portal-shell[data-trade-theme="${themeKey}"]`,
      ),
      `missing workspace token set for ${themeKey}`,
    );
  }
  for (const token of [
    "--trade-dark",
    "--trade-header-control",
    "--trade-header-control-border",
    "--trade-accent",
    "--trade-accent-hover",
    "--trade-accent-soft",
    "--trade-accent-soft-ink",
  ]) {
    assert.ok(globalStyles.includes(token), `missing theme token ${token}`);
  }
  assert.match(
    globalStyles,
    /\.tlink-command-launcher \{[^}]*background: var\(--trade-header-control\)/,
  );
  assert.match(
    globalStyles,
    /\.trade-portal-shell > \.dashboard-workspace-nav \{[^}]*background: var\(--trade-dark\)/,
  );
  assert.match(
    globalStyles,
    /\.trade-portal-shell \.dashboard-settings \.btn \{[^}]*background: var\(--trade-accent\)/,
  );
  assert.match(settingsUi, /accentColor: "var\(--trade-accent\)"/);
  assert.doesNotMatch(settingsUi, /accentColor: "#0b8f67"/);
  assert.doesNotMatch(settingsUi, /color: "#0a7a59"/);
  assert.doesNotMatch(settingsUi, /color: "#08794c"/);
});

test("business settings PATCH accepts section-local payloads without overwriting other sections", () => {
  assert.match(
    profileRoute,
    /availability_status, email_opportunities,[\s\S]*email_weekly_summary/,
  );
  assert.match(
    profileRoute,
    /raw\.availabilityStatus === undefined[\s\S]*account\.availability_status/,
  );
  assert.match(
    profileRoute,
    /raw\.emailOpportunities === undefined[\s\S]*account\.email_opportunities/,
  );
  assert.match(
    profileRoute,
    /raw\.emailWeeklySummary === undefined[\s\S]*account\.email_weekly_summary/,
  );
  assert.doesNotMatch(
    profileRoute,
    /typeof raw\.emailOpportunities !== "boolean" \|\| typeof raw\.emailWeeklySummary !== "boolean"/,
  );
});

test("business websites are canonical HTTPS links at both trust boundaries", () => {
  assert.match(profileRoute, /function canonicalHttpsWebsite\(value: unknown\): string \| null/);
  assert.match(profileRoute, /website\.protocol !== "https:"/);
  assert.match(profileRoute, /website\.username/);
  assert.match(profileRoute, /website\.password/);
  assert.match(profileRoute, /candidate\.length > 300/);
  assert.match(profileRoute, /businessWebsite === null/);
  assert.match(profileRoute, /complete HTTPS business website/);
  assert.match(
    profileRoute,
    /const businessWebsite = canonicalHttpsWebsite\(record\.business_website\) \|\| ""/,
    "legacy unsafe values must not be returned to the settings UI",
  );

  assert.match(settingsUi, /function safeBusinessWebsiteHref\(value: unknown\)/);
  assert.match(settingsUi, /website\.protocol !== "https:"/);
  assert.match(settingsUi, /const businessWebsiteHref = useMemo/);
  assert.match(settingsUi, /href=\{businessWebsiteHref\}/);
  assert.doesNotMatch(
    settingsUi,
    /href=\{profile\.businessWebsite\}/,
    "stored profile text must not be rendered directly as a link",
  );
});

test("private branding media rejects disguised files and removes image metadata", () => {
  assert.match(mediaRoute, /MAX_FILE_BYTES = 3 \* 1024 \* 1024/);
  assert.match(mediaRoute, /new Set\(\["image\/jpeg", "image\/png"\]\)/);
  assert.match(mediaRoute, /hasAllowedSignature\(originalBytes, file\.type, false\)/);
  assert.match(mediaRoute, /sanitiseQuotingPhoto\(originalBytes, file\.type\)/);
  assert.match(
    mediaRoute,
    /trade-branding\/\$\{access\.firebaseUid\}\/\$\{kind\}\/\$\{crypto\.randomUUID\(\)\}/,
  );
  assert.match(mediaRoute, /requireVerifiedTradeAccess/);
  assert.match(mediaRoute, /sameOrigin\(request\)/);
  assert.match(mediaRoute, /"Cache-Control": "private, no-store"/);
  assert.doesNotMatch(
    mediaRoute,
    /bucket\.delete\((?:old|current|record)/,
    "replacing or clearing branding must not delete bytes used by issued documents",
  );

  const jpeg = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe1, 0x00, 0x06, 0x45, 0x58, 0x49, 0x46,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
    0xff, 0xd9,
  ]);
  assert.equal(hasAllowedSignature(jpeg, "image/jpeg", false), true);
  assert.equal(hasAllowedSignature(jpeg, "application/pdf", false), false);
  const cleanJpeg = sanitiseQuotingPhoto(jpeg, "image/jpeg");
  assert.ok(cleanJpeg);
  assert.equal(Buffer.from(cleanJpeg).includes(Buffer.from("EXIF")), false);

  const pngSignature = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const png = joinBytes(
    pngSignature,
    pngChunk("tEXt", [0x47, 0x50, 0x53]),
    pngChunk("IEND"),
  );
  assert.equal(hasAllowedSignature(png, "image/png", false), true);
  const cleanPng = sanitiseQuotingPhoto(png, "image/png");
  assert.ok(cleanPng);
  assert.equal(Buffer.from(cleanPng).includes(Buffer.from("tEXt")), false);
  assert.equal(Buffer.from(cleanPng).includes(Buffer.from("IEND")), true);
});

test("account closure is explicit, idempotent, access removing and record retaining", () => {
  assert.match(profileRoute, /ACCOUNT_CLOSURE_RECENT_AUTH_SECONDS = 15 \* 60/);
  assert.match(profileRoute, /hasRecentFirebaseAuthentication\(identity\.authTime\)/);
  assert.match(profileRoute, /code: "RECENT_AUTH_REQUIRED"/);
  assert.match(
    profileRoute,
    /sign out and sign in again before closing this account[\s\S]*}, 401\)/,
  );
  assert.match(profileRoute, /cleanSingleLine\(raw\.confirmation, 40\) !== "CLOSE ACCOUNT"/);
  assert.match(profileRoute, /code: "ACCOUNT_CLOSURE_CONFIRMATION_REQUIRED"/);
  assert.match(profileRoute, /SET account_status = 'closed'/);
  assert.match(profileRoute, /availability_status = 'paused'/);
  assert.match(profileRoute, /email_opportunities = 0/);
  assert.match(profileRoute, /logo_object_key = ''/);
  assert.match(profileRoute, /banner_object_key = ''/);
  assert.match(
    profileRoute,
    /UPDATE trade_crm_quote_links[\s\S]*status = 'revoked'[\s\S]*token_hash = ''[\s\S]*encrypted_token = ''[\s\S]*WHERE firebase_uid = \? AND status = 'active'/,
  );
  assert.match(
    profileRoute,
    /UPDATE trade_team_members[\s\S]*status = 'suspended'[\s\S]*WHERE owner_uid = \? AND status = 'active'/,
  );
  assert.match(profileRoute, /INSERT OR IGNORE INTO trade_account_closure_requests/);
  assert.match(
    profileRoute,
    /eventKey: `trade-account-closed:\$\{identity\.uid\}`/,
  );
  assert.doesNotMatch(
    profileRoute,
    /eventKey: `trade-account-closed:\$\{identity\.uid\}:\$\{closureId\}`/,
  );
  assert.match(
    profileRoute,
    /WHERE firebase_uid = \? AND status = 'closed'[\s\S]*ORDER BY requested_at, id[\s\S]*LIMIT 1/,
  );
  assert.match(profileRoute, /stableAccountClosureId\(identity\.uid, closureCycle\)/);
  assert.match(profileRoute, /closureRequestId: closureId/);
  assert.match(
    profileRoute,
    /await db\.batch\(\[[\s\S]*UPDATE trade_crm_quote_links[\s\S]*UPDATE trade_team_members[\s\S]*INSERT OR IGNORE INTO trade_account_closure_requests[\s\S]*adminNotificationStatement\(db,[\s\S]*\]\);/,
  );
  assert.doesNotMatch(
    profileRoute,
    /await adminNotificationStatement\(db,[\s\S]*\)\.run\(\)/,
  );
  assert.doesNotMatch(profileRoute, /persistedClosure/);
  assert.doesNotMatch(profileRoute, /account was closed, but its closure record/i);
  assert.match(profileRoute, /separate authorised administrator recovery process/i);
  assert.match(profileRoute, /compliance, customer, job, quote, invoice and audit records remain retained/i);
  assert.doesNotMatch(
    profileRoute,
    /DELETE FROM (?:trade_work_orders|trade_crm_customers|trade_crm_quotes|compliance_cases)/,
    "closure must not erase operational or regulated records",
  );

  assert.match(schema, /sqliteTable\("trade_account_closure_requests"/);
  assert.match(schema, /retentionNoticeVersion: text\("retention_notice_version"\)/);
  assert.match(schema, /trade_account_closure_requests_owner_closed_idx/);
  assert.match(schema, /\.where\(sql`\$\{table\.status\} = 'closed'`\)/);
  assert.match(migration, /CREATE TABLE `trade_account_closure_requests`/);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX `trade_account_closure_requests_owner_closed_idx`[\s\S]*WHERE `status` = 'closed'/,
  );
  assert.match(migration, /ADD `account_closed_at` text/);
});

test("the close-account confirmation is an accessible focus-contained modal", () => {
  assert.match(settingsUi, /const closeDialogRef = useRef<HTMLElement>\(null\)/);
  assert.match(settingsUi, /const closeKeepButtonRef = useRef<HTMLButtonElement>\(null\)/);
  assert.match(settingsUi, /const closeTriggerRef = useRef<HTMLButtonElement>\(null\)/);
  assert.match(settingsUi, /document\.body\.style\.overflow = "hidden"/);
  assert.match(settingsUi, /closeKeepButtonRef\.current\?\.focus\(\)/);
  assert.match(settingsUi, /returnTarget\?\.isConnected/);
  assert.match(settingsUi, /event\.key === "Escape"/);
  assert.match(settingsUi, /event\.key !== "Tab"/);
  assert.match(settingsUi, /event\.shiftKey && activeElement === first/);
  assert.match(settingsUi, /!event\.shiftKey && activeElement === last/);
  assert.match(settingsUi, /aria-describedby="close-trade-account-description"/);
  assert.match(settingsUi, /aria-busy=\{closeBusy\}/);
  assert.match(settingsUi, /ref=\{closeDialogRef\}/);
  assert.match(settingsUi, /ref=\{closeKeepButtonRef\}/);
  assert.match(settingsUi, /ref=\{closeTriggerRef\}/);
  assert.match(settingsUi, /user\.getIdToken\(true\)/);
});

test("the closure index admits one current closure per owner and another after recovery", () => {
  const statements = migration.split("--> statement-breakpoint");
  const database = new DatabaseSync(":memory:");
  try {
    for (const marker of [
      "CREATE TABLE `trade_account_closure_requests`",
      "CREATE UNIQUE INDEX `trade_account_closure_requests_owner_closed_idx`",
    ]) {
      const statement = statements.find((entry) => entry.includes(marker));
      assert.ok(statement, `missing migration statement: ${marker}`);
      database.exec(statement.trim());
    }
    const insert = database.prepare(`
      INSERT OR IGNORE INTO trade_account_closure_requests
        (id, firebase_uid, status, reason, retention_notice_version,
         requested_at, completed_at, recovered_at, recovered_by_uid, created_at, updated_at)
      VALUES (?, ?, 'closed', '', 'test-v1', ?, ?, '', '', ?, ?)
    `);
    insert.run("closure-a", "owner-1", "2026-08-04T01:00:00.000Z", "2026-08-04T01:00:00.000Z", "2026-08-04T01:00:00.000Z", "2026-08-04T01:00:00.000Z");
    insert.run("closure-b", "owner-1", "2026-08-04T01:00:01.000Z", "2026-08-04T01:00:01.000Z", "2026-08-04T01:00:01.000Z", "2026-08-04T01:00:01.000Z");
    assert.deepEqual(
      database.prepare("SELECT id FROM trade_account_closure_requests WHERE firebase_uid = ? AND status = 'closed'").all("owner-1").map((row) => String(row.id)),
      ["closure-a"],
    );

    database.prepare("UPDATE trade_account_closure_requests SET status = 'recovered' WHERE id = ?").run("closure-a");
    insert.run("closure-c", "owner-1", "2026-08-04T01:00:02.000Z", "2026-08-04T01:00:02.000Z", "2026-08-04T01:00:02.000Z", "2026-08-04T01:00:02.000Z");
    assert.deepEqual(
      database.prepare("SELECT id FROM trade_account_closure_requests WHERE firebase_uid = ? AND status = 'closed'").all("owner-1").map((row) => String(row.id)),
      ["closure-c"],
    );
  } finally {
    database.close();
  }
});
