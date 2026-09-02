import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(directory, relativePath), "utf8");

const shared = read("../src/components/AssessmentServicePage.tsx");
const styles = read("../src/app/globals.css");
const booking = read("../src/app/book-an-assessment/page.tsx");
const bookingConfig = read("../src/lib/assessment-booking.ts");
const bookingStyles = read("../src/app/book-an-assessment/page.module.css");
const legacyBookingRedirect = read("../src/app/schedule-call/page.tsx");
const routes = {
  newHome: read("../src/app/nathers-for-new-homes/page.tsx"),
  existingHome: read("../src/app/home-energy-rating-for-existing-homes/page.tsx"),
  wholeOfHome: read("../src/app/nathers-whole-of-home/page.tsx"),
  basix: read("../src/app/basix-nsw/page.tsx"),
};
const routeSource = Object.values(routes).join("\n");
const scorecard = read("../src/app/residential-efficiency-scorecard/page.tsx");
const terminologyGuide = read("../src/app/home-energy-rating-vs-nathers-vs-scorecard/page.tsx");
const educationSource = `${scorecard}\n${terminologyGuide}`;

test("service routes keep the established apex paths canonical during the parallel build", () => {
  assert.match(shared, /new URL\(path, PUBLIC_SITE\.apexUrl\)/);
  assert.match(shared, /alternates: \{ canonical \}/);
  assert.match(booking, /const path = "\/book-an-assessment"/);
  assert.match(booking, /const canonical = `\$\{PUBLIC_SITE\.apexUrl\}\$\{path\}`/);
  assert.match(routes.newHome, /const path = "\/nathers-for-new-homes"/);
  assert.match(routes.existingHome, /const path = "\/home-energy-rating-for-existing-homes"/);
  assert.match(routes.wholeOfHome, /const path = "\/nathers-whole-of-home"/);
  assert.match(routes.basix, /const path = "\/basix-nsw"/);
  assert.doesNotMatch(shared, /canonicalUrl\("\/assessments"\)/);
});

test("every route has distinct search, Open Graph and Twitter metadata", () => {
  const sources = [...Object.values(routes), booking];
  const titles = sources.map((source) => source.match(/const title = "([^"]+)"/)?.[1]);
  const descriptions = sources.map((source) => source.match(/const description = "([^"]+)"/)?.[1]);
  assert.equal(new Set(titles).size, 5);
  assert.equal(new Set(descriptions).size, 5);
  assert.match(shared, /openGraph: \{/);
  assert.match(shared, /twitter: \{/);
  assert.match(shared, /locale: "en_AU"/);
  assert.match(shared, /card: "summary_large_image"/);
});

test("visible and structured breadcrumbs match the pre-cutover routing boundary", () => {
  assert.match(shared, /<nav className="guide-source-links" aria-label="Breadcrumb">/);
  assert.match(shared, /<Link href="\/assessments">Assessments<\/Link>/);
  assert.match(shared, /"@type": "BreadcrumbList"/);
  assert.match(shared, /position: 1, name: "Home", item: `\$\{PUBLIC_SITE\.apexUrl\}\/`/);
  assert.match(shared, /position: 2, name: "Assessments", item: `\$\{PUBLIC_SITE\.apexUrl\}\/assessments`/);
  assert.match(shared, /position: 3, name: breadcrumbLabel, item: canonical/);
  assert.match(styles, /\.guide-source-links > span \{[^}]*color: #c6dfe1;/);
});

test("service and FAQ structured data are derived from visible page copy", () => {
  assert.match(shared, /"@type": "Service"/);
  assert.match(shared, /"@type": "WebPage"/);
  assert.match(shared, /mainEntityOfPage: \{ "@id": `\$\{canonical\}#webpage` \}/);
  assert.doesNotMatch(shared, /areaServed = "Australia"/);
  assert.match(shared, /\.\.\.\(areaServed \? \{/);
  assert.match(shared, /"@type": "AdministrativeArea"/);
  assert.match(routes.newHome, /areaServed="Australia"/);
  assert.match(routes.wholeOfHome, /areaServed="Australia"/);
  assert.match(routes.basix, /areaServed="New South Wales"/);
  assert.match(routes.existingHome, /areaServed="Australia"/);
  assert.match(shared, /coverageTitle && coverageDescription/);
  assert.match(routes.newHome, /Desktop assessment across Australia/);
  assert.match(routes.wholeOfHome, /Desktop assessment across Australia/);
  assert.match(routes.existingHome, /On-site availability by location/);
  assert.match(shared, /telephoneIsVisible/);
  assert.match(shared, /emailIsVisible/);
  assert.match(shared, /"@type": "FAQPage"/);
  assert.match(shared, /mainEntity: faqs\.map/);
  assert.match(shared, /\{faqs\.map\(\(faq\) => \(/);
});

test("existing-home terminology matches the 2026 Home Energy Rating service", () => {
  assert.match(routes.existingHome, /Home Energy Rating from 0 to 100\+/);
  assert.match(routes.existingHome, /Star Rating from 0 to 10/);
  assert.match(routes.existingHome, /estimated annual energy use and upgrade guidance/);
  assert.match(routes.existingHome, /Residential Efficiency Scorecard is a legacy search term/);
  assert.match(routes.existingHome, /launched nationally on 1 July 2026/);
  assert.match(routes.existingHome, /cannot demonstrate National Construction Code compliance/);
  assert.match(routes.existingHome, /not called a Whole of Home rating/);
});

test("Whole of Home stays within the new-home certificate pathway", () => {
  assert.match(routes.newHome, /new-home certificate can demonstrate the relevant National Construction Code energy performance/);
  assert.match(routes.wholeOfHome, /Whole of Home is the 0 to 100\+ score on a new-home certificate/);
  assert.match(routes.wholeOfHome, /If the home is already built, you need the separate Home Energy Rating service/);
  assert.match(routes.wholeOfHome, /Existing homes use the Home Energy Rating pathway and cannot use that rating to demonstrate new-home NCC compliance/);
});

test("BASIX copy preserves the NSW planning and authority boundary", () => {
  assert.match(routes.basix, /Building or renovating in NSW\? BASIX is part of the planning process/);
  assert.match(routes.basix, /NSW Planning Portal and the relevant consent authority remain the source of truth/);
  assert.match(routes.basix, /planningportal\.nsw\.gov\.au\/development-and-assessment\/basix/);
  assert.match(routes.basix, /planningportal\.nsw\.gov\.au\/basix-thermal-performance-section/);
  assert.match(routes.basix, /A NatHERS simulation can be the thermal performance method used within an eligible BASIX pathway/);
});

test("booking is a focused five-minute Calendly call with truthful calendar and email guidance", () => {
  assert.match(bookingConfig, /https:\/\/calendly\.com\/info-58a\/precall/);
  assert.match(booking, /<iframe/);
  assert.match(bookingConfig, /hide_event_type_details=1/);
  assert.match(booking, /CALENDLY_BOOKING_URL/);
  assert.match(booking, /CALENDLY_EMBED_URL/);
  assert.doesNotMatch(bookingConfig, /aea_website/);
  assert.match(booking, /Book a five-minute call/);
  assert.match(booking, /It is not the assessment itself/);
  assert.match(booking, /Your booking updates the Australian Energy Assessments calendar/);
  assert.match(booking, /Calendly adds the call to the connected Australian Energy Assessments calendar/);
  assert.match(booking, /emails the booking details to the address you enter/);
  assert.match(booking, /Our team receives the appointment notification/);
  assert.doesNotMatch(booking, /Open Calendly separately/);
  assert.match(booking, /href=\{PUBLIC_SITE\.phoneHref\}/);
  assert.match(booking, /mailto:\$\{PUBLIC_SITE\.email\}/);
  assert.match(booking, /"@type": "ContactPage"/);
  assert.match(booking, /"@type": "ReserveAction"/);
  assert.doesNotMatch(booking, /BreadcrumbList|guide-source-links|AssessmentServicePage|PublicAssessmentBookingForm/);
  assert.match(bookingStyles, /@media \(max-width: 720px\)/);
  assert.match(bookingStyles, /@media \(forced-colors: active\)/);
  assert.match(bookingStyles, /\.help\s*\{[^}]*gap:\s*12px;/);
  assert.match(legacyBookingRedirect, /permanentRedirect\("\/book-an-assessment"\)/);
});

test("all routes show the review date, official sources and conservative public claims", () => {
  for (const source of Object.values(routes)) {
    assert.match(source, /reviewed="1 September 2026"/);
    assert.match(source, /https:\/\//);
    assert.match(source, /<AssessmentServicePage/);
  }
  assert.doesNotMatch(routeSource, /\u2013|\u2014/);
  assert.doesNotMatch(routeSource, /#1|number one|most experienced|accredited assessor|fixed price|guaranteed turnaround/i);
  assert.doesNotMatch(routeSource, /\bAEA\b/);
  assert.match(routes.newHome, /Building a new home or planning a major renovation\?/);
  assert.match(routes.existingHome, /Want to know how your existing home performs/);
});

test("the legacy Scorecard route preserves its apex canonical without advertising a closed service", () => {
  assert.match(scorecard, /const canonical = `\$\{PUBLIC_SITE\.apexUrl\}\/residential-efficiency-scorecard`/);
  assert.match(scorecard, /Residential Efficiency Scorecard closed on 23 June 2026/);
  assert.match(scorecard, /No new Scorecard assessments should be advertised or booked/);
  assert.match(scorecard, /Home Energy Rating brand launched on 1 July 2026/);
  assert.match(scorecard, /href="\/home-energy-rating-for-existing-homes"/);
  assert.match(scorecard, /href="\/book-an-assessment"/);
  assert.doesNotMatch(scorecard, /"@type": "Service"/);
});

test("the compare-native terminology guide keeps the three pathways distinct", () => {
  assert.match(terminologyGuide, /const canonical = `\$\{PUBLIC_SITE\.platformUrl\}\/home-energy-rating-vs-nathers-vs-scorecard`/);
  assert.match(terminologyGuide, /Home Energy Rating from 0 to 100\+/);
  assert.match(terminologyGuide, /Star Rating from 0 to 10/);
  assert.match(terminologyGuide, /Whole of Home rating from 0 to 100\+/);
  assert.match(terminologyGuide, /cannot demonstrate National Construction Code compliance/);
  assert.match(terminologyGuide, /program closed on 23 June 2026/);
  assert.match(terminologyGuide, /No new Scorecard assessment should be advertised or booked/);
});

test("both educational pages publish complete metadata and matching visible structured content", () => {
  for (const source of [scorecard, terminologyGuide]) {
    assert.match(source, /alternates: \{ canonical \}/);
    assert.match(source, /openGraph: \{/);
    assert.match(source, /twitter: \{/);
    assert.match(source, /images: \[/);
    assert.match(source, /Official guidance reviewed 1 September 2026/);
    assert.match(source, /"@type": "WebPage"/);
    assert.match(source, /"@type": "BreadcrumbList"/);
    assert.match(source, /position: 2, name: "Assessments"/);
    assert.match(source, /position: 3,/);
    assert.match(source, /<Link href="\/assessments">Assessments<\/Link>/);
    assert.match(source, /"@type": "FAQPage"/);
    assert.match(source, /mainEntity: faqs\.map/);
    assert.match(source, /\{faqs\.map\(\(faq\) => \(/);
    assert.match(source, /homeenergyrating\.gov\.au/);
  }
  assert.doesNotMatch(educationSource, /\u2013|\u2014/);
  assert.doesNotMatch(educationSource, /#1|number one|most experienced|accredited assessor|fixed price|guaranteed turnaround/i);
});
