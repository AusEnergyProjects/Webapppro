export const NATIVE_COMPARISON_PATH = "/compare";

export type NativeShareState = {
  postcode: string;
  annualKwh: number;
  profileKind: "evening" | "daytime" | "even";
  customerType: "RESIDENTIAL" | "BUSINESS";
  setupMode: "none" | "solar" | "battery";
  solarKw?: number;
  batteryKwh?: number;
  exportKwh?: number;
  hasEv: boolean;
  hasControlledLoad: boolean;
  controlledKwh?: number;
  assumeConditional: boolean;
  usedMeter: boolean;
};

function finitePositive(value: string | null): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

export function buildNativeComparisonUrl(origin: string, state: NativeShareState): string {
  const query = new URLSearchParams({
    pc: state.postcode.slice(0, 4),
    kwh: String(Math.round(state.annualKwh)),
    profile: state.profileKind,
    cust: state.customerType,
    solar: state.setupMode,
    ev: state.hasEv ? "1" : "0",
    cl: state.hasControlledLoad ? "1" : "0",
    cond: state.assumeConditional ? "1" : "0",
    auto: "0",
  });
  if (state.setupMode !== "none" && state.solarKw && state.solarKw > 0) query.set("kw", String(state.solarKw));
  if (state.setupMode === "battery" && state.batteryKwh && state.batteryKwh > 0) query.set("bkwh", String(state.batteryKwh));
  if (state.setupMode !== "none" && state.exportKwh && state.exportKwh > 0) query.set("exp", String(Math.round(state.exportKwh)));
  if (!state.usedMeter && state.controlledKwh && state.controlledKwh > 0) query.set("clkwh", String(Math.round(state.controlledKwh)));
  if (state.usedMeter) query.set("meter", "reupload");
  return new URL(`${NATIVE_COMPARISON_PATH}?${query.toString()}`, origin).toString();
}

export function parseNativeComparisonQuery(search: string): Partial<NativeShareState> & { meterReupload: boolean } {
  const query = new URLSearchParams(search);
  const postcode = query.get("pc") || "";
  const profile = query.get("profile");
  const customer = query.get("cust");
  const solar = query.get("solar");
  const annualKwh = finitePositive(query.get("kwh"));
  return {
    ...(postcode && /^\d{4}$/.test(postcode) ? { postcode } : {}),
    ...(annualKwh ? { annualKwh } : {}),
    ...(profile === "evening" || profile === "daytime" || profile === "even" ? { profileKind: profile } : {}),
    ...(customer === "RESIDENTIAL" || customer === "BUSINESS" ? { customerType: customer } : {}),
    ...(solar === "none" || solar === "solar" || solar === "battery" ? { setupMode: solar } : {}),
    ...(finitePositive(query.get("kw")) ? { solarKw: finitePositive(query.get("kw")) } : {}),
    ...(finitePositive(query.get("bkwh")) ? { batteryKwh: finitePositive(query.get("bkwh")) } : {}),
    ...(finitePositive(query.get("exp")) ? { exportKwh: finitePositive(query.get("exp")) } : {}),
    ...(finitePositive(query.get("clkwh")) ? { controlledKwh: finitePositive(query.get("clkwh")) } : {}),
    hasEv: query.get("ev") === "1",
    hasControlledLoad: query.get("cl") === "1",
    assumeConditional: query.get("cond") === "1",
    meterReupload: query.get("meter") === "reupload",
  };
}
