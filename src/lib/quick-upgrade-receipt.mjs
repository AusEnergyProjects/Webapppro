import { ENERGY_SERVICE_LABELS } from "./energy-service-catalogue.mjs";
import { PUBLIC_SITE } from "./public-site.ts";
import { AEA_SERVICE_IDENTITIES, AEA_BUNDLE_IDENTITIES, requiresAeaDelivery } from "./aea-service-identity.mjs";

export const QUICK_UPGRADE_RECEIPT_KIND = "quick-upgrade-receipt/v1";
export const QUICK_UPGRADE_RECEIPT_PREFIX = "quick-upgrade/receipt/";

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function quickUpgradeReceiptDraft(receipt) {
  const name = String(receipt.firstName || "there").trim().slice(0, 60);
  const reference = String(receipt.reference || "").trim().slice(0, 80);
  const services = receipt.services.map((id) => ENERGY_SERVICE_LABELS[id]).filter(Boolean);
  if (!reference || !services.length || !["matched", "review"].includes(receipt.matchingState)) {
    throw new Error("QUICK_UPGRADE_RECEIPT_CONTENT_INVALID");
  }
  const aeaOnly = requiresAeaDelivery(receipt.services);
  const next = aeaOnly
    ? "Australian Energy Assessments will handle your service enquiry directly. Our team has been notified to confirm your property, the selected services and the next step. This request is not distributed to other TLink businesses."
    : receipt.matchingState === "matched"
    ? "Your request is available to suitable approved TLink businesses in your area. They can review the details you chose to share, express interest and provide quotes if they can help."
    : "We have not found an available matching business for your request yet. The Australian Energy Assessments team has been notified to review it and help with the next step.";
  const reassurance = aeaOnly ? "We will confirm service availability, the assessment scope and booking arrangements with you. This enquiry does not authorise work or commit you to a purchase." : "Availability and quote timing depend on the businesses and your project. You can compare any options you receive and decide what is right for you, with no obligation to proceed.";
  const privacy = aeaOnly ? "Australian Energy Assessments keeps your property and contact details to manage this request. Your enquiry is not shared with other TLink businesses." : "Your selected services, property address and message are shared with matching approved businesses. Your email, name and phone are included only where you chose to share them. Australian Energy Assessments keeps your contact details to manage this request.";
  const subject = `[${reference}] Request received | Australian Energy Assessments${aeaOnly ? "" : " + TLink"}`;
  const selectedGuides = Object.values(AEA_SERVICE_IDENTITIES).filter(({ id }) => receipt.services.includes(id))
    .map(({ name: label, path }) => ({ label, url: `${PUBLIC_SITE.apexUrl}${path}` }));
  if (Object.values(AEA_BUNDLE_IDENTITIES).some(({ id }) => receipt.services.includes(id))) {
    selectedGuides.push({ label: "Your two-year safety bundle: visits, inclusions and pricing", url: `${PUBLIC_SITE.apexUrl}/offers` });
  }
  const hasRentalService = receipt.services.some((id) => ["smoke-alarm-blind-safety", "gas-safety-check", "electrical-safety-check", "minimum-rental-standards", "rental-inspection", ...Object.values(AEA_BUNDLE_IDENTITIES).map(({ id }) => id)].includes(id));
  const hasNewHomeRating = receipt.services.includes("nathers-new");
  const hasExistingHomeRating = receipt.services.includes("nathers-existing");
  const hasOnsiteAdvice = receipt.services.includes("onsite-energy-assessment");
  const preparation = aeaOnly
    ? `Have your property address and any previous assessment or safety reports ready.${hasRentalService ? " Tell us whether you are the owner or managing agent and who will arrange access with the renter." : ""}${hasNewHomeRating ? " Have the current plans and specifications ready for your new-home assessment." : ""} Please wait for a confirmed appointment before making access arrangements.`
    : "Keep any relevant plans, photos and previous reports handy. When a business contacts you, check the proposed work, price, inclusions and timing before accepting a quote.";
  const delivery = aeaOnly
    ? `We email completed assessment records the same day they are finalised.${hasRentalService ? " Rental safety records include a shareable report link and a downloadable PDF. The record identifies the completed checks, findings and any actions; it does not automatically mean the property passed." : ""}${hasOnsiteAdvice ? " Your onsite energy assessment provides practical advice without a certificate." : ""}${hasNewHomeRating || hasExistingHomeRating ? " Your formal energy rating and applicable certificate follow completion of the assessment inputs, modelling and quality checks; they are not guaranteed on the day of a property visit." : ""}`
    : "You choose whether to proceed. Ask the business you engage to confirm the appointment, the records they will provide and any follow-up work in writing.";
  const guideBody = selectedGuides.length
    ? `\n\nExplore your selected services\n${selectedGuides.map(({ label, url }) => `${label}\n${url}`).join("\n\n")}`
    : "";
  const body = `Hi ${name},\n\nThank you for your request. It has been safely saved.\n\nYour services: ${services.join(", ")}\nReference: ${reference}\nStatus: Request received; booking not yet confirmed.\n\nWhat happens next\n${next}\n\n${reassurance}\n\nA little preparation helps\n${preparation}\n\n${aeaOnly ? "Your completed records" : "When you choose to proceed"}\n${delivery}${guideBody}\n\nYour details stay in the right hands\n${privacy}\nPrivacy policy: ${PUBLIC_SITE.apexUrl}/privacy-policy\n\nNeed a hand? Reply to this email, quote your reference, call ${PUBLIC_SITE.phoneDisplay} or email ${PUBLIC_SITE.email}.\n\nAustralian Energy Assessments and TLink\n${PUBLIC_SITE.phoneDisplay}\n${PUBLIC_SITE.email}\n\nThis is an acknowledgement of your service request, not a booking, quote or agreement to start work.`;
  const serviceRows = services.map((label) => `<span style="display:inline-block;padding:8px 12px;margin:0 6px 8px 0;background:#e7f7f1;border:1px solid #c9e9de;border-radius:6px;font-size:13px;line-height:20px;color:#145746">${escapeHtml(label)}</span>`).join("");
  const guideRows = selectedGuides.map(({ label, url }) => `<tr><td style="padding:12px 0;border-bottom:1px solid #dce9e5"><a href="${escapeHtml(url)}" style="color:#096957;text-decoration:underline;font-size:14px;line-height:22px;font-weight:bold">${escapeHtml(label)} &rarr;</a></td></tr>`).join("");
  const step = (index, title, copy) => `<tr><td width="36" valign="top" style="width:36px;padding:0 0 22px"><span style="display:inline-block;width:25px;height:25px;line-height:25px;border-radius:50%;background:#e3f5ed;color:#0c6955;text-align:center;font-size:12px;font-weight:bold">${index}</span></td><td style="padding:0 0 22px"><h3 style="margin:0 0 6px;font-size:16px;line-height:22px;color:#163d46">${title}</h3><p style="margin:0;font-size:14px;line-height:23px;color:#4b676f">${escapeHtml(copy)}</p></td></tr>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your request is saved</title></head>
<body style="margin:0;padding:0;background:#edf2f3;color:#193b45;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">We have received your request. Your selected services, next steps and a direct way to reach our team.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="620" cellpadding="0" cellspacing="0" style="width:100%;max-width:620px;background:#ffffff;border:1px solid #dce7e9;border-radius:16px;overflow:hidden">
<tr><td style="padding:30px 26px;background:#071d30;border-bottom:4px solid #79e7be"><p style="margin:0 0 24px;color:#9af3d3;font-size:11px;line-height:19px;letter-spacing:1.3px;font-weight:bold">AUSTRALIAN ENERGY<br>ASSESSMENTS <span style="color:#bed3db">&nbsp; + &nbsp; TLINK</span></p><p style="margin:0 0 10px;font-size:10px;line-height:16px;letter-spacing:1.6px;color:#9af3d3;font-weight:bold">REQUEST RECEIVED</p><h1 style="margin:0;color:#ffffff;font-size:31px;line-height:38px;font-weight:600">Thanks for reaching out.<br>We will take it from here.</h1><p style="margin:14px 0 0;color:#c1d8df;font-size:15px;line-height:24px">${aeaOnly ? "One team to help with your assessment and property safety enquiry." : "Your next step towards a more comfortable, efficient home."}</p></td></tr>
<tr><td style="padding:28px 26px"><p style="margin:0 0 14px;font-size:16px;line-height:25px">Hi ${escapeHtml(name)},</p><p style="margin:0 0 24px;font-size:16px;line-height:25px">Thank you for letting us know what you need. Your request has been safely saved.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:20px;background:#f0f8f5;border:1px solid #cfe9de;border-radius:10px"><p style="margin:0 0 12px;color:#53756b;font-size:10px;line-height:16px;letter-spacing:1.2px;font-weight:bold">YOUR SELECTED SERVICES</p><div>${serviceRows}</div><p style="margin:10px 0 0;color:#41685c;font-size:12px;line-height:19px;word-break:break-word">Reference: <strong>${escapeHtml(reference)}</strong></p><p style="margin:10px 0 0;color:#41685c;font-size:12px;line-height:19px">Request received &bull; Booking not yet confirmed</p></td></tr></table>
<h2 style="margin:28px 0 20px;color:#163d48;font-size:21px;line-height:28px">What happens next</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${step(1, aeaOnly ? "We confirm the right service with you" : "Your request reaches the right team", next)}${step(2, "A little preparation helps", preparation)}${step(3, aeaOnly ? "Your completed records, clearly explained" : "You choose whether to proceed", delivery)}</table>
<p style="margin:0 0 24px;padding:15px 16px;border-left:3px solid #8cbfaf;background:#f6f9f8;color:#4e6b62;font-size:13px;line-height:21px">${escapeHtml(reassurance)}</p>
${selectedGuides.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:20px;background:#f5f8f9;border-radius:8px"><h2 style="margin:0 0 5px;color:#163d48;font-size:18px;line-height:25px">Know what is included</h2><p style="margin:0 0 8px;color:#587279;font-size:13px;line-height:21px">Read the scope, preparation advice, report details and answers to common questions for your selection.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${guideRows}</table></td></tr></table>` : ""}
<h2 style="margin:26px 0 8px;font-size:18px;line-height:25px;color:#193d47">Your details stay in the right hands</h2><p style="margin:0 0 12px;color:#5a737a;font-size:12px;line-height:21px">${escapeHtml(privacy)}</p><p style="margin:0 0 24px;font-size:12px;line-height:20px"><a href="${PUBLIC_SITE.apexUrl}/privacy-policy" style="color:#096957;text-decoration:underline">Read our privacy policy</a></p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:22px 0 0;border-top:1px solid #dce9e8"><h2 style="margin:0 0 8px;color:#163d48;font-size:20px;line-height:27px">A real team, ready to help.</h2><p style="margin:0 0 18px;color:#4b676f;font-size:14px;line-height:23px">Reply to this email or contact us below. Quote your reference so we can find your request.</p><a href="${PUBLIC_SITE.phoneHref}" style="display:inline-block;padding:13px 20px;margin:0 8px 12px 0;background:#096957;border-radius:6px;color:#ffffff;font-size:15px;line-height:20px;font-weight:bold;text-decoration:none">Call ${PUBLIC_SITE.phoneDisplay}</a><p style="margin:0 0 8px;font-size:14px;line-height:23px"><a href="mailto:${PUBLIC_SITE.email}" style="color:#096957;text-decoration:underline;word-break:break-word">${PUBLIC_SITE.email}</a></p></td></tr></table></td></tr>
<tr><td style="padding:20px 26px;background:#071d30;color:#bed1d8;font-size:11px;line-height:18px"><strong style="color:#ffffff">Australian Energy Assessments and TLink</strong><br>This is an acknowledgement of your service request, not a booking, quote or agreement to start work.</td></tr></table></td></tr></table></body></html>`;

  return { subject, body, html, replyTo: PUBLIC_SITE.email };
}
