import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCreditexVeuOfficialProductSelections,
  CreditexOfficialProductError,
  CREDITEX_OFFICIAL_PRODUCT_KINDS,
  CREDITEX_PRODUCT_KIND_REGISTRY,
  CREDITEX_VEU_ACTIVITY_PRODUCT_CONTRACTS,
  deriveCreditexVeuOfficialProductInputs,
  officialProductKindsForVeuActivity,
  officialVeuProductCategoryNumbersForActivity,
} from "../src/lib/creditex-official-product-registry.ts";

const VEU_KINDS = [
  "veu_water_heater",
  "veu_air_conditioner",
  "veu_double_glazing",
  "veu_secondary_glazing",
  "veu_weather_sealing",
  "veu_shower_rose",
  "veu_refrigerator_freezer_listing",
  "veu_television_listing",
  "veu_clothes_dryer_listing",
  "veu_pool_pump",
  "veu_ceiling_insulation",
  "veu_activity_27_product",
  "veu_in_home_display",
  "veu_refrigerated_display_cabinet",
  "veu_activity_33_product",
  "veu_commercial_lighting",
  "veu_activity_35_product",
  "veu_activity_36_product",
  "veu_commercial_water_heater",
  "veu_induction_cooktop",
  "veu_project_based_lighting_product",
  "veu_unclassified_product",
];

function product(productKind, attributes = {}, overrides = {}) {
  return {
    productKind,
    eligibleFrom: "2026-08-08",
    attributes,
    ...overrides,
  };
}

function veuProduct(productKind, categoryNumber, overrides = {}) {
  return product(
    productKind,
    { veuProductCategoryNumber: categoryNumber },
    overrides,
  );
}

function officialError(error) {
  return error instanceof CreditexOfficialProductError
    && error.code === "OFFICIAL_PRODUCT_NOT_ELIGIBLE";
}

test("every VEU product kind is routed only to the governed VEU registry", () => {
  for (const productKind of VEU_KINDS) {
    assert.ok(CREDITEX_OFFICIAL_PRODUCT_KINDS.includes(productKind));
    assert.equal(
      CREDITEX_PRODUCT_KIND_REGISTRY[productKind],
      "veu-approved-products",
    );
  }
  assert.equal(new Set(VEU_KINDS).size, VEU_KINDS.length);
  assert.deepEqual(
    CREDITEX_OFFICIAL_PRODUCT_KINDS.filter(
      (productKind) => CREDITEX_PRODUCT_KIND_REGISTRY[productKind]
        === "veu-approved-products",
    ),
    VEU_KINDS,
  );
});

test("VEU activity mapping distinguishes every approved-product family", () => {
  const expected = {
    "1C": ["veu_water_heater"],
    "1D": ["veu_water_heater"],
    "3C": ["veu_water_heater"],
    "3D": ["veu_water_heater"],
    "6": ["veu_air_conditioner"],
    "13": ["veu_double_glazing"],
    "14": ["veu_secondary_glazing"],
    "15": ["veu_weather_sealing"],
    "17": ["veu_shower_rose"],
    "22": ["veu_refrigerator_freezer_listing"],
    "24": ["veu_television_listing"],
    "25": ["veu_clothes_dryer_listing"],
    "26": ["veu_pool_pump"],
    "30": ["veu_in_home_display"],
    "31": ["electric_motor"],
    "33": ["veu_activity_33_product"],
    "36": ["veu_activity_36_product"],
    "44": ["veu_commercial_water_heater"],
    "46": ["veu_induction_cooktop"],
    "48": ["veu_ceiling_insulation"],
  };
  assert.deepEqual(Object.keys(CREDITEX_VEU_ACTIVITY_PRODUCT_CONTRACTS), Object.keys(expected));
  for (const [activityCode, kinds] of Object.entries(expected)) {
    assert.deepEqual(officialProductKindsForVeuActivity(activityCode), kinds);
  }
  assert.deepEqual(officialProductKindsForVeuActivity("unsupported"), []);
  assert.ok(
    !Object.values(CREDITEX_VEU_ACTIVITY_PRODUCT_CONTRACTS).some(
      (contract) => contract.productKinds.includes("veu_unclassified_product"),
    ),
  );
});

test("VEU product category compatibility uses exact official category numbers", () => {
  assert.deepEqual(
    officialVeuProductCategoryNumbersForActivity("6"),
    ["6A", "6B(i)", "6B(ii)", "6C", "6D", "6E(i)", "6E(ii)", "6F", "6G"],
  );
  assert.deepEqual(
    officialVeuProductCategoryNumbersForActivity("48"),
    ["48A"],
  );
  assert.doesNotThrow(() => assertCreditexVeuOfficialProductSelections(
    "6",
    [veuProduct("veu_air_conditioner", "6B(i)")],
  ));
  for (const categoryNumber of ["6B", "6b(i)", "6B (i)", "24A"]) {
    assert.throws(
      () => assertCreditexVeuOfficialProductSelections(
        "6",
        [veuProduct("veu_air_conditioner", categoryNumber)],
      ),
      officialError,
    );
  }
  assert.throws(
    () => assertCreditexVeuOfficialProductSelections(
      "6",
      [product("veu_air_conditioner")],
    ),
    officialError,
  );
});

test("VEU appliance activities use the exact VEU listing without fuzzy GEMS matching", () => {
  const refrigerator = veuProduct("veu_refrigerator_freezer_listing", "22C");
  assert.deepEqual(
    assertCreditexVeuOfficialProductSelections("22", [refrigerator]),
    [refrigerator],
  );
  assert.throws(
    () => assertCreditexVeuOfficialProductSelections("22", []),
    officialError,
  );
  assert.throws(
    () => assertCreditexVeuOfficialProductSelections(
      "22",
      [refrigerator, product("refrigerator_freezer")],
    ),
    officialError,
  );
  assert.throws(
    () => assertCreditexVeuOfficialProductSelections(
      "22",
      [
        veuProduct("veu_refrigerator_freezer_listing", "22C"),
        product("television"),
      ],
    ),
    officialError,
  );
});

test("VEU appliance formula inputs come only from exact approved-listing attributes", () => {
  assert.equal(
    deriveCreditexVeuOfficialProductInputs(
      "22",
      { scenario: "22A" },
      [veuProduct("veu_refrigerator_freezer_listing", "22C", {
        attributes: {
          veuProductCategoryNumber: "22C",
          totalVolumeLitres: 300,
          starRating: 5.5,
        },
      })],
    ).scenario,
    "22C",
  );
  assert.equal(
    deriveCreditexVeuOfficialProductInputs(
      "24",
      { scenario: "tampered" },
      [veuProduct("veu_television_listing", "24A", {
        attributes: {
          veuProductCategoryNumber: "24A",
          starRating: 7,
          screenAreaCm2: 4_262,
        },
      })],
    ).scenario,
    "24A",
  );
  assert.equal(
    deriveCreditexVeuOfficialProductInputs(
      "25",
      { scenario: "tampered" },
      [veuProduct("veu_clothes_dryer_listing", "25A", {
        attributes: {
          veuProductCategoryNumber: "25A",
          starRating: 10,
          capacityKg: 9,
        },
      })],
    ).scenario,
    "25A",
  );
  assert.equal(
    deriveCreditexVeuOfficialProductInputs(
      "46",
      { scenario: "tampered" },
      [veuProduct("veu_induction_cooktop", "46B")],
    ).scenario,
    "46B",
  );

  for (const [activityCode, selection] of [
    ["22", veuProduct("veu_refrigerator_freezer_listing", "22A")],
    ["24", veuProduct("veu_television_listing", "24A")],
    ["25", veuProduct("veu_clothes_dryer_listing", "25A")],
  ]) {
    assert.throws(
      () => deriveCreditexVeuOfficialProductInputs(
        activityCode,
        {},
        [selection],
      ),
      officialError,
    );
  }
});

test("selection contracts reject missing approval dates and unknown activities", () => {
  assert.throws(
    () => assertCreditexVeuOfficialProductSelections(
      "17",
      [veuProduct("veu_shower_rose", "17A", { eligibleFrom: "" })],
    ),
    officialError,
  );
  assert.throws(
    () => assertCreditexVeuOfficialProductSelections("unsupported", []),
    officialError,
  );
  assert.throws(
    () => assertCreditexVeuOfficialProductSelections("46", []),
    officialError,
  );
  assert.doesNotThrow(() => assertCreditexVeuOfficialProductSelections(
    "46",
    [veuProduct("veu_induction_cooktop", "46A")],
  ));
});
