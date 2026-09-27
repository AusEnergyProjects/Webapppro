"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { dollarsToCents, normaliseTradeQuoteLineGroup, overallTradeQuoteDiscountKind, OVERALL_PERCENT_DISCOUNT_SECTION, tradeQuoteChoiceValidationIssue, tradeQuoteLineValidationIssues } from "@/lib/trade-quote";
import { tradeQuoteDocumentDisplayTotals } from "@/lib/trade-quote-document-totals.mjs";
import { mapQuoteKind, MAP_QUOTE_UNITS } from "@/lib/trade-map-quote";
import type { QuoteBusiness, QuoteChoice, QuoteJob, QuoteLine, QuoteRoofImage } from "./TradeQuotePanel";
import styles from "./TradeQuoteLivePreview.module.css";

const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
const clean = (value: unknown) => String(value || "").trim().slice(0, 500);

export function liveQuoteDocument(lines: QuoteLine[], choices: QuoteChoice[]) {
  const issue = tradeQuoteChoiceValidationIssue(choices, clean)
    || tradeQuoteLineValidationIssues(lines, clean, choices.length > 0)[0]
    || choices.flatMap((choice) => tradeQuoteLineValidationIssues(choice.lines, clean, false, choice.name || "Choice"))[0];
  if (issue) return { complete: false as const, message: issue.message };
  try {
    const base = normaliseTradeQuoteLineGroup(lines, clean, choices.length > 0);
    const options = choices.map((choice) => ({ ...choice, totals: normaliseTradeQuoteLineGroup(choice.lines, clean) }));
    const totals = tradeQuoteDocumentDisplayTotals({ ...base, choices: options.map((choice) => ({
      id: choice.clientKey, kind: choice.kind, groupKey: choice.groupKey, recommended: choice.recommended, ...choice.totals,
    })) });
    const selectedLines = [...base.lines, ...options.filter((choice) => totals.selectedChoiceIds.includes(choice.clientKey)).flatMap((choice) => choice.totals.lines)];
    const discounts = selectedLines.reduce((sum, line) => sum + Math.min(0, line.subtotalCents), 0);
    return { complete: true as const, base, options, totals, discounts };
  } catch {
    return { complete: false as const, message: "Complete the quote items to calculate the document total." };
  }
}

type Props = {
  user: User;
  workOrderId: string;
  lines: QuoteLine[];
  choices: QuoteChoice[];
  business: QuoteBusiness | null;
  job: QuoteJob | null;
  identity: { quoteNumber: string; versionNumber: number } | null;
  customerMessage: string;
  terms: string;
  validUntil: string;
  validationMessage: string;
  roofImage?: QuoteRoofImage | null;
  review?: boolean;
};

export function TradeQuoteLivePreview({ user, workOrderId, lines, choices, business, job, identity, customerMessage, terms, validUntil, validationMessage, roofImage, review = false }: Props) {
  const [logo, setLogo] = useState<{ ownerContext: string; url: string } | null>(null);
  const [roofAsset, setRoofAsset] = useState<{ key: string; url: string; error: string } | null>(null);
  const ownerContext = `${user.uid}:${workOrderId}`;
  const roofVersion = roofImage && "versionId" in roofImage ? roofImage.versionId : "";
  const roofKey = `${ownerContext}:${roofVersion}:${roofImage && "sha256" in roofImage ? roofImage.sha256 : ""}`;
  useEffect(() => {
    if (!roofVersion) return;
    const controller = new AbortController();
    let objectUrl = "";
    void user.getIdToken().then((token) => fetch(`/api/trade-quotes?workOrderId=${encodeURIComponent(workOrderId)}&media=roof&versionId=${encodeURIComponent(roofVersion)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
    })).then(async (response) => {
      if (!response.ok) throw new Error("The saved roof image could not be loaded. Reopen the quote or replace the image.");
      const blob = await response.blob();
      if (blob.type !== "image/png") throw new Error("The saved roof image could not be verified.");
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setRoofAsset({ key: roofKey, url: objectUrl, error: "" });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setRoofAsset({ key: roofKey, url: "", error: error instanceof Error ? error.message : "Could not load the roof image." });
    });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [roofKey, roofVersion, user, workOrderId]);
  const roofUrl = roofImage && "dataUrl" in roofImage ? roofImage.dataUrl : roofAsset?.key === roofKey ? roofAsset.url : "";
  const roofError = roofAsset?.key === roofKey ? roofAsset.error : "";
  useEffect(() => {
    if (!business?.hasLogo) return;
    const controller = new AbortController();
    let objectUrl = "";
    void user.getIdToken().then((token) => fetch(`/api/trade-quotes?workOrderId=${encodeURIComponent(workOrderId)}&media=logo`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
    })).then(async (response) => {
      if (!response.ok) return;
      const blob = await response.blob();
      if (controller.signal.aborted || !["image/png", "image/jpeg"].includes(blob.type)) return;
      objectUrl = URL.createObjectURL(blob);
      setLogo({ ownerContext, url: objectUrl });
    }).catch(() => { /* Business name remains visible when no authorised logo can be loaded. */ });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [business?.hasLogo, ownerContext, user, workOrderId]);
  const document = validationMessage ? { complete: false as const, message: validationMessage } : liveQuoteDocument(lines, choices);
  const name = business?.businessName || "Your trade business";
  return <aside className={`${styles.preview}${review ? ` ${styles.review}` : ""}`} aria-label={review ? "Quote ready for review" : "Live quote document preview"} data-theme={business?.brandThemeKey || "emerald_navy"} data-border={business?.brandBorderStyle || "soft"}>
    {!review && <div className={styles.previewHeading}><div><span>Updates as you edit</span><h5>Customer quote preview</h5></div><span className={styles.draft}>Draft</span></div>}
    <article className={styles.sheet}>
      <header className={styles.brand}>{business?.hasLogo && logo?.ownerContext === ownerContext
        ? <div className={styles.logo} role="img" aria-label={`${name} logo`} style={{ backgroundImage: `url("${logo.url}")` }} />
        : <div className={styles.monogram} aria-hidden="true">{name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</div>}<div><small>Prepared by</small><strong>{name}</strong><span>QUOTE</span></div></header>
      <div className={styles.paper}>
        <section className={styles.parties}><div><small>Prepared for</small><strong>{job?.customerName || "Customer"}</strong><span>{job?.siteSummary || "Service address"}</span></div><div><small>{identity?.quoteNumber || "New quote"}</small><strong>{identity ? `Version ${identity.versionNumber}` : "Draft"}</strong><span>{validUntil ? `Valid until ${new Date(`${validUntil}T00:00:00`).toLocaleDateString("en-AU")}` : "Validity to be confirmed"}</span></div></section>
        {job?.title && <h6 className={styles.jobTitle}>{job.title}</h6>}
        {customerMessage && <p className={styles.introduction}>{customerMessage}</p>}
        {roofImage && <figure className={styles.roofFigure}><h6>Proposed roof layout</h6>{roofUrl
          // eslint-disable-next-line @next/next/no-img-element -- Private authorised PNG or a local captured image.
          ? <img src={roofUrl} alt="Proposed roof layout from the map" />
          : <p role={roofError ? "alert" : "status"}>{roofError || "Loading roof layout..."}</p>}<figcaption>Illustrative layout. Confirm dimensions, roof conditions and installation clearances on site.</figcaption></figure>}
        <section className={styles.items} aria-label="Included quote items"><div className={styles.tableHeading}><span>Included work</span><span>Incl GST</span></div>
          {lines.map((line, index) => {
            if (line.sectionHeading === OVERALL_PERCENT_DISCOUNT_SECTION) return null;
            const kind = mapQuoteKind(line.sectionHeading), unit = kind ? MAP_QUOTE_UNITS[kind] : "";
            const fixedDiscount = overallTradeQuoteDiscountKind(line) === "fixed";
            const calculated = document.complete ? document.base.lines[index] : null;
            let rateCents: number | null = null;
            try { rateCents = dollarsToCents(line.unitPrice, line.lineType === "adjustment"); } catch { /* Incomplete input has no display price. */ }
            return <div className={styles.item} key={line.id || index}><div><strong>{line.description || "Item description needed"}</strong><small>{line.sectionHeading}{fixedDiscount ? "" : unit ? ` | ${line.quantity || "?"} ${unit}` : ` | Qty ${line.quantity || "?"}`}</small><small>{rateCents !== null ? fixedDiscount ? `${money(Math.abs(rateCents))} off incl GST` : `${money(rateCents)}${unit ? ` / ${unit}` : " each"} ex GST` : "Price needed"}</small></div><b>{calculated ? money(calculated.totalCents) : "Incomplete"}</b></div>;
          })}
          {!lines.length && <p className={styles.placeholder}>Scope is provided by the customer choices below.</p>}
        </section>
        {choices.length > 0 && <section className={styles.choices}><h6>Customer choices</h6>{choices.map((choice, index) => <div className={styles.item} key={choice.clientKey}><div><strong>{choice.name || "Choice name needed"}{choice.recommended ? " · Recommended" : ""}</strong><small>{choice.summary || (choice.kind === "addon" ? "Optional extra" : "Choose one")}</small></div><b>{document.complete ? `${choice.kind === "addon" ? "+ " : ""}${money((choice.kind === "addon" ? 0 : document.base.totalCents) + document.options[index].totals.totalCents)}` : "Incomplete"}</b></div>)}</section>}
        {document.complete ? <dl className={styles.totals}><div><dt>Subtotal ex GST</dt><dd>{money(document.totals.subtotalCents - document.discounts)}</dd></div>{document.discounts < 0 && <div><dt>Discounts and rebates ex GST</dt><dd>{money(document.discounts)}</dd></div>}<div><dt>GST</dt><dd>{money(document.totals.taxCents)}</dd></div><div className={styles.total}><dt>{document.totals.label}</dt><dd>{money(document.totals.totalCents)}</dd></div></dl>
          : <div className={styles.incomplete} role="status"><strong>Total incomplete</strong><span>{document.message}</span></div>}
        <section className={styles.terms}><h6>Scope and terms</h6><p>{terms || "Your recorded terms will appear here."}</p></section>
        <footer className={styles.footer}><span>{name}</span><span>Draft · Not issued</span></footer>
      </div>
    </article>
    {!review && <p className={styles.previewNote}>Live draft preview. Save, review and confirm the customer&apos;s email consent before sending.</p>}
  </aside>;
}
