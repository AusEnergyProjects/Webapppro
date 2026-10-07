export const WATTZUN_FORM_SAVED_EVENT = "wattzun:form-saved";
export type WattzunFormSavedDetail = {
  portal: "trade";
  scopeId: string;
  formKind: "job_form" | "activity_form" | "work_pack" | "veu_electrical";
  formId: string;
  jobId: string;
};

/** This event only refreshes an already authorised editor. Data always comes from its canonical API. */
export function readWattzunFormSaved(value: unknown): WattzunFormSavedDetail | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (Object.keys(data).length !== 5 || data.portal !== "trade" || (data.formKind !== "job_form" && data.formKind !== "activity_form" && data.formKind !== "work_pack" && data.formKind !== "veu_electrical")) return null;
  if (typeof data.scopeId !== "string" || !data.scopeId || data.scopeId.length > 180
    || typeof data.formId !== "string" || !/^[A-Za-z0-9:_-]{1,180}$/.test(data.formId)
    || typeof data.jobId !== "string" || !/^[A-Za-z0-9:_-]{1,180}$/.test(data.jobId)) return null;
  return { portal: "trade", scopeId: data.scopeId, formKind: data.formKind, formId: data.formId, jobId: data.jobId };
}

export function dispatchWattzunFormSaved(detail: WattzunFormSavedDetail) {
  const parsed = readWattzunFormSaved(detail);
  if (parsed && typeof window !== "undefined") window.dispatchEvent(new CustomEvent(WATTZUN_FORM_SAVED_EVENT, { detail: parsed }));
}

export const WATTZUN_FORM_REFRESHED_EVENT = "wattzun:form-refreshed";
export const WATTZUN_FORM_NATIVE_SAVED_EVENT = "wattzun:form-native-saved";
export const WATTZUN_FORM_FOCUS_EVENT = "wattzun:form-focus";
export type WattzunFormRefreshedDetail = WattzunFormSavedDetail & { oldFormId: string };
export function readWattzunFormRefreshed(value: unknown): WattzunFormRefreshedDetail | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { oldFormId, ...candidate } = Object.fromEntries(Object.entries(value));
  const saved = readWattzunFormSaved(candidate);
  return saved && typeof oldFormId === "string" && /^[A-Za-z0-9:_-]{1,180}$/.test(oldFormId) ? { ...saved, oldFormId } : null;
}
/** Emitted after an authorised editor has actually loaded its new canonical revision. */
export function dispatchWattzunFormRefreshed(detail: WattzunFormRefreshedDetail) {
  const parsed = readWattzunFormRefreshed(detail);
  if (parsed && typeof window !== "undefined") window.dispatchEvent(new CustomEvent(WATTZUN_FORM_REFRESHED_EVENT, { detail: parsed }));
}
/** A native control saved; consumers must reload authoritative progress before continuing. */
export function dispatchWattzunFormNativeSaved(detail: WattzunFormRefreshedDetail) {
  const parsed = readWattzunFormRefreshed(detail);
  if (parsed && typeof window !== "undefined") window.dispatchEvent(new CustomEvent(WATTZUN_FORM_NATIVE_SAVED_EVENT, { detail: parsed }));
}
/** Opens the selected native question without entering an answer or creating a signature. */
export function focusWattzunFormQuestion(detail: WattzunFormCaptureTarget): boolean {
  const parsed = readWattzunFormCaptureTarget(detail);
  if (!parsed || typeof window === "undefined") return false;
  return !window.dispatchEvent(new CustomEvent(WATTZUN_FORM_FOCUS_EVENT, { detail: parsed, cancelable: true }));
}

export const WATTZUN_FORM_CAPTURE_PREPARE_EVENT = "wattzun:form-capture-prepare";
export const WATTZUN_FORM_CAPTURE_READY_EVENT = "wattzun:form-capture-ready";
export const WATTZUN_FORM_CAPTURE_EVENT = "wattzun:form-capture";
export const WATTZUN_FORM_CAPTURE_SAVED_EVENT = "wattzun:form-capture-saved";

export type WattzunFormCaptureTarget = Omit<WattzunFormSavedDetail, "formKind"> & {
  formKind: "work_pack" | "veu_electrical";
  fieldKey: string;
};
export type WattzunFormCaptureRequest = { requestId: string; target: WattzunFormCaptureTarget };
export type WattzunFormCaptureResult = { status: "ready"; target: WattzunFormCaptureTarget }
  | { status: "unavailable"; message: string };
export type WattzunFormCaptureSaved = WattzunFormCaptureTarget & { oldFormId: string };

export function readWattzunFormCaptureTarget(value: unknown): WattzunFormCaptureTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const saved = readWattzunFormSaved({ portal: data.portal, scopeId: data.scopeId, formKind: data.formKind, formId: data.formId, jobId: data.jobId });
  if (Object.keys(data).length !== 6 || !saved || (saved.formKind !== "work_pack" && saved.formKind !== "veu_electrical")
    || typeof data.fieldKey !== "string" || !/^[A-Za-z0-9:_./\[\]-]{1,600}$/.test(data.fieldKey)
    || data.fieldKey.split(/[.:/\[\]]/).some(part => ["__proto__", "constructor", "prototype"].includes(part))) return null;
  return { ...saved, formKind: saved.formKind, fieldKey: data.fieldKey };
}

export function readWattzunFormCaptureRequest(value: unknown): WattzunFormCaptureRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const target = readWattzunFormCaptureTarget(data.target);
  return Object.keys(data).length === 2 && target && typeof data.requestId === "string"
    && /^[A-Za-z0-9-]{1,80}$/.test(data.requestId) ? { requestId: data.requestId, target } : null;
}

export function sameWattzunFormCaptureTarget(left: WattzunFormCaptureTarget, right: WattzunFormCaptureTarget) {
  return left.portal === right.portal && left.scopeId === right.scopeId && left.formKind === right.formKind
    && left.formId === right.formId && left.jobId === right.jobId && left.fieldKey === right.fieldKey;
}

/** The mounted editor owns visibility, permissions and the actual file input. No file is selected here. */
export function respondWattzunFormCapture(request: WattzunFormCaptureRequest, result: WattzunFormCaptureResult) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(WATTZUN_FORM_CAPTURE_READY_EVENT, {
    detail: { requestId: request.requestId, result },
  }));
}

export function prepareWattzunFormCapture(value: WattzunFormCaptureTarget): Promise<WattzunFormCaptureResult> {
  const target = readWattzunFormCaptureTarget(value);
  const unavailable: WattzunFormCaptureResult = { status: "unavailable", message: "Open this form's photo question, then try again." };
  if (!target || typeof window === "undefined") return Promise.resolve(unavailable);
  return new Promise(resolve => {
    const requestId = crypto.randomUUID();
    const finish = (result: WattzunFormCaptureResult) => {
      window.clearTimeout(timer);
      window.removeEventListener(WATTZUN_FORM_CAPTURE_READY_EVENT, ready);
      resolve(result);
    };
    const ready = (event: Event) => {
      if (!(event instanceof CustomEvent) || !event.detail || typeof event.detail !== "object") return;
      const data: Record<string, unknown> = Object.fromEntries(Object.entries(event.detail));
      if (data.requestId !== requestId || !data.result || typeof data.result !== "object") return;
      const result: Record<string, unknown> = Object.fromEntries(Object.entries(data.result));
      const selected = readWattzunFormCaptureTarget(result.target);
      if (result.status === "ready" && selected && sameWattzunFormCaptureTarget({ ...target, formId: selected.formId }, selected)) {
        finish({ status: "ready", target: selected });
      } else if (result.status === "unavailable" && typeof result.message === "string" && result.message.length <= 500) {
        finish({ status: "unavailable", message: result.message });
      }
    };
    const timer = window.setTimeout(() => finish(unavailable), 2000);
    window.addEventListener(WATTZUN_FORM_CAPTURE_READY_EVENT, ready);
    window.dispatchEvent(new CustomEvent(WATTZUN_FORM_CAPTURE_PREPARE_EVENT, { detail: { requestId, target } }));
  });
}

/** Call synchronously from a user click, after prepare returned ready, to preserve camera user activation. */
export function captureWattzunFormPhoto(value: WattzunFormCaptureTarget): boolean {
  const target = readWattzunFormCaptureTarget(value);
  if (!target || typeof window === "undefined") return false;
  return !window.dispatchEvent(new CustomEvent(WATTZUN_FORM_CAPTURE_EVENT, { detail: target, cancelable: true }));
}

export function readWattzunFormCaptureSaved(value: unknown): WattzunFormCaptureSaved | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const { oldFormId, ...targetValue } = data;
  const target = readWattzunFormCaptureTarget(targetValue);
  return target && typeof oldFormId === "string" && /^[A-Za-z0-9:_-]{1,180}$/.test(oldFormId) ? { ...target, oldFormId } : null;
}

/** Only the native editor dispatches this after the canonical artifact link is confirmed. */
export function dispatchWattzunFormCaptureSaved(detail: WattzunFormCaptureSaved) {
  const parsed = readWattzunFormCaptureSaved(detail);
  if (parsed && typeof window !== "undefined") window.dispatchEvent(new CustomEvent(WATTZUN_FORM_CAPTURE_SAVED_EVENT, { detail: parsed }));
}
