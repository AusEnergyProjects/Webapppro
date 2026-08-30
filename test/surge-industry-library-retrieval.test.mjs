import assert from "node:assert/strict";
import test from "node:test";
import { selectSurgeIndustryPassagesForPrompt } from "../src/lib/surge-industry-library.ts";

const RCAC = /\b(?:RCAC|reverse[- ]?cycle|air[- ]?con(?:ditioner|ditioning)?|split[- ]?systems?|multi[- ]?(?:head|split)(?:[- ]?systems?)?|ducted (?:gas )?(?:heating|heater)|gas (?:ducted )?(?:heating|heater))\b/i;
const FINANCIAL_REBATE = /\b(?:rebates?|discounts?|VEU|Victorian Energy Upgrades?|Energy Savings Scheme|STCs?|VEECs?|ESCs?|PRCs?|government assistance)\b/i;
const HPWH = /\b(?:heat[- ]?pump hot[- ]?water|hot[- ]?water systems?|water heaters?|water tanks?|tank volume|anode|\d{3}[- ]litre tank)\b/i;
const EV = /\b(?:electric vehicles?|EVs?|EV chargers?|vehicle charging|vehicle rebate|New Vehicle Efficiency Standard)\b/i;

test("RCAC rebate retrieval aligns the heating subject with the financial decision", () => {
  const queries = [
    "How much rebate can I get for replacing ducted gas heating with reverse-cycle air conditioning?",
    [
      "Work out the rebate for replacing ducted gas heating",
      "What exact proposed system and installation date apply?",
      "I am installing next Friday, an Emerald 18 kW multi-head system with three heads",
    ].join("\n"),
  ];

  for (const query of queries) {
    const passages = selectSurgeIndustryPassagesForPrompt(query, 6);
    const text = passages.map((passage) => passage.excerpt).join("\n");
    assert.ok(passages.length > 0, query);
    assert.ok(passages.every((passage) => RCAC.test(passage.excerpt)), text);
    assert.ok(passages.every((passage) => FINANCIAL_REBATE.test(passage.excerpt)), text);
    assert.ok(passages.every((passage) => !HPWH.test(passage.excerpt)), text);
    assert.ok(passages.every((passage) => !EV.test(passage.excerpt)), text);
  }
});

test("existing focused retrieval cases remain free of cross-topic source drift", () => {
  const cases = [
    {
      query: "One bedroom is freezing and draughty near the window. What should I do?",
      expected: /draught|draft|air leak|seal|weatherstrip/i,
    },
    {
      query: "Does a rebate make double glazing worthwhile on my tariff?",
      expected: /window|glazing|glass|double[- ]?glazed/i,
    },
    {
      query: "How do tariff changes affect rebate payback?",
      expected: /tariff|retailer|import rate|export rate/i,
    },
    {
      query: "What rebate applies to ceiling insulation?",
      expected: /insulation|insulated|batts?|R[- ]?value/i,
    },
  ];

  for (const { query, expected } of cases) {
    const passages = selectSurgeIndustryPassagesForPrompt(query, 5);
    const text = passages.map((passage) => passage.excerpt).join("\n");
    assert.ok(passages.length > 0, query);
    assert.match(text, expected, query);
    assert.doesNotMatch(text, /rebate depth|building energy certificate/i, query);
    assert.doesNotMatch(text, HPWH, query);
  }
});
