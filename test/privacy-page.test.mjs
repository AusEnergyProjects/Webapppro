import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(directory, relativePath), "utf8");
const privacy = read("../src/app/privacy/page.tsx");
const analyticsConsent = read("../src/components/AnalyticsConsent.tsx");
const layout = read("../src/app/layout.tsx");
const integrations = read("../src/app/direct-trade/integrations/page.tsx");
const chrome = read("../src/components/ComparatorChrome.tsx");
const upload = read("../src/components/JobInformationUpload.tsx");
const sitemap = read("../src/app/sitemap.ts");

test("the public privacy route covers the operational data boundary", () => {
  assert.match(privacy, /Privacy notice/);
  assert.match(privacy, /Protected leads and direct customers/);
  assert.match(privacy, /Wattzun AI conversations/);
  assert.match(privacy, /Up to 40 recent messages, a small conversation summary and the home profile/);
  assert.match(privacy, /kept in that browser for up to 30 days/);
  assert.match(privacy, /stateless guide endpoint/);
  assert.match(privacy, /bounded set of recent conversation turns/);
  assert.match(privacy, /bounded home-profile summary/);
  assert.match(privacy, /relevant maintained energy guidance to an external AI processing provider/);
  assert.match(privacy, /provider-side response storage disabled/);
  assert.match(privacy, /Planner photos, document attachments and contact details are not included in that question context/);
  assert.match(privacy, /processed transiently and not saved to server storage or sent to an external AI provider/);
  assert.match(privacy, /Newer details you tell Wattzun AI override conflicting profile or saved-plan answers/);
  assert.match(privacy, /does not create or read a server-side conversation record/);
  assert.match(privacy, /conversation text is not placed in analytics/);
  assert.match(privacy, /random first-party security cookie and short-lived, one-way security counters/);
  assert.match(privacy, /do not contain conversation text, a raw network address or a cross-device identity/);
  assert.match(privacy, /Wattzun AI does not use a visitor fingerprint/);
  assert.match(privacy, /Optional website analytics/);
  assert.match(privacy, /Google Analytics is off until you select Allow basic analytics/);
  assert.match(privacy, /We send page views manually on public pages, with automatic browser-history page views turned off/);
  assert.match(privacy, /Google signals and advertising personalisation are turned off/);
  assert.match(privacy, /select Privacy choices at the bottom of any public page/);
  assert.match(privacy, /Measurement stays disabled on protected account, operations, job-link and report-link pages/);
  assert.doesNotMatch(privacy, /No customer question or conversation content is sent to a paid external AI service/);
  assert.match(privacy, /Optional Energy Guide contact requests/);
  assert.match(privacy, /Marketing consent is separate and off/);
  assert.match(privacy, /does not attach the raw conversation/);
  assert.match(privacy, /separately chooses trade sharing/);
  assert.match(privacy, /Customer evidence must relate directly to the requested work/);
  assert.match(privacy, /Google Calendar, Outlook, Xero, MYOB or QuickBooks/);
  assert.match(privacy, /does not offer payment-provider connections or initiate customer payments/);
  assert.match(privacy, /do not sell personal information/i);
  assert.match(privacy, /info@ausenergyassessments\.com/);
  assert.doesNotMatch(privacy, /\b(?:TLink|Creditex)\b/);
  assert.match(privacy, /Open trade workspace/);
});

test("optional website analytics requires a clear stored choice before Google Analytics loads", () => {
  assert.match(layout, /<AnalyticsConsent \/>/);
  assert.match(analyticsConsent, /G-3PGGJ0JX4H/);
  assert.match(analyticsConsent, /australian-energy-assessments-analytics-consent-v1/);
  assert.match(analyticsConsent, /if \(choice === undefined\) return/);
  assert.match(analyticsConsent, /PRIVATE_PATH_PREFIXES/);
  assert.match(analyticsConsent, /choice !== CONSENT_GRANTED \|\| !analyticsAllowed/);
  assert.match(analyticsConsent, /document\.createElement\("script"\)/);
  assert.match(analyticsConsent, /googletagmanager\.com\/gtag\/js\?id=/);
  assert.match(analyticsConsent, /localStorage\.setItem\(CONSENT_STORAGE_KEY, choice\)/);
  assert.match(analyticsConsent, /"consent", "default"/);
  assert.match(analyticsConsent, /ad_personalization: "denied"/);
  assert.match(analyticsConsent, /ad_storage: "denied"/);
  assert.match(analyticsConsent, /ad_user_data: "denied"/);
  assert.match(analyticsConsent, /analytics_storage: "granted"/);
  assert.match(analyticsConsent, /analytics_storage: "denied"/);
  assert.match(analyticsConsent, /allow_ad_personalization_signals: false/);
  assert.match(analyticsConsent, /allow_google_signals: false/);
  assert.match(analyticsConsent, /send_page_view: false/);
  assert.match(analyticsConsent, /trackPageView\(pathname\)/);
  assert.doesNotMatch(analyticsConsent, /send_page_view: true/);
  assert.match(analyticsConsent, />\s*Allow basic analytics\s*</);
  assert.match(analyticsConsent, />\s*No thanks\s*</);
  assert.match(analyticsConsent, />\s*Privacy choices\s*</);
  assert.doesNotMatch(layout, /googletagmanager|G-3PGGJ0JX4H/);
  assert.doesNotMatch(analyticsConsent, /dangerouslySetInnerHTML/);
});

test("customer evidence and shared navigation resolve to the public privacy route", () => {
  assert.match(upload, /href="\/privacy"/);
  assert.match(chrome, /href="\/privacy"[^>]*>Privacy/);
  assert.match(sitemap, /"\/privacy"/);
});

test("the public integration route explains the TLink OAuth application purpose", () => {
  assert.match(integrations, /Connect your business tools to TLink/);
  assert.match(integrations, /applicationName: "TLink"/);
  assert.match(integrations, /siteName: "TLink"/);
  assert.match(integrations, /canonical: "\/direct-trade\/integrations"/);
  assert.match(integrations, /calendar\.events permission/);
  assert.match(integrations, /does not read Gmail, contacts or unrelated calendar events/);
  assert.match(integrations, /provider&apos;s own website/);
  assert.match(sitemap, /"\/direct-trade\/integrations"/);
});
