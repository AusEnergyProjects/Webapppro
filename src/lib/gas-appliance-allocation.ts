export function gasApplianceAllocationStatus({ heating, hotWater, people }: { heating: string[]; hotWater: string; people: string }) {
  const missing: string[] = [];
  if (!heating.length) missing.push("your heating system or None");
  else if (heating.includes("gas-unspecified")) missing.push("your gas heating type (ducted, slab or room)");
  if (!hotWater) missing.push("your hot-water type");
  const count = Number(people);
  if (hotWater.startsWith("gas-") && (!Number.isInteger(count) || count < 1 || count > 8)) {
    missing.push("the number of people in your household");
  }
  return { ready: missing.length === 0, missing };
}
