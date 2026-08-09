"use client";

import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
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
  receiptHash: string;
  approvedProducts?: Array<{
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
    sourceSha256: string;
  }>;
  registryReceiptHash?: string;
};

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
      requestTimeoutMs: 300_000,
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
      requestTimeoutMs: 300_000,
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
  for (const registryCode of contract.registryCodes) {
    const result = await api("/api/creditex/official-products", {
      method: "POST",
      body: JSON.stringify({
        action: "refresh",
        registryCode,
      }),
    }, { requestTimeoutMs: contract.requestTimeoutMs });
    const registries = Array.isArray(result.registries)
      ? result.registries as Array<Record<string, unknown>>
      : [];
    recordCount += registries.reduce(
      (total, registry) => total + Number(registry.recordCount || 0),
      0,
    );
  }
  return recordCount;
}

function CreditexLocalProgramCalculator({
  api,
  program,
  onEstimate,
}: {
  api: Api;
  program: CreditexLocalProgramDefinition;
  onEstimate?: (estimate: LocalEstimate) => void;
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
            : "The program estimate could not be completed safely.",
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
          <span>{program.jurisdiction} REBATE ESTIMATE</span>
          <h4 id="local-program-estimator-title">{program.name}</h4>
          <small>Estimate only. Final eligibility is checked before any claim.</small>
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
          {busy ? "Calculating..." : "Calculate rebate estimate"}
        </button>
      </form>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {estimate && (
        <section className={styles.estimateResult} aria-live="polite">
          <header>
            <div>
              <span>{estimate.output.label}</span>
              <strong>${estimate.output.quantity}</strong>
            </div>
            <b>Estimate only</b>
          </header>
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
            <p>{estimate.operatorMessage}</p>
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
      )}
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
  const [latestEstimate, setLatestEstimate] = useState<
    TradeRebateEstimateSummary | null
  >(null);
  const program = localProgram(programCode);
  const governedProgram = programCode === "VEU"
    || programCode === "NSW-PDRS-2026"
    || programCode === "NSW-ESS-2026"
    ? programCode
    : null;
  const registryRefreshContract = creditexAutomaticRegistryRefreshContract(
    programCode,
  );

  function acceptSresEstimate(estimate: CreditexSresEstimateResult) {
    setLatestEstimate({
      programCode: "SRES",
      activityCode: estimate.technology,
      activityTitle: estimate.officialSourceTitle || "SRES upgrade",
      quantity: estimate.output.quantity,
      unit: estimate.output.unit,
    });
  }

  function acceptGovernedEstimate(estimate: CreditexGovernedEstimate) {
    const quantity = estimate.output.quantity
      ?? estimate.output.wholeCertificates
      ?? estimate.output.unroundedTonnes
      ?? "";
    if (!quantity) return;
    setLatestEstimate({
      programCode,
      activityCode: estimate.activityCode,
      activityTitle: estimate.activityTitle,
      quantity,
      unit: estimate.output.unit,
    });
  }

  function acceptLocalEstimate(estimate: LocalEstimate) {
    setLatestEstimate({
      programCode: estimate.programCode,
      activityCode: estimate.activityCode,
      activityTitle: estimate.activityTitle,
      quantity: estimate.output.quantity,
      unit: estimate.output.unit,
    });
  }

  async function refreshAutomaticProductRegistry() {
    if (!registryRefreshContract) return;
    setRegistryRefreshBusy(true);
    setRegistryRefreshNotice("");
    setRegistryRefreshError("");
    try {
      const recordCount = await creditexRefreshAutomaticProductRegistries(
        api,
        registryRefreshContract,
      );
      setRegistryRefreshNotice(
        recordCount > 0
          ? `${recordCount.toLocaleString("en-AU")} ${registryRefreshContract.currentLabel}`
          : registryRefreshContract.currentLabel,
      );
      setRegistryRefreshVersion((current) => current + 1);
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
          <small>Fast quote estimate using official scheme data.</small>
        </div>
        <label>
          Program
          <select
            value={programCode}
            disabled={registryRefreshBusy}
            onChange={(event) => {
              setProgramCode(event.target.value);
              setLatestEstimate(null);
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
        />
      ) : governedProgram ? (
        <CreditexGovernedProgramCalculator
          key={`${governedProgram}:${registryRefreshVersion}`}
          api={api}
          programCode={governedProgram}
          onEstimate={acceptGovernedEstimate}
        />
      ) : program ? (
        <CreditexLocalProgramCalculator
          key={`${program.programCode}:${registryRefreshVersion}`}
          api={api}
          program={program}
          onEstimate={acceptLocalEstimate}
        />
      ) : null}
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
