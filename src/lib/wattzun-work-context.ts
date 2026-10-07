import type { WattzunPortal } from "./wattzun-portal";
import { wattzunPortalForPath } from "./wattzun-portal-path.ts";

export type WattzunWorkReference =
  | { kind: "trade_job"; recordId: string }
  | { kind: "creditex_audit"; recordId: string }
  | { kind: "council_report"; period: "quarter" | "year" | "all" };

/** References are supplied by the UI; record contents are loaded by the authorised server. */
export function readWattzunWorkReference(value: unknown, portal: WattzunPortal): WattzunWorkReference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !("kind" in value)) return null;
  if (value.kind === "council_report" && portal === "council" && "period" in value
    && (value.period === "quarter" || value.period === "year" || value.period === "all")) {
    return { kind: "council_report", period: value.period };
  }
  if (!((value.kind === "trade_job" && portal === "trade") || (value.kind === "creditex_audit" && portal === "creditex"))
    || !("recordId" in value) || typeof value.recordId !== "string" || !/^[A-Za-z0-9:_-]{1,180}$/.test(value.recordId)) return null;
  return { kind: value.kind, recordId: value.recordId };
}

export type WattzunWorkSource = { id: string; label: string; href: string; description: string };
export type WattzunWorkContext = {
  reference: WattzunWorkReference;
  title: string;
  sourceSha256: string;
  sources: WattzunWorkSource[];
  facts: unknown;
  limitations: string[];
};
export type WattzunWorkContextInfo = Pick<WattzunWorkContext, "reference" | "title" | "sourceSha256" | "limitations"> & {
  sources: Array<{ label: string; href: string }>;
};

export function readWattzunWorkContextInfo(value: unknown, portal: WattzunPortal): WattzunWorkContextInfo | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("reference" in value)
    || !("title" in value) || typeof value.title !== "string" || !value.title.trim() || value.title.length > 240
    || !("sourceSha256" in value) || typeof value.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sourceSha256)
    || !("sources" in value) || !Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > 6
    || !("limitations" in value) || !Array.isArray(value.limitations) || value.limitations.length > 8
    || !value.limitations.every(item => typeof item === "string" && item.length <= 1000)) return null;
  const reference = readWattzunWorkReference(value.reference, portal);
  if (!reference) return null;
  const sources: WattzunWorkContextInfo["sources"] = [];
  for (const source of value.sources) {
    if (!source || typeof source !== "object" || Array.isArray(source) || !("label" in source)
      || typeof source.label !== "string" || !source.label.trim() || source.label.length > 240
      || !("href" in source) || typeof source.href !== "string" || !/^\/(?!\/)/.test(source.href) || source.href.length > 600) return null;
    const url = new URL(source.href, "https://wattzun.invalid");
    if (url.origin !== "https://wattzun.invalid" || wattzunPortalForPath(url.pathname) !== portal) return null;
    sources.push({ label: source.label, href: source.href });
  }
  return { reference, title: value.title, sourceSha256: value.sourceSha256, sources, limitations: [...value.limitations] };
}

export class WattzunWorkContextError extends Error {
  readonly status: 403 | 409 | 413 | 503;
  constructor(status: 403 | 409 | 413 | 503, message: string) {
    super(message); this.status = status; this.name = "WattzunWorkContextError";
  }
}

export function wattzunWorkLabel(reference: WattzunWorkReference): string {
  if (reference.kind === "council_report") return `Council report: ${reference.period === "quarter" ? "this quarter" : reference.period === "year" ? "this year" : "all time"}`;
  return reference.kind === "trade_job" ? "Selected TLink job" : "Selected Creditex audit";
}
