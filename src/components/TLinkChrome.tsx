import Image from "next/image";

type TLinkSection = "dashboard" | "partners" | "membership" | "standards" | "verification" | "team";

export function TLinkBrand({ context = "Trade ecosystem" }: { context?: string }) {
  return <span className="tlink-brand">
    <Image className="tlink-brand-mark" src="/tlink-icon-192.png" width={48} height={48} alt="" aria-hidden="true" priority />
    <span><strong>TLink</strong><small>{context}</small></span>
  </span>;
}

export function TLinkHeader({ active }: { active: TLinkSection }) {
  return <header className="tlink-site-header">
    <a className="tlink-home-link" href="/direct-trade/dashboard" aria-label="TLink trade ecosystem dashboard">
      <TLinkBrand />
    </a>
    <nav aria-label="TLink navigation">
      <a className={active === "dashboard" ? "active" : ""} href="/direct-trade/dashboard">Dashboard</a>
      <a className={active === "partners" ? "active" : ""} href="/direct-trade/partners">Trade account</a>
      <a className={active === "membership" ? "active" : ""} href="/direct-trade/membership">Membership</a>
      <a className={active === "standards" ? "active" : ""} href="/direct-trade/standards">Standards</a>
    </nav>
    <a className="tlink-aea-link" href="/">AEA home</a>
  </header>;
}
