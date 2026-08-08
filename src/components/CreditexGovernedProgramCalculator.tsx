"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { todayIso } from "@/lib/date-picker";
import {
  CREDITEX_NSW_PROGRAM_DEFINITIONS,
  type CreditexNswActivityDefinition,
  type CreditexNswProgramDefinition,
} from "@/lib/creditex-nsw-program-catalogue";
import {
  CREDITEX_VEU_ACTIVITY_DEFINITIONS,
  type CreditexVeuActivityDefinition,
} from "@/lib/creditex-veu-calculator-catalogue";
import {
  resolveCreditexVeuPostcode,
} from "@/lib/creditex-veu-postcode-resolver";
import {
  deriveCreditexNswOfficialProductInputs,
  deriveCreditexVeuOfficialProductInputs,
  officialProductKindsForNswProductKinds,
  officialProductKindsForVeuActivity,
  officialProductInputKeysForNswActivity,
  unresolvedNswProductKinds,
} from "@/lib/creditex-official-product-registry";
import {
  CreditexOfficialProductPicker,
  creditexProductOptionLabel,
  type CreditexOfficialProductOption,
} from "./CreditexOfficialProductPicker";
import styles from "./CreditexVeuPilotWorkspace.module.css";

type Api = (
  path: string,
  init?: RequestInit,
) => Promise<Record<string, unknown>>;

type ApprovedProduct = CreditexOfficialProductOption & {
  sourceSha256: string;
};

type GovernedEstimate = {
  programCode?: string;
  jurisdiction?: string;
  activityCode: string;
  activityTitle: string;
  scenario?: string;
  supportedScenario?: string;
  formulaKey: string;
  effectiveDate?: string;
  installationDate?: string;
  officialSourceUrl: string;
  officialSourceTitle: string;
  trace: Array<{
    key: string;
    label: string;
    operation: string;
    output: string | {
      decimal: string;
      unit: string;
    };
    unit?: string;
  }>;
  output: {
    quantity?: string;
    label?: string;
    unit: "ESC" | "PRC" | "VEEC";
    wholeCertificates?: string | null;
    unroundedTonnes?: string;
    roundingStatus?: string;
  };
  productRegistryRequirements?: readonly string[];
  approvedProducts?: ApprovedProduct[];
  registryReceiptHash?: string;
  certificateActionEnabled: false;
  operatorMessage: string;
  receiptHash: string;
};

function nswProgram(programCode: string) {
  return CREDITEX_NSW_PROGRAM_DEFINITIONS.find(
    (program) => program.programCode === programCode,
  );
}

function nswDefaults(activity: CreditexNswActivityDefinition) {
  return Object.fromEntries(activity.inputDefinitions.map((definition) => [
    definition.key,
    definition.defaultValue,
  ]));
}

function veuDefaults(activity: CreditexVeuActivityDefinition) {
  return Object.fromEntries(activity.inputDefinitions.map((definition) => [
    definition.key,
    definition.defaultValue,
  ]));
}

function stringInputs(inputs: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(inputs).map(([key, value]) => [
    key,
    String(value),
  ]));
}

function outputQuantity(estimate: GovernedEstimate) {
  if (estimate.output.quantity !== undefined) return estimate.output.quantity;
  return estimate.output.wholeCertificates ?? estimate.output.unroundedTonnes ?? "";
}

function traceOutput(
  output: GovernedEstimate["trace"][number]["output"],
  fallbackUnit = "",
) {
  if (typeof output === "string") return `${output} ${fallbackUnit}`.trim();
  return `${output.decimal} ${output.unit}`.trim();
}

function GovernedResult({ estimate }: { estimate: GovernedEstimate }) {
  return (
    <section className={styles.estimateResult} aria-live="polite">
      <header>
        <div>
          <span>{estimate.output.label || "Estimated whole certificates"}</span>
          <strong>{outputQuantity(estimate)} {estimate.output.unit}</strong>
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
            <b>{traceOutput(step.output, step.unit)}</b>
          </li>
        ))}
      </ol>
      {estimate.approvedProducts && estimate.approvedProducts.length > 0 && (
        <div className={styles.estimateResolution}>
          <strong>Official products pinned to this result</strong>
          {estimate.approvedProducts.map((product) => (
            <span key={product.id}>{creditexProductOptionLabel(product)}</span>
          ))}
          {estimate.registryReceiptHash && (
            <span>Registry receipt {estimate.registryReceiptHash.slice(0, 24)}...</span>
          )}
        </div>
      )}
      <p>{estimate.operatorMessage}</p>
      <footer>
        <a href={estimate.officialSourceUrl} target="_blank" rel="noreferrer">
          Open official source
        </a>
        <code title={estimate.receiptHash}>
          Receipt {estimate.receiptHash.slice(0, 22)}...
        </code>
      </footer>
    </section>
  );
}

function CreditexNswCalculator({
  api,
  program,
}: {
  api: Api;
  program: CreditexNswProgramDefinition;
}) {
  const firstActivity = program.activities[0];
  const [activityCode, setActivityCode] = useState<string>(firstActivity.activityCode);
  const [date, setDate] = useState(() => (
    todayIso() < firstActivity.effectiveFrom
      ? firstActivity.effectiveFrom
      : todayIso()
  ));
  const [inputs, setInputs] = useState<Record<string, string>>(
    () => nswDefaults(firstActivity),
  );
  const [selectedProductIds, setSelectedProductIds] =
    useState<Record<string, string>>({});
  const [selectedProductEligibleFrom, setSelectedProductEligibleFrom] =
    useState<Record<string, string>>({});
  const [productEvidenceError, setProductEvidenceError] = useState("");
  const [estimate, setEstimate] = useState<GovernedEstimate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef(0);

  const activity = useMemo(
    () => program.activities.find((candidate) => (
      candidate.activityCode === activityCode
    )) || firstActivity,
    [activityCode, firstActivity, program.activities],
  );
  const requiredKinds = useMemo(
    () => officialProductKindsForNswProductKinds(activity.productKinds),
    [activity.productKinds],
  );
  const unresolvedKinds = useMemo(
    () => unresolvedNswProductKinds(activity.productKinds),
    [activity.productKinds],
  );
  const missingProduct = requiredKinds.some((kind) => !selectedProductIds[kind]);
  const registryBlocked = activity.calculationStatus === "official_registry_required"
    || unresolvedKinds.length > 0;
  const missingEligibilityStart = requiredKinds.some((kind) => (
    Boolean(selectedProductIds[kind]) && !selectedProductEligibleFrom[kind]
  ));
  const officialProductInputKeys = useMemo(
    () => new Set(officialProductInputKeysForNswActivity(activity.activityCode)),
    [activity.activityCode],
  );

  function invalidate() {
    requestRef.current += 1;
    setEstimate(null);
    setError("");
    setBusy(false);
  }

  function chooseActivity(nextCode: string) {
    const next = program.activities.find((candidate) => (
      candidate.activityCode === nextCode
    ));
    if (!next) return;
    invalidate();
    setActivityCode(next.activityCode);
    setInputs(nswDefaults(next));
    setSelectedProductIds({});
    setSelectedProductEligibleFrom({});
    setProductEvidenceError("");
    setDate(todayIso() < next.effectiveFrom ? next.effectiveFrom : todayIso());
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
          ...(requiredKinds.length > 0 ? { selectedProductIds } : {}),
        }),
      });
      if (requestRef.current === requestVersion) {
        setEstimate(result.estimate as GovernedEstimate);
      }
    } catch (caught) {
      if (requestRef.current === requestVersion) {
        setError(caught instanceof Error
          ? caught.message
          : "The NSW estimate could not be completed safely.");
      }
    } finally {
      if (requestRef.current === requestVersion) setBusy(false);
    }
  }

  return (
    <section className={styles.stcEstimator} aria-labelledby="nsw-estimator-title">
      <header>
        <div>
          <span>NSW | RULE-PINNED CERTIFICATE ESTIMATE</span>
          <h4 id="nsw-estimator-title">{program.name}</h4>
          <p>{program.sourceVersion}</p>
        </div>
        <strong>Certificate actions disabled</strong>
      </header>
      <form className={styles.estimatorForm} onSubmit={calculate}>
        <label>
          Activity
          <select value={activity.activityCode} onChange={(event) => chooseActivity(event.target.value)}>
            {program.activities.map((candidate) => (
              <option key={candidate.activityCode} value={candidate.activityCode}>
                {candidate.officialActivityCode} | {candidate.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Installation scenario
          <select value={activity.supportedScenario} disabled>
            <option value={activity.supportedScenario}>{activity.supportedScenario}</option>
          </select>
        </label>
        <label>
          Implementation date
          <input
            type="date"
            min={activity.effectiveFrom}
            max={activity.effectiveTo}
            required
            value={date}
            onChange={(event) => {
              invalidate();
              setDate(event.target.value);
              setSelectedProductIds({});
              setSelectedProductEligibleFrom({});
              setProductEvidenceError("");
            }}
          />
        </label>

        {requiredKinds.map((kind) => (
          <CreditexOfficialProductPicker
            key={`${activity.activityCode}:${date}:${kind}`}
            api={api}
            kind={kind}
            installationDate={date}
            selectedId={selectedProductIds[kind] || ""}
            onSelect={(id, product) => {
              invalidate();
              setSelectedProductIds((current) => ({ ...current, [kind]: id }));
              setSelectedProductEligibleFrom((current) => ({
                ...current,
                [kind]: product?.eligibleFrom || "",
              }));
              setProductEvidenceError("");
              if (!product) return;
              try {
                setInputs(stringInputs(deriveCreditexNswOfficialProductInputs(
                  program.programCode,
                  activity.activityCode,
                  inputs,
                  [product],
                )));
              } catch (caught) {
                setProductEvidenceError(caught instanceof Error
                  ? caught.message
                  : "The selected official product is not eligible for this activity.");
              }
            }}
          />
        ))}

        {unresolvedKinds.length > 0 && (
          <div className={styles.registryStatus} data-status="stale">
            <div>
              <span>Controlled product evidence required</span>
              <strong>{unresolvedKinds.join(", ").replaceAll("_", " ")}</strong>
              <small>
                No complete current NSW administrator or TESSA machine feed is
                mapped for this product class. Calculation and submission stay
                disabled; generic CER or CEC products are not accepted as a substitute.
              </small>
            </div>
          </div>
        )}

        {activity.inputDefinitions.map((definition) => (
          <label key={definition.key}>
            {definition.label}
            {definition.type === "select" ? (
              <select
                required
                disabled={officialProductInputKeys.has(definition.key)}
                value={inputs[definition.key] || ""}
                onChange={(event) => {
                  invalidate();
                  if (definition.key === "site_postcode") {
                    setSelectedProductIds({});
                    setSelectedProductEligibleFrom({});
                    setProductEvidenceError("");
                  }
                  setInputs((current) => ({
                    ...current,
                    [definition.key]: event.target.value,
                  }));
                }}
              >
                {definition.options?.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            ) : (
              <input
                inputMode={definition.type === "integer" ? "numeric" : "decimal"}
                required
                disabled={officialProductInputKeys.has(definition.key)}
                value={inputs[definition.key] || ""}
                onChange={(event) => {
                  invalidate();
                  if (definition.key === "site_postcode") {
                    setSelectedProductIds({});
                    setSelectedProductEligibleFrom({});
                    setProductEvidenceError("");
                  }
                  setInputs((current) => ({
                    ...current,
                    [definition.key]: event.target.value,
                  }));
                }}
              />
            )}
            <small>{definition.help}</small>
          </label>
        ))}
        {missingEligibilityStart && (
          <div className={styles.registryStatus} data-status="stale">
            <div>
              <span>Product approval date unavailable</span>
              <strong>Official registry refresh required</strong>
              <small>
                The selected row has no defensible approval start date in the
                active snapshot and cannot be used for a dated estimate.
              </small>
            </div>
          </div>
        )}
        {productEvidenceError && (
          <p className={styles.error} role="alert">{productEvidenceError}</p>
        )}
        <button
          type="submit"
          disabled={
            busy
            || registryBlocked
            || missingProduct
            || missingEligibilityStart
            || Boolean(productEvidenceError)
          }
        >
          {busy
            ? "Calculating..."
            : registryBlocked
              ? "Official NSW registry required"
              : missingEligibilityStart
                ? "Refresh official product registry"
                : productEvidenceError
                  ? "Choose an eligible official product"
                : missingProduct
              ? "Select approved products"
              : `Calculate ${activity.outputUnit} estimate`}
        </button>
      </form>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {estimate && <GovernedResult estimate={estimate} />}
    </section>
  );
}

function veuVisibleInput(
  definition: CreditexVeuActivityDefinition["inputDefinitions"][number],
  inputs: Record<string, string>,
) {
  if (!definition.showWhen) return true;
  const selected = inputs[definition.showWhen.key];
  if (definition.showWhen.oneOf) {
    return definition.showWhen.oneOf.includes(selected);
  }
  if (definition.showWhen.notOneOf) {
    return !definition.showWhen.notOneOf.includes(selected);
  }
  return true;
}

function veuNeedsPostcode(activity: CreditexVeuActivityDefinition) {
  return activity.inputDefinitions.some(
    (definition) => definition.source === "postcode_lookup",
  );
}

function applyVeuPostcode(
  activity: CreditexVeuActivityDefinition,
  inputs: Record<string, string>,
  postcode: string,
  installationDate: string,
) {
  if (!veuNeedsPostcode(activity)) return inputs;
  const resolution = resolveCreditexVeuPostcode({ postcode, installationDate });
  const next = { ...inputs };
  for (const definition of activity.inputDefinitions) {
    if (definition.source !== "postcode_lookup") continue;
    if (definition.key === "geography") next[definition.key] = resolution.geography;
    if (definition.key === "climate_zone") next[definition.key] = resolution.climateZone;
    if (definition.key === "climatic_region") next[definition.key] = resolution.climateRegion;
    if (definition.key === "location_class") next[definition.key] = resolution.locationClass;
  }
  return next;
}

function CreditexVeuCalculator({ api }: { api: Api }) {
  const firstActivity = CREDITEX_VEU_ACTIVITY_DEFINITIONS[0];
  const [activityCode, setActivityCode] = useState<string>(firstActivity.activityCode);
  const [date, setDate] = useState(todayIso());
  const [postcode, setPostcode] = useState("3000");
  const [postcodeError, setPostcodeError] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>(
    () => veuDefaults(firstActivity),
  );
  const [selectedProductIds, setSelectedProductIds] =
    useState<Record<string, string>>({});
  const [selectedProductEligibleFrom, setSelectedProductEligibleFrom] =
    useState<Record<string, string>>({});
  const [productEvidenceError, setProductEvidenceError] = useState("");
  const [estimate, setEstimate] = useState<GovernedEstimate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef(0);
  const activity = useMemo(
    () => CREDITEX_VEU_ACTIVITY_DEFINITIONS.find((candidate) => (
      candidate.activityCode === activityCode
    )) || firstActivity,
    [activityCode, firstActivity],
  );
  const registryBlocked = activity.productRegistry === "VEU";
  const requiredKinds = useMemo(
    () => officialProductKindsForVeuActivity(activity.activityCode),
    [activity.activityCode],
  );
  const missingProduct = requiredKinds.some((kind) => !selectedProductIds[kind]);
  const missingEligibilityStart = requiredKinds.some((kind) => (
    Boolean(selectedProductIds[kind]) && !selectedProductEligibleFrom[kind]
  ));
  const postcodeRequired = veuNeedsPostcode(activity);

  function invalidate() {
    requestRef.current += 1;
    setEstimate(null);
    setError("");
    setBusy(false);
  }

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestVersion = requestRef.current + 1;
    requestRef.current = requestVersion;
    setBusy(true);
    setError("");
    setEstimate(null);
    try {
      const visibleInputs = Object.fromEntries(
        activity.inputDefinitions
          .filter((definition) => veuVisibleInput(definition, inputs))
          .map((definition) => [definition.key, inputs[definition.key]]),
      );
      const result = await api("/api/creditex/program-estimates", {
        method: "POST",
        body: JSON.stringify({
          programCode: "VEU",
          activityCode: activity.activityCode,
          effectiveDate: date,
          inputs: visibleInputs,
          ...(postcodeRequired ? { postcode } : {}),
          ...(requiredKinds.length > 0 ? { selectedProductIds } : {}),
        }),
      });
      if (requestRef.current === requestVersion) {
        setEstimate(result.estimate as GovernedEstimate);
      }
    } catch (caught) {
      if (requestRef.current === requestVersion) {
        setError(caught instanceof Error
          ? caught.message
          : "The VEU estimate could not be completed safely.");
      }
    } finally {
      if (requestRef.current === requestVersion) setBusy(false);
    }
  }

  return (
    <section className={styles.stcEstimator} aria-labelledby="veu-estimator-title">
      <header>
        <div>
          <span>VIC | V24/V25 GOVERNED FORMULA ENGINE</span>
          <h4 id="veu-estimator-title">Victorian Energy Upgrades</h4>
          <p>{activity.sourcePages}</p>
        </div>
        <strong>Certificate actions disabled</strong>
      </header>
      {registryBlocked && (
        <div className={styles.registryStatus} data-status="stale">
          <div>
            <span>Formula implemented | registry connector required</span>
            <strong>{activity.productRegistry} approved-product evidence</strong>
            <small>
              The public VEU register is an unsupported embedded report. This
              activity stays fail-closed until a monitored immutable registry
              snapshot is connected. No product eligibility is guessed.
            </small>
          </div>
        </div>
      )}
      <form className={styles.estimatorForm} onSubmit={calculate}>
        <label>
          Activity
          <select
            value={activity.activityCode}
            onChange={(event) => {
              const next = CREDITEX_VEU_ACTIVITY_DEFINITIONS.find(
                (candidate) => candidate.activityCode === event.target.value,
              );
              if (!next) return;
              invalidate();
              setActivityCode(next.activityCode);
              try {
                setInputs(applyVeuPostcode(next, veuDefaults(next), postcode, date));
                setPostcodeError("");
              } catch (caught) {
                setInputs(veuDefaults(next));
                setPostcodeError(caught instanceof Error ? caught.message : "Postcode lookup failed.");
              }
              setSelectedProductIds({});
              setSelectedProductEligibleFrom({});
              setProductEvidenceError("");
            }}
          >
            {CREDITEX_VEU_ACTIVITY_DEFINITIONS.map((candidate) => (
              <option key={candidate.activityCode} value={candidate.activityCode}>
                {candidate.activityCode} | {candidate.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Installation date
          <input
            type="date"
            min="2026-06-30"
            max={todayIso()}
            required
            value={date}
            onChange={(event) => {
              invalidate();
              const nextDate = event.target.value;
              setDate(nextDate);
              setSelectedProductIds({});
              setSelectedProductEligibleFrom({});
              setProductEvidenceError("");
              try {
                setInputs((current) => applyVeuPostcode(
                  activity,
                  current,
                  postcode,
                  nextDate,
                ));
                setPostcodeError("");
              } catch (caught) {
                setPostcodeError(caught instanceof Error
                  ? caught.message
                  : "Postcode lookup failed.");
              }
            }}
          />
        </label>
        {postcodeRequired && (
          <label>
            Site postcode
            <input
              inputMode="numeric"
              maxLength={4}
              required
              value={postcode}
              onChange={(event) => {
                invalidate();
                const nextPostcode = event.target.value;
                setPostcode(nextPostcode);
                try {
                  setInputs((current) => applyVeuPostcode(
                    activity,
                    current,
                    nextPostcode,
                    date,
                  ));
                  setPostcodeError("");
                } catch (caught) {
                  setPostcodeError(caught instanceof Error
                    ? caught.message
                    : "Postcode lookup failed.");
                }
              }}
            />
            <small>Resolves the exact v24/v25 Table A geography, climate region and climate zone.</small>
            {postcodeError && <small className={styles.productRegistryError}>{postcodeError}</small>}
          </label>
        )}
        {requiredKinds.map((kind) => (
          <CreditexOfficialProductPicker
            key={`${activity.activityCode}:${date}:${kind}`}
            api={api}
            kind={kind}
            installationDate={date}
            selectedId={selectedProductIds[kind] || ""}
            onSelect={(id, product) => {
              invalidate();
              setSelectedProductIds((current) => ({ ...current, [kind]: id }));
              setSelectedProductEligibleFrom((current) => ({
                ...current,
                [kind]: product?.eligibleFrom || "",
              }));
              setProductEvidenceError("");
              if (!product) return;
              try {
                setInputs(stringInputs(deriveCreditexVeuOfficialProductInputs(
                  activity.activityCode,
                  inputs,
                  [product],
                )));
              } catch (caught) {
                setProductEvidenceError(caught instanceof Error
                  ? caught.message
                  : "The selected GEMS product is not eligible for this VEU activity.");
              }
            }}
          />
        ))}
        {activity.inputDefinitions.map((definition) => {
          if (!veuVisibleInput(definition, inputs)) return null;
          return (
            <label key={definition.key}>
              {definition.label}
              {definition.type === "select" ? (
                <select
                  required={definition.required}
                  disabled={
                    definition.source === "postcode_lookup"
                    || (
                      definition.source === "approved_product"
                      && requiredKinds.length > 0
                    )
                  }
                  value={inputs[definition.key] || ""}
                  onChange={(event) => {
                    invalidate();
                    setInputs((current) => ({
                      ...current,
                      [definition.key]: event.target.value,
                    }));
                  }}
                >
                  {definition.options?.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  inputMode="decimal"
                  required={definition.required}
                  value={inputs[definition.key] || ""}
                  onChange={(event) => {
                    invalidate();
                    setInputs((current) => ({
                      ...current,
                      [definition.key]: event.target.value,
                    }));
                  }}
                />
              )}
              <small>{definition.help}</small>
            </label>
          );
        })}
        {missingEligibilityStart && (
          <div className={styles.registryStatus} data-status="stale">
            <div>
              <span>Product approval date unavailable</span>
              <strong>Official registry refresh required</strong>
              <small>
                This GEMS row predates the first-seen preservation contract and
                cannot be used until the controlled registry is refreshed.
              </small>
            </div>
          </div>
        )}
        {productEvidenceError && (
          <p className={styles.error} role="alert">{productEvidenceError}</p>
        )}
        <button
          type="submit"
          disabled={
            busy
            || registryBlocked
            || missingProduct
            || missingEligibilityStart
            || Boolean(productEvidenceError)
            || Boolean(postcodeError)
          }
        >
          {busy
            ? "Calculating..."
            : registryBlocked
              ? "Approved-product registry required"
              : missingEligibilityStart
                ? "Refresh official product registry"
                : productEvidenceError
                  ? "Choose an eligible official product"
              : missingProduct
                ? "Select approved product"
                : "Calculate VEEC estimate"}
        </button>
      </form>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {estimate && <GovernedResult estimate={estimate} />}
    </section>
  );
}

export function CreditexGovernedProgramCalculator({
  api,
  programCode,
}: {
  api: Api;
  programCode: "VEU" | "NSW-PDRS-2026" | "NSW-ESS-2026";
}) {
  if (programCode === "VEU") return <CreditexVeuCalculator api={api} />;
  const program = nswProgram(programCode);
  return program ? <CreditexNswCalculator api={api} program={program} /> : null;
}
