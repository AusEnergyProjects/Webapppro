import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";

export const metadata: Metadata = {
  title: "Full service energy and trade platform | Australian Energy Assessments",
  description: "See how the free household account, installer CRM, wholesaler catalogue and protected administration layer work together.",
};

const workspaces = [
  {
    role: "Households",
    access: "Always free",
    title: "Plan, compare and manage every home upgrade",
    items: ["Multiple private home projects", "Guided upgrade roadmap", "Electricity and gas comparison", "Anonymised installer scopes", "Structured quote comparison", "Asset, warranty and safety records", "No direct sales contact data"],
  },
  {
    role: "Installers",
    access: "Free profile, paid operating access",
    title: "Run the business and complete the work",
    items: ["Verification and service coverage", "Protected opportunity responses", "Customers owned by the business", "Jobs, schedule, tasks and templates", "Field time, evidence and sign-off", "Quotes, invoices and payments", "Xero, MYOB, Stripe and Square pathways", "Reviewed customer handovers"],
  },
  {
    role: "Wholesalers",
    access: "Free profile, paid marketplace access",
    title: "Publish products and support fulfilment",
    items: ["Draft product catalogue", "Bulk CSV maintenance", "Trade pricing and stock status", "Install-ready product bundles", "Installer product enquiries", "Order and fulfilment workflow", "Warranty and product identity records", "No household leads or contact data"],
  },
  {
    role: "Platform operations",
    access: "Role restricted",
    title: "Protect quality across the ecosystem",
    items: ["Approval and notification inbox", "Filtered account directory", "Verification and evidence review", "Opportunity allocation controls", "Product and handover approval", "Feature-specific premium grants", "Asset safety and ownership governance", "Audited support access"],
  },
];

const accessRows = [
  ["Create a household account and unlimited projects", "Included", "Not applicable", "Not applicable"],
  ["Create a business profile and prepare verification", "Not applicable", "Included", "Included"],
  ["Receive household opportunities", "Customer controls submission", "Paid installers only", "Never"],
  ["Appear in installer product selection", "Not applicable", "Browse when paid", "Paid wholesalers only"],
  ["Installer CRM and field app", "Private project view", "Paid or admin granted", "Not applicable"],
  ["Bulk catalogue and fulfilment tools", "Not applicable", "Product selection", "Paid or admin granted"],
  ["Team access and advanced analytics", "Not applicable", "Admin assigned premium", "Admin assigned premium"],
];

export default function PlatformPage() {
  return <main className="wrap platform-page">
    <SiteHeader active="direct-trade-membership" />
    <header className="platform-hero"><div><span>One protected ecosystem</span><h1>A full service platform without selling household contact data</h1><p>Households plan and compare for free. Installers run jobs and respond to protected opportunities. Wholesalers publish fixed-price products. Platform operations keep approvals, quality and safety visible.</p><div><a className="btn" href="/account">Open a free household account</a><a className="btn ghost" href="/direct-trade/partners">Create a business profile</a></div></div><aside><strong>Four connected workspaces</strong><ol><li>Household planning</li><li>Installer operations</li><li>Wholesaler supply</li><li>Platform governance</li></ol><p>Each role sees only the information needed for its work.</p></aside></header>

    <section className="platform-workspaces" aria-labelledby="platform-workspaces-title"><div className="guide-section-heading"><span>Complete role coverage</span><h2 id="platform-workspaces-title">Useful alone, stronger together</h2><p>The platform does not force a household into a sales journey or require a trade business to abandon its own direct customers.</p></div><div>{workspaces.map((workspace) => <article key={workspace.role}><span>{workspace.access}</span><small>{workspace.role}</small><h3>{workspace.title}</h3><ul>{workspace.items.map((item) => <li key={item}>{item}</li>)}</ul></article>)}</div></section>

    <section className="platform-access" aria-labelledby="platform-access-title"><div className="guide-section-heading"><span>Clear paywall boundaries</span><h2 id="platform-access-title">Free accounts remain useful and paid access funds operating tools</h2><p>No free installer receives leads. No wholesaler receives household leads under any plan. Unpaid wholesaler products stay invisible in installer selection.</p></div><div className="platform-table-wrap"><table><thead><tr><th>Capability</th><th>Household</th><th>Installer</th><th>Wholesaler</th></tr></thead><tbody>{accessRows.map((row) => <tr key={row[0]}>{row.map((cell, index) => index === 0 ? <th scope="row" key={`${row[0]}-${index}`}>{cell}</th> : <td key={`${row[0]}-${index}`}>{cell}</td>)}</tr>)}</tbody></table></div><a className="platform-pricing-link" href="/direct-trade/membership">See live membership pricing and terms</a></section>

    <section className="platform-difference"><div><span>Designed around trust</span><h2>What the connected model adds</h2></div><div><article><strong>One durable home record</strong><p>Quotes, installed products, warranties, service events and safety notices remain available in the free customer account.</p></article><article><strong>One daily trade workspace</strong><p>Jobs, reusable templates, field records, finance progress, payments and handovers stay attached to the system job ID.</p></article><article><strong>One product truth</strong><p>Approved catalogue items preserve supplier, price, stock, compatibility, warranty and product identity context.</p></article><article><strong>One privacy boundary</strong><p>Protected platform jobs never expose a household name, phone, email or street address to trade or wholesale accounts.</p></article></div></section>
    <SiteFooter>Platform access does not replace licensing, accreditation, insurance, product approval, site assessment or each participant&apos;s legal obligations.</SiteFooter>
  </main>;
}
