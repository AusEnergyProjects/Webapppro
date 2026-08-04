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
} from "../src/lib/trade-business-branding.ts";
import {
  hasAllowedSignature,
  sanitiseQuotingPhoto,
} from "../src/lib/private-image-evidence.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const profileRoute = read("../src/app/api/trade-profile/route.ts");
const mediaRoute = read("../src/app/api/trade-profile-media/route.ts");
const migration = read("../drizzle/0120_trade_business_identity_and_quote_delivery.sql");
const schema = read("../db/schema.ts");
const settingsUi = read("../src/components/TradeBusinessSettingsWorkspace.tsx");

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

test("business branding and quote defaults use one curated contract", () => {
  assert.deepEqual(TRADE_BRAND_THEME_KEYS, [
    "emerald_navy",
    "ocean_mint",
    "cobalt_aqua",
    "violet_sunset",
    "amber_ink",
    "charcoal_silver",
  ]);
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
    0xff, 0xda, 0x00, 0x08, 0x01, 0x02, 0x03, 0x04,
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
