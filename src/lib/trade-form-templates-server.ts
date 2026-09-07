import { getD1 } from "../../db";
import { tradeFormTemplatesFor } from "@/lib/trade-form-library.mjs";

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

export async function publishedTradeFormTemplatesFor(serviceCategory: string, database?: D1Database, ownerUid = ""): Promise<TradeFormTemplate[]> {
  const builtIns = tradeFormTemplatesFor(serviceCategory) as TradeFormTemplate[];
  const rows = await (database || getD1()).prepare(`SELECT template_key, version, name, jurisdiction, categories, description, guidance, fields, status
    FROM trade_form_templates candidate
    WHERE (scope_owner_uid = '' OR scope_owner_uid = ?) AND status <> 'draft'
      AND version = (SELECT MAX(newer.version) FROM trade_form_templates newer
        WHERE newer.template_key = candidate.template_key AND newer.scope_owner_uid = candidate.scope_owner_uid
          AND newer.status <> 'draft')
    ORDER BY template_key`).bind(ownerUid).all<Record<string, unknown>>();
  const governed = rows.results.filter((row) => row.status === "published").map((row) => ({
    key: String(row.template_key), version: Number(row.version), name: String(row.name),
    jurisdiction: String(row.jurisdiction), categories: parseList<string>(row.categories),
    description: String(row.description), guidance: String(row.guidance),
    fields: parseList<TradeFormField>(row.fields), governed: true,
  })).filter((template) => template.categories.includes(serviceCategory || "other"));
  const governedKeys = new Set(rows.results.map((row) => String(row.template_key)));
  return [...builtIns.filter((template) => !governedKeys.has(template.key)), ...governed]
    .sort((left, right) => left.name.localeCompare(right.name) || right.version - left.version);
}

export async function publishedTradeFormTemplate(key: string, version: number, serviceCategory: string, database?: D1Database, ownerUid = "") {
  const governed = (await publishedTradeFormTemplatesFor(serviceCategory, database, ownerUid))
    .find((template) => template.key === key && template.version === version);
  return governed || null;
}
