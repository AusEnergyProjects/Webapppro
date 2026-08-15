"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  CERTIFICATE_CODES,
  type CertificateCode,
} from "@/lib/certificate-prices";
import { todayIso } from "@/lib/date-picker";
import {
  CREDITEX_LOCAL_PROGRAM_DEFINITIONS,
  type CreditexLocalActivityDefinition,
  type CreditexLocalProgramDefinition,
} from "@/lib/creditex-local-program-catalogue";
import {
  officialProductKindLabel,
  officialProductKindsForLocalActivity,
  type CreditexOfficialProductKind,
} from "@/lib/creditex-official-product-registry";
import {
  CreditexOfficialProductPicker,
  creditexInputsFromOfficialProduct,
  creditexProductOptionLabel,
} from "./CreditexOfficialProductPicker";
import {
  CreditexGovernedProgramCalculator,
  type CreditexGovernedEstimate,
  creditexCalculationBoundaryMessage,
  creditexQuoteEvidenceInput,
} from "./CreditexGovernedProgramCalculator";
import {
  CreditexSresCalculator,
  type CreditexSresEstimateResult,
} from "./CreditexSresCalculator";
import {
  TradeRebateEstimateAction,
  type TradeRebateEstimateSummary,
} from "./TradeRebateEstimateAction";
import styles from "./CreditexVeuPilotWorkspace.module.css";

type Api = (
  path: string,
  init?: RequestInit,
  options?: { requestTimeoutMs?: number },
) => Promise<Record<string, unknown>>;

type CreditexLatestEstimateAction =
  | { type: "accept"; estimate: TradeRebateEstimateSummary }
  | { type: "invalidate" };

const CREDITEX_REGISTRY_STATUS_POLL_INITIAL_DELAY_MS = 5_000;
const CREDITEX_REGISTRY_STATUS_POLL_INTERVAL_MS = 15_000;
const CREDITEX_REGISTRY_STATUS_POLL_TIMEOUT_MS = 30 * 60_000;

type CreditexRegistryStatusPoll = Readonly<{
  generation: number;
  programCode: string;
  registryCodes: readonly string[];
  sourceLabel: string;
  currentLabel: string;
  requestTimeoutMs: number;
  deadlineAt: number;
}>;

export function creditexLatestEstimateReducer(
  _current: TradeRebateEstimateSummary | null,
  action: CreditexLatestEstimateAction,
) {
  return action.type === "accept" ? action.estimate : null;
}

function registryStatusRecord(value: unknown) {
  const status = objectValue(value);
  return typeof status?.registryCode === "string" ? status : null;
}

export function creditexAutomaticRegistryPollState(
  registryCodes: readonly string[],
  registries: readonly unknown[],
  refreshQueuedRegistryCodes: readonly string[],
) {
  const statuses = registries.map(registryStatusRecord).filter(Boolean);
  const requested = registryCodes.map((registryCode) => statuses.find(
    (status) => status?.registryCode === registryCode,
  ) || null);
  if (requested.some((status) => (
    objectValue(status?.lastAttempt)?.status === "failed"
  ))) return "failed" as const;
  if (
    refreshQueuedRegistryCodes.length > 0
    || requested.length !== registryCodes.length
    || requested.some((status) => status?.status !== "current")
  ) return "pending" as const;
  return "complete" as const;
}

type CreditexCertificateGrossValue = {
  code: CertificateCode;
  certificateCount: number;
  unitPriceCents: number;
  grossValueCents: number;
  tradedOn: string;
  datasetAsOf: string;
  sourceCheckedAt: string;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function certificateCode(value: string): value is CertificateCode {
  return (CERTIFICATE_CODES as readonly string[]).includes(value);
}

function validDate(value: string) {
  return value.length > 0 && Number.isFinite(Date.parse(value));
}

export function creditexCertificateGrossValue(
  datasetValue: unknown,
  codeValue: string,
  certificateCountValue: string | null | undefined,
): CreditexCertificateGrossValue | null {
  if (!certificateCode(codeValue)) return null;
  if (!certificateCountValue || !/^\d+$/.test(certificateCountValue)) {
    return null;
  }
  const certificateCount = Number(certificateCountValue);
  if (!Number.isSafeInteger(certificateCount) || certificateCount < 0) {
    return null;
  }

  const dataset = objectValue(datasetValue);
  const source = objectValue(dataset?.source);
  if (!dataset || !source || source.status !== "current") return null;
  const certificate = Array.isArray(dataset.certificates)
    ? dataset.certificates
      .map(objectValue)
      .find((item) => item?.code === codeValue)
    : null;
  const latest = objectValue(certificate?.latest);
  const unitPriceCents = Number(latest?.priceCents);
  if (
    !latest
    || !Number.isSafeInteger(unitPriceCents)
    || unitPriceCents <= 0
  ) {
    return null;
  }

  const grossValueCents = certificateCount * unitPriceCents;
  const tradedOn = String(latest.tradedOn || "");
  const datasetAsOf = String(dataset.asOf || "");
  const sourceCheckedAt = String(source.lastCheckedAt || "");
  if (
    !Number.isSafeInteger(grossValueCents)
    || !validDate(tradedOn)
    || !validDate(datasetAsOf)
    || !validDate(sourceCheckedAt)
  ) {
    return null;
  }

  return {
    code: codeValue,
    certificateCount,
    unitPriceCents,
    grossValueCents,
    tradedOn,
    datasetAsOf,
    sourceCheckedAt,
  };
}

function certificateMoney(cents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function certificateDate(value: string, includeTime = false) {
  const date = new Date(includeTime ? value : `${value}T00:00:00Z`);
  return date.toLocaleString("en-AU", includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium", timeZone: "UTC" });
}

function useCreditexCertificatePriceDataset(api: Api) {
  const [dataset, setDataset] = useState<unknown>(null);
  useEffect(() => {
    let active = true;
    api("/api/certificate-prices")
      .then((result) => {
        if (active) setDataset(result);
      })
      .catch(() => {
        if (active) setDataset(null);
      });
    return () => {
      active = false;
    };
  }, [api]);
  return dataset;
}

function CreditexCertificateGrossValueResult({
  dataset,
  estimate,
}: {
  dataset: unknown;
  estimate: TradeRebateEstimateSummary | null;
}) {
  const value = creditexCertificateGrossValue(
    dataset,
    estimate?.unit || "",
    estimate?.quantity,
  );
  if (!value) return null;

  return (
    <section
      className={styles.estimateResult}
      aria-live="polite"
      aria-label="Reference gross certificate value"
    >
      <header>
        <div>
          <span>Latest market reference value</span>
          <strong>
            {value.certificateCount.toLocaleString("en-AU")} {value.code}
            {" "}x {certificateMoney(value.unitPriceCents)}
            {" "}= {certificateMoney(value.grossValueCents)} gross*
          </strong>
        </div>
        <b>Market reference only</b>
      </header>
      <div className={styles.estimateResolution}>
        <span>
          Most recent reference trade {certificateDate(value.tradedOn)}.
          Market data as of {certificateDate(value.datasetAsOf, true)}.
        </span>
        <small>
          Market reference checked {certificateDate(value.sourceCheckedAt, true)}.
        </small>
        <small>
          *Gross certificate value before registration, audit, compliance,
          processing and other fees. The actual customer rebate will be lower.
        </small>
      </div>
    </section>
  );
}

type LocalEstimate = {
  programCode: string;
  jurisdiction: string;
  activityCode: string;
  activityTitle: string;
  scenario: string;
  formulaKey: string;
  sourceVersion: string;
  effectiveDate: string;
  officialSourceUrl: string;
  officialSourceTitle: string;
  productRegistryRequirements: readonly string[];
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
    unit: "AUD";
    label: string;
  };
  certificateActionEnabled: false;
  operatorMessage: string;
  eligibilityWarnings?: Array<{
    inputKey?: string;
    message: string;
  }>;
  receiptHash: string;
  approvedProducts?: Array<{
    id: string;
    snapshotId: string;
    productKind: CreditexOfficialProductKind;
    brand: string;
    manufacturer: string;
    model: string;
    series: string;
    certificateNumber: string;
    registrationNumber: string;
    eligibleFrom: string;
    eligibleTo: string;
    sourceSha256: string;
  }>;
  registryReceiptHash?: string;
};

function CreditexLocalProgramResult({ estimate }: { estimate: LocalEstimate }) {
  const approvedProducts = estimate.approvedProducts || [];
  const approvedProductSnapshotIds = Array.from(new Set(
    approvedProducts
      .map((product) => (
        typeof product.snapshotId === "string" ? product.snapshotId.trim() : ""
      ))
      .filter(Boolean),
  ));
  const provenanceComplete = Boolean(
    estimate.effectiveDate
    && estimate.formulaKey
    && estimate.sourceVersion
    && approvedProducts.every((product) => (
      typeof product.snapshotId === "string" && Boolean(product.snapshotId.trim())
    )),
  );

  return (
    <section className={styles.estimateResult} aria-live="polite">
      <header>
        <div>
          <span>Calculated quote-planning amount</span>
          <strong>${estimate.output.quantity}</strong>
        </div>
        <b>{provenanceComplete
          ? "Source-verified result"
          : "Calculation provenance incomplete"}</b>
      </header>
      <div className={styles.estimateResolution}>
        {provenanceComplete ? (
          <span>
            Exact, source-verified calculation for the selected inputs and
            installation date {estimate.effectiveDate}.
          </span>
        ) : (
          <span>
            The calculation returned a result, but its complete date, product
            snapshot or source-version provenance is unavailable.
          </span>
        )}
        <span>
          Approved product snapshot:{" "}
          {approvedProductSnapshotIds.length > 0
            ? approvedProductSnapshotIds.join(", ")
            : "Not used by this calculation"}.
        </span>
        <span>
          Formula/source version: {estimate.formulaKey || "not recorded"}
          {" | "}{estimate.sourceVersion || "not recorded"}.
        </span>
      </div>
      {estimate.approvedProducts && estimate.approvedProducts.length > 0 && (
        <div className={styles.estimateResolution}>
          {estimate.approvedProducts.map((product) => (
            <strong key={product.id}>
              {[product.brand || product.manufacturer, product.model]
                .filter(Boolean)
                .join(" ")}
            </strong>
          ))}
        </div>
      )}
      <p>
        This confirms the calculation only. Final eligibility and evidence must
        still be confirmed. Any claim, certificate creation and provider
        acceptance remain separate workflows.
      </p>
      <details>
        <summary>Calculation details</summary>
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
        {estimate.productRegistryRequirements.length > 0 && (
          <p>
            Product eligibility required: {estimate.productRegistryRequirements.join("; ")}.
          </p>
        )}
        {estimate.approvedProducts && estimate.approvedProducts.length > 0 && (
          <p>
            {estimate.approvedProducts.map((product) => (
              `${officialProductKindLabel(product.productKind)}: ${creditexProductOptionLabel(product)}`
            )).join("; ")}
          </p>
        )}
        {creditexCalculationBoundaryMessage(estimate.operatorMessage) && (
          <p>
            <strong>Eligibility boundary:</strong>{" "}
            {creditexCalculationBoundaryMessage(estimate.operatorMessage)}
          </p>
        )}
        {estimate.eligibilityWarnings && estimate.eligibilityWarnings.length > 0 && (
          <ul>
            {estimate.eligibilityWarnings.map((warning, index) => (
              <li key={`${warning.inputKey || "eligibility"}:${index}`}>
                {warning.message}
              </li>
            ))}
          </ul>
        )}
        <footer>
          <a
            href={estimate.officialSourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open official source
          </a>
          <code title={estimate.registryReceiptHash || estimate.receiptHash}>
            Receipt {(estimate.registryReceiptHash || estimate.receiptHash).slice(0, 22)}...
          </code>
        </footer>
      </details>
    </section>
  );
}

function effectiveDate(program: CreditexLocalProgramDefinition) {
  const today = todayIso();
  if (today < program.effectiveFrom) return program.effectiveFrom;
  if (program.effectiveTo && today > program.effectiveTo) {
    return program.effectiveTo;
  }
  return today;
}

function defaultInputs(activity: CreditexLocalActivityDefinition) {
  return Object.fromEntries(
    activity.inputDefinitions.map((definition) => [
      definition.key,
      definition.defaultValue,
    ]),
  );
}

const CREDITEX_LOCAL_PRODUCT_DERIVED_INPUTS = new Set([
  "nominal_battery_capacity_kwh",
  "usable_capacity_kwh",
  "battery_inverter_output_kw",
  "inverter_capacity_kw",
  "rated_cooling_capacity_kw",
  "outdoor_cooling_capacity_kw",
  "cooling_capacity_kw",
  "outdoor_heating_capacity_kw",
  "heating_capacity_kw",
  "maximum_tested_input_w",
  "paec_kwh_per_year",
  "daily_run_time_hours",
  "product_class",
  "tec_kwh_per_24h",
  "product_eei",
]);

function localProgram(
  programCode: string,
): CreditexLocalProgramDefinition | undefined {
  return CREDITEX_LOCAL_PROGRAM_DEFINITIONS.find(
    (program) => program.programCode === programCode,
  );
}

export function creditexAutomaticRegistryRefreshContract(programCode: string) {
  if (programCode === "VEU") {
    return {
      registryCodes: ["veu-approved-products"],
      sourceLabel: "VEU Public Registry",
      sourceDescription: "Automatic VEU-approved product source",
      buttonLabel: "Refresh VEU-approved products",
      currentLabel: "VEU Public Registry rows are current.",
      requestTimeoutMs: 25_000,
    } as const;
  }
  if (
    programCode === "NSW-ESS-2026"
    || programCode === "NSW-PDRS-2026"
  ) {
    return {
      registryCodes: ["nsw-tessa-products", "gems-products"],
      sourceLabel: "NSW official product data",
      sourceDescription: "Automatic NSW official product data",
      buttonLabel: "Refresh NSW official products",
      currentLabel: "NSW official product rows are current.",
      requestTimeoutMs: 25_000,
    } as const;
  }
  return null;
}

export async function creditexRefreshAutomaticProductRegistries(
  api: Api,
  contract: {
    readonly registryCodes: readonly string[];
    readonly requestTimeoutMs: number;
  },
) {
  let recordCount = 0;
  let queuedRegistryCount = 0;
  for (const registryCode of contract.registryCodes) {
    const result = await api("/api/creditex/official-products", {
      method: "POST",
      body: JSON.stringify({
        action: "refresh",
        registryCode,
      }),
    }, { requestTimeoutMs: contract.requestTimeoutMs });
    if (result.queued !== true) {
      throw new Error(
        `The ${registryCode} update was not accepted by the background refresh queue.`,
      );
    }
    queuedRegistryCount += 1;
    const registries = Array.isArray(result.registries)
      ? result.registries as Array<Record<string, unknown>>
      : [];
    recordCount += registries.reduce(
      (total, registry) => total + (
        registry.status === "current" ? Number(registry.recordCount || 0) : 0
      ),
      0,
    );
  }
  return { queuedRegistryCount, recordCount };
}

function CreditexLocalProgramCalculator({
  api,
  program,
  onEstimate,
  onEstimateInvalidated,
}: {
  api: Api;
  program: CreditexLocalProgramDefinition;
  onEstimate?: (estimate: LocalEstimate) => void;
  onEstimateInvalidated?: () => void;
}) {
  const firstActivity = program.activities[0];
  const [activityCode, setActivityCode] = useState(firstActivity.activityCode);
  const [date, setDate] = useState(() => effectiveDate(program));
  const [inputs, setInputs] = useState<Record<string, string>>(
    () => defaultInputs(firstActivity),
  );
  const [selectedProductIds, setSelectedProductIds] = useState<Record<string, string>>({});
  const [estimate, setEstimate] = useState<LocalEstimate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef(0);

  const activity = useMemo(
    () => program.activities.find((candidate) => (
      candidate.activityCode === activityCode
    )) || firstActivity,
    [activityCode, firstActivity, program.activities],
  );
  const requiredProductKinds = useMemo(
    () => officialProductKindsForLocalActivity(
      program.programCode,
      activity.activityCode,
    ),
    [activity.activityCode, program.programCode],
  );
  function invalidate() {
    requestRef.current += 1;
    setEstimate(null);
    setError("");
    setBusy(false);
    onEstimateInvalidated?.();
  }

  function updateActivity(nextCode: string) {
    const next = program.activities.find((candidate) => (
      candidate.activityCode === nextCode
    ));
    if (!next) return;
    invalidate();
    setActivityCode(next.activityCode);
    setInputs(defaultInputs(next));
    setSelectedProductIds({});
  }

  function updateInput(key: string, value: string) {
    invalidate();
    setInputs((current) => ({ ...current, [key]: value }));
  }

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onEstimateInvalidated?.();
    const requestVersion = requestRef.current + 1;
    requestRef.current = requestVersion;
    setBusy(true);
    setError("");
    setEstimate(null);
    try {
      const result = await api("/api/creditex/program-estimates", {
        method: "POST",
        body: JSON.stringify({
          estimatePurpose: "quote",
          programCode: program.programCode,
          activityCode: activity.activityCode,
          effectiveDate: date,
          inputs,
          ...(requiredProductKinds.length > 0 ? { selectedProductIds } : {}),
        }),
      });
      if (requestRef.current === requestVersion) {
        const nextEstimate = result.estimate as LocalEstimate;
        setEstimate(nextEstimate);
        onEstimate?.(nextEstimate);
      }
    } catch (caught) {
      if (requestRef.current === requestVersion) {
        setError(
          caught instanceof Error
            ? caught.message
            : "The program calculation could not be completed safely.",
        );
      }
    } finally {
      if (requestRef.current === requestVersion) setBusy(false);
    }
  }

  function renderInput(
    definition: CreditexLocalActivityDefinition["inputDefinitions"][number],
  ) {
    if (
      definition.key === "horizon_town"
      && program.programCode === "WA-DEBS"
      && inputs.service_area !== "horizon"
    ) return null;
    return (
      <label key={definition.key}>
        {definition.label}
        {definition.type === "select" ? (
          <select
            required
            value={inputs[definition.key] || ""}
            onChange={(event) => updateInput(
              definition.key,
              event.target.value,
            )}
          >
            {definition.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            inputMode={definition.type === "integer" ? "numeric" : "decimal"}
            required
            value={inputs[definition.key] || ""}
            onChange={(event) => updateInput(
              definition.key,
              event.target.value,
            )}
          />
        )}
        {!/(?:postcode|premises|sector)/.test(definition.key) && (
          <small>{definition.help}</small>
        )}
      </label>
    );
  }

  const quoteInputs = activity.inputDefinitions.filter(
    (definition) => !CREDITEX_LOCAL_PRODUCT_DERIVED_INPUTS.has(definition.key),
  );
  const contextInputs = quoteInputs.filter(
    (definition) => /(?:postcode|premises|sector)/.test(definition.key),
  );
  const evidenceInputs = quoteInputs.filter(
    (definition) => creditexQuoteEvidenceInput(definition.key),
  );
  const formulaInputs = quoteInputs.filter((definition) => (
    !/(?:postcode|premises|sector)/.test(definition.key)
    && !creditexQuoteEvidenceInput(definition.key)
  ));

  return (
    <section
      className={styles.stcEstimator}
      aria-labelledby="local-program-estimator-title"
    >
      <header>
        <div>
          <span>{program.jurisdiction} QUOTE CALCULATION</span>
          <h4 id="local-program-estimator-title">{program.name}</h4>
          <small>
            Source-pinned calculation for quote planning. Final eligibility and
            any claim or provider acceptance are checked separately.
          </small>
        </div>
      </header>

      <form className={styles.estimatorForm} onSubmit={calculate}>
        <label>
          Activity
          <select
            value={activity.activityCode}
            onChange={(event) => updateActivity(event.target.value)}
          >
            {program.activities.map((candidate) => (
              <option
                key={candidate.activityCode}
                value={candidate.activityCode}
              >
                {candidate.activityCode} | {candidate.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Installation date
          <input
            type="date"
            min={program.effectiveFrom}
            max={program.effectiveTo || undefined}
            required
            value={date}
            onChange={(event) => {
              invalidate();
              setDate(event.target.value);
              setSelectedProductIds({});
            }}
          />
        </label>

        <p><strong>Scenario:</strong> {activity.scenario}</p>

        {contextInputs.map(renderInput)}

        {requiredProductKinds.map((kind) => (
          <CreditexOfficialProductPicker
            key={`${activity.activityCode}:${date}:${kind}`}
            api={api}
            kind={kind}
            installationDate={date}
            selectedId={selectedProductIds[kind] || ""}
            onSelect={(id, product) => {
              invalidate();
              setSelectedProductIds((current) => ({
                ...current,
                [kind]: id,
              }));
              setInputs((current) => (
                creditexInputsFromOfficialProduct(current, kind, product)
              ));
            }}
          />
        ))}

        {formulaInputs.map(renderInput)}
        {(evidenceInputs.length > 0
          || activity.productRegistryRequirements.length > 0) && (
          <details>
            <summary>Eligibility and evidence</summary>
            <p>
              Keep the product, invoice and installation records for the final
              eligibility check. These checks are not needed to calculate a quote.
            </p>
          </details>
        )}

        <button type="submit" disabled={busy}>
          {busy ? "Calculating..." : "Calculate source-verified result"}
        </button>
      </form>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {estimate && <CreditexLocalProgramResult estimate={estimate} />}
    </section>
  );
}

export function CreditexAllProgramCalculator({
  api,
  role,
  initialProgramCode = "SRES",
  documentDraftOwnerUid = "",
}: {
  api: Api;
  role: "admin" | "case_manager" | "reviewer" | "auditor" | "trade" | "public";
  initialProgramCode?: string;
  documentDraftOwnerUid?: string;
}) {
  const [programCode, setProgramCode] = useState(initialProgramCode);
  const [registryRefreshVersion, setRegistryRefreshVersion] = useState(0);
  const [registryRefreshBusy, setRegistryRefreshBusy] = useState(false);
  const [registryRefreshNotice, setRegistryRefreshNotice] = useState("");
  const [registryRefreshError, setRegistryRefreshError] = useState("");
  const [registryStatusPoll, setRegistryStatusPoll] =
    useState<CreditexRegistryStatusPoll | null>(null);
  const registryStatusPollGenerationRef = useRef(0);
  const [latestEstimate, dispatchLatestEstimate] = useReducer(
    creditexLatestEstimateReducer,
    null,
  );
  const invalidateLatestEstimate = useCallback(() => {
    dispatchLatestEstimate({ type: "invalidate" });
  }, []);
  const certificatePriceDataset = useCreditexCertificatePriceDataset(api);
  const program = localProgram(programCode);
  const governedProgram = programCode === "VEU"
    || programCode === "NSW-PDRS-2026"
    || programCode === "NSW-ESS-2026"
    ? programCode
    : null;
  const registryRefreshContract = creditexAutomaticRegistryRefreshContract(
    programCode,
  );

  const cancelRegistryStatusPoll = useCallback(() => {
    registryStatusPollGenerationRef.current += 1;
    setRegistryStatusPoll(null);
  }, []);

  useEffect(() => {
    if (!registryStatusPoll) return;
    const activeContract = creditexAutomaticRegistryRefreshContract(programCode);
    const contractChanged = role !== "admin"
      || registryStatusPoll.programCode !== programCode
      || !activeContract
      || JSON.stringify(activeContract.registryCodes)
        !== JSON.stringify(registryStatusPoll.registryCodes);
    if (contractChanged) {
      registryStatusPollGenerationRef.current += 1;
      return;
    }

    let active = true;
    let timer: number | null = null;
    let controller: AbortController | null = null;
    const generation = registryStatusPoll.generation;
    const stillActive = () => active
      && registryStatusPollGenerationRef.current === generation;

    const finishTimedOut = () => {
      if (!stillActive()) return;
      setRegistryRefreshNotice("");
      setRegistryRefreshError(
        `The accepted ${registryStatusPoll.sourceLabel} update was not confirmed current within 30 minutes. Product choices were not reloaded. Refresh again to request another controlled update.`,
      );
      setRegistryStatusPoll(null);
    };

    const schedule = (delay: number) => {
      if (!stillActive()) return;
      const remaining = registryStatusPoll.deadlineAt - Date.now();
      if (remaining <= 0) {
        finishTimedOut();
        return;
      }
      timer = window.setTimeout(
        () => void pollRegistryStatus(),
        Math.min(delay, remaining),
      );
    };

    const pollRegistryStatus = async () => {
      if (!stillActive()) return;
      controller = new AbortController();
      try {
        const [statusResult, continuationResults] = await Promise.all([
          api(
            "/api/creditex/official-products",
            { signal: controller.signal },
            { requestTimeoutMs: registryStatusPoll.requestTimeoutMs },
          ),
          Promise.all(registryStatusPoll.registryCodes.map(
            async (registryCode) => ({
              registryCode,
              result: await api(
                `/api/creditex/official-products?continueRegistry=${encodeURIComponent(registryCode)}`,
                { signal: controller?.signal },
                { requestTimeoutMs: registryStatusPoll.requestTimeoutMs },
              ),
            }),
          )),
        ]);
        if (!stillActive()) return;

        const registries = Array.isArray(statusResult.registries)
          ? statusResult.registries.map(registryStatusRecord).filter(Boolean)
          : [];
        const queuedRegistryCodes = continuationResults
          .filter(({ result }) => result.refreshQueued === true)
          .map(({ registryCode }) => registryCode);
        const failedRegistryCodes = registries.flatMap((status) => {
          const lastAttempt = objectValue(status?.lastAttempt);
          return registryStatusPoll.registryCodes.includes(
            String(status?.registryCode || ""),
          ) && lastAttempt?.status === "failed"
            ? [String(status?.registryCode || "")]
            : [];
        }).filter(Boolean);
        const pollState = creditexAutomaticRegistryPollState(
          registryStatusPoll.registryCodes,
          registries,
          queuedRegistryCodes,
        );

        if (pollState === "complete") {
          setRegistryRefreshError("");
          setRegistryRefreshNotice(
            `${registryStatusPoll.currentLabel} Product choices reloaded automatically.`,
          );
          setRegistryRefreshVersion((current) => current + 1);
          setRegistryStatusPoll(null);
          return;
        }

        if (pollState === "failed") {
          setRegistryRefreshError(
            `The accepted official data update is not current. The last controlled refresh for ${failedRegistryCodes.join(", ")} did not complete. Status checks will continue automatically.`,
          );
          setRegistryRefreshNotice("");
        } else {
          setRegistryRefreshError("");
          setRegistryRefreshNotice(
            `The accepted ${registryStatusPoll.sourceLabel} update is not current yet. Status checks will continue automatically, and product choices will reload after every requested registry is current.`,
          );
        }
      } catch {
        if (!stillActive()) return;
        setRegistryRefreshNotice("");
        setRegistryRefreshError(
          "The accepted official data update has not been confirmed current because the latest status check failed. Checking again automatically.",
        );
      }
      schedule(CREDITEX_REGISTRY_STATUS_POLL_INTERVAL_MS);
    };

    schedule(CREDITEX_REGISTRY_STATUS_POLL_INITIAL_DELAY_MS);
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
      controller?.abort();
    };
  }, [api, programCode, registryStatusPoll, role]);

  function acceptSresEstimate(estimate: CreditexSresEstimateResult) {
    dispatchLatestEstimate({
      type: "accept",
      estimate: {
        programCode: "SRES",
        activityCode: estimate.technology,
        activityTitle: estimate.officialSourceTitle || "SRES upgrade",
        quantity: estimate.output.quantity,
        unit: estimate.output.unit,
      },
    });
  }

  function acceptGovernedEstimate(estimate: CreditexGovernedEstimate) {
    const quantity = estimate.output.quantity
      ?? estimate.output.wholeCertificates
      ?? estimate.output.unroundedTonnes
      ?? "";
    if (!quantity) return;
    dispatchLatestEstimate({
      type: "accept",
      estimate: {
        programCode,
        activityCode: estimate.activityCode,
        activityTitle: estimate.activityTitle,
        quantity,
        unit: estimate.output.unit,
      },
    });
  }

  function acceptLocalEstimate(estimate: LocalEstimate) {
    dispatchLatestEstimate({
      type: "accept",
      estimate: {
        programCode: estimate.programCode,
        activityCode: estimate.activityCode,
        activityTitle: estimate.activityTitle,
        quantity: estimate.output.quantity,
        unit: estimate.output.unit,
      },
    });
  }

  async function refreshAutomaticProductRegistry() {
    if (!registryRefreshContract) return;
    cancelRegistryStatusPoll();
    invalidateLatestEstimate();
    setRegistryRefreshBusy(true);
    setRegistryRefreshNotice("");
    setRegistryRefreshError("");
    try {
      const { queuedRegistryCount, recordCount } =
        await creditexRefreshAutomaticProductRegistries(
        api,
        registryRefreshContract,
      );
      setRegistryRefreshNotice(
        recordCount > 0
          ? `${queuedRegistryCount} official data update${
              queuedRegistryCount === 1 ? "" : "s"
            } accepted. ${recordCount.toLocaleString("en-AU")} current approved rows remain available while status checks continue automatically.`
          : `${queuedRegistryCount} official data update${
              queuedRegistryCount === 1 ? "" : "s"
            } accepted. Status checks will continue automatically, and product choices will load when every requested registry is current.`,
      );
      const generation = registryStatusPollGenerationRef.current + 1;
      registryStatusPollGenerationRef.current = generation;
      setRegistryStatusPoll({
        generation,
        programCode,
        registryCodes: [...registryRefreshContract.registryCodes],
        sourceLabel: registryRefreshContract.sourceLabel,
        currentLabel: registryRefreshContract.currentLabel,
        requestTimeoutMs: registryRefreshContract.requestTimeoutMs,
        deadlineAt: Date.now() + CREDITEX_REGISTRY_STATUS_POLL_TIMEOUT_MS,
      });
    } catch (caught) {
      setRegistryRefreshError(
        caught instanceof Error
          ? caught.message
          : "The official product registry refresh failed safely.",
      );
    } finally {
      setRegistryRefreshBusy(false);
    }
  }

  return (
    <section className={styles.allProgramCalculator}>
      <header>
        <div>
          <span>REBATE CALCULATOR</span>
          <h4>Choose a program</h4>
          <small>
            Quote planning with official scheme data. Successful governed results
            show their exact calculation and product provenance.
          </small>
        </div>
        <label>
          Program
          <select
            value={programCode}
            disabled={registryRefreshBusy}
            onChange={(event) => {
              cancelRegistryStatusPoll();
              setProgramCode(event.target.value);
              invalidateLatestEstimate();
              setRegistryRefreshNotice("");
              setRegistryRefreshError("");
            }}
          >
            <option value="SRES">AU | SRES | Small-scale Renewable Energy Scheme</option>
            <option value="VEU">VIC | VEU | Victorian Energy Upgrades</option>
            <option value="NSW-PDRS-2026">NSW | PDRS | Peak Demand Reduction Scheme</option>
            <option value="NSW-ESS-2026">NSW | ESS | Energy Savings Scheme</option>
            {CREDITEX_LOCAL_PROGRAM_DEFINITIONS.map((candidate) => (
              <option
                key={candidate.programCode}
                value={candidate.programCode}
              >
                {candidate.jurisdiction} | {candidate.programCode} | {candidate.name}
              </option>
            ))}
          </select>
        </label>
      </header>
      {role === "admin" && registryRefreshContract && (
        <details>
          <summary>Official data status</summary>
          <p aria-live="polite">
            {registryRefreshError
              || registryRefreshNotice
              || registryRefreshContract.sourceLabel}
          </p>
          <button
            type="button"
            disabled={registryRefreshBusy}
            onClick={() => void refreshAutomaticProductRegistry()}
          >
            {registryRefreshBusy
              ? "Refreshing..."
              : registryRefreshContract.buttonLabel}
          </button>
        </details>
      )}
      {programCode === "SRES" ? (
        <CreditexSresCalculator
          api={api}
          role={role}
          onEstimate={acceptSresEstimate}
          onEstimateInvalidated={invalidateLatestEstimate}
        />
      ) : governedProgram ? (
        <CreditexGovernedProgramCalculator
          key={`${governedProgram}:${registryRefreshVersion}`}
          api={api}
          programCode={governedProgram}
          onEstimate={acceptGovernedEstimate}
          onEstimateInvalidated={invalidateLatestEstimate}
        />
      ) : program ? (
        <CreditexLocalProgramCalculator
          key={`${program.programCode}:${registryRefreshVersion}`}
          api={api}
          program={program}
          onEstimate={acceptLocalEstimate}
          onEstimateInvalidated={invalidateLatestEstimate}
        />
      ) : null}
      <CreditexCertificateGrossValueResult
        dataset={certificatePriceDataset}
        estimate={latestEstimate}
      />
      {role === "trade" && documentDraftOwnerUid && latestEstimate && (
        <TradeRebateEstimateAction
          key={`${latestEstimate.programCode}:${latestEstimate.activityCode}:${latestEstimate.quantity}:${latestEstimate.unit}`}
          estimate={latestEstimate}
          ownerUid={documentDraftOwnerUid}
        />
      )}
    </section>
  );
}
