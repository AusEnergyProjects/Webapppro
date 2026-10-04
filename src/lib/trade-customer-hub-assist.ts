export type TradeHubAssistItem = { text: string; sourceIds: string[] };
export type TradeHubAssistDraft = { brief: TradeHubAssistItem[]; draftScope: TradeHubAssistItem[] };

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Validate again at the application boundary, including model-supplied citations. */
export function parseTradeHubAssistDraft(value: unknown, sourceIds: readonly string[]): TradeHubAssistDraft {
  const allowed = new Set(sourceIds);
  if (!record(value) || Object.keys(value).length !== 2) throw new Error("WORKFLOW_AI_INCOMPLETE");
  function items(input: unknown): TradeHubAssistItem[] {
    if (!Array.isArray(input) || input.length < 1 || input.length > 8) throw new Error("WORKFLOW_AI_INCOMPLETE");
    return input.map(item => {
      if (!record(item) || Object.keys(item).length !== 2 || typeof item.text !== "string" || !item.text.trim() || item.text.length > 600
        || !Array.isArray(item.sourceIds) || item.sourceIds.length < 1 || item.sourceIds.length > 5
        || item.sourceIds.some(id => typeof id !== "string" || !allowed.has(id))) throw new Error("WORKFLOW_AI_INCOMPLETE");
      // This helper drafts work scope, never money or compliance determinations.
      if (/(?:[$£€]\s*\d|\b(?:AUD|USD|EUR|GBP)\s*\d|\b(?:legally compliant|fully compliant|compliance approved|guaranteed savings)\b)/i.test(item.text)) throw new Error("WORKFLOW_AI_INCOMPLETE");
      return { text: item.text.trim(), sourceIds: [...new Set(item.sourceIds)] };
    });
  }
  return { brief: items(value.brief), draftScope: items(value.draftScope) };
}

export function tradeHubAssistSchema(sourceIds: readonly string[]) {
  const item = { type: "object", additionalProperties: false, required: ["text", "sourceIds"], properties: {
    text: { type: "string", minLength: 1, maxLength: 600 },
    sourceIds: { type: "array", minItems: 1, maxItems: 5, items: { type: "string", enum: [...sourceIds] } },
  } };
  return { type: "object", additionalProperties: false, required: ["brief", "draftScope"], properties: {
    brief: { type: "array", minItems: 1, maxItems: 8, items: item },
    draftScope: { type: "array", minItems: 1, maxItems: 8, items: item },
  } };
}
