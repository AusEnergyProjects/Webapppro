"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { FirebaseAccountSecurity } from "./FirebaseMfa";
import { TLinkHeader } from "./TLinkChrome";
import styles from "./FirebaseMfa.module.css";

export function AccountSecurityPage() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => onAuthStateChanged(firebaseAuth, (next) => { setUser(next); setReady(true); }), []);
  return <main className="wrap direct-trade-request-page">
    <TLinkHeader active="partners" />
    {!ready ? <p role="status">Opening account security...</p> : user ? <>
      <FirebaseAccountSecurity key={user.uid} user={user} />
      <nav className={styles.workspaceNav} aria-label="Return to your workspace">
        <a href="/direct-trade/dashboard">TLink workspace</a>
        <a href="/direct-trade/team">Team workspace</a>
        <button type="button" onClick={() => void signOut(firebaseAuth)}>Sign out</button>
      </nav>
    </> : <section className="dashboard-state-card"><h1>Sign in to manage account security</h1><p>Use your existing TLink account, then open Account security from your profile.</p><a className="btn" href="/direct-trade/partners">Open account sign-in</a></section>}
  </main>;
}
