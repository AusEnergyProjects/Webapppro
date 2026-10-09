import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as react from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { PUBLIC_SITE, buildPlatformMetadata } from "../src/lib/public-site.ts";
import { searchPublicSite } from "../src/lib/public-site-search.ts";
function compile(relative, dependencies) {
  const compiled = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const loaded = {};
  Function("require", "exports", compiled)(name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, loaded);
  return loaded;
}
const slugs = ["solar", "inverters", "batteries", "hot-water", "air-conditioning"];
const datasets = Object.fromEntries(slugs.map(slug => ["./product-guides/" + slug + ".json", { default: JSON.parse(readFileSync(new URL("../src/lib/product-guides/" + slug + ".json", import.meta.url), "utf8")) }]));
const guide = compile("../src/lib/product-guides.ts", datasets);
const css = { default: new Proxy({}, { get: (_, key) => String(key) }) };
const browser = compile("../src/components/ProductComparisonBrowser.tsx", { react, "react/jsx-runtime": jsx, "./ProductComparison.module.css": css });
const dependencies = {
  "react/jsx-runtime": jsx,
  "next/link": { default: ({ children, ...props }) => jsx.jsx("a", { ...props, children }) },
  "next/navigation": { notFound() { throw new Error("NOT_FOUND"); } },
  "@/lib/product-guides": guide,
  "@/lib/public-site": { PUBLIC_SITE, buildPlatformMetadata },
  "./ComparatorChrome": { SiteHeader: () => jsx.jsx("nav", { children: "Navigation" }), SiteFooter: ({ children }) => jsx.jsx("footer", { children }) },
  "./JsonLd": { JsonLd: ({ data }) => jsx.jsx("script", { type: "application/ld+json", dangerouslySetInnerHTML: { __html: JSON.stringify(data) } }) },
  "./ProductComparisonBrowser": browser,
  "./ProductComparison.module.css": css,
};
const page = compile("../src/components/ProductComparisonPage.tsx", dependencies);
dependencies["@/components/ProductComparisonPage"] = page;
const categoryPage = compile("../src/app/guides/products/[category]/page.tsx", dependencies);
const overview = compile("../src/app/guides/products/page.tsx", dependencies);

test("all five categories answer the same comparison questions with real photos and evidence", () => {
  assert.deepEqual(guide.PRODUCT_GUIDE_CATEGORIES.map(c => c.slug), slugs);
  const ids = [];
  for (const category of guide.PRODUCT_GUIDE_CATEGORIES) {
    assert.equal(category.options.length, 20);
    assert.equal(new Set(category.options.map(p => p.name)).size, 20);
    assert.equal(category.criteria.length, 3);
    assert.equal(new Set(category.criteria.map(item => item.id)).size, 3);
    for (const criterion of category.criteria) assert.ok(criterion.label.trim());
    for (const product of category.options) {
      ids.push(product.id);
      assert.ok(product.brand.trim());
      assert.match(product.image.src, new RegExp("^/products/" + category.slug + "/[a-z0-9-]+\\.webp$"));
      assert.ok(product.image.alt.trim());
      assert.equal(new URL(product.image.sourceUrl).protocol, "https:");
      const asset = statSync(new URL("../public" + product.image.src, import.meta.url));
      assert.ok(asset.size > 500 && asset.size < 150000, product.id + ": image size");
      assert.deepEqual(product.comparisons.map(point => point.criterion), category.criteria.map(item => item.id));
      for (const point of product.comparisons) {
        assert.ok(point.pro === null || (typeof point.pro === "string" && point.pro.trim()));
        assert.ok(typeof point.con === "string" && point.con.trim());
        for (const text of [point.pro, point.con].filter(text => text !== null)) {
          assert.ok(text.trim().split(/\s+/).length <= 18, product.id + ":" + text);
          assert.doesNotMatch(text, /[\u2013\u2014]|\bfamil(?:y|ies)\b/i);
        }
      }
      assert.equal(product.checkedAt, "2026-10-10");
      assert.ok(product.sources.length);
      for (const source of product.sources) assert.equal(new URL(source.url).protocol, "https:");
      for (const field of ["rank", "score", "price", "rating", "reviewCount", "pros", "cons"]) assert.equal(Object.hasOwn(product, field), false);
    }
  }
  assert.equal(new Set(ids).size, 100);
});

test("comparable rows render immediately, with explicit unknowns, visible safety and unordered schema", async () => {
  for (const category of guide.PRODUCT_GUIDE_CATEGORIES) {
    const html = renderToStaticMarkup(await categoryPage.default({ params: Promise.resolve({ category: category.slug }) }));
    assert.equal((html.match(/<article /g) || []).length, 20);
    assert.equal((html.match(/<img /g) || []).length, 20);
    assert.equal((html.match(/<strong>Pro<\/strong>/g) || []).length, category.options.flatMap(p => p.comparisons).filter(point => point.pro !== null).length);
    assert.equal((html.match(/<strong>Con<\/strong>/g) || []).length, 60);
    assert.equal((html.match(/No confirmed benefit\./g) || []).length, category.options.flatMap(p => p.comparisons).filter(point => point.pro === null).length);
    for (const criterion of category.criteria) assert.equal(html.split(`data-criterion="${criterion.id}"`).length - 1, 20);
    assert.match(html, /aria-label="Product categories"/);
    assert.match(html, /aria-label="Search products"|Search products<input/);
    assert.doesNotMatch(html, /20 options|Twenty options|product families|Start here|Choose an upgrade|aggregateRating|reviewRating/i);
    const schema = JSON.parse(html.match(/<script type="application\/ld\+json">([^]*?)<\/script>/)[1]);
    assert.equal(schema.mainEntity.itemListOrder, "https://schema.org/ItemListUnordered");
    assert.equal(schema.mainEntity.numberOfItems, 20);
    for (const product of category.options) {
      assert.ok(html.includes('id="' + product.id + '"'));
      assert.ok(html.includes(product.image.src));
      if (product.warning) assert.ok(html.includes(product.warning.replaceAll("&", "&amp;").replaceAll("'", "&#x27;")));
    }
    const element = page.ProductComparisonPage({ category });
    const listing = element.props.children.find(child => child?.type === browser.ProductComparisonBrowser);
    assert.equal(listing.key, category.slug);
    assert.deepEqual(listing.props.criteria, category.criteria);
    for (const product of listing.props.products) {
      assert.equal(Object.hasOwn(product, "check"), false);
      assert.equal(Object.hasOwn(product, "why"), false);
      assert.equal(Object.hasOwn(product, "fit"), false);
      assert.equal(Object.hasOwn(product, "pros"), false);
      assert.equal(Object.hasOwn(product, "cons"), false);
    }
  }
  const html = renderToStaticMarkup(overview.default());
  assert.equal((html.match(/<article /g) || []).length, 20, "entry page goes directly to solar tiles");
  for (const slug of slugs) assert.ok(html.includes('href="/guides/products/' + slug + '"'));
});

test("a missing comparison answer is rejected instead of silently showing an empty row", () => {
  const category = guide.PRODUCT_GUIDE_CATEGORIES[0];
  const product = { ...category.options[0], comparisons: category.options[0].comparisons.slice(1) };
  assert.throws(() => renderToStaticMarkup(jsx.jsx(browser.ProductComparisonBrowser, { products: [product], criteria: category.criteria })), /Missing roof-space comparison/);
});

test("server-rendered controls stay disabled until the client can respond", () => {
  const category = guide.PRODUCT_GUIDE_CATEGORIES[2];
  const html = renderToStaticMarkup(jsx.jsx(browser.ProductComparisonBrowser, { products: category.options, criteria: category.criteria }));
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /<input[^>]*type="search"[^>]*disabled=""/);
  assert.match(html, /<select[^>]*disabled=""/);
  assert.equal((html.match(/<button[^>]*disabled=""/g) || []).length, 40);
  assert.equal((html.match(/<article /g) || []).length, 20);
});

test("category metadata and allowlist stay correct; public search finds brands", async () => {
  assert.deepEqual(categoryPage.generateStaticParams().map(p => p.category), slugs);
  for (const category of guide.PRODUCT_GUIDE_CATEGORIES) {
    const metadata = await categoryPage.generateMetadata({ params: Promise.resolve({ category: category.slug }) });
    assert.equal(metadata.alternates.canonical, PUBLIC_SITE.apexUrl + "/guides/products/" + category.slug);
    assert.doesNotMatch(metadata.title, /20|families/i);
  }
  await assert.rejects(categoryPage.default({ params: Promise.resolve({ category: "missing" }) }), /NOT_FOUND/);
  await assert.rejects(categoryPage.generateMetadata({ params: Promise.resolve({ category: "missing" }) }), /NOT_FOUND/);
  for (const [query, expected] of [["compare products", "/guides/products"], ["aiko rec panels", "/guides/products/solar"], ["fronius sma inverter", "/guides/products/inverters"], ["foxess sigenstor", "/guides/products/batteries"], ["sanden istore", "/guides/products/hot-water"], ["daikin mitsubishi", "/guides/products/air-conditioning"]]) assert.equal(searchPublicSite(query)[0]?.path, expected);
});
