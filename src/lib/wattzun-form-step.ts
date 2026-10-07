export type WattzunFormStep =
  | { kind: "reference_document"; fieldKey: string; sourceArtifactId: string; acknowledged: true }
  | { kind: "official_product"; dependencyKey: string; search: string; selections: Array<{ selectionId: string; snapshotId: string; quantity: number }> }
  | { kind: "scenario"; dependencyKey: string; scenarioCode: string }
  | { kind: "calculator"; dependencyKey: string }
  | { kind: "prepare_signing" };
export type WattzunFormProductSearch = { dependencyKey: string; search: string; resultsSha256?: string };
export type WattzunFormProductSearchAction = { kind: "search_form_products"; dependencyKey: string; search: string };
export type WattzunFormGuideStep =
  | { kind: "reference_document"; fieldKey: string; sourceArtifactId: string; sourceArtifactSha256: string; title: string; text: string; mode: "viewed" | "confirmed" }
  | { kind: "official_product"; dependencyKey: string; minimumCount: number; maximumCount: number; search: string; truncated: boolean; choices: Array<{ selectionId: string; snapshotId: string; label: string; brand: string; model: string }> }
  | { kind: "scenario"; dependencyKey: string; scenarioCodes: string[] }
  | { kind: "calculator"; dependencyKey: string }
  | { kind: "prepare_signing" };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const prose = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const identifier = (value: unknown): value is string => text(value, 600) && !/(?:^|[.[\]])(?:__proto__|constructor|prototype)(?:$|[.[\]])/.test(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const string = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
function schema(kind: WattzunFormStep["kind"], properties: Record<string, unknown>) {
  return { type: "object", additionalProperties: false, required: ["kind", ...Object.keys(properties)], properties: { kind: { type: "string", enum: [kind] }, ...properties } };
}
export const WATTZUN_FORM_STEP_SCHEMAS = [
  schema("reference_document", { fieldKey: string(600), sourceArtifactId: string(180), acknowledged: { type: "boolean", enum: [true] } }),
  schema("official_product", { dependencyKey: string(180), search: string(120), selections: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", additionalProperties: false, required: ["selectionId", "snapshotId", "quantity"], properties: { selectionId: string(600), snapshotId: string(180), quantity: { type: "integer", minimum: 1, maximum: 1000 } } } } }),
  schema("scenario", { dependencyKey: string(180), scenarioCode: string(180) }),
  schema("calculator", { dependencyKey: string(180) }),
  schema("prepare_signing", {}),
];
export const WATTZUN_FORM_PRODUCT_SEARCH_SCHEMA = { type: "object", additionalProperties: false, required: ["kind", "dependencyKey", "search"], properties: { kind: { type: "string", enum: ["search_form_products"] }, dependencyKey: string(180), search: string(120) } };
export function readWattzunFormProductSearchAction(value: unknown): WattzunFormProductSearchAction | null {
  if (!record(value) || !exact(value, ["kind", "dependencyKey", "search"]) || value.kind !== "search_form_products") return null;
  const query = readWattzunFormProductSearch({ dependencyKey: value.dependencyKey, search: value.search });
  return query ? { kind: value.kind, ...query } : null;
}
export function readWattzunFormProductSearch(value: unknown): WattzunFormProductSearch | null {
  if (!record(value) || !exact(value, ["dependencyKey", "search", ...(Object.hasOwn(value, "resultsSha256") ? ["resultsSha256"] : [])]) || !text(value.dependencyKey, 180) || !text(value.search, 120)
    || value.resultsSha256 !== undefined && (typeof value.resultsSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.resultsSha256))) return null;
  return { dependencyKey: value.dependencyKey, search: value.search, ...(typeof value.resultsSha256 === "string" ? { resultsSha256: value.resultsSha256 } : {}) };
}
export function readWattzunFormStep(value: unknown): WattzunFormStep | null {
  if (!record(value)) return null;
  if (value.kind === "prepare_signing" && exact(value, ["kind"])) return { kind: value.kind };
  if (value.kind === "reference_document" && exact(value, ["kind", "fieldKey", "sourceArtifactId", "acknowledged"]) && identifier(value.fieldKey) && text(value.sourceArtifactId, 180) && value.acknowledged === true) return { kind: value.kind, fieldKey: value.fieldKey, sourceArtifactId: value.sourceArtifactId, acknowledged: true };
  if (value.kind === "scenario" && exact(value, ["kind", "dependencyKey", "scenarioCode"]) && text(value.dependencyKey, 180) && text(value.scenarioCode, 180)) return { kind: value.kind, dependencyKey: value.dependencyKey, scenarioCode: value.scenarioCode };
  if (value.kind === "calculator" && exact(value, ["kind", "dependencyKey"]) && text(value.dependencyKey, 180)) return { kind: value.kind, dependencyKey: value.dependencyKey };
  if (value.kind === "official_product" && exact(value, ["kind", "dependencyKey", "search", "selections"]) && text(value.dependencyKey, 180) && text(value.search, 120) && Array.isArray(value.selections) && value.selections.length > 0 && value.selections.length <= 20) {
    const selections: Extract<WattzunFormStep, { kind: "official_product" }>["selections"] = [];
    for (const item of value.selections) {
      if (!record(item) || !exact(item, ["selectionId", "snapshotId", "quantity"]) || !text(item.selectionId, 600) || !text(item.snapshotId, 180) || typeof item.quantity !== "number" || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000) return null;
      selections.push({ selectionId: item.selectionId, snapshotId: item.snapshotId, quantity: item.quantity });
    }
    if (new Set(selections.map(item => item.selectionId)).size !== selections.length) return null;
    return { kind: value.kind, dependencyKey: value.dependencyKey, search: value.search, selections };
  }
  return null;
}
export function readWattzunFormGuideStep(value: unknown): WattzunFormGuideStep | null {
  if (!record(value)) return null;
  if (value.kind === "prepare_signing") return { kind: value.kind };
  if (value.kind === "reference_document" && identifier(value.fieldKey) && text(value.sourceArtifactId, 180) && /^(?:sha256:)?[a-f0-9]{64}$/.test(String(value.sourceArtifactSha256)) && typeof value.sourceArtifactSha256 === "string" && prose(value.title, 500) && prose(value.text, 8000) && (value.mode === "viewed" || value.mode === "confirmed")) return { kind: value.kind, fieldKey: value.fieldKey, sourceArtifactId: value.sourceArtifactId, sourceArtifactSha256: value.sourceArtifactSha256, title: value.title, text: value.text, mode: value.mode };
  if (value.kind === "calculator" && text(value.dependencyKey, 180)) return { kind: value.kind, dependencyKey: value.dependencyKey };
  if (value.kind === "scenario" && text(value.dependencyKey, 180) && Array.isArray(value.scenarioCodes) && value.scenarioCodes.length <= 100 && value.scenarioCodes.every(item => text(item, 180))) return { kind: value.kind, dependencyKey: value.dependencyKey, scenarioCodes: [...value.scenarioCodes] };
  if (value.kind === "official_product" && text(value.dependencyKey, 180) && typeof value.minimumCount === "number" && Number.isSafeInteger(value.minimumCount) && value.minimumCount >= 0
    && typeof value.maximumCount === "number" && Number.isSafeInteger(value.maximumCount) && value.maximumCount >= value.minimumCount && typeof value.search === "string" && value.search.length <= 120 && typeof value.truncated === "boolean" && Array.isArray(value.choices) && value.choices.length <= 5) {
    const choices: Extract<WattzunFormGuideStep, { kind: "official_product" }>["choices"] = [];
    for (const item of value.choices) {
      if (!record(item) || !text(item.selectionId, 600) || !text(item.snapshotId, 180) || !text(item.label, 500) || typeof item.brand !== "string" || item.brand.length > 240 || typeof item.model !== "string" || item.model.length > 240) return null;
      choices.push({ selectionId: item.selectionId, snapshotId: item.snapshotId, label: item.label, brand: item.brand, model: item.model });
    }
    return { kind: value.kind, dependencyKey: value.dependencyKey, minimumCount: value.minimumCount, maximumCount: value.maximumCount, search: value.search, truncated: value.truncated, choices };
  }
  return null;
}
