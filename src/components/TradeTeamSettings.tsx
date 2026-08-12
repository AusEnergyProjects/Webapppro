"use client";

/* eslint-disable @next/next/no-img-element */

import {
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { User } from "firebase/auth";
import { ENERGY_SERVICE_CATALOGUE } from "@/lib/energy-service-catalogue.mjs";
import type { TLinkCommandTarget } from "./TLinkCommandCentre";
import styles from "./TradeTeamSettings.module.css";

type Scope = "own" | "team";
type MemberStatus = "active" | "suspended";
type RosterStatus = "all" | "active" | "invited" | "suspended";
type ScheduleColour = "emerald" | "teal" | "blue" | "violet" | "amber" | "rose";
type AccessPreset = "manager" | "office" | "field";

export type TradeTeamPermissions = {
  jobScope: Scope;
  canCreateJobs: boolean;
  canManageJobs: boolean;
  canAssignJobs: boolean;
  canViewCustomers: boolean;
  canManageCustomers: boolean;
  canSearchCustomers: boolean;
  canViewQuotes: boolean;
  canManageQuotes: boolean;
  canSendQuotes: boolean;
  canApplyDiscounts: boolean;
  canViewInvoices: boolean;
  canManageInvoices: boolean;
  canViewPriceBook: boolean;
  canManagePriceBook: boolean;
  scheduleScope: Scope;
  canRescheduleJobs: boolean;
  canManageTeam: boolean;
  canEditTeamPermissions: boolean;
  canViewFieldEvidence: boolean;
  canManageFieldEvidence: boolean;
  canRunReports: boolean;
};

type BooleanPermissionKey = Exclude<keyof TradeTeamPermissions, "jobScope" | "scheduleScope">;

export type TradeTeamMember = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  phone: string;
  scheduleColour: ScheduleColour;
  status: MemberStatus;
  hasLogin: boolean;
  invitePending: boolean;
  isOwner: boolean;
  fileCount: number;
  capabilities?: string[];
  lastActiveAt?: string;
  updatedAt: string;
  permissions: TradeTeamPermissions;
};

type MemberFile = {
  id: string;
  memberId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  title: string;
  expiresAt: string;
  createdAt: string;
};

type TeamResult = {
  ok?: boolean;
  access?: {
    isOwner: boolean;
    canManageTeam: boolean;
    memberId: string;
    permissions: TradeTeamPermissions;
  };
  members?: TradeTeamMember[];
  roster?: { page: number; pageSize: number; total: number; totalPages: number; search: string; status: string; capability: string };
  invite?: { inviteUrl: string };
  error?: string;
};

type TeamDevice = {
  id: string;
  deviceName: string;
  platform: string;
  appVersion: string;
  pushConnected: boolean;
  status: string;
  memberName: string;
  memberEmail: string;
  memberStatus?: MemberStatus;
  lastSeenAt: string;
};

type DeviceResult = {
  ok?: boolean;
  devices?: TeamDevice[];
  pagination?: { page: number; pageSize: number; total: number; totalPages: number };
  pendingPushEvents?: number;
  error?: string;
};

const fullPermissions: TradeTeamPermissions = {
  jobScope: "team", canCreateJobs: true, canManageJobs: true, canAssignJobs: true,
  canViewCustomers: true, canManageCustomers: true,
  canSearchCustomers: true,
  canViewQuotes: true, canManageQuotes: true, canSendQuotes: true, canApplyDiscounts: true,
  canViewInvoices: true, canManageInvoices: true,
  canViewPriceBook: true, canManagePriceBook: true,
  scheduleScope: "team", canRescheduleJobs: true, canManageTeam: true, canEditTeamPermissions: true,
  canViewFieldEvidence: true, canManageFieldEvidence: true,
  canRunReports: true,
};

const officePermissions: TradeTeamPermissions = {
  ...fullPermissions,
  canManageTeam: false,
  canEditTeamPermissions: false,
  canManageFieldEvidence: false,
  canApplyDiscounts: false,
};

const fieldPermissions: TradeTeamPermissions = {
  jobScope: "own", canCreateJobs: false, canManageJobs: true, canAssignJobs: false,
  canViewCustomers: false, canManageCustomers: false,
  canSearchCustomers: false,
  canViewQuotes: false, canManageQuotes: false, canSendQuotes: false, canApplyDiscounts: false,
  canViewInvoices: false, canManageInvoices: false,
  canViewPriceBook: true, canManagePriceBook: false,
  scheduleScope: "own", canRescheduleJobs: false, canManageTeam: false, canEditTeamPermissions: false,
  canViewFieldEvidence: true, canManageFieldEvidence: true,
  canRunReports: false,
};

const accessPresets: Array<{ id: AccessPreset; name: string; description: string; permissions: TradeTeamPermissions }> = [
  { id: "manager", name: "Manager access", description: "Starts with full business access, including reports and customer search.", permissions: fullPermissions },
  { id: "office", name: "Office access", description: "Starts with jobs, customers, quoting, accounts, reports and the team schedule.", permissions: officePermissions },
  { id: "field", name: "Field access", description: "Starts with assigned jobs, own schedule and field evidence only.", permissions: fieldPermissions },
];

const scheduleColours: Array<{ id: ScheduleColour; label: string }> = [
  { id: "emerald", label: "Emerald" }, { id: "teal", label: "Teal" },
  { id: "blue", label: "Blue" }, { id: "violet", label: "Violet" },
  { id: "amber", label: "Amber" }, { id: "rose", label: "Rose" },
];

const permissionGroups: Array<{ label: string; items: Array<{ key: BooleanPermissionKey; label: string; detail: string }> }> = [
  { label: "Jobs and customers", items: [
    { key: "canCreateJobs", label: "Create jobs", detail: "Start a new customer job." },
    { key: "canManageJobs", label: "Edit job details and status", detail: "Edit work, tasks and job progress within their job scope." },
    { key: "canAssignJobs", label: "Assign and reassign jobs", detail: "Choose who owns work within their job scope." },
    { key: "canViewCustomers", label: "View customer records", detail: "Open standalone customer records. Assigned jobs, quotes and invoices still show the customer context needed for that work." },
    { key: "canManageCustomers", label: "Update customers", detail: "Edit customer records they can access." },
    { key: "canSearchCustomers", label: "Search every customer and directory", detail: "Sensitive: search across customers and contacts beyond assigned jobs." },
  ] },
  { label: "Quotes and invoices", items: [
    { key: "canViewQuotes", label: "View quotes", detail: "Open quote details and PDFs." },
    { key: "canManageQuotes", label: "Create and edit quotes", detail: "Build and change customer quotes." },
    { key: "canSendQuotes", label: "Send quotes", detail: "Send a finished quote to the customer." },
    { key: "canApplyDiscounts", label: "Apply discounts", detail: "Reduce quote or invoice prices." },
    { key: "canViewInvoices", label: "View invoices", detail: "Open invoice details and PDFs." },
    { key: "canManageInvoices", label: "Create and edit invoices", detail: "Prepare, issue and update invoices." },
  ] },
  { label: "Products, team and field", items: [
    { key: "canViewPriceBook", label: "View price book", detail: "Use saved products and rates." },
    { key: "canManagePriceBook", label: "Add and edit price book", detail: "Add and change products and rates." },
    { key: "canRescheduleJobs", label: "Reschedule jobs", detail: "Add or move job appointments within their schedule scope." },
    { key: "canManageTeam", label: "Manage team members", detail: "Add people and update member contact details or status." },
    { key: "canEditTeamPermissions", label: "Edit access permissions", detail: "Sensitive: change what another team member can see or do. This never allows changing their own access." },
    { key: "canViewFieldEvidence", label: "View field documents", detail: "Open job evidence and field documents." },
    { key: "canManageFieldEvidence", label: "Add field documents", detail: "Upload, update and remove job evidence." },
    { key: "canRunReports", label: "Run whole-business reports", detail: "Sensitive: open reporting across the whole business." },
  ] },
];

function normalizePermissions(value?: Partial<TradeTeamPermissions>): TradeTeamPermissions {
  return { ...fieldPermissions, ...value };
}

function enforcePermissionDependencies(input: TradeTeamPermissions): TradeTeamPermissions {
  const next = { ...input };
  if (next.canSendQuotes) next.canManageQuotes = true;
  if (next.canManageQuotes) next.canViewQuotes = true;
  if (!next.canViewQuotes) { next.canManageQuotes = false; next.canSendQuotes = false; }
  if (next.canManageInvoices) next.canViewInvoices = true;
  if (!next.canViewInvoices) next.canManageInvoices = false;
  if (next.canManageCustomers) next.canViewCustomers = true;
  if (!next.canViewCustomers) next.canManageCustomers = false;
  if (next.canManagePriceBook) next.canViewPriceBook = true;
  if (!next.canViewPriceBook) next.canManagePriceBook = false;
  if (next.canManageFieldEvidence) next.canViewFieldEvidence = true;
  if (!next.canViewFieldEvidence) next.canManageFieldEvidence = false;
  if (next.canEditTeamPermissions) next.canManageTeam = true;
  if (!next.canManageTeam) next.canEditTeamPermissions = false;
  return next;
}

function bytesLabel(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function memberLabel(member: TradeTeamMember) {
  return member.displayName || [member.firstName, member.lastName].filter(Boolean).join(" ") || member.email;
}

function filterPhoneInput(value: string) {
  const filtered = value.replace(/[^+0-9() .-]/g, "");
  const firstPlus = filtered.indexOf("+");
  return filtered.split("").filter((character, index) => character !== "+" || (index === 0 && firstPlus === 0)).join("");
}

function trapDialogKey(event: KeyboardEvent<HTMLElement>, close: () => void) {
  if (event.key === "Escape") { event.preventDefault(); close(); return; }
  if (event.key !== "Tab") return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
  if (!focusable.length) return;
  const first = focusable[0]; const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

export function TradeTeamSettings({ user, navigationTarget }: { user: User; navigationTarget?: TLinkCommandTarget | null }) {
  const [members, setMembers] = useState<TradeTeamMember[]>([]);
  const [teamAccess, setTeamAccess] = useState<TeamResult["access"]>(undefined);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<TradeTeamMember | "new" | null>(null);
  const [formPreset, setFormPreset] = useState<AccessPreset | "custom">("field");
  const [formPermissions, setFormPermissions] = useState(fieldPermissions);
  const [memberServices, setMemberServices] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ member: TradeTeamMember; x: number; y: number } | null>(null);
  const [filesMember, setFilesMember] = useState<TradeTeamMember | null>(null);
  const [files, setFiles] = useState<MemberFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [preview, setPreview] = useState<{ file: MemberFile; url: string } | null>(null);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<RosterStatus>("all");
  const [capabilityFilter, setCapabilityFilter] = useState("");
  const [page, setPage] = useState(1);
  const [roster, setRoster] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [inviteUrl, setInviteUrl] = useState("");
  const [devices, setDevices] = useState<TeamDevice[]>([]);
  const [deviceQuery, setDeviceQuery] = useState("");
  const [appliedDeviceQuery, setAppliedDeviceQuery] = useState("");
  const [deviceStatus, setDeviceStatus] = useState<"" | "active" | "revoked">("");
  const [deviceMemberId, setDeviceMemberId] = useState("");
  const [devicePage, setDevicePage] = useState(1);
  const [deviceRoster, setDeviceRoster] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [pendingPushEvents, setPendingPushEvents] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const filesDialogRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const handledNavigationNonceRef = useRef(0);

  const visibleMembers = members;

  const tokenHeaders = useCallback(async () => ({ Authorization: `Bearer ${await user.getIdToken()}` }), [user]);
  const load = useCallback(async () => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: "25",
      status: statusFilter,
    });
    if (appliedQuery) params.set("search", appliedQuery);
    if (capabilityFilter) params.set("capability", capabilityFilter);
    if (navigationTarget?.workspace === "team" && navigationTarget.kind === "team"
      && handledNavigationNonceRef.current !== navigationTarget.nonce) {
      params.set("memberId", navigationTarget.id);
    }
    const response = await fetch(`/api/trade-team?${params}`, { headers: await tokenHeaders(), cache: "no-store" });
    const result = await response.json().catch(() => ({})) as TeamResult;
    if (!response.ok || !result.ok) throw new Error(result.error || "The team could not be loaded.");
    setTeamAccess(result.access);
    setMembers(result.members || []);
    if (result.roster) setRoster(result.roster);
    return result;
  }, [appliedQuery, capabilityFilter, navigationTarget, page, statusFilter, tokenHeaders]);
  const handleMemberConflict = useCallback(async (response: Response) => {
    if (response.status !== 409) return false;
    await load();
    setEditing(null);
    setMenu(null);
    setMessage("");
    setError("This team member changed while you were editing. The latest details are loaded. Review them and try again.");
    return true;
  }, [load]);

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      const params = new URLSearchParams({ page: String(devicePage), pageSize: "25" });
      if (appliedDeviceQuery) params.set("search", appliedDeviceQuery);
      if (deviceStatus) params.set("status", deviceStatus);
      if (deviceMemberId) params.set("memberId", deviceMemberId);
      const response = await fetch(`/api/trade-team/devices?${params}`, { headers: await tokenHeaders(), cache: "no-store" });
      const result = await response.json().catch(() => ({})) as DeviceResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "Field devices could not be loaded.");
      setDevices(result.devices || []);
      if (result.pagination) {
        setDeviceRoster(result.pagination);
        if (devicePage > result.pagination.totalPages) setDevicePage(result.pagination.totalPages);
      }
      setPendingPushEvents(result.pendingPushEvents || 0);
    } finally {
      setDevicesLoading(false);
    }
  }, [appliedDeviceQuery, deviceMemberId, devicePage, deviceStatus, tokenHeaders]);

  const openFiles = useCallback(async (member: TradeTeamMember) => {
    if (!restoreFocusRef.current) restoreFocusRef.current = document.activeElement as HTMLElement | null;
    setMenu(null); setFilesMember(member); setFilesLoading(true); setFiles([]); setError("");
    if (preview) { URL.revokeObjectURL(preview.url); setPreview(null); }
    try {
      const response = await fetch(`/api/trade-team/member-files?memberId=${encodeURIComponent(member.id)}`, { headers: await tokenHeaders(), cache: "no-store" });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; files?: MemberFile[]; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Member files could not be loaded.");
      setFiles(result.files || []);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Member files could not be loaded."); }
    finally { setFilesLoading(false); }
  }, [preview, tokenHeaders]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      void load().catch((caught) => active && setError(caught instanceof Error ? caught.message : "The team could not be loaded."))
        .finally(() => active && setLoading(false));
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [load]);

  useEffect(() => {
    if (!teamAccess?.canManageTeam) return;
    const frame = window.requestAnimationFrame(() => {
      void loadDevices().catch((caught) => setError(caught instanceof Error ? caught.message : "Field devices could not be loaded."));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loadDevices, teamAccess?.canManageTeam]);

  useEffect(() => {
    if (!editing) return;
    window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("input, button")?.focus());
  }, [editing]);

  useEffect(() => {
    if (!filesMember) return;
    window.requestAnimationFrame(() => filesDialogRef.current?.focus());
  }, [filesMember]);

  useEffect(() => {
    if (!menu) return;
    window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>("button")?.focus());
  }, [menu]);

  useEffect(() => {
    if (!editing && !filesMember) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [editing, filesMember]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  useEffect(() => {
    if (!navigationTarget || navigationTarget.workspace !== "team" || navigationTarget.kind !== "team"
      || handledNavigationNonceRef.current === navigationTarget.nonce || loading) return;
    const frame = window.requestAnimationFrame(() => {
      handledNavigationNonceRef.current = navigationTarget.nonce;
      const member = members.find((item) => item.id === navigationTarget.id);
      if (member) void openFiles(member);
      else setError("That team member could not be found.");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, members, navigationTarget, openFiles]);

  function openNew() {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    setFormPreset("field"); setFormPermissions(fieldPermissions); setEditing("new");
    setMemberServices([]);
  }

  function searchMembers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPage(1); setAppliedQuery(query.trim());
  }

  function openEdit(member: TradeTeamMember) {
    if (!menu) restoreFocusRef.current = document.activeElement as HTMLElement | null;
    setFormPreset("custom"); setFormPermissions(normalizePermissions(member.permissions));
    setEditing(member); setMenu(null);
    setMemberServices(member.capabilities || []);
  }

  function applyPreset(presetId: AccessPreset) {
    const preset = accessPresets.find((item) => item.id === presetId) || accessPresets[2];
    setFormPreset(presetId);
    const next = { ...preset.permissions };
    const actor = teamAccess?.permissions;
    if (actor && !teamAccess?.isOwner) {
      for (const group of permissionGroups) {
        for (const item of group.items) {
          if (!actor[item.key]) next[item.key] = false;
        }
      }
      if (actor.jobScope === "own") next.jobScope = "own";
      if (actor.scheduleScope === "own") next.scheduleScope = "own";
    }
    setFormPermissions(next);
  }

  function setPermission(key: keyof TradeTeamPermissions, value: boolean | Scope) {
    setFormPermissions((current) => enforcePermissionDependencies({ ...current, [key]: value }));
    setFormPreset("custom");
  }

  function closeMemberDialog() {
    if (busy) return;
    setEditing(null);
    window.requestAnimationFrame(() => restoreFocusRef.current?.focus());
  }

  async function saveMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget; const data = new FormData(form);
    const isNew = editing === "new";
    setBusy("member"); setError(""); setMessage("Saving team member...");
    try {
      const editedMember = editing !== "new" ? editing : null;
      const mayChangeAccess = canEditPermissions && (isNew || Boolean(editedMember && !isCurrentMember(editedMember)));
      const body: Record<string, unknown> = {
        action: isNew ? "add_member" : "update_member",
        memberId: !isNew && editing ? editing.id : undefined,
        firstName: String(data.get("firstName") || "").trim(),
        lastName: String(data.get("lastName") || "").trim(),
        email: String(data.get("email") || "").trim(),
        phone: String(data.get("phone") || "").trim(),
        scheduleColour: String(data.get("scheduleColour") || "emerald"),
        status: isNew ? "active" : editedMember?.status || "active",
        capabilities: memberServices,
        expectedUpdatedAt: editedMember?.updatedAt,
      };
      if (mayChangeAccess) Object.assign(body, {
        permissions: formPermissions,
        ...formPermissions,
      });
      const response = await fetch("/api/trade-team", { method: isNew ? "POST" : "PATCH", headers: { "Content-Type": "application/json", ...(await tokenHeaders()) }, body: JSON.stringify(body) });
      if (!isNew && await handleMemberConflict(response)) return;
      const result = await response.json().catch(() => ({})) as TeamResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "The team member could not be saved.");
      if (result.invite?.inviteUrl) setInviteUrl(result.invite.inviteUrl);
      setEditing(null); await load(); setMessage(isNew ? "Team member added." : "Team member updated.");
    } catch (caught) { setMessage(""); setError(caught instanceof Error ? caught.message : "The team member could not be saved."); }
    finally { setBusy(""); }
  }

  async function createLogin(member: TradeTeamMember) {
    if (!member.email) { openEdit(member); setMessage("Add an email, save the member, then create their login link."); return; }
    const action = member.invitePending ? "reissue_invite" : "invite_member";
    setBusy(`invite:${member.id}`); setError(""); setMessage(action === "reissue_invite" ? "Refreshing login link..." : "Creating login link...");
    try {
      const response = await fetch("/api/trade-team", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await tokenHeaders()) },
        body: JSON.stringify({ action, memberId: member.id, firstName: member.firstName, lastName: member.lastName,
          displayName: memberLabel(member), email: member.email, phone: member.phone,
          scheduleColour: member.scheduleColour, expectedUpdatedAt: member.updatedAt }),
      });
      if (await handleMemberConflict(response)) return;
      const result = await response.json().catch(() => ({})) as TeamResult;
      if (!response.ok || !result.ok || !result.invite?.inviteUrl) throw new Error(result.error || "The login link could not be created.");
      setInviteUrl(result.invite.inviteUrl); await load();
      setMessage(action === "reissue_invite" ? "Fresh login link created." : "Login link created.");
    } catch (caught) { setMessage(""); setError(caught instanceof Error ? caught.message : "The login link could not be created."); }
    finally { setBusy(""); }
  }

  async function updateMemberStatus(member: TradeTeamMember, nextStatus: MemberStatus) {
    if (member.isOwner || member.status === nextStatus) return;
    const actionLabel = nextStatus === "active" ? "Reactivate" : "Deactivate";
    if (!window.confirm(`${actionLabel} access for ${memberLabel(member)}? Their job history, files and compliance records will remain saved. Reactivation restores login eligibility, but revoked devices stay revoked and old invitation links stay invalid.`)) return;
    setBusy(`status:${member.id}`); setError(""); setMessage(`${actionLabel.slice(0, -1)}ing team access...`);
    try {
      const response = await fetch("/api/trade-team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await tokenHeaders()) },
        body: JSON.stringify({ action: "update_member", memberId: member.id, status: nextStatus, expectedUpdatedAt: member.updatedAt }),
      });
      if (await handleMemberConflict(response)) return;
      const result = await response.json().catch(() => ({})) as TeamResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "Team access could not be updated.");
      setMenu(null); await load();
      setMessage(nextStatus === "active" ? "Team access reactivated. Revoked devices remain revoked and a fresh invitation is required when no login is linked." : "Team access deactivated. History, files and job records remain saved.");
    } catch (caught) {
      setMessage(""); setError(caught instanceof Error ? caught.message : "Team access could not be updated.");
    } finally {
      setBusy("");
    }
  }

  async function copyInvite() {
    try { await navigator.clipboard.writeText(inviteUrl); setMessage("Private login link copied."); }
    catch { setError("Copy was blocked. Select the login link and copy it manually."); }
  }

  async function updateDevice(device: TeamDevice, action: "revoke_device" | "authorise_device") {
    if (action === "revoke_device" && !window.confirm(`Revoke field access for ${device.deviceName}?`)) return;
    setBusy(`device:${device.id}`); setError("");
    try {
      const response = await fetch("/api/trade-team/devices", { method: "PATCH", headers: {
        "Content-Type": "application/json", ...(await tokenHeaders()),
      }, body: JSON.stringify({ id: device.id, action }) });
      const result = await response.json().catch(() => ({})) as DeviceResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "The device update could not be saved.");
      await loadDevices();
      setMessage(action === "revoke_device" ? "Device access revoked." : "Device authorised again.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The device update could not be saved."); }
    finally { setBusy(""); }
  }

  function showMenu(event: MouseEvent, member: TradeTeamMember) {
    event.preventDefault();
    restoreFocusRef.current = event.currentTarget as HTMLElement;
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const x = event.clientX || rect.left; const y = event.clientY || rect.bottom;
    setMenu({ member, x: Math.max(8, Math.min(x, window.innerWidth - 210)), y: Math.max(8, Math.min(y, window.innerHeight - 110)) });
  }

  function closeMenu() {
    setMenu(null);
    window.requestAnimationFrame(() => restoreFocusRef.current?.focus());
  }

  function handleMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]'));
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") { event.preventDefault(); closeMenu(); }
    else if (event.key === "ArrowDown") { event.preventDefault(); items[(current + 1) % items.length]?.focus(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); items[(current - 1 + items.length) % items.length]?.focus(); }
  }

  async function uploadFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!filesMember) return;
    const form = event.currentTarget; const data = new FormData(form); data.set("action", "upload"); data.set("memberId", filesMember.id);
    setBusy("file-upload"); setError("");
    try {
      const response = await fetch("/api/trade-team/member-files", { method: "POST", headers: await tokenHeaders(), body: data });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; file?: MemberFile; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "The file could not be uploaded.");
      if (!result.file) throw new Error("The uploaded file record was not returned.");
      setFiles((current) => [result.file!, ...current]);
      form.reset(); await load(); setMessage("Member file saved.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The file could not be uploaded."); }
    finally { setBusy(""); }
  }

  async function fetchFile(file: MemberFile, download = false) {
    setBusy(`file:${file.id}`); setError("");
    try {
      const response = await fetch(`/api/trade-team/member-files?memberId=${encodeURIComponent(file.memberId)}&fileId=${encodeURIComponent(file.id)}${download ? "&download=1" : ""}`, { headers: await tokenHeaders(), cache: "no-store" });
      if (!response.ok) { const result = await response.json().catch(() => ({})) as { error?: string }; throw new Error(result.error || "The file could not be opened."); }
      const url = URL.createObjectURL(await response.blob());
      if (download) { const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.fileName; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
      else { if (preview) URL.revokeObjectURL(preview.url); setPreview({ file, url }); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The file could not be opened."); }
    finally { setBusy(""); }
  }

  async function deleteFile(file: MemberFile) {
    if (!filesMember || !window.confirm(`Delete ${file.title}? This cannot be undone.`)) return;
    setBusy(`delete:${file.id}`); setError("");
    try {
      const response = await fetch(`/api/trade-team/member-files?memberId=${encodeURIComponent(filesMember.id)}&fileId=${encodeURIComponent(file.id)}`, { method: "DELETE", headers: await tokenHeaders() });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "The file could not be deleted.");
      if (preview?.file.id === file.id) { URL.revokeObjectURL(preview.url); setPreview(null); }
      setFiles((current) => current.filter((item) => item.id !== file.id));
      await load(); setMessage("Member file deleted.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The file could not be deleted."); }
    finally { setBusy(""); }
  }

  function closeFiles() {
    if (busy) return;
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null); setFilesMember(null); setFiles([]);
    window.requestAnimationFrame(() => restoreFocusRef.current?.focus());
  }

  if (loading) return <p className={styles.status} role="status">Loading team members...</p>;
  if (teamAccess && !teamAccess.canManageTeam) {
    return <p className={styles.error} role="alert">You do not have permission to manage this business team.</p>;
  }

  const isOwner = teamAccess?.isOwner !== false;
  const canEditPermissions = isOwner || Boolean(teamAccess?.permissions.canEditTeamPermissions);
  const actorPermissions = normalizePermissions(teamAccess?.permissions);
  const isCurrentMember = (member: TradeTeamMember) => member.id === teamAccess?.memberId
    || Boolean(member.email && member.email.trim().toLowerCase() === (user.email || "").trim().toLowerCase());
  const statusName = (member: TradeTeamMember) => member.status === "active"
    ? member.hasLogin ? "Login active" : member.invitePending ? "Invitation pending" : "Roster only"
    : "Former or inactive";
  const editingOwnAccess = editing !== null && editing !== "new" && isCurrentMember(editing);
  const showAccessEditor = Boolean(editing && canEditPermissions && !editingOwnAccess);

  return <div className={styles.workspace}>
    <div className={styles.heading}><div><h4>Your team</h4><p>Keep each person&apos;s contact details, access, availability and documents in one place.</p></div><button type="button" className={styles.primary} onClick={openNew}>Add team member</button></div>
    {message && <p className={styles.status} role="status">{message}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {inviteUrl && <section className={styles.invitePanel} aria-label="Private team login link"><div><strong>Private login link</strong><p>Send this link only to the person it was created for. It expires after 7 days.</p></div><input aria-label="Private login link" value={inviteUrl} readOnly onFocus={(event) => event.currentTarget.select()} /><button type="button" className={styles.secondary} onClick={() => void copyInvite()}>Copy login link</button></section>}
    <section className={styles.list} aria-label="Team members"><header className={styles.listHeader}><strong>People</strong><span>{roster.total} team members</span></header>
      <form className={styles.filters} onSubmit={searchMembers}><label>Search<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, phone, email or service" /></label><label>Status<select value={statusFilter} onChange={(event) => { setPage(1); setStatusFilter(event.target.value as RosterStatus); }}><option value="all">All statuses</option><option value="active">Active</option><option value="invited">Invited</option><option value="suspended">Former or inactive</option></select></label><label>Service<select value={capabilityFilter} onChange={(event) => { setPage(1); setCapabilityFilter(event.target.value); }}><option value="">All services</option>{ENERGY_SERVICE_CATALOGUE.map((service) => <option key={service.id} value={service.id}>{service.label}</option>)}</select></label><button className={styles.secondary}>Search</button></form>
      <p className={styles.hint}>Deactivating access stops future sign-in and assignment. Job history and member documents remain saved. Reactivation restores login eligibility, but revoked devices and old invitation links remain inactive.</p>
      {visibleMembers.length ? <>
        <div className={styles.tableShell}>
          <table className={styles.memberTable}>
            <caption className={styles.srOnly}>Team member contact details, status and schedule colour</caption>
            <thead><tr><th>First name</th><th>Last name</th><th>Phone</th><th>Email</th><th>Status</th><th>Colour</th><th>Actions</th></tr></thead>
            <tbody>{visibleMembers.map((member) => <tr key={member.id} tabIndex={0} onContextMenu={(event) => { if (!member.isOwner || isOwner) showMenu(event, member); }}>
              <td><strong>{member.firstName || "Not added"}{member.isOwner ? <small>Owner</small> : null}</strong></td>
              <td><strong>{member.lastName || "Not added"}</strong></td>
              <td>{member.phone ? <a href={`tel:${member.phone}`}>{member.phone}</a> : <span>Not added</span>}</td>
              <td>{member.email ? <a href={`mailto:${member.email}`}>{member.email}</a> : <span>Not added</span>}</td>
              <td><span className={`${styles.state} ${member.status === "active" ? styles.current : styles.expired}`}>{statusName(member)}</span></td>
              <td><span className={styles.colourName}><i className={`${styles.colourDot} ${styles[member.scheduleColour || "emerald"]}`} />{scheduleColours.find((colour) => colour.id === member.scheduleColour)?.label || "Emerald"}</span></td>
              <td>{(!member.isOwner || isOwner) && <button type="button" className={styles.memberMenuButton} aria-label={`Open actions for ${memberLabel(member)}`} onClick={(event) => showMenu(event, member)}>Open</button>}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className={styles.mobileCards}>{visibleMembers.map((member) => <article className={styles.memberCard} key={member.id} tabIndex={0} onContextMenu={(event) => { if (!member.isOwner || isOwner) showMenu(event, member); }}>
        <header className={styles.memberHeader}><div><strong>{member.isOwner ? `${memberLabel(member)} (owner)` : memberLabel(member)}</strong><span>{[member.phone, member.email].filter(Boolean).join(" | ") || "Contact details not added"}</span><small>{statusName(member)}</small></div>{(!member.isOwner || isOwner) && <button type="button" className={styles.memberMenuButton} aria-label={`Open actions for ${memberLabel(member)}`} onClick={(event) => showMenu(event, member)}>Open</button>}</header>
        <div className={styles.chips}><span><i className={`${styles.colourDot} ${styles[member.scheduleColour || "emerald"]}`} />{scheduleColours.find((colour) => colour.id === member.scheduleColour)?.label || "Emerald"}</span><span>{member.permissions.jobScope === "own" ? "Assigned jobs only" : "All team jobs"}</span><span>{member.fileCount || 0} documents</span>{member.capabilities?.length ? <span>{member.capabilities.length} services</span> : null}</div>
        <small>Last active: {member.lastActiveAt ? new Date(member.lastActiveAt).toLocaleString("en-AU") : "Not signed in yet"}</small>
        {(!member.isOwner || isOwner) && <div className={styles.actions}>{!member.isOwner && <button type="button" onClick={() => openEdit(member)}>{canEditPermissions && !isCurrentMember(member) ? "Edit member and access" : "Edit member"}</button>}{!member.isOwner && member.status === "active" && !member.hasLogin && <button type="button" disabled={busy === `invite:${member.id}`} onClick={() => void createLogin(member)}>{member.email ? member.invitePending ? "Refresh login link" : "Create login link" : "Add email for login"}</button>}{!member.isOwner && !isCurrentMember(member) && member.status === "active" && <button type="button" className={styles.danger} disabled={busy === `status:${member.id}`} onClick={() => void updateMemberStatus(member, "suspended")}>Deactivate access</button>}{!member.isOwner && !isCurrentMember(member) && member.status === "suspended" && <button type="button" className={styles.secondary} disabled={busy === `status:${member.id}`} onClick={() => void updateMemberStatus(member, "active")}>Reactivate access</button>}<button type="button" onClick={() => void openFiles(member)}>Documents</button></div>}
      </article>)}</div></> : <p className={styles.empty}>No team members match these filters.</p>}
      {roster.totalPages > 1 && <nav className={styles.pagination} aria-label="Team member pages"><button type="button" className={styles.secondary} disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button><span>Page {roster.page} of {roster.totalPages}</span><button type="button" className={styles.secondary} disabled={page >= roster.totalPages || loading} onClick={() => setPage((current) => current + 1)}>Next</button></nav>}
    </section>

    {menu && <><button aria-label="Close team member menu" style={{ background: "transparent", border: 0, inset: 0, padding: 0, position: "fixed", zIndex: 1299 }} onClick={closeMenu} /><div ref={menuRef} className={styles.contextMenu} role="menu" style={{ left: menu.x, top: menu.y }} onKeyDown={handleMenuKey}>{!menu.member.isOwner && <button type="button" role="menuitem" onClick={() => openEdit(menu.member)}>{canEditPermissions && !isCurrentMember(menu.member) ? "Edit member and access" : "Edit member"}</button>}{!menu.member.isOwner && menu.member.status === "active" && !menu.member.hasLogin && <button type="button" role="menuitem" disabled={busy === `invite:${menu.member.id}`} onClick={() => { const member = menu.member; setMenu(null); void createLogin(member); }}>{menu.member.email ? menu.member.invitePending ? "Refresh login link" : "Create login link" : "Add email for login"}</button>}{!menu.member.isOwner && !isCurrentMember(menu.member) && menu.member.status === "active" && <button type="button" role="menuitem" disabled={busy === `status:${menu.member.id}`} onClick={() => void updateMemberStatus(menu.member, "suspended")}>Deactivate access</button>}{!menu.member.isOwner && !isCurrentMember(menu.member) && menu.member.status === "suspended" && <button type="button" role="menuitem" disabled={busy === `status:${menu.member.id}`} onClick={() => void updateMemberStatus(menu.member, "active")}>Reactivate access</button>}<button type="button" role="menuitem" onClick={() => void openFiles(menu.member)}>Open documents</button></div></>}

    {editing && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) closeMemberDialog(); }}><div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="team-member-dialog-title" tabIndex={-1} onKeyDown={(event) => trapDialogKey(event, closeMemberDialog)}><header className={styles.dialogHeader}><div><span>{editing === "new" ? "Add team member" : "Edit team member"}</span><h4 id="team-member-dialog-title">Person and access</h4></div><button type="button" className={styles.iconButton} aria-label="Close" disabled={Boolean(busy)} onClick={closeMemberDialog}>X</button></header>
      <form className={styles.form} onSubmit={saveMember}><div className={`${styles.grid} ${styles.contactGrid}`}><label>First name<input name="firstName" autoComplete="given-name" required maxLength={60} defaultValue={editing === "new" ? "" : editing.firstName} /></label><label>Last name<input name="lastName" autoComplete="family-name" required maxLength={60} defaultValue={editing === "new" ? "" : editing.lastName} /></label><label>Email, optional<input name="email" type="email" autoComplete="email" maxLength={180} defaultValue={editing === "new" ? "" : editing.email} /><small className={styles.hint}>Add an email only when this person needs their own login.</small></label><label>Phone, optional<input name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={30} pattern="[+0-9() .-]*" defaultValue={editing === "new" ? "" : editing.phone} onInput={(event) => { event.currentTarget.value = filterPhoneInput(event.currentTarget.value); }} /></label></div>{editing !== "new" && editing.status === "suspended" && <p className={styles.status}>This person is inactive. Their job history and documents remain saved. Reactivation does not restore revoked devices or old invitation links.</p>}
        <fieldset className={styles.colourPicker}><legend>Schedule colour</legend><p className={styles.hint}>This colour identifies the team member throughout the schedule.</p><div>{scheduleColours.map((colour) => <label key={colour.id} className={`${styles.colourChoice} ${styles[colour.id]}`}><input type="radio" name="scheduleColour" value={colour.id} defaultChecked={(editing === "new" ? "emerald" : editing.scheduleColour || "emerald") === colour.id} /><span aria-hidden="true" /><strong>{colour.label}</strong></label>)}</div></fieldset>
        <fieldset className={styles.permissionGroup}><legend>Services</legend><p className={styles.hint}>Choose the work this person performs. This does not change the services your business offers.</p><div className={styles.grid}>{ENERGY_SERVICE_CATALOGUE.map((service) => <label className={styles.check} key={service.id}><input type="checkbox" checked={memberServices.includes(service.id)} onChange={(event) => setMemberServices((current) => event.target.checked ? [...new Set([...current, service.id])] : current.filter((id) => id !== service.id))} /><span>{service.label}</span></label>)}</div></fieldset>
        {showAccessEditor ? <>
          <label>Quick access preset<select value={formPreset} onChange={(event) => applyPreset(event.target.value as AccessPreset)}><option value="custom" disabled>Custom access</option>{accessPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select><small className={styles.hint}>{editing === "new" ? accessPresets.find((item) => item.id === formPreset)?.description : "This person&apos;s saved switches are shown below."} Applying a preset only fills the switches below. You can then change any permission for this person.</small></label>
          <fieldset className={styles.permissionGroup}><legend>Work visibility</legend><div className={styles.grid}><label>Jobs<select value={formPermissions.jobScope} onChange={(event) => setPermission("jobScope", event.target.value as Scope)}><option value="own">Assigned jobs only</option><option value="team" disabled={!isOwner && actorPermissions.jobScope !== "team"}>All team jobs</option></select><small className={styles.hint}>Own scope means this person cannot view, edit, assign or reassign another person&apos;s work.</small></label><label>Schedule<select value={formPermissions.scheduleScope} onChange={(event) => setPermission("scheduleScope", event.target.value as Scope)}><option value="own">Own schedule only</option><option value="team" disabled={!isOwner && actorPermissions.scheduleScope !== "team"}>Whole team schedule</option></select><small className={styles.hint}>Own scope means this person cannot view, schedule or reschedule another person&apos;s work.</small></label></div></fieldset>
          {permissionGroups.map((group) => <fieldset className={styles.permissionGroup} key={group.label}><legend>{group.label}</legend>{group.items.map((item) => <label className={styles.check} key={item.key}><input type="checkbox" disabled={!isOwner && !actorPermissions[item.key]} checked={Boolean(formPermissions[item.key])} onChange={(event) => setPermission(item.key, event.target.checked)} /><span>{item.label}<small>{!isOwner && !actorPermissions[item.key] ? "You cannot grant access you do not have." : item.detail}</small></span></label>)}</fieldset>)}
        </> : <p className={styles.status}>{editingOwnAccess ? "You cannot edit your own access permissions." : "You can update this person&apos;s contact details and status. Only the owner or a delegated access manager can change permissions."}</p>}
        <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy === "member"}>{busy === "member" ? "Saving..." : "Save team member"}</button><button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={closeMemberDialog}>Cancel</button></div>
      </form></div></div>}

    <section className={styles.devices} aria-label="Field devices"><header className={styles.listHeader}><div><strong>Field devices</strong><p className={styles.hint}>Find and revoke any lost or replaced phone or tablet. Authorising again lets its active user register securely.</p></div><span>{deviceRoster.total} devices | {pendingPushEvents} alerts queued</span></header>
      <form className={styles.filters} onSubmit={(event) => { event.preventDefault(); setDevicePage(1); setAppliedDeviceQuery(deviceQuery.trim()); }}><label>Find a device<input type="search" value={deviceQuery} onChange={(event) => setDeviceQuery(event.target.value)} placeholder="Device, ID, member or email" /></label><label>Status<select value={deviceStatus} onChange={(event) => { setDeviceStatus(event.target.value as "" | "active" | "revoked"); setDevicePage(1); }}><option value="">All device states</option><option value="active">Active</option><option value="revoked">Revoked</option></select></label><label>Team member<select value={deviceMemberId} onChange={(event) => { setDeviceMemberId(event.target.value); setDevicePage(1); }}><option value="">Everyone</option>{members.map((member) => <option value={member.id} key={member.id}>{memberLabel(member)}</option>)}</select></label><button type="submit" className={styles.secondary} disabled={devicesLoading}>{devicesLoading ? "Searching..." : "Search"}</button></form>
      {devices.length ? <div className={styles.deviceList}>{devices.map((device) => <article key={device.id} className={styles.deviceRow}><div><strong>{device.deviceName}</strong><span>{[device.memberName, device.memberEmail].filter(Boolean).join(" | ")}</span><small>{device.platform === "ios" ? "iPhone or iPad" : "Android"} | App {device.appVersion || "unknown"} | Push {device.pushConnected ? "ready" : "not connected"} | {device.lastSeenAt ? `Last used ${new Date(device.lastSeenAt).toLocaleString("en-AU")}` : "Not used yet"}</small></div><span className={`${styles.state} ${device.status === "active" ? styles.current : styles.expired}`}>{device.status}</span>{device.status === "active" ? <button type="button" className={styles.danger} disabled={busy === `device:${device.id}`} onClick={() => void updateDevice(device, "revoke_device")}>{busy === `device:${device.id}` ? "Saving..." : "Revoke access"}</button> : device.memberStatus === "suspended" ? <small>Reactivate this team member before authorising a device.</small> : <button type="button" className={styles.secondary} disabled={busy === `device:${device.id}`} onClick={() => void updateDevice(device, "authorise_device")}>{busy === `device:${device.id}` ? "Saving..." : "Authorise again"}</button>}</article>)}</div> : <p className={styles.empty}>{devicesLoading ? "Loading field devices..." : "No field devices match these filters."}</p>}
      {deviceRoster.totalPages > 1 && <nav className={styles.pagination} aria-label="Field device pages"><button type="button" className={styles.secondary} disabled={devicePage <= 1 || devicesLoading} onClick={() => setDevicePage((current) => Math.max(1, current - 1))}>Previous</button><span>Page {deviceRoster.page} of {deviceRoster.totalPages}</span><button type="button" className={styles.secondary} disabled={devicePage >= deviceRoster.totalPages || devicesLoading} onClick={() => setDevicePage((current) => current + 1)}>Next</button></nav>}
    </section>

    {filesMember && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) closeFiles(); }}><div ref={filesDialogRef} className={styles.filesDialog} role="dialog" aria-modal="true" aria-labelledby="member-files-title" tabIndex={-1} onKeyDown={(event) => trapDialogKey(event, closeFiles)}><header className={styles.dialogHeader}><div><span>Private member documents</span><h4 id="member-files-title">{memberLabel(filesMember)}</h4></div><button type="button" className={styles.iconButton} aria-label="Close member documents" disabled={Boolean(busy)} onClick={closeFiles}>X</button></header>
      <div className={styles.filesBody}><aside className={styles.filesSidebar}>
        <form className={styles.uploadForm} onSubmit={uploadFile}><strong>Upload a document or photo</strong><label>Title<input name="title" required maxLength={180} placeholder="For example, grade licence or insurance" /></label><label>Expiry, optional<input type="date" name="expiresAt" /></label><label>Document or photo<input name="file" type="file" required accept="image/jpeg,image/png,application/pdf" /></label><small className={styles.hint}>PDF, JPEG or PNG. Maximum 12 MB. The owner is notified 30 days before a saved expiry.</small><button className={styles.primary} disabled={busy === "file-upload"}>{busy === "file-upload" ? "Uploading..." : "Upload document"}</button></form>
        {filesLoading ? <p className={styles.status}>Loading documents...</p> : <div className={styles.fileList}>{files.map((file) => <article key={file.id} className={`${styles.fileRow} ${preview?.file.id === file.id ? styles.selected : ""}`}><div><strong>{file.title}</strong><small>{bytesLabel(file.sizeBytes)} | {file.expiresAt ? `Expires ${new Date(`${file.expiresAt}T00:00:00`).toLocaleDateString("en-AU")}` : "No expiry"}</small></div><div className={styles.fileRowActions}><button type="button" disabled={busy === `file:${file.id}`} onClick={() => void fetchFile(file)}>View</button><button type="button" aria-label={`Download ${file.title}`} disabled={busy === `file:${file.id}`} onClick={() => void fetchFile(file, true)}>Download</button><button type="button" aria-label={`Delete ${file.title}`} disabled={busy === `delete:${file.id}`} onClick={() => void deleteFile(file)}>Delete</button></div></article>)}{!files.length && <p className={styles.empty}>No documents or photos saved.</p>}</div>}
      </aside><section className={styles.preview} aria-label="Member document preview">{preview ? preview.file.contentType.startsWith("image/") ? <img src={preview.url} alt={preview.file.title} /> : preview.file.contentType === "application/pdf" ? <iframe src={preview.url} title={preview.file.title} /> : <p className={styles.previewMessage}>This document cannot be previewed here. Use download to open it.</p> : <p className={styles.previewMessage}>Select View to open the image or PDF. Documents remain private to authorised business access.</p>}</section></div>
    </div></div>}
  </div>;
}
