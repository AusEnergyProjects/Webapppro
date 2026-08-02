import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentPath = new URL(
  "../src/components/CreditexOfficialSourceWorkbench.tsx",
  import.meta.url,
);
const stylesPath = new URL(
  "../src/components/CreditexOfficialSourceWorkbench.module.css",
  import.meta.url,
);

test("official source workbench captures exact bytes against controlled draft targets", async () => {
  const source = await readFile(componentPath, "utf8");

  assert.match(source, /api\("\/api\/creditex\/official-sources"/);
  assert.match(source, /sourcePagination\(result\.sourcePagination\)/);
  assert.match(source, /query\.set\("cursor", cursor\)/);
  assert.match(source, /loadNextPage/);
  assert.match(source, /loadPreviousPage/);
  assert.match(source, /shown of \{pagination\.total\}/);
  assert.match(source, /new FormData\(\)/);
  assert.match(
    source,
    /useState\(\s*\(\) => `source-capture:\$\{crypto\.randomUUID\(\)\}`/,
  );
  assert.match(source, /body\.set\("clientRequestId", clientRequestId\)/);
  assert.match(
    source,
    /setClientRequestId\(`source-capture:\$\{crypto\.randomUUID\(\)\}`\)/,
  );
  for (const field of [
    "clientRequestId",
    "sourceUrl",
    "sourceTitle",
    "sourceVersion",
    "assertedRetrievedAt",
    "citationLocation",
    "targetType",
    "targetId",
    "sourceFile",
    "sourceEtag",
    "sourceLastModified",
  ]) {
    assert.match(source, new RegExp(`body\\.set\\("${field}"`));
  }
  assert.match(source, /targets\.filter\(\(target\) => target\.state === "draft"\)/);
  assert.match(source, /const targetLabels = useMemo/);
  assert.match(source, /Create one in the governance workspace below, then refresh/);
  assert.match(source, /accept="\.pdf,.doc,.docx,.xls,.xlsx,.json,.xml,.html,.htm,.txt,.csv"/);
  assert.match(source, /Only draft targets can receive a source binding/);
  assert.match(source, /Maximum retained file size is 15 MB/);
  assert.doesNotMatch(source, /multipart\/form-data/);
});

test("official source workbench exposes exact retained bytes and current government source", async () => {
  const source = await readFile(componentPath, "utf8");

  assert.match(
    source,
    /await onDownload\(\s*artifact\.id,\s*artifact\.originalFileName,\s*\)/,
  );
  assert.match(source, /Download retained file/);
  assert.match(source, /Current source/);
  assert.match(source, /Server SHA-256/);
  assert.match(source, /Retained bytes/);
  assert.match(source, /Custody status/);
  assert.match(source, /Binding status/);
  assert.match(source, /ETag/);
  assert.match(source, /Last-Modified/);
});

test("official source review enforces artifact before binding approval", async () => {
  const source = await readFile(componentPath, "utf8");

  assert.match(source, /"\/api\/creditex\/official-sources\/reviews"/);
  assert.match(source, /action: "record_decision"/);
  assert.match(source, /subjectType="artifact"/);
  assert.match(source, /subjectType="binding"/);
  assert.match(source, /approvalDisabled=\{!artifactApproved\}/);
  assert.match(source, /!accessedArtifacts\.has\(source\.artifact\.id\)/);
  assert.match(source, /Download this exact retained file in the current session/);
  assert.match(source, /await onDownload/);
  assert.match(source, /next\.add\(artifact\.id\)/);
  assert.match(source, /canReview && !current/);
  assert.match(source, /This decision is immutable/);
  assert.match(source, /disabled=\{busy \|\| approvalDisabled\}/);
  assert.match(source, /Record the reason for this decision/);
  assert.match(
    source,
    /await onDecision\(subjectType, subjectId, decision, cleanNote\);\s*setNote\(""\);\s*} catch \{/,
  );
  assert.match(source, /throw reviewError/);
  assert.match(source, /void submit\("approved"\)/);
  assert.match(source, /void submit\("rejected"\)/);
  assert.doesNotMatch(source, /submit\("withdrawn"\)/);
});

test("official source workbench states its no activation boundary and has a compact layout", async () => {
  const [source, css] = await Promise.all([
    readFile(componentPath, "utf8"),
    readFile(stylesPath, "utf8"),
  ]);

  assert.match(source, /Draft only and immutable/);
  assert.match(source, /Read-only custody view/);
  assert.match(source, /canCapture \? \(/);
  assert.match(source, /Capture never activates a rule/);
  assert.match(source, /Publication remains a separate governed action/);
  assert.match(source, /No official source has been retained/);
  assert.match(css, /\.workbench[\s\S]*min-width: 0/);
  assert.match(css, /overflow-x: clip/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 780px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.doesNotMatch(source, /[\u2013\u2014]/);
});
