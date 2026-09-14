import Link from "next/link";
import { JsonLd } from "./JsonLd";
import { SiteFooter, SiteHeader } from "./ComparatorChrome";
import { AeaServiceEnquiryButton } from "./AeaServiceEnquiryButton";
import { AEA_SERVICES, AEA_BUNDLES, AEA_BUNDLE_FAQS, AEA_SERVICE_REVIEW_DATE, getAeaService, audPrice, gstInclusiveCents } from "@/lib/aea-services.mjs";
import { AEA_SERVICE_GUIDES } from "@/lib/aea-service-guides.mjs";
import { PUBLIC_SITE } from "@/lib/public-site";
import { AeaServicesStyles } from "./AeaServicesStyles";

type AeaService = (typeof AEA_SERVICES)[number];

function ServiceIcon({ kind = "shield" }: { kind?: string }) {
  return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === "flame" ? <path d="M12 2c1 5-4 6-4 10 0 1 1 2 2 2-1-3 3-4 3-7 5 4 6 7 5 10a6.5 6.5 0 0 1-12-1C4 11 8 7 12 2Z" /> : kind === "bolt" ? <path d="m13 2-9 12h7l-1 8 10-13h-8l1-7Z" /> : kind === "home" ? <><path d="m3 10 9-8 9 8M5 9v12h14V9" /><path d="M9 21v-8h6v8" /></> : <><path d="m12 2 8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5l8-3Z" /><path d="m8 12 2.7 2.7 5.3-5.4" /></>}</svg>;
}

function ReportPreview() {
  return <aside className="aea-services-reportPreview" aria-label="What your property records contain"><div className="aea-services-reportTop"><ServicesMark /><span>AUSTRALIAN ENERGY<br />ASSESSMENTS</span></div><span className="aea-services-eyebrow">Your property. Clearly documented.</span><h2>From the first check <br />to the next step.</h2><div className="aea-services-reportRows">{[["01", "The work completed", "One record of the services performed at your visit."], ["02", "Findings you can understand", "Results, evidence and anything needing attention."], ["03", "A clear way forward", "Actions, limitations and relevant next check dates."]].map(([number, title, detail]) => <div key={number}><span>{number}</span><div><strong>{title}</strong><p>{detail}</p></div></div>)}</div><div className="aea-services-reportFormats"><span>Email</span><span>Shareable link</span><span>Downloadable PDF</span></div></aside>;
}

function DeliveryBenefits() {
  return <section className="aea-services-delivery" aria-label="Your report and service experience">{[["01", "Same-day email", "Completed reports and applicable certificates emailed the day they are finalised."], ["02", "Shareable record", "A secure link for the intended landlord, rental agent or customer."], ["03", "PDF to keep", "Download your completed record for your property files and future reference."]].map(([number, title, detail]) => <div key={title}><span className="aea-services-stepNumber">{number}</span><h3>{title}</h3><p>{detail}</p></div>)}<p className="aea-services-deliveryNote">Safety checks produce service reports. NatHERS certificates follow completed modelling and required inputs. The standard onsite energy assessment provides written advice without a certificate.</p></section>;
}

function ServiceJourney({ service }: { service: AeaService }) {
  const guide = Object.entries(AEA_SERVICE_GUIDES).find(([id]) => id === service.id)?.[1];
  if (!guide) return null;
  return <><section className="aea-services-journey" aria-labelledby={`process-${service.id}`}><span className="aea-services-eyebrow">What happens at your assessment</span><h2 id={`process-${service.id}`}>{guide.title}</h2><p className="aea-services-sectionIntro">{guide.introduction}</p><ol className="aea-services-steps">{guide.steps.map(([title, description], index) => <li key={title}><span className="aea-services-stepNumber">{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><p>{description}</p></li>)}</ol></section><section className="aea-services-details"><div><span className="aea-services-eyebrow">A little preparation helps</span><h2>Get ready for your appointment</h2><ul className="aea-services-checks">{guide.preparation.map((item) => <li key={item}>{item}</li>)}</ul></div><aside className="aea-services-scope"><h3>{guide.outcomeTitle}</h3><p>{guide.outcome}</p><a href={PUBLIC_SITE.phoneHref}>Speak with AEA: {PUBLIC_SITE.phoneDisplay}</a></aside></section></>;
}

function RelatedServices({ service }: { service: AeaService }) {
  const guide = Object.entries(AEA_SERVICE_GUIDES).find(([id]) => id === service.id)?.[1];
  const related = AEA_SERVICES.filter((item) => guide ? guide.related.includes(item.id) : item.id !== service.id && item.category === service.category).slice(0, 3);
  return <section className="aea-services-related" aria-label="Related services"><div className="aea-services-sectionTitle"><h2>Complete your property picture</h2><Link href="/services">Compare all services →</Link></div><div>{related.map((item) => <Link key={item.id} href={item.path}><ServiceIcon kind={item.icon} /><strong>{item.name}</strong><span>{audPrice(gstInclusiveCents(item.priceExGstCents))} including GST →</span></Link>)}</div></section>;
}

function ServiceFaqs({ faqs, id, title = "Frequently asked questions" }: { faqs: readonly (readonly string[])[]; id: string; title?: string }) {
  return <section className="aea-services-faq" aria-labelledby={id}><span className="aea-services-eyebrow">The detail behind the service</span><h2 id={id}>{title}</h2><p className="aea-services-sectionIntro">Clear answers about scope, appointments, records and next steps.</p>{faqs.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</section>;
}

export function ServicesMark({ className }: { className?: string }) {
  return <span className={className} aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="m12 2 8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5l8-3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="m8 12 2.7 2.7 5.3-5.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg></span>;
}

export function ServicePrice({ cents, annual = false }: { cents: number; annual?: boolean }) {
  return <div className="aea-services-prices">
    <div><strong>{audPrice(cents)}</strong><span>+ GST{annual ? " / year equivalent" : ""}</span></div>
    <div><strong>{audPrice(gstInclusiveCents(cents))}</strong><span>including GST{annual ? " / year equivalent" : ""}</span></div>
  </div>;
}

export function serviceSchema(service: AeaService) {
  const url = `${PUBLIC_SITE.apexUrl}${service.path}`;
  return { "@context": "https://schema.org", "@graph": [
    { "@type": "WebPage", "@id": `${url}#webpage`, url, name: service.title, description: service.summary, inLanguage: "en-AU", dateModified: AEA_SERVICE_REVIEW_DATE, isPartOf: { "@id": PUBLIC_SITE.apexWebsiteId }, publisher: { "@id": PUBLIC_SITE.organizationId }, mainEntity: { "@id": `${url}#service` }, about: { "@id": `${url}#service` }, breadcrumb: { "@id": `${url}#breadcrumb` } },
    { "@type": "Service", "@id": `${url}#service`, name: service.name, serviceType: service.name, description: service.summary, url, mainEntityOfPage: { "@id": `${url}#webpage` },
      provider: { "@id": PUBLIC_SITE.organizationId }, areaServed: service.area,
      offers: { "@type": "Offer", "@id": `${url}#offer`, price: (gstInclusiveCents(service.priceExGstCents) / 100).toFixed(2), priceCurrency: "AUD", url,
        priceSpecification: { "@type": "UnitPriceSpecification", price: (gstInclusiveCents(service.priceExGstCents) / 100).toFixed(2), priceCurrency: "AUD", valueAddedTaxIncluded: true }, seller: { "@id": PUBLIC_SITE.organizationId } } },
    { "@type": "BreadcrumbList", "@id": `${url}#breadcrumb`, itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: `${PUBLIC_SITE.apexUrl}/` }, { "@type": "ListItem", position: 2, name: "Services", item: `${PUBLIC_SITE.apexUrl}/services` }, { "@type": "ListItem", position: 3, name: service.name, item: url }] },
    { "@type": "FAQPage", "@id": `${url}#service-faq`, mainEntity: service.faqs.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) },
  ] };
}

export function AeaServiceDetails({ service, showFaq = true }: { service: AeaService; showFaq?: boolean }) {
  return <>
    <section className="aea-services-details" id={`included-${service.id}`} aria-label={`${service.name} inclusions`}>
      <div><span className="aea-services-eyebrow">What is included</span><h2>A clear scope. A useful report.</h2><ul className="aea-services-checks">{service.inclusions.map((item) => <li key={item}>{item}</li>)}</ul></div>
      <aside className="aea-services-scope"><h3>Before your appointment</h3><p>{service.scope}</p><p>Australian Energy Assessments manages your enquiry and delivery. We confirm property access, service availability and the appropriate practitioner before arranging the work.</p><Link href="/book-an-assessment">Book a five-minute planning call</Link></aside>
    </section>
    <ServiceJourney service={service} />
    <DeliveryBenefits />
    <section className="aea-services-legal"><span className="aea-services-eyebrow">Requirements and records</span><h2>Know what the check covers</h2><p>{service.legal}</p><p>Only work actually completed is recorded as complete. Defects and access limitations remain visible in the report.</p><div className="aea-services-sources">{service.sources.map((source) => <a href={source.url} key={source.url} target="_blank" rel="noopener noreferrer">{source.label} ↗</a>)}</div><small>Guidance reviewed {AEA_SERVICE_REVIEW_DATE}. The current regulator guidance and the requirements applicable to your property take precedence.</small></section>
    {showFaq ? <ServiceFaqs faqs={service.faqs} id={`faq-${service.id}`} /> : null}
  </>;
}

export function AeaServicePricePanel({ serviceId }: { serviceId: string }) {
  const service = getAeaService(serviceId);
  if (!service) return null;
  return <section className="aea-services-inlineOffer" aria-label={`${service.name} price`}><AeaServicesStyles />
    <div><span className="aea-services-eyebrow">Delivered by Australian Energy Assessments</span><h2>{service.name}</h2><p>{service.summary}</p><ServicePrice cents={service.priceExGstCents} /><span className="aea-services-cadence">{service.cadence} · {service.area}</span></div>
    <div className="aea-services-inlineActions"><AeaServiceEnquiryButton serviceId={service.id} className="aea-services-primary" /><Link className="aea-services-secondary" href="/services">All services and prices</Link></div>
    <div className="aea-services-inlineDetails"><AeaServiceDetails service={service} showFaq={false} /></div>
  </section>;
}

export function AeaServiceLandingPage({ serviceId }: { serviceId: string }) {
  const service = getAeaService(serviceId);
  if (!service) throw new Error("UNKNOWN_AEA_SERVICE");
  return <main className="wrap"><AeaServicesStyles /><SiteHeader active="services" /><div className="aea-services-page"><JsonLd data={serviceSchema(service)} /><nav className="aea-services-breadcrumb" aria-label="Breadcrumb"><Link href="/services">Services</Link><span>/</span><span>{service.name}</span></nav>
    <header className="aea-services-hero"><div><span className="aea-services-eyebrow">{service.area} · {service.category}</span><h1>{service.title}</h1><p>{service.summary}</p><div className="aea-services-heroActions"><AeaServiceEnquiryButton serviceId={service.id} className="aea-services-primary" /><a className="aea-services-secondary" href={`#included-${service.id}`}>Explore what is included ↓</a></div></div><div className="aea-services-heroPrice"><span className="aea-services-mark"><ServiceIcon kind={service.icon} /></span><span className="aea-services-eyebrow">Your assessment price</span><ServicePrice cents={service.priceExGstCents} /><span className="aea-services-cadence">{service.cadence}</span><ul className="aea-services-checks">{service.inclusions.slice(-3).map((item) => <li key={item}>{item}</li>)}</ul></div></header>
    <AeaServiceDetails service={service} />{service.category === "Rental safety" ? <aside className="aea-services-banner"><div><span className="aea-services-eyebrow">Two years, clearly covered</span><h2>Combine your rental safety visits</h2><p>Annual smoke and blind checks, with the licensed safety checks your property needs.</p></div><Link href="/offers" className="aea-services-primary">See two-year offers</Link></aside> : null}
    <RelatedServices service={service} />
  </div><SiteFooter>Australian Energy Assessments. Clear services, prices and records.</SiteFooter></main>;
}

export function AeaServicesPage() {
  return <main className="wrap"><AeaServicesStyles /><SiteHeader active="services" /><div className="aea-services-page"><JsonLd data={{ "@context": "https://schema.org", "@type": "OfferCatalog", "@id": `${PUBLIC_SITE.apexUrl}/services#catalogue`, name: "Australian Energy Assessments services", url: `${PUBLIC_SITE.apexUrl}/services`, itemListElement: AEA_SERVICES.map((service) => ({ "@type": "Offer", "@id": `${PUBLIC_SITE.apexUrl}${service.path}#offer`, price: (gstInclusiveCents(service.priceExGstCents) / 100).toFixed(2), priceCurrency: "AUD", url: `${PUBLIC_SITE.apexUrl}${service.path}`, itemOffered: { "@type": "Service", "@id": `${PUBLIC_SITE.apexUrl}${service.path}#service`, name: service.name, provider: { "@id": PUBLIC_SITE.organizationId } } })) }} />
    <header className="aea-services-introGrid"><div className="aea-services-intro"><ServicesMark className="aea-services-mark" /><span className="aea-services-eyebrow">Australian Energy Assessments</span><h1>Our services.<br /><span>Clear prices.<br />Expert checks.</span></h1><p>Rental safety, accredited energy ratings and practical onsite advice. Know what is included, understand the findings and keep the records your property needs.</p><div className="aea-services-heroActions"><a href="#rental-safety" className="aea-services-primary">Explore services ↓</a><Link href="/offers" className="aea-services-secondary">Two-year bundle offers</Link></div></div><ReportPreview /></header>
    <nav className="aea-services-jumpLinks" aria-label="Find your service"><a href="#rental-safety">Rental safety</a><a href="#energy-assessments">Energy assessments</a><a href="#choose-service">Help me choose</a><Link href="/offers">Two-year offers →</Link></nav>
    {["Rental safety", "Energy assessments"].map((category) => <section key={category} id={category === "Rental safety" ? "rental-safety" : "energy-assessments"} aria-label={category}><div className="aea-services-sectionTitle"><div><span className="aea-services-eyebrow">{category === "Rental safety" ? "Check. Record. Stay on top of what is due." : "Understand your home. Plan your next move."}</span><h2>{category}</h2></div><span>{category === "Rental safety" ? "Victorian properties" : "New and existing homes"}</span></div><div className="aea-services-grid">{AEA_SERVICES.filter((service) => service.category === category).map((service) => <article className="aea-services-tile" key={service.id}><div className="aea-services-tileHeader"><span className="aea-services-tileIcon"><ServiceIcon kind={service.icon} /></span><span className="aea-services-eyebrow">{service.cadence}</span></div><h3>{service.name}</h3><ServicePrice cents={service.priceExGstCents} /><p>{service.summary}</p><span className="aea-services-includedLabel">Included in your service</span><ul className="aea-services-checks">{service.inclusions.map((item) => <li key={item}>{item}</li>)}</ul><div className="aea-services-tileActions"><Link className="aea-services-secondary" href={service.path}>Explore the service + FAQs →</Link><AeaServiceEnquiryButton serviceId={service.id} className="aea-services-primary">Enquire now</AeaServiceEnquiryButton></div></article>)}</div></section>)}
    <DeliveryBenefits />
    <section className="aea-services-journey" id="choose-service"><span className="aea-services-eyebrow">Start with what you need to know</span><h2>Which service is right for your property?</h2><div className="aea-services-choiceGrid"><article><h3>I manage a rental property</h3><p>Smoke, electrical and gas checks have their own scope and due dates. A minimum standards assessment reviews the broader property requirements. Combining services helps coordinate the visits and records; one check does not replace another.</p><Link href="/offers">Compare rental safety bundles →</Link></article><article><h3>I need a formal energy rating</h3><p>New-home NatHERS work uses plans and specifications for the applicable design assessment. Home Energy Rating for an existing home uses its own accredited assessment pathway. Select the service that matches the property and purpose.</p><Link href="/nathers-for-new-homes">New homes →</Link><Link href="/home-energy-rating-for-existing-homes">Existing homes →</Link></article><article><h3>I want practical energy advice</h3><p>An onsite energy assessment helps you understand comfort issues and upgrade priorities. You receive written advice without a formal rating certificate. Onsite energy visits are available mainly in NSW and Victoria, with address availability confirmed before booking.</p><Link href="/services/onsite-energy-assessment">Explore the advice visit →</Link></article></div></section>
    <aside className="aea-services-banner"><div><h2>One enquiry. The right next step.</h2><p>Tell us your service and property location. We will confirm availability and arrange the appropriate assessment or check.</p></div><Link className="aea-services-primary" href="/book-an-assessment">Book a quick call</Link></aside>
  </div><SiteFooter>All prices in Australian dollars. Service scope and access are confirmed before booking.</SiteFooter></main>;
}

export function AeaOffersPage() {
  return <main className="wrap"><AeaServicesStyles /><SiteHeader active="services" /><div className="aea-services-page"><JsonLd data={{ "@context": "https://schema.org", "@type": "OfferCatalog", name: "Australian Energy Assessments two-year rental safety bundles", url: `${PUBLIC_SITE.apexUrl}/offers`, itemListElement: AEA_BUNDLES.map((bundle) => ({ "@type": "Offer", name: `${bundle.name}: two-year package`, price: (gstInclusiveCents(bundle.priceExGstCents) / 100).toFixed(2), priceCurrency: "AUD", url: `${PUBLIC_SITE.apexUrl}/offers#${bundle.id}`, description: bundle.inclusions.join(". "), priceSpecification: { "@type": "PriceSpecification", price: (gstInclusiveCents(bundle.priceExGstCents) / 100).toFixed(2), priceCurrency: "AUD", valueAddedTaxIncluded: true }, itemOffered: { "@type": "Service", name: bundle.name, provider: { "@id": PUBLIC_SITE.organizationId }, areaServed: "Victoria" } })) }} />
    <JsonLd data={{ "@context": "https://schema.org", "@type": "FAQPage", "@id": `${PUBLIC_SITE.apexUrl}/offers#faq`, mainEntity: AEA_BUNDLE_FAQS.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) }} />
    <header className="aea-services-introGrid"><div className="aea-services-intro"><ServicesMark className="aea-services-mark" /><span className="aea-services-eyebrow">Victorian rental safety · Two-year bundles</span><h1>Two years of checks.<br /><span>One clear package.</span></h1><p>Annual smoke and blind safety checks, combined with your property&apos;s electrical and gas safety requirements. Standard smoke alarm replacements, batteries, cord anchors, labels and between-visit fault callouts are included.</p><a href="#bundle-options" className="aea-services-primary">Choose your bundle ↓</a></div><ReportPreview /></header>
    <div className="aea-services-bundleGrid" id="bundle-options">{AEA_BUNDLES.map((bundle) => <article className="aea-services-tile aea-services-bundle" key={bundle.id} id={bundle.id}><div className="aea-services-tileHeader"><span className="aea-services-tileIcon"><ServiceIcon kind={bundle.gas ? "flame" : "bolt"} /></span><span className="aea-services-eyebrow">{bundle.gas ? "For properties with gas" : "For all-electric properties"}</span></div><h2>{bundle.name}</h2><div className="aea-services-prices"><div><strong>{audPrice(bundle.priceExGstCents / 2)}</strong><span>+ GST / year equivalent</span><span>{audPrice(gstInclusiveCents(bundle.priceExGstCents / 2))} including GST / year equivalent</span></div><div><strong>{audPrice(gstInclusiveCents(bundle.priceExGstCents))}</strong><span>Full two-year total including GST</span><span>{audPrice(bundle.priceExGstCents)} + GST for two years</span></div></div><p className="aea-services-equivalent">Annual equivalent is the two-year package total divided by two. It is a price comparison, not a statement of payment frequency.</p><span className="aea-services-includedLabel">Your complete two-year package</span><ul className="aea-services-checks">{bundle.inclusions.map((item) => <li key={item}>{item}</li>)}</ul><AeaServiceEnquiryButton serviceId={bundle.id} className="aea-services-primary">Enquire about this bundle</AeaServiceEnquiryButton></article>)}</div>
    <section className="aea-services-details"><div><span className="aea-services-eyebrow">Simple visits. Connected records.</span><h2>A combined report for each visit</h2><p>An electrician can complete electrical, smoke and blind checks together. A qualified gasfitter can complete gas, smoke and blind checks together. You receive the completed visit findings in one report and sharing link.</p><p>We arrange the order around existing check dates. If both licensed checks are due, both must be arranged when due. The package does not postpone an overdue safety check.</p><div className="aea-services-visitTimeline"><div><strong>Each year</strong><span>Smoke alarm + blind safety</span></div><div><strong>Across two years</strong><span>One electrical check, plus one gas check in the gas bundle</span></div><div><strong>After each completed visit</strong><span>One combined report of the work performed</span></div></div></div><aside className="aea-services-scope"><h3>Exactly what the two years cover</h3><p>Two smoke and blind visits, one electrical check and, in the gas bundle, one gas check. Additional gas appliances do not increase the gas price.</p><p>Batteries, standard replacement smoke alarms, cord anchors and labels, and between-visit smoke and blind fault callouts are included. Other repairs, replacement parts and remedial work are separately explained and authorised.</p><p>Future visits remain due until performed. We confirm access, appointment availability and payment arrangements before booking.</p><Link href="/services">Compare individual services</Link></aside></section>
    <DeliveryBenefits /><ServiceFaqs faqs={AEA_BUNDLE_FAQS} id="bundle-faq" title="Your bundle questions, answered" />
    <aside className="aea-services-banner"><div><h2>Bring your existing check dates. We will help with the rest.</h2><p>Talk through your property, service history and the appropriate bundle with AEA.</p></div><Link className="aea-services-primary" href="/book-an-assessment">Book a quick call</Link></aside>
  </div><SiteFooter>Two-year package prices are fixed in Australian dollars. Annual equivalents and total GST-inclusive prices are shown together.</SiteFooter></main>;
}
