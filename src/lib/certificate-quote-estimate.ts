export type CertificateRegistrationFee = {
  /** AUD in ten-thousandths, preserving PRC's fractional-cent fee. */
  unitAmountTenThousandths: number;
  officialUrl: string;
  label: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  checkedOn: string;
  note: string;
};

export type CertificateQuoteEstimate = {
  status: "estimated";
  registrationFee: CertificateRegistrationFee;
  registrationFeeCents: number;
  allowancePercent: 10;
  allowanceCents: number;
  estimatedValueCents: number;
  asOf: string;
} | {
  status: "unavailable";
  reason: string;
};

const CHECKED_ON = "2026-10-05";
const STC_SOURCE = "https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-technology-certificates/create-small-scale-technology-certificates";
const NSW_SOURCE = "https://www.energysustainabilityschemes.nsw.gov.au/Accredited-Certificate-Providers/Operating-as-an-ACP/Costs-of-being-an-ACP";
const VEU_SOURCE = "https://www.vic.gov.au/notice-decision-victorian-energy-upgrades-program-fees-2026-onwards";
const GST_NOTE = "Published fee unchanged. GST not calculated.";

function registrationFee(code: string, activityCode: string): CertificateRegistrationFee | null {
  const fee: CertificateRegistrationFee = {
    checkedOn: CHECKED_ON, label: "Registration fee",
    unitAmountTenThousandths: 11_100, officialUrl: NSW_SOURCE,
    effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31", note: GST_NOTE,
  };
  switch (code) {
    case "VEEC":
      fee.unitAmountTenThousandths = 43_500;
      fee.officialUrl = VEU_SOURCE;
      fee.label = "VEEC creation fee";
      fee.effectiveTo = "2027-12-31";
      break;
    case "ESC": break;
    case "PRC":
      fee.unitAmountTenThousandths = 315;
      fee.effectiveFrom = "2025-11-01";
      fee.effectiveTo = "2026-10-31";
      break;
    case "STC": {
      const waterHeater = activityCode === "solar_water_heater" || activityCode === "air_source_heat_pump";
      if (!waterHeater && !["solar_pv", "small_wind", "small_hydro", "solar_battery"].includes(activityCode)) return null;
      fee.unitAmountTenThousandths = waterHeater ? 800 : 4_700;
      fee.officialUrl = STC_SOURCE;
      // Water-heater coverage starts at the verified regulation snapshot, not the fee's introduction.
      fee.effectiveFrom = waterHeater ? "2026-05-01" : activityCode === "solar_battery" ? "2025-07-01" : "2011-10-17";
      fee.effectiveTo = null;
      fee.note = `Assumes provider's account exceeds 250 certificates; standard fee applies to all. No per-job exemption. ${GST_NOTE}`;
      break;
    }
    default: return null;
  }
  return fee;
}

const unavailable = (reason: string): CertificateQuoteEstimate => ({ status: "unavailable", reason });

function validDate(value: string): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

/** Estimate a quote allowance at the current quote date, not the installation date. */
export function certificateQuoteEstimate({ code, activityCode, certificateCount, grossValueCents, asOf }: {
  code: string;
  activityCode: string;
  certificateCount: number;
  grossValueCents: number;
  asOf: string;
}): CertificateQuoteEstimate {
  if (!validDate(asOf)) return unavailable("Invalid quote date.");
  if (!Number.isSafeInteger(certificateCount) || certificateCount < 0
    || !Number.isSafeInteger(grossValueCents) || grossValueCents < 0
    || (certificateCount === 0 && grossValueCents !== 0)) {
    return unavailable("Invalid quantity or gross value.");
  }
  const fee = registrationFee(code, activityCode);
  if (!fee) return unavailable("No verified fee for this certificate activity.");
  if (asOf < fee.effectiveFrom || (fee.effectiveTo !== null && asOf > fee.effectiveTo)) {
    return unavailable("No verified fee for this quote date.");
  }

  // Round aggregate amounts half up to the nearest cent; never round PRC's unit fee.
  const registration = (BigInt(certificateCount) * BigInt(fee.unitAmountTenThousandths) + BigInt(50)) / BigInt(100);
  const gross = BigInt(grossValueCents);
  const allowance = (gross + BigInt(5)) / BigInt(10);
  const net = gross - registration - allowance;
  if (registration > BigInt(Number.MAX_SAFE_INTEGER) || allowance > BigInt(Number.MAX_SAFE_INTEGER)) {
    return unavailable("Deductions exceed safe range.");
  }
  if (net < BigInt(0)) return unavailable("Fee and allowance exceed gross value.");

  return {
    status: "estimated", registrationFee: fee,
    registrationFeeCents: Number(registration), allowancePercent: 10,
    allowanceCents: Number(allowance), estimatedValueCents: Number(net), asOf,
  };
}
