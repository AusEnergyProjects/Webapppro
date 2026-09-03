import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { JsonLd } from "@/components/JsonLd";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { PUBLIC_SITE, buildApexMetadata } from "@/lib/public-site";
import { TeamPageStyles } from "./TeamPageStyles";

const path = "/team";
const canonical = `${PUBLIC_SITE.apexUrl}${path}`;
const title = "Meet the Australian Energy Assessments Team";
const description = "Meet the people behind Australian Energy Assessments, from customer and operations support to the assessors who complete the technical work.";

export const metadata = buildApexMetadata({ path, title, description });

const team = [
  { name: "Gary Morris", role: "Managing Director", group: "Leadership and operations", image: "/team/gary-morris.jpg", position: "50% 38%", scale: "1.04" },
  { name: "Kris Chen", role: "General Manager", group: "Leadership and operations", image: "/team/kris-chen.jpg", position: "50% 35%", scale: ".98" },
  { name: "James William", role: "Founder", group: "Leadership and operations", image: "/team/james-william.jpg", position: "50% 34%", scale: ".86" },
  { name: "Katja Rosic", role: "Human Resources and Talent Manager", group: "Leadership and operations", image: "/team/katja-rosic.jpg", position: "50% 38%", scale: ".96" },
  { name: "Joshua Lewis", role: "Business Development Manager", group: "Leadership and operations", image: "/team/joshua-lewis.jpg", position: "56% 38%", scale: "1.08" },
  { name: "Sarah Mosseveld", role: "Marketing and Communications Manager", group: "Leadership and operations", image: "/team/sarah-mosseveld.jpg", position: "51% 35%", scale: "1.12" },
  { name: "Thomas Curtis", role: "Accredited Assessor", group: "Assessment team", image: "/team/thomas-curtis.jpg", position: "52% 38%", scale: "1" },
  { name: "Max Charters", role: "Accredited Assessor", group: "Assessment team", image: "/team/max-charters.jpg", position: "50% 37%", scale: ".88" },
  { name: "Jabez Tang", role: "Accredited Assessor", group: "Assessment team", image: "/team/jabez-tang.jpg", position: "50% 72%", scale: "1.16" },
  { name: "Olen Dymke", role: "Accredited Assessor", group: "Assessment team", image: "/team/olen-dymke.png", position: "50% 38%", scale: ".98" },
  { name: "Dan Markov", role: "Accredited Assessor", group: "Assessment team", image: "/team/dan-markov.png", position: "50% 56%", scale: "1.34" },
  { name: "Malcolm Guy", role: "Accredited Assessor", group: "Assessment team", image: "/team/malcolm-guy.jpg", position: "50% 32%", scale: ".84" },
] as const;

const schema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "AboutPage",
      "@id": `${canonical}#webpage`,
      url: canonical,
      name: title,
      description,
      inLanguage: "en-AU",
      dateModified: "2026-09-02",
      isPartOf: { "@id": PUBLIC_SITE.apexWebsiteId },
      about: { "@id": PUBLIC_SITE.organizationId },
      mainEntity: { "@id": `${canonical}#team` },
      breadcrumb: { "@id": `${canonical}#breadcrumb` },
    },
    {
      "@type": "ItemList",
      "@id": `${canonical}#team`,
      name: "Australian Energy Assessments team",
      itemListElement: team.map((person, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: { "@id": `${canonical}#${person.image.split("/").at(-1)?.split(".")[0]}` },
      })),
    },
    ...team.map((person) => ({
      "@type": "Person",
      "@id": `${canonical}#${person.image.split("/").at(-1)?.split(".")[0]}`,
      name: person.name,
      jobTitle: person.role,
      image: `${PUBLIC_SITE.apexUrl}${person.image}`,
      worksFor: { "@id": PUBLIC_SITE.organizationId },
    })),
    {
      "@type": "BreadcrumbList",
      "@id": `${canonical}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${PUBLIC_SITE.apexUrl}/` },
        { "@type": "ListItem", position: 2, name: "Our team", item: canonical },
      ],
    },
  ],
};

function TeamGroup({ group }: { group: (typeof team)[number]["group"] }) {
  const people = team.filter((person) => person.group === group);
  return <section className="guide-section team-page-section" aria-labelledby={`team-${group === "Assessment team" ? "assessors" : "operations"}`}>
    <div className="guide-section-heading">
      <span>{group}</span>
      <h2 id={`team-${group === "Assessment team" ? "assessors" : "operations"}`}>{group === "Assessment team" ? "The people who complete the technical work" : "The people who keep the work moving"}</h2>
    </div>
    <div className="guide-principle-grid team-page-grid">
      {people.map((person) => <article className="team-page-card" key={person.name}>
        <div
          className="team-page-portrait"
          style={{ "--portrait-position": person.position, "--portrait-scale": person.scale } as CSSProperties}
        >
          <Image
            className="team-page-photo"
            src={person.image}
            alt={`Portrait of ${person.name}, ${person.role} at Australian Energy Assessments`}
            width={360}
            height={450}
            sizes="(max-width: 420px) 44vw, 220px"
          />
        </div>
        <strong>{person.name}</strong><p>{person.role}</p>
      </article>)}
    </div>
  </section>;
}

export default function TeamPage() {
  return <main className="wrap guide-page">
    <TeamPageStyles />
    <JsonLd data={schema} />
    <SiteHeader active="assessments" />
    <header className="guide-hero"><span>Our team</span><h1>Real people, clear explanations</h1><p>Meet the people behind Australian Energy Assessments. Our assessment team handles the technical work, while our operations and customer team keeps the process clear from your first question to the finished report.</p></header>
    <div className="assessment-asat"><strong>Team information reviewed 2 September 2026</strong><span>The exact assessor, availability and credential needed depend on the service and location. We confirm those details before work begins.</span></div>

    <TeamGroup group="Leadership and operations" />
    <TeamGroup group="Assessment team" />

    <section className="guide-note"><strong>About assessor credentials</strong><p>The published team roster identifies the assessment team as accredited assessors. Accreditation schemes, identifiers and expiry details are not added here without confirmed records. When a job requires a particular credential, the engagement should identify the person doing the work and the scheme that applies.</p></section>
    <section className="guide-callout guide-callout-primary"><div><h2>Not sure who you need?</h2><p>Book a five-minute logistics call. We will confirm the property, the assessment type and the right next step before asking you for detailed documents.</p></div><Link href="/book-an-assessment">Book now</Link></section>
    <SiteFooter>Team roles, availability and the assessor assigned to a project can change. The relevant person and required credential are confirmed for the agreed service.</SiteFooter>
  </main>;
}
