"use client";

import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { firebaseAuth } from "@/lib/firebase-client";
import { CREDITEX_ACCESS_PRESETS, CREDITEX_PERMISSION_GROUPS, creditexAllowedPermissions, hasCreditexPermission, resolveCreditexPermissions, setCreditexPermission, type CreditexPermission } from "@/lib/creditex-permissions";
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
  phone: string;
  jobTitle: string;
  role: string;
  status: string;
  lastLoginAt: string;
  permissions: CreditexPermission[];
};

type AccessInvitation = {
  id: string;
  email: string;
  displayName: string;
  phone: string;
  jobTitle: string;
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
  memberTotal: number;
  invitationTotal: number;
};

type JsonRecord = Record<string, unknown>;

const EMPTY_ACCESS: AccessSnapshot = {
  loaded: false,
  ownerEmail: "info@ausenergyassessments.com",
  members: [],
  invitations: [],
  memberTotal: 0,
  invitationTotal: 0,
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
    memberTotal: Number(source.memberTotal) || records(first(source, ["members", "users"])).length,
    invitationTotal: Number(source.invitationTotal) || records(first(source, ["invitations"])).length,
    members: records(first(source, ["members", "users"])).map((item) => ({
      id: text(item, ["id", "membershipId", "membership_id"]),
      email: text(item, ["email"]),
      displayName: text(item, ["displayName", "display_name"]),
      phone: text(item, ["phone"]),
      jobTitle: text(item, ["jobTitle", "job_title"]),
      role: text(item, ["role"]),
      status: text(item, ["status"]),
      lastLoginAt: text(item, ["lastLoginAt", "last_login_at"]),
      permissions: resolveCreditexPermissions(text(item, ["role"]), item.permissions),
    })),
    invitations: records(first(source, ["invitations"])).map((item) => ({
      id: text(item, ["id"]),
      email: text(item, ["email"]),
      displayName: text(item, ["displayName", "display_name"]),
      phone: text(item, ["phone"]),
      jobTitle: text(item, ["jobTitle", "job_title"]),
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
  const allowed = creditexAllowedPermissions(role);
  return <div className={styles.permissionFields}>
    <p>Choose what this person can view and change. Assigned jobs and independent compliance approvals still apply. The calculator is available to everyone.</p>
    {CREDITEX_PERMISSION_GROUPS.map(group => <fieldset key={group.label} disabled={disabled}>
      <legend>{group.label}</legend>
      <div className={styles.permissionGrid}>{group.permissions.map(permission => <label className={styles.permissionOption} key={permission.key}>
        <input type="checkbox" checked={permissions.includes(permission.key)} disabled={!allowed.includes(permission.key)}
          onChange={event => onChange(setCreditexPermission(role, permissions, permission.key, event.target.checked))} />
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
  const canViewTeam = hasCreditexPermission(session, "team_access") || hasCreditexPermission(session, "team_details");
  const load = useCallback(async () => {
    if (!canViewTeam) { setLoading(false); return; }
    setLoading(true); setError("");
    try { setAccess(parseAccess(await authenticatedJson("/api/creditex/access"))); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Team access could not be loaded."); }
    finally { setLoading(false); }
  }, [canViewTeam]);
  useEffect(() => {
    const timeout = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);
  return <div className={styles.workspace}><AccessView session={session} access={access} loading={loading} error={error} onRefresh={() => void load()} onSessionChanged={onSessionChanged} /></div>;
}

function personNameParts(displayName: string) {
  const [firstName = "", ...remaining] = displayName.trim().split(/\s+/);
  return { firstName, lastName: remaining.join(" ") };
}

function roleLabel(role: string) {
  if (role === "admin") return "Administrator";
  if (role === "case_manager") return "Compliance manager";
  return readable(role);
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
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    jobTitle: "",
    role: "case_manager",
    status: "active",
    permissions: creditexAllowedPermissions("case_manager"),
  });
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<"new" | AccessMember | null>(null);
  const [preset, setPreset] = useState("custom");
  const [view, setView] = useState<"members" | "invitations">("members");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [role, setRole] = useState("all");
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const canEditAccess = hasCreditexPermission(session, "team_access");
  const canViewTeam = canEditAccess || hasCreditexPermission(session, "team_details");

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
    if (busy || loading || !canViewTeam || (member === "new" && !canEditAccess)) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setActionError(""); setNotice("");
    setForm(member === "new"
      ? { firstName: "", lastName: "", email: "", phone: "", jobTitle: "", role: "case_manager", status: "active", permissions: creditexAllowedPermissions("case_manager") }
      : { ...personNameParts(member.displayName), email: member.email, phone: member.phone || "", jobTitle: member.jobTitle || "", role: member.role, status: member.status, permissions: [...member.permissions] });
    setPreset(member === "new" ? "compliance_manager" : "custom");
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
    if (!editing || busy || !canViewTeam) return;
    const details = { displayName: [form.firstName.trim(), form.lastName.trim()].filter(Boolean).join(" "), phone: form.phone.trim(), jobTitle: form.jobTitle.trim() };
    const saved = editing === "new"
      ? canEditAccess && await accessAction("create_invitation", {
        ...details, email: form.email, role: form.role, permissions: form.permissions,
      }, `Invitation ready for ${details.displayName}. Give them the Creditex sign-in link and ask them to use ${form.email}. No invitation email was sent.`)
      : await accessAction(canEditAccess ? "update_member_access" : "update_member_details", {
        memberId: editing.id, ...details, ...(canEditAccess ? { role: form.role, status: form.status, permissions: form.permissions } : {}),
      }, `Details updated for ${details.displayName || editing.email}.`);
    if (saved) dismissMemberDialog();
  }

  async function confirmNamedOwner() {
    const confirmed = await accessAction("confirm_named_owner", {}, "James Morris is now the named Creditex administrator for this login.");
    if (confirmed && onSessionChanged) await onSessionChanged();
  }

  async function revokeInvitation(invitation: AccessInvitation) {
    if (!canEditAccess || busy) return;
    if (!window.confirm(
      `Revoke the pending invitation for ${invitation.displayName || invitation.email}?`,
    )) return;
    await accessAction(
      "revoke_invitation",
      { invitationId: invitation.id },
      "The pending invitation was revoked.",
    );
  }

  function changeView(next: "members" | "invitations") {
    setView(next); setStatus("all");
  }

  const matches = (person: AccessMember | AccessInvitation) => (status === "all" || person.status === status)
    && (role === "all" || person.role === role)
    && [person.displayName, person.email, person.phone, person.jobTitle].some(value => (value || "").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const visibleMembers = access.members.filter(matches);
  const visibleInvitations = access.invitations.filter(matches);
  const loadedCount = view === "members" ? access.members.length : access.invitations.length;
  const totalCount = view === "members" ? access.memberTotal : access.invitationTotal;

  return (
    <section aria-labelledby="operations-access-title">
      <div className={styles.sectionHeader}>
        <div>
          <h3 id="operations-access-title">Your team</h3>
          <p>
            Keep each person&apos;s contact details and access in one place.
          </p>
        </div>
        {canViewTeam && (
          <div className={styles.actions}><button
            className={styles.refreshButton}
            type="button"
            disabled={loading || Boolean(busy)}
            onClick={onRefresh}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          {canEditAccess && <button type="button" className={styles.primaryAction} disabled={loading || Boolean(busy)} onClick={() => openMemberDialog("new")}>Add team member</button>}</div>
        )}
      </div>
      {session.canConfirmNamedOwner && <div className={styles.accessPolicy}>
        <strong>Use this account as James Morris</strong>
        <p>Confirm your existing {session.email} owner login as James Morris, Creditex Administrator. You can manage the workspace, edit and publish forms, invite individual team members and assign their roles.</p>
        <p>Actions remain attributed to your verified login. Independent regulator and source approvals still require their separate reviewer.</p>
        <button type="button" disabled={Boolean(busy) || loading} onClick={() => void confirmNamedOwner()}>{busy === "confirm_named_owner" ? "Confirming James Morris..." : "Confirm James Morris as administrator"}</button>
      </div>}
      {!canViewTeam && (
        <EmptyState>
          Your current access does not include managing team details or permissions.
        </EmptyState>
      )}
      {canViewTeam && error && (
        <p className={styles.error} role="alert">{error}</p>
      )}
      {canViewTeam && notice && (
        <p className={styles.success} role="status">{notice}</p>
      )}
      {canViewTeam && actionError && !editing && (
        <p className={styles.error} role="alert">{actionError}</p>
      )}
      {canViewTeam && <>
        <nav className={styles.actions} aria-label="Team views">
          <button type="button" className={view === "members" ? styles.primaryAction : styles.refreshButton} aria-pressed={view === "members"} onClick={() => changeView("members")}>Your team</button>
          {canEditAccess && <button type="button" className={view === "invitations" ? styles.primaryAction : styles.refreshButton} aria-pressed={view === "invitations"} onClick={() => changeView("invitations")}>Invitations</button>}
        </nav>
        <section className={styles.list} aria-label={view === "members" ? "Team members" : "Team invitations"}>
          <header className={styles.listHeader}><strong>{view === "members" ? "People" : "Invitations"}</strong><span>{view === "members" ? visibleMembers.length : visibleInvitations.length} {query || status !== "all" || role !== "all" ? "matching " : ""}{view === "members" ? "team members" : "invitations"}</span></header>
          <div className={styles.filters}>
            <label>Search<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, phone, email or job title" /></label>
            <label>Status<select value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option>{view === "members" ? <><option value="active">Active</option><option value="suspended">Suspended</option></> : <><option value="pending">Pending</option><option value="claimed">Claimed</option><option value="expired">Expired</option><option value="revoked">Revoked</option></>}</select></label>
            <label>Role<select value={role} onChange={event => setRole(event.target.value)}><option value="all">All roles</option><option value="admin">Administrator</option><option value="case_manager">Compliance manager</option><option value="reviewer">Reviewer</option><option value="auditor">Auditor</option></select></label>
          </div>
          {totalCount > loadedCount && <p className={styles.formHint}>Showing {loadedCount} of {totalCount} {view === "members" ? "team members" : "invitations"}. Filters search this loaded list.</p>}
          {loading && !access.loaded ? <EmptyState>Loading your team...</EmptyState> : view === "members" ? visibleMembers.length ? <>
            <div className={styles.tableShell}><table className={styles.memberTable}>
              <caption className={styles.srOnly}>Team member contact details, status and access</caption>
              <thead><tr><th scope="col">First name</th><th scope="col">Last name</th><th scope="col">Phone</th><th scope="col">Email</th><th scope="col">Status</th><th scope="col">Role</th><th scope="col">Actions</th></tr></thead>
              <tbody>{visibleMembers.map(member => <tr key={member.id}>
                <td><strong>{personNameParts(member.displayName).firstName || "Not added"}</strong>{member.jobTitle && <small>{member.jobTitle}</small>}</td>
                <td><strong>{personNameParts(member.displayName).lastName || "Not added"}</strong></td>
                <td>{member.phone ? <a href={`tel:${member.phone}`}>{member.phone}</a> : <span>Not added</span>}</td>
                <td><a href={`mailto:${member.email}`}>{member.email}</a></td>
                <td><StatusPill value={member.status} /><small>{member.lastLoginAt ? `Last login ${dateTime(member.lastLoginAt)}` : "Not signed in yet"}</small></td>
                <td><span>{roleLabel(member.role)}</span></td>
                <td><button className={styles.inlineAction} type="button" disabled={Boolean(busy) || loading} aria-label={`Open details for ${member.displayName || member.email}`} onClick={() => openMemberDialog(member)}>Open details</button></td>
              </tr>)}</tbody>
            </table></div>
            <div className={styles.mobileCards}>{visibleMembers.map(member => <article className={styles.memberCard} key={member.id}>
              <header className={styles.memberHeader}><div><strong>{member.displayName || member.email}</strong>{member.jobTitle && <small>{member.jobTitle}</small>}<span>{member.email}</span>{member.phone && <a href={`tel:${member.phone}`}>{member.phone}</a>}</div><StatusPill value={member.status} /></header>
              <p>{roleLabel(member.role)}</p><small>{member.lastLoginAt ? `Last login ${dateTime(member.lastLoginAt)}` : "Not signed in yet"}</small>
              <button className={styles.inlineAction} type="button" disabled={Boolean(busy) || loading} aria-label={`Open details for ${member.displayName || member.email}`} onClick={() => openMemberDialog(member)}>Open details</button>
            </article>)}</div>
          </> : <EmptyState>{access.members.length ? "No team members match these filters." : "No team members yet."}</EmptyState> : <>
            {visibleInvitations.length ? <div className={styles.tableShell}><table className={styles.memberTable}>
              <caption className={styles.srOnly}>Team invitations and access status</caption>
              <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Expires</th><th scope="col">Actions</th></tr></thead>
              <tbody>{visibleInvitations.map(invitation => <tr key={invitation.id}>
                <td><strong>{invitation.displayName}</strong>{invitation.jobTitle && <small>{invitation.jobTitle}</small>}</td><td>{invitation.email}</td><td>{roleLabel(invitation.role)}</td><td><StatusPill value={invitation.status} /></td><td>{dateTime(invitation.expiresAt)}</td>
                <td>{invitation.status === "pending" && <button className={styles.inlineAction} type="button" disabled={Boolean(busy)} onClick={() => void revokeInvitation(invitation)}>Revoke invitation</button>}</td>
              </tr>)}</tbody>
            </table></div> : <EmptyState>{access.invitations.length ? "No invitations match these filters." : "No invitations yet. Add a team member to get started."}</EmptyState>}
          </>}
        </section>
        <details className={styles.accessPolicy}>
          <summary>Account and invitation help</summary>
          <p>Give each invited person <a href="/creditex/compliance" target="_blank" rel="noreferrer">the Creditex sign-in link</a> and ask them to use their invited email. No invitation email is sent automatically.</p>
          {session.namedOwnerConfirmed && <><strong>James Morris · Creditex Administrator</strong><p>Your {session.email} login has named manager access.</p></>}
          <p>The initial owner invitation is {access.ownerEmail || "info@ausenergyassessments.com"}. It is not a shared Creditex login. Invite each team member with their own verified email. Keep at least
            two named administrators for continuity. A confirmed named owner can
            keep using this account as their individual manager login.</p>
        </details>
      </>}
      {canViewTeam && editing && <div className={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget) closeMemberDialog(); }}>
        <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="creditex-team-member-title" tabIndex={-1} onKeyDown={event => trapTeamDialogKey(event, closeMemberDialog)}>
          <header className={styles.dialogHeader}>
            <div><span>{editing === "new" ? "Add team member" : "Edit team member"}</span><h4 id="creditex-team-member-title">Person and access</h4></div>
            <button type="button" className={styles.iconButton} aria-label="Close team member" disabled={Boolean(busy)} onClick={closeMemberDialog}>×</button>
          </header>
          <form className={styles.localForm} onSubmit={saveMember}>
            <div className={styles.contactGrid}>
              <label>First name<input name="firstName" required maxLength={90} autoComplete="given-name" disabled={Boolean(busy)} value={form.firstName} onChange={event => setForm(current => ({ ...current, firstName: event.target.value }))} /></label>
              <label>Last name<input name="lastName" required maxLength={90} autoComplete="family-name" disabled={Boolean(busy)} value={form.lastName} onChange={event => setForm(current => ({ ...current, lastName: event.target.value }))} /></label>
              <label>{editing === "new" ? "Email for invitation" : "Sign-in email"}<input name="email" required type="email" maxLength={320} autoComplete="email" readOnly={editing !== "new"} disabled={Boolean(busy)} value={form.email} onChange={event => { if (editing === "new") setForm(current => ({ ...current, email: event.target.value })); }} /></label>
              <label>Phone, optional<input name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={30} pattern="[+0-9() .-]*" disabled={Boolean(busy)} value={form.phone} onChange={event => setForm(current => ({ ...current, phone: event.target.value.replace(/[^+0-9() .-]/g, "") }))} /></label>
              <label>Job title, optional<input name="jobTitle" maxLength={100} autoComplete="organization-title" disabled={Boolean(busy)} value={form.jobTitle} onChange={event => setForm(current => ({ ...current, jobTitle: event.target.value }))} /></label>
            </div>
            <p className={styles.formHint}>{editing === "new" ? "Use the person's own verified email. After saving, give them the Creditex sign-in link. No invitation email is sent automatically." : "The sign-in email stays linked to this person's account and audit history."}</p>
            <section className={styles.portalAccessPanel} aria-label="TLink portal access"><div><strong>TLink portal access</strong><p>Open the Creditex workspace and sign in with the invited email.</p></div><a className={styles.inlineAction} href="/creditex/compliance" target="_blank" rel="noopener noreferrer">Portal login</a></section>
            <section className={styles.fieldAccessPanel} aria-label="TLink app access"><Image src="/tlink-icon-192.png" alt="" width={58} height={58} /><div><strong>TLink app access</strong><p>Install TLink, choose <strong>Creditex team sign-in</strong>, then use the invited email, password and authenticator code.</p><a className={styles.inlineAction} href="/direct-trade/field-app" target="_blank" rel="noopener noreferrer">Get the app</a><small>{editing !== "new" && editing.status !== "active" ? "This person's access is suspended. Reactivate access before they can sign in." : "Complete account security in the Creditex browser workspace first. Each person uses their own account."}</small></div></section>
            {canEditAccess ? <>
            <div className={styles.memberAccessControls}>
              <label>Quick access preset<select value={preset} disabled={Boolean(busy)} onChange={event => {
                const selected = CREDITEX_ACCESS_PRESETS.find(item => item.id === event.target.value);
                if (!selected) return;
                setPreset(selected.id); setForm(current => ({ ...current, role: selected.role, permissions: [...selected.permissions] }));
              }}>{CREDITEX_ACCESS_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
              {editing !== "new" && <label>Access state<select value={form.status} disabled={Boolean(busy)} onChange={event => setForm(current => ({ ...current, status: event.target.value }))}>
                <option value="active">Active</option><option value="suspended">Suspended</option>
              </select></label>}
            </div>
            <p className={styles.formHint}>{preset === "custom" ? "This person's individual switches are shown below." : CREDITEX_ACCESS_PRESETS.find(item => item.id === preset)?.description} Applying a preset fills the switches below. You can then change each permission.</p>
            <PermissionFields role={form.role} permissions={form.permissions} disabled={Boolean(busy)} onChange={permissions => { setPreset("custom"); setForm(current => ({ ...current, permissions })); }} />
            </> : <p className={styles.formHint}>You can update this person&apos;s contact details. Changing roles, access or permissions requires Manage team access permission.</p>}
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
