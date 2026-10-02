"use client";

import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { firebaseAuth } from "@/lib/firebase-client";
import { CREDITEX_PERMISSION_GROUPS, creditexRolePermissions, resolveCreditexPermissions, type CreditexPermission } from "@/lib/creditex-permissions";
import styles from "./CreditexOperationsWorkspace.module.css";

type ComplianceRole = "admin" | "case_manager" | "reviewer" | "auditor";

type WorkspaceSession = {
  email: string;
  displayName: string;
  role: ComplianceRole;
  canConfirmNamedOwner?: boolean;
  namedOwnerConfirmed?: boolean;
  permissions?: CreditexPermission[];
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
  permissions: CreditexPermission[];
};

type AccessInvitation = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  permissions: CreditexPermission[];
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
      permissions: resolveCreditexPermissions(text(item, ["role"]), item.permissions),
    })),
    invitations: records(first(source, ["invitations"])).map((item) => ({
      id: text(item, ["id"]),
      email: text(item, ["email"]),
      displayName: text(item, ["displayName", "display_name"]),
      role: text(item, ["role"]),
      status: text(item, ["status"]),
      expiresAt: text(item, ["expiresAt", "expires_at"]),
      createdAt: text(item, ["createdAt", "created_at"]),
      permissions: resolveCreditexPermissions(text(item, ["role"]), item.permissions),
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

function PermissionFields({ role, permissions, disabled, onChange }: {
  role: string; permissions: CreditexPermission[]; disabled: boolean; onChange: (permissions: CreditexPermission[]) => void;
}) {
  const allowed = creditexRolePermissions(role);
  return <div className={styles.permissionFields}>
    <p>{role === "admin" ? "Administrators have full workspace access, including team management. Choose another role to customise permissions."
      : "Choose the tools this person needs. Their role, assigned jobs and independent approval requirements still apply."}</p>
    {CREDITEX_PERMISSION_GROUPS.map(group => <fieldset key={group.label} disabled={disabled || role === "admin"}>
      <legend>{group.label}</legend>
      <div className={styles.permissionGrid}>{group.permissions.map(permission => <label className={styles.permissionOption} key={permission.key}>
        <input type="checkbox" checked={permissions.includes(permission.key)} disabled={!allowed.includes(permission.key)}
          onChange={event => {
            const next = new Set(permissions);
            if (event.target.checked) { next.add(permission.key); if (permission.key === "audit") next.add("jobs"); }
            else { next.delete(permission.key); if (permission.key === "jobs") next.delete("audit"); }
            onChange(allowed.filter(key => next.has(key)));
          }} />
        <span><strong>{permission.label}</strong><small>{allowed.includes(permission.key) ? permission.description : "Not available for this role."}</small></span>
      </label>)}</div>
    </fieldset>)}
  </div>;
}

function trapTeamDialogKey(event: KeyboardEvent<HTMLElement>, close: () => void) {
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
  if (event.key !== "Tab") return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
  if (!focusable.length) { event.preventDefault(); event.currentTarget.focus(); return; }
  const first = focusable[0]; const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
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
    status: "active",
    permissions: creditexRolePermissions("reviewer"),
  });
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<"new" | AccessMember | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), button:not([disabled])")?.focus();
    });
    return () => { window.cancelAnimationFrame(frame); document.body.style.overflow = previous; };
  }, [editing]);

  function openMemberDialog(member: "new" | AccessMember) {
    if (busy || loading) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setActionError(""); setNotice("");
    setForm(member === "new"
      ? { displayName: "", email: "", role: "reviewer", status: "active", permissions: creditexRolePermissions("reviewer") }
      : { displayName: member.displayName, email: member.email, role: member.role, status: member.status, permissions: [...member.permissions] });
    setEditing(member);
  }

  function dismissMemberDialog() {
    setEditing(null);
    setActionError("");
    window.requestAnimationFrame(() => restoreFocusRef.current?.focus());
  }

  function closeMemberDialog() {
    if (!busy) dismissMemberDialog();
  }

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

  async function saveMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy) return;
    const saved = editing === "new"
      ? await accessAction("create_invitation", {
        displayName: form.displayName, email: form.email, role: form.role, permissions: form.permissions,
      }, `Invitation ready for ${form.displayName}. Give them the Creditex sign-in link and ask them to use ${form.email}. No invitation email was sent.`)
      : await accessAction("update_member_access", {
        memberId: editing.id, role: form.role, status: form.status, permissions: form.permissions,
      }, `Access updated for ${editing.displayName || editing.email}.`);
    if (saved) dismissMemberDialog();
  }

  async function confirmNamedOwner() {
    const confirmed = await accessAction("confirm_named_owner", {}, "James Morris is now the named Creditex administrator for this login.");
    if (confirmed && onSessionChanged) await onSessionChanged();
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
          <h3 id="operations-access-title">Your team</h3>
          <p>
            Invite people, choose their tools and control what each team member can do.
          </p>
        </div>
        {session.role === "admin" && (
          <div className={styles.actions}><button
            className={styles.refreshButton}
            type="button"
            disabled={loading || Boolean(busy)}
            onClick={onRefresh}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button type="button" className={styles.primaryAction} disabled={loading || Boolean(busy)} onClick={() => openMemberDialog("new")}>Add team member</button></div>
        )}
      </div>
      {session.canConfirmNamedOwner && <div className={styles.accessPolicy}>
        <strong>Use this account as James Morris</strong>
        <p>Confirm your existing {session.email} owner login as James Morris, Creditex Administrator. You can manage the workspace, edit and publish forms, invite individual team members and assign their roles.</p>
        <p>Actions remain attributed to your verified login. Independent regulator and source approvals still require their separate reviewer.</p>
        <button type="button" disabled={Boolean(busy) || loading} onClick={() => void confirmNamedOwner()}>{busy === "confirm_named_owner" ? "Confirming James Morris..." : "Confirm James Morris as administrator"}</button>
      </div>}
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
      {session.role === "admin" && actionError && !editing && (
        <p className={styles.error} role="alert">{actionError}</p>
      )}
      {session.role === "admin" && <>
        <div className={styles.splitColumns}>
          <div>
            <h4 className={styles.subheading}>Team members</h4>
            <div className={styles.compactList}>
              {access.members.map(member => <article key={member.id}>
                <span><strong>{member.displayName || member.email}</strong><StatusPill value={member.status} /></span>
                <p>{member.email} | {readable(member.role)}</p>
                <small>Last login {dateTime(member.lastLoginAt)}</small>
                <small>{member.permissions.length} permissions enabled</small>
                <button className={styles.inlineAction} type="button" disabled={Boolean(busy) || loading}
                  aria-label={`Open details for ${member.displayName || member.email}`} onClick={() => openMemberDialog(member)}>Open details</button>
              </article>)}
              {loading && !access.loaded && <EmptyState>Loading your team...</EmptyState>}
              {access.loaded && !access.members.length && <EmptyState>No team members yet.</EmptyState>}
            </div>
          </div>
          <div>
            <h4 className={styles.subheading}>Invitations</h4>
            <div className={styles.compactList}>
              {access.invitations.map(invitation => <article key={invitation.id}>
                <span><strong>{invitation.displayName || invitation.email}</strong><StatusPill value={invitation.status} /></span>
                <p>{invitation.email} | {readable(invitation.role)}</p>
                <small>Expires {dateTime(invitation.expiresAt)}</small>
                <details className={styles.memberPermissions}><summary>Permissions ({invitation.permissions.length})</summary><PermissionFields role={invitation.role} permissions={invitation.permissions} disabled onChange={() => {}} /></details>
                {invitation.status === "pending" && <button className={styles.inlineAction} type="button" disabled={Boolean(busy)} onClick={() => void revokeInvitation(invitation)}>Revoke invitation</button>}
              </article>)}
              {access.loaded && !access.invitations.length && <EmptyState>No invitations yet. Add a team member to get started.</EmptyState>}
            </div>
          </div>
        </div>
        <details className={styles.accessPolicy}>
          <summary>Account and invitation help</summary>
          <p>Give each invited person <a href="/creditex/compliance" target="_blank" rel="noreferrer">the Creditex sign-in link</a> and ask them to use their invited email. No invitation email is sent automatically.</p>
          {session.namedOwnerConfirmed && <><strong>James Morris · Creditex Administrator</strong><p>Your {session.email} login has named manager access.</p></>}
          <p>The initial owner invitation is {access.ownerEmail || "info@ausenergyassessments.com"}. It is not a shared Creditex login. Invite each team member with their own verified email. Keep at least
            two named administrators for continuity. A confirmed named owner can
            keep using this account as their individual manager login.</p>
        </details>
      </>}
      {session.role === "admin" && editing && <div className={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget) closeMemberDialog(); }}>
        <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="creditex-team-member-title" tabIndex={-1} onKeyDown={event => trapTeamDialogKey(event, closeMemberDialog)}>
          <header className={styles.dialogHeader}>
            <div><span>{editing === "new" ? "Add team member" : "Edit team member"}</span><h4 id="creditex-team-member-title">Person and access</h4></div>
            <button type="button" className={styles.iconButton} aria-label="Close team member" disabled={Boolean(busy)} onClick={closeMemberDialog}>×</button>
          </header>
          <form className={styles.localForm} onSubmit={saveMember}>
            {editing === "new" ? <>
              <label>Full name<input required maxLength={180} autoComplete="name" disabled={Boolean(busy)} value={form.displayName} onChange={event => setForm(current => ({ ...current, displayName: event.target.value }))} /></label>
              <label>Individual email<input required type="email" maxLength={320} autoComplete="email" disabled={Boolean(busy)} value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} /></label>
              <p className={styles.formHint}>Use the person&apos;s own verified email. Shared or role-based mailboxes are rejected. After saving, give them the Creditex sign-in link. No invitation email is sent automatically.</p>
            </> : <div className={styles.memberIdentity}><strong>{editing.displayName || editing.email}</strong><span>{editing.email}</span></div>}
            <div className={styles.memberAccessControls}>
              <label>Role preset<select value={form.role} disabled={Boolean(busy)} onChange={event => setForm(current => ({ ...current, role: event.target.value, permissions: creditexRolePermissions(event.target.value) }))}>
                <option value="case_manager">Case manager</option><option value="reviewer">Reviewer</option><option value="auditor">Auditor</option><option value="admin">Administrator</option>
              </select></label>
              {editing !== "new" && <label>Access state<select value={form.status} disabled={Boolean(busy)} onChange={event => setForm(current => ({ ...current, status: event.target.value }))}>
                <option value="active">Active</option><option value="suspended">Suspended</option>
              </select></label>}
            </div>
            <div className={styles.formWide}><PermissionFields role={form.role} permissions={form.permissions} disabled={Boolean(busy)} onChange={permissions => setForm(current => ({ ...current, permissions }))} /></div>
            {actionError && <p className={styles.error} role="alert">{actionError}</p>}
            <div className={styles.dialogActions}>
              <button className={styles.primaryAction} type="submit" disabled={Boolean(busy) || loading}>{busy ? "Saving..." : editing === "new" ? "Add team member" : "Save changes"}</button>
              <button className={styles.refreshButton} type="button" disabled={Boolean(busy)} onClick={closeMemberDialog}>Cancel</button>
            </div>
          </form>
        </div>
      </div>}
    </section>
  );
}
