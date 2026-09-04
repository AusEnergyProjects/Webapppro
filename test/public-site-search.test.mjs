import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PUBLIC_SITE_SEARCH_ENTRIES,
  normalizeSiteSearchText,
  searchPublicSite,
} from "../src/lib/public-site-search.ts";

const directory = path.dirname(fileURLToPath(import.meta.url));
const sitemap = fs.readFileSync(path.resolve(directory, "../src/app/sitemap.ts"), "utf8");

test("normalisation makes punctuation, spacing and capitalisation harmless", () => {
  assert.equal(normalizeSiteSearchText("  NatHERS &  BASIX! "), "nathers and basix");
  assert.equal(normalizeSiteSearchText("Home-Energy   Rating"), "home energy rating");
});

test("predictive search ranks common customer wording and misspellings", () => {
  const cases = [
    ["energy asseser", "/assessments"],
    ["nathres new home", "/nathers-for-new-homes"],
    ["rebtae calculater", "/calculator"],
    ["eletricity plans", "/compare"],
    ["hot watter", "/guides/hot-water"],
    ["calandar booking", "/book-an-assessment"],
    ["watzun", "/wattzun"],
    ["blower door", "/blower-door-thermal-imaging"],
    ["blower doar", "/blower-door-thermal-imaging"],
    ["air leakage test", "/blower-door-thermal-imaging"],
    ["thermal imaging", "/blower-door-thermal-imaging"],
    ["therml camera", "/blower-door-thermal-imaging"],
    ["home electrification", "/guides/home-energy-upgrades"],
    ["home electrifiction", "/guides/home-energy-upgrades"],
    ["get off gas", "/guides/home-energy-upgrades"],
    ["get of gas", "/guides/home-energy-upgrades"],
    ["one stop home energy", "/guides/home-energy-upgrades"],
  ];

  for (const [query, expectedPath] of cases) {
    assert.equal(searchPublicSite(query)[0]?.path, expectedPath, query);
  }
});

test("results stay bounded, relevant and on canonical public pages", () => {
  const results = searchPublicSite("home energy", 4);
  assert.ok(results.length > 0);
  assert.ok(results.length <= 4);
  assert.deepEqual(searchPublicSite("zxqv plmokn"), []);

  const forbiddenPrefix = /^\/(?:account|api|operations|creditex|quote-review|rental-report|job-information|direct-trade\/dashboard)(?:\/|$)/;
  const sitemapPaths = [...sitemap.matchAll(/^\s+"([^"]*)",$/gm)].map((match) => match[1] || "/");
  assert.deepEqual(
    [...new Set(PUBLIC_SITE_SEARCH_ENTRIES.map((entry) => entry.path))].sort(),
    [...new Set(sitemapPaths)].sort(),
  );
  for (const entry of PUBLIC_SITE_SEARCH_ENTRIES) {
    assert.doesNotMatch(entry.path, forbiddenPrefix);
    if (entry.path === "/") continue;
    assert.match(sitemap, new RegExp(`"${entry.path.replaceAll("/", "\\/")}"`), entry.path);
  }
});
