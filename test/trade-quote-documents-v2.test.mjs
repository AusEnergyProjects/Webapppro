import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  contiguousTradeQuoteSections,
  createTradeQuotePdfBytes,
  tradeQuoteBannerCropForImage,
} from "../src/lib/trade-quote-pdf.mjs";

const read = (path) =>
  fs.readFileSync(new URL(path, import.meta.url), "utf8");
const reviewServer = read("../src/lib/trade-quote-review-server.ts");
const reviewUi = read("../src/components/QuoteLinkReview.tsx");
const pdfSource = read("../src/lib/trade-quote-pdf.mjs");
const emailSource = read("../src/lib/trade-quote-email.ts");

function snapshot(schemaVersion = "trade-quote-document-v2") {
  return {
    schemaVersion,
    capturedAt: "2026-08-05T00:00:00.000Z",
    quoteId: "quote-1",
    quoteVersionId: "version-1",
    quoteNumber: "Q-TLJ-DOCUMENT",
    versionNumber: 2,
    work: {
      id: "work-1",
      number: "TLJ-DOCUMENT",
      title: "Heat pump installation",
    },
    customer: {
      id: "customer-1",
      number: "CUS-1",
      name: "Test Customer",
      email: "customer@example.com",
    },
    site: {
      id: "site-1",
      label: "Primary site",
      addressLine1: "1 Test Street",
      addressLine2: "",
      suburb: "Melbourne",
      state: "VIC",
      postcode: "3000",
      summary: "1 Test Street, Melbourne VIC 3000",
    },
    business: {
      name: "Mikes Electrical",
      email: "quotes@mikes.example",
      phone: "1300 000 001",
      abn: "12345678901",
      website: "https://mikes.example",
      address: "2 Office Street, Melbourne VIC 3000",
      themeKey: "emerald_navy",
      borderStyle: "soft",
      logo: null,
      banner: null,
      ...(schemaVersion === "trade-quote-document-v2"
        ? {
            bannerCrop: {
              xBasisPoints: 1_000,
              yBasisPoints: 2_000,
              widthBasisPoints: 8_000,
              heightBasisPoints: 6_000,
            },
          }
        : {}),
      quoteEmailSubjectTemplate:
        "{business_name} sent quote {quote_number}",
      quoteEmailIntro: "Thank you for the opportunity to quote.",
    },
    acceptanceEmail: "customer@example.com",
    subtotalCents: 90_000,
    taxCents: 9_000,
    totalCents: 99_000,
    customerMessage: "Thank you for the opportunity to quote.",
    terms: "Installation is subject to safe site access.",
    validUntil: "2026-08-31",
    consentStatement: "I accept this exact quote.",
    issuedAt: "2026-08-05T00:00:00.000Z",
    items: [
      {
        id: "line-1",
        ...(schemaVersion === "trade-quote-document-v2"
          ? { lineType: "product" }
          : {}),
        description: "Heat pump installation",
        quantityMilli: 1_000,
        unitPriceCents: 100_000,
        subtotalCents: 100_000,
        taxCents: 10_000,
        totalCents: 110_000,
        sectionHeading: "Included work",
      },
      {
        id: "line-2",
        ...(schemaVersion === "trade-quote-document-v2"
          ? { lineType: "adjustment" }
          : {}),
        description: "Package discount",
        quantityMilli: 1_000,
        unitPriceCents: schemaVersion === "trade-quote-document-v2"
          ? -10_000
          : 0,
        subtotalCents: schemaVersion === "trade-quote-document-v2"
          ? -10_000
          : 0,
        taxCents: schemaVersion === "trade-quote-document-v2" ? -1_000 : 0,
        totalCents: schemaVersion === "trade-quote-document-v2"
          ? -11_000
          : 0,
        sectionHeading: "Included work",
      },
    ],
    choices: [],
  };
}

test("banner crop produces the same bounded 5 to 1 source geometry", () => {
  const defaultCrop = tradeQuoteBannerCropForImage(
    {
      xBasisPoints: 0,
      yBasisPoints: 0,
      widthBasisPoints: 10_000,
      heightBasisPoints: 10_000,
    },
    1_000,
    1_000,
  );
  assert.deepEqual(defaultCrop, {
    x: 0,
    y: 400,
    width: 1_000,
    height: 200,
  });

  const boundedCrop = tradeQuoteBannerCropForImage(
    {
      xBasisPoints: 1_000,
      yBasisPoints: 2_000,
      widthBasisPoints: 8_000,
      heightBasisPoints: 6_000,
    },
    1_600,
    900,
  );
  assert.equal(boundedCrop.width / boundedCrop.height, 5);
  assert.ok(boundedCrop.x >= 160);
  assert.ok(boundedCrop.y >= 180);
  assert.ok(boundedCrop.x + boundedCrop.width <= 1_440);
  assert.ok(boundedCrop.y + boundedCrop.height <= 720);
});

test("PDF keeps the exact saved A/B/A line order instead of regrouping headings", () => {
  const items = [
    { description: "A first", sectionHeading: "A" },
    { description: "B middle", sectionHeading: "B" },
    { description: "A last", sectionHeading: "A" },
  ];
  const sections = contiguousTradeQuoteSections(items);
  assert.deepEqual(sections.map(({ heading }) => heading), ["A", "B", "A"]);
  assert.deepEqual(sections.flatMap(({ items: groupItems }) => groupItems.map(({ description }) => description)), [
    "A first",
    "B middle",
    "A last",
  ]);
  assert.equal(sections[0].items[0], items[0]);
  assert.equal(sections[2].items[0], items[2]);
});

test("PDF rendering remains compatible with v1 and supports signed v2 discounts", async () => {
  for (const version of [
    "trade-quote-document-v1",
    "trade-quote-document-v2",
  ]) {
    const bytes = await createTradeQuotePdfBytes(snapshot(version));
    assert.ok(bytes.byteLength > 1_000);
    assert.equal(Buffer.from(bytes).subarray(0, 4).toString("ascii"), "%PDF");
  }
  assert.doesNotMatch(pdfSource, /Math\.max\(0,\s*Number\(cents\)/);
  assert.match(pdfSource, /Discount ex GST/);
  assert.match(pdfSource, /TOTAL INCL GST/);
  assert.match(pdfSource, /rectangle\(0, boxBottom, A4_WIDTH, boxHeight\)/);
  assert.match(
    pdfSource,
    /if \(snapshot\.customerMessage\)[\s\S]*?messageHeight = Math\.max[\s\S]*?y: y - messageHeight \+ 5,[\s\S]*?height: messageHeight/,
  );
});

test("v2 snapshot capture uses document identity, crop and signed adjustment fields", () => {
  assert.match(
    reviewServer,
    /row\.schemaVersion === "trade-quote-document-v1"[\s\S]*row\.schemaVersion === "trade-quote-document-v2"/,
  );
  assert.match(
    reviewServer,
    /schemaVersion: "trade-quote-document-v2"/,
  );
  for (const column of [
    "document_business_name",
    "document_phone",
    "document_email",
    "banner_crop_x_basis_points",
    "banner_crop_y_basis_points",
    "banner_crop_width_basis_points",
    "banner_crop_height_basis_points",
  ]) {
    assert.match(reviewServer, new RegExp(column));
  }
  assert.match(
    reviewServer,
    /cleanText\(row\.document_business_name, 240\) \|\|[\s\S]*cleanText\(row\.trade_business_name, 240\)/,
  );
  assert.match(
    reviewServer,
    /resolvedLineType === "adjustment"[\s\S]*signedBoundedInteger/,
  );
  assert.match(
    reviewServer,
    /if \(storedSnapshot\)[\s\S]*return snapshot;/,
  );
});

test("customer quote surfaces share one crop and explicit discount breakdown", () => {
  assert.match(reviewUi, /aspectRatio: "5 \/ 1"/);
  assert.match(reviewUi, /bannerBackgroundStyle/);
  assert.match(reviewUi, /Subtotal ex GST/);
  assert.match(reviewUi, /Discount ex GST/);
  assert.match(reviewUi, /Total incl GST/);
  assert.doesNotMatch(
    reviewUi,
    /<span>Always included<\/span>|<h2>Your base scope<\/h2>|<span>Work<\/span>/,
  );
  assert.match(pdfSource, /tradeQuoteBannerCropForImage/);
  assert.match(pdfSource, /pushGraphicsState\(\)[\s\S]*clip\(\)/);
  assert.match(pdfSource, /label\("Quote from"\);\s*if \(logo\)/);
  assert.match(emailSource, /Subtotal ex GST/);
  assert.match(emailSource, /Discount ex GST/);
  assert.match(emailSource, /Total incl GST/);
  assert.doesNotMatch(emailSource, />Work<\/div>/);
});
