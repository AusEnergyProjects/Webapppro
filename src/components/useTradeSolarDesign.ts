"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { SolarDesign, SolarDesignInput, SolarDesignSummary } from "@/lib/trade-solar-design";

type Result = { ok?: boolean; error?: string; design?: SolarDesign; designs?: SolarDesignSummary[]; hasMore?: boolean; nextCursor?: string };
export async function solarDesignRequest(user: User, query = "", body?: unknown): Promise<Result> {
  const token = await user.getIdToken();
  const response = await fetch(`/api/trade-solar-designs${query}`, {
    method: body ? "POST" : "GET", cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result: Result = await response.json();
  if (!response.ok || !result.ok) throw new Error(response.status === 409
    ? "This design was changed elsewhere. Your edits are still here. Save a copy to keep them."
    : result.error || "Your design could not be saved. Check your connection and try again.");
  return result;
}

/** Serial writes prevent delayed autosaves from replacing newer geometry. */
export function useTradeSolarDesign(user: User, enabled: boolean) {
  const input = useRef<SolarDesignInput | null>(null);
  const identity = useRef({ id: "", revision: 0 });
  const saved = useRef("");
  const current = useRef<SolarDesign | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<{ generation: number; promise: Promise<SolarDesign | null> } | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [design, setDesign] = useState<SolarDesign | null>(null);

  const ensureSaved = useCallback(async (): Promise<SolarDesign | null> => {
    if (timer.current) clearTimeout(timer.current);
    if (!enabled || !input.current) return current.current;
    const attemptGeneration = generation.current;
    if (saving.current?.generation === attemptGeneration) return saving.current.promise;
    const write = async () => {
      while (generation.current === attemptGeneration && input.current && JSON.stringify(input.current) !== saved.current) {
        const snapshot = input.current;
        const fingerprint = JSON.stringify(snapshot);
        if (!identity.current.id) identity.current.id = crypto.randomUUID();
        if (mounted.current) { setStatus("Saving…"); setError(""); }
        const result = await solarDesignRequest(user, "", { id: identity.current.id, expectedRevision: identity.current.revision, design: snapshot });
        if (generation.current !== attemptGeneration) return current.current;
        if (!result.design) throw new Error("The design save was not confirmed. Try again.");
        identity.current = { id: result.design.id, revision: result.design.revision };
        current.current = result.design;
        saved.current = fingerprint;
        if (mounted.current) setDesign(result.design);
      }
      if (mounted.current && generation.current === attemptGeneration) setStatus("Saved");
      return current.current;
    };
    const promise = write().catch((failure: unknown) => {
      if (mounted.current && generation.current === attemptGeneration) { setStatus("Not saved"); setError(failure instanceof Error ? failure.message : "Could not save this design."); }
      throw failure;
    }).finally(() => { if (saving.current?.generation === attemptGeneration) saving.current = null; });
    saving.current = { generation: attemptGeneration, promise };
    return promise;
  }, [enabled, user]);

  const update = useCallback((value: SolarDesignInput) => {
    input.current = value;
    if (!enabled || JSON.stringify(value) === saved.current) return;
    setStatus("Unsaved changes");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void ensureSaved().catch(() => {}); }, 800);
  }, [enabled, ensureSaved]);

  const accept = useCallback((value: SolarDesign | null) => {
    generation.current++;
    if (timer.current) clearTimeout(timer.current);
    const draft = value ? { title: value.title, panels: value.panels, equipment: value.equipment, installationNotes: value.installationNotes,
      center: value.center, zoom: value.zoom, customerId: value.customerId, workOrderId: value.workOrderId } : null;
    input.current = draft; saved.current = draft ? JSON.stringify(draft) : "";
    identity.current = { id: value?.id ?? "", revision: value?.revision ?? 0 };
    current.current = value; setDesign(value); setError(""); setStatus(value ? "Saved" : "");
  }, []);

  const saveCopy = useCallback(async () => {
    if (saving.current) { try { await saving.current.promise; } catch { /* Preserve the local draft on a conflict. */ } }
    generation.current++;
    identity.current = { id: crypto.randomUUID(), revision: 0 }; saved.current = "";
    if (input.current) input.current = { ...input.current, title: `${input.current.title.slice(0, 170)} (copy)`, customerId: "", workOrderId: "" };
    return ensureSaved();
  }, [ensureSaved]);

  useEffect(() => {
    mounted.current = true;
    const warn = (event: BeforeUnloadEvent) => {
      if (enabled && input.current && JSON.stringify(input.current) !== saved.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      mounted.current = false; window.removeEventListener("beforeunload", warn);
      if (timer.current) clearTimeout(timer.current);
      // Best-effort flush when switching CRM tabs; beforeunload guards pending page exits.
      void ensureSaved().catch(() => {});
    };
  }, [enabled, ensureSaved]);

  return { design, status, error, update, accept, ensureSaved, saveCopy };
}
