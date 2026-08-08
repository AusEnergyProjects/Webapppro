import { getD1 } from "../../../../../db";
import {
  CreditexCalculatorAccessError,
  requireCreditexCalculatorAccess,
} from "@/lib/creditex-calculator-access-server";
import {
  describeCreditexCalculatorRouteError,
} from "@/lib/creditex-calculator-route-response";
import {
  CreditexLocalEstimateError,
  estimateCreditexLocalProgram,
} from "@/lib/creditex-local-program-estimator";
import {
  creditexNswActivityDefinition,
} from "@/lib/creditex-nsw-program-catalogue";
import {
  CreditexNswEstimateError,
  estimateCreditexNswProgram,
} from "@/lib/creditex-nsw-program-estimator";
import {
  CREDITEX_VEU_ACTIVITY_DEFINITIONS,
} from "@/lib/creditex-veu-calculator-catalogue";
import {
  CreditexVeuEstimateError,
  estimateCreditexVeu,
  type CreditexVeuProductEvidence,
} from "@/lib/creditex-veu-calculator-estimator";
import {
  CreditexVeuPostcodeError,
  resolveCreditexVeuPostcode,
} from "@/lib/creditex-veu-postcode-resolver";
import {
  CreditexOfficialProductError,
  deriveCreditexNswOfficialProductInputs,
  deriveCreditexVeuOfficialProductInputs,
  officialProductKindsForLocalActivity,
  officialProductKindsForNswProductKinds,
  officialProductKindsForVeuActivity,
  unresolvedNswProductKinds,
  type CreditexOfficialProductSelection,
} from "@/lib/creditex-official-product-registry";
import { validateOfficialProductSelections } from "@/lib/creditex-official-product-registry-server";
import {
  BoundedJsonRequestError,
  MAXIMUM_CREDITEX_JSON_BYTES,
  readBoundedJsonRequest,
} from "@/lib/bounded-json-request";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const CREDITEX_VEU_SOURCE_COMPLETE_ACTIVITY_CODES = new Set([
  "17",
  "22",
  "24",
  "25",
  "46",
  "48",
]);

const EXACT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function json(body: object, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new CreditexLocalEstimateError(
    "LOCAL_ESTIMATE_INVALID",
    "The estimate request could not be sealed safely.",
  );
}

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function requestRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CreditexLocalEstimateError(
      "LOCAL_ESTIMATE_INVALID",
      "The estimate request must be an object.",
    );
  }
  return value as Record<string, unknown>;
}

function errorResponse(error: unknown) {
  const descriptor = describeCreditexCalculatorRouteError(error);
  if (descriptor) {
    return json({
      ok: false,
      code: descriptor.code,
      error: descriptor.error,
    }, descriptor.status, descriptor.headers);
  }
  if (
    error instanceof CreditexCalculatorAccessError
    || error instanceof CreditexLocalEstimateError
    || error instanceof CreditexNswEstimateError
    || error instanceof CreditexVeuEstimateError
    || error instanceof CreditexOfficialProductError
    || error instanceof BoundedJsonRequestError
  ) {
    const code = error instanceof BoundedJsonRequestError
      ? error.code === "REQUEST_TOO_LARGE"
        ? "LOCAL_ESTIMATE_REQUEST_TOO_LARGE"
        : "LOCAL_ESTIMATE_REQUEST_INVALID"
      : error.code;
    return json({
      ok: false,
      code,
      error: error.message,
    }, error.status);
  }
  console.error("Creditex program estimate failed", error);
  return json({
    ok: false,
    code: "LOCAL_ESTIMATE_UNAVAILABLE",
    error: "The program estimate could not be completed safely.",
  }, 500);
}

function exactRequestKeys(
  raw: Record<string, unknown>,
  keys: readonly string[],
  message: string,
) {
  const expected = new Set(keys);
  if (
    Object.keys(raw).length !== expected.size
    || Object.keys(raw).some((key) => !expected.has(key))
  ) {
    throw new CreditexLocalEstimateError("LOCAL_ESTIMATE_INVALID", message);
  }
}

function inputRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CreditexLocalEstimateError(
      "LOCAL_ESTIMATE_INVALID",
      "Program estimate inputs must be an object.",
    );
  }
  return { ...(value as Record<string, unknown>) };
}

function numericAttribute(
  selection: CreditexOfficialProductSelection | undefined,
  key: string,
) {
  const value = selection?.attributes[key];
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : null;
}

function deriveProductBackedInputs(
  inputs: Record<string, unknown>,
  selections: readonly CreditexOfficialProductSelection[],
) {
  const derived = { ...inputs };
  const battery = selections.find((item) => item.productKind === "battery");
  const inverter = selections.find((item) => item.productKind === "inverter");
  const airConditioner = selections.find(
    (item) => item.productKind === "air_conditioner",
  );
  const poolPump = selections.find((item) => item.productKind === "pool_pump");
  const commercialRefrigerator = selections.find(
    (item) => item.productKind === "commercial_refrigerator",
  );
  const nominalCapacity = numericAttribute(battery, "nominalCapacityKwh");
  const usableCapacity = numericAttribute(battery, "usableCapacityKwh");
  const inverterOutput = numericAttribute(inverter, "ratedAcOutputKw");
  const coolingCapacity = numericAttribute(
    airConditioner,
    "ratedCoolingCapacityKw",
  );
  const heatingCapacity = numericAttribute(
    airConditioner,
    "ratedHeatingCapacityKw",
  );
  const maximumTestedInput = numericAttribute(poolPump, "maximumTestedInputW");
  const projectedAnnualEnergy = numericAttribute(
    poolPump,
    "projectedAnnualEnergyConsumptionKwh",
  );
  const dailyRunTime = numericAttribute(poolPump, "dailyRunTimeHours");
  const refrigeratorClass = numericAttribute(
    commercialRefrigerator,
    "productClassNumber",
  );
  const refrigeratorEnergy = numericAttribute(
    commercialRefrigerator,
    "totalEnergyConsumptionKwhPer24h",
  );
  const refrigeratorEei = numericAttribute(
    commercialRefrigerator,
    "energyEfficiencyIndex",
  );

  if (nominalCapacity && "nominal_battery_capacity_kwh" in derived) {
    derived.nominal_battery_capacity_kwh = nominalCapacity;
  }
  if (usableCapacity && "usable_capacity_kwh" in derived) {
    derived.usable_capacity_kwh = usableCapacity;
  }
  if (inverterOutput && "battery_inverter_output_kw" in derived) {
    derived.battery_inverter_output_kw = inverterOutput;
  }
  if (inverterOutput && "inverter_capacity_kw" in derived) {
    derived.inverter_capacity_kw = inverterOutput;
  }
  for (const key of [
    "rated_cooling_capacity_kw",
    "outdoor_cooling_capacity_kw",
    "cooling_capacity_kw",
  ]) {
    if (coolingCapacity && key in derived) derived[key] = coolingCapacity;
  }
  for (const key of [
    "outdoor_heating_capacity_kw",
    "heating_capacity_kw",
  ]) {
    if (heatingCapacity && key in derived) derived[key] = heatingCapacity;
  }
  if (maximumTestedInput && "maximum_tested_input_w" in derived) {
    derived.maximum_tested_input_w = maximumTestedInput;
  }
  if (projectedAnnualEnergy && "paec_kwh_per_year" in derived) {
    derived.paec_kwh_per_year = projectedAnnualEnergy;
  }
  if (dailyRunTime && "daily_run_time_hours" in derived) {
    derived.daily_run_time_hours = dailyRunTime;
  }
  if (refrigeratorClass && "product_class" in derived) {
    derived.product_class = refrigeratorClass;
  }
  if (refrigeratorEnergy && "tec_kwh_per_24h" in derived) {
    derived.tec_kwh_per_24h = refrigeratorEnergy;
  }
  if (refrigeratorEei && "product_eei" in derived) {
    derived.product_eei = refrigeratorEei;
  }
  return derived;
}

function deriveVeuPostcodeInputs(
  activity: (typeof CREDITEX_VEU_ACTIVITY_DEFINITIONS)[number],
  inputs: Record<string, unknown>,
  postcode: unknown,
  installationDate: unknown,
) {
  if (!activity.inputDefinitions.some(
    (definition) => definition.source === "postcode_lookup",
  )) {
    return inputs;
  }
  try {
    const resolution = resolveCreditexVeuPostcode({
      postcode: typeof postcode === "string" ? postcode : "",
      installationDate: typeof installationDate === "string"
        ? installationDate
        : "",
    });
    const derived = { ...inputs };
    for (const definition of activity.inputDefinitions) {
      if (definition.source !== "postcode_lookup") continue;
      if (definition.key === "geography") derived[definition.key] = resolution.geography;
      if (definition.key === "climate_zone") derived[definition.key] = resolution.climateZone;
      if (definition.key === "climatic_region") derived[definition.key] = resolution.climateRegion;
      if (definition.key === "location_class") derived[definition.key] = resolution.locationClass;
    }
    return derived;
  } catch (error) {
    if (error instanceof CreditexVeuPostcodeError) {
      throw new CreditexVeuEstimateError(
        "VEU_INPUT_INVALID",
        error.message,
        error.code === "VEU_POSTCODE_DATE_UNSUPPORTED" ? 409 : 400,
      );
    }
    throw error;
  }
}

async function attachRegistryReceipt(
  estimate: Record<string, unknown> & { receiptHash: string },
  productValidation: Awaited<ReturnType<typeof validateOfficialProductSelections>>,
) {
  const approvedProducts = productValidation.selections
    .sort((left, right) => left.productKind.localeCompare(right.productKind));
  const registryReceiptBase = {
    arithmeticReceiptHash: estimate.receiptHash,
    registryReceipt: productValidation.registryReceipt,
    approvedProducts,
  };
  const registryReceiptHash = await sha256(registryReceiptBase);
  return {
    ...estimate,
    arithmeticReceiptHash: estimate.receiptHash,
    approvedProducts,
    registryReceipt: productValidation.registryReceipt,
    registryReceiptHash,
    receiptHash: await sha256({
      ...registryReceiptBase,
      registryReceiptHash,
    }),
  };
}

function veuEvidenceFailure(activityCode: string, detail: string): never {
  throw new CreditexVeuEstimateError(
    "VEU_PRODUCT_EVIDENCE_INVALID",
    `Activity ${activityCode} cannot calculate because its VEU Public Registry evidence ${detail}.`,
    503,
  );
}

function exactVeuEvidenceText(
  value: unknown,
  activityCode: string,
  label: string,
) {
  if (
    typeof value !== "string"
    || !value
    || value.trim() !== value
    || value.length > 200
  ) {
    return veuEvidenceFailure(activityCode, `has no exact ${label}`);
  }
  return value;
}

function deriveVeuProductEvidence(
  activityCode: string,
  selections: readonly CreditexOfficialProductSelection[],
): CreditexVeuProductEvidence {
  if (selections.length !== 1) {
    return veuEvidenceFailure(
      activityCode,
      "does not resolve to exactly one activity-specific product approved on the installation date",
    );
  }
  const selection = selections[0];
  if (selection.registryCode !== "veu-approved-products") {
    return veuEvidenceFailure(
      activityCode,
      "did not come from the VEU Public Registry",
    );
  }
  if (
    selection.approvalStatus !== "approved"
    && selection.approvalStatus !== "legacy"
  ) {
    return veuEvidenceFailure(
      activityCode,
      "does not prove approval on the installation date",
    );
  }
  const productId = exactVeuEvidenceText(
    selection.attributes.veuProductId,
    activityCode,
    "VEU product ID",
  );
  const activityCategory = exactVeuEvidenceText(
    selection.attributes.veuProductCategoryNumber,
    activityCode,
    "VEU product category",
  );
  if (!EXACT_DATE_PATTERN.test(selection.eligibleFrom)) {
    return veuEvidenceFailure(
      activityCode,
      "has no exact official effective-from date",
    );
  }
  if (
    selection.eligibleTo
    && !EXACT_DATE_PATTERN.test(selection.eligibleTo)
  ) {
    return veuEvidenceFailure(
      activityCode,
      "has an invalid official effective-to date",
    );
  }
  if (selection.approvalStatus === "legacy" && !selection.eligibleTo) {
    return veuEvidenceFailure(
      activityCode,
      "is Legacy without an exact official effective-to date",
    );
  }
  if (!SHA256_PATTERN.test(selection.sourceSha256)) {
    return veuEvidenceFailure(
      activityCode,
      "has no exact source snapshot SHA-256",
    );
  }
  return {
    registry: "VEU",
    activityCategory,
    productId,
    status: selection.approvalStatus === "legacy" ? "Legacy" : "Approved",
    effectiveFrom: selection.eligibleFrom,
    effectiveTo: selection.eligibleTo,
    sourceSnapshotHash: `sha256:${selection.sourceSha256}`,
  };
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return json({
      ok: false,
      code: "ORIGIN_REJECTED",
      error: "Request origin was not accepted.",
    }, 403);
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return json({
      ok: false,
      code: "LOCAL_ESTIMATE_CONTENT_TYPE_INVALID",
      error: "Send program estimate requests as JSON.",
    }, 415);
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (
    Number.isFinite(contentLength)
    && contentLength > MAXIMUM_CREDITEX_JSON_BYTES
  ) {
    return json({
      ok: false,
      code: "LOCAL_ESTIMATE_REQUEST_TOO_LARGE",
      error: "The program estimate request exceeds 16 KiB.",
    }, 413);
  }

  try {
    const database = getD1();
    await requireCreditexCalculatorAccess(request, database);
    const body = await readBoundedJsonRequest(
      request,
      MAXIMUM_CREDITEX_JSON_BYTES,
    );
    const raw = requestRecord(body);
    const programCode = typeof raw.programCode === "string"
      ? raw.programCode
      : "";
    const activityCode = typeof raw.activityCode === "string"
      ? raw.activityCode
      : "";
    if (programCode === "VEU") {
      const activity = CREDITEX_VEU_ACTIVITY_DEFINITIONS.find(
        (candidate) => candidate.activityCode === activityCode,
      );
      if (!activity) {
        throw new CreditexVeuEstimateError(
          "VEU_ACTIVITY_UNSUPPORTED",
          `Activity ${activityCode} is not executable in the source-pinned VEU slice.`,
          404,
        );
      }
      if (!CREDITEX_VEU_SOURCE_COMPLETE_ACTIVITY_CODES.has(activityCode)) {
        throw new CreditexVeuEstimateError(
          "VEU_PRODUCT_EVIDENCE_INVALID",
          `Activity ${activityCode} remains unavailable because every formula-critical approved-product attribute has not yet been normalized from the VEU Public Registry.`,
          503,
        );
      }
      const postcodeRequired = activity.inputDefinitions.some(
        (definition) => definition.source === "postcode_lookup",
      );
      const requiredKinds = officialProductKindsForVeuActivity(activityCode);
      const requestKeys = [
        "programCode",
        "activityCode",
        "effectiveDate",
        "inputs",
        ...(postcodeRequired ? ["postcode"] : []),
        ...(requiredKinds.length > 0 ? ["selectedProductIds"] : []),
      ];
      exactRequestKeys(
        raw,
        requestKeys,
        "The VEU estimate request contains unexpected fields.",
      );
      const postcodeDerivedInputs = deriveVeuPostcodeInputs(
        activity,
        inputRecord(raw.inputs),
        raw.postcode,
        raw.effectiveDate,
      );
      if (requiredKinds.length !== 1) {
        return veuEvidenceFailure(
          activityCode,
          "does not have one source-complete activity product contract",
        );
      }
      const productValidation = await validateOfficialProductSelections(
        database,
        {
          installationDate: raw.effectiveDate,
          requiredKinds,
          selectedProductIds: raw.selectedProductIds,
        },
      );
      const derivedInputs = deriveCreditexVeuOfficialProductInputs(
        activityCode,
        postcodeDerivedInputs,
        productValidation.selections,
      );
      const estimate = estimateCreditexVeu({
        activityCode,
        installationDate: raw.effectiveDate,
        inputs: derivedInputs,
        product: deriveVeuProductEvidence(
          activityCode,
          productValidation.selections,
        ),
      });
      return json({
        ok: true,
        estimate: await attachRegistryReceipt(
          estimate as unknown as Record<string, unknown> & { receiptHash: string },
          productValidation,
        ),
      });
    }

    if (programCode === "NSW-PDRS-2026" || programCode === "NSW-ESS-2026") {
      const activity = creditexNswActivityDefinition(programCode, activityCode);
      if (!activity) {
        throw new CreditexNswEstimateError(
          "NSW_ACTIVITY_NOT_SUPPORTED",
          `Activity ${activityCode} is not executable for ${programCode}.`,
          404,
        );
      }
      const unresolvedProductKinds = unresolvedNswProductKinds(
        activity.productKinds,
      );
      if (
        activity.calculationStatus === "official_registry_required"
        || unresolvedProductKinds.length > 0
      ) {
        throw new CreditexOfficialProductError(
          "OFFICIAL_PRODUCT_REGISTRY_UNAVAILABLE",
          409,
          `Activity ${activityCode} requires a current NSW administrator or TESSA product source that is not mapped to the controlled official registry.`,
        );
      }
      const requiredProductKinds = officialProductKindsForNswProductKinds(
        activity.productKinds,
      );
      if (activity.productKinds.length > 0 && requiredProductKinds.length === 0) {
        throw new CreditexOfficialProductError(
          "OFFICIAL_PRODUCT_REGISTRY_UNAVAILABLE",
          409,
          `Activity ${activityCode} cannot calculate without its required official product registry.`,
        );
      }
      const requestKeys = requiredProductKinds.length > 0
        ? ["programCode", "activityCode", "effectiveDate", "inputs", "selectedProductIds"]
        : ["programCode", "activityCode", "effectiveDate", "inputs"];
      exactRequestKeys(
        raw,
        requestKeys,
        "The NSW estimate request contains unexpected fields.",
      );
      if (requiredProductKinds.length === 0) {
        const estimate = estimateCreditexNswProgram({
          programCode: raw.programCode,
          activityCode: raw.activityCode,
          effectiveDate: raw.effectiveDate,
          inputs: raw.inputs,
        });
        return json({ ok: true, estimate });
      }
      const productValidation = await validateOfficialProductSelections(
        database,
        {
          installationDate: raw.effectiveDate,
          requiredKinds: requiredProductKinds,
          selectedProductIds: raw.selectedProductIds,
        },
      );
      const derivedInputs = deriveCreditexNswOfficialProductInputs(
        programCode,
        activityCode,
        inputRecord(raw.inputs),
        productValidation.selections,
      );
      const estimate = estimateCreditexNswProgram({
        programCode: raw.programCode,
        activityCode: raw.activityCode,
        effectiveDate: raw.effectiveDate,
        inputs: derivedInputs,
      });
      return json({
        ok: true,
        estimate: await attachRegistryReceipt(
          estimate as unknown as Record<string, unknown> & { receiptHash: string },
          productValidation,
        ),
      });
    }

    const requiredProductKinds = officialProductKindsForLocalActivity(
      programCode,
      activityCode,
    );
    const requestKeys = requiredProductKinds.length > 0
      ? ["programCode", "activityCode", "effectiveDate", "inputs", "selectedProductIds"]
      : ["programCode", "activityCode", "effectiveDate", "inputs"];
    exactRequestKeys(
      raw,
      requestKeys,
      "The local program estimate request contains unexpected fields.",
    );
    if (requiredProductKinds.length === 0) {
      const estimate = estimateCreditexLocalProgram({
        programCode: raw.programCode,
        activityCode: raw.activityCode,
        effectiveDate: raw.effectiveDate,
        inputs: raw.inputs,
      });
      return json({ ok: true, estimate });
    }
    const productValidation = await validateOfficialProductSelections(
      database,
      {
        installationDate: raw.effectiveDate,
        requiredKinds: requiredProductKinds,
        selectedProductIds: raw.selectedProductIds,
      },
    );
    const derivedInputs = deriveProductBackedInputs(
      inputRecord(raw.inputs),
      productValidation.selections,
    );
    const estimate = estimateCreditexLocalProgram({
      programCode: raw.programCode,
      activityCode: raw.activityCode,
      effectiveDate: raw.effectiveDate,
      inputs: derivedInputs,
    });
    return json({
      ok: true,
      estimate: await attachRegistryReceipt(
        estimate as unknown as Record<string, unknown> & { receiptHash: string },
        productValidation,
      ),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
