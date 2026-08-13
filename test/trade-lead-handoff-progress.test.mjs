import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const styles = read("../src/app/globals.css");
const responseFlow = dashboard.slice(
  dashboard.indexOf("async function respondToOpportunity"),
  dashboard.indexOf("async function convertOpportunity"),
);
const handoffDialog = dashboard.slice(
  dashboard.indexOf('{authReady && user && publicLeadHandoff && (() => {'),
  dashboard.indexOf("{!authReady || loading ? ("),
);

test("the progress dialog starts immediately only for a first public-lead quote handoff", () => {
  assert.match(
    responseFlow,
    /const preparesCustomerQuote =\s*status === "interested" && !selectedOpportunity\?\.platformOnly/,
  );
  assert.match(
    responseFlow,
    /startsCustomerQuoteHandoff[\s\S]*selectedOpportunity\.matchStatus !== "interested"/,
  );
  assert.doesNotMatch(responseFlow, /showCustomerQuoteHandoff|forceHandoff/);
  assert.match(
    responseFlow,
    /if \(publicLeadHandoffRequestMatchId\.current === matchId\) return;[\s\S]*const controller = new AbortController\(\)/,
  );
  assert.ok(
    responseFlow.indexOf("setPublicLeadHandoff({")
      < responseFlow.indexOf("await activeUser.getIdToken()"),
    "the visual handoff must open before token or network work begins",
  );
  assert.match(
    dashboard,
    /disabled=\{\s*opportunityBusy === opportunity\.matchId/,
  );
});

test("the dialog follows the real request result and opens the exact quote target", () => {
  const missingTarget = responseFlow.indexOf("startsCustomerQuoteHandoff && !quoteTarget");
  const localStatusUpdate = responseFlow.indexOf("setOpportunities((current)");
  assert.ok(missingTarget > 0 && missingTarget < localStatusUpdate);
  assert.match(responseFlow, /phase: "success"/);
  assert.match(responseFlow, /await new Promise\(\(resolve\) => window\.setTimeout\(resolve, 250\)\)/);
  assert.match(
    responseFlow,
    /setCommandTarget\(\{\s*\.\.\.quoteTarget,[\s\S]*setWorkspace\("work"\)/,
  );
  assert.match(responseFlow, /phase: "error"[\s\S]*requestReference/);
  assert.match(responseFlow, /result\.requestId, result\.errorCode/);
  assert.match(
    handoffDialog,
    /respondToOpportunity\(\s*publicLeadHandoff\.matchId,\s*"interested"/,
  );
  assert.match(handoffDialog, /reuse the same customer, job[\s\S]*and quote/);
});

test("the handoff is an accessible non-cancellable working dialog with a truthful activity bar", () => {
  assert.match(
    handoffDialog,
    /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-busy=\{publicLeadHandoff\.phase === "working"\}/,
  );
  assert.match(
    handoffDialog,
    /role="progressbar"[\s\S]*aria-valuemin=\{0\}[\s\S]*aria-valuemax=\{100\}[\s\S]*aria-valuenow=\{progress\}/,
  );
  assert.match(handoffDialog, /completes[\s\S]*only after the server confirms/);
  assert.match(
    dashboard,
    /if \(event\.key === "Escape"\) \{\s*event\.preventDefault\(\);\s*return;/,
  );
  assert.match(dashboard, /publicLeadHandoffRetryButton\.current\?\.focus\(\)/);
  assert.match(dashboard, /publicLeadHandoffDialog\.current\?\.focus\(\)/);
  assert.match(dashboard, /if \(opener\?\.isConnected\) opener\.focus\(\)/);
  assert.match(
    handoffDialog,
    /publicLeadHandoff\.phase === "error" && \([\s\S]*Back to lead[\s\S]*Try again safely/,
  );
});

test("the polished handoff remains usable on mobile and with reduced motion", () => {
  for (const selector of [
    ".dashboard-lead-handoff-backdrop",
    ".dashboard-lead-handoff-dialog",
    ".dashboard-lead-handoff-progress",
    ".dashboard-lead-handoff-scope",
    ".dashboard-lead-handoff-actions",
  ]) assert.match(styles, new RegExp(selector.replaceAll(".", "\\.")));
  assert.match(
    styles,
    /@media \(max-width: 640px\)[\s\S]*\.dashboard-lead-handoff-backdrop \{ align-items: flex-end;[\s\S]*\.dashboard-lead-handoff-scope \{ grid-template-columns: 1fr;/,
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.dashboard-lead-handoff-progress > span > i \{ animation: none;/,
  );
});
