import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const accessPage = fs.readFileSync(path.resolve(directory, "../src/app/direct-trade/access/page.tsx"), "utf8");

test("retired access page redirects to the canonical dashboard without duplicate public metadata", () => {
  assert.match(accessPage, /redirect\("\/direct-trade\/dashboard"\)/);
  assert.doesNotMatch(accessPage, /JsonLd|SoftwareApplication|buildPlatformMetadata/);
  const sitemap = fs.readFileSync(path.resolve(directory, "../src/app/sitemap.ts"), "utf8");
  assert.doesNotMatch(sitemap, /"\/direct-trade\/(?:access|partners)"/);
  const setup = fs.readFileSync(path.resolve(directory, "../src/components/DirectTradePartnerForm.tsx"), "utf8");
  assert.match(setup, /A valid ABN and the required business evidence must be supplied, reviewed and approved/);
  assert.match(setup, /States and territories served/);
});
