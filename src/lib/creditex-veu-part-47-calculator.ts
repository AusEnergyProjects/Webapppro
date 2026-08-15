import {
  roundCreditexVeuWholeCertificates,
  type CreditexVeuExactFraction,
} from "./creditex-veu-calculator-estimator.ts";

export const CREDITEX_VEU_PART_47_CALCULATOR_SCHEMA =
  "creditex-veu-part-47-calculator/v1" as const;

export type CreditexVeuPart47Request = {
  scenario: "47A" | "47B";
  systemSizeKw: string | number;
  region: "metropolitan" | "regional";
  totalConnectedInverterCapacityKva: string | number;
  cecModulesCurrentAtInstallation: boolean;
  cecInvertersCurrentAtInstallation: boolean;
  solarPanelValidationParticipatingBrands: boolean;
  monitoringPortalConfirmed: boolean;
  saaSizingConfirmed: boolean;
  dnspNegotiatedConnectionContractConfirmed: boolean;
  moduleWarrantyYears: string | number;
  inverterWarrantyYears: string | number;
};

export type CreditexVeuPart47Result = {
  schema: typeof CREDITEX_VEU_PART_47_CALCULATOR_SCHEMA;
  scenario: "47A" | "47B";
  systemSizeKw: string;
  inputFactor: "0.133" | "0.25";
  lifetimeYears: "10";
  regionalFactor: "0.98" | "1.04";
  ghgEquivalentReductionTonnesCo2e: string;
  wholeCertificates: string;
  outputUnit: "VEEC";
  formulaKey: "veu-part-47-equation-47.1/v1";
  sourceCitation: "Victorian Energy Upgrades Specifications 2018 Version 25.0, Part 47, pp. 136-138, Equation 47.1 and Tables 47.1-47.3";
};

export class CreditexVeuPart47CalculationError extends Error {
  readonly code:
    | "VEU_PART_47_REQUEST_INVALID"
    | "VEU_PART_47_SYSTEM_INELIGIBLE";

  constructor(
    code: CreditexVeuPart47CalculationError["code"],
    message: string,
  ) {
    super(message);
    this.name = "CreditexVeuPart47CalculationError";
    this.code = code;
  }
}

function fail(
  code: CreditexVeuPart47CalculationError["code"],
  message: string,
): never {
  throw new CreditexVeuPart47CalculationError(code, message);
}

function gcd(left: bigint, right: bigint) {
  left = left < BigInt(0) ? -left : left;
  right = right < BigInt(0) ? -right : right;
  while (right !== BigInt(0)) {
    const next = left % right;
    left = right;
    right = next;
  }
  return left || BigInt(1);
}

function fraction(numerator: bigint, denominator: bigint): CreditexVeuExactFraction {
  if (denominator === BigInt(0)) fail("VEU_PART_47_REQUEST_INVALID", "A denominator cannot be zero.");
  const sign = denominator < BigInt(0) ? BigInt(-1) : BigInt(1);
  const divisor = gcd(numerator, denominator);
  return {
    numerator: sign * numerator / divisor,
    denominator: sign * denominator / divisor,
  };
}

function decimal(value: string | number, label: string) {
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) {
    fail("VEU_PART_47_REQUEST_INVALID", `${label} must be a non-negative decimal without exponent notation.`);
  }
  const [whole, decimals = ""] = text.split(".");
  return fraction(
    BigInt(`${whole}${decimals}`),
    BigInt(10) ** BigInt(decimals.length),
  );
}

function multiply(...values: CreditexVeuExactFraction[]) {
  return values.reduce(
    (result, value) => fraction(
      result.numerator * value.numerator,
      result.denominator * value.denominator,
    ),
    fraction(BigInt(1), BigInt(1)),
  );
}

function compare(left: CreditexVeuExactFraction, right: CreditexVeuExactFraction) {
  const difference = left.numerator * right.denominator
    - right.numerator * left.denominator;
  return difference < BigInt(0) ? -1 : difference > BigInt(0) ? 1 : 0;
}

function exactDecimal(value: CreditexVeuExactFraction) {
  let denominator = value.denominator;
  let twos = 0;
  let fives = 0;
  while (denominator % BigInt(2) === BigInt(0)) {
    denominator /= BigInt(2);
    twos += 1;
  }
  while (denominator % BigInt(5) === BigInt(0)) {
    denominator /= BigInt(5);
    fives += 1;
  }
  if (denominator !== BigInt(1)) {
    fail("VEU_PART_47_REQUEST_INVALID", "The exact Part 47 result is not a terminating decimal.");
  }
  const places = Math.max(twos, fives);
  const scaled = value.numerator
    * (BigInt(2) ** BigInt(places - twos))
    * (BigInt(5) ** BigInt(places - fives));
  if (places === 0) return String(scaled);
  const negative = scaled < BigInt(0);
  const digits = String(negative ? -scaled : scaled).padStart(places + 1, "0");
  const result = `${digits.slice(0, -places)}.${digits.slice(-places)}`
    .replace(/\.?0+$/, "");
  return negative ? `-${result}` : result;
}

function requireTrue(value: boolean, message: string) {
  if (value !== true) fail("VEU_PART_47_SYSTEM_INELIGIBLE", message);
}

export function calculateCreditexVeuPart47(
  request: CreditexVeuPart47Request,
): CreditexVeuPart47Result {
  if (!request || typeof request !== "object") {
    fail("VEU_PART_47_REQUEST_INVALID", "A Part 47 calculation request is required.");
  }
  if (request.scenario !== "47A" && request.scenario !== "47B") {
    fail("VEU_PART_47_REQUEST_INVALID", "Part 47 scenario must be 47A or 47B.");
  }
  if (request.region !== "metropolitan" && request.region !== "regional") {
    fail("VEU_PART_47_REQUEST_INVALID", "Part 47 region must be metropolitan or regional Victoria.");
  }

  const systemSize = decimal(request.systemSizeKw, "System size");
  const inverterCapacity = decimal(
    request.totalConnectedInverterCapacityKva,
    "Total connected inverter capacity",
  );
  const moduleWarranty = decimal(request.moduleWarrantyYears, "Module warranty");
  const inverterWarranty = decimal(request.inverterWarrantyYears, "Inverter warranty");
  const thirty = decimal("30", "30");
  const oneHundred = decimal("100", "100");
  const twoHundred = decimal("200", "200");

  if (request.scenario === "47A") {
    if (compare(systemSize, thirty) < 0 || compare(systemSize, oneHundred) > 0) {
      fail("VEU_PART_47_SYSTEM_INELIGIBLE", "Scenario 47A requires a system size from 30 kW through 100 kW inclusive.");
    }
    requireTrue(
      request.solarPanelValidationParticipatingBrands,
      "Scenario 47A requires every module manufacturer to be a Solar Panel Validation Initiative participating brand.",
    );
  } else if (compare(systemSize, oneHundred) <= 0 || compare(systemSize, twoHundred) > 0) {
    fail("VEU_PART_47_SYSTEM_INELIGIBLE", "Scenario 47B requires a system size above 100 kW and no more than 200 kW.");
  }

  if (compare(inverterCapacity, thirty) < 0) {
    fail("VEU_PART_47_SYSTEM_INELIGIBLE", "Part 47 requires at least 30 kVA of connected inverter capacity.");
  }
  if (compare(moduleWarranty, decimal("10", "10")) < 0) {
    fail("VEU_PART_47_SYSTEM_INELIGIBLE", "Part 47 modules require a warranty against defects of at least 10 years.");
  }
  if (compare(inverterWarranty, decimal("5", "5")) < 0) {
    fail("VEU_PART_47_SYSTEM_INELIGIBLE", "Part 47 inverters require a warranty against defects of at least 5 years.");
  }
  requireTrue(request.cecModulesCurrentAtInstallation, "Every module must be on the Clean Energy Council approved modules list at installation.");
  requireTrue(request.cecInvertersCurrentAtInstallation, "Every inverter must be on the Clean Energy Council approved inverters list at installation.");
  requireTrue(request.monitoringPortalConfirmed, "The installed system must support the required end-user monitoring portal.");
  requireTrue(request.saaSizingConfirmed, "The system must be sized to Solar Accreditation Australia requirements.");
  requireTrue(request.dnspNegotiatedConnectionContractConfirmed, "The installation must comply with the relevant DNSP negotiated connection contract.");

  const inputFactor = request.scenario === "47A" ? "0.133" : "0.25";
  const regionalFactor = request.region === "metropolitan" ? "0.98" : "1.04";
  const reduction = multiply(
    systemSize,
    decimal(inputFactor, "Input factor"),
    decimal("10", "Lifetime"),
    decimal(regionalFactor, "Regional factor"),
  );

  return {
    schema: CREDITEX_VEU_PART_47_CALCULATOR_SCHEMA,
    scenario: request.scenario,
    systemSizeKw: exactDecimal(systemSize),
    inputFactor,
    lifetimeYears: "10",
    regionalFactor,
    ghgEquivalentReductionTonnesCo2e: exactDecimal(reduction),
    wholeCertificates: roundCreditexVeuWholeCertificates(reduction),
    outputUnit: "VEEC",
    formulaKey: "veu-part-47-equation-47.1/v1",
    sourceCitation: "Victorian Energy Upgrades Specifications 2018 Version 25.0, Part 47, pp. 136-138, Equation 47.1 and Tables 47.1-47.3",
  };
}
