import { SiteFooter, SiteHeader } from "./ComparatorChrome";
import { PublicPlanEnquiryForm } from "./PublicPlanEnquiryForm";

export function DirectTradeProjectBrief() {
  return <main id="site-content" className="wrap direct-trade-request-page">
    <SiteHeader active="direct-trade-request" />
    <header className="guide-section-heading"><h1>Get help with your home upgrades</h1><p>Tell us what you need. No customer account is required. Review who can receive your details before sending.</p></header>
    <PublicPlanEnquiryForm planHref="/plan" suggestedInterests={[]} planSnapshot={{ goals: [], pace: "", situation: "", approvalContext: "", budgetRange: "", addressState: "", features: [] }} />
    <p><a href="/direct-trade/standards">Read the marketplace standards</a></p>
    <SiteFooter>Prefer to plan first? <a href="/plan">Build your home energy plan</a>. Quotes, products, eligibility and installation scope need to be confirmed for your property.</SiteFooter>
  </main>;
}
