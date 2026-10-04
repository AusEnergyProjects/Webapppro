import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import path from "node:path";
import react from "@vitejs/plugin-react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let server, council, shared, allPrograms;
before(async () => {
  server = await createServer({ appType:"custom",configFile:false,logLevel:"silent",plugins:[react()],resolve:{ alias:{ "@":path.resolve("src") } },server:{ middlewareMode:true } });
  council = await server.ssrLoadModule("/src/components/council/CouncilRebateCalculator.tsx");
  shared = await server.ssrLoadModule("/src/components/PublicRebateCalculatorWorkspace.tsx");
  allPrograms = await server.ssrLoadModule("/src/components/CreditexAllProgramCalculator.tsx");
});
after(async () => { await server?.close(); });

test("council demo embeds the real public calculator with a ready Victorian calculation", () => {
  const html=renderToStaticMarkup(React.createElement(council.CouncilRebateCalculator,{ demonstration:true,postcodes:["3805","3806"],state:"VIC" }));
  assert.match(html,/<option value="VEU" selected="">/);
  assert.match(html,/<option value="46" selected="">/);
  assert.match(html,/Induction cooking product/);
  assert.match(html,/<button type="submit">Calculate source-verified result<\/button>/);
  assert.match(html,/Real calculator in a demonstration workspace/);
  assert.match(html,/3805, 3806/);
  assert.match(html,/href="\/calculator"/);
  assert.doesNotMatch(html,/<h1|>Official data status<|Refresh official|Add to quote|Create certificate/);
  for (const program of ["SRES","NSW-PDRS-2026","NSW-ESS-2026"]) assert.ok(html.includes(`value="${program}"`),program);
  for (const activity of ["1C","6","13","15","44","48"]) assert.ok(html.includes(`value="${activity}"`),activity);
});

test("council calculator remains public quote scope in live mode and retains jurisdiction choices", () => {
  const html=renderToStaticMarkup(React.createElement(council.CouncilRebateCalculator,{ demonstration:false,postcodes:["2000"],state:"NSW" }));
  assert.match(html,/<option value="NSW-ESS-2026" selected="">/);
  assert.doesNotMatch(html,/Real calculator in a demonstration workspace|>Official data status<|Refresh official/);
  assert.match(html,/Calculations support planning/);
});

test("existing public calculator defaults and heading remain unchanged outside council embedding", () => {
  const html=renderToStaticMarkup(React.createElement(shared.PublicRebateCalculatorWorkspace));
  assert.match(html,/<h1 id="public-rebate-calculator-title">/);
  assert.match(html,/<option value="SRES" selected="">/);
  assert.match(html,/No account is needed/);
});

test("optional initial activity cannot create an unsupported activity and preserves canonical default", () => {
  for (const initialActivityCode of [undefined,"unsupported"]) {
    const html=renderToStaticMarkup(React.createElement(allPrograms.CreditexAllProgramCalculator,{ api:async()=>({ok:true}),role:"public",initialProgramCode:"VEU",initialActivityCode }));
    assert.match(html,/<option value="1C" selected="">/);
    assert.doesNotMatch(html,/<option value="unsupported"/);
  }
});
