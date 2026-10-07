"use client";

import { useEffect, useRef, useState } from "react";
import { requestWattzunAssistant } from "@/lib/wattzun-appearance";
import type { WattzunFormSavedDetail } from "@/lib/wattzun-form-client";
import { useTradeBusiness } from "./TradeBusinessProvider";

export function WattzunFormAssistButton({ userUid, formKind, jobId, disabled = false, beforeOpen }: {
  userUid: string;
  formKind: WattzunFormSavedDetail["formKind"];
  jobId: string;
  disabled?: boolean;
  beforeOpen: () => Promise<string | null>;
}) {
  const business = useTradeBusiness();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const openingRef = useRef(false);
  const scopeId = business?.ownerUid;
  useEffect(() => { const current = ++generation.current; return () => { generation.current = current + 1; }; }, [userUid, scopeId, formKind, jobId]);
  async function open(mode: "message" | "call") {
    if (!scopeId || disabled || openingRef.current) return;
    const current = generation.current;
    openingRef.current = true; setOpening(true); setError("");
    try {
      const savedFormId = await beforeOpen();
      if (!savedFormId) throw new Error("Your form changes need to be saved before Wattzun can continue. Check the form's save message.");
      if (current !== generation.current) return;
      const opened = await requestWattzunAssistant({ userUid, portal: "trade", scopeId, mode,
        ...(mode === "call" ? { guidedForm: true } : {}),
        workReference: { kind: "trade_form", formKind, recordId: savedFormId, jobId },
        initialMessage: "Help me fill this form. Ask me the next unanswered question, one at a time." });
      if (!opened && current === generation.current) setError("Wattzun could not open. Your saved form is safe. Try again.");
    } catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : "Save your form changes, then try again."); }
    finally { openingRef.current = false; if (current === generation.current) setOpening(false); }
  }
  if (!scopeId) return null;
  return <><button type="button" disabled={disabled || opening} onClick={() => { void open("message"); }}>{opening ? "Opening Wattzun..." : "Fill with Wattzun"}</button><button type="button" disabled={disabled || opening} onClick={() => { void open("call"); }}>Fill by voice</button><small>Answer by voice. Wattzun records each answer and asks before completing the form.</small>{error && <p role="alert">{error}</p>}</>;
}
