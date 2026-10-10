import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as react from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { PUBLIC_SITE, buildPlatformMetadata } from "../src/lib/public-site.ts";
import { searchPublicSite } from "../src/lib/public-site-search.ts";
import { calculateProductRating, productRatingMethods, publicProductRating } from "../src/lib/product-ratings.ts";
import { hotWaterComparisonFacts } from "../src/lib/product-hot-water.ts";
function compile(relative, dependencies) {
  const compiled = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const loaded = {};
  Function("require", "exports", compiled)(name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, loaded);
  return loaded;
}
const slugs = ["solar", "inverters", "batteries", "hot-water", "air-conditioning", "multi-split", "ev-chargers"];
const datasets = Object.fromEntries(slugs.map(slug => ["./product-guides/" + slug + ".json", { default: JSON.parse(readFileSync(new URL("../src/lib/product-guides/" + slug + ".json", import.meta.url), "utf8")) }]));
const guide = compile("../src/lib/product-guides.ts", datasets);
const browser = compile("../src/components/ProductComparisonBrowser.tsx", { react, "react/jsx-runtime": jsx, "./product-comparison.css": {} });
const dependencies = {
  "react/jsx-runtime": jsx,
  "next/link": { default: ({ children, ...props }) => jsx.jsx("a", { ...props, children }) },
  "next/navigation": { notFound() { throw new Error("NOT_FOUND"); } },
  "@/lib/product-guides": guide,
  "@/lib/product-ratings": { calculateProductRating, productRatingMethods, publicProductRating },
  "@/lib/product-hot-water": { hotWaterComparisonFacts },
  "@/lib/public-site": { PUBLIC_SITE, buildPlatformMetadata },
  "./ComparatorChrome": { SiteHeader: () => jsx.jsx("nav", { children: "Navigation" }), SiteFooter: ({ children }) => jsx.jsx("footer", { children }) },
  "./JsonLd": { JsonLd: ({ data }) => jsx.jsx("script", { type: "application/ld+json", dangerouslySetInnerHTML: { __html: JSON.stringify(data) } }) },
  "./ProductComparisonBrowser": browser,
};
const page = compile("../src/components/ProductComparisonPage.tsx", dependencies);
dependencies["@/components/ProductComparisonPage"] = page;
const categoryPage = compile("../src/app/guides/products/[category]/page.tsx", dependencies);
const overview = compile("../src/app/guides/products/page.tsx", dependencies);

test("the authored JSON boundary rejects unsupported evidence labels without type casts", () => {
  const altered = structuredClone(datasets);
  altered["./product-guides/solar.json"].default[0].measurements.cost = { ...guide.PRODUCT_GUIDE_CATEGORIES[0].options.find(product => product.measurements.cost).measurements.cost, priceEvidence: "guessed" };
  assert.throws(() => compile("../src/lib/product-guides.ts", altered), /Unsupported catalogue price evidence/);
  const noise = structuredClone(datasets);
  noise["./product-guides/hot-water.json"].default[0].hotWaterPerformance = { noise: { value: 40, metric: "quiet", distanceMetres: 1, mode: "Standard", sourceUrl: "https://example.com/specification" }, recovery: null };
  assert.throws(() => compile("../src/lib/product-guides.ts", noise), /Unsupported heat-pump noise measurement/);
});

test("all seven categories provide verified model-specific trade-offs, real photos and exact-model evidence", () => {
  assert.deepEqual(guide.PRODUCT_GUIDE_CATEGORIES.map(c => c.slug), slugs);
  const ids = [];
  let fullyMeasured = 0;
  for (const category of guide.PRODUCT_GUIDE_CATEGORIES) {
    assert.ok(category.options.length > 0);
    assert.equal(new Set(category.options.map(p => p.name)).size, category.options.length);
    for (const product of category.options) {
      ids.push(product.id);
      assert.ok(product.brand.trim());
      // Compatible multi-room heads reuse the same verified photograph as the single-room unit.
      const photoCategory = category.slug === "multi-split" ? "(?:multi-split|air-conditioning)" : category.slug;
      assert.match(product.image.src, new RegExp("^/products/" + photoCategory + "/[a-z0-9-]+\\.webp$"));
      assert.ok(product.image.alt.trim());
      assert.equal(new URL(product.image.sourceUrl).protocol, "https:");
      const asset = statSync(new URL("../public" + product.image.src, import.meta.url));
      assert.ok(asset.size > 500 && asset.size < 150000, product.id + ": image size");
      assert.ok(product.pros.length > 0 && product.pros.length <= 3);
      assert.ok(product.cons.length <= 3);
      for (const list of [product.pros, product.cons]) {
        assert.equal(new Set(list).size, list.length);
        for (const text of list) {
          assert.ok(typeof text === "string" && text.trim());
          assert.ok(text.trim().split(/\s+/).length <= 18, product.id + ":" + text);
          assert.doesNotMatch(text, /[\u2013\u2014]|\bfamil(?:y|ies)\b/i);
          assert.doesNotMatch(text, /same-sunlight laboratory|usable roof space|actual roof layout determines|phone access needs internet|installer must check|confirm the exact|ask which appliances/i);
        }
      }
      assert.equal(product.checkedAt, "2026-10-10");
      assert.ok(product.sources.length);
      for (const source of product.sources) assert.equal(new URL(source.url).protocol, "https:");
      assert.ok(product.freshness.generation.trim());
      assert.ok(product.freshness.note.trim());
      assert.equal(new URL(product.freshness.sourceUrl).protocol, "https:");
      if (product.freshness.released !== null) {
        assert.match(product.freshness.released, /^20\d{2}-\d{2}(?:-\d{2})?$/);
        assert.ok(product.freshness.released <= "2026-10-10");
      }
      assert.ok(product.technicalSpecs.length >= 4 && product.technicalSpecs.length <= 14);
      assert.equal(new Set(product.technicalSpecs.map(spec => spec.label)).size, product.technicalSpecs.length);
      for (const spec of product.technicalSpecs) {
        assert.ok(spec.label.trim() && spec.value.trim());
        assert.equal(new URL(spec.sourceUrl).protocol, "https:");
      }
      for (const method of productRatingMethods(category.slug)) assert.ok(Object.hasOwn(product.measurements, method.id), product.id + ": missing comparable row");
      for (const method of productRatingMethods(category.slug)) {
        const figure = product.measurements[method.id];
        if (!figure) {
          const gap = product.measurementGaps?.[method.id];
          assert.ok(gap?.reason.trim(), product.id + ": unresolved " + method.id + " requires an audited reason");
          assert.equal(new URL(gap.sourceUrl).protocol, "https:");
          assert.ok(product.sources.some(source => source.url === gap.sourceUrl), product.id + ": gap must link to its reviewed source");
          assert.equal(calculateProductRating(method, figure, gap).score, null);
          continue;
        }
        assert.equal(product.measurementGaps?.[method.id], undefined, product.id + ": stale measurement gap");
        assert.equal(figure.checkedAt, "2026-10-10");
        assert.equal(new URL(figure.sourceUrl).protocol, "https:");
        assert.ok(product.sources.some(source => source.url === figure.sourceUrl), product.id + ": figure must link to its reviewed source");
        assert.equal(typeof calculateProductRating(method, figure).score, "number", product.id + ": comparable measurement basis");
        if (method.id === "cost") assert.ok(figure.value > 0, product.id + ": no free-equipment assumption");
      }
      if (productRatingMethods(category.slug).every(method => product.measurements[method.id])) fullyMeasured++;
      for (const field of ["rank", "score", "price", "rating", "reviewCount", "comparisons"]) assert.equal(Object.hasOwn(product, field), false);
    }
  }
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 300, "the catalogue must contain at least 300 distinct Australian products/configurations");
  assert.ok(fullyMeasured >= 300, "at least 300 exact Australian product configurations must have all three sourced bars");
  for (const olderId of ["rec-alpha-pure-rx", "enphase-iq8", "goodwe-dns-g3", "tesla-powerwall-3", "mitsubishi-electric-gs", "rheem-ambipower-mdc180", "rheem-ambiheat-hdc270", "reclaim-co2-v2", "apricus-all-in-one"]) assert.ok(!ids.includes(olderId), "older generation " + olderId);
  for (const slug of ["air-conditioning", "multi-split"]) assert.ok(guide.PRODUCT_GUIDE_CATEGORIES.find(c => c.slug === slug).options.some(p => p.brand === "Emerald"));
  assert.ok(guide.PRODUCT_GUIDE_CATEGORIES.some(category => category.options.some(product => category.options.filter(other => other.brand === product.brand).length > 1)), "distinct options from the same brand");
});

test("heat-pump noise and recovery are visible and use exact published test conditions", async () => {
  const category = guide.findProductGuideCategory("hot-water");
  const element = page.ProductComparisonPage({ category });
  const listing = element.props.children.find(child => child?.type === browser.ProductComparisonBrowser);
  const html = renderToStaticMarkup(await categoryPage.default({ params: Promise.resolve({ category: "hot-water" }) }));
  for (const product of category.options) {
    assert.ok(product.hotWaterPerformance, product.id + ": heat-pump performance contract");
    assert.equal(Object.hasOwn(product.hotWaterPerformance, "noise"), true);
    assert.equal(Object.hasOwn(product.hotWaterPerformance, "recovery"), true);
    const facts = hotWaterComparisonFacts(product.hotWaterPerformance);
    assert.deepEqual(listing.props.products.find(item => item.id === product.id).hotWaterFacts, facts);
    const card = html.split('id="' + product.id + '"')[1].split("</article>")[0];
    assert.ok(card.includes("Noise"));
    assert.ok(card.includes("Reheat 100 litres"));
    assert.ok(card.includes(facts.recovery));
    for (const figure of [product.hotWaterPerformance.noise, product.hotWaterPerformance.recovery].filter(Boolean)) {
      assert.equal(new URL(figure.sourceUrl).protocol, "https:");
      assert.ok(product.sources.some(source => source.url === figure.sourceUrl), product.id + ": performance source");
    }
  }
});

test("comparable rows render immediately, with explicit unknowns, visible safety and unordered schema", async () => {
  for (const category of guide.PRODUCT_GUIDE_CATEGORIES) {
    const html = renderToStaticMarkup(await categoryPage.default({ params: Promise.resolve({ category: category.slug }) }));
    const count = category.options.length;
    assert.equal((html.match(/<article /g) || []).length, count);
    assert.equal((html.match(/<img /g) || []).length, count);
    assert.equal(html.split('data-product-fact="pros"').length - 1, count);
    assert.equal(html.split('data-product-fact="cons"').length - 1, count);
    assert.equal((html.match(/No model-specific drawback verified\./g) || []).length, category.options.filter(p => p.cons.length === 0).length);
    assert.doesNotMatch(html, /data-criterion=|No confirmed benefit\./);
    const methods = productRatingMethods(category.slug);
    const ratings = category.options.flatMap(product => methods.map(method => calculateProductRating(method, product.measurements[method.id])));
    assert.equal((html.match(/role="meter"/g) || []).length, ratings.filter(rating => rating.score !== null).length);
    assert.equal((html.match(/Not scored<\/span>/g) || []).length, ratings.filter(rating => rating.score === null).length);
    for (const method of methods) assert.equal(html.split(`data-rating="${method.id}"`).length - 1, count);
    assert.match(html, /aria-label="Product categories"/);
    assert.match(html, /aria-label="Search products"|Search products<input/);
    assert.doesNotMatch(html, /20 options|Twenty options|product families|Start here|Choose an upgrade|aggregateRating|reviewRating/i);
    const schema = JSON.parse(html.match(/<script type="application\/ld\+json">([^]*?)<\/script>/)[1]);
    assert.equal(schema.mainEntity.itemListOrder, "https://schema.org/ItemListUnordered");
    assert.equal(schema.mainEntity.numberOfItems, count);
    for (const product of category.options) {
      assert.ok(html.includes('id="' + product.id + '"'));
      assert.ok(html.includes(product.image.src));
      if (product.warning) assert.ok(html.includes(product.warning.replaceAll("&", "&amp;").replaceAll("'", "&#x27;")));
    }
    const element = page.ProductComparisonPage({ category });
    const listing = element.props.children.find(child => child?.type === browser.ProductComparisonBrowser);
    assert.equal(listing.key, category.slug);
    assert.deepEqual(listing.props.methods, methods.map(({ id, label, explanation }) => ({ id, label, explanation })));
    for (const product of listing.props.products) {
      assert.equal(Object.hasOwn(product, "check"), false);
      assert.equal(Object.hasOwn(product, "why"), false);
      assert.equal(Object.hasOwn(product, "fit"), false);
      assert.ok(product.pros.length);
      assert.ok(Array.isArray(product.cons));
      const cost = product.ratings.find(rating => rating.id === "cost");
      assert.equal(cost.measurement, null, "equipment price evidence must stay on the server");
      assert.ok(!product.sources.some(source => source.kind === "published_equipment_price"));
      assert.doesNotMatch(JSON.stringify(product), /(?:A?\$|AUD\s*)\s*\d/, product.id + ": public price anchor");
    }
    assert.doesNotMatch(JSON.stringify(listing.props.methods), /maximum|aud-|inverter-unit-gst|\$/, "private cost rulers do not cross the client boundary");
  }
  const html = renderToStaticMarkup(await overview.default());
  assert.equal((html.match(/<article /g) || []).length, guide.PRODUCT_GUIDE_CATEGORIES[0].options.length, "entry page goes directly to solar tiles");
  for (const slug of slugs) assert.ok(html.includes('href="/guides/products/' + slug + '"'));
});

test("missing verified benefits are rejected instead of silently showing an empty card", () => {
  const category = guide.PRODUCT_GUIDE_CATEGORIES[0];
  const product = { ...category.options[0], ratings: [], pros: [] };
  assert.throws(() => renderToStaticMarkup(jsx.jsx(browser.ProductComparisonBrowser, { products: [product], methods: productRatingMethods(category.slug) })), /Missing verified benefits/);
});

test("solar trade-offs use actual product differences rather than forced numerical or generic filler", () => {
  const solar = guide.PRODUCT_GUIDE_CATEGORIES.find(category => category.slug === "solar");
  const tindo = solar.options.find(product => product.id === "tindo-walara-g4p");
  const aiko = solar.options.find(product => product.id === "aiko-neostar-3p54");
  const rec = solar.options.find(product => product.id === "rec-alpha-pro-m");
  assert.ok(tindo.pros.some(text => /Australia|Adelaide/i.test(text)));
  assert.ok(aiko.pros.length);
  assert.ok(rec.cons.some(text => /large|heavy|roof|32\.5|2\.18/i.test(text)));
  assert.match(rec.warning, /Large-format panel/);
  for (const product of solar.options) {
    for (const text of [...product.pros, ...product.cons]) assert.doesNotMatch(text, /usable roof space|shade and installation gaps|same-sunlight laboratory comparison|roof edges and clearances|25% efficiency reference|2\.4% heat-loss reference/i);
  }
  for (const product of solar.options) assert.ok(product.technicalSpecs.some(spec => /watt|output|power|model/i.test(spec.label)), product.id + ": variants need exact identity and output");
  for (const product of solar.options.filter(product => product.pros.some(text => /output in a compact 1\.76 m panel/.test(text)))) {
    const watts = product.name.match(/(\d+)\s*W\b/)[1];
    assert.ok(product.pros.includes(`${watts} W output in a compact 1.76 m panel.`), product.id + ": benefit must use this variant's output");
  }
});

test("current battery variants and Earthworker equipment keep their distinct identities and evidence limits", () => {
  const batteries = guide.PRODUCT_GUIDE_CATEGORIES.find(category => category.slug === "batteries").options;
  const ac = batteries.find(product => product.id === "anker-solix-x1-au");
  const hybrid = batteries.find(product => product.id === "anker-solix-x1-hybrid-10");
  const alpha = batteries.find(product => product.id === "alphaess-smile-m5-s-1399");
  assert.notEqual(ac.image.src, hybrid.image.src);
  assert.ok(ac.pros.some(text => /existing solar/.test(text)));
  assert.ok(hybrid.pros.some(text => /solar panels directly/.test(text)));
  assert.match(hybrid.technicalSpecs.find(spec => spec.label === "Exact configuration").value, /^X1-H6 ?K-S and 2 X1-B5-H battery blocks$/);
  assert.match(alpha.name, /13\.99 kWh/);
  assert.ok(!batteries.some(product => /smile-g3|smile-m5-b/.test(product.id)));
  const earthworker = guide.PRODUCT_GUIDE_CATEGORIES.find(category => category.slug === "hot-water").options.find(product => product.id === "earthworker-neo-250");
  assert.match(earthworker.technicalSpecs.find(spec => spec.label === "Manufacturing").value, /Earthworker tank.*Neopower heating unit/);
  assert.equal(earthworker.freshness.released, null, "eligibility is not a launch date");
  assert.equal(earthworker.measurements.capacity.unit, "tank-litres");
  assert.equal(earthworker.measurements.capacity.value, 250);
});

test("EV chargers distinguish supply limits and retain exact-model cost and warranty evidence", () => {
  const chargers = guide.PRODUCT_GUIDE_CATEGORIES.find(category => category.slug === "ev-chargers").options;
  const glo = chargers.find(product => product.id === "myenergi-zappi-glo-7");
  const small = chargers.find(product => product.id === "fronius-wattpilot-flex-home-11c6");
  const large = chargers.find(product => product.id === "fronius-wattpilot-flex-home-22c6");
  assert.ok(glo.measurements.cost?.value > 0);
  if (glo.measurements.warranty) assert.equal(glo.measurements.warranty.basisId, "main-product-parts", "generic accessories are not the main charger warranty");
  assert.equal(small.measurements.chargingPower.value, 11);
  assert.equal(large.measurements.chargingPower.value, 22);
  assert.ok(small.cons.some(text => /single-phase.*3\.68 kW/.test(text)));
  assert.ok(large.cons.some(text => /single-phase.*7\.36 kW/.test(text)));
  for (const product of [small, large]) if (product.measurements.cost) assert.equal(product.measurements.cost.basisId, "ev-charger-unit-gst");
  assert.ok(small.cons.some(text => /Cannot send the car/.test(text)));
  assert.deepEqual(productRatingMethods("ev-chargers").map(method => method.id), ["cost", "chargingPower", "warranty"]);
});

test("Haier's latest dated specification supplies the exact plug rating instead of undated web copy", () => {
  const haier = guide.PRODUCT_GUIDE_CATEGORIES.find(category => category.slug === "hot-water").options.find(product => product.id === "haier-500-monoblock");
  const electrical = haier.technicalSpecs.find(spec => spec.label === "Power connection");
  assert.match(electrical.value, /15 A (?:three-pin )?plug/);
  assert.match(electrical.sourceUrl, /SpecificationGuide.*HP250M1U1P.*90003428E/);
  assert.ok(haier.sources.some(source => source.url === electrical.sourceUrl && /May 2026/.test(source.revision)));
  assert.ok(haier.cons.some(text => /15 A socket.*standard 10 A socket/.test(text)));
  assert.equal(Object.hasOwn(haier, "warning"), false, "superseded marketing text is not a fabricated product drawback");
  const material = haier.technicalSpecs.filter(spec => spec.label === "Tank material");
  assert.equal(material.length, 1);
  assert.match(material[0].value, /Enamel-lined cylinder.*magnesium.*does not specify the tank metal/);
  assert.doesNotMatch(material[0].value, /steel/i, "restraint straps do not establish cylinder metal");
  assert.ok(!haier.technicalSpecs.some(spec => spec.label === "Tank protection"));
});

test("server-rendered controls stay disabled until the client can respond", () => {
  const category = guide.PRODUCT_GUIDE_CATEGORIES[2];
  const html = renderToStaticMarkup(page.ProductComparisonPage({ category }));
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /<input[^>]*type="search"[^>]*disabled=""/);
  assert.match(html, /<select[^>]*disabled=""/);
  assert.equal((html.match(/<button[^>]*disabled=""/g) || []).length, category.options.length * 2 + 1);
  assert.equal((html.match(/<article /g) || []).length, category.options.length);
});

test("category metadata and allowlist stay correct; public search finds brands", async () => {
  assert.deepEqual((await categoryPage.generateStaticParams()).map(p => p.category), slugs);
  for (const category of guide.PRODUCT_GUIDE_CATEGORIES) {
    const metadata = await categoryPage.generateMetadata({ params: Promise.resolve({ category: category.slug }) });
    assert.equal(metadata.alternates.canonical, PUBLIC_SITE.apexUrl + "/guides/products/" + category.slug);
    assert.doesNotMatch(metadata.title, /20|families/i);
  }
  await assert.rejects(categoryPage.default({ params: Promise.resolve({ category: "missing" }) }), /NOT_FOUND/);
  await assert.rejects(categoryPage.generateMetadata({ params: Promise.resolve({ category: "missing" }) }), /NOT_FOUND/);
  for (const [query, expected] of [["compare products", "/guides/products"], ["aiko rec panels", "/guides/products/solar"], ["canadian solar", "/guides/products/solar"], ["fronius goodwe inverter", "/guides/products/inverters"], ["sungrow inverter", "/guides/products/inverters"], ["enphase iq8x", "/guides/products/inverters"], ["anker sigenstor", "/guides/products/batteries"], ["alphaess", "/guides/products/batteries"], ["tesla powerwall", "/guides/products/batteries"], ["sungrow battery", "/guides/products/batteries"], ["emerald evoheat", "/guides/products/hot-water"], ["earthworker", "/guides/products/hot-water"], ["stiebel", "/guides/products/hot-water"], ["lg mitsubishi", "/guides/products/air-conditioning"], ["panasonic", "/guides/products/air-conditioning"], ["multi head", "/guides/products/multi-split"], ["mhi multi", "/guides/products/multi-split"], ["zappi glo", "/guides/products/ev-chargers"], ["electric car charger", "/guides/products/ev-chargers"], ["ohme", "/guides/products/ev-chargers"]]) assert.equal(searchPublicSite(query)[0]?.path, expected);
});
