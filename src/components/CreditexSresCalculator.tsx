"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { todayIso } from "@/lib/date-picker";
import { creditexSresCalculationBlocker } from "@/lib/creditex-official-product-registry";
import styles from "./CreditexVeuPilotWorkspace.module.css";

const SRES_PRODUCT_RECOVERY_TIMEOUT_MS = 180_000;

type Api = (
  path: string,
  init?: RequestInit,
  options?: { requestTimeoutMs?: number },
) => Promise<Record<string, unknown>>;

type Technology =
  | "solar_pv"
  | "small_wind"
  | "small_hydro"
  | "solar_water_heater"
  | "air_source_heat_pump"
  | "solar_battery";

type RegisteredTechnology =
  | "solar_water_heater"
  | "air_source_heat_pump";

type ProductOption = {
  sourceRecordKey: string;
  sourceItem: string;
  technology: RegisteredTechnology;
  category: string;
  brand: string;
  model: string;
  eligibleFrom: string;
  eligibleTo: string;
};

type ProductFacet = {
  value: string;
  recordCount: number;
};

type ProductFacets = {
  categories: ProductFacet[];
  brands: ProductFacet[];
  models: ProductFacet[];
};

type RegistryStatus = {
  status: "current" | "stale" | "unavailable";
  lastCheckedAt: string | null;
  snapshot: {
    id: string;
    sourceSha256: string;
    recordCount: number;
    activatedAt: string | null;
  } | null;
  lastAttempt: {
    status: "success" | "unchanged" | "failed";
    checkedAt: string;
    message: string;
  } | null;
};

export type CreditexSresEstimateResult = {
  technology: Technology;
  formulaKey: string;
  formulaVersion: string;
  officialSourceUrl: string;
  officialSourceTitle: string;
  effectiveDate: string;
  trace: Array<{
    key: string;
    label: string;
    input: string;
    operation: string;
    output: string;
    unit: string;
  }>;
  output: {
    quantity: string;
    unit: "STC";
  };
  status: "estimate_only_registry_reconciliation_required";
  certificateActionEnabled: false;
  receiptHash: string;
  resolvedReceiptHash?: string;
  unitQuantity?: string;
  perUnitOutput?: {
    quantity: string;
    unit: "STC";
  };
  waterHeaterItems?: Array<{
    itemNumber: string;
    productKey: string;
    unitQuantity: string;
    resolution: {
      brand?: string;
      model?: string;
      sourceRecordKey?: string;
      eligibleFrom?: string;
      eligibleTo?: string;
    };
    perUnitOutput: {
      quantity: string;
      unit: "STC";
    };
    output: {
      quantity: string;
      unit: "STC";
    };
    receiptHash: string;
    resolvedReceiptHash?: string;
  }>;
  resolution?: {
    brand?: string;
    model?: string;
    postcode?: string;
    zone?: number;
    zoneRating?: string;
    registeredTenYearStcs?: string;
    registryLastCheckedAt?: string;
    unitQuantity?: string;
    totalStcs?: string;
  };
  operatorMessage: string;
};

type FormState = {
  technology: Technology;
  effectiveDate: string;
  postcode: string;
  ratedCapacityKw: string;
  nominalCapacityKwh: string;
  usableCapacityKwh: string;
  unitQuantity: string;
};

export type CreditexSresWaterHeaterItemDraft = {
  id: string;
  productKey: string;
  brand: string;
  model: string;
  unitQuantity: string;
};

export function creditexSresWaterHeaterQuoteUnitTotal(
  items: readonly Pick<CreditexSresWaterHeaterItemDraft, "unitQuantity">[],
  currentQuantity?: string,
) {
  const quantities = [
    ...items.map((item) => item.unitQuantity),
    ...(currentQuantity === undefined ? [] : [currentQuantity]),
  ];
  let total = 0;
  let complete = true;
  for (const quantity of quantities) {
    if (!/^\d+$/.test(quantity)) {
      complete = false;
      continue;
    }
    const parsed = Number(quantity);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 10) {
      complete = false;
      continue;
    }
    total += parsed;
  }
  return { total, complete: complete && total >= 1 && total <= 10 };
}

export type CreditexSresProductCascadeState = {
  category: string;
  brand: string;
  model: string;
  productKey: string;
};

export type CreditexSresProductCascadeAction =
  | {
      type: "reset";
      reason:
        | "technology"
        | "installation_date"
        | "registry_snapshot"
        | "registry_error";
    }
  | { type: "category"; value: string }
  | { type: "brand"; value: string }
  | { type: "model"; value: string }
  | { type: "record"; value: string }
  | { type: "records_loaded"; productKeys: readonly string[] };

export const EMPTY_CREDITEX_SRES_PRODUCT_CASCADE:
CreditexSresProductCascadeState = {
  category: "",
  brand: "",
  model: "",
  productKey: "",
};

export function creditexSresProductCascadeReducer(
  state: CreditexSresProductCascadeState,
  action: CreditexSresProductCascadeAction,
): CreditexSresProductCascadeState {
  if (action.type === "reset") {
    return { ...EMPTY_CREDITEX_SRES_PRODUCT_CASCADE };
  }
  if (action.type === "category") {
    return { category: action.value, brand: "", model: "", productKey: "" };
  }
  if (action.type === "brand") {
    return { ...state, brand: action.value, model: "", productKey: "" };
  }
  if (action.type === "model") {
    return { ...state, model: action.value, productKey: "" };
  }
  if (action.type === "record") {
    return { ...state, productKey: action.value };
  }
  if (
    action.productKeys.length === 1
    && action.productKeys[0]
  ) {
    return { ...state, productKey: action.productKeys[0] };
  }
  return {
    ...state,
    productKey: action.productKeys.includes(state.productKey)
      ? state.productKey
      : "",
  };
}

function initialDate() {
  const today = todayIso();
  if (today < "2026-01-01") return "2026-01-01";
  if (today > "2030-12-31") return "2030-12-31";
  return today;
}

const INITIAL_FORM: FormState = {
  technology: "solar_pv",
  effectiveDate: initialDate(),
  postcode: "3000",
  ratedCapacityKw: "6.6",
  nominalCapacityKwh: "20",
  usableCapacityKwh: "18",
  unitQuantity: "1",
};

const EMPTY_PRODUCT_FACETS: ProductFacets = {
  categories: [],
  brands: [],
  models: [],
};

const PRODUCT_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  capacity_at_most_425l: "Air-source heat pump up to 425 litres",
  capacity_less_than_700l: "Solar water heater under 700 litres",
  capacity_at_least_700l: "Solar water heater 700 litres or more",
};

const SCENARIOS: Record<Technology, string> = {
  solar_pv: "New eligible small generation unit",
  small_wind: "New eligible small wind system",
  small_hydro: "New eligible small hydro system",
  solar_water_heater: "New registered solar water heater",
  air_source_heat_pump: "New registered air-source heat pump",
  solar_battery: "New eligible battery system",
};

function registeredTechnology(
  technology: Technology,
): technology is RegisteredTechnology {
  return technology === "solar_water_heater"
    || technology === "air_source_heat_pump";
}

function dateTimeLabel(value: string | null | undefined) {
  if (!value) return "Never";
  const time = new Date(value);
  return Number.isNaN(time.getTime())
    ? value
    : time.toLocaleString("en-AU", {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

export function CreditexSresCalculator({
  api,
  role,
  onEstimate,
  onEstimateInvalidated,
}: {
  api: Api;
  role: "admin" | "case_manager" | "reviewer" | "auditor" | "trade" | "public";
  onEstimate?: (estimate: CreditexSresEstimateResult) => void;
  onEstimateInvalidated?: () => void;
}) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [productCascade, dispatchProductCascade] = useReducer(
    creditexSresProductCascadeReducer,
    EMPTY_CREDITEX_SRES_PRODUCT_CASCADE,
  );
  const [productFacets, setProductFacets] = useState<ProductFacets>(
    EMPTY_PRODUCT_FACETS,
  );
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [registry, setRegistry] = useState<RegistryStatus | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [lookupVersion, setLookupVersion] = useState(0);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [estimate, setEstimate] = useState<CreditexSresEstimateResult | null>(null);
  const [estimateBusy, setEstimateBusy] = useState(false);
  const [estimateError, setEstimateError] = useState("");
  const [waterHeaterItems, setWaterHeaterItems] = useState<
    CreditexSresWaterHeaterItemDraft[]
  >([]);
  const waterHeaterItemIdRef = useRef(0);
  const estimateRequestRef = useRef(0);
  const registrySnapshotRef = useRef("");

  const productBlocker = creditexSresCalculationBlocker(form.technology);
  const waterHeaterUnitTotal = creditexSresWaterHeaterQuoteUnitTotal(
    waterHeaterItems,
    registeredTechnology(form.technology) ? form.unitQuantity : "0",
  );

  const invalidateEstimate = useCallback(() => {
    estimateRequestRef.current += 1;
    setEstimate(null);
    setEstimateError("");
    setEstimateBusy(false);
    onEstimateInvalidated?.();
  }, [onEstimateInvalidated]);

  function updateForm(updater: (current: FormState) => FormState) {
    invalidateEstimate();
    setForm(updater);
  }

  function updateProductCascade(action: CreditexSresProductCascadeAction) {
    invalidateEstimate();
    dispatchProductCascade(action);
    if (action.type === "category") {
      setProducts([]);
      setProductFacets((current) => ({
        categories: current.categories,
        brands: [],
        models: [],
      }));
    } else if (action.type === "brand") {
      setProducts([]);
      setProductFacets((current) => ({ ...current, models: [] }));
    } else if (action.type === "model") {
      setProducts([]);
    }
  }

  const markRegistryUnverified = useCallback(() => {
    invalidateEstimate();
    registrySnapshotRef.current = "";
    waterHeaterItemIdRef.current = 0;
    setWaterHeaterItems([]);
    dispatchProductCascade({ type: "reset", reason: "registry_error" });
    setProductFacets(EMPTY_PRODUCT_FACETS);
    setProducts([]);
    setRegistry((current) => current
      ? { ...current, status: "stale" }
      : {
          status: "unavailable",
          lastCheckedAt: null,
          snapshot: null,
          lastAttempt: null,
        });
  }, [invalidateEstimate]);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      setLookupBusy(true);
      setLookupError("");
      try {
        const path = registeredTechnology(form.technology)
          ? `/api/creditex/stc-products?${new URLSearchParams({
              technology: form.technology,
              installationDate: form.effectiveDate,
              mode: "cascade",
              ...(productCascade.category
                ? { category: productCascade.category }
                : {}),
              ...(productCascade.brand
                ? { brand: productCascade.brand }
                : {}),
              ...(productCascade.model
                ? { model: productCascade.model }
                : {}),
              limit: "500",
            }).toString()}`
          : "/api/creditex/stc-products";
        const result = await api(path, undefined, {
          requestTimeoutMs: SRES_PRODUCT_RECOVERY_TIMEOUT_MS,
        });
        if (cancelled) return;
        const nextRegistry = (result.registry || null) as RegistryStatus | null;
        const nextSnapshotId = nextRegistry?.snapshot?.id || "";
        const snapshotChanged = Boolean(
          registrySnapshotRef.current
          && nextSnapshotId
          && registrySnapshotRef.current !== nextSnapshotId,
        );
        if (nextSnapshotId) registrySnapshotRef.current = nextSnapshotId;
        setRegistry(nextRegistry);
        const rawFacets = result.facets as Partial<ProductFacets> | undefined;
        const nextFacets: ProductFacets = registeredTechnology(form.technology)
          ? {
              categories: Array.isArray(rawFacets?.categories)
                ? rawFacets.categories as ProductFacet[]
                : [],
              brands: Array.isArray(rawFacets?.brands)
                ? rawFacets.brands as ProductFacet[]
                : [],
              models: Array.isArray(rawFacets?.models)
                ? rawFacets.models as ProductFacet[]
                : [],
            }
          : EMPTY_PRODUCT_FACETS;
        if (snapshotChanged) {
          invalidateEstimate();
          waterHeaterItemIdRef.current = 0;
          setWaterHeaterItems([]);
          dispatchProductCascade({
            type: "reset",
            reason: "registry_snapshot",
          });
          setProductFacets({
            categories: nextFacets.categories,
            brands: [],
            models: [],
          });
          setProducts([]);
          return;
        }
        setProductFacets(nextFacets);
        const nextProducts = registeredTechnology(form.technology)
          ? (result.products || []) as ProductOption[]
          : [];
        if (!registeredTechnology(form.technology)) {
          setProducts([]);
          dispatchProductCascade({ type: "reset", reason: "technology" });
          return;
        }
        if (
          productCascade.category
          && !nextFacets.categories.some(
            (facet) => facet.value === productCascade.category,
          )
        ) {
          invalidateEstimate();
          dispatchProductCascade({
            type: "reset",
            reason: "registry_snapshot",
          });
          setProducts([]);
          return;
        }
        if (!productCascade.category && nextFacets.categories.length === 1) {
          dispatchProductCascade({
            type: "category",
            value: nextFacets.categories[0].value,
          });
          setProducts([]);
          return;
        }
        if (
          productCascade.brand
          && !nextFacets.brands.some(
            (facet) => facet.value === productCascade.brand,
          )
        ) {
          dispatchProductCascade({
            type: "category",
            value: productCascade.category,
          });
          setProducts([]);
          return;
        }
        if (
          productCascade.model
          && !nextFacets.models.some(
            (facet) => facet.value === productCascade.model,
          )
        ) {
          dispatchProductCascade({
            type: "brand",
            value: productCascade.brand,
          });
          setProducts([]);
          return;
        }
        setProducts(nextProducts);
        dispatchProductCascade({
          type: "records_loaded",
          productKeys: nextProducts.map((product) => product.sourceRecordKey),
        });
      } catch (error) {
        if (cancelled) return;
        markRegistryUnverified();
        setLookupError(
          error instanceof Error
            ? error.message
            : "The official product registry could not be loaded.",
        );
      } finally {
        if (!cancelled) setLookupBusy(false);
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    api,
    form.effectiveDate,
    form.technology,
    invalidateEstimate,
    lookupVersion,
    markRegistryUnverified,
    productCascade.brand,
    productCascade.category,
    productCascade.model,
  ]);

  async function refreshRegistry() {
    invalidateEstimate();
    setRefreshBusy(true);
    setLookupError("");
    try {
      const result = await api("/api/creditex/stc-products", {
        method: "POST",
        body: JSON.stringify({ action: "refresh" }),
      }, { requestTimeoutMs: 90_000 });
      const nextRegistry = (result.registry || null) as RegistryStatus | null;
      const nextSnapshotId = nextRegistry?.snapshot?.id || "";
      if (
        registrySnapshotRef.current
        && nextSnapshotId
        && registrySnapshotRef.current !== nextSnapshotId
      ) {
        waterHeaterItemIdRef.current = 0;
        setWaterHeaterItems([]);
        dispatchProductCascade({
          type: "reset",
          reason: "registry_snapshot",
        });
        setProductFacets(EMPTY_PRODUCT_FACETS);
        setProducts([]);
      }
      setRegistry(nextRegistry);
      setLookupVersion((current) => current + 1);
    } catch (error) {
      setProducts([]);
      markRegistryUnverified();
      setLookupError(
        error instanceof Error
          ? error.message
          : "The official registry refresh failed safely.",
      );
    } finally {
      setRefreshBusy(false);
    }
  }

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    invalidateEstimate();
    setEstimateBusy(true);
    setEstimateError("");
    const requestVersion = estimateRequestRef.current + 1;
    estimateRequestRef.current = requestVersion;
    const common = form.technology === "solar_battery"
      ? {
          estimatePurpose: "quote",
          technology: form.technology,
          certificationDate: form.effectiveDate,
        }
      : {
          estimatePurpose: "quote",
          technology: form.technology,
          installationDate: form.effectiveDate,
        };
    const payload = form.technology === "solar_battery"
      ? {
          ...common,
          nominalCapacityKwh: form.nominalCapacityKwh,
          usableCapacityKwh: form.usableCapacityKwh,
        }
      : registeredTechnology(form.technology)
        ? {
            ...common,
            postcode: form.postcode,
            waterHeaterItems: [
              ...waterHeaterItems.map((item) => ({
                productKey: item.productKey,
                unitQuantity: item.unitQuantity,
              })),
              {
                productKey: productCascade.productKey,
                unitQuantity: form.unitQuantity,
              },
            ],
          }
        : form.technology === "small_wind"
            || form.technology === "small_hydro"
          ? {
              ...common,
              ratedCapacityKw: form.ratedCapacityKw,
              postcode: form.postcode,
            }
          : {
              ...common,
              ratedCapacityKw: form.ratedCapacityKw,
              postcode: form.postcode,
            };
    try {
      const result = await api("/api/creditex/stc-estimates", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (estimateRequestRef.current === requestVersion) {
        const nextEstimate = result.estimate as CreditexSresEstimateResult;
        setEstimate(nextEstimate);
        onEstimate?.(nextEstimate);
      }
    } catch (error) {
      if (estimateRequestRef.current === requestVersion) {
        setEstimateError(
          error instanceof Error
            ? error.message
            : "The STC estimate could not be completed safely.",
        );
      }
    } finally {
      if (estimateRequestRef.current === requestVersion) {
        setEstimateBusy(false);
      }
    }
  }

  function updateTechnology(technology: Technology) {
    waterHeaterItemIdRef.current = 0;
    setWaterHeaterItems([]);
    dispatchProductCascade({ type: "reset", reason: "technology" });
    setProductFacets(EMPTY_PRODUCT_FACETS);
    setProducts([]);
    updateForm((current) => ({
      ...current,
      technology,
    }));
  }

  function addWaterHeaterItem() {
    const selected = products.find(
      (product) => product.sourceRecordKey === productCascade.productKey,
    );
    if (!selected || !waterHeaterUnitTotal.complete) return;
    invalidateEstimate();
    waterHeaterItemIdRef.current += 1;
    setWaterHeaterItems((current) => [
      ...current,
      {
        id: `water-heater-item-${waterHeaterItemIdRef.current}`,
        productKey: selected.sourceRecordKey,
        brand: selected.brand,
        model: selected.model,
        unitQuantity: form.unitQuantity,
      },
    ]);
    dispatchProductCascade({ type: "reset", reason: "technology" });
    setProductFacets((current) => ({
      categories: current.categories,
      brands: [],
      models: [],
    }));
    setProducts([]);
    setForm((current) => ({ ...current, unitQuantity: "1" }));
  }

  function removeWaterHeaterItem(id: string) {
    invalidateEstimate();
    setWaterHeaterItems((current) => current.filter((item) => item.id !== id));
  }

  function renderPostcode() {
    return (
      <label>
        Postcode
        <input
          inputMode="numeric"
          pattern="[0-9]{4}"
          maxLength={4}
          required
          value={form.postcode}
          onChange={(event) => updateForm((current) => ({
            ...current,
            postcode: event.target.value.replace(/\D/g, "").slice(0, 4),
          }))}
        />
      </label>
    );
  }

  const resolvedReceipt = estimate
    ? estimate.resolvedReceiptHash || estimate.receiptHash
    : "";

  return (
    <section
      className={styles.stcEstimator}
      aria-labelledby="stc-estimator-title"
    >
      <header>
        <div>
          <span>FEDERAL REBATE ESTIMATE</span>
          <h4 id="stc-estimator-title">Estimate STCs</h4>
          <small>Estimate only. Final eligibility is checked before certificate creation.</small>
        </div>
      </header>

      <form className={styles.estimatorForm} onSubmit={calculate}>
        <label>
          Activity
          <select
            value={form.technology}
            onChange={(event) => updateTechnology(event.target.value as Technology)}
          >
            <option value="solar_pv">Small-scale solar PV</option>
            <option value="small_wind">Small wind system</option>
            <option value="small_hydro">Small hydro system</option>
            <option value="solar_water_heater">Solar water heater</option>
            <option value="air_source_heat_pump">Air-source heat pump</option>
            <option value="solar_battery">Solar battery</option>
          </select>
        </label>
        <label>
          {form.technology === "solar_battery"
            ? "Safety certification date"
            : "Installation date"}
          <input
            type="date"
            min="2026-01-01"
            max="2030-12-31"
            required
            value={form.effectiveDate}
            onChange={(event) => {
              const effectiveDate = event.target.value;
              updateForm((current) => ({
                ...current,
                effectiveDate,
              }));
              dispatchProductCascade({
                type: "reset",
                reason: "installation_date",
              });
              waterHeaterItemIdRef.current = 0;
              setWaterHeaterItems([]);
              setProductFacets(EMPTY_PRODUCT_FACETS);
              setProducts([]);
            }}
          />
        </label>
        <p><strong>Scenario:</strong> {SCENARIOS[form.technology]}</p>

        {form.technology !== "solar_battery"
          && !registeredTechnology(form.technology)
          && renderPostcode()}

        {registeredTechnology(form.technology) && waterHeaterItems.length > 0 && (
          <fieldset className={styles.officialProductPicker}>
            <legend>Added approved products</legend>
            {waterHeaterItems.map((item, index) => (
              <div key={item.id}>
                <strong>{index + 1}. {item.brand} {item.model}</strong>
                <span>{item.unitQuantity} system{item.unitQuantity === "1" ? "" : "s"}</span>
                <button
                  type="button"
                  onClick={() => removeWaterHeaterItem(item.id)}
                >
                  Remove
                </button>
              </div>
            ))}
          </fieldset>
        )}

        {registeredTechnology(form.technology) ? (
          <fieldset className={styles.officialProductPicker}>
            <legend>Approved product {waterHeaterItems.length + 1}</legend>
            {productFacets.categories.length > 1 && (
              <label>
                Product type
                <select
                  required
                  disabled={lookupBusy || registry?.status !== "current"}
                  value={productCascade.category}
                  onChange={(event) => updateProductCascade({
                    type: "category",
                    value: event.target.value,
                  })}
                >
                  <option value="">Choose product type</option>
                  {productFacets.categories.map((facet) => (
                    <option key={facet.value} value={facet.value}>
                      {PRODUCT_CATEGORY_LABELS[facet.value] || facet.value}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Brand
              <select
                required
                disabled={
                  lookupBusy
                  || registry?.status !== "current"
                  || !productCascade.category
                  || productFacets.brands.length === 0
                }
                value={productCascade.brand}
                onChange={(event) => updateProductCascade({
                  type: "brand",
                  value: event.target.value,
                })}
              >
                <option value="">Choose a brand</option>
                {productFacets.brands.map((facet) => (
                  <option key={facet.value} value={facet.value}>
                    {facet.value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Model
              <select
                required
                disabled={
                  lookupBusy
                  || registry?.status !== "current"
                  || !productCascade.brand
                  || productFacets.models.length === 0
                }
                value={productCascade.model}
                onChange={(event) => updateProductCascade({
                  type: "model",
                  value: event.target.value,
                })}
              >
                <option value="">Choose a model</option>
                {productFacets.models.map((facet) => (
                  <option key={facet.value} value={facet.value}>
                    {facet.value}
                  </option>
                ))}
              </select>
            </label>
            {productCascade.model && products.length > 1 && (
              <label>
                Approval
                <select
                  required
                  disabled={lookupBusy || registry?.status !== "current"}
                  value={productCascade.productKey}
                  onChange={(event) => updateProductCascade({
                    type: "record",
                    value: event.target.value,
                  })}
                >
                  <option value="">Choose approval</option>
                  {products.map((product) => (
                    <option
                      key={product.sourceRecordKey}
                      value={product.sourceRecordKey}
                    >
                      {product.brand} {product.model} | {product.sourceItem}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {productCascade.model && !lookupBusy && products.length === 0 && (
              <small>
                No exact registration is eligible for this installation date.
              </small>
            )}
          </fieldset>
        ) : form.technology === "solar_battery" ? (
          <>
            <label>
              Nominal capacity (kWh)
              <input
                inputMode="decimal"
                required
                value={form.nominalCapacityKwh}
                onChange={(event) => updateForm((current) => ({
                  ...current,
                  nominalCapacityKwh: event.target.value,
                }))}
              />
            </label>
            <label>
              Usable capacity (kWh)
              <input
                inputMode="decimal"
                required
                value={form.usableCapacityKwh}
                onChange={(event) => updateForm((current) => ({
                  ...current,
                  usableCapacityKwh: event.target.value,
                }))}
              />
            </label>
          </>
        ) : form.technology === "small_wind"
            || form.technology === "small_hydro" ? (
          <label>
            Rated capacity (kW)
            <input
              inputMode="decimal"
              required
              value={form.ratedCapacityKw}
              onChange={(event) => updateForm((current) => ({
                ...current,
                ratedCapacityKw: event.target.value,
              }))}
            />
          </label>
        ) : (
          <label>
            Rated capacity (kW)
            <input
              inputMode="decimal"
              required
              value={form.ratedCapacityKw}
              onChange={(event) => updateForm((current) => ({
                ...current,
                ratedCapacityKw: event.target.value,
              }))}
            />
          </label>
        )}
        {registeredTechnology(form.technology) && renderPostcode()}

        {registeredTechnology(form.technology) && (
          <>
            <label>
              Systems using this model
              <input
                inputMode="numeric"
                pattern="[0-9]+"
                min="1"
                max="10"
                required
                value={form.unitQuantity}
                onChange={(event) => updateForm((current) => ({
                  ...current,
                  unitQuantity: event.target.value.replace(/\D/g, "").slice(0, 2),
                }))}
              />
              <small>
                Add another approved model when this property uses a mix. Maximum
                10 systems across the property.
              </small>
            </label>
            <p aria-live="polite">
              Property total: {waterHeaterUnitTotal.total} of 10 systems.
            </p>
            <button
              type="button"
              disabled={
                !productCascade.productKey
                || !waterHeaterUnitTotal.complete
                || waterHeaterUnitTotal.total >= 10
              }
              onClick={addWaterHeaterItem}
            >
              Add another approved model
            </button>
          </>
        )}

        <button
          type="submit"
          disabled={
            estimateBusy
            || (
              registeredTechnology(form.technology)
              && (
                !productCascade.productKey
                || !waterHeaterUnitTotal.complete
              )
            )
          }
        >
          {estimateBusy ? "Calculating..." : "Calculate rebate estimate"}
        </button>
      </form>

      {role === "admin" && !productBlocker && (
        <details>
          <summary>Official data status</summary>
          <p>
            {registry?.status || "Checking"}
            {registry?.lastCheckedAt
              ? ` | checked ${dateTimeLabel(registry.lastCheckedAt)}`
              : ""}
          </p>
          <button
            type="button"
            disabled={refreshBusy}
            onClick={refreshRegistry}
          >
            {refreshBusy ? "Refreshing..." : "Refresh official products"}
          </button>
        </details>
      )}

      {lookupError && <p className={styles.error} role="alert">{lookupError}</p>}
      {estimateError && <p className={styles.error} role="alert">{estimateError}</p>}
      {estimate && (
        <section className={styles.estimateResult} aria-live="polite">
          <header>
            <div>
              <span>Estimated quantity</span>
              <strong>{estimate.output.quantity} {estimate.output.unit}</strong>
            </div>
            <b>Estimate only</b>
          </header>
          {estimate.resolution && (
            <div className={styles.estimateResolution}>
              <strong>
                {estimate.resolution.brand && estimate.resolution.model
                  ? `${estimate.resolution.brand} ${estimate.resolution.model}`
                  : `Postcode ${estimate.resolution.postcode}`}
              </strong>
              {Number(estimate.unitQuantity || "1") > 1
                && estimate.perUnitOutput
                && !estimate.waterHeaterItems && (
                <span>
                  {estimate.perUnitOutput.quantity} STC per system x {estimate.unitQuantity} systems
                </span>
              )}
              {estimate.waterHeaterItems?.map((item) => (
                <span key={item.itemNumber}>
                  {item.resolution.brand} {item.resolution.model}: {item.perUnitOutput.quantity} STC per system x {item.unitQuantity} = {item.output.quantity} STC
                </span>
              ))}
            </div>
          )}
          <details>
            <summary>Calculation details</summary>
            {estimate.resolution && (
              <p>
                Zone {estimate.resolution.zone}
                {estimate.resolution.zoneRating
                  ? ` | rating ${estimate.resolution.zoneRating}`
                  : ""}
                {estimate.resolution.registeredTenYearStcs
                  ? ` | registered ${estimate.resolution.registeredTenYearStcs} ten-year STCs`
                  : ""}
              </p>
            )}
            <ol>
              {estimate.trace.map((step) => (
                <li key={step.key}>
                  <div>
                    <strong>{step.label}</strong>
                    <span>{step.operation}</span>
                  </div>
                  <b>{step.output} {step.unit}</b>
                </li>
              ))}
            </ol>
            <p>{estimate.operatorMessage}</p>
            <footer>
              <a href={estimate.officialSourceUrl} target="_blank" rel="noreferrer">
                Open official source
              </a>
              <code title={resolvedReceipt}>
                Receipt {resolvedReceipt.slice(0, 22)}...
              </code>
            </footer>
          </details>
        </section>
      )}
    </section>
  );
}
