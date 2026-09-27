import { normalizeSolarDesignEquipment, type SolarDesignEquipment } from "./trade-solar-equipment.ts";

export type QuoteEquipmentGroup = { choiceKey: string; items: SolarDesignEquipment };
export type QuoteEquipment = { common: SolarDesignEquipment; choices: QuoteEquipmentGroup[] };

export function normaliseQuoteEquipment(value: unknown): QuoteEquipment {
  if (value === undefined || value === null || value === "") return { common: [], choices: [] };
  const input: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("INVALID_QUOTE_EQUIPMENT");
  const common = normalizeSolarDesignEquipment(Reflect.get(input, "common"));
  const rawChoices: unknown = Reflect.get(input, "choices");
  if (!Array.isArray(rawChoices) || rawChoices.length > 20) throw new Error("INVALID_QUOTE_EQUIPMENT");
  const seen = new Set<string>();
  const choices = rawChoices.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("INVALID_QUOTE_EQUIPMENT");
    const choiceKey: unknown = Reflect.get(entry, "choiceKey");
    if (typeof choiceKey !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(choiceKey) || seen.has(choiceKey)) throw new Error("INVALID_QUOTE_EQUIPMENT");
    seen.add(choiceKey);
    return { choiceKey, items: normalizeSolarDesignEquipment(Reflect.get(entry, "items")) };
  });
  return { common, choices };
}

/** Choice keys are draft client keys, resolved to immutable choice IDs on issue. */
export function quoteEquipmentForChoices(value: unknown, choiceKeys: readonly string[]): QuoteEquipment {
  const equipment = normaliseQuoteEquipment(value);
  if (equipment.choices.some((group) => !choiceKeys.includes(group.choiceKey))) throw new Error("INVALID_QUOTE_EQUIPMENT");
  return equipment;
}
