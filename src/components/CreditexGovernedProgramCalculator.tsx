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
      reason: "activity" | "installation_date" | "postcode" | "registry_snapshot";
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
  "17",
  "22",
  "24",
  "25",
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

export function creditexVeuProductEvidenceState(
  activityCode: string,
  installationDate: string,
  selectedProducts: Readonly<SelectedVeuProducts>,
  registryIssue = "",
) {
  const requiredKinds = officialProductKindsForVeuActivity(activityCode);
  const selectedProductIds: Record<string, string> = {};
  const completeSelections: CreditexOfficialProductOption[] = [];
  let issue = registryIssue;
  let missingProduct = false;
  const permittedCategories = officialVeuProductCategoryNumbersForActivity(
    activityCode,
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
      product.registryCode !== "veu-approved-products"
      || (
        product.approvalStatus !== "approved"
        && product.approvalStatus !== "legacy"
      )
      || !product.snapshotId
      || !/^[a-f0-9]{64}$/.test(product.sourceSha256)
    ) {
      issue = "The selected model is not pinned to a VEU Public Registry approval record. Refresh the VEU registry and select it again.";
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
    const category = product.attributes.veuProductCategoryNumber;
    if (
      typeof category !== "string"
      || !permittedCategories.includes(category)
    ) {
      issue = `The selected VEU product category does not match activity ${activityCode}.`;
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

function CreditexVeuCalculator({ api }: { api: Api }) {
  const firstActivity = CREDITEX_VEU_ACTIVITY_DEFINITIONS[0];
  const [activityCode, setActivityCode] = useState<string>(firstActivity.activityCode);
  const [date, setDate] = useState(todayIso());
  const [postcode, setPostcode] = useState("3000");
  const [postcodeError, setPostcodeError] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>(
    () => veuDefaults(firstActivity),
  );
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
    ),
    [
      activity.activityCode,
      activitySourceIssue,
      date,
      productRegistryIssue,
      selectedProducts,
    ],
  );
  const requiredKinds = productEvidence.requiredKinds;
  const postcodeRequired = veuNeedsPostcode(activity);

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
    try {
      const result = await api(path, init);
      if (!creditexVeuShouldApplyProductResponse(
        requestGeneration,
        productIdentityGenerationRef.current,
      )) {
        return result;
      }
      const registry = result.registry as Record<string, unknown> | undefined;
      const registryCode = String(registry?.registryCode || "");
      const registryStatus = String(registry?.status || "");
      const snapshotId = String(registry?.snapshotId || "");
      if (
        registryCode !== "veu-approved-products"
        || registryStatus !== "current"
        || !snapshotId
      ) {
        throw new Error(
          "The current VEU Public Registry snapshot is stale or unavailable.",
        );
      }
      const kind = new URL(path, "https://creditex.invalid")
        .searchParams.get("productKind") || "";
      const previousSnapshotId = registrySnapshotIdsRef.current[kind];
      registrySnapshotIdsRef.current[kind] = snapshotId;
      if (previousSnapshotId && previousSnapshotId !== snapshotId) {
        clearProductEvidence(
          "The VEU Public Registry snapshot changed. Select the exact installation-date-eligible model again.",
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
        : "The current VEU Public Registry snapshot is unavailable.";
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
          ...(requiredKinds.length > 0
            ? { selectedProductIds: productEvidence.selectedProductIds }
            : {}),
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
      <div
        className={styles.registryStatus}
        data-status={productRegistryIssue
          ? "unavailable"
          : activitySourceComplete
            ? "current"
            : "stale"}
      >
        <div>
          <span>VEU Public Registry eligibility evidence</span>
          <strong>Exact model approved on the installation date</strong>
          <small>
            Select the exact VEU Public Registry model approved on the installation date. Its Effective
            From and Effective To window must include the installation date. No product eligibility is guessed.
          </small>
        </div>
      </div>
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
                productIdentityGenerationRef.current += 1;
                selectedProductsRef.current = {};
                dispatchProductUi({
                  type: "identity_changed",
                  reason: "postcode",
                });
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
            api={officialProductApi}
            kind={kind}
            installationDate={date}
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
                  disabled={
                    definition.source === "approved_product"
                    && requiredKinds.length > 0
                  }
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
              <small>
                {definition.source === "approved_product"
                  && requiredKinds.length > 0
                  ? "Read from the exact VEU Public Registry model approved on the installation date."
                  : definition.help}
              </small>
            </label>
          );
        })}
        {productEvidence.issue && (
          <div className={styles.registryStatus} data-status="stale">
            <div>
              <span>
                {activitySourceComplete
                  ? "VEU product eligibility unavailable"
                  : "VEU formula attributes incomplete"}
              </span>
              <strong>
                {activitySourceComplete
                  ? "Exact dated approval required"
                  : "Calculator remains disabled"}
              </strong>
              <small>{productEvidence.issue}</small>
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
            || productEvidence.blocked
            || Boolean(productEvidenceError)
            || Boolean(postcodeError)
          }
        >
          {busy
            ? "Calculating..."
            : productRegistryIssue
              ? "VEU Public Registry unavailable"
              : !activitySourceComplete
                ? "VEU formula inputs unavailable"
              : productEvidence.issue
                ? "Choose VEU model eligible on date"
                : productEvidenceError
                  ? "Choose an eligible official product"
              : productEvidence.missingProduct
                ? "Select VEU model approved on date"
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
