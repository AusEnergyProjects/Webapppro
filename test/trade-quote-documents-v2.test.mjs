import * as quoteProductDocuments from "../src/lib/trade-quote-product-documents.ts";
import * as productDocuments from "../src/lib/trade-price-book-documents.ts";
import * as quoteEquipment from "../src/lib/trade-quote-equipment.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { PDFDocument, PDFName, PDFDict, PDFString } from "pdf-lib";
import { buildTradeQuoteEmail } from "../src/lib/trade-quote-email.ts";
import { canonicalGoogleBusinessProfileUrl } from "../src/lib/trade-google-business-profile.mjs";
import * as roofImages from "../src/lib/trade-quote-roof-image.ts";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { extractText } from "unpdf";
import { createHash } from "node:crypto";
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

function reviewModule(getD1) {
  const compiled = ts.transpileModule(reviewServer, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const dependencies = {
    "../../db": { getD1 },
    "@/lib/admin-server": {}, "@/lib/trade-quote-links": {}, "@/lib/trade-access-server": {},
    "./trade-google-business-profile.mjs": { canonicalGoogleBusinessProfileUrl },
    "./trade-quote-roof-image": roofImages, "./trade-quote-equipment": quoteEquipment, "./trade-quote-product-documents": quoteProductDocuments, "./trade-price-book-documents": productDocuments,
  };
  const exports = {};
  Function("require", "exports", compiled)((id) => {
    assert.ok(Object.hasOwn(dependencies, id), id);
    return dependencies[id];
  }, exports);
  return exports;
}

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

test("new quote emails and PDFs contain only a validated saved Google business link", async () => {
  for (const url of [undefined, "https://maps.app.goo.gl/Business123", "https://example.com/reviews", "javascript:alert(1)"]) {
    const document = snapshot();
    if (url !== undefined) document.business.googleBusinessProfileUrl = url;
    const expected = url === "https://maps.app.goo.gl/Business123";
    const email = buildTradeQuoteEmail({ snapshot: document, shareUrl: "https://example.com/quote-review/secret", expiresAt: "2026-10-01" });
    assert.equal(email.text.includes("View Google business profile"), expected);
    assert.equal(email.html.includes("View Google business profile"), expected);
    if (expected) assert.ok(email.html.includes(`href="${url}"`));
    const pdf = await PDFDocument.load(await createTradeQuotePdfBytes(document));
    const links = pdf.getPages().flatMap((page) => {
      const annotations = page.node.Annots();
      return annotations ? annotations.asArray().map((ref) => {
        const annotation = pdf.context.lookup(ref, PDFDict);
        const action = annotation.lookupMaybe(PDFName.of("A"), PDFDict);
        return action?.lookupMaybe(PDFName.of("URI"), PDFString)?.decodeText();
      }).filter(Boolean) : [];
    });
    assert.deepEqual(links, expected ? [url] : []);
  }
});

test("issued equipment is frozen by option and appears in actual customer PDF with clickable datasheets", async () => {
  const saved = snapshot();
  const panel = { id: "panel-1", kind: "panel", name: "Selected solar panel", manufacturer: "Panel Co", model: "P440", quantity: 12, watts: 440, widthM: 1.134, lengthM: 1.762, warrantyYears: 25, datasheetUrl: "https://manufacturer.com/p440.pdf" };
  const battery = { id: "battery-1", kind: "battery", name: "Selected battery", manufacturer: "Battery Co", model: "B10", quantity: 1, capacityKwh: 10 };
  saved.choices = [{ id: "choice-1", kind: "addon", groupKey: "battery", name: "Battery option", summary: "Optional battery", recommended: false, items: [], subtotalCents: 500000, taxCents: 50000, totalCents: 550000 }];
  saved.equipment = { common: [panel], choices: [{ choiceKey: "choice-1", items: [battery] }] };
  const issuedJson = JSON.stringify(saved);
  panel.model = "Later changed model";
  const review = reviewModule(() => { throw new Error("Do not consult changed catalogue or draft"); });
  const parsed = review.parseTradeQuoteDocumentSnapshot(issuedJson);
  assert.equal(parsed.equipment.common[0].model, "P440");
  assert.equal(parsed.equipment.choices[0].choiceKey, "choice-1");
  const bytes = await createTradeQuotePdfBytes(parsed);
  const text = (await extractText(new Uint8Array(bytes), { mergePages: true })).text;
  assert.match(text, /Selected solar panel/);
  assert.match(text, /P440/);
  assert.match(text, /440 W/);
  assert.match(text, /440 W \| 1\.762 x 1\.134 m/);
  assert.match(text, /25 year warranty/);
  assert.match(text, /Equipment in Battery option/);
  assert.match(text, /Selected battery/);
  const pdf = await PDFDocument.load(bytes);
  const links = pdf.getPages().flatMap((page) => (page.node.Annots()?.asArray() || []).map((ref) => pdf.context.lookup(ref, PDFDict).lookup(PDFName.of("A"), PDFDict).lookup(PDFName.of("URI"), PDFString).decodeText()));
  assert.ok(links.includes("https://manufacturer.com/p440.pdf"));
  assert.equal(review.parseTradeQuoteDocumentSnapshot(JSON.stringify({ ...saved, equipment: { common: [], choices: [{ choiceKey: "missing-choice", items: [battery] }] } })), null);
});

test("issued quote links use the immutable snapshot without consulting the current business profile", async () => {
  const exports = reviewModule(() => { throw new Error("Issued quote must not reread the current profile"); });
  for (const savedUrl of [undefined, "https://g.page/original-business", "javascript:alert(1)"]) {
    const saved = snapshot();
    if (savedUrl !== undefined) saved.business.googleBusinessProfileUrl = savedUrl;
    const loaded = await exports.quoteDocumentSnapshotForAuthorisedLink({
      document_snapshot_json: JSON.stringify(saved), quote_id: saved.quoteId, quote_version_id: saved.quoteVersionId,
      work_order_id: saved.work.id, crm_customer_id: saved.customer.id, firebase_uid: "owner-1",
    });
    assert.equal(loaded.business.googleBusinessProfileUrl,
      savedUrl === undefined ? undefined : canonicalGoogleBusinessProfileUrl(savedUrl) || "");
  }
});

test("new quote snapshots ignore retired banners still stored on the business profile", async () => {
  const row = {
    quote_id: "quote-1", quote_version_id: "version-1", quote_number: "Q-1", version_number: 1,
    work_order_id: "work-1", customer_id: "customer-1", service_site_id: "site-1",
    trade_business_name: "Legacy Business", document_business_name: "Document Business",
    logo_object_key: "brands/owner/logo.png", logo_content_type: "image/png",
    banner_object_key: "brands/owner/retired-banner.jpg", banner_content_type: "image/jpeg",
    banner_crop_x_basis_points: 1000, banner_crop_y_basis_points: 1000,
    banner_crop_width_basis_points: 5000, banner_crop_height_basis_points: 5000,
  };
  const queries = [];
  const exports = reviewModule(() => ({ prepare(sql) {
    queries.push(sql);
    return { bind(...parameters) {
      assert.deepEqual(parameters, ["version-1", "owner-1"]);
      return { first: async () => row, all: async () => ({ results: [] }) };
    } };
  } }));
  const captured = await exports.buildTradeQuoteDocumentSnapshot("owner-1", "version-1");
  assert.equal(captured.business.name, "Document Business");
  assert.deepEqual(captured.business.logo, { objectKey: row.logo_object_key, contentType: "image/png" });
  assert.equal(captured.business.banner, null);
  assert.deepEqual(captured.business.bannerCrop, { xBasisPoints: 0, yBasisPoints: 0, widthBasisPoints: 10000, heightBasisPoints: 10000 });
  assert.ok(exports.parseTradeQuoteDocumentSnapshot(JSON.stringify(captured)), "new captures must remain valid v2 documents");
  assert.doesNotMatch(queries.join("\n"), /trade\.banner_/);
});

test("customer review hides legacy banners while preserving the issued snapshot and logo", async () => {
  const saved = snapshot();
  saved.business.logo = { objectKey: "brands/owner/logo.png", contentType: "image/png" };
  saved.business.banner = { objectKey: "brands/owner/retired-banner.jpg", contentType: "image/jpeg" };
  const issuedJson = JSON.stringify(saved);
  const authorised = {
    id: "link-1", document_snapshot_json: issuedJson, quote_id: saved.quoteId, quote_version_id: saved.quoteVersionId,
    work_order_id: saved.work.id, crm_customer_id: saved.customer.id, firebase_uid: "owner-1", expires_at: "2026-10-01",
  };
  const exports = reviewModule(() => ({ prepare(sql) {
    assert.match(sql, /FROM trade_crm_quote_questions/);
    return { bind: () => ({ all: async () => ({ results: [] }) }) };
  } }));
  const loaded = await exports.quoteDocumentSnapshotForAuthorisedLink(authorised);
  assert.deepEqual(loaded.business.banner, saved.business.banner);
  assert.equal(authorised.document_snapshot_json, issuedJson);
  const quote = await exports.buildTradeQuoteReviewPayload(authorised);
  assert.equal(quote.business.hasBanner, false);
  assert.equal(quote.business.hasLogo, true);

  // A stale payload advertising a banner must still render the clean customer view.
  quote.business.hasBanner = true;
  let stateIndex = 0;
  const dependencies = {
    "react/jsx-runtime": jsxRuntime,
    react: {
      useState: (initial) => [stateIndex++ === 0 ? quote : initial, () => {}],
      useRef: (value) => ({ current: value }), useEffect: () => {},
      useCallback: (callback) => callback, useMemo: (callback) => callback(),
    },
    "./TradeQuoteEquipmentCards": { TradeQuoteEquipmentCards: () => null }, "./TradeQuoteProductDocuments": { QuoteProductDocuments: () => null }, "@/lib/trade-quote-product-documents": quoteProductDocuments,
    "@/lib/trade-quote-receipt": { isPayableQuoteDecisionInvoice: () => false },
    "@/lib/trade-google-business-profile.mjs": { canonicalGoogleBusinessProfileUrl },
  };
  const compiled = ts.transpileModule(reviewUi, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const ui = {};
  Function("require", "exports", compiled)((id) => {
    assert.ok(Object.hasOwn(dependencies, id), id);
    return dependencies[id];
  }, ui);
  const html = renderToStaticMarkup(ui.QuoteLinkReview({ token: "test-review-token" }));
  assert.match(html, /media\/logo/);
  assert.match(html, /Mikes Electrical/);
  assert.doesNotMatch(html, /media\/banner|brand-banner|retired-banner/);
});

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
  assert.match(pdfSource, /Rebates and dollar discounts ex GST/);
  assert.match(pdfSource, /finalPercentDescription.*Final.*on included items ex GST/s);
  assert.match(pdfSource, /TOTAL INCL GST/);
  assert.doesNotMatch(pdfSource, /embeddedImage\(pdf, suppliedAssets\.banner\)/);
  assert.match(
    pdfSource,
    /if \(snapshot\.customerMessage\)[\s\S]*?messageHeight = Math\.max[\s\S]*?y: y - messageHeight \+ 5,[\s\S]*?height: messageHeight/,
  );
});

test("final percentage is rendered by the PDF totals breakdown instead of the item body", async () => {
  const finalSnapshot = snapshot();
  finalSnapshot.subtotalCents = 81_000;
  finalSnapshot.taxCents = 8_100;
  finalSnapshot.totalCents = 89_100;
  finalSnapshot.items.push({
    id: "line-3", lineType: "adjustment", description: "Final spring sale", quantityMilli: 100,
    unitPriceCents: -90_000, subtotalCents: -9_000, taxCents: -900, totalCents: -9_900,
    sectionHeading: "Overall percentage discount",
  });
  const bytes = await createTradeQuotePdfBytes(finalSnapshot);
  assert.ok(bytes.byteLength > 1_000);
  assert.match(pdfSource, /snapshot\.items\?\.filter\(\(item\) => !isFinalPercentDiscount\(item\)\)/);
  assert.match(emailSource, /summaryLines\(headlineItems\.filter\(\(item\) => !isFinalPercentDiscount\(item\)\)\)/);
  assert.match(emailSource, /Final \$\{finalPercentBasisPoints \/ 10\}% discount on included items ex GST/);
});

test("v2 snapshot capture uses document identity and signed adjustment fields", () => {
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
    /const snapshot = storedSnapshot[\s\S]*parseTradeQuoteDocumentSnapshot\(storedSnapshot\)[\s\S]*snapshot\.quoteId !== row\.quote_id[\s\S]*snapshot\.quoteVersionId !== row\.quote_version_id[\s\S]*snapshot\.work\.id !== row\.work_order_id[\s\S]*snapshot\.customer\.id !== row\.crm_customer_id[\s\S]*return snapshot;/,
  );
});

test("customer quote surfaces preserve explicit discount breakdown with a logo-first PDF", () => {
  assert.doesNotMatch(reviewUi, /CroppedBanner|bannerBackgroundStyle|quote-link-brand-banner/);
  assert.match(reviewUi, /Subtotal ex GST/);
  assert.match(reviewUi, /Discount ex GST/);
  assert.match(reviewUi, /Total incl GST/);
  assert.doesNotMatch(
    reviewUi,
    /<span>Always included<\/span>|<h2>Your base scope<\/h2>|<span>Work<\/span>/,
  );
  assert.match(pdfSource, /tradeQuoteBannerCropForImage/);
  assert.match(pdfSource, /drawTradeDocumentHeader/);
  assert.match(pdfSource, /drawText\("QUOTATION"/);
  assert.match(emailSource, /Subtotal ex GST/);
  assert.match(emailSource, /Rebates and dollar discounts ex GST/);
  assert.match(emailSource, /Final percentage discount on included items ex GST/);
  assert.match(emailSource, /Total incl GST/);
  assert.doesNotMatch(emailSource, />Work<\/div>/);
});

async function productPdfFixture(id, label, pages = 1) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index++) {
    const page = pdf.addPage([595, 842]);
    page.drawText(`${label} page ${index + 1}`, { x: 45, y: 730, size: 24 });
    page.drawText('Manufacturer supplied specification and warranty terms.', { x: 45, y: 680, size: 13 });
    page.node.addAnnot(pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [40, 700, 300, 740], A: { S: 'URI', URI: PDFString.of('https://untrusted.example') } })));
  }
  const bytes = await pdf.save();
  const document = { id, priceBookItemId: `product-${id}`, fileName: `${id}.pdf`, label, contentType: 'application/pdf', sizeBytes: bytes.length, pageCount: pages,
    sha256: createHash('sha256').update(bytes).digest('hex'), objectKey: `trade-price-book-documents/owner/product-${id}/${id}.pdf`, createdAt: '2026-09-27T00:00:00.000Z' };
  return { document, bytes };
}

test('actual quote PDF appends every supplied page, labels option scope and strips interactive annotations', async () => {
  const panel = await productPdfFixture('panel-doc', 'Selected panel data sheet', 2), battery = await productPdfFixture('battery-doc', 'Optional battery warranty');
  const value = snapshot();
  value.choices = [{ id: 'battery', name: 'Solar and battery', kind: 'addon', groupKey: 'extras', summary: '', recommended: false, subtotalCents: 10000, taxCents: 1000, totalCents: 11000, items: [] }];
  value.productDocuments = [{ document: panel.document, choiceKeys: [] }, { document: battery.document, choiceKeys: ['battery'] }];
  const base = await PDFDocument.load(await createTradeQuotePdfBytes({ ...value, productDocuments: [] }));
  const bytes = await createTradeQuotePdfBytes(value, undefined, { productDocuments: [{ id: panel.document.id, bytes: panel.bytes }, { id: battery.document.id, bytes: battery.bytes }] });
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), base.getPageCount() + 3);
  if (process.env.TLINK_QUOTE_PDF_QA) fs.writeFileSync(process.env.TLINK_QUOTE_PDF_QA, bytes);
  const text = (await extractText(new Uint8Array(bytes), { mergePages: true })).text;
  assert.match(text, /Selected panel data sheet page 1/);
  assert.match(text, /Selected panel data sheet page 2/);
  assert.match(text, /Optional battery warranty page 1/);
  assert.match(text, /Offered option: Solar and battery/);
  for (const page of pdf.getPages().slice(base.getPageCount())) assert.equal(page.node.Annots()?.size() || 0, 0, 'embedded visible content does not inherit source actions');
});

test('product PDF snapshot fails closed on unavailable, corrupt or over-limit pages and unknown option scope', async () => {
  const asset = await productPdfFixture('missing-doc', 'Panel warranty');
  const value = { ...snapshot(), productDocuments: [{ document: asset.document, choiceKeys: [] }] };
  await assert.rejects(createTradeQuotePdfBytes(value), /PRODUCT_DOCUMENT_INVALID/);
  const changed = new Uint8Array(asset.bytes); changed[100] ^= 1;
  await assert.rejects(createTradeQuotePdfBytes(value, undefined, { productDocuments: [{ id: asset.document.id, bytes: changed }] }), /PRODUCT_DOCUMENT_INVALID/);
  await assert.rejects(createTradeQuotePdfBytes({ ...value, productDocuments: [{ document: { ...asset.document, pageCount: 41 }, choiceKeys: [] }] }), /PRODUCT_DOCUMENT_INVALID/);
  await assert.rejects(createTradeQuotePdfBytes({ ...value, productDocuments: [{ document: asset.document, choiceKeys: ['another-option'] }] }, undefined, { productDocuments: [{ id: asset.document.id, bytes: asset.bytes }] }), /QUOTE_PRODUCT_DOCUMENTS_INVALID/);
});

test('a manufacturer PDF keeps blank separator pages without blocking preview or dropping following content', async () => {
  const pdf = await PDFDocument.create(); pdf.addPage();
  pdf.addPage().drawText('Installation instructions after blank separator', { x: 40, y: 700 });
  const bytes = await pdf.save();
  const fixture = await productPdfFixture('blank-separator', 'Installation manual');
  const document = { ...fixture.document, pageCount: 2, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const base = await PDFDocument.load(await createTradeQuotePdfBytes(snapshot()));
  const result = await createTradeQuotePdfBytes({ ...snapshot(), productDocuments: [{ document, choiceKeys: [] }] }, undefined, { productDocuments: [{ id: document.id, bytes }] });
  assert.equal((await PDFDocument.load(result)).getPageCount(), base.getPageCount() + 2);
  assert.match((await extractText(result, { mergePages: true })).text, /Installation instructions after blank separator/);
});

test('historical quote documents stay frozen and scoped to their owner after live product replacement', async () => {
  const asset = await productPdfFixture('original-doc', 'Original manufacturer warranty');
  const value = { ...snapshot(), productDocuments: [{ document: asset.document, choiceKeys: [] }] };
  const reviewApi = reviewModule(() => { throw new Error('Historical documents must not query the current product'); });
  const row = { firebase_uid: 'owner', quote_id: value.quoteId, quote_version_id: value.quoteVersionId, work_order_id: value.work.id, crm_customer_id: value.customer.id, document_snapshot_json: JSON.stringify(value) };
  const restored = await reviewApi.quoteDocumentSnapshotForAuthorisedLink(row);
  assert.equal(restored.productDocuments[0].document.sha256, asset.document.sha256);
  const summaries = quoteProductDocuments.quoteProductDocumentSummaries(restored.productDocuments);
  assert.equal(summaries[0].label, 'Original manufacturer warranty');
  assert.equal('objectKey' in summaries[0], false); assert.equal('sha256' in summaries[0], false);
  await assert.rejects(reviewApi.quoteDocumentSnapshotForAuthorisedLink({ ...row, firebase_uid: 'another-owner' }), /PRODUCT_DOCUMENT_NOT_FOUND/);
  assert.equal(reviewApi.parseTradeQuoteDocumentSnapshot({ ...value, productDocuments: [{ document: asset.document, choiceKeys: ['unknown'] }] }), null);
});

test('identical brochures are attached once, and public summaries follow selected choices', async () => {
  const asset = await productPdfFixture('shared-doc', 'Shared brochure');
  const docs = quoteProductDocuments.groupQuoteProductDocuments([{ choiceKey: 'solar', documents: [asset.document] }, { choiceKey: 'battery', documents: [asset.document] }]);
  assert.equal(docs.length, 1); assert.deepEqual(docs[0].choiceKeys, ['solar', 'battery']);
  assert.equal(quoteProductDocuments.selectedQuoteProductDocuments(docs, ['neither']).length, 0);
  assert.equal(quoteProductDocuments.selectedQuoteProductDocuments(docs, ['battery']).length, 1);
  const common = quoteProductDocuments.groupQuoteProductDocuments([{ choiceKey: 'battery', documents: [asset.document] }, { choiceKey: '', documents: [asset.document] }]);
  assert.deepEqual(common[0].choiceKeys, []);
  assert.equal(quoteProductDocuments.selectedQuoteProductDocuments(common, []).length, 1);
});

test('quote attachment resolver uses authenticated owner, authoritative price lines and explicit equipment product IDs', async () => {
  const common = await productPdfFixture('common-doc', 'Panel specification'), extra = await productPdfFixture('extra-doc', 'Battery specification');
  const calls = [];
  const dependencies = { './trade-quote-product-documents': quoteProductDocuments,
    './trade-price-book-documents-server': { resolvePriceBookDocuments: async (owner, ids) => { calls.push({ owner, ids }); return ids.includes('own-panel') ? [common.document] : ids.includes('own-battery') ? [extra.document] : []; } } };
  const compiled = ts.transpileModule(read('../src/lib/trade-quote-product-documents-server.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; Function('require', 'exports', compiled)(id => dependencies[id], exports);
  const documents = await exports.resolveQuoteProductDocuments('owner', [{ choiceKey: '', productIds: ['own-labour'] }, { choiceKey: 'battery-option', productIds: [] }], {
    common: [{ id: 'own-panel-spec-suffix', priceBookItemId: 'own-panel' }], choices: [{ choiceKey: 'battery-option', items: [{ id: 'arbitrary-id', priceBookItemId: 'own-battery' }] }],
  });
  assert.deepEqual(calls, [{ owner: 'owner', ids: ['own-labour', 'own-panel'] }, { owner: 'owner', ids: ['own-battery'] }]);
  assert.deepEqual(documents.map(entry => entry.choiceKeys), [[], ['battery-option']]);
});
