"use client";

import { useEffect, useRef, useState } from "react";
import {
  officialProductKindLabel,
  type CreditexOfficialProductKind,
} from "@/lib/creditex-official-product-registry";
import styles from "./CreditexVeuPilotWorkspace.module.css";

type Api = (
  path: string,
  init?: RequestInit,
  options?: { requestTimeoutMs?: number },
) => Promise<Record<string, unknown>>;

const OFFICIAL_PRODUCT_RECOVERY_TIMEOUT_MS = 60_000;

export type CreditexOfficialProductOption = {
  id: string;
  registryCode: string;
  snapshotId: string;
  approvalStatus: string;
  sourceSha256: string;
  productKind: CreditexOfficialProductKind;
  brand: string;
  manufacturer: string;
  model: string;
  series: string;
  certificateNumber: string;
  registrationNumber: string;
  eligibleFrom: string;
  eligibleTo: string;
  attributes: Record<string, string | number | boolean | null>;
};

export type CreditexOfficialProductFacetOption = {
  value: string;
  label: string;
  count: number;
};

type CreditexOfficialProductFacets = {
  brands: CreditexOfficialProductFacetOption[];
  models: CreditexOfficialProductFacetOption[];
  productTypes: CreditexOfficialProductFacetOption[];
};

function productFacets(value: unknown): CreditexOfficialProductFacets {
  const facets = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const options = (candidate: unknown) => (
    Array.isArray(candidate)
      ? candidate.flatMap((item) => {
          if (typeof item === "string" && item.trim()) {
            return [{ value: item, label: item, count: 0 }];
          }
          if (!item || typeof item !== "object") return [];
          const record = item as Record<string, unknown>;
          const optionValue = String(record.value || "").trim();
          if (!optionValue) return [];
          return [{
            value: optionValue,
            label: String(record.label || optionValue),
            count: Number(record.count || 0),
          }];
        })
      : []
  );
  return {
    brands: options(facets.brands),
    models: options(facets.models),
    productTypes: options(facets.productTypes),
  };
}

function requestWasSuperseded(value: unknown) {
  return Boolean(
    value
    && typeof value === "object"
    && "name" in value
    && value.name === "AbortError",
  );
}

export function creditexProductOptionLabel(
  product: Pick<
    CreditexOfficialProductOption,
    | "brand"
    | "manufacturer"
    | "model"
    | "series"
    | "certificateNumber"
    | "registrationNumber"
  >,
) {
  const owner = product.brand || product.manufacturer;
  const approval = product.certificateNumber || product.registrationNumber;
  return [owner, product.model, product.series, approval]
    .filter(Boolean)
    .join(" | ");
}

function numericProductAttribute(
  product: CreditexOfficialProductOption | null,
  key: string,
) {
  const value = product?.attributes[key];
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : null;
}

export function creditexInputsFromOfficialProduct(
  current: Record<string, string>,
  kind: CreditexOfficialProductKind,
  product: CreditexOfficialProductOption | null,
) {
  if (!product) return current;
  const next = { ...current };
  if (kind === "battery") {
    const nominal = numericProductAttribute(product, "nominalCapacityKwh");
    const usable = numericProductAttribute(product, "usableCapacityKwh");
    if (nominal && "nominal_battery_capacity_kwh" in next) {
      next.nominal_battery_capacity_kwh = nominal;
    }
    if (usable && "usable_capacity_kwh" in next) {
      next.usable_capacity_kwh = usable;
    }
  }
  if (kind === "inverter") {
    const ratedOutput = numericProductAttribute(product, "ratedAcOutputKw");
    if (ratedOutput && "battery_inverter_output_kw" in next) {
      next.battery_inverter_output_kw = ratedOutput;
    }
    if (ratedOutput && "inverter_capacity_kw" in next) {
      next.inverter_capacity_kw = ratedOutput;
    }
  }
  if (kind === "air_conditioner") {
    const cooling = numericProductAttribute(product, "ratedCoolingCapacityKw");
    const heating = numericProductAttribute(product, "ratedHeatingCapacityKw");
    for (const key of [
      "rated_cooling_capacity_kw",
      "outdoor_cooling_capacity_kw",
      "cooling_capacity_kw",
    ]) {
      if (cooling && key in next) next[key] = cooling;
    }
    for (const key of [
      "outdoor_heating_capacity_kw",
      "heating_capacity_kw",
    ]) {
      if (heating && key in next) next[key] = heating;
    }
  }
  if (kind === "pool_pump") {
    const maximumInput = numericProductAttribute(product, "maximumTestedInputW");
    const paec = numericProductAttribute(
      product,
      "projectedAnnualEnergyConsumptionKwh",
    );
    const dailyRunTime = numericProductAttribute(product, "dailyRunTimeHours");
    if (maximumInput && "maximum_tested_input_w" in next) {
      next.maximum_tested_input_w = maximumInput;
    }
    if (paec && "paec_kwh_per_year" in next) {
      next.paec_kwh_per_year = paec;
    }
    if (dailyRunTime && "daily_run_time_hours" in next) {
      next.daily_run_time_hours = dailyRunTime;
    }
  }
  if (kind === "commercial_refrigerator") {
    const productClass = numericProductAttribute(product, "productClassNumber");
    const energy = numericProductAttribute(
      product,
      "totalEnergyConsumptionKwhPer24h",
    );
    const eei = numericProductAttribute(product, "energyEfficiencyIndex");
    if (productClass && "product_class" in next) next.product_class = productClass;
    if (energy && "tec_kwh_per_24h" in next) next.tec_kwh_per_24h = energy;
    if (eei && "product_eei" in next) next.product_eei = eei;
  }
  return next;
}

export function CreditexOfficialProductPicker({
  api,
  kind,
  installationDate,
  veuActivityCode,
  veuScenario,
  selectedId,
  onSelect,
}: {
  api: Api;
  kind: CreditexOfficialProductKind;
  installationDate: string;
  veuActivityCode?: string;
  veuScenario?: string;
  selectedId: string;
  onSelect: (
    id: string,
    product: CreditexOfficialProductOption | null,
  ) => void;
}) {
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [productType, setProductType] = useState("");
  const [products, setProducts] = useState<CreditexOfficialProductOption[]>([]);
  const [facets, setFacets] = useState<CreditexOfficialProductFacets>({
    brands: [],
    models: [],
    productTypes: [],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const requestRef = useRef(0);
  const onSelectRef = useRef(onSelect);
  const selectedIdRef = useRef(selectedId);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    const requestVersion = requestRef.current + 1;
    requestRef.current = requestVersion;
    const timer = window.setTimeout(() => {
      setBusy(true);
      setError("");
      const parameters = new URLSearchParams({
        productKind: kind,
        installationDate,
        limit: brand && model ? "100" : "1",
      });
      if (brand) parameters.set("brand", brand);
      if (model) parameters.set("model", model);
      if (productType) parameters.set("productType", productType);
      if (veuActivityCode) parameters.set("veuActivityCode", veuActivityCode);
      if (veuScenario) parameters.set("veuScenario", veuScenario);
      void api(
        `/api/creditex/official-products?${parameters.toString()}`,
        {},
        { requestTimeoutMs: OFFICIAL_PRODUCT_RECOVERY_TIMEOUT_MS },
      )
        .then((result) => {
          if (requestRef.current !== requestVersion) return;
          const nextProducts = (result.products || []) as CreditexOfficialProductOption[];
          const nextFacets = productFacets(result.facets);
          setProducts(nextProducts);
          setFacets(nextFacets);
          if (
            model
            && !productType
            && nextFacets.productTypes.length === 1
            && nextFacets.productTypes[0].count === Number(
              result.matchCount || nextProducts.length,
            )
          ) {
            setProductType(nextFacets.productTypes[0].value);
          }
          if (
            !selectedIdRef.current
            && brand
            && model
            && nextProducts.length === 1
            && nextFacets.productTypes.length <= 1
          ) {
            onSelectRef.current(nextProducts[0].id, nextProducts[0]);
          }
        })
        .catch((caught) => {
          if (requestRef.current !== requestVersion) return;
          if (requestWasSuperseded(caught)) return;
          setProducts([]);
          setFacets({ brands: [], models: [], productTypes: [] });
          setError(
            caught instanceof Error
              ? caught.message
              : "The official product registry could not be verified.",
          );
        })
        .finally(() => {
          if (requestRef.current === requestVersion) setBusy(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      requestRef.current += 1;
    };
  }, [
    api,
    brand,
    installationDate,
    kind,
    model,
    productType,
    retryNonce,
    veuActivityCode,
    veuScenario,
  ]);

  const options = products;
  return (
    <fieldset
      aria-busy={busy}
      className={styles.officialProductPicker}
    >
      <legend>{officialProductKindLabel(kind)}</legend>
      <label>
        Brand
        <select
          required
          value={brand}
          disabled={busy || Boolean(error)}
          onChange={(event) => {
            const nextBrand = event.target.value;
            setBrand(nextBrand);
            setModel("");
            setProductType("");
            setProducts([]);
            setFacets((current) => ({
              brands: current.brands,
              models: [],
              productTypes: [],
            }));
            onSelect("", null);
          }}
        >
          <option value="">
            {busy && !brand ? "Loading approved brands..." : "Choose brand"}
          </option>
          {facets.brands.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Model
        <select
          required
          value={model}
          disabled={!brand || busy || Boolean(error)}
          onChange={(event) => {
            setModel(event.target.value);
            setProductType("");
            setProducts([]);
            setFacets((current) => ({ ...current, productTypes: [] }));
            onSelect("", null);
          }}
        >
          <option value="">
            {!brand
              ? "Choose a brand first"
              : busy
                ? "Loading approved models..."
                : "Choose model"}
          </option>
          {facets.models.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {facets.productTypes.length > 1 && (
        <label>
          Product type
          <select
            required
            value={productType}
            disabled={!model || busy || Boolean(error)}
            onChange={(event) => {
              setProductType(event.target.value);
              setProducts([]);
              onSelect("", null);
            }}
          >
            <option value="">Choose product type</option>
            {facets.productTypes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {model
        && products.length > 1
        && (facets.productTypes.length <= 1 || Boolean(productType)) && (
        <label>
          Approval
          <select
            required
            value={selectedId}
            disabled={busy || Boolean(error)}
            onChange={(event) => {
              const id = event.target.value;
              const product = options.find((candidate) => candidate.id === id)
                || null;
              onSelect(id, product);
            }}
          >
            <option value="">Choose approval</option>
            {options.map((product) => (
              <option key={product.id} value={product.id}>
                {creditexProductOptionLabel(product)}
              </option>
            ))}
          </select>
        </label>
      )}
      {error ? (
        <div>
          <small className={styles.productRegistryError} role="alert">
            {error}
          </small>
          <button
            type="button"
            onClick={() => {
              setError("");
              setRetryNonce((current) => current + 1);
            }}
          >
            Retry official registry
          </button>
        </div>
      ) : busy ? (
        <small aria-live="polite">Checking approved products...</small>
      ) : selectedId ? (
        <small aria-live="polite">Approved for the selected date.</small>
      ) : null}
    </fieldset>
  );
}
