import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const previewSource = fs.readFileSync(
  new URL(
    "../src/components/CustomerPlanReportPreview.tsx",
    import.meta.url,
  ),
  "utf8",
);
const previewStyles = fs.readFileSync(
  new URL(
    "../src/components/CustomerPlanReportPreview.module.css",
    import.meta.url,
  ),
  "utf8",
);
const printPage = fs.readFileSync(
  new URL("../src/app/plan/print/page.tsx", import.meta.url),
  "utf8",
);

test("the customer print route uses the dedicated semantic report preview", () => {
  assert.match(
    printPage,
    /import\s*\{\s*CustomerPlanReportPreview,\s*\}\s*from\s*"@\/components\/CustomerPlanReportPreview"/,
  );
  assert.match(
    printPage,
    /<CustomerPlanReportPreview report=\{report\} \/>/,
  );
  assert.doesNotMatch(printPage, /CustomerPlanPrintReport/);
});

test("the report preview is pure, bounded and semantically ordered", () => {
  assert.match(
    previewSource,
    /export function CustomerPlanReportPreview\(\{\s*report,\s*\}:\s*\{\s*report: CustomerPlanReportView;\s*\}\)/,
  );
  assert.match(previewSource, /<article\b/);
  assert.match(previewSource, /<h1>\{copy\.heroTitle\}<\/h1>/);
  assert.match(previewSource, /<ol className=\{styles\.actionList\}>/);
  assert.match(previewSource, /<dl className=\{styles\.snapshotGrid\}>/);
  assert.match(previewSource, /aria-labelledby="report-readiness-title"/);
  assert.match(previewSource, /aria-labelledby="report-privacy-title"/);
  assert.match(previewSource, /src="\/api\/aea-brandmark"/);
  assert.match(
    previewSource,
    /data-aea-report-design=\{report\.designVersion\}/,
  );

  const orderedMarkers = [
    "report-snapshot-title",
    "report-priority-title",
    "report-roadmap-title",
    "report-everyday-title",
    "report-readiness-title",
    "report-basis-title",
    "report-trade-title",
    "report-privacy-title",
  ];
  let previousIndex = -1;
  for (const marker of orderedMarkers) {
    const currentIndex = previewSource.indexOf(marker);
    assert.ok(currentIndex > previousIndex, `${marker} is out of order`);
    previousIndex = currentIndex;
  }

  assert.doesNotMatch(
    previewSource,
    /\buse(?:State|Effect|Memo|Callback)\b|dangerouslySetInnerHTML|<iframe|window\.print/,
  );
});

test("the report preview keeps premium rounded tech surfaces responsive", () => {
  assert.match(previewStyles, /\.report\s*\{[^}]*border-radius: 22px;/s);
  assert.match(previewStyles, /\.leadSnapshot,[^{]*\{[^}]*border-radius: 20px;/s);
  assert.match(previewStyles, /\.actionCard\s*\{[^}]*border-radius: 16px;/s);
  assert.match(
    previewStyles,
    /background-image:\s*[\s\S]*linear-gradient/,
  );
  assert.match(previewStyles, /@media \(max-width: 680px\)/);
  assert.match(
    previewStyles,
    /\.snapshotGrid,[^{]*\.everydayGrid\s*\{[^}]*grid-template-columns: 1fr;/s,
  );
  assert.doesNotMatch(previewStyles, /border-radius:\s*0(?:px)?;/);
});
