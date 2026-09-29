import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  clearTradeRebateEstimateDraft,
  loadTradeRebateEstimateDraft,
  saveTradeRebateEstimateDraft,
} from "../src/lib/trade-rebate-draft.ts";

function store() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("rebate estimate drafts are identity-scoped and exact", () => {
  const storage = store();
  const draft = saveTradeRebateEstimateDraft(storage, "installer-a", {
    programCode: "VEU",
    activityCode: "6",
    activityTitle: "Space heating and cooling",
    quantity: "18",
    unit: "VEEC",
    customerDiscountDollars: "1200",
  });
  assert.equal(draft?.customerDiscountDollars, "1200.00");
  assert.equal(loadTradeRebateEstimateDraft(storage, "installer-b"), null);
  assert.deepEqual(loadTradeRebateEstimateDraft(storage, "installer-a"), draft);
  clearTradeRebateEstimateDraft(storage, "installer-a");
  assert.equal(loadTradeRebateEstimateDraft(storage, "installer-a"), null);
});

test("invalid and excessive discounts fail closed", () => {
  const storage = store();
  for (const customerDiscountDollars of ["", "-1", "1.234", "1000001"] ) {
    assert.equal(saveTradeRebateEstimateDraft(storage, "installer", {
      programCode: "SRES",
      activityCode: "solar_pv",
      activityTitle: "Solar PV",
      quantity: "39",
      unit: "STC",
      customerDiscountDollars,
    }), null);
  }
});

test("trade calculator offers one practical document handoff without a receipt", () => {
  const calculator = read("../src/components/CreditexAllProgramCalculator.tsx");
  const action = read("../src/components/TradeRebateEstimateAction.tsx");
  const workspace = read("../src/components/TradeRebateCalculatorWorkspace.tsx");
  assert.match(calculator, /TradeRebateEstimateAction/);
  assert.match(workspace, /documentDraftOwnerUid=\{businessOwnerUid\}/);
  assert.match(workspace, /const businessOwnerUid = useTradeBusiness\(\)\?\.ownerUid \|\| user\.uid/);
  assert.match(action, /saveTradeRebateEstimateDraft\(\s*window\.sessionStorage,\s*ownerUid,/);
  assert.match(action, /USE FOR QUOTE PLANNING/);
  assert.match(action, /Use in next quote or invoice/);
  assert.match(action, /Customer discount before GST/);
  assert.match(
    action,
    /saving this does not create certificates[\s\S]*provider acceptance/,
  );
  assert.doesNotMatch(action, /USE THIS ESTIMATE/);
  assert.doesNotMatch(action, /receipt|download|share/i);
});

test("quotes and invoices consume the same business-scoped discount", () => {
  const quote = read("../src/components/TradeQuotePanel.tsx");
  const invoice = read("../src/components/TradeQuickInvoicePanel.tsx");
  assert.match(quote, /Add discount to this quote/);
  assert.match(quote, /lineType: "adjustment"/);
  assert.match(quote, /unitPrice: `-\$\{rebateDraft\.customerDiscountDollars\}`/);
  assert.match(invoice, /Use discount on this invoice/);
  assert.match(
    invoice,
    /toCents\(newDiscount\) \+ toCents\(rebateDraft\.customerDiscountDollars\)/,
  );
  assert.match(
    invoice,
    /toCents\(draftDiscount\) \+ toCents\(rebateDraft\.customerDiscountDollars\)/,
  );
  assert.match(invoice, /added to the existing invoice discount/);
  for (const source of [quote, invoice]) {
    assert.match(source, /const businessOwnerUid = useTradeBusiness\(\)\?\.ownerUid \|\| user\.uid/);
    assert.match(source, /loadTradeRebateEstimateDraft\(window\.sessionStorage, businessOwnerUid\)/);
    assert.match(source, /clearTradeRebateEstimateDraft\(window\.sessionStorage, businessOwnerUid\)/);
  }
});

test("one login's own and employer rebate drafts stay separate through calculator, quote and invoice handoffs", () => {
  const calculator = read("../src/components/TradeRebateCalculatorWorkspace.tsx");
  const quote = read("../src/components/TradeQuotePanel.tsx");
  const invoice = read("../src/components/TradeQuickInvoicePanel.tsx");
  const user = { uid: "owner-and-team-member" };
  const selectedScope = (source, business) => {
    const expression = source.match(/const businessOwnerUid = ([^;]+);/)?.[1];
    assert.ok(expression, "The component must derive its document scope from the selected business");
    return Function("useTradeBusiness", "user", `return ${expression};`)(() => business, user);
  };
  for (const source of [calculator, quote, invoice]) {
    assert.equal(selectedScope(source, null), user.uid, "Standalone own-business rendering preserves existing drafts");
    assert.equal(selectedScope(source, { ownerUid: "employer" }), "employer");
  }
  const storage = store();
  const input = { programCode: "VEU", activityCode: "6", activityTitle: "Space heating and cooling", quantity: "18", unit: "VEEC", customerDiscountDollars: "1200" };
  const own = saveTradeRebateEstimateDraft(storage, selectedScope(calculator, { ownerUid: user.uid }), input);
  const employer = saveTradeRebateEstimateDraft(storage, selectedScope(calculator, { ownerUid: "employer" }), { ...input, customerDiscountDollars: "800" });
  for (const source of [quote, invoice]) {
    const businessOwnerUid = selectedScope(source, { ownerUid: "employer" });
    const loadCall = source.match(/loadTradeRebateEstimateDraft\(window\.sessionStorage, businessOwnerUid\)/)?.[0];
    assert.ok(loadCall);
    const loaded = Function("loadTradeRebateEstimateDraft", "window", "businessOwnerUid", `return ${loadCall};`)(loadTradeRebateEstimateDraft, { sessionStorage: storage }, businessOwnerUid);
    assert.deepEqual(loaded, employer);
    assert.notDeepEqual(loaded, own);
  }
  for (const source of [quote, invoice]) {
    saveTradeRebateEstimateDraft(storage, "employer", { ...input, customerDiscountDollars: "800" });
    const clearCall = source.match(/clearTradeRebateEstimateDraft\(window\.sessionStorage, businessOwnerUid\)/)?.[0];
    assert.ok(clearCall);
    Function("clearTradeRebateEstimateDraft", "window", "businessOwnerUid", `${clearCall};`)(clearTradeRebateEstimateDraft, { sessionStorage: storage }, selectedScope(source, { ownerUid: "employer" }));
    assert.equal(loadTradeRebateEstimateDraft(storage, "employer"), null);
    assert.deepEqual(loadTradeRebateEstimateDraft(storage, user.uid), own, "Consuming an employer discount must leave the personal business draft untouched");
  }
});
