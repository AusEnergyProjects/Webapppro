import Link from "next/link";
import type { SiteActive } from "@/components/ComparatorChrome";

type NavigationLink = readonly [href: string, label: string];

type NavigationCategory = {
  label: string;
  activeFor: readonly SiteActive[];
  links: readonly NavigationLink[];
};

const DESKTOP_SHORTCUTS = [
  { href: "/compare", label: "Electricity compare", active: "electricity" },
  { href: "/gas-compare", label: "Gas compare", active: "gas" },
  { href: "/calculator", label: "Rebate calculator", active: "calculator" },
] as const;

const NAVIGATION_CATEGORIES: readonly NavigationCategory[] = [
  {
    label: "Assessments",
    activeFor: ["assessments", "direct-trade-request"],
    links: [
      ["/assessments", "Assessment types"],
      ["/home-energy-rating-for-existing-homes", "Existing home ratings"],
      ["/nathers-for-new-homes", "NatHERS for new homes"],
      ["/nathers-whole-of-home", "NatHERS Whole of Home"],
      ["/basix-nsw", "BASIX support"],
      ["/minimum-rental-standards", "Rental standards"],
      ["/commercial-and-industrial-assessments", "Business assessments"],
      ["/blower-door-thermal-imaging", "Blower door & thermal imaging"],
      ["/book-an-assessment", "Book a quick call"],
    ],
  },
  {
    label: "Plan & upgrades",
    activeFor: ["plan"],
    links: [
      ["/plan", "My home energy plan"],
      ["/guides/home-energy-upgrades", "Upgrade guide"],
      ["/direct-trade", "Find matching trades"],
      ["/guides/project-preparation", "Prepare your project"],
    ],
  },
  {
    label: "Bills & rebates",
    activeFor: ["calculator", "electricity", "gas", "certificates", "rebates", "wholesale"],
    links: [
      ["/compare", "Compare electricity"],
      ["/gas-compare", "Compare gas"],
      ["/calculator", "Rebate calculator"],
      ["/wholesale-electricity", "Live wholesale prices"],
      ["/rebates", "Rebates and assistance"],
      ["/guides/certificate-prices", "Certificate prices"],
    ],
  },
  {
    label: "Learn & support",
    activeFor: ["guides", "case-studies", "direct-trade-partners", "direct-trade-access", "direct-trade-standards", "direct-trade-verification"],
    links: [
      ["/guides", "Guides"],
      ["/faq", "Frequently asked questions"],
      ["/trusted-suppliers", "Trusted resources"],
      ["/case-studies", "Case studies"],
      ["/communities-schools", "Community education"],
      ["/team", "Our team"],
      ["/privacy", "Privacy"],
    ],
  },
] as const;

export function ResponsiveSiteNav({ active }: { active: SiteActive }) {
  return (
    <div className="site-nav-shell">
      <nav aria-label="Primary navigation" className="comparator-nav">
        <Link
          className={`site-nav-home${active === "start" ? " active" : ""}`}
          href="/"
          aria-current={active === "start" ? "page" : undefined}
        >
          Home
        </Link>

        <div className="site-nav-desktop-categories">
          {DESKTOP_SHORTCUTS.map((shortcut) => (
            <Link key={shortcut.href} href={shortcut.href} className={`site-nav-shortcut${active === shortcut.active ? " active" : ""}`} aria-current={active === shortcut.active ? "page" : undefined}>{shortcut.label}</Link>
          ))}
          {NAVIGATION_CATEGORIES.map((category) => {
            const isActive = category.activeFor.includes(active);

            return (
              <details className={`site-nav-category${isActive ? " active-category" : ""}`} key={category.label} name="site-navigation-categories">
                <summary
                  aria-current={isActive ? "true" : undefined}
                  className="site-nav-category-trigger"
                >
                  <span>{category.label}</span>
                  <span className="site-nav-chevron" aria-hidden="true">&#9662;</span>
                </summary>
                <div className="site-nav-panel">
                  {category.links.map(([href, label]) => (
                    <Link href={href} key={href}>
                      <strong>{label}</strong>
                    </Link>
                  ))}
                </div>
              </details>
            );
          })}
        </div>

        <details className="site-nav-mobile-disclosure">
          <summary className="site-nav-mobile-trigger">
            Browse pages
            <span className="site-nav-chevron" aria-hidden="true">&#9662;</span>
          </summary>
          <div aria-label="Browse pages" className="site-nav-mobile-panel">
            <div className="site-nav-mobile-heading"><strong>Choose a page</strong></div>
            <div className="site-nav-mobile-groups">
              {NAVIGATION_CATEGORIES.map((category) => (
                <section key={category.label}>
                  <h2>{category.label}</h2>
                  <div>
                    {category.links.map(([href, label]) => (
                      <Link href={href} key={href}>{label}</Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </details>
      </nav>
    </div>
  );
}
