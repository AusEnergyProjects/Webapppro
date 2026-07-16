import { CertificatePriceTracker } from "@/components/CertificatePriceTracker";
import { GuideSection, GuideShell } from "@/components/GuideShell";

export const metadata = {
  title: "Australian Certificate Price Tracker | Australian Energy Assessments",
  description: "Understand STC, ESC, VEEC, PRC, LGC, ACCU and SMC certificates and explore six months of indicative reported spot prices.",
};

export default function CertificatePricesPage() {
  return <GuideShell active="certificates" label="Certificate price tracker" title="See what energy certificates are worth and what they actually mean" introduction="Certificate markets can help fund eligible upgrades, renewable generation and emissions reduction. Start with the plain-English explanation, then inspect the latest reported trade and six months of price history.">
    <GuideSection eyebrow="Start here" title="A certificate turns a verified outcome into something that can be traded"><div className="certificate-intro-grid"><article><span>1</span><h3>An eligible activity happens</h3><p>This might be an efficient NSW upgrade, Victorian Energy Upgrades activity, rooftop solar system, renewable power generation or verified emissions reduction.</p></article><article><span>2</span><h3>Certificates are created and checked</h3><p>The relevant scheme sets the rules. Accredited participants create certificates and the regulator or registry checks the evidence.</p></article><article><span>3</span><h3>Certificates can be bought and sold</h3><p>Energy retailers, liable entities, businesses or government buyers purchase certificates to meet obligations or voluntary goals.</p></article></div></GuideSection>
    <section className="certificate-spot-explainer"><div><span>What “spot price” means here</span><h2>The price of the latest reported certificate trade</h2></div><p>It is not the wholesale electricity spot price, a fixed government rebate or the amount a customer will automatically receive. A provider may deduct fees and takes responsibility for eligibility, evidence and certificate creation.</p></section>
    <CertificatePriceTracker />
  </GuideShell>;
}
