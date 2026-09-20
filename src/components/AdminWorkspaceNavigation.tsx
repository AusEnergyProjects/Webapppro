"use client";

export type AdminWorkspaceTab = "inbox" | "overview" | "directory" | "jobs" | "customers" | "partners" | "assistant-leads" | "assistant-reviews" | "opportunities" | "catalogue" | "enquiries" | "handovers" | "asset-safety" | "asset-governance" | "form-governance" | "compliance-questions" | "field-pilot" | "database" | "access";
type Role = "owner" | "admin" | "reviewer" | "support";
type Item = { id: AdminWorkspaceTab; label: string; ownerOnly?: boolean; excludeSupport?: boolean };
const groups: Array<{ label: string; secondary?: boolean; items: Item[] }> = [
  { label: "Daily work", items: [
    { id: "inbox", label: "Inbox" }, { id: "overview", label: "Overview" },
    { id: "jobs", label: "Jobs" }, { id: "customers", label: "Customers" },
    { id: "partners", label: "Trades & suppliers" }, { id: "opportunities", label: "Leads" },
  ] },
  { label: "Catalogue", items: [{ id: "catalogue", label: "Products" }, { id: "enquiries", label: "Product enquiries" }] },
  { label: "Compliance", secondary: true, items: [
    { id: "handovers", label: "Handovers" }, { id: "asset-safety", label: "Asset safety" },
    { id: "asset-governance", label: "Asset rules" }, { id: "form-governance", label: "Field forms" },
    { id: "compliance-questions", label: "Compliance questions", excludeSupport: true },
  ] },
  { label: "Administration", secondary: true, items: [
    { id: "directory", label: "All accounts" }, { id: "assistant-leads", label: "Guide follow-ups" },
    { id: "assistant-reviews", label: "AI answer reviews", excludeSupport: true },
    { id: "field-pilot", label: "Field testing" },
    { id: "database", label: "Database", ownerOnly: true }, { id: "access", label: "Access & audit", ownerOnly: true },
  ] },
];

export function AdminWorkspaceNavigation({ selected, role, unread, onSelect }: {
  selected: AdminWorkspaceTab; role: Role; unread: number; onSelect: (tab: AdminWorkspaceTab) => boolean;
}) {
  const available = groups.map((group) => ({ ...group, items: group.items.filter((item) =>
    (!item.ownerOnly || role === "owner") && (!item.excludeSupport || role !== "support")) }));
  function items(entries: Item[]) {
    return entries.map((item) => <button key={item.id} type="button" className={selected === item.id ? "active" : ""}
      aria-current={selected === item.id ? "page" : undefined} onClick={() => onSelect(item.id)}>
      {item.label}{item.id === "inbox" && unread > 0 && <strong className="admin-nav-count">{unread}</strong>}
    </button>);
  }
  return <nav className="admin-sidebar" aria-label="Operations sections">
    <label className="admin-mobile-section">Workspace<select value={selected} onChange={(event) => {
      const option = available.flatMap((group) => group.items).find((item) => item.id === event.target.value);
      if (option) onSelect(option.id);
    }}>{available.map((group) => <optgroup key={group.label} label={group.label}>{group.items.map((item) =>
      <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select></label>
    <div className="admin-nav-groups">{available.map((group) => group.secondary
      ? <details key={`${group.label}-${group.items.some((item) => item.id === selected)}`} open={group.items.some((item) => item.id === selected)}>
        <summary>{group.label}</summary><div>{items(group.items)}</div></details>
      : <section key={group.label} aria-label={group.label}><h2>{group.label}</h2>{items(group.items)}</section>)}</div>
    <a className="admin-creditex-link" href="/creditex/compliance">Open Creditex workspace <span aria-hidden="true">↗</span></a>
  </nav>;
}
