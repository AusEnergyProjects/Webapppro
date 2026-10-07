export const WATTZUN_FORM_SAVED_EVENT = "wattzun:form-saved";
export type WattzunFormSavedDetail = {
  portal: "trade";
  scopeId: string;
  formKind: "job_form" | "activity_form" | "work_pack";
  formId: string;
  jobId: string;
};

/** This event only refreshes an already authorised editor. Data always comes from its canonical API. */
export function readWattzunFormSaved(value: unknown): WattzunFormSavedDetail | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (Object.keys(data).length !== 5 || data.portal !== "trade" || (data.formKind !== "job_form" && data.formKind !== "activity_form" && data.formKind !== "work_pack")) return null;
  if (typeof data.scopeId !== "string" || !data.scopeId || data.scopeId.length > 180
    || typeof data.formId !== "string" || !/^[A-Za-z0-9:_-]{1,180}$/.test(data.formId)
    || typeof data.jobId !== "string" || !/^[A-Za-z0-9:_-]{1,180}$/.test(data.jobId)) return null;
  return { portal: "trade", scopeId: data.scopeId, formKind: data.formKind, formId: data.formId, jobId: data.jobId };
}

export function dispatchWattzunFormSaved(detail: WattzunFormSavedDetail) {
  const parsed = readWattzunFormSaved(detail);
  if (parsed && typeof window !== "undefined") window.dispatchEvent(new CustomEvent(WATTZUN_FORM_SAVED_EVENT, { detail: parsed }));
}
