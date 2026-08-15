import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import fs from "node:fs";
import path from "node:path";

import react from "@vitejs/plugin-react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let server;
let calculatorModule;

before(async () => {
  server = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    plugins: [react()],
    resolve: { alias: { "@": path.resolve("src") } },
    server: { middlewareMode: true },
  });
  calculatorModule = await server.ssrLoadModule(
    "/src/components/CreditexSresCalculator.tsx",
  );
});

after(async () => {
  await server?.close();
});

function selectedCascade() {
  const reduce = calculatorModule.creditexSresProductCascadeReducer;
  let state = calculatorModule.EMPTY_CREDITEX_SRES_PRODUCT_CASCADE;
  state = reduce(state, {
    type: "category",
    value: "capacity_at_most_425l",
  });
  state = reduce(state, { type: "brand", value: "Exact Brand" });
  state = reduce(state, { type: "model", value: "Exact Model" });
  return reduce(state, {
    type: "records_loaded",
    productKeys: ["cer-ashp:101"],
  });
}

test("SRES product cascade clears every downstream choice", () => {
  const reduce = calculatorModule.creditexSresProductCascadeReducer;
  const selected = selectedCascade();
  assert.deepEqual(selected, {
    category: "capacity_at_most_425l",
    brand: "Exact Brand",
    model: "Exact Model",
    productKey: "cer-ashp:101",
  });

  assert.deepEqual(reduce(selected, {
    type: "category",
    value: "capacity_less_than_700l",
  }), {
    category: "capacity_less_than_700l",
    brand: "",
    model: "",
    productKey: "",
  });
  assert.deepEqual(reduce(selected, {
    type: "brand",
    value: "Different Brand",
  }), {
    category: "capacity_at_most_425l",
    brand: "Different Brand",
    model: "",
    productKey: "",
  });
  assert.deepEqual(reduce(selected, {
    type: "model",
    value: "Different Model",
  }), {
    category: "capacity_at_most_425l",
    brand: "Exact Brand",
    model: "Different Model",
    productKey: "",
  });
});

test("technology, date, snapshot and registry errors fail closed", () => {
  const reduce = calculatorModule.creditexSresProductCascadeReducer;
  for (const reason of [
    "technology",
    "installation_date",
    "registry_snapshot",
    "registry_error",
  ]) {
    assert.deepEqual(reduce(selectedCascade(), { type: "reset", reason }), {
      category: "",
      brand: "",
      model: "",
      productKey: "",
    });
  }
});

test("one exact registration is automatic but duplicates require a choice", () => {
  const reduce = calculatorModule.creditexSresProductCascadeReducer;
  let state = reduce(
    reduce(
      reduce(
        calculatorModule.EMPTY_CREDITEX_SRES_PRODUCT_CASCADE,
        { type: "category", value: "capacity_at_most_425l" },
      ),
      { type: "brand", value: "Exact Brand" },
    ),
    { type: "model", value: "Exact Model" },
  );
  state = reduce(state, {
    type: "records_loaded",
    productKeys: ["cer-ashp:101", "cer-ashp:102"],
  });
  assert.equal(state.productKey, "");
  state = reduce(state, { type: "record", value: "cer-ashp:101" });
  assert.equal(state.productKey, "cer-ashp:101");

  state = reduce(state, {
    type: "records_loaded",
    productKeys: ["cer-ashp:101", "cer-ashp:102"],
  });
  assert.equal(state.productKey, "cer-ashp:101");
  state = reduce(state, { type: "record", value: "cer-ashp:102" });
  assert.equal(state.productKey, "cer-ashp:102");
  state = reduce(state, {
    type: "records_loaded",
    productKeys: ["cer-ashp:103", "cer-ashp:104"],
  });
  assert.equal(state.productKey, "");
});

test("mixed SRES water-heater drafts enforce a ten-system property total", () => {
  assert.deepEqual(
    calculatorModule.creditexSresWaterHeaterQuoteUnitTotal([
      { unitQuantity: "2" },
      { unitQuantity: "3" },
    ], "4"),
    { total: 9, complete: true },
  );
  assert.deepEqual(
    calculatorModule.creditexSresWaterHeaterQuoteUnitTotal([
      { unitQuantity: "6" },
    ], "5"),
    { total: 11, complete: false },
  );
  assert.deepEqual(
    calculatorModule.creditexSresWaterHeaterQuoteUnitTotal([
      { unitQuantity: "" },
    ], "1"),
    { total: 1, complete: false },
  );
  assert.deepEqual(
    calculatorModule.creditexSresWaterHeaterQuoteUnitTotal([], "0"),
    { total: 0, complete: false },
  );
  assert.deepEqual(
    calculatorModule.creditexSresWaterHeaterQuoteUnitTotal([], "11"),
    { total: 0, complete: false },
  );
});

test("SRES registry completion requires an empty queue and a current successful status", () => {
  const state = calculatorModule.creditexSresRegistryPollState;
  const current = {
    status: "current",
    lastCheckedAt: "2026-08-16T00:00:00.000Z",
    snapshot: null,
    lastAttempt: {
      status: "success",
      checkedAt: "2026-08-16T00:00:00.000Z",
      message: "",
    },
  };
  assert.equal(state(current, false), "complete");
  assert.equal(state(current, true), "pending");
  assert.equal(state({ ...current, status: "stale" }, false), "pending");
  assert.equal(state(null, false), "pending");
  assert.equal(state({
    ...current,
    lastAttempt: { ...current.lastAttempt, status: "failed" },
  }, false), "failed");
});

test("accepted SRES refreshes poll durably before reloading product choices", () => {
  const source = fs.readFileSync(
    path.resolve("src/components/CreditexSresCalculator.tsx"),
    "utf8",
  );
  assert.match(source, /SRES_REGISTRY_STATUS_POLL_INITIAL_DELAY_MS = 5_000/);
  assert.match(source, /SRES_REGISTRY_STATUS_POLL_INTERVAL_MS = 15_000/);
  assert.match(source, /SRES_REGISTRY_STATUS_POLL_TIMEOUT_MS = 30 \* 60_000/);
  assert.match(
    source,
    /official-products\?continueRegistry=cer_sres_swh/,
  );
  assert.match(
    source,
    /pollState === "complete"[\s\S]*Product choices reloaded automatically[\s\S]*setLookupVersion\(\(current\) => current \+ 1\)/,
  );
  assert.match(
    source,
    /catch \{[\s\S]*latest status check failed[\s\S]*schedule\(SRES_REGISTRY_STATUS_POLL_INTERVAL_MS\)/,
  );
  assert.match(
    source,
    /return \(\) => \{[\s\S]*active = false;[\s\S]*window\.clearTimeout\(timer\);[\s\S]*controller\?\.abort\(\)/,
  );
  assert.match(
    source,
    /function updateTechnology\(technology: Technology\) \{[\s\S]*cancelRegistryStatusPoll\(\)/,
  );

  const acceptedRefresh = source.slice(
    source.indexOf("async function refreshRegistry"),
    source.indexOf("async function calculate"),
  );
  assert.match(acceptedRefresh, /setRegistryStatusPoll\(\{/);
  assert.doesNotMatch(acceptedRefresh, /setLookupVersion/);
  assert.doesNotMatch(
    acceptedRefresh,
    /certificate creation|provider acceptance/i,
  );
});

test("SRES starts as a source-verified future-date calculator with an enabled CTA", () => {
  const html = renderToStaticMarkup(React.createElement(
    calculatorModule.CreditexSresCalculator,
    { api: async () => ({ ok: true }), role: "trade" },
  ));
  const publicHtml = renderToStaticMarkup(React.createElement(
    calculatorModule.CreditexSresCalculator,
    { api: async () => ({ ok: true }), role: "public" },
  ));
  const order = [
    ">Activity<",
    ">Installation date<",
    ">Scenario:<",
    ">Postcode<",
    ">Rated capacity (kW)<",
    '<button type="submit">Calculate STCs<',
  ];
  let previous = -1;
  for (const marker of order) {
    const index = html.indexOf(marker);
    assert.ok(index > previous, `${marker} must follow the prior quote field`);
    previous = index;
  }
  assert.match(
    html,
    /type="date" min="2026-01-01" max="2030-12-31" required=""/,
  );
  assert.match(html, /FEDERAL CERTIFICATE CALCULATOR/);
  assert.match(html, /Exact, source-verified arithmetic for the selected inputs/);
  assert.match(
    html,
    /eligibility, certificate creation, provider submission and provider acceptance are separate governed workflows/,
  );
  assert.match(html, /<button type="submit">Calculate STCs<\/button>/);
  assert.doesNotMatch(
    html,
    /FEDERAL REBATE ESTIMATE|Estimate STCs|Estimate only|Calculate rebate estimate|Estimated quantity/,
  );
  assert.doesNotMatch(
    html,
    /Certificate creation disabled|Calculation disabled|Official product evidence incomplete|official rows|snapshot/i,
  );
  assert.doesNotMatch(html, /Refresh official products/);
  assert.match(publicHtml, /Calculate STCs/);
  assert.doesNotMatch(publicHtml, /Refresh official products/);

  const source = fs.readFileSync(
    path.resolve("src/components/CreditexSresCalculator.tsx"),
    "utf8",
  );
  assert.match(source, /estimatePurpose: "quote"/);
  assert.match(source, /SRES_PRODUCT_RECOVERY_TIMEOUT_MS = 25_000/);
  assert.match(source, /result\.queued !== true/);
  assert.match(source, /Product choices will load automatically/);
  assert.match(source, /installationDate: form\.effectiveDate/);
  assert.match(source, /waterHeaterItems:/);
  assert.match(source, /Systems using this model/);
  assert.match(source, /Add another approved model/);
  assert.match(source, /Maximum\s+10 systems across the property/);
  assert.match(source, /item\.perUnitOutput\.quantity/);
  assert.match(source, /!waterHeaterUnitTotal\.complete/);
  assert.doesNotMatch(source, /max=\{todayIso\(\)\}/);
  assert.match(source, /<summary>Calculation details<\/summary>/);
  const resultSource = source.slice(source.indexOf("{estimate && ("));
  assert.match(resultSource, /Calculated quantity/);
  assert.match(resultSource, /Source-verified result/);
  assert.match(
    resultSource,
    /Exact, source-verified calculation for the selected inputs/,
  );
  assert.match(resultSource, /Formula\/source version/);
  assert.match(resultSource, /Official source/);
  assert.match(
    resultSource,
    /Certificate creation,[\s\S]*provider submission and provider acceptance remain separate[\s\S]*governed workflows/,
  );
  assert.match(resultSource, /Eligibility boundary/);
  assert.doesNotMatch(
    resultSource,
    /Estimated quantity|Estimate only|Calculate rebate estimate/,
  );
  const calculateSource = source.slice(
    source.indexOf("async function calculate"),
    source.indexOf("function updateTechnology"),
  );
  assert.doesNotMatch(
    calculateSource,
    /claimScope|resourceAvailability|resourceHoursPerYear|deemingYears/,
  );
  assert.match(calculateSource, /ratedCapacityKw: form\.ratedCapacityKw/);
  assert.match(calculateSource, /postcode: form\.postcode/);
});
