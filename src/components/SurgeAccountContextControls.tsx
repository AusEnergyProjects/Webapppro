"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import { useEffect, useState } from "react";
import { firebaseAuth } from "@/lib/firebase-client";
import type { SurgeStarterProfile } from "@/lib/surge-assessor-profile";
import styles from "./SurgeAccountContextControls.module.css";

type Props = {
  profile: SurgeStarterProfile;
};

async function accountContextRequest(user: User, method: "GET" | "PUT" | "DELETE", body?: object) {
  const token = await user.getIdToken();
  return fetch("/api/energy-assistant/account-context", {
    method,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function SurgeAccountContextControls({ profile }: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => onAuthStateChanged(firebaseAuth, (nextUser) => {
    setUser(nextUser);
    setStatus("");
    if (!nextUser) {
      setSaved(false);
      return;
    }
    void accountContextRequest(nextUser, "GET")
      .then(async (response) => {
        const result = await response.json() as { saved?: unknown };
        if (response.ok) setSaved(result.saved === true);
      })
      .catch(() => setStatus("Account copy status is unavailable."));
  }), []);

  if (!user) return null;

  async function save() {
    if (!user || busy) return;
    setBusy(true);
    setStatus("Saving your account copy...");
    try {
      const response = await accountContextRequest(user, "PUT", {
        confirmAccountContextSave: true,
        profile,
      });
      setSaved(response.ok);
      setStatus(response.ok ? "Account copy saved." : "The account copy could not be saved.");
    } catch {
      setStatus("The account copy could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!user || busy || !saved) return;
    setBusy(true);
    setStatus("Deleting your account copy...");
    try {
      const response = await accountContextRequest(user, "DELETE", { confirmDelete: true });
      if (response.ok) setSaved(false);
      setStatus(response.ok ? "Account copy deleted. This browser copy remains available." : "The account copy could not be deleted.");
    } catch {
      setStatus("The account copy could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.controls} aria-label="Signed-in home context controls">
      <strong>Account copy</strong>
      <p>Your browser copy stays private unless you choose to save it to your signed-in account.</p>
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={save}>Save context to my account</button>
        {saved && <button type="button" disabled={busy} onClick={remove}>Delete account copy</button>}
      </div>
      {status && <p className={styles.status} role="status">{status}</p>}
    </section>
  );
}
