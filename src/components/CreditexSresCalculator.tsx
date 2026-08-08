"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { todayIso } from "@/lib/date-picker";
import { creditexSresCalculationBlocker } from "@/lib/creditex-official-product-registry";
import styles from "./CreditexVeuPilotWorkspace.module.css";

type Api = (
  path: string,
  init?: RequestInit,
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

type EstimateResult = {
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
  resolution?: {
    brand?: string;
    model?: string;
    postcode?: string;
    zone?: number;
    zoneRating?: string;
    registeredTenYearStcs?: string;
    registryLastCheckedAt?: string;
  };
  operatorMessage: string;
};

type FormState = {
  technology: Technology;
  effectiveDate: string;
  postcode: string;
  productQuery: string;
  productKey: string;
  ratedCapacityKw: string;
  resourceAvailability: "default" | "site_assessed";
  resourceHoursPerYear: string;
  deemingYears: string;
  nominalCapacityKwh: string;
  usableCapacityKwh: string;
};

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
  productQuery: "",
  productKey: "",
  ratedCapacityKw: "6.6",
  resourceAvailability: "default",
  resourceHoursPerYear: "2001",
  deemingYears: "5",
  nominalCapacityKwh: "20",
  usableCapacityKwh: "18",
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

function requiresCurrentRegistry(technology: Technology) {
  return technology === "solar_pv" || registeredTechnology(technology);
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
}: {
  api: Api;
  role: "admin" | "case_manager" | "reviewer" | "auditor" | "trade";
}) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [registry, setRegistry] = useState<RegistryStatus | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [lookupVersion, setLookupVersion] = useState(0);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [estimate, setEstimate] = useState<EstimateResult | null>(null);
  const [estimateBusy, setEstimateBusy] = useState(false);
  const [estimateError, setEstimateError] = useState("");
  const estimateRequestRef = useRef(0);

  const maximumDeemingYears = useMemo(
    () => String(Math.min(
      5,
      Math.max(1, 2031 - Number(form.effectiveDate.slice(0, 4) || 2030)),
    )),
    [form.effectiveDate],
  );
  const productBlocker = creditexSresCalculationBlocker(form.technology);

  function invalidateEstimate() {
    estimateRequestRef.current += 1;
    setEstimate(null);
    setEstimateError("");
    setEstimateBusy(false);
  }

  function updateForm(updater: (current: FormState) => FormState) {
    invalidateEstimate();
    setForm(updater);
  }

  function markRegistryUnverified() {
    setRegistry((current) => current
      ? { ...current, status: "stale" }
      : {
          status: "unavailable",
          lastCheckedAt: null,
          snapshot: null,
          lastAttempt: null,
        });
  }

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
              q: form.productQuery,
              limit: "50",
            }).toString()}`
          : "/api/creditex/stc-products";
        const result = await api(path);
        if (cancelled) return;
        setRegistry((result.registry || null) as RegistryStatus | null);
        const nextProducts = registeredTechnology(form.technology)
          ? (result.products || []) as ProductOption[]
          : [];
        setProducts(nextProducts);
        setForm((current) => {
          if (!registeredTechnology(current.technology)) {
            return current.productKey ? { ...current, productKey: "" } : current;
          }
          if (
            current.productKey
            && nextProducts.some(
              (product) => product.sourceRecordKey === current.productKey,
            )
          ) {
            return current;
          }
          return { ...current, productKey: "" };
        });
      } catch (error) {
        if (cancelled) return;
        setProducts([]);
        markRegistryUnverified();
        setLookupError(
          error instanceof Error
            ? error.message
            : "The official product registry could not be loaded.",
        );
      } finally {
        if (!cancelled) setLookupBusy(false);
      }
    }, registeredTechnology(form.technology) ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    api,
    form.effectiveDate,
    form.productQuery,
    form.technology,
    lookupVersion,
  ]);

  async function refreshRegistry() {
    invalidateEstimate();
    setRefreshBusy(true);
    setLookupError("");
    try {
      const result = await api("/api/creditex/stc-products", {
        method: "POST",
        body: JSON.stringify({ action: "refresh" }),
      });
      setRegistry((result.registry || null) as RegistryStatus | null);
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
    setEstimateBusy(true);
    setEstimateError("");
    setEstimate(null);
    const requestVersion = estimateRequestRef.current + 1;
    estimateRequestRef.current = requestVersion;
    const common = form.technology === "solar_battery"
      ? {
          technology: form.technology,
          certificationDate: form.effectiveDate,
        }
      : {
          technology: form.technology,
          installationDate: form.effectiveDate,
        };
    const payload = form.technology === "solar_battery"
      ? {
          ...common,
          claimScope: "new_system",
          nominalCapacityKwh: form.nominalCapacityKwh,
          usableCapacityKwh: form.usableCapacityKwh,
        }
      : registeredTechnology(form.technology)
        ? {
            ...common,
            postcode: form.postcode,
            productKey: form.productKey,
          }
        : form.technology === "small_wind"
            || form.technology === "small_hydro"
          ? {
              ...common,
              ratedCapacityKw: form.ratedCapacityKw,
              resourceAvailability: form.resourceAvailability,
              ...(form.resourceAvailability === "site_assessed"
                ? { resourceHoursPerYear: form.resourceHoursPerYear }
                : {}),
              deemingYears: form.deemingYears,
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
        setEstimate(result.estimate as EstimateResult);
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
    setProducts([]);
    updateForm((current) => ({
      ...current,
      technology,
      productKey: "",
      productQuery: "",
      resourceAvailability: "default",
      resourceHoursPerYear: technology === "small_hydro" ? "4001" : "2001",
      deemingYears: maximumDeemingYears,
    }));
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
          <span>SRES | OFFICIAL DATA ESTIMATE</span>
          <h4 id="stc-estimator-title">Estimate STCs</h4>
          <p>
            Postcode zones and registered water-heater product values are
            resolved server-side from source-pinned official data.
          </p>
        </div>
        <strong>Certificate creation disabled</strong>
      </header>

      <div
        className={styles.registryStatus}
        data-status={productBlocker ? "unavailable" : registry?.status || "unavailable"}
        aria-live="polite"
        aria-busy={lookupBusy || refreshBusy}
      >
        <div>
          <span>
            {productBlocker
              ? "Controlled official product source"
              : "Official CER product registry"}
          </span>
          <strong>{productBlocker ? "unavailable" : registry?.status || "checking"}</strong>
          <small>
            {productBlocker
              ? productBlocker
              : registry?.snapshot
              ? `${registry.snapshot.recordCount.toLocaleString("en-AU")} records | checked ${dateTimeLabel(registry.lastCheckedAt)}`
              : "No active snapshot. An administrator must run the first controlled refresh."}
          </small>
        </div>
        {role === "admin" && !productBlocker && (
          <button
            type="button"
            disabled={refreshBusy}
            onClick={refreshRegistry}
          >
            {refreshBusy ? "Refreshing..." : "Refresh now"}
          </button>
        )}
      </div>

      <form className={styles.estimatorForm} onSubmit={calculate}>
        {productBlocker && (
          <div className={styles.registryStatus} data-status="stale">
            <div>
              <span>Official product evidence incomplete</span>
              <strong>Calculation disabled</strong>
              <small>{productBlocker}</small>
            </div>
          </div>
        )}
        <label>
          Program
          <select value="SRES" disabled>
            <option value="SRES">Federal | SRES | STCs</option>
          </select>
        </label>
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
          Installation scenario
          <select value={SCENARIOS[form.technology]} disabled>
            <option value={SCENARIOS[form.technology]}>
              {SCENARIOS[form.technology]}
            </option>
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
              const maximum = String(Math.min(
                5,
                Math.max(1, 2031 - Number(effectiveDate.slice(0, 4) || 2030)),
              ));
              updateForm((current) => ({
                ...current,
                effectiveDate,
                deemingYears: maximum,
                productKey: "",
              }));
            }}
          />
        </label>

        {(form.technology === "solar_pv" || registeredTechnology(form.technology)) && (
          <label>
            Installation postcode
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
            <small>The official zone and factor are derived automatically.</small>
          </label>
        )}

        {registeredTechnology(form.technology) ? (
          <>
            <label>
              Find approved product
              <input
                type="search"
                value={form.productQuery}
                placeholder="Brand or model"
                onChange={(event) => updateForm((current) => ({
                  ...current,
                  productQuery: event.target.value,
                  productKey: "",
                }))}
              />
              <small>
                {lookupBusy
                  ? "Searching the current official snapshot..."
                  : `${products.length} eligible matches shown`}
              </small>
            </label>
            <label>
              Approved product
              <select
                required
                disabled={lookupBusy || registry?.status !== "current"}
                value={form.productKey}
                onChange={(event) => updateForm((current) => ({
                  ...current,
                  productKey: event.target.value,
                }))}
              >
                <option value="">Choose an eligible product</option>
                {products.map((product) => (
                  <option
                    key={product.sourceRecordKey}
                    value={product.sourceRecordKey}
                  >
                    {product.brand} | {product.model}
                  </option>
                ))}
              </select>
              <small>
                Product eligibility is filtered to the installation date.
              </small>
            </label>
          </>
        ) : form.technology === "solar_battery" ? (
          <>
            <label>
              Claim scope
              <select value="new_system" disabled>
                <option value="new_system">New eligible battery system</option>
              </select>
            </label>
            <label>
              Nominal capacity (kWh)
              <input
                inputMode="decimal"
                required
                disabled
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
                disabled
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
          <>
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
            <label>
              Resource availability
              <select
                value={form.resourceAvailability}
                onChange={(event) => updateForm((current) => ({
                  ...current,
                  resourceAvailability: event.target.value as FormState["resourceAvailability"],
                }))}
              >
                <option value="default">
                  Government default | {form.technology === "small_wind" ? "2,000" : "4,000"} hours
                </option>
                <option value="site_assessed">Site-assessed hours | audit required</option>
              </select>
            </label>
            {form.resourceAvailability === "site_assessed" && (
              <label>
                Assessed hours per year
                <input
                  inputMode="numeric"
                  required
                  value={form.resourceHoursPerYear}
                  onChange={(event) => updateForm((current) => ({
                    ...current,
                    resourceHoursPerYear: event.target.value,
                  }))}
                />
              </label>
            )}
            <label>
              Certificate period
              <select
                value={form.deemingYears}
                onChange={(event) => updateForm((current) => ({
                  ...current,
                  deemingYears: event.target.value,
                }))}
              >
                <option value="1">1 year</option>
                {maximumDeemingYears !== "1" && (
                  <option value={maximumDeemingYears}>
                    {maximumDeemingYears} years | maximum
                  </option>
                )}
              </select>
            </label>
          </>
        ) : (
          <label>
            Rated capacity (kW)
            <input
              inputMode="decimal"
              required
              disabled={Boolean(productBlocker)}
              value={form.ratedCapacityKw}
              onChange={(event) => updateForm((current) => ({
                ...current,
                ratedCapacityKw: event.target.value,
              }))}
            />
          </label>
        )}

        <button
          type="submit"
          disabled={
            estimateBusy
            || Boolean(productBlocker)
            || (requiresCurrentRegistry(form.technology)
              && (
                registry?.status !== "current"
                || (registeredTechnology(form.technology) && !form.productKey)
              ))
          }
        >
          {estimateBusy
            ? "Calculating..."
            : productBlocker
              ? "Official product evidence required"
              : "Calculate estimate"}
        </button>
      </form>

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
                  ? `${estimate.resolution.brand} | ${estimate.resolution.model}`
                  : `Postcode ${estimate.resolution.postcode}`}
              </strong>
              <span>
                Zone {estimate.resolution.zone}
                {estimate.resolution.zoneRating
                  ? ` | rating ${estimate.resolution.zoneRating}`
                  : ""}
                {estimate.resolution.registeredTenYearStcs
                  ? ` | registered ${estimate.resolution.registeredTenYearStcs} ten-year STCs`
                  : ""}
              </span>
            </div>
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
        </section>
      )}
    </section>
  );
}
