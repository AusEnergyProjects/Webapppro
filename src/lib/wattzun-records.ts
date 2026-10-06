import { WattzunInputError } from "./wattzun-portal.ts";

export type WattzunRecordLookup = { kind: "job" | "file"; query: string };
export const WATTZUN_RECORD_LOOKUP_SCHEMA = {
  type: "object", additionalProperties: false, required: ["kind", "query"],
  properties: { kind: { type: "string", enum: ["job", "file"] }, query: { type: "string", maxLength: 100 } },
};

export function parseWattzunRecordLookup(value: unknown): WattzunRecordLookup {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 2
    || !("kind" in value) || (value.kind !== "job" && value.kind !== "file")
    || !("query" in value) || typeof value.query !== "string" || value.query.length > 100
    || /[\u0000-\u001f\u007f]/.test(value.query)) {
    throw new WattzunInputError("Choose a job number or customer name to find the record.");
  }
  return { kind: value.kind, query: value.query.trim() };
}

export type WattzunJobMatch = { id: string; workNumber: string; title: string };
export function readWattzunJobMatches(value: unknown): WattzunJobMatch[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error("The job search could not be read. Try again.");
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)
      || !("id" in item) || typeof item.id !== "string" || !/^[A-Za-z0-9:_-]{1,180}$/.test(item.id)
      || !("workNumber" in item) || typeof item.workNumber !== "string" || item.workNumber.length > 100
      || !("title" in item) || typeof item.title !== "string" || item.title.length > 500) {
      throw new Error("The job search could not be read. Try again.");
    }
    return { id: item.id, workNumber: item.workNumber, title: item.title };
  });
}

export function wattzunJobHref(id: string, kind: WattzunRecordLookup["kind"]): string {
  if (!/^[A-Za-z0-9:_-]{1,180}$/.test(id) || (kind !== "job" && kind !== "file")) throw new WattzunInputError("Choose a listed job.");
  return `/direct-trade/dashboard?workspace=work&jobId=${encodeURIComponent(id)}&jobTab=${kind === "file" ? "field" : "summary"}`;
}
