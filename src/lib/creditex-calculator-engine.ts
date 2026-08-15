import { createHash } from "node:crypto";

export const CREDITEX_CALCULATOR_SPEC_SCHEMA =
  "creditex-calculator-specification/v2" as const;
export const CREDITEX_CALCULATOR_RECEIPT_SCHEMA =
  "creditex-calculator-execution-receipt/v2" as const;
export const CREDITEX_CALCULATOR_SUITE_RECEIPT_SCHEMA =
  "creditex-calculator-suite-receipt/v2" as const;
export const CREDITEX_CALCULATOR_ENGINE_VERSION =
  "creditex-fixed-decimal-engine/v2" as const;
export const CREDITEX_CALCULATOR_ENGINE_CONTRACT_ID =
  "creditex-fixed-decimal-engine-contract/base10-strings-v2" as const;

const MAX_INPUT_DECIMAL_PLACES = 9;
const MAX_INTERNAL_DECIMAL_PLACES = 18;
const MAX_ABSOLUTE_DECIMAL = "1000000000000";
const MAX_DECIMAL_STRING_LENGTH = 64;
const MAX_INPUTS = 50;
const MAX_STEPS = 100;
const MAX_LOOKUP_ENTRIES = 500;
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const UNIT_PATTERN = /^[A-Za-z][A-Za-z0-9._/%-]{0,31}$/;
const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/;
const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);
const BIGINT_TWO = BigInt(2);
const BIGINT_TEN = BigInt(10);
const MAX_ABSOLUTE_COEFFICIENT = BigInt(MAX_ABSOLUTE_DECIMAL);

export type CreditexCalculatorErrorCode =
  | "invalid_specification"
  | "invalid_input"
  | "invalid_suite"
  | "missing_input"
  | "missing_lookup"
  | "number_out_of_range"
  | "precision_exceeded"
  | "source_not_found"
  | "unit_mismatch";

export class CreditexCalculatorError extends Error {
  readonly code: CreditexCalculatorErrorCode;
  readonly path: string;

  constructor(
    code: CreditexCalculatorErrorCode,
    path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "CreditexCalculatorError";
    this.code = code;
    this.path = path;
  }
}

export interface CreditexCalculatorInputDefinition {
  key: string;
  unit: string;
  precision: number;
  minimum?: string;
  maximum?: string;
}

export interface CreditexCalculatorFactorStep {
  kind: "factor";
  key: string;
  source: string;
  inputUnit: string;
  outputUnit: string;
  factor: string;
}

/**
 * Multiplies two preceding, independently typed values. This is deliberately
 * binary rather than accepting an expression string: the governed
 * specification names both exact inputs and their units, and the fixed-decimal
 * engine retains both operands in the execution trace.
 */
export interface CreditexCalculatorMultiplyStep {
  kind: "multiply";
  key: string;
  leftSource: string;
  rightSource: string;
  leftUnit: string;
  rightUnit: string;
  outputUnit: string;
}

export interface CreditexCalculatorLookupEntry {
  match: string;
  value: string;
}

export interface CreditexCalculatorLookupStep {
  kind: "lookup";
  key: string;
  source: string;
  inputUnit: string;
  outputUnit: string;
  entries: CreditexCalculatorLookupEntry[];
}

export interface CreditexCalculatorCapStep {
  kind: "cap";
  key: string;
  source: string;
  unit: string;
  minimum?: string;
  maximum?: string;
}

export type CreditexCalculatorRoundingMode =
  | "floor"
  | "ceiling"
  | "nearest_half_away_from_zero";

export interface CreditexCalculatorRoundingStep {
  kind: "rounding";
  key: string;
  source: string;
  unit: string;
  mode: CreditexCalculatorRoundingMode;
  decimalPlaces: number;
}

export type CreditexCalculatorStep =
  | CreditexCalculatorFactorStep
  | CreditexCalculatorMultiplyStep
  | CreditexCalculatorLookupStep
  | CreditexCalculatorCapStep
  | CreditexCalculatorRoundingStep;

export interface CreditexCalculatorSpecification {
  schemaVersion: typeof CREDITEX_CALCULATOR_SPEC_SCHEMA;
  key: string;
  version: number;
  title: string;
  inputs: CreditexCalculatorInputDefinition[];
  steps: CreditexCalculatorStep[];
  output: {
    source: string;
    unit: string;
  };
}

export interface CreditexCalculatorDecimalInput {
  value: string;
  unit: string;
}

export type CreditexCalculatorInputs = Record<
  string,
  CreditexCalculatorDecimalInput
>;

export interface CreditexCalculatorValue {
  decimal: string;
  unit: string;
}

export interface CreditexCalculatorTraceEntry {
  stepKey: string;
  kind: CreditexCalculatorStep["kind"];
  source: string;
  input: {
    decimal: string;
    unit: string;
  };
  secondarySource?: string;
  secondaryInput?: {
    decimal: string;
    unit: string;
  };
  output: {
    decimal: string;
    unit: string;
  };
}

export interface CreditexCalculatorExecutionReceipt {
  schemaVersion: typeof CREDITEX_CALCULATOR_RECEIPT_SCHEMA;
  engineVersion: typeof CREDITEX_CALCULATOR_ENGINE_VERSION;
  engineContractHash: string;
  inputHash: string;
  traceHash: string;
  outputHash: string;
  output: CreditexCalculatorValue;
  trace: CreditexCalculatorTraceEntry[];
  receiptHash: string;
}

export interface CreditexCalculatorTestVector {
  key: string;
  inputs: CreditexCalculatorInputs;
  expected: {
    value: string;
    unit: string;
  };
}

export interface CreditexCalculatorSuiteCaseReceipt {
  key: string;
  inputHash: string;
  expectedOutputHash: string;
  actualOutputHash: string;
  executionReceiptHash: string;
  passed: boolean;
}

export interface CreditexCalculatorSuiteReceipt {
  schemaVersion: typeof CREDITEX_CALCULATOR_SUITE_RECEIPT_SCHEMA;
  engineVersion: typeof CREDITEX_CALCULATOR_ENGINE_VERSION;
  engineContractHash: string;
  suiteHash: string;
  passed: boolean;
  cases: CreditexCalculatorSuiteCaseReceipt[];
  receiptHash: string;
}

type UnknownRecord = Record<string, unknown>;

interface Decimal {
  coefficient: bigint;
  scale: number;
}

interface RuntimeValue {
  decimal: Decimal;
  unit: string;
}

function fail(
  code: CreditexCalculatorErrorCode,
  path: string,
  message: string,
): never {
  throw new CreditexCalculatorError(code, path, message);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordValue(
  value: unknown,
  path: string,
  code: CreditexCalculatorErrorCode,
): UnknownRecord {
  if (!isRecord(value)) {
    fail(code, path, "must be an object");
  }
  return value;
}

function exactKeys(
  value: UnknownRecord,
  allowed: readonly string[],
  path: string,
  code: CreditexCalculatorErrorCode,
) {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      fail(code, `${path}.${key}`, "is not permitted");
    }
  }
}

function requiredString(
  value: unknown,
  path: string,
  code: CreditexCalculatorErrorCode,
  maxLength = 120,
): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maxLength
    || value.trim() !== value
  ) {
    fail(code, path, `must be a trimmed string between 1 and ${maxLength} characters`);
  }
  return value;
}

function keyValue(
  value: unknown,
  path: string,
  code: CreditexCalculatorErrorCode,
): string {
  const key = requiredString(value, path, code, 64);
  if (!KEY_PATTERN.test(key)) {
    fail(code, path, "must use lower snake case and begin with a letter");
  }
  return key;
}

function unitValue(
  value: unknown,
  path: string,
  code: CreditexCalculatorErrorCode,
): string {
  const unit = requiredString(value, path, code, 32);
  if (!UNIT_PATTERN.test(unit)) {
    fail(code, path, "contains unsupported unit characters");
  }
  return unit;
}

function integerValue(
  value: unknown,
  path: string,
  code: CreditexCalculatorErrorCode,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum
  ) {
    fail(code, path, `must be a safe integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function powerOfTen(exponent: number): bigint {
  return BIGINT_TEN ** BigInt(exponent);
}

function normaliseDecimal(value: Decimal): Decimal {
  let coefficient = value.coefficient;
  let scale = value.scale;
  while (
    scale > 0
    && coefficient % BIGINT_TEN === BIGINT_ZERO
  ) {
    coefficient /= BIGINT_TEN;
    scale -= 1;
  }
  return coefficient === BIGINT_ZERO ? {
    coefficient: BIGINT_ZERO,
    scale: 0,
  } : {
    coefficient,
    scale,
  };
}

function decimalFromString(
  value: unknown,
  path: string,
  typeCode: CreditexCalculatorErrorCode,
  maxDecimalPlaces: number,
): Decimal {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_DECIMAL_STRING_LENGTH
    || value.trim() !== value
    || !DECIMAL_PATTERN.test(value)
  ) {
    fail(
      typeCode,
      path,
      `must be a plain base-10 decimal string of at most ${MAX_DECIMAL_STRING_LENGTH} characters`,
    );
  }
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) {
    fail(typeCode, path, "must be a plain base-10 decimal string");
  }
  const fraction = match[3] || "";
  const decimal = normaliseDecimal({
    coefficient: BigInt(`${match[1]}${match[2]}${fraction}`),
    scale: fraction.length,
  });
  if (decimal.scale > maxDecimalPlaces) {
    fail(
      "precision_exceeded",
      path,
      `uses ${decimal.scale} decimal places; maximum is ${maxDecimalPlaces}`,
    );
  }
  const absoluteCoefficient = decimal.coefficient < BIGINT_ZERO
    ? -decimal.coefficient
    : decimal.coefficient;
  if (
    absoluteCoefficient
      > MAX_ABSOLUTE_COEFFICIENT * powerOfTen(decimal.scale)
  ) {
    fail(
      "number_out_of_range",
      path,
      `absolute value must not exceed ${MAX_ABSOLUTE_DECIMAL}`,
    );
  }
  return decimal;
}

function decimalText(value: Decimal): string {
  const decimal = normaliseDecimal(value);
  const negative = decimal.coefficient < BIGINT_ZERO;
  const digits = (negative ? -decimal.coefficient : decimal.coefficient).toString();
  if (decimal.scale === 0) {
    return `${negative ? "-" : ""}${digits}`;
  }
  const padded = digits.padStart(decimal.scale + 1, "0");
  const integerLength = padded.length - decimal.scale;
  return `${negative ? "-" : ""}${padded.slice(0, integerLength)}.${padded.slice(integerLength)}`;
}

function compareDecimals(left: Decimal, right: Decimal): number {
  const targetScale = Math.max(left.scale, right.scale);
  const leftCoefficient = left.coefficient * powerOfTen(targetScale - left.scale);
  const rightCoefficient = right.coefficient
    * powerOfTen(targetScale - right.scale);
  return leftCoefficient < rightCoefficient
    ? -1
    : leftCoefficient > rightCoefficient
      ? 1
      : 0;
}

function guardDecimal(value: Decimal, path: string): Decimal {
  const decimal = normaliseDecimal(value);
  if (decimal.scale > MAX_INTERNAL_DECIMAL_PLACES) {
    fail(
      "precision_exceeded",
      path,
      `uses ${decimal.scale} decimal places; maximum internal precision is ${MAX_INTERNAL_DECIMAL_PLACES}`,
    );
  }
  const absoluteCoefficient = decimal.coefficient < BIGINT_ZERO
    ? -decimal.coefficient
    : decimal.coefficient;
  if (
    absoluteCoefficient
      > MAX_ABSOLUTE_COEFFICIENT * powerOfTen(decimal.scale)
  ) {
    fail(
      "number_out_of_range",
      path,
      `absolute value must not exceed ${MAX_ABSOLUTE_DECIMAL}`,
    );
  }
  return decimal;
}

function multiplyDecimals(
  left: Decimal,
  right: Decimal,
  path: string,
): Decimal {
  return guardDecimal({
    coefficient: left.coefficient * right.coefficient,
    scale: left.scale + right.scale,
  }, path);
}

function roundDecimal(
  value: Decimal,
  decimalPlaces: number,
  mode: CreditexCalculatorRoundingMode,
): Decimal {
  if (value.scale <= decimalPlaces) {
    return value;
  }
  const divisor = powerOfTen(value.scale - decimalPlaces);
  let coefficient = value.coefficient / divisor;
  const remainder = value.coefficient % divisor;
  if (remainder !== BIGINT_ZERO) {
    if (mode === "floor" && value.coefficient < BIGINT_ZERO) {
      coefficient -= BIGINT_ONE;
    } else if (mode === "ceiling" && value.coefficient > BIGINT_ZERO) {
      coefficient += BIGINT_ONE;
    } else if (
      mode === "nearest_half_away_from_zero"
      && (
        remainder < BIGINT_ZERO ? -remainder : remainder
      ) * BIGINT_TWO >= divisor
    ) {
      coefficient += value.coefficient < BIGINT_ZERO
        ? -BIGINT_ONE
        : BIGINT_ONE;
    }
  }
  return normaliseDecimal({ coefficient, scale: decimalPlaces });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex")}`;
}

function specificationDecimal(
  value: unknown,
  path: string,
): string {
  return decimalText(decimalFromString(
    value,
    path,
    "invalid_specification",
    MAX_INPUT_DECIMAL_PLACES,
  ));
}

function inputDefinition(
  value: unknown,
  index: number,
): CreditexCalculatorInputDefinition {
  const path = `specification.inputs[${index}]`;
  const input = recordValue(value, path, "invalid_specification");
  exactKeys(
    input,
    ["key", "unit", "precision", "minimum", "maximum"],
    path,
    "invalid_specification",
  );
  const definition: CreditexCalculatorInputDefinition = {
    key: keyValue(input.key, `${path}.key`, "invalid_specification"),
    unit: unitValue(input.unit, `${path}.unit`, "invalid_specification"),
    precision: integerValue(
      input.precision,
      `${path}.precision`,
      "invalid_specification",
      0,
      MAX_INPUT_DECIMAL_PLACES,
    ),
  };
  if (input.minimum !== undefined) {
    definition.minimum = specificationDecimal(
      input.minimum,
      `${path}.minimum`,
    );
  }
  if (input.maximum !== undefined) {
    definition.maximum = specificationDecimal(
      input.maximum,
      `${path}.maximum`,
    );
  }
  if (
    definition.minimum !== undefined
    && definition.maximum !== undefined
    && compareDecimals(
      decimalFromString(
        definition.minimum,
        `${path}.minimum`,
        "invalid_specification",
        MAX_INPUT_DECIMAL_PLACES,
      ),
      decimalFromString(
        definition.maximum,
        `${path}.maximum`,
        "invalid_specification",
        MAX_INPUT_DECIMAL_PLACES,
      ),
    ) > 0
  ) {
    fail(
      "invalid_specification",
      path,
      "minimum must not exceed maximum",
    );
  }
  return definition;
}

function validateSourceUnit(
  symbols: Map<string, string>,
  source: string,
  inputUnit: string,
  path: string,
) {
  const sourceUnit = symbols.get(source);
  if (!sourceUnit) {
    fail(
      "source_not_found",
      `${path}.source`,
      `does not reference a preceding input or step: ${source}`,
    );
  }
  if (sourceUnit !== inputUnit) {
    fail(
      "unit_mismatch",
      `${path}.inputUnit`,
      `expected ${sourceUnit} for source ${source}, received ${inputUnit}`,
    );
  }
}

function validateStepKey(
  value: unknown,
  symbols: Map<string, string>,
  path: string,
): string {
  const key = keyValue(value, `${path}.key`, "invalid_specification");
  if (symbols.has(key)) {
    fail(
      "invalid_specification",
      `${path}.key`,
      `duplicates an existing input or step: ${key}`,
    );
  }
  return key;
}

function factorStep(
  value: UnknownRecord,
  index: number,
  symbols: Map<string, string>,
): CreditexCalculatorFactorStep {
  const path = `specification.steps[${index}]`;
  exactKeys(
    value,
    ["kind", "key", "source", "inputUnit", "outputUnit", "factor"],
    path,
    "invalid_specification",
  );
  const key = validateStepKey(value.key, symbols, path);
  const source = keyValue(
    value.source,
    `${path}.source`,
    "invalid_specification",
  );
  const inputUnit = unitValue(
    value.inputUnit,
    `${path}.inputUnit`,
    "invalid_specification",
  );
  const outputUnit = unitValue(
    value.outputUnit,
    `${path}.outputUnit`,
    "invalid_specification",
  );
  validateSourceUnit(symbols, source, inputUnit, path);
  const step: CreditexCalculatorFactorStep = {
    kind: "factor",
    key,
    source,
    inputUnit,
    outputUnit,
    factor: specificationDecimal(value.factor, `${path}.factor`),
  };
  symbols.set(key, outputUnit);
  return step;
}

function multiplyStep(
  value: UnknownRecord,
  index: number,
  symbols: Map<string, string>,
): CreditexCalculatorMultiplyStep {
  const path = `specification.steps[${index}]`;
  exactKeys(
    value,
    [
      "kind",
      "key",
      "leftSource",
      "rightSource",
      "leftUnit",
      "rightUnit",
      "outputUnit",
    ],
    path,
    "invalid_specification",
  );
  const key = validateStepKey(value.key, symbols, path);
  const leftSource = keyValue(
    value.leftSource,
    `${path}.leftSource`,
    "invalid_specification",
  );
  const rightSource = keyValue(
    value.rightSource,
    `${path}.rightSource`,
    "invalid_specification",
  );
  const leftUnit = unitValue(
    value.leftUnit,
    `${path}.leftUnit`,
    "invalid_specification",
  );
  const rightUnit = unitValue(
    value.rightUnit,
    `${path}.rightUnit`,
    "invalid_specification",
  );
  const outputUnit = unitValue(
    value.outputUnit,
    `${path}.outputUnit`,
    "invalid_specification",
  );
  validateSourceUnit(symbols, leftSource, leftUnit, `${path}.left`);
  validateSourceUnit(symbols, rightSource, rightUnit, `${path}.right`);
  const step: CreditexCalculatorMultiplyStep = {
    kind: "multiply",
    key,
    leftSource,
    rightSource,
    leftUnit,
    rightUnit,
    outputUnit,
  };
  symbols.set(key, outputUnit);
  return step;
}

function lookupStep(
  value: UnknownRecord,
  index: number,
  symbols: Map<string, string>,
): CreditexCalculatorLookupStep {
  const path = `specification.steps[${index}]`;
  exactKeys(
    value,
    ["kind", "key", "source", "inputUnit", "outputUnit", "entries"],
    path,
    "invalid_specification",
  );
  const key = validateStepKey(value.key, symbols, path);
  const source = keyValue(
    value.source,
    `${path}.source`,
    "invalid_specification",
  );
  const inputUnit = unitValue(
    value.inputUnit,
    `${path}.inputUnit`,
    "invalid_specification",
  );
  const outputUnit = unitValue(
    value.outputUnit,
    `${path}.outputUnit`,
    "invalid_specification",
  );
  validateSourceUnit(symbols, source, inputUnit, path);
  if (
    !Array.isArray(value.entries)
    || value.entries.length === 0
    || value.entries.length > MAX_LOOKUP_ENTRIES
  ) {
    fail(
      "invalid_specification",
      `${path}.entries`,
      `must contain between 1 and ${MAX_LOOKUP_ENTRIES} entries`,
    );
  }
  const seenMatches = new Set<string>();
  const entries = value.entries.map((rawEntry, entryIndex) => {
    const entryPath = `${path}.entries[${entryIndex}]`;
    const entry = recordValue(
      rawEntry,
      entryPath,
      "invalid_specification",
    );
    exactKeys(
      entry,
      ["match", "value"],
      entryPath,
      "invalid_specification",
    );
    const match = specificationDecimal(entry.match, `${entryPath}.match`);
    const output = specificationDecimal(entry.value, `${entryPath}.value`);
    const matchKey = decimalText(decimalFromString(
      match,
      `${entryPath}.match`,
      "invalid_specification",
      MAX_INPUT_DECIMAL_PLACES,
    ));
    if (seenMatches.has(matchKey)) {
      fail(
        "invalid_specification",
        `${entryPath}.match`,
        `duplicates lookup match ${matchKey}`,
      );
    }
    seenMatches.add(matchKey);
    return { match, value: output };
  }).sort((left, right) => compareDecimals(
    decimalFromString(
      left.match,
      `${path}.entries.match`,
      "invalid_specification",
      MAX_INPUT_DECIMAL_PLACES,
    ),
    decimalFromString(
      right.match,
      `${path}.entries.match`,
      "invalid_specification",
      MAX_INPUT_DECIMAL_PLACES,
    ),
  ));
  const step: CreditexCalculatorLookupStep = {
    kind: "lookup",
    key,
    source,
    inputUnit,
    outputUnit,
    entries,
  };
  symbols.set(key, outputUnit);
  return step;
}

function capStep(
  value: UnknownRecord,
  index: number,
  symbols: Map<string, string>,
): CreditexCalculatorCapStep {
  const path = `specification.steps[${index}]`;
  exactKeys(
    value,
    ["kind", "key", "source", "unit", "minimum", "maximum"],
    path,
    "invalid_specification",
  );
  const key = validateStepKey(value.key, symbols, path);
  const source = keyValue(
    value.source,
    `${path}.source`,
    "invalid_specification",
  );
  const unit = unitValue(
    value.unit,
    `${path}.unit`,
    "invalid_specification",
  );
  validateSourceUnit(symbols, source, unit, path);
  if (value.minimum === undefined && value.maximum === undefined) {
    fail(
      "invalid_specification",
      path,
      "cap requires a minimum, a maximum, or both",
    );
  }
  const step: CreditexCalculatorCapStep = {
    kind: "cap",
    key,
    source,
    unit,
  };
  if (value.minimum !== undefined) {
    step.minimum = specificationDecimal(value.minimum, `${path}.minimum`);
  }
  if (value.maximum !== undefined) {
    step.maximum = specificationDecimal(value.maximum, `${path}.maximum`);
  }
  if (
    step.minimum !== undefined
    && step.maximum !== undefined
    && compareDecimals(
      decimalFromString(
        step.minimum,
        `${path}.minimum`,
        "invalid_specification",
        MAX_INPUT_DECIMAL_PLACES,
      ),
      decimalFromString(
        step.maximum,
        `${path}.maximum`,
        "invalid_specification",
        MAX_INPUT_DECIMAL_PLACES,
      ),
    ) > 0
  ) {
    fail(
      "invalid_specification",
      path,
      "minimum must not exceed maximum",
    );
  }
  symbols.set(key, unit);
  return step;
}

function roundingStep(
  value: UnknownRecord,
  index: number,
  symbols: Map<string, string>,
): CreditexCalculatorRoundingStep {
  const path = `specification.steps[${index}]`;
  exactKeys(
    value,
    ["kind", "key", "source", "unit", "mode", "decimalPlaces"],
    path,
    "invalid_specification",
  );
  const key = validateStepKey(value.key, symbols, path);
  const source = keyValue(
    value.source,
    `${path}.source`,
    "invalid_specification",
  );
  const unit = unitValue(
    value.unit,
    `${path}.unit`,
    "invalid_specification",
  );
  validateSourceUnit(symbols, source, unit, path);
  if (
    value.mode !== "floor"
    && value.mode !== "ceiling"
    && value.mode !== "nearest_half_away_from_zero"
  ) {
    fail(
      "invalid_specification",
      `${path}.mode`,
      "must be floor, ceiling, or nearest_half_away_from_zero",
    );
  }
  const step: CreditexCalculatorRoundingStep = {
    kind: "rounding",
    key,
    source,
    unit,
    mode: value.mode,
    decimalPlaces: integerValue(
      value.decimalPlaces,
      `${path}.decimalPlaces`,
      "invalid_specification",
      0,
      MAX_INPUT_DECIMAL_PLACES,
    ),
  };
  symbols.set(key, unit);
  return step;
}

function calculatorStep(
  value: unknown,
  index: number,
  symbols: Map<string, string>,
): CreditexCalculatorStep {
  const path = `specification.steps[${index}]`;
  const step = recordValue(value, path, "invalid_specification");
  if (step.kind === "factor") {
    return factorStep(step, index, symbols);
  }
  if (step.kind === "multiply") {
    return multiplyStep(step, index, symbols);
  }
  if (step.kind === "lookup") {
    return lookupStep(step, index, symbols);
  }
  if (step.kind === "cap") {
    return capStep(step, index, symbols);
  }
  if (step.kind === "rounding") {
    return roundingStep(step, index, symbols);
  }
  fail(
    "invalid_specification",
    `${path}.kind`,
    "must be factor, multiply, lookup, cap, or rounding",
  );
}

export function validateCreditexCalculatorSpecification(
  value: unknown,
): CreditexCalculatorSpecification {
  const specification = recordValue(
    value,
    "specification",
    "invalid_specification",
  );
  exactKeys(
    specification,
    ["schemaVersion", "key", "version", "title", "inputs", "steps", "output"],
    "specification",
    "invalid_specification",
  );
  if (specification.schemaVersion !== CREDITEX_CALCULATOR_SPEC_SCHEMA) {
    fail(
      "invalid_specification",
      "specification.schemaVersion",
      `must equal ${CREDITEX_CALCULATOR_SPEC_SCHEMA}`,
    );
  }
  if (
    !Array.isArray(specification.inputs)
    || specification.inputs.length === 0
    || specification.inputs.length > MAX_INPUTS
  ) {
    fail(
      "invalid_specification",
      "specification.inputs",
      `must contain between 1 and ${MAX_INPUTS} inputs`,
    );
  }
  if (
    !Array.isArray(specification.steps)
    || specification.steps.length === 0
    || specification.steps.length > MAX_STEPS
  ) {
    fail(
      "invalid_specification",
      "specification.steps",
      `must contain between 1 and ${MAX_STEPS} steps`,
    );
  }
  const inputs = specification.inputs
    .map((input, index) => inputDefinition(input, index))
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  const symbols = new Map<string, string>();
  for (const input of inputs) {
    if (symbols.has(input.key)) {
      fail(
        "invalid_specification",
        "specification.inputs",
        `contains duplicate input key ${input.key}`,
      );
    }
    symbols.set(input.key, input.unit);
  }
  const steps = specification.steps.map(
    (step, index) => calculatorStep(step, index, symbols),
  );
  const output = recordValue(
    specification.output,
    "specification.output",
    "invalid_specification",
  );
  exactKeys(
    output,
    ["source", "unit"],
    "specification.output",
    "invalid_specification",
  );
  const outputSource = keyValue(
    output.source,
    "specification.output.source",
    "invalid_specification",
  );
  const outputUnit = unitValue(
    output.unit,
    "specification.output.unit",
    "invalid_specification",
  );
  const sourceUnit = symbols.get(outputSource);
  if (!sourceUnit) {
    fail(
      "source_not_found",
      "specification.output.source",
      `does not reference an input or step: ${outputSource}`,
    );
  }
  if (sourceUnit !== outputUnit) {
    fail(
      "unit_mismatch",
      "specification.output.unit",
      `expected ${sourceUnit} for source ${outputSource}, received ${outputUnit}`,
    );
  }
  return {
    schemaVersion: CREDITEX_CALCULATOR_SPEC_SCHEMA,
    key: keyValue(
      specification.key,
      "specification.key",
      "invalid_specification",
    ),
    version: integerValue(
      specification.version,
      "specification.version",
      "invalid_specification",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    title: requiredString(
      specification.title,
      "specification.title",
      "invalid_specification",
      120,
    ),
    inputs,
    steps,
    output: {
      source: outputSource,
      unit: outputUnit,
    },
  };
}

function engineContractPayload(
  specification: CreditexCalculatorSpecification,
) {
  return {
    contractId: CREDITEX_CALCULATOR_ENGINE_CONTRACT_ID,
    engineVersion: CREDITEX_CALCULATOR_ENGINE_VERSION,
    decimalEncoding: {
      authoritativeType: "string",
      inputFormat: "plain-base-10-fixed-point",
      outputFormat: "canonical-base-10-fixed-point",
    },
    limits: {
      maxAbsoluteValue: MAX_ABSOLUTE_DECIMAL,
      maxInputDecimalPlaces: MAX_INPUT_DECIMAL_PLACES,
      maxInternalDecimalPlaces: MAX_INTERNAL_DECIMAL_PLACES,
    },
    roundingModes: [
      "floor",
      "ceiling",
      "nearest_half_away_from_zero",
    ],
    specification,
  };
}

export function creditexCalculatorEngineContractHash(
  specification: unknown,
): string {
  const validated = validateCreditexCalculatorSpecification(specification);
  return sha256(engineContractPayload(validated));
}

function runtimeInputs(
  specification: CreditexCalculatorSpecification,
  value: unknown,
): {
  values: Map<string, RuntimeValue>;
  canonical: Array<{ key: string; decimal: string; unit: string }>;
} {
  const inputs = recordValue(value, "inputs", "invalid_input");
  const definitions = new Map(
    specification.inputs.map((definition) => [definition.key, definition]),
  );
  for (const key of Object.keys(inputs)) {
    if (!definitions.has(key)) {
      fail("invalid_input", `inputs.${key}`, "is not declared by the specification");
    }
  }
  const values = new Map<string, RuntimeValue>();
  const canonical: Array<{ key: string; decimal: string; unit: string }> = [];
  for (const definition of specification.inputs) {
    const path = `inputs.${definition.key}`;
    if (!(definition.key in inputs)) {
      fail("missing_input", path, "is required");
    }
    const input = recordValue(inputs[definition.key], path, "invalid_input");
    exactKeys(input, ["value", "unit"], path, "invalid_input");
    const unit = unitValue(input.unit, `${path}.unit`, "invalid_input");
    if (unit !== definition.unit) {
      fail(
        "unit_mismatch",
        `${path}.unit`,
        `expected ${definition.unit}, received ${unit}`,
      );
    }
    const decimal = decimalFromString(
      input.value,
      `${path}.value`,
      "invalid_input",
      definition.precision,
    );
    if (
      definition.minimum !== undefined
      && compareDecimals(
        decimal,
        decimalFromString(
          definition.minimum,
          `specification.inputs.${definition.key}.minimum`,
          "invalid_specification",
          MAX_INPUT_DECIMAL_PLACES,
        ),
      ) < 0
    ) {
      fail(
        "invalid_input",
        `${path}.value`,
        `must be at least ${definition.minimum}`,
      );
    }
    if (
      definition.maximum !== undefined
      && compareDecimals(
        decimal,
        decimalFromString(
          definition.maximum,
          `specification.inputs.${definition.key}.maximum`,
          "invalid_specification",
          MAX_INPUT_DECIMAL_PLACES,
        ),
      ) > 0
    ) {
      fail(
        "invalid_input",
        `${path}.value`,
        `must not exceed ${definition.maximum}`,
      );
    }
    values.set(definition.key, { decimal, unit });
    canonical.push({
      key: definition.key,
      decimal: decimalText(decimal),
      unit,
    });
  }
  return { values, canonical };
}

function sourceValue(
  values: Map<string, RuntimeValue>,
  source: string,
  path: string,
): RuntimeValue {
  const value = values.get(source);
  if (!value) {
    fail("source_not_found", path, `runtime source is unavailable: ${source}`);
  }
  return value;
}

function executeStep(
  step: CreditexCalculatorStep,
  values: Map<string, RuntimeValue>,
  index: number,
): RuntimeValue {
  const path = `steps[${index}]`;
  if (step.kind === "multiply") {
    const left = sourceValue(values, step.leftSource, `${path}.leftSource`);
    const right = sourceValue(values, step.rightSource, `${path}.rightSource`);
    if (left.unit !== step.leftUnit || right.unit !== step.rightUnit) {
      fail(
        "unit_mismatch",
        path,
        `expected ${step.leftUnit} multiplied by ${step.rightUnit}, received ${left.unit} multiplied by ${right.unit}`,
      );
    }
    return {
      decimal: multiplyDecimals(left.decimal, right.decimal, `${path}.output`),
      unit: step.outputUnit,
    };
  }
  const source = sourceValue(values, step.source, `${path}.source`);
  if (step.kind === "factor") {
    if (source.unit !== step.inputUnit) {
      fail(
        "unit_mismatch",
        `${path}.inputUnit`,
        `expected runtime unit ${step.inputUnit}, received ${source.unit}`,
      );
    }
    return {
      decimal: multiplyDecimals(
        source.decimal,
        decimalFromString(
          step.factor,
          `${path}.factor`,
          "invalid_specification",
          MAX_INPUT_DECIMAL_PLACES,
        ),
        `${path}.output`,
      ),
      unit: step.outputUnit,
    };
  }
  if (step.kind === "lookup") {
    if (source.unit !== step.inputUnit) {
      fail(
        "unit_mismatch",
        `${path}.inputUnit`,
        `expected runtime unit ${step.inputUnit}, received ${source.unit}`,
      );
    }
    const entry = step.entries.find((candidate) => compareDecimals(
      source.decimal,
      decimalFromString(
        candidate.match,
        `${path}.entries.match`,
        "invalid_specification",
        MAX_INPUT_DECIMAL_PLACES,
      ),
    ) === 0);
    if (!entry) {
      fail(
        "missing_lookup",
        `${path}.entries`,
        `has no exact match for ${decimalText(source.decimal)} ${source.unit}`,
      );
    }
    return {
      decimal: decimalFromString(
        entry.value,
        `${path}.entries.value`,
        "invalid_specification",
        MAX_INPUT_DECIMAL_PLACES,
      ),
      unit: step.outputUnit,
    };
  }
  if (source.unit !== step.unit) {
    fail(
      "unit_mismatch",
      `${path}.unit`,
      `expected runtime unit ${step.unit}, received ${source.unit}`,
    );
  }
  if (step.kind === "cap") {
    let decimal = source.decimal;
    if (step.minimum !== undefined) {
      const minimum = decimalFromString(
        step.minimum,
        `${path}.minimum`,
        "invalid_specification",
        MAX_INPUT_DECIMAL_PLACES,
      );
      if (compareDecimals(decimal, minimum) < 0) {
        decimal = minimum;
      }
    }
    if (step.maximum !== undefined) {
      const maximum = decimalFromString(
        step.maximum,
        `${path}.maximum`,
        "invalid_specification",
        MAX_INPUT_DECIMAL_PLACES,
      );
      if (compareDecimals(decimal, maximum) > 0) {
        decimal = maximum;
      }
    }
    return { decimal, unit: step.unit };
  }
  return {
    decimal: roundDecimal(
      source.decimal,
      step.decimalPlaces,
      step.mode,
    ),
    unit: step.unit,
  };
}

export function evaluateCreditexCalculator(
  specificationValue: unknown,
  inputsValue: unknown,
): CreditexCalculatorExecutionReceipt {
  const specification = validateCreditexCalculatorSpecification(
    specificationValue,
  );
  const engineContractHash = sha256(engineContractPayload(specification));
  const inputs = runtimeInputs(specification, inputsValue);
  const values = inputs.values;
  const trace: CreditexCalculatorTraceEntry[] = [];
  specification.steps.forEach((step, index) => {
    const source = step.kind === "multiply"
      ? sourceValue(values, step.leftSource, `steps[${index}].leftSource`)
      : sourceValue(values, step.source, `steps[${index}].source`);
    const output = executeStep(step, values, index);
    values.set(step.key, output);
    trace.push({
      stepKey: step.key,
      kind: step.kind,
      source: step.kind === "multiply" ? step.leftSource : step.source,
      input: {
        decimal: decimalText(source.decimal),
        unit: source.unit,
      },
      ...(step.kind === "multiply"
        ? {
            secondarySource: step.rightSource,
            secondaryInput: {
              decimal: decimalText(sourceValue(
                values,
                step.rightSource,
                `steps[${index}].rightSource`,
              ).decimal),
              unit: sourceValue(
                values,
                step.rightSource,
                `steps[${index}].rightSource`,
              ).unit,
            },
          }
        : {}),
      output: {
        decimal: decimalText(output.decimal),
        unit: output.unit,
      },
    });
  });
  const output = sourceValue(
    values,
    specification.output.source,
    "specification.output.source",
  );
  const result: CreditexCalculatorValue = {
    decimal: decimalText(output.decimal),
    unit: output.unit,
  };
  const receipt = {
    schemaVersion: CREDITEX_CALCULATOR_RECEIPT_SCHEMA,
    engineVersion: CREDITEX_CALCULATOR_ENGINE_VERSION,
    engineContractHash,
    inputHash: sha256(inputs.canonical),
    traceHash: sha256(trace),
    outputHash: sha256(result),
    output: result,
    trace,
  };
  return {
    ...receipt,
    receiptHash: sha256(receipt),
  };
}

function expectedOutput(
  value: unknown,
  path: string,
  requiredUnit: string,
): { decimal: string; unit: string } {
  const expected = recordValue(value, path, "invalid_suite");
  exactKeys(expected, ["value", "unit"], path, "invalid_suite");
  const unit = unitValue(expected.unit, `${path}.unit`, "invalid_suite");
  if (unit !== requiredUnit) {
    fail(
      "unit_mismatch",
      `${path}.unit`,
      `expected ${requiredUnit}, received ${unit}`,
    );
  }
  return {
    decimal: decimalText(decimalFromString(
      expected.value,
      `${path}.value`,
      "invalid_suite",
      MAX_INTERNAL_DECIMAL_PLACES,
    )),
    unit,
  };
}

export function runCreditexCalculatorTestSuite(
  specificationValue: unknown,
  vectorsValue: unknown,
): CreditexCalculatorSuiteReceipt {
  const specification = validateCreditexCalculatorSpecification(
    specificationValue,
  );
  if (
    !Array.isArray(vectorsValue)
    || vectorsValue.length === 0
    || vectorsValue.length > 500
  ) {
    fail(
      "invalid_suite",
      "vectors",
      "must contain between 1 and 500 test vectors",
    );
  }
  const seenKeys = new Set<string>();
  const vectors = vectorsValue.map((value, index) => {
    const path = `vectors[${index}]`;
    const vector = recordValue(value, path, "invalid_suite");
    exactKeys(vector, ["key", "inputs", "expected"], path, "invalid_suite");
    const key = keyValue(vector.key, `${path}.key`, "invalid_suite");
    if (seenKeys.has(key)) {
      fail("invalid_suite", `${path}.key`, `duplicates vector key ${key}`);
    }
    seenKeys.add(key);
    return {
      key,
      inputs: vector.inputs,
      expected: vector.expected,
    };
  }).sort((left, right) => (
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0
  ));
  const canonicalVectors: Array<{
    key: string;
    inputHash: string;
    expected: { decimal: string; unit: string };
  }> = [];
  const cases = vectors.map((vector) => {
    const path = `vectors.${vector.key}`;
    const execution = evaluateCreditexCalculator(
      specification,
      vector.inputs,
    );
    const expected = expectedOutput(
      vector.expected,
      `${path}.expected`,
      specification.output.unit,
    );
    const expectedOutputHash = sha256(expected);
    const actual = {
      decimal: execution.output.decimal,
      unit: execution.output.unit,
    };
    canonicalVectors.push({
      key: vector.key,
      inputHash: execution.inputHash,
      expected,
    });
    return {
      key: vector.key,
      inputHash: execution.inputHash,
      expectedOutputHash,
      actualOutputHash: sha256(actual),
      executionReceiptHash: execution.receiptHash,
      passed: canonicalJson(expected) === canonicalJson(actual),
    };
  });
  const engineContractHash = sha256(engineContractPayload(specification));
  const suiteHash = sha256(canonicalVectors);
  const receipt = {
    schemaVersion: CREDITEX_CALCULATOR_SUITE_RECEIPT_SCHEMA,
    engineVersion: CREDITEX_CALCULATOR_ENGINE_VERSION,
    engineContractHash,
    suiteHash,
    passed: cases.every((entry) => entry.passed),
    cases,
  };
  return {
    ...receipt,
    receiptHash: sha256(receipt),
  };
}
