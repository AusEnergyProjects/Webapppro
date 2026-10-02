"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { firebaseAuth } from "@/lib/firebase-client";
import styles from "./CreditexOperationsWorkspace.module.css";

type ComplianceRole = "admin" | "case_manager" | "reviewer" | "auditor";

type WorkspaceSession = {
  email: string;
  displayName: string;
  role: ComplianceRole;
  canConfirmNamedOwner?: boolean;
  namedOwnerConfirmed?: boolean;
  organisation: {
    code: string;
    legalName: string;
    tradingName: string;
  };
};

type AccessMember = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  lastLoginAt: string;
};

type AccessInvitation = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
};

type AccessSnapshot = {
  loaded: boolean;
  ownerEmail: string;
  members: AccessMember[];
  invitations: AccessInvitation[];
};

type JsonRecord = Record<string, unknown>;

const EMPTY_ACCESS: AccessSnapshot = {
  loaded: false,
  ownerEmail: "info@ausenergyassessments.com",
  members: [],
  invitations: [],
};

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function first(source: JsonRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function text(source: JsonRecord, keys: string[], fallback = "") {
  const value = first(source, keys);
  if (value === undefined) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function readable(value: string) {
  if (!value) return "Not recorded";
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateTime(value: string) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-AU", {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function parseAccess(value: unknown): AccessSnapshot {
  const root = record(value);
  const sourceCandidate = record(first(root, ["access", "workspace"]));
  const source = Object.keys(sourceCandidate).length ? sourceCandidate : root;
  return {
    loaded: true,
    ownerEmail: text(source, [
      "ownerEmail",
      "owner_email",
      "initialOwnerEmail",
      "initial_owner_email",
    ], "info@ausenergyassessments.com"),
    members: records(first(source, ["members", "users"])).map((item) => ({
      id: text(item, ["id", "membershipId", "membership_id"]),
      email: text(item, ["email"]),
      displayName: text(item, ["displayName", "display_name"]),
      role: text(item, ["role"]),
      status: text(item, ["status"]),
      lastLoginAt: text(item, ["lastLoginAt", "last_login_at"]),
    })),
    invitations: records(first(source, ["invitations"])).map((item) => ({
      id: text(item, ["id"]),
      email: text(item, ["email"]),
      displayName: text(item, ["displayName", "display_name"]),
      role: text(item, ["role"]),
      status: text(item, ["status"]),
      expiresAt: text(item, ["expiresAt", "expires_at"]),
      createdAt: text(item, ["createdAt", "created_at"]),
    })),
  };
}

async function authenticatedJson(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const activeUser = firebaseAuth.currentUser;
  if (!activeUser) throw new Error("Sign in to continue.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await activeUser.getIdToken()}`);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    cache: "no-store",
  });
  const responseText = await response.text();
  let result: unknown = {};
  if (responseText) {
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error(
        "The operations service returned an unreadable response. Refresh and try again.",
      );
    }
  }
  const body = record(result);
  if (!response.ok || body.ok === false) {
    throw new Error(
      text(body, ["error"], `The operations request failed (${response.status}).`),
    );
  }
  return result;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className={styles.empty}>{children}</div>;
}

function StatusPill({ value }: { value: string }) {
  return (
    <span className={styles.statusPill} data-status={value || "unknown"}>
      {readable(value)}
    </span>
  );
}

export function CreditexTeamAccess({ session, onSessionChanged }: { session: WorkspaceSession; onSessionChanged?: () => Promise<void> }) {
  const [access, setAccess] = useState<AccessSnapshot>(EMPTY_ACCESS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (session.role !== "admin") return;
    setLoading(true); setError("");
    try { setAccess(parseAccess(await authenticatedJson("/api/creditex/access"))); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Team access could not be loaded."); }
    finally { setLoading(false); }
  }, [session.role]);
  useEffect(() => {
    const timeout = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);
  return <div className={styles.workspace}><AccessView session={session} access={access} loading={loading} error={error} onRefresh={() => void load()} onSessionChanged={onSessionChanged} /></div>;
}

function AccessView({
  session,
  access,
  loading,
  error,
  onRefresh,
  onSessionChanged,
}: {
  session: WorkspaceSession;
  access: AccessSnapshot;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onSessionChanged?: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    displayName: "",
    email: "",
    role: "reviewer",
  });
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [memberDrafts, setMemberDrafts] = useState<
    Record<string, { role: string; status: string }>
  >({});

  async function accessAction(
    action: string,
    body: Record<string, unknown>,
    successMessage: string,
  ) {
    setBusy(action);
    setActionError("");
    setNotice("");
    try {
      await authenticatedJson("/api/creditex/access", {
        method: "POST",
        body: JSON.stringify({ action, ...body }),
      });
      setNotice(successMessage);
      onRefresh();
      return true;
    } catch (actionFailure) {
      setActionError(
        actionFailure instanceof Error
          ? actionFailure.message
          : "The access action could not be completed.",
      );
      return false;
    } finally {
      setBusy("");
    }
  }

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await accessAction(
      "create_invitation",
      form,
      `Invitation ready for ${form.displayName}. Give them the Creditex sign-in link and ask them to use ${form.email}. No invitation email was sent.`,
    );
    if (created) {
      setForm({ displayName: "", email: "", role: "reviewer" });
    }
  }

  async function confirmNamedOwner() {
    const confirmed = await accessAction("confirm_named_owner", {}, "James Morris is now the named Creditex administrator for this login.");
    if (confirmed && onSessionChanged) await onSessionChanged();
  }

  async function updateMemberAccess(member: AccessMember) {
    const draft = memberDrafts[member.id] || {
      role: member.role,
      status: member.status,
    };
    if (
      !window.confirm(
        `Apply ${readable(draft.role)} and ${readable(draft.status)} access to ${member.displayName || member.email}?`,
      )
    ) return;
    const updated = await accessAction("update_member_access", {
      memberId: member.id,
      role: draft.role,
      status: draft.status,
    }, "The named member access record was updated.");
    if (updated) {
      setMemberDrafts((current) => {
        const next = { ...current };
        delete next[member.id];
        return next;
      });
    }
  }

  async function revokeInvitation(invitation: AccessInvitation) {
    if (!window.confirm(
      `Revoke the pending invitation for ${invitation.displayName || invitation.email}?`,
    )) return;
    await accessAction(
      "revoke_invitation",
      { invitationId: invitation.id },
      "The pending invitation was revoked.",
    );
  }

  return (
    <section aria-labelledby="operations-access-title">
      <div className={styles.sectionHeader}>
        <div>
          <h3 id="operations-access-title">Team access</h3>
          <p>
            Invite your team to edit and preview activity forms using their own accounts.
          </p>
        </div>
        {session.role === "admin" && (
          <button
            className={styles.refreshButton}
            type="button"
            disabled={loading}
            onClick={onRefresh}
          >
            {loading ? "Refreshing..." : "Refresh access"}
          </button>
        )}
      </div>
      {session.canConfirmNamedOwner && <div className={styles.accessPolicy}>
        <strong>Use this account as James Morris</strong>
        <p>Confirm your existing {session.email} owner login as James Morris, Creditex Administrator. You can manage the workspace, edit and publish forms, invite individual team members and assign their roles.</p>
        <p>Actions remain attributed to your verified login. Independent regulator and source approvals still require their separate reviewer.</p>
        <button type="button" disabled={Boolean(busy) || loading} onClick={() => void confirmNamedOwner()}>{busy === "confirm_named_owner" ? "Confirming James Morris..." : "Confirm James Morris as administrator"}</button>
      </div>}
      {session.namedOwnerConfirmed && <div className={styles.accessPolicy}><strong>James Morris · Creditex Administrator</strong><p>Your existing {session.email} login has named manager access, including form editing and team access management.</p></div>}
      <div className={styles.accessPolicy}>
        <strong>Ready to edit in three steps</strong>
        <ol><li>Invite a named colleague as Reviewer, Case manager or Administrator below.</li><li>Give them <a href="/creditex/compliance" target="_blank" rel="noreferrer">the Creditex sign-in link</a>. They can use Continue with Google or an existing TLink login with the exact invited email, then complete the account security steps shown.</li><li>They can open Activity forms, choose Edit, test their changes in the phone and save the master.</li></ol>
        <p>Reviewer is the default for form editors. Auditors can preview forms but cannot publish changes. Official source approvals remain separate.</p>
      </div>
      <details className={styles.accessPolicy}>
        <summary>Initial administrator setup</summary>
        <span>Initial owner invitation</span>
        <strong>
          {access.ownerEmail || "info@ausenergyassessments.com"}
        </strong>
        <p>
          This address establishes the first administrator. It is not a shared
          Creditex login. The administrator must invite each team member by
          their own verified email and assign the role they need. Keep at least
          two named administrators for continuity. A confirmed named owner can
          keep using this account as their individual manager login.
        </p>
      </details>
      {session.role !== "admin" && (
        <EmptyState>
          Your {readable(session.role)} role can use operational work areas but
          cannot administer memberships or invitations.
        </EmptyState>
      )}
      {session.role === "admin" && error && (
        <p className={styles.error} role="alert">{error}</p>
      )}
      {session.role === "admin" && notice && (
        <p className={styles.success} role="status">{notice}</p>
      )}
      {session.role === "admin" && actionError && (
        <p className={styles.error} role="alert">{actionError}</p>
      )}
      {session.role === "admin" && (
        <form className={styles.localForm} onSubmit={createInvitation}>
          <div className={`${styles.formIntro} ${styles.formWide}`}>
            <strong>Invite a named team member</strong>
            <p>
              Enter one person&apos;s full name and individual verified email.
              Shared or role-based mailboxes are rejected by the access API.
            </p>
          </div>
          <label>
            Full name
            <input
              required
              maxLength={180}
              autoComplete="name"
              value={form.displayName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  displayName: event.target.value,
                }))}
            />
          </label>
          <label>
            Individual email
            <input
              required
              type="email"
              maxLength={320}
              autoComplete="email"
              value={form.email}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  email: event.target.value,
                }))}
            />
          </label>
          <label>
            Role
            <select
              value={form.role}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  role: event.target.value,
                }))}
            >
              <option value="case_manager">Case manager</option>
              <option value="reviewer">Reviewer</option>
              <option value="auditor">Auditor</option>
              <option value="admin">Administrator</option>
            </select>
          </label>
          <button
            className={styles.primaryAction}
            type="submit"
            disabled={busy === "create_invitation"}
          >
            {busy === "create_invitation"
              ? "Creating invitation..."
              : "Create named invitation"}
          </button>
        </form>
      )}
      {session.role === "admin" && (
        <div className={styles.splitColumns}>
          <div>
            <h4 className={styles.subheading}>Named members</h4>
            <div className={styles.compactList}>
              {access.members.map((member) => {
                const draft = memberDrafts[member.id] || {
                  role: member.role,
                  status: member.status,
                };
                const changed = draft.role !== member.role
                  || draft.status !== member.status;
                const bootstrapMailbox =
                  member.email.toLowerCase()
                  === "info@ausenergyassessments.com";
                return (
                  <article key={member.id}>
                    <span>
                      <strong>{member.displayName || member.email}</strong>
                      <StatusPill value={member.status} />
                    </span>
                    <p>{member.email} | {readable(member.role)}</p>
                    <small>
                      Last login {dateTime(member.lastLoginAt)}
                      {bootstrapMailbox ? " | Initial owner account" : ""}
                    </small>
                    <div className={styles.memberAccessControls}>
                      <label>
                        Role
                        <select
                          value={draft.role}
                          onChange={(event) =>
                            setMemberDrafts((current) => ({
                              ...current,
                              [member.id]: {
                                ...draft,
                                role: event.target.value,
                              },
                            }))}
                        >
                          <option value="case_manager">Case manager</option>
                          <option value="reviewer">Reviewer</option>
                          <option value="auditor">Auditor</option>
                          <option value="admin">Administrator</option>
                        </select>
                      </label>
                      <label>
                        Access state
                        <select
                          value={draft.status}
                          onChange={(event) =>
                            setMemberDrafts((current) => ({
                              ...current,
                              [member.id]: {
                                ...draft,
                                status: event.target.value,
                              },
                            }))}
                        >
                          <option value="active">Active</option>
                          <option value="suspended">Suspended</option>
                        </select>
                      </label>
                      <button
                        className={styles.inlineAction}
                        type="button"
                        disabled={!changed || busy === "update_member_access"}
                        onClick={() => void updateMemberAccess(member)}
                      >
                        Apply access change
                      </button>
                    </div>
                  </article>
                );
              })}
              {access.loaded && !access.members.length && (
                <EmptyState>No active member records were returned.</EmptyState>
              )}
              {!access.loaded && !loading && !error && (
                <EmptyState>Open this view to load access records.</EmptyState>
              )}
            </div>
          </div>
          <div>
            <h4 className={styles.subheading}>Invitations</h4>
            <div className={styles.compactList}>
              {access.invitations.map((invitation) => (
                <article key={invitation.id}>
                  <span>
                    <strong>{invitation.displayName || invitation.email}</strong>
                    <StatusPill value={invitation.status} />
                  </span>
                  <p>{invitation.email} | {readable(invitation.role)}</p>
                  <small>Expires {dateTime(invitation.expiresAt)}</small>
                  {invitation.status === "pending" && (
                    <button
                      className={styles.inlineAction}
                      type="button"
                      disabled={busy === "revoke_invitation"}
                      onClick={() =>
                        void revokeInvitation(invitation)}
                    >
                      Revoke invitation
                    </button>
                  )}
                </article>
              ))}
              {access.loaded && !access.invitations.length && (
                <EmptyState>No invitation records were returned.</EmptyState>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
