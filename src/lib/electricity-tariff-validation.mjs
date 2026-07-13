import { createHash } from "node:crypto";

export const ELECTRICITY_TARIFF_SCHEMA_VERSION = "aea-electricity-tariff-1.1.0";

const DAYS = new Set(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);
const DISCOUNT_METHODS = new Set(["percentOfBill", "percentOfUse", "fixedAmount"]);

function isNonNegativeDecimal(value) {
  return value !== null && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function validMonthDay(value) {
  if (!/^\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [month, day] = String(value).split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(2024, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validTime(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ""))) return false;
  const [hours, minutes] = String(value).split(":").map(Number);
  return hours >= 0 && hours <= 24 && minutes >= 0 && minutes < 60 && !(hours === 24 && minutes !== 0);
}

function validateRates(rates, path, errors) {
  if (!Array.isArray(rates) || !rates.length) {
    errors.push(path + ".rates is required");
    return;
  }
  rates.forEach((rate, index) => {
    if (!isNonNegativeDecimal(rate?.unitPrice)) errors.push(path + ".rates[" + index + "].unitPrice is invalid");
    if (rate?.volume != null && (!Number.isFinite(Number(rate.volume)) || Number(rate.volume) <= 0)) {
      errors.push(path + ".rates[" + index + "].volume is invalid");
    }
  });
}

function validateWindows(windows, path, errors) {
  if (!Array.isArray(windows) || !windows.length) {
    errors.push(path + ".timeOfUse is required");
    return;
  }
  windows.forEach((window, index) => {
    if (!Array.isArray(window?.days) || !window.days.length || window.days.some((day) => !DAYS.has(String(day).toUpperCase()))) {
      errors.push(path + ".timeOfUse[" + index + "].days is invalid");
    }
    if (!validTime(window?.startTime) || !validTime(window?.endTime)) {
      errors.push(path + ".timeOfUse[" + index + "] time range is invalid");
    }
  });
}

function validateRateBlock(block, path, errors) {
  if (block?.rateBlockUType === "singleRate") {
    if (!block.singleRate || typeof block.singleRate !== "object") errors.push(path + ".singleRate is required");
    else validateRates(block.singleRate.rates, path + ".singleRate", errors);
  } else if (block?.rateBlockUType === "timeOfUseRates") {
    if (!Array.isArray(block.timeOfUseRates) || !block.timeOfUseRates.length) errors.push(path + ".timeOfUseRates is required");
    else block.timeOfUseRates.forEach((rate, index) => {
      validateRates(rate?.rates, path + ".timeOfUseRates[" + index + "]", errors);
      validateWindows(rate?.timeOfUse, path + ".timeOfUseRates[" + index + "]", errors);
    });
  } else errors.push(path + ".rateBlockUType is unsupported");
}

function validDemandDays(value) {
  if (Array.isArray(value)) return value.length > 0 && value.every((day) => DAYS.has(String(day).toUpperCase()));
  return value && typeof value === "object" && ["weekdays", "saturday", "sunday"].some((key) => value[key] === true);
}

export function validateElectricityTariff(contract) {
  const errors = [];
  const limitations = new Set();
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return { valid: false, schemaVersion: ELECTRICITY_TARIFF_SCHEMA_VERSION, errors: ["electricityContract is required"], limitations: [] };
  }
  const periods = contract.tariffPeriod;
  if (!Array.isArray(periods) || !periods.length) {
    return { valid: false, schemaVersion: ELECTRICITY_TARIFF_SCHEMA_VERSION, errors: ["tariffPeriod is required"], limitations: [] };
  }

  let priceablePeriods = 0;
  periods.forEach((period, periodIndex) => {
    const path = "tariffPeriod[" + periodIndex + "]";
    if (period.startDate != null && !validMonthDay(period.startDate)) errors.push(path + ".startDate is invalid");
    if (period.endDate != null && !validMonthDay(period.endDate)) errors.push(path + ".endDate is invalid");
    const supply = period.dailySupplyCharges ?? period.dailySupplyCharge;
    if (period.rateBlockUType !== "demandCharges" && !isNonNegativeDecimal(supply)) {
      errors.push(path + ".dailySupplyCharge is invalid");
    }

    if (period.rateBlockUType === "singleRate") {
      priceablePeriods += 1;
      if (!period.singleRate || typeof period.singleRate !== "object") errors.push(path + ".singleRate is required");
      else validateRates(period.singleRate.rates, path + ".singleRate", errors);
    } else if (period.rateBlockUType === "timeOfUseRates") {
      priceablePeriods += 1;
      if (!Array.isArray(period.timeOfUseRates) || !period.timeOfUseRates.length) {
        errors.push(path + ".timeOfUseRates is required");
      } else {
        period.timeOfUseRates.forEach((rate, rateIndex) => {
          const ratePath = path + ".timeOfUseRates[" + rateIndex + "]";
          validateRates(rate?.rates, ratePath, errors);
          validateWindows(rate?.timeOfUse, ratePath, errors);
        });
      }
    } else if (period.rateBlockUType === "demandCharges") {
      if (!Array.isArray(period.demandCharges) || !period.demandCharges.length) errors.push(path + ".demandCharges is required");
      else period.demandCharges.forEach((charge, chargeIndex) => {
        const chargePath = path + ".demandCharges[" + chargeIndex + "]";
        if (!isNonNegativeDecimal(charge?.amount)) errors.push(chargePath + ".amount is invalid");
        if (!validTime(charge?.startTime) || !validTime(charge?.endTime)) errors.push(chargePath + " time range is invalid");
        if (!validDemandDays(charge?.days)) errors.push(chargePath + ".days is invalid");
        const measurement = String(charge?.measurementPeriod || "").toUpperCase();
        const charging = String(charge?.chargePeriod || "").toUpperCase();
        if (!((measurement === "DAY" && charging === "DAY") || (measurement === "MONTH" && (charging === "DAY" || charging === "MONTH")))) {
          errors.push(chargePath + ".measurementPeriod and chargePeriod are unsupported");
        }
        if (charge?.minDemand != null && !isNonNegativeDecimal(charge.minDemand)) errors.push(chargePath + ".minDemand is invalid");
        if (charge?.maxDemand != null && !isNonNegativeDecimal(charge.maxDemand)) errors.push(chargePath + ".maxDemand is invalid");
      });
    } else {
      errors.push(path + ".rateBlockUType is unsupported");
    }
  });

  if (!priceablePeriods) errors.push("At least one priceable energy tariff period is required");
  (contract.discounts || []).forEach((discount) => {
    if (!DISCOUNT_METHODS.has(discount?.methodUType)) limitations.add("unsupported_discount_not_costed");
  });
  if (Array.isArray(contract.fees) && contract.fees.length) limitations.add("fees_not_costed");
  if (Array.isArray(contract.incentives) && contract.incentives.length) limitations.add("incentives_not_costed");
  if (Array.isArray(contract.controlledLoad)) {
    if (contract.controlledLoad.length > 1) errors.push("controlledLoad supports one published register tariff");
    contract.controlledLoad.forEach((block, index) => {
      const path = "controlledLoad[" + index + "]";
      if (block?.dailyCharge != null && !isNonNegativeDecimal(block.dailyCharge)) errors.push(path + ".dailyCharge is invalid");
      validateRateBlock(block, path, errors);
    });
  }
  if (Array.isArray(contract.greenPowerCharges) && contract.greenPowerCharges.length) limitations.add("green_power_not_costed");

  return {
    valid: errors.length === 0,
    schemaVersion: ELECTRICITY_TARIFF_SCHEMA_VERSION,
    errors,
    limitations: [...limitations].sort(),
  };
}

export function stableStringify(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return "sha256:" + createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function tariffSourceHash(plans) {
  const manifest = plans
    .map((plan) => ({ planId: plan.planId, tariffHash: plan.tariffHash }))
    .sort((a, b) => (a.planId + a.tariffHash).localeCompare(b.planId + b.tariffHash));
  return sha256(manifest);
}
