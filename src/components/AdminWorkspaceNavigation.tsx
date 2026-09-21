"use client";

export type AdminWorkspaceTab = "inbox" | "overview" | "directory" | "jobs" | "customers" | "partners" | "assistant-leads" | "assistant-reviews" | "opportunities" | "catalogue" | "enquiries" | "handovers" | "asset-safety" | "asset-governance" | "form-governance" | "compliance-questions" | "field-pilot" | "database" | "access";
type Role = "owner" | "admin" | "reviewer" | "support";
type Item = { id: AdminWorkspaceTab; label: string; ownerOnly?: boolean; excludeSupport?: boolean };
const groups: Array<{ label: string; secondary?: boolean; items: Item[] }> = [
  { label: "Work", items: [
    { id: "inbox", label: "Inbox" }, { id: "overview", label: "Overview" },
    { id: "jobs", label: "Jobs" }, { id: "customers", label: "Customers" },
    { id: "partners", label: "Trades & suppliers" }, { id: "opportunities", label: "Leads" },
  ] },
  { label: "Forms & training", items: [
    { id: "compliance-questions", label: "Training", excludeSupport: true },
    { id: "form-governance", label: "Activity forms" },
  ] },
  { label: "Catalogue", items: [{ id: "catalogue", label: "Products" }, { id: "enquiries", label: "Product enquiries" }] },
  { label: "Reviews & assets", secondary: true, items: [
    { id: "handovers", label: "Handovers" }, { id: "asset-safety", label: "Asset safety" },
    { id: "asset-governance", label: "Asset rules" },
  ] },
  { label: "Administration", secondary: true, items: [
    { id: "directory", label: "All accounts" }, { id: "assistant-leads", label: "Guide follow-ups" },
    { id: "assistant-reviews", label: "AI answer reviews", excludeSupport: true },
    { id: "field-pilot", label: "Field testing" },
    { id: "database", label: "Database", ownerOnly: true }, { id: "access", label: "Access & audit", ownerOnly: true },
  ] },
];

function visibleGroups(role: Role) {
  return groups.map((group) => ({ ...group, items: group.items.filter((item) =>
    (!item.ownerOnly || role === "owner") && (!item.excludeSupport || role !== "support")) }));
}

export function adminWorkspaceHash(tab: AdminWorkspaceTab) {
  return tab === "inbox" ? "#operations-inbox" : `#${tab}`;
}

export function adminWorkspaceTabFromHash(hash: string, role: Role): AdminWorkspaceTab | null {
  const id = !hash || hash === "#operations-inbox" ? "inbox" : hash.replace(/^#/, "");
  return visibleGroups(role).flatMap((group) => group.items).find((item) => item.id === id)?.id || null;
}

const iconPaths: Record<AdminWorkspaceTab, string> = {
  inbox: "M4 4h16v16H4z M4 13h5l2 3h2l2-3h5",
  overview: "M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z",
  jobs: "M8 7V4h8v3 M3 7h18v13H3z M3 12h18 M10 12v3h4v-3",
  customers: "M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M5 21v-3a7 7 0 0 1 14 0v3",
  partners: "M3 21V9l6-4v16 M9 11l6-4 6 4v10 M1 21h22 M13 15h4 M13 18h4 M5 11h1 M5 15h1",
  opportunities: "M12 3a7 7 0 0 0-4 13v3h8v-3a7 7 0 0 0-4-13 M9 22h6 M12 7v5 M10 10l2 2 2-2",
  "compliance-questions": "m2 9 10-5 10 5-10 5z M6 11v6c4 3 8 3 12 0v-6 M22 9v8",
  "form-governance": "M14 3H5v18h14V8z M14 3v5h5 M8 12h8 M8 16h8",
  catalogue: "m12 3 9 5v9l-9 5-9-5V8z M3 8l9 5 9-5 M12 13v9 M8 5l9 5",
  enquiries: "M4 4h16v13H9l-5 4z M8 8h8 M8 12h5",
  handovers: "M5 3h14v18H5z M9 3v3h6V3 M8 13l3 3 5-6",
  "asset-safety": "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6",
  "asset-governance": "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6",
  directory: "M5 3h14v18H5z M8 7h8 M8 11h3 M8 15h8 M8 18h5",
  "assistant-leads": "M4 5h16v13H9l-5 3z M8 9h8 M8 13h5",
  "assistant-reviews": "M3 4h18v14H9l-6 3z M8 11l3 3 5-6",
  "field-pilot": "M9 3h6 M10 3v7l-6 9v2h16v-2l-6-9V3 M7 16h10",
  database: "M3 6c0-4 18-4 18 0s-18 4-18 0 M3 6v12c0 4 18 4 18 0V6 M3 12c0 4 18 4 18 0",
  access: "M5 10h14v11H5z M8 10V7a4 4 0 0 1 8 0v3 M12 14v3",
};

function WorkspaceIcon({ tab }: { tab: AdminWorkspaceTab }) {
  return <svg className="admin-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={iconPaths[tab]} /></svg>;
}

export function AdminWorkspaceNavigation({ selected, role, unread, onSelect }: {
  selected: AdminWorkspaceTab; role: Role; unread: number; onSelect: (tab: AdminWorkspaceTab) => boolean;
}) {
  const available = visibleGroups(role);
  function items(entries: Item[]) {
    return entries.map((item) => <button key={item.id} type="button" className={selected === item.id ? "admin-nav-item active" : "admin-nav-item"}
      aria-current={selected === item.id ? "page" : undefined} onClick={() => onSelect(item.id)}>
      <WorkspaceIcon tab={item.id} /><span>{item.label}</span>{item.id === "inbox" && unread > 0 && <strong className="admin-nav-count" aria-label={`${unread} unread alerts`}>{unread}</strong>}
    </button>);
  }
  return <nav className="admin-sidebar" aria-label="Operations sections">
    <div className="admin-rail-heading"><strong>Administration</strong><span>Manage your network</span></div>
    <label className="admin-mobile-section"><span>Workspace</span><select aria-label="Choose operations workspace" value={selected} onChange={(event) => {
      const option = available.flatMap((group) => group.items).find((item) => item.id === event.target.value);
      if (option && !onSelect(option.id)) event.currentTarget.value = selected;
    }}>{available.map((group) => <optgroup key={group.label} label={group.label}>{group.items.map((item) =>
      <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select></label>
    <div className="admin-nav-groups">{available.map((group) => group.secondary
      ? <details key={`${group.label}-${group.items.some((item) => item.id === selected)}`} open={group.items.some((item) => item.id === selected)}>
        <summary>{group.label}</summary><div>{items(group.items)}</div></details>
      : <section key={group.label} aria-label={group.label}><h2>{group.label}</h2>{items(group.items)}</section>)}</div>
    <a className="admin-creditex-link" href="/creditex/compliance">Open Creditex workspace <span aria-hidden="true">↗</span></a>
  </nav>;
}
