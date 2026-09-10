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
  assert.match(homepage, /Talk to Wattzun AI/);
  assert.match(component, /I want help with/);
  assert.match(dialog, /do not sell leads or let businesses pay for placement/);
});

test("quick request uses a short two-step service and contact flow", () => {
  assert.match(component, /Find the right help/);
  assert.match(component, /dynamic\(/);
  assert.match(component, /ssr: false/);
  assert.match(dialog, /Step 1 of 2/);
  assert.match(dialog, /Step 2 of 2/);
  assert.match(dialog, /ENERGY_SERVICE_CATALOGUE\.map/);
  assert.match(dialog, /Something else or not sure/);
  assert.match(dialog, /\/api\/address-localities\?postcode=/);
  assert.match(dialog, /fetch\("\/api\/leads"/);
  assert.match(dialog, /initialServices\?: string\[\]/);
  assert.match(dialog, /normalizeEnergyServiceIds\(initialServices\)/);
  assert.match(dialog, /initialPostcode\?: string/);
  assert.match(dialog, /\^\\d\{4\}\$\/\.test\(initialPostcode\)/);
});

test("a provider-selected title-case suburb adopts the postcode directory casing", () => {
  assert.match(dialog, /selectedAddressLocality\.current = \{[\s\S]*suburb: selection\.suburb/);
  assert.match(dialog, /entry\.suburb\.toLocaleLowerCase\("en-AU"\) === pendingLocality\.suburb\.toLocaleLowerCase\("en-AU"\)/);
  assert.match(dialog, /setLocality\(canonicalLocality\)/);
  assert.match(dialog, /setLookupState\("loading"\)/);
  assert.match(dialog, /setUnitNumber\(selection\.addressLine2\)/);
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
  assert.match(dialog, /Australian Energy Assessments can help if no suitable business is available/);
});

test("receipt confirms the saved request without promising responses or email delivery", () => {
  assert.match(dialog, /if \(!response\.ok \|\| !result\.ok\) throw new Error/);
  assert.match(dialog, /Thank you\. Your request has been received\./);
  assert.match(dialog, /Your enquiry is saved with Australian Energy Assessments\./);
  assert.match(dialog, /reference: result\.reference/);
  assert.match(dialog, /submitState\.reference \? <div><span>Your reference<\/span><strong>\{submitState\.reference\}/);
  assert.match(dialog, /based on your selected services and their service areas/);
  assert.match(dialog, /review the details you agreed to share\. Responses depend on availability/);
  assert.match(dialog, /import \{ PUBLIC_SITE \} from "@\/lib\/public-site"/);
  assert.match(dialog, /href=\{PUBLIC_SITE\.phoneHref\}>\{PUBLIC_SITE\.phoneDisplay\}/);
  assert.match(dialog, /href=\{`mailto:\$\{PUBLIC_SITE\.email\}`\}>\{PUBLIC_SITE\.email\}/);
  assert.match(dialog, /<span>\{PUBLIC_SITE\.name\}<\/span>/);
  assert.match(dialog, /src="\/tlink-icon-192\.png"/);
  assert.doesNotMatch(dialog, /email (?:has been sent|delivered)|confirmation email|quotes (?:will arrive|soon)/i);
});

test("compact sharing summary retains address, notes, chosen contact details and AEA handling disclosures", () => {
  const summary = dialog.match(/<div className=\{styles\.sharingSummary\}>([\s\S]*?)<\/div>/)?.[1];
  assert.ok(summary, "sharing summary must be present");
  assert.match(summary, /<ul>[\s\S]*<li><strong>Request:<\/strong> Your selected services, full property address and your notes\.<\/li>/);
  assert.match(summary, /<li><strong>Contact:<\/strong> Your email, name and phone are included only if you tick them\.<\/li>/);
  assert.match(summary, /approved TLink businesses that match your services and area/);
  assert.match(summary, /Australian Energy Assessments keeps all contact details to manage your request and help if needed/);
  assert.match(summary, /do not sell leads or let businesses pay for placement/);
  assert.match(dialog, /checked=\{consentAccepted\} onChange=\{\(event\) => changeConsent\(event\.target\.checked\)\} required/);
  assert.match(dialog, /QUICK_UPGRADE_CONSENT_PURPOSE\} This is a request for options, not an agreement to buy or authorise work/);
});

test("quick request modal has keyboard and mobile safeguards", () => {
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /event\.key !== "Tab"/);
  assert.match(dialog, /\.filter\(\(element\) => element\.tabIndex >= 0\)/);
  assert.match(dialog, /document\.body\.style\.overflow = "hidden"/);
  assert.match(dialog, /returnTarget\?\.isConnected\) returnTarget\.focus\(\)/);
  assert.match(dialog, /successCloseRef\.current\?\.focus\(\)/);
  assert.match(dialog, /ref=\{successCloseRef\} type="button" onClick=\{onClose\}>Done/);
  assert.match(dialog, /const dismissible = submitState\.kind !== "sending"/);
  assert.match(dialog, /disabled=\{submitState\.kind === "sending"\}/);
  assert.match(styles, /\.receiptReference strong[^}]*overflow-wrap: anywhere/);
  assert.match(styles, /\.receiptContacts a[^}]*min-height: 2\.75rem[^}]*overflow-wrap: anywhere/);
  assert.match(styles, /\.receiptFooter[^}]*margin: 0/);
  assert.match(styles, /\.consent strong[^}]*font-size: 0\.76rem/);
  assert.match(styles, /\.consent small[^}]*font-size: 0\.74rem/);
  assert.match(styles, /@media \(max-width: 640px\)/);
  assert.match(styles, /min-height: 2\.75rem/);
});


test("homepage preserves service and postcode while the dialog keeps mandatory address sharing", () => {
  assert.match(component, /ENERGY_SERVICE_CATALOGUE\.map/);
  assert.match(component, /name="service"[\s\S]*?required>/);
  assert.match(component, /name="postcode"[\s\S]*?required \/>/);
  assert.match(component, /initialPostcode=\{postcode\} initialServices=\{\[service\]\}/);
  assert.doesNotMatch(component, /startAtDetails/);
  assert.match(dialog, /const \[step, setStep\] = useState<1 \| 2>\(1\)/);
  assert.match(dialog, /label="Street address \*"[^>]*required/);
  assert.match(dialog, /Your selected services, full property address/);
  assert.match(dialog, /step === 1 \? firstServiceRef\.current : postcodeRef\.current/);
  assert.match(dialog, /disabled=\{!dismissible\}[\s\S]*?>Edit or add services/);
});
