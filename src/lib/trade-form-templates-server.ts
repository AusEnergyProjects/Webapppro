import { getD1 } from "../../db";
import { tradeFormTemplate, tradeFormTemplatesFor } from "@/lib/trade-form-library.mjs";

export type TradeFormField = {
  key: string;
  label: string;
  type: "checkbox" | "text" | "textarea" | "date" | "select";
  required: boolean;
  maxLength?: number;
  options?: string[];
};

export type TradeFormTemplate = {
  key: string;
  version: number;
  name: string;
  jurisdiction: string;
  categories: string[];
  description: string;
  guidance: string;
  fields: TradeFormField[];
  governed?: boolean;
};

function parseList<T>(value: unknown): T[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch { return []; }
}

export async function publishedTradeFormTemplatesFor(serviceCategory: string, database?: D1Database): Promise<TradeFormTemplate[]> {
  const builtIns = tradeFormTemplatesFor(serviceCategory) as TradeFormTemplate[];
  const rows = await (database || getD1()).prepare(`SELECT template_key, version, name, jurisdiction, categories, description, guidance, fields
    FROM trade_form_templates WHERE status = 'published' ORDER BY template_key, version`).all<Record<string, unknown>>();
  const governed = rows.results.map((row) => ({
    key: String(row.template_key), version: Number(row.version), name: String(row.name),
    jurisdiction: String(row.jurisdiction), categories: parseList<string>(row.categories),
    description: String(row.description), guidance: String(row.guidance),
    fields: parseList<TradeFormField>(row.fields), governed: true,
  })).filter((template) => template.categories.includes(serviceCategory || "other"));
  const governedKeys = new Set(governed.map((template) => `${template.key}:${template.version}`));
  return [...builtIns.filter((template) => !governedKeys.has(`${template.key}:${template.version}`)), ...governed]
    .sort((left, right) => left.name.localeCompare(right.name) || right.version - left.version);
}

export async function publishedTradeFormTemplate(key: string, version: number, serviceCategory: string, database?: D1Database) {
  const governed = (await publishedTradeFormTemplatesFor(serviceCategory, database))
    .find((template) => template.key === key && template.version === version);
  return governed || tradeFormTemplate(key, version, serviceCategory) as TradeFormTemplate | null;
}
