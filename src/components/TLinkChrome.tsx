import Image from "next/image";
import Link from "next/link";
import { AEA_BRANDMARK_PNG_DATA_URI } from "@/lib/aea-brand-assets.mjs";
import { TLinkChromeStyles } from "./TLinkChromeStyles";

type TLinkSection = "dashboard" | "partners" | "access" | "standards" | "verification" | "team";

export function TLinkMark({
  className = "tlink-brand-mark",
  size = 48,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <Image
      className={className}
      src="/tlink-icon-192.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      priority
    />
  );
}

export function AeaProductLink({
  placement,
}: {
  placement: "site-header" | "trade-portal";
}) {
  return (
    <Link
      className={`tlink-aea-product-link tlink-aea-product-link-${placement}`}
      href="/"
      aria-label="Return to Australian Energy Assessments"
    >
      <Image
        className="tlink-aea-product-mark"
        src={AEA_BRANDMARK_PNG_DATA_URI}
        width={36}
        height={36}
        alt=""
        aria-hidden="true"
        unoptimized
      />
      <span className="tlink-aea-product-name">Australian Energy Assessments</span>
    </Link>
  );
}

export function TLinkBrand({
  context = "Trade ecosystem",
}: {
  context?: string;
}) {
  return (
    <>
      <TLinkChromeStyles />
      <span className="tlink-brand">
        <TLinkMark />
        <span><strong>TLink</strong><small>{context}</small></span>
      </span>
    </>
  );
}

export function TLinkHeader({ active }: { active: TLinkSection }) {
  return <header className="tlink-site-header">
    <Link className="tlink-home-link" href="/direct-trade/dashboard" aria-label="TLink trade ecosystem dashboard">
      <TLinkBrand />
    </Link>
    <nav aria-label="TLink navigation">
      <Link className={active === "dashboard" ? "active" : ""} href="/direct-trade/dashboard">Dashboard</Link>
      <Link className={active === "partners" ? "active" : ""} href="/direct-trade/partners">Trade account</Link>
      <Link className={active === "access" ? "active" : ""} href="/direct-trade/access">Free access</Link>
      <Link className={active === "standards" ? "active" : ""} href="/direct-trade/standards">Standards</Link>
    </nav>
    <AeaProductLink placement="site-header" />
  </header>;
}
