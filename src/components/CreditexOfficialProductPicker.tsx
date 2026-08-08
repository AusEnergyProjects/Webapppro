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
) => Promise<Record<string, unknown>>;

export type CreditexOfficialProductOption = {
  id: string;
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
  selectedId,
  onSelect,
}: {
  api: Api;
  kind: CreditexOfficialProductKind;
  installationDate: string;
  selectedId: string;
  onSelect: (
    id: string,
    product: CreditexOfficialProductOption | null,
  ) => void;
}) {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<CreditexOfficialProductOption[]>([]);
  const [selectedProduct, setSelectedProduct] =
    useState<CreditexOfficialProductOption | null>(null);
  const [recordCount, setRecordCount] = useState(0);
  const [snapshotId, setSnapshotId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef(0);

  useEffect(() => {
    const requestVersion = requestRef.current + 1;
    requestRef.current = requestVersion;
    const timer = window.setTimeout(() => {
      setBusy(true);
      setError("");
      const parameters = new URLSearchParams({
        productKind: kind,
        installationDate,
        q: query,
        limit: "100",
      });
      void api(`/api/creditex/official-products?${parameters.toString()}`)
        .then((result) => {
          if (requestRef.current !== requestVersion) return;
          const registry = result.registry as Record<string, unknown> | undefined;
          setProducts((result.products || []) as CreditexOfficialProductOption[]);
          setRecordCount(Number(registry?.recordCount || 0));
          setSnapshotId(String(registry?.snapshotId || ""));
        })
        .catch((caught) => {
          if (requestRef.current !== requestVersion) return;
          setProducts([]);
          setRecordCount(0);
          setSnapshotId("");
          setError(
            caught instanceof Error
              ? caught.message
              : "The official product registry could not be verified.",
          );
        })
        .finally(() => {
          if (requestRef.current === requestVersion) setBusy(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      requestRef.current += 1;
    };
  }, [api, installationDate, kind, query]);

  const options = selectedProduct
    && !products.some((product) => product.id === selectedProduct.id)
    ? [selectedProduct, ...products]
    : products;

  return (
    <fieldset className={styles.officialProductPicker}>
      <legend>Approved {officialProductKindLabel(kind)}</legend>
      <label>
        Search official registry
        <input
          value={query}
          placeholder="Brand, model or approval number"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <label>
        Approved product
        <select
          required
          value={selectedId}
          disabled={busy || Boolean(error)}
          onChange={(event) => {
            const id = event.target.value;
            const product = options.find((candidate) => candidate.id === id)
              || null;
            setSelectedProduct(product);
            onSelect(id, product);
          }}
        >
          <option value="">
            {busy
              ? "Checking official registry..."
              : `Select ${officialProductKindLabel(kind)}`}
          </option>
          {options.map((product) => (
            <option key={product.id} value={product.id}>
              {creditexProductOptionLabel(product)}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <small className={styles.productRegistryError} role="alert">
          {error}
        </small>
      ) : (
        <small>
          {snapshotId
            ? `${recordCount.toLocaleString("en-AU")} official rows | snapshot ${snapshotId.slice(0, 12)}...`
            : "Waiting for the current official snapshot."}
        </small>
      )}
    </fieldset>
  );
}
