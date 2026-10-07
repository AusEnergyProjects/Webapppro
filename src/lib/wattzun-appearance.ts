"use client";

import { useEffect, useRef, useState } from "react";
import { WATTZUN_DEFAULT_PREFERENCES, parseWattzunPreferences, type WattzunPortal, type WattzunPreferences } from "./wattzun-portal";
import { readWattzunWorkReference, type WattzunWorkReference } from "./wattzun-work-context";

export const WATTZUN_HATS = [
  { id: "none", label: "None" },
  { id: "hard-hat", label: "Hard hat" },
  { id: "cap", label: "Cap" },
  { id: "cowboy", label: "Cowboy" },
  { id: "viking", label: "Viking hat" },
  { id: "pirate", label: "Pirate hat" },
  { id: "sausage", label: "Sausage" },
  { id: "tinfoil", label: "Tinfoil hat" },
  { id: "safety-plug", label: "Safety plug" },
  { id: "party", label: "Party hat" },
  { id: "pumpkin", label: "Pumpkin" },
  { id: "ghost", label: "Ghost" },
] as const;
export type WattzunHat = typeof WATTZUN_HATS[number]["id"];
export type WattzunPresentationScope = { userUid: string; portal: WattzunPortal; scopeId: string };
export type WattzunPresentation = { hat: WattzunHat; speed: WattzunPreferences["speed"] };
export type WattzunOpenRequest = { userUid: string; portal: WattzunPortal; scopeId?: string; mode: "call" | "message"; initialMessage?: string; workReference?: WattzunWorkReference; guidedForm?: true };
export const WATTZUN_OPEN_EVENT = "wattzun:open";
export const WATTZUN_READY_EVENT = "wattzun:ready";
export const WATTZUN_USAGE_CHANGED_EVENT = "wattzun:usage-changed";
const PRESENTATION_EVENT = "wattzun:presentation";
const PRESENTATION_READ_EVENT = "wattzun:presentation-read";
const defaults: WattzunPresentation = { hat: "none", speed: WATTZUN_DEFAULT_PREFERENCES.speed };
export function isWattzunHat(value: unknown): value is WattzunHat { return WATTZUN_HATS.some(hat => hat.id === value); }
export function wattzunAppearanceKey(scope: WattzunPresentationScope) { return `wattzun-appearance:v1:${scope.userUid}:${scope.portal}:${scope.scopeId}`; }
export function wattzunSpeedKey(scope: WattzunPresentationScope) { return `wattzun-preferences:v2:${scope.userUid}:${scope.portal}:${scope.scopeId}`; }
function readMountedPresentation(key: string): WattzunPresentation {
  let value = { ...defaults };
  window.dispatchEvent(new CustomEvent(PRESENTATION_READ_EVENT, { detail: { key, respond: (candidate: unknown) => {
    if (candidate && typeof candidate === "object" && "hat" in candidate && isWattzunHat(candidate.hat) && "speed" in candidate
      && (candidate.speed === .85 || candidate.speed === 1 || candidate.speed === 1.15)) value = { hat: candidate.hat, speed: candidate.speed };
  } } }));
  return value;
}
export function readWattzunPresentation(scope: WattzunPresentationScope, fallback: WattzunPresentation = defaults): WattzunPresentation {
  if (typeof window === "undefined") return { ...fallback };
  let hat: WattzunHat = fallback.hat, speed = fallback.speed;
  const key = wattzunSpeedKey(scope), legacyKey = key.replace("wattzun-preferences:v2:", "wattzun-preferences:v1:");
  try { const saved = JSON.parse(window.localStorage.getItem(wattzunAppearanceKey(scope)) || "null"); if (saved && isWattzunHat(saved.hat)) hat = saved.hat; } catch { /* Appearance remains optional when storage is unavailable. */ }
  try {
    const saved = window.localStorage.getItem(key) || window.localStorage.getItem(legacyKey);
    if (saved) speed = parseWattzunPreferences(JSON.parse(saved)).speed;
    window.localStorage.setItem(key, JSON.stringify({ speed }));
  } catch { /* Keep the scoped fallback for malformed or inaccessible storage. */ }
  finally { try { window.localStorage.removeItem(legacyKey); } catch { /* Storage may be unavailable. */ } }
  return { hat, speed };
}
export function writeWattzunPresentation(scope: WattzunPresentationScope, change: Partial<WattzunPresentation>, fallback: WattzunPresentation = defaults) {
  const previous = readWattzunPresentation(scope, fallback);
  const value: WattzunPresentation = { hat: isWattzunHat(change.hat) ? change.hat : previous.hat, speed: change.speed === .85 || change.speed === 1 || change.speed === 1.15 ? change.speed : previous.speed };
  try {
    window.localStorage.setItem(wattzunAppearanceKey(scope), JSON.stringify({ hat: value.hat }));
    window.localStorage.setItem(wattzunSpeedKey(scope), JSON.stringify({ speed: value.speed }));
  } catch { /* The document event keeps controls usable without browser storage. */ }
  window.dispatchEvent(new CustomEvent(PRESENTATION_EVENT, { detail: { key: wattzunAppearanceKey(scope), value } }));
}
export function useWattzunPresentation(scope: WattzunPresentationScope | null) {
  const key = scope ? wattzunAppearanceKey(scope) : "";
  const userUid = scope?.userUid || "", portal = scope?.portal || "trade", scopeId = scope?.scopeId || "";
  const [state, setState] = useState<{ key: string; value: WattzunPresentation }>({ key: "", value: defaults });
  const latest = useRef<{ key: string; value: WattzunPresentation }>({ key: "", value: defaults });
  useEffect(() => {
    if (!key) return;
    const selected = { userUid, portal, scopeId };
    const update = (value: WattzunPresentation) => { latest.current = { key, value }; setState({ key, value }); };
    const frame = window.requestAnimationFrame(() => update(readWattzunPresentation(selected, readMountedPresentation(key))));
    const answerRead = (event: Event) => {
      if (event instanceof CustomEvent && event.detail?.key === key && latest.current.key === key && typeof event.detail.respond === "function") {
        event.detail.respond({ ...latest.current.value });
      }
    };
    const sync = (event: Event) => {
      if (event instanceof StorageEvent) {
        if (event.key === null || event.key === key || event.key === wattzunSpeedKey(selected)) update(readWattzunPresentation(selected));
      } else if (event instanceof CustomEvent && event.detail?.key === key && isWattzunHat(event.detail.value?.hat)) {
        const value = event.detail.value;
        if (value.speed === .85 || value.speed === 1 || value.speed === 1.15) update({ hat: value.hat, speed: value.speed });
      }
    };
    window.addEventListener(PRESENTATION_EVENT, sync); window.addEventListener("storage", sync);
    window.addEventListener(PRESENTATION_READ_EVENT, answerRead);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener(PRESENTATION_EVENT, sync); window.removeEventListener("storage", sync); window.removeEventListener(PRESENTATION_READ_EVENT, answerRead); };
  }, [key, userUid, portal, scopeId]);
  const value = state.key === key && key ? state.value : defaults;
  return { ...value, ready: Boolean(key && state.key === key),
    setHat: (hat: WattzunHat) => { if (scope) writeWattzunPresentation(scope, { hat }, latest.current.key === key ? latest.current.value : defaults); },
    setSpeed: (speed: WattzunPreferences["speed"]) => { if (scope) writeWattzunPresentation(scope, { speed }, latest.current.key === key ? latest.current.value : defaults); },
  };
}
export function readWattzunOpenRequest(value: unknown): WattzunOpenRequest | null {
  if (!value || typeof value !== "object" || !("userUid" in value) || typeof value.userUid !== "string" || !value.userUid || !("portal" in value) || !("mode" in value)
    || (value.portal !== "trade" && value.portal !== "creditex" && value.portal !== "council") || (value.mode !== "call" && value.mode !== "message")) return null;
  if ("scopeId" in value && value.scopeId !== undefined && (typeof value.scopeId !== "string" || !value.scopeId)) return null;
  if ("initialMessage" in value && value.initialMessage !== undefined && (typeof value.initialMessage !== "string" || value.initialMessage.length > 4000)) return null;
  const workReference = "workReference" in value && value.workReference !== undefined ? readWattzunWorkReference(value.workReference, value.portal) : undefined;
  if (workReference === null) return null;
  if ("guidedForm" in value && value.guidedForm !== undefined && (value.guidedForm !== true || value.portal !== "trade" || value.mode !== "call" || workReference?.kind !== "trade_form")) return null;
  return { userUid: value.userUid, portal: value.portal, mode: value.mode, ...("scopeId" in value && typeof value.scopeId === "string" ? { scopeId: value.scopeId } : {}), ...("initialMessage" in value && typeof value.initialMessage === "string" ? { initialMessage: value.initialMessage } : {}), ...(workReference ? { workReference } : {}), ...("guidedForm" in value && value.guidedForm === true ? { guidedForm: true } : {}) };
}
export function requestWattzunAssistant(request: WattzunOpenRequest): Promise<boolean> {
  if (!readWattzunOpenRequest(request)) return Promise.resolve(false);
  return new Promise(resolve => {
    const complete = (opened: boolean) => { window.clearTimeout(timer); window.removeEventListener(WATTZUN_READY_EVENT, ready); resolve(opened); };
    const dispatch = () => window.dispatchEvent(new CustomEvent(WATTZUN_OPEN_EVENT, { detail: { ...request, acknowledge: () => complete(true) } }));
    const ready = (event: Event) => { if (event instanceof CustomEvent && event.detail?.portal === request.portal) dispatch(); };
    const timer = window.setTimeout(() => complete(false), 10_000);
    window.addEventListener(WATTZUN_READY_EVENT, ready);
    dispatch();
  });
}
