"use client";

import {
  useCallback,
  useMemo,
  useReducer,
  useRef,
  useState,
  type FormEvent,
} from "react";
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
  CREDITEX_PRODUCT_KIND_REGISTRY,
  officialProductKindsForNswProductKinds,
  officialProductKindsForVeuActivity,
  officialProductInputKeysForNswActivity,
  officialVeuProductCategoryNumbersForActivity,
  unresolvedNswProductKinds,
  type CreditexOfficialProductKind,
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

export type CreditexGovernedEstimate = {
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
    unitQuantity?: string;
    perUnit?: {
      unroundedTonnes: string;
      wholeCertificates: string | null;
      unit: "VEEC";
    };
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

export type CreditexPart6IndoorUnit = {
  id: string;
  label: string;
  model: string;
  quantity: string;
  heatingCapacityKw: string;
  coolingCapacityKw: string;
};

const INITIAL_PART_6_INDOOR_UNITS: CreditexPart6IndoorUnit[] = [{
  id: "indoor-unit-1",
  label: "",
  model: "",
  quantity: "1",
  heatingCapacityKw: "3.5",
  coolingCapacityKw: "3.5",
}];

export function creditexPart6IndoorCapacityTotals(
  units: readonly CreditexPart6IndoorUnit[],
) {
  let quantity = 0;
  let heatingCapacityKw = 0;
  let coolingCapacityKw = 0;
  let complete = units.length > 0;
  for (const unit of units) {
    const rowQuantity = Number(unit.quantity);
    const heating = Number(unit.heatingCapacityKw);
    const cooling = Number(unit.coolingCapacityKw);
    if (
      !Number.isInteger(rowQuantity)
      || rowQuantity < 1
      || !Number.isFinite(heating)
      || heating <= 0
      || !Number.isFinite(cooling)
      || cooling <= 0
    ) {
      complete = false;
      continue;
    }
    quantity += rowQuantity;
    heatingCapacityKw += rowQuantity * heating;
    coolingCapacityKw += rowQuantity * cooling;
  }
  return { complete, quantity, heatingCapacityKw, coolingCapacityKw };
}

const CREDITEX_QUOTE_EVIDENCE_KEYS = /(?:^nsw_site_confirmed$|^payment_exemption$|all_non_formula|_confirmed$|_evidence(?:_|$)|fact_sheet|suitability|warranty|co_payment|decommission|disposal|eligibility_requirements|removal_requirements|as_nzs_2712_status)/;

export function creditexQuoteEvidenceInput(key: string) {
  return CREDITEX_QUOTE_EVIDENCE_KEYS.test(key);
}

function creditexQuoteContextInput(key: string) {
  return /(?:postcode|premises|sector|distribution_network)/.test(key);
}

function outputQuantity(estimate: CreditexGovernedEstimate) {
  if (estimate.output.quantity !== undefined) return estimate.output.quantity;
  return estimate.output.wholeCertificates ?? estimate.output.unroundedTonnes ?? "";
}

function traceOutput(
  output: CreditexGovernedEstimate["trace"][number]["output"],
  fallbackUnit = "",
) {
  if (typeof output === "string") return `${output} ${fallbackUnit}`.trim();
  return `${output.decimal} ${output.unit}`.trim();
}

function GovernedResult({ estimate }: { estimate: CreditexGovernedEstimate }) {
  return (
    <section className={styles.estimateResult} aria-live="polite">
      <header>
        <div>
          <span>{estimate.output.label || "Estimated whole certificates"}</span>
          <strong>{outputQuantity(estimate)} {estimate.output.unit}</strong>
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
          {estimate.output.unitQuantity && estimate.output.perUnit && (
            <span>
              {estimate.output.perUnit.wholeCertificates
                ?? estimate.output.perUnit.unroundedTonnes} VEEC per system x {estimate.output.unitQuantity} systems
            </span>
          )}
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
              <b>{traceOutput(step.output, step.unit)}</b>
            </li>
          ))}
        </ol>
        {estimate.approvedProducts && estimate.approvedProducts.length > 0 && (
          <p>
            {estimate.approvedProducts.map(creditexProductOptionLabel).join("; ")}
          </p>
        )}
        <p>{estimate.operatorMessage}</p>
        <footer>
          <a href={estimate.officialSourceUrl} target="_blank" rel="noreferrer">
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

function CreditexNswCalculator({
  api,
  program,
  onEstimate,
}: {
  api: Api;
  program: CreditexNswProgramDefinition;
  onEstimate?: (estimate: CreditexGovernedEstimate) => void;
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
  const [estimate, setEstimate] = useState<CreditexGovernedEstimate | null>(null);
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
          estimatePurpose: "quote",
          programCode: program.programCode,
          activityCode: activity.activityCode,
          effectiveDate: date,
          inputs,
          ...(requiredKinds.length > 0 ? { selectedProductIds } : {}),
        }),
      });
      if (requestRef.current === requestVersion) {
        const nextEstimate = result.estimate as CreditexGovernedEstimate;
        setEstimate(nextEstimate);
        onEstimate?.(nextEstimate);
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

  function renderNswInput(
    definition: CreditexNswActivityDefinition["inputDefinitions"][number],
  ) {
    return (
      <label key={definition.key}>
        {definition.label}
        {definition.type === "select" ? (
          <select
            required
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
        {!creditexQuoteContextInput(definition.key) && (
          <small>{definition.help}</small>
        )}
      </label>
    );
  }

  const quoteInputs = activity.inputDefinitions.filter(
    (definition) => !officialProductInputKeys.has(definition.key),
  );
  const contextInputs = quoteInputs.filter(
    (definition) => creditexQuoteContextInput(definition.key),
  );
  const formulaInputs = quoteInputs.filter((definition) => (
    !creditexQuoteContextInput(definition.key)
    && !creditexQuoteEvidenceInput(definition.key)
  ));
  const evidenceInputs = quoteInputs.filter(
    (definition) => creditexQuoteEvidenceInput(definition.key),
  );

  return (
    <section className={styles.stcEstimator} aria-labelledby="nsw-estimator-title">
      <header>
        <div>
          <span>NSW REBATE ESTIMATE</span>
          <h4 id="nsw-estimator-title">{program.name}</h4>
          <small>Estimate only. Final eligibility is checked before certificate creation.</small>
        </div>
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
          Installation date
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

        <p><strong>Scenario:</strong> {activity.supportedScenario}</p>

        {contextInputs.map(renderNswInput)}

        {requiredKinds.map((kind) => (
          <CreditexOfficialProductPicker
            key={`${activity.activityCode}:${inputs.scenario || ""}:${date}:${kind}`}
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

        {formulaInputs.map(renderNswInput)}
        {(evidenceInputs.length > 0 || unresolvedKinds.length > 0) && (
          <details>
            <summary>Eligibility and evidence</summary>
            <p>
              Keep the product, invoice and installation records for the final
              eligibility check. These checks are not needed to calculate a quote.
            </p>
          </details>
        )}
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
          disabled={busy}
        >
          {busy ? "Calculating..." : "Calculate rebate estimate"}
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

export function creditexVeuQuoteInputVisible(
  definition: CreditexVeuActivityDefinition["inputDefinitions"][number],
  inputs: Record<string, string>,
) {
  if (!veuVisibleInput(definition, inputs)) return false;
  if (
    inputs.configuration === "multi"
    && (
      definition.key === "rated_heating_capacity_kw"
      || definition.key === "rated_cooling_capacity_kw"
    )
  ) {
    return false;
  }
  if (definition.source === "operator") return true;
  return definition.quoteSource === "operator"
    && inputs.configuration === "multi";
}

function creditexVeuQuoteInputLabel(
  activityCode: string,
  definition: CreditexVeuActivityDefinition["inputDefinitions"][number],
  scenario: string,
) {
  if (definition.key === "scenario") {
    return activityCode === "15"
      ? "What are you sealing?"
      : "Installation scenario";
  }
  if (activityCode !== "15") return definition.label;
  if (definition.key === "area_m2") return "Total window area being sealed (m2)";
  if (definition.key !== "installation_count") return definition.label;
  return ({
    "15A": "Number of external doors",
    "15C": "Number of self-closing sealed exhaust fans",
    "15D": "Number of existing exhaust fans fitted with a damper or seal",
    "15E": "Number of external wall vents",
    "15F": "Number of permanent chimney or flue seals",
    "15G": "Number of temporary or seasonal chimney or flue seals",
    "15H": "Number of evaporative-cooling ceiling outlets",
  } as Readonly<Record<string, string>>)[scenario] || "Number installed";
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
    if (definition.key === "gas_reticulation") {
      next[definition.key] = resolution.gasReticulated
        ? "reticulated"
        : "not_reticulated";
    }
    if (definition.key === "climate_zone") next[definition.key] = resolution.climateZone;
    if (definition.key === "climatic_region") next[definition.key] = resolution.climateRegion;
    if (definition.key === "location_class") next[definition.key] = resolution.locationClass;
  }
  return next;
}

type SelectedVeuProducts = Partial<
  Record<CreditexOfficialProductKind, CreditexOfficialProductOption>
>;

type CreditexVeuProductUiState = {
  selectedProducts: SelectedVeuProducts;
  registryIssue: string;
  evidenceError: string;
};

type CreditexVeuProductUiAction =
  | {
      type: "identity_changed";
      reason: "activity" | "installation_date" | "postcode" | "registry_snapshot" | "scenario";
      issue?: string;
    }
  | {
      type: "product_selected";
      kind: CreditexOfficialProductKind;
      product: CreditexOfficialProductOption | null;
    }
  | { type: "registry_current" }
  | { type: "evidence_invalid"; issue: string };

function initialVeuProductUiState(): CreditexVeuProductUiState {
  return { selectedProducts: {}, registryIssue: "", evidenceError: "" };
}

export function creditexVeuProductUiReducer(
  state: CreditexVeuProductUiState,
  action: CreditexVeuProductUiAction,
): CreditexVeuProductUiState {
  if (action.type === "identity_changed") {
    return {
      selectedProducts: {},
      registryIssue: action.issue || "",
      evidenceError: "",
    };
  }
  if (action.type === "registry_current") {
    if (!state.registryIssue) return state;
    return { ...state, registryIssue: "" };
  }
  if (action.type === "evidence_invalid") {
    return { ...state, evidenceError: action.issue };
  }
  const selectedProducts = { ...state.selectedProducts };
  if (action.product) selectedProducts[action.kind] = action.product;
  else delete selectedProducts[action.kind];
  return {
    selectedProducts,
    registryIssue: action.product ? "" : state.registryIssue,
    evidenceError: "",
  };
}

function exactRegistryDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

export const CREDITEX_VEU_UI_SOURCE_COMPLETE_ACTIVITY_CODES = [
  "1C",
  "1D",
  "3C",
  "3D",
  "6",
  "13",
  "15",
  "17",
  "22",
  "24",
  "25",
  "26",
  "27",
  "30",
  "31",
  "33",
  "34",
  "35",
  "36",
  "37",
  "38",
  "39",
  "40",
  "41",
  "42",
  "43",
  "44",
  "46",
  "48",
] as const;

export function creditexVeuActivitySourceComplete(activityCode: string) {
  return (CREDITEX_VEU_UI_SOURCE_COMPLETE_ACTIVITY_CODES as readonly string[])
    .includes(activityCode);
}

export function creditexVeuShouldApplyProductResponse(
  requestGeneration: number,
  currentGeneration: number,
) {
  return requestGeneration === currentGeneration;
}

export function creditexVeuRegistryCodeForProductKind(productKind: string) {
  const registryCode = CREDITEX_PRODUCT_KIND_REGISTRY[
    productKind as CreditexOfficialProductKind
  ];
  return registryCode === "veu-approved-products" || registryCode === "gems-products"
    ? registryCode
    : "";
}

export function creditexVeuProductEvidenceState(
  activityCode: string,
  installationDate: string,
  selectedProducts: Readonly<SelectedVeuProducts>,
  registryIssue = "",
  scenario?: string,
) {
  const requiredKinds = officialProductKindsForVeuActivity(
    activityCode,
    scenario,
  );
  const selectedProductIds: Record<string, string> = {};
  const completeSelections: CreditexOfficialProductOption[] = [];
  let issue = registryIssue;
  let missingProduct = false;
  const permittedCategories = officialVeuProductCategoryNumbersForActivity(
    activityCode,
    scenario,
  );

  if (!issue && !exactRegistryDate(installationDate)) {
    issue = "Choose a valid installation date before selecting a VEU Public Registry model.";
  }

  for (const kind of requiredKinds) {
    const product = selectedProducts[kind];
    if (!product) {
      missingProduct = true;
      continue;
    }
    selectedProductIds[kind] = product.id;
    completeSelections.push(product);
    const gemsMotor = activityCode === "31" && kind === "electric_motor";
    if (issue) continue;
    if (
      !product.id
      || product.productKind !== kind
      || !product.model.trim()
      || !product.registrationNumber.trim()
    ) {
      issue = "The selected VEU product identity is incomplete or does not match this activity. Select the exact installation-date-eligible VEU Public Registry model again.";
      continue;
    }
    if (
      (
        gemsMotor
          ? product.registryCode !== "gems-products"
            || product.approvalStatus !== "approved"
          : product.registryCode !== "veu-approved-products"
            || (
              product.approvalStatus !== "approved"
              && product.approvalStatus !== "legacy"
            )
      )
      || !product.snapshotId
      || !/^[a-f0-9]{64}$/.test(product.sourceSha256)
    ) {
      issue = gemsMotor
        ? "The selected motor is not pinned to a current GEMS registration. Refresh GEMS and select it again."
        : "The selected model is not pinned to a VEU Public Registry approval record. Refresh the VEU registry and select it again.";
      continue;
    }
    if (!exactRegistryDate(product.eligibleFrom)) {
      issue = "The selected VEU Public Registry model has no defensible Effective From date.";
      continue;
    }
    if (product.approvalStatus === "legacy" && !product.eligibleTo) {
      issue = "The selected historical VEU Public Registry model has no defensible Effective To date.";
      continue;
    }
    if (product.eligibleTo && !exactRegistryDate(product.eligibleTo)) {
      issue = "The selected VEU Public Registry model has an invalid Effective To date.";
      continue;
    }
    if (
      installationDate < product.eligibleFrom
      || (product.eligibleTo && installationDate > product.eligibleTo)
    ) {
      issue = "The selected VEU Public Registry model is outside its installation-date approval window.";
      continue;
    }
    if (!gemsMotor) {
      const category = product.attributes.veuProductCategoryNumber;
      if (
        typeof category !== "string"
        || !permittedCategories.includes(category)
      ) {
        issue = `The selected VEU product category does not match activity ${activityCode}.`;
      }
    }
  }

  return {
    requiredKinds,
    selectedProductIds,
    completeSelections,
    missingProduct,
    issue,
    blocked: Boolean(issue) || missingProduct,
  } as const;
}

function resetVeuApprovedProductInputs(
  activity: CreditexVeuActivityDefinition,
  current: Record<string, string>,
) {
  const defaults = veuDefaults(activity);
  const next = { ...current };
  for (const definition of activity.inputDefinitions) {
    if (definition.source === "approved_product") {
      next[definition.key] = defaults[definition.key];
    }
  }
  return next;
}

function CreditexVeuCalculator({
  api,
  onEstimate,
}: {
  api: Api;
  onEstimate?: (estimate: CreditexGovernedEstimate) => void;
}) {
  const firstActivity = CREDITEX_VEU_ACTIVITY_DEFINITIONS[0];
  const [activityCode, setActivityCode] = useState<string>(firstActivity.activityCode);
  const [date, setDate] = useState(todayIso());
  const [postcode, setPostcode] = useState("3000");
  const [postcodeError, setPostcodeError] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>(
    () => veuDefaults(firstActivity),
  );
  const [part6IndoorUnits, setPart6IndoorUnits] = useState<
    CreditexPart6IndoorUnit[]
  >(INITIAL_PART_6_INDOOR_UNITS);
  const part6IndoorUnitIdRef = useRef(1);
  const [productUiState, dispatchProductUi] = useReducer(
    creditexVeuProductUiReducer,
    undefined,
    initialVeuProductUiState,
  );
  const selectedProducts = productUiState.selectedProducts;
  const selectedProductsRef = useRef<SelectedVeuProducts>({});
  const registrySnapshotIdsRef = useRef<Record<string, string>>({});
  const productIdentityGenerationRef = useRef(0);
  const productRegistryIssue = productUiState.registryIssue;
  const productEvidenceError = productUiState.evidenceError;
  const [estimate, setEstimate] = useState<CreditexGovernedEstimate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [productPickerRevision, setProductPickerRevision] = useState(0);
  const requestRef = useRef(0);
  const activity = useMemo(
    () => CREDITEX_VEU_ACTIVITY_DEFINITIONS.find((candidate) => (
      candidate.activityCode === activityCode
    )) || firstActivity,
    [activityCode, firstActivity],
  );
  const activitySourceComplete = creditexVeuActivitySourceComplete(
    activity.activityCode,
  );
  const activitySourceIssue = activitySourceComplete
    ? ""
    : `Activity ${activity.activityCode} remains unavailable because every formula-critical approved-product attribute has not yet been normalized from the VEU Public Registry.`;
  const productEvidence = useMemo(
    () => creditexVeuProductEvidenceState(
      activity.activityCode,
      date,
      selectedProducts,
      productRegistryIssue || activitySourceIssue,
      inputs.scenario,
    ),
    [
      activity.activityCode,
      activitySourceIssue,
      date,
      productRegistryIssue,
      selectedProducts,
      inputs.scenario,
    ],
  );
  const requiredKinds = productEvidence.requiredKinds;
  const operatorScenario = activity.inputDefinitions.some((definition) => (
    definition.key === "scenario" && definition.source === "operator"
  ))
    ? inputs.scenario
    : "";
  const productContractScenario = ["15", "27", "34", "35", "48"].includes(
    activity.activityCode,
  )
    ? operatorScenario
    : "";
  const postcodeRequired = veuNeedsPostcode(activity);
  const part6IndoorTotals = useMemo(
    () => creditexPart6IndoorCapacityTotals(part6IndoorUnits),
    [part6IndoorUnits],
  );

  const invalidate = useCallback(() => {
    requestRef.current += 1;
    setEstimate(null);
    setError("");
    setBusy(false);
  }, []);

  const clearProductEvidence = useCallback((issue = "") => {
    invalidate();
    productIdentityGenerationRef.current += 1;
    selectedProductsRef.current = {};
    dispatchProductUi({
      type: "identity_changed",
      reason: "registry_snapshot",
      issue,
    });
    setInputs((current) => resetVeuApprovedProductInputs(activity, current));
  }, [activity, invalidate]);

  const officialProductApi = useCallback(async (
    path: string,
    init?: RequestInit,
  ) => {
    const requestGeneration = productIdentityGenerationRef.current;
    const kind = new URL(path, "https://creditex.invalid")
      .searchParams.get("productKind") || "";
    const expectedRegistryCode = creditexVeuRegistryCodeForProductKind(kind);
    const registryLabel = expectedRegistryCode === "gems-products"
      ? "GEMS product register"
      : "VEU Public Registry";
    try {
      const result = await api(path, init);
      if (!creditexVeuShouldApplyProductResponse(
        requestGeneration,
        productIdentityGenerationRef.current,
      )) {
        const superseded = new Error("The product request identity changed.");
        superseded.name = "AbortError";
        throw superseded;
      }
      const registry = result.registry as Record<string, unknown> | undefined;
      const registryCode = String(registry?.registryCode || "");
      const registryStatus = String(registry?.status || "");
      const snapshotId = String(registry?.snapshotId || "");
      if (
        !expectedRegistryCode
        || registryCode !== expectedRegistryCode
        || registryStatus !== "current"
        || !snapshotId
      ) {
        throw new Error(
          `The current ${registryLabel} snapshot is stale or unavailable.`,
        );
      }
      const previousSnapshotId = registrySnapshotIdsRef.current[kind];
      registrySnapshotIdsRef.current[kind] = snapshotId;
      if (previousSnapshotId && previousSnapshotId !== snapshotId) {
        setProductPickerRevision((current) => current + 1);
        clearProductEvidence(
          `The ${registryLabel} snapshot changed. Select the exact installation-date-eligible model again.`,
        );
      } else {
        dispatchProductUi({ type: "registry_current" });
      }
      return result;
    } catch (caught) {
      if (!creditexVeuShouldApplyProductResponse(
        requestGeneration,
        productIdentityGenerationRef.current,
      )) {
        throw caught;
      }
      const message = caught instanceof Error
        ? caught.message
        : `The current ${registryLabel} snapshot is unavailable.`;
      clearProductEvidence(message);
      throw caught;
    }
  }, [api, clearProductEvidence]);

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestVersion = requestRef.current + 1;
    requestRef.current = requestVersion;
    setBusy(true);
    setError("");
    setEstimate(null);
    try {
      const visibleInputs: Record<string, unknown> = Object.fromEntries(
        activity.inputDefinitions
          .filter((definition) => veuVisibleInput(definition, inputs))
          .map((definition) => [definition.key, inputs[definition.key]]),
      );
      if (activity.activityCode === "6" && inputs.configuration === "multi") {
        delete visibleInputs.rated_heating_capacity_kw;
        delete visibleInputs.rated_cooling_capacity_kw;
        visibleInputs.indoor_units = part6IndoorUnits.map((unit) => ({
          label: unit.label,
          model: unit.model,
          quantity: unit.quantity,
          heatingCapacityKw: unit.heatingCapacityKw,
          coolingCapacityKw: unit.coolingCapacityKw,
        }));
      }
      const result = await api("/api/creditex/program-estimates", {
        method: "POST",
        body: JSON.stringify({
          estimatePurpose: "quote",
          programCode: "VEU",
          activityCode: activity.activityCode,
          effectiveDate: date,
          inputs: visibleInputs,
          ...(postcodeRequired ? { postcode } : {}),
          ...(requiredKinds.length > 0
            ? { selectedProductIds: productEvidence.selectedProductIds }
            : {}),
        }),
      });
      if (requestRef.current === requestVersion) {
        const nextEstimate = result.estimate as CreditexGovernedEstimate;
        setEstimate(nextEstimate);
        onEstimate?.(nextEstimate);
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

  function updatePart6IndoorUnit(
    id: string,
    key: Exclude<keyof CreditexPart6IndoorUnit, "id">,
    value: string,
  ) {
    invalidate();
    setPart6IndoorUnits((current) => current.map((unit) => (
      unit.id === id ? { ...unit, [key]: value } : unit
    )));
  }

  function addPart6IndoorUnit() {
    invalidate();
    part6IndoorUnitIdRef.current += 1;
    const id = `indoor-unit-${part6IndoorUnitIdRef.current}`;
    setPart6IndoorUnits((current) => current.length >= 20
      ? current
      : [
          ...current,
          {
            id,
            label: "",
            model: "",
            quantity: "1",
            heatingCapacityKw: "3.5",
            coolingCapacityKw: "3.5",
          },
        ]);
  }

  function removePart6IndoorUnit(id: string) {
    invalidate();
    setPart6IndoorUnits((current) => current.length <= 1
      ? current
      : current.filter((unit) => unit.id !== id));
  }

  function renderVeuInput(
    definition: CreditexVeuActivityDefinition["inputDefinitions"][number],
  ) {
    if (!creditexVeuQuoteInputVisible(definition, inputs)) return null;
    return (
      <label key={definition.key}>
        {creditexVeuQuoteInputLabel(
          activity.activityCode,
          definition,
          inputs.scenario,
        )}
        {definition.type === "select" ? (
          <select
            required={definition.required}
            value={inputs[definition.key] || ""}
            onChange={(event) => {
              invalidate();
              if (
                definition.key === "scenario"
                && ["15", "27", "34", "35", "48"].includes(
                  activity.activityCode,
                )
              ) {
                productIdentityGenerationRef.current += 1;
                selectedProductsRef.current = {};
                registrySnapshotIdsRef.current = {};
                dispatchProductUi({
                  type: "identity_changed",
                  reason: "scenario",
                });
                const scenario = event.target.value;
                setInputs((current) => ({
                  ...resetVeuApprovedProductInputs(activity, current),
                  scenario,
                }));
                return;
              }
              if (
                definition.key === "premises"
                && !productEvidence.blocked
                && productEvidence.completeSelections.length > 0
              ) {
                try {
                  setInputs(stringInputs(deriveCreditexVeuOfficialProductInputs(
                    activity.activityCode,
                    { ...inputs, premises: event.target.value },
                    productEvidence.completeSelections,
                  )));
                  return;
                } catch (caught) {
                  dispatchProductUi({
                    type: "evidence_invalid",
                    issue: caught instanceof Error
                      ? caught.message
                      : "The approved product could not be resolved for this premises type.",
                  });
                }
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
            inputMode="decimal"
            min={definition.min}
            max={definition.max}
            step={definition.step}
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
        {definition.key !== "scenario"
          && !creditexQuoteContextInput(definition.key) && (
          <small>{definition.help}</small>
        )}
      </label>
    );
  }

  const operatorInputs = activity.inputDefinitions.filter((definition) => (
    creditexVeuQuoteInputVisible(definition, inputs)
  ));
  const scenarioInputs = operatorInputs.filter(
    (definition) => definition.key === "scenario",
  );
  const contextInputs = operatorInputs.filter((definition) => (
    definition.key !== "scenario"
    && creditexQuoteContextInput(definition.key)
  ));
  const formulaInputs = operatorInputs.filter((definition) => (
    definition.key !== "scenario"
    && !creditexQuoteContextInput(definition.key)
    && !creditexQuoteEvidenceInput(definition.key)
  ));
  const evidenceInputs = operatorInputs.filter(
    (definition) => creditexQuoteEvidenceInput(definition.key),
  );

  return (
    <section className={styles.stcEstimator} aria-labelledby="veu-estimator-title">
      <header>
        <div>
          <span>VICTORIAN REBATE ESTIMATE</span>
          <h4 id="veu-estimator-title">Victorian Energy Upgrades</h4>
          <small>Estimate only. Final eligibility is checked before certificate creation.</small>
        </div>
      </header>
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
              if (next.activityCode === "6") {
                part6IndoorUnitIdRef.current = 1;
                setPart6IndoorUnits(INITIAL_PART_6_INDOOR_UNITS);
              }
              try {
                setInputs(applyVeuPostcode(next, veuDefaults(next), postcode, date));
                setPostcodeError("");
              } catch (caught) {
                setInputs(veuDefaults(next));
                setPostcodeError(caught instanceof Error ? caught.message : "Postcode lookup failed.");
              }
              productIdentityGenerationRef.current += 1;
              selectedProductsRef.current = {};
              registrySnapshotIdsRef.current = {};
              dispatchProductUi({
                type: "identity_changed",
                reason: "activity",
              });
            }}
          >
            {CREDITEX_VEU_ACTIVITY_DEFINITIONS.map((candidate) => (
              <option key={candidate.activityCode} value={candidate.activityCode}>
                {candidate.activityCode} | {candidate.title}
              </option>
            ))}
          </select>
        </label>
        {scenarioInputs.map(renderVeuInput)}
        <label>
          Installation date
          <input
            type="date"
            min="2026-06-30"
            required
            value={date}
            onChange={(event) => {
              invalidate();
              const nextDate = event.target.value;
              setDate(nextDate);
              productIdentityGenerationRef.current += 1;
              selectedProductsRef.current = {};
              registrySnapshotIdsRef.current = {};
              dispatchProductUi({
                type: "identity_changed",
                reason: "installation_date",
              });
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
        {requiredKinds.map((kind) => (
          <CreditexOfficialProductPicker
            key={`${activity.activityCode}:${productContractScenario}:${date}:${kind}:${productPickerRevision}`}
            api={officialProductApi}
            kind={kind}
            installationDate={date}
            veuActivityCode={
              creditexVeuRegistryCodeForProductKind(kind) === "veu-approved-products"
                ? activity.activityCode
                : undefined
            }
            veuScenario={
              creditexVeuRegistryCodeForProductKind(kind) === "veu-approved-products"
                ? productContractScenario
                : undefined
            }
            selectedId={selectedProducts[kind]?.id || ""}
            onSelect={(id, product) => {
              invalidate();
              productIdentityGenerationRef.current += 1;
              const nextProducts = { ...selectedProductsRef.current };
              if (id && product) nextProducts[kind] = product;
              else delete nextProducts[kind];
              selectedProductsRef.current = nextProducts;
              dispatchProductUi({
                type: "product_selected",
                kind,
                product,
              });
              if (!product) {
                setInputs((current) => (
                  resetVeuApprovedProductInputs(activity, current)
                ));
                return;
              }
              const nextEvidence = creditexVeuProductEvidenceState(
                activity.activityCode,
                date,
                nextProducts,
                "",
                inputs.scenario,
              );
              if (nextEvidence.issue || nextEvidence.missingProduct) {
                return;
              }
              try {
                setInputs(stringInputs(deriveCreditexVeuOfficialProductInputs(
                  activity.activityCode,
                  inputs,
                  nextEvidence.completeSelections,
                )));
              } catch (caught) {
                dispatchProductUi({
                  type: "evidence_invalid",
                  issue: caught instanceof Error
                    ? caught.message
                    : "The selected installation-date-eligible VEU Public Registry model is not eligible for this activity.",
                });
              }
            }}
          />
        ))}
        {activity.activityCode === "6" && inputs.configuration === "multi" && (
          <fieldset className={styles.officialProductPicker}>
            <legend>Connected indoor units</legend>
            <p>
              Add each indoor-unit type once, then enter how many are connected.
              The calculator totals their heating and cooling capacity and applies
              the approved outdoor-unit and formula caps automatically.
            </p>
            {part6IndoorUnits.map((unit, index) => (
              <fieldset key={unit.id}>
                <legend>Indoor unit {index + 1}</legend>
                <label>
                  Room or label (optional)
                  <input
                    maxLength={80}
                    value={unit.label}
                    onChange={(event) => updatePart6IndoorUnit(
                      unit.id,
                      "label",
                      event.target.value,
                    )}
                  />
                </label>
                <label>
                  Indoor model (optional)
                  <input
                    maxLength={80}
                    value={unit.model}
                    onChange={(event) => updatePart6IndoorUnit(
                      unit.id,
                      "model",
                      event.target.value,
                    )}
                  />
                </label>
                <label>
                  Quantity
                  <input
                    inputMode="numeric"
                    pattern="[0-9]+"
                    min="1"
                    max="20"
                    required
                    value={unit.quantity}
                    onChange={(event) => updatePart6IndoorUnit(
                      unit.id,
                      "quantity",
                      event.target.value.replace(/\D/g, "").slice(0, 2),
                    )}
                  />
                </label>
                <label>
                  Heating capacity each (kW)
                  <input
                    inputMode="decimal"
                    required
                    value={unit.heatingCapacityKw}
                    onChange={(event) => updatePart6IndoorUnit(
                      unit.id,
                      "heatingCapacityKw",
                      event.target.value,
                    )}
                  />
                </label>
                <label>
                  Cooling capacity each (kW)
                  <input
                    inputMode="decimal"
                    required
                    value={unit.coolingCapacityKw}
                    onChange={(event) => updatePart6IndoorUnit(
                      unit.id,
                      "coolingCapacityKw",
                      event.target.value,
                    )}
                  />
                </label>
                {part6IndoorUnits.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removePart6IndoorUnit(unit.id)}
                  >
                    Remove indoor unit
                  </button>
                )}
              </fieldset>
            ))}
            <button
              type="button"
              disabled={part6IndoorUnits.length >= 20}
              onClick={addPart6IndoorUnit}
            >
              Add another indoor unit
            </button>
            <p aria-live="polite">
              {part6IndoorTotals.complete
                ? `Connected total: ${part6IndoorTotals.quantity} units, ${part6IndoorTotals.heatingCapacityKw.toLocaleString("en-AU", { maximumFractionDigits: 3 })} kW heating and ${part6IndoorTotals.coolingCapacityKw.toLocaleString("en-AU", { maximumFractionDigits: 3 })} kW cooling.`
                : "Complete every quantity, heating and cooling field to calculate the connected total."}
            </p>
          </fieldset>
        )}
        {postcodeRequired && (
          <label>
            Postcode
            <input
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              required
              value={postcode}
              onChange={(event) => {
                invalidate();
                const nextPostcode = event.target.value
                  .replace(/\D/g, "")
                  .slice(0, 4);
                setPostcode(nextPostcode);
                try {
                  let nextInputs = applyVeuPostcode(
                    activity,
                    inputs,
                    nextPostcode,
                    date,
                  );
                  if (
                    !productEvidence.blocked
                    && productEvidence.completeSelections.length > 0
                  ) {
                    nextInputs = stringInputs(
                      deriveCreditexVeuOfficialProductInputs(
                        activity.activityCode,
                        nextInputs,
                        productEvidence.completeSelections,
                      ),
                    );
                  }
                  setInputs(nextInputs);
                  setPostcodeError("");
                } catch (caught) {
                  setPostcodeError(caught instanceof Error
                    ? caught.message
                    : "Postcode lookup failed.");
                }
              }}
            />
            {postcodeError && <small className={styles.productRegistryError}>{postcodeError}</small>}
          </label>
        )}
        {contextInputs.map(renderVeuInput)}
        {formulaInputs.map(renderVeuInput)}
        {evidenceInputs.length > 0 && (
          <details>
            <summary>Eligibility and evidence</summary>
            <p>
              Keep the product, invoice and installation records for the final
              eligibility check. These checks are not needed to calculate a quote.
            </p>
          </details>
        )}
        {productEvidence.issue && (
          <p className={styles.error} role="alert">{productEvidence.issue}</p>
        )}
        {productEvidenceError && (
          <p className={styles.error} role="alert">{productEvidenceError}</p>
        )}
        <button
          type="submit"
          disabled={busy}
        >
          {busy ? "Calculating..." : "Calculate rebate estimate"}
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
  onEstimate,
}: {
  api: Api;
  programCode: "VEU" | "NSW-PDRS-2026" | "NSW-ESS-2026";
  onEstimate?: (estimate: CreditexGovernedEstimate) => void;
}) {
  if (programCode === "VEU") {
    return <CreditexVeuCalculator api={api} onEstimate={onEstimate} />;
  }
  const program = nswProgram(programCode);
  return program ? (
    <CreditexNswCalculator
      api={api}
      program={program}
      onEstimate={onEstimate}
    />
  ) : null;
}
