import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const quotePanel = await readFile(new URL("../src/components/TradeQuotePanel.tsx", import.meta.url), "utf8");

test("accepted customer-shared photos open inside the authenticated quote context", () => {
  assert.match(quotePanel, /fetch\(`\/api\/trade-job-quote-photos\?workOrderId=\$\{encodeURIComponent\(workOrderId\)\}`/);
  assert.match(quotePanel, /Authorization: `Bearer \$\{token\}`/);
  assert.match(quotePanel, /contentUrl\.origin !== window\.location\.origin/);
  assert.match(quotePanel, /contentUrl\.pathname !== "\/api\/trade-job-quote-photos"/);
  assert.match(quotePanel, /const blob = await response\.blob\(\)/);
  assert.match(quotePanel, /URL\.createObjectURL\(blob\)/);
  assert.match(quotePanel, /URL\.revokeObjectURL\(url\)/);
  assert.doesNotMatch(quotePanel, /<img\s+src=\{photo\.contentUrl\}/);
  assert.match(quotePanel, /Only photos the customer selected for this accepted enquiry are shown/);
  assert.match(quotePanel, /The customer&apos;s full private plan is not included/);
});

test("the full accepted-photo view is accessible and closes without navigation", () => {
  assert.match(quotePanel, /role="dialog" aria-modal="true" aria-labelledby="trade-quote-photo-title"/);
  assert.match(quotePanel, /aria-label="Close full image"/);
  assert.match(quotePanel, /event\.key === "Escape"/);
  assert.match(quotePanel, /if \(event\.currentTarget === event\.target\) setAcceptedPhotoPreview\(null\)/);
  assert.match(quotePanel, /acceptedPhotoOpenerRef\.current\.focus/);
  assert.match(quotePanel, /Select X, press Escape or click outside the image to close\./);
});
