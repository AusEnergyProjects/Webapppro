"use client";

import { type ChangeEvent, useState } from "react";
import {
  analyseEnergyDocumentFile,
  type DocumentConversationMessage,
} from "@/lib/energy-assistant-document-client";
import styles from "./EnergyAssistantWidget.module.css";

export default function EnergyAssistantDocumentTools({
  disabled,
  onMessages,
  onClear,
}: {
  disabled: boolean;
  onMessages: (messages: DocumentConversationMessage[], accepted: boolean) => void;
  onClear: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const analyse = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || disabled || busy) return;
    setBusy(true);
    setNotice("Checking document...");
    try {
      const result = await analyseEnergyDocumentFile(file);
      onMessages(result.messages, result.accepted);
      setNotice("File processed and not saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The document could not be analysed.");
    } finally {
      setBusy(false);
    }
  };

  return <div className={styles.composerTools}>
    <label className={styles.attachmentButton} aria-disabled={disabled || busy} title="Attach energy quote or bill">
      <input type="file" accept=".pdf,.docx" disabled={disabled || busy} onChange={analyse} />
      <span aria-hidden="true">📎</span> Attach
    </label>
    <small role="status">{notice || "Energy quotes and bills only. Files are not saved."}</small>
    <a href="/privacy">Privacy</a>
    <button type="button" disabled={disabled || busy} onClick={onClear}>Clear chat</button>
  </div>;
}
