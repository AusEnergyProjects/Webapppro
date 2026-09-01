import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { buildPlatformMetadata } from "@/lib/public-site";

export const metadata = buildPlatformMetadata({
  path: "/platform",
  title: "Full service energy and trade platform | Australian Energy Assessments",
  description: "See how no-account household planning, the installer CRM, wholesaler catalogue and protected administration layer work together.",
});

const workspaces = [
  {
    role: "Households",
    access: "Always free",
    title: "Plan, compare and manage every home upgrade",
    items: ["Guided no-account home plan", "Electricity and gas comparison", "Customer-controlled trade enquiries", "Multi-service matching", "Personalised plan PDF", "Clear rebate pathways", "No sale of household leads"],
  },
  {
    role: "Installers",
    access: "Free after verification",
    title: "Run the business and complete the work",
    items: ["Verification and service coverage", "Protected opportunity responses", "Customers owned by the business", "Jobs, schedule, tasks and templates", "Field time, evidence and sign-off", "Quotes, invoices and accounting status", "Xero, MYOB and QuickBooks draft exports", "Reviewed customer handovers"],
  },
  {
    role: "Wholesalers",
    access: "Free after verification",
    title: "Publish products and support fulfilment",
    items: ["Draft product catalogue", "Bulk CSV maintenance", "Trade pricing and stock status", "Install-ready product bundles", "Installer product enquiries", "Order and fulfilment workflow", "Warranty and product identity records", "No household leads or contact data"],
  },
  {
    role: "Platform operations",
    access: "Role restricted",
    title: "Protect quality across the ecosystem",
    items: ["Approval and notification inbox", "Filtered account directory", "Verification and evidence review", "Opportunity allocation controls", "Product and handover approval", "Role and access controls", "Asset safety and ownership governance", "Audited support access"],
  },
];

const accessRows = [
  ["Build a home plan and contact matching trades", "No account required", "Not applicable", "Not applicable"],
  ["Create a business profile and prepare verification", "Not applicable", "Included", "Included"],
  ["Receive household opportunities", "Customer controls submission", "Verified installers", "Never"],
  ["Appear in installer product selection", "Not applicable", "Browse when verified", "Verified wholesalers"],
  ["Installer CRM and field app", "Private project view", "Included after verification", "Not applicable"],
  ["Bulk catalogue and fulfilment tools", "Not applicable", "Product selection", "Included after verification"],
  ["Team access and reporting", "Not applicable", "Included after verification", "Included after verification"],
];

export default function PlatformPage() {
  return <main className="wrap platform-page">
    <SiteHeader active="direct-trade-access" />
    <header className="platform-hero"><div><span>One protected ecosystem</span><h1>A full service platform without selling household contact data</h1><p>Households plan, compare and contact matching trades without creating an account. Installers run jobs and respond to consented opportunities. Wholesalers publish fixed-price products. Platform operations keep approvals, quality and safety visible.</p><div><a className="btn" href="/plan">Build my home energy plan</a><a className="btn ghost" href="/direct-trade/partners">Create a business profile</a></div></div><aside><strong>Four connected workspaces</strong><ol><li>Household planning</li><li>Installer operations</li><li>Wholesaler supply</li><li>Platform governance</li></ol><p>Each role sees only the information needed for its work.</p></aside></header>

    <section className="platform-workspaces" aria-labelledby="platform-workspaces-title"><div className="guide-section-heading"><span>Complete role coverage</span><h2 id="platform-workspaces-title">Useful alone, stronger together</h2><p>The platform does not force a household into a sales journey or require a trade business to abandon its own direct customers.</p></div><div>{workspaces.map((workspace) => <article key={workspace.role}><span>{workspace.access}</span><small>{workspace.role}</small><h3>{workspace.title}</h3><ul>{workspace.items.map((item) => <li key={item}>{item}</li>)}</ul></article>)}</div></section>

    <section className="platform-access" aria-labelledby="platform-access-title"><div className="guide-section-heading"><span>Clear verification boundaries</span><h2 id="platform-access-title">Core trade operations cost A$0 after verification</h2><p>Verified installers receive leads and operating tools. Verified wholesaler products can appear in installer selection. Wholesalers never receive household opportunities.</p></div><div className="platform-table-wrap"><table><thead><tr><th>Capability</th><th>Household</th><th>Installer</th><th>Wholesaler</th></tr></thead><tbody>{accessRows.map((row) => <tr key={row[0]}>{row.map((cell, index) => index === 0 ? <th scope="row" key={`${row[0]}-${index}`}>{cell}</th> : <td key={`${row[0]}-${index}`}>{cell}</td>)}</tr>)}</tbody></table></div><a className="platform-access-link" href="/direct-trade/access">See free verified trade access</a></section>

    <section className="platform-difference"><div><span>Designed around trust</span><h2>What the connected model adds</h2></div><div><article><strong>One useful household journey</strong><p>The guided plan, comparisons, rebate tools, personalised PDF and trade enquiry work without creating an account.</p></article><article><strong>One daily trade workspace</strong><p>Jobs, reusable templates, field records, invoice progress, accounting status and handovers stay attached to the system job ID. The trade workspace does not initiate payments.</p></article><article><strong>One product truth</strong><p>Approved catalogue items preserve supplier, price, stock, compatibility, warranty and product identity context.</p></article><article><strong>One explicit privacy boundary</strong><p>Trades receive only the fields named in the household&apos;s consent. The full home plan and PDF remain private.</p></article></div></section>
    <SiteFooter>Platform access does not replace licensing, accreditation, insurance, product approval, site assessment or each participant&apos;s legal obligations.</SiteFooter>
  </main>;
}
