import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  clearTradeRebateEstimateDraft,
  loadTradeRebateEstimateDraft,
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

function existingDraft(storage, ownerUid, input = {}) {
  const draft = {
    programCode: "VEU", activityCode: "6", activityTitle: "Space heating and cooling",
    quantity: "18", unit: "VEEC", customerDiscountDollars: "1200.00",
    createdAt: new Date().toISOString(), ...input,
  };
  storage.setItem(`tlink-rebate-estimate-v1:${ownerUid}`, JSON.stringify(draft));
  return draft;
}

test("previously saved rebate drafts remain identity-scoped and exact", () => {
  const storage = store();
  const draft = existingDraft(storage, "installer-a");
  assert.equal(loadTradeRebateEstimateDraft(storage, "installer-b"), null);
  assert.deepEqual(loadTradeRebateEstimateDraft(storage, "installer-a"), draft);
  clearTradeRebateEstimateDraft(storage, "installer-a");
  assert.equal(loadTradeRebateEstimateDraft(storage, "installer-a"), null);
});

test("invalid and excessive saved discounts fail closed and are removed", () => {
  const storage = store();
  for (const customerDiscountDollars of ["", "-1", "1.234", "1000001"] ) {
    existingDraft(storage, "installer", {customerDiscountDollars});
    assert.equal(loadTradeRebateEstimateDraft(storage, "installer"), null);
    assert.equal(storage.getItem("tlink-rebate-estimate-v1:installer"), null);
  }
});

test("saved drafts expire after 24 hours and reject future or corrupt timestamps", (context) => {
  const now = Date.parse("2026-10-05T05:00:00.000Z");
  context.mock.method(Date, "now", () => now);
  const storage = store();
  for (const offset of [0, -(24 * 60 * 60 * 1000), 60_000]) {
    const draft = existingDraft(storage, "installer", {createdAt:new Date(now+offset).toISOString()});
    assert.deepEqual(loadTradeRebateEstimateDraft(storage, "installer"), draft);
  }
  for (const createdAt of [new Date(now-24*60*60*1000-1).toISOString(),new Date(now+60_001).toISOString(),"2026-10-05Tinvalid"]) {
    existingDraft(storage, "installer", {createdAt});
    assert.equal(loadTradeRebateEstimateDraft(storage, "installer"), null);
    assert.equal(storage.getItem("tlink-rebate-estimate-v1:installer"), null);
  }
  storage.setItem("tlink-rebate-estimate-v1:installer", "{broken");
  assert.equal(loadTradeRebateEstimateDraft(storage, "installer"), null);
  assert.equal(storage.getItem("tlink-rebate-estimate-v1:installer"), null);
});

test("calculator retains result values without a discount entry or document handoff", () => {
  const calculator = read("../src/components/CreditexAllProgramCalculator.tsx");
  const workspace = read("../src/components/TradeRebateCalculatorWorkspace.tsx");
  assert.match(calculator, /<CreditexCertificateValueResult/);
  for (const source of [calculator, workspace]) {
    assert.doesNotMatch(source, /TradeRebateEstimateAction|documentDraftOwnerUid|saveTradeRebateEstimateDraft/);
    assert.doesNotMatch(source, /USE FOR QUOTE PLANNING|Use in next quote or invoice|Customer discount before GST/);
  }
  assert.equal(fs.existsSync(new URL("../src/components/TradeRebateEstimateAction.tsx", import.meta.url)), false);
  assert.doesNotMatch(read("../src/lib/trade-rebate-draft.ts"), /saveTradeRebateEstimateDraft|storage\.setItem/);
  const styles = read("../src/components/TradeRebateDocumentActions.css");
  assert.doesNotMatch(styles, /\.trade-rebate-document-action|\.trade-rebate-document-amount/);
  assert.match(styles, /\.trade-rebate-document-offer/);
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

test("one login's existing own and employer drafts stay separate in quotes and invoices", () => {
  const quote = read("../src/components/TradeQuotePanel.tsx");
  const invoice = read("../src/components/TradeQuickInvoicePanel.tsx");
  const user = { uid: "owner-and-team-member" };
  const selectedScope = (source, business) => {
    const expression = source.match(/const businessOwnerUid = ([^;]+);/)?.[1];
    assert.ok(expression, "The component must derive its document scope from the selected business");
    return Function("useTradeBusiness", "user", `return ${expression};`)(() => business, user);
  };
  for (const source of [quote, invoice]) {
    assert.equal(selectedScope(source, null), user.uid, "Standalone own-business rendering preserves existing drafts");
    assert.equal(selectedScope(source, { ownerUid: "employer" }), "employer");
  }
  const storage = store();
  const input = { programCode: "VEU", activityCode: "6", activityTitle: "Space heating and cooling", quantity: "18", unit: "VEEC", customerDiscountDollars: "1200" };
  const own = existingDraft(storage, user.uid, {...input,customerDiscountDollars:"1200.00"});
  const employer = existingDraft(storage, "employer", { ...input, customerDiscountDollars: "800.00" });
  for (const source of [quote, invoice]) {
    const businessOwnerUid = selectedScope(source, { ownerUid: "employer" });
    const loadCall = source.match(/loadTradeRebateEstimateDraft\(window\.sessionStorage, businessOwnerUid\)/)?.[0];
    assert.ok(loadCall);
    const loaded = Function("loadTradeRebateEstimateDraft", "window", "businessOwnerUid", `return ${loadCall};`)(loadTradeRebateEstimateDraft, { sessionStorage: storage }, businessOwnerUid);
    assert.deepEqual(loaded, employer);
    assert.notDeepEqual(loaded, own);
  }
  for (const source of [quote, invoice]) {
    existingDraft(storage, "employer", { ...input, customerDiscountDollars: "800.00" });
    const clearCall = source.match(/clearTradeRebateEstimateDraft\(window\.sessionStorage, businessOwnerUid\)/)?.[0];
    assert.ok(clearCall);
    Function("clearTradeRebateEstimateDraft", "window", "businessOwnerUid", `${clearCall};`)(clearTradeRebateEstimateDraft, { sessionStorage: storage }, selectedScope(source, { ownerUid: "employer" }));
    assert.equal(loadTradeRebateEstimateDraft(storage, "employer"), null);
    assert.deepEqual(loadTradeRebateEstimateDraft(storage, user.uid), own, "Consuming an employer discount must leave the personal business draft untouched");
  }
});
