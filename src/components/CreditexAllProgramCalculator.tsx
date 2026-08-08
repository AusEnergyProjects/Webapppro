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
import { CreditexGovernedProgramCalculator } from "./CreditexGovernedProgramCalculator";
import { CreditexSresCalculator } from "./CreditexSresCalculator";
import styles from "./CreditexVeuPilotWorkspace.module.css";

type Api = (
  path: string,
  init?: RequestInit,
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

function localProgram(
  programCode: string,
): CreditexLocalProgramDefinition | undefined {
  return CREDITEX_LOCAL_PROGRAM_DEFINITIONS.find(
    (program) => program.programCode === programCode,
  );
}

function CreditexLocalProgramCalculator({
  api,
  program,
}: {
  api: Api;
  program: CreditexLocalProgramDefinition;
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
  const missingApprovedProduct = requiredProductKinds.some(
    (kind) => !selectedProductIds[kind],
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
          programCode: program.programCode,
          activityCode: activity.activityCode,
          effectiveDate: date,
          inputs,
          ...(requiredProductKinds.length > 0 ? { selectedProductIds } : {}),
        }),
      });
      if (requestRef.current === requestVersion) {
        setEstimate(result.estimate as LocalEstimate);
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

  const maximumDate = program.effectiveTo || todayIso();

  return (
    <section
      className={styles.stcEstimator}
      aria-labelledby="local-program-estimator-title"
    >
      <header>
        <div>
          <span>{program.jurisdiction} | SOURCE-PINNED ESTIMATE</span>
          <h4 id="local-program-estimator-title">{program.name}</h4>
          <p>{program.sourceVersion}</p>
        </div>
        <strong>External claim actions disabled</strong>
      </header>

      {activity.productRegistryRequirements.length > 0 && (
        <div className={styles.registryStatus} data-status="stale">
          <div>
            <span>Approved-product controls required</span>
            <strong>Eligibility reconciliation</strong>
            <small>
              {activity.productRegistryRequirements.join(" | ")}
            </small>
          </div>
        </div>
      )}

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
          Installation scenario
          <select value={activity.scenario} disabled>
            <option value={activity.scenario}>{activity.scenario}</option>
          </select>
        </label>
        <label>
          Effective date
          <input
            type="date"
            min={program.effectiveFrom}
            max={maximumDate}
            required
            value={date}
            onChange={(event) => {
              invalidate();
              setDate(event.target.value);
              setSelectedProductIds({});
            }}
          />
        </label>

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

        {activity.inputDefinitions.map((definition) => {
          if (
            definition.key === "horizon_town"
            && program.programCode === "WA-DEBS"
            && inputs.service_area !== "horizon"
          ) {
            return null;
          }
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
              <small>{definition.help}</small>
            </label>
          );
        })}

        <button type="submit" disabled={busy || missingApprovedProduct}>
          {busy
            ? "Calculating..."
            : missingApprovedProduct
              ? "Select approved products"
              : "Calculate estimate"}
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
            <div className={styles.estimateResolution}>
              <strong>Official products pinned to this result</strong>
              {estimate.approvedProducts.map((product) => (
                <span key={product.id}>
                  {officialProductKindLabel(product.productKind)}: {creditexProductOptionLabel(product)}
                </span>
              ))}
              {estimate.registryReceiptHash && (
                <span>Registry receipt {estimate.registryReceiptHash.slice(0, 24)}...</span>
              )}
            </div>
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
            <code title={estimate.receiptHash}>
              Receipt {estimate.receiptHash.slice(0, 22)}...
            </code>
          </footer>
        </section>
      )}
    </section>
  );
}

export function CreditexAllProgramCalculator({
  api,
  role,
}: {
  api: Api;
  role: "admin" | "case_manager" | "reviewer" | "auditor" | "trade";
}) {
  const [programCode, setProgramCode] = useState("SRES");
  const program = localProgram(programCode);
  const governedProgram = programCode === "VEU"
    || programCode === "NSW-PDRS-2026"
    || programCode === "NSW-ESS-2026"
    ? programCode
    : null;

  return (
    <section className={styles.allProgramCalculator}>
      <header>
        <div>
          <span>ALL-IN-ONE CALCULATOR</span>
          <h4>Choose an Australian program</h4>
          <p>
            Each result is tied to an official source window and returns a
            deterministic audit receipt.
          </p>
        </div>
        <label>
          Program
          <select
            value={programCode}
            onChange={(event) => setProgramCode(event.target.value)}
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
      {programCode === "SRES" ? (
        <CreditexSresCalculator api={api} role={role} />
      ) : governedProgram ? (
        <CreditexGovernedProgramCalculator
          key={governedProgram}
          api={api}
          programCode={governedProgram}
        />
      ) : program ? (
        <CreditexLocalProgramCalculator
          key={program.programCode}
          api={api}
          program={program}
        />
      ) : null}
    </section>
  );
}
