import { residentialStateFromPostcode } from "./australian-postcodes.mjs";

export function buildComparisonToolLink(target: "electricity" | "gas", postcode: string): string {
  const path = target === "electricity" ? "/compare" : "/gas-compare";
  const normalized = postcode.trim();
  if (!/^\d{4}$/.test(normalized) || !residentialStateFromPostcode(normalized)) return path;
  return `${path}?${new URLSearchParams({ pc: normalized }).toString()}`;
}
