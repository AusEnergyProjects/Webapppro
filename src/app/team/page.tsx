import Image from "next/image";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { PUBLIC_SITE, buildApexMetadata } from "@/lib/public-site";

const path = "/team";
const canonical = `${PUBLIC_SITE.apexUrl}${path}`;
const title = "Meet the Australian Energy Assessments Team";
const description = "Meet the people behind Australian Energy Assessments, from customer and operations support to the assessors who complete the technical work.";

export const metadata = buildApexMetadata({ path, title, description });

const team = [
  { name: "Gary Morris", role: "Managing Director", group: "Leadership and operations", image: "/team/gary-morris.jpg" },
  { name: "Kris Chen", role: "General Manager", group: "Leadership and operations", image: "/team/kris-chen.jpg" },
  { name: "James William", role: "Founder", group: "Leadership and operations", image: "/team/james-william.jpg" },
  { name: "Katja Rosic", role: "Human Resources and Talent Manager", group: "Leadership and operations", image: "/team/katja-rosic.jpg" },
  { name: "Joshua Lewis", role: "Business Development Manager", group: "Leadership and operations", image: "/team/joshua-lewis.jpg" },
  { name: "Sarah Mosseveld", role: "Marketing and Communications Manager", group: "Leadership and operations", image: "/team/sarah-mosseveld.jpg" },
  { name: "Thomas Curtis", role: "Accredited Assessor", group: "Assessment team", image: "/team/thomas-curtis.jpg" },
  { name: "Max Charters", role: "Accredited Assessor", group: "Assessment team", image: "/team/max-charters.jpg" },
  { name: "Jabez Tang", role: "Accredited Assessor", group: "Assessment team", image: "/team/jabez-tang.jpg" },
  { name: "Olen Dymke", role: "Accredited Assessor", group: "Assessment team", image: "/team/olen-dymke.png" },
  { name: "Dan Markov", role: "Accredited Assessor", group: "Assessment team", image: "/team/dan-markov.png" },
  { name: "Malcolm Guy", role: "Accredited Assessor", group: "Assessment team", image: "/team/malcolm-guy.jpg" },
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
      image: `${PUBLIC_SITE.platformUrl}${person.image}`,
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
  return <section className="guide-section" aria-labelledby={`team-${group === "Assessment team" ? "assessors" : "operations"}`}>
    <div className="guide-section-heading">
      <span>{group}</span>
      <h2 id={`team-${group === "Assessment team" ? "assessors" : "operations"}`}>{group === "Assessment team" ? "The people who complete the technical work" : "The people who keep the work moving"}</h2>
    </div>
    <div className="guide-principle-grid">
      {people.map((person) => <article key={person.name}>
        <Image src={person.image} alt={`Portrait of ${person.name}, ${person.role} at Australian Energy Assessments`} width={640} height={640} sizes="(max-width: 720px) 100vw, 33vw" style={{ aspectRatio: "1", borderRadius: "12px", height: "auto", objectFit: "cover", width: "100%" }} />
        <strong>{person.name}</strong><p>{person.role}</p>
      </article>)}
    </div>
  </section>;
}

export default function TeamPage() {
  return <main className="wrap guide-page">
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
