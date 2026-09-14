import Link from "next/link";

export function ServicesHeaderLink({ active }: { active: boolean }) {
  return <Link href="/services" className="site-call-link" aria-current={active ? "page" : undefined}><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="m12 2 8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5l8-3Z" stroke="currentColor" strokeWidth="1.6"/><path d="m8 12 2.7 2.7 5.3-5.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg><strong>Services</strong></Link>;
}
