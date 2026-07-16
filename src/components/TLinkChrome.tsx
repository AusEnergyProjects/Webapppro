import Image from "next/image";
import Link from "next/link";

type TLinkSection = "dashboard" | "partners" | "membership" | "standards" | "verification" | "team";

export function TLinkBrand({ context = "Trade ecosystem" }: { context?: string }) {
  return <span className="tlink-brand">
    <Image className="tlink-brand-mark" src="/tlink-icon-192.png" width={48} height={48} alt="" aria-hidden="true" priority />
    <span><strong>TLink</strong><small>{context}</small></span>
  </span>;
}

export function TLinkHeader({ active }: { active: TLinkSection }) {
  return <header className="tlink-site-header">
    <Link className="tlink-home-link" href="/direct-trade/dashboard" aria-label="TLink trade ecosystem dashboard">
      <TLinkBrand />
    </Link>
    <nav aria-label="TLink navigation">
      <Link className={active === "dashboard" ? "active" : ""} href="/direct-trade/dashboard">Dashboard</Link>
      <Link className={active === "partners" ? "active" : ""} href="/direct-trade/partners">Trade account</Link>
      <Link className={active === "membership" ? "active" : ""} href="/direct-trade/membership">Membership</Link>
      <Link className={active === "standards" ? "active" : ""} href="/direct-trade/standards">Standards</Link>
    </nav>
    <Link className="tlink-aea-link" href="/">AEA home</Link>
  </header>;
}
