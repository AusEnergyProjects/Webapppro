import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import path from "node:path";

import react from "@vitejs/plugin-react";
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
