import type { TradeQuoteDocumentSnapshot } from "@/lib/trade-quote-review-server";
import { tradeQuoteDocumentDisplayTotals } from "@/lib/trade-quote-document-totals.mjs";

export type TradeQuoteEmail = {
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
};

export type BuildTradeQuoteEmailInput = {
  snapshot: TradeQuoteDocumentSnapshot;
  shareUrl: string;
  expiresAt: string;
  subjectTemplate?: string;
};

function cleanText(value: unknown, maximum = 2_000) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function escapeHtml(value: unknown) {
  return cleanText(value, 20_000)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function money(cents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(Math.max(0, Number(cents) || 0) / 100);
}

function safeShareUrl(value: string) {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:"
    && !(
      parsed.protocol === "http:"
      && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    )
  ) {
    throw new TypeError("A secure quote review URL is required.");
  }
  return parsed.toString();
}

function subjectFromTemplate(
  template: string,
  snapshot: TradeQuoteDocumentSnapshot,
) {
  const values: Record<string, string> = {
    business_name: snapshot.business.name,
    quote_number: snapshot.quoteNumber,
    customer_name: snapshot.customer.name,
    work_title: snapshot.work.title,
  };
  let subject = cleanText(template, 240);
  for (const [key, value] of Object.entries(values)) {
    subject = subject.replaceAll(`{${key}}`, cleanText(value, 120));
  }
  subject = cleanText(subject, 180);
  if (!subject) {
    subject = `${snapshot.business.name} sent quote ${snapshot.quoteNumber}`;
  }
  if (
    !subject.toLocaleLowerCase("en-AU").includes(
      snapshot.business.name.toLocaleLowerCase("en-AU"),
    )
  ) {
    subject = `${snapshot.business.name}: ${subject}`.slice(0, 180);
  }
  if (!subject.includes(snapshot.quoteNumber)) {
    subject = `${subject} | ${snapshot.quoteNumber}`.slice(0, 180);
  }
  return subject;
}

function summaryLines(snapshot: TradeQuoteDocumentSnapshot) {
  const lines = snapshot.items.slice(0, 8);
  return {
    text: lines
      .map((line) => `- ${line.description}: ${money(line.totalCents)}`)
      .join("\n"),
    html: lines
      .map(
        (line) =>
          `<tr><td style="padding:8px 0;color:#173f3b;border-bottom:1px solid #d9e8e5">${escapeHtml(line.description)}</td><td style="padding:8px 0 8px 16px;text-align:right;font-weight:700;color:#063b42;border-bottom:1px solid #d9e8e5">${escapeHtml(money(line.totalCents))}</td></tr>`,
      )
      .join(""),
    remaining: Math.max(0, snapshot.items.length - lines.length),
  };
}

export function buildTradeQuoteEmail(
  input: BuildTradeQuoteEmailInput,
): TradeQuoteEmail {
  const { snapshot } = input;
  const shareUrl = safeShareUrl(input.shareUrl);
  const subject = subjectFromTemplate(
    input.subjectTemplate ||
      snapshot.business.quoteEmailSubjectTemplate ||
      "{business_name} sent quote {quote_number}",
    snapshot,
  );
  const intro =
    cleanText(snapshot.customerMessage, 1_000) ||
    cleanText(snapshot.business.quoteEmailIntro, 1_000) ||
    "Thank you for the opportunity to quote for your project. Review the scope, choices and total below.";
  const expires = cleanText(input.expiresAt, 40).slice(0, 10);
  const lines = summaryLines(snapshot);
  const displayTotals = tradeQuoteDocumentDisplayTotals(snapshot);
  const contact = [snapshot.business.phone, snapshot.business.email]
    .map((value) => cleanText(value, 160))
    .filter(Boolean)
    .join(" | ");
  const optionalText =
    snapshot.choices.length > 0
      ? `\nThis quote includes ${snapshot.choices.length} customer choice${snapshot.choices.length === 1 ? "" : "s"} to review online.`
      : "";
  const text = [
    `Quote from ${snapshot.business.name}`,
    "",
    `Hi ${snapshot.customer.name || "there"},`,
    "",
    intro,
    "",
    `${snapshot.work.title} | ${snapshot.site.summary}`,
    lines.text,
    lines.remaining ? `- Plus ${lines.remaining} more included item${lines.remaining === 1 ? "" : "s"}` : "",
    "",
    `${displayTotals.label}: ${money(displayTotals.totalCents)} including GST`,
    optionalText.trim(),
    displayTotals.hasChoices
      ? "Your final total is calculated from the options you choose in the secure review."
      : "",
    "",
    "Review the quote, ask a question, choose options, sign or decline:",
    shareUrl,
    "",
    expires ? `This private link expires ${expires}.` : "",
    "A PDF copy is attached for your records.",
    "",
    contact ? `${snapshot.business.name} | ${contact}` : snapshot.business.name,
    snapshot.business.abn ? `ABN ${snapshot.business.abn}` : "",
  ]
    .filter((line, index, all) => line || all[index - 1] !== "")
    .join("\n")
    .trim();

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#eef5f3;color:#173f3b;font-family:Arial,Helvetica,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(snapshot.business.name)} sent quote ${escapeHtml(snapshot.quoteNumber)} for ${escapeHtml(snapshot.work.title)}.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef5f3">
      <tr><td align="center" style="padding:28px 12px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #cfe0dd;border-radius:18px;overflow:hidden">
          <tr><td style="padding:28px 32px;background:linear-gradient(135deg,#042f3c,#0e6b61);color:#ffffff">
            <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8debd0">Quote from</div>
            <div style="padding-top:8px;font-size:27px;line-height:1.2;font-weight:700">${escapeHtml(snapshot.business.name)}</div>
            <div style="padding-top:8px;font-size:14px;color:#d9f6ed">${escapeHtml(snapshot.quoteNumber)} | Version ${snapshot.versionNumber}</div>
          </td></tr>
          <tr><td style="padding:30px 32px">
            <p style="margin:0 0 16px;font-size:17px;line-height:1.55">Hi ${escapeHtml(snapshot.customer.name || "there")},</p>
            <p style="margin:0 0 22px;font-size:16px;line-height:1.6;color:#345b57">${escapeHtml(intro)}</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:22px;background:#f2f8f6;border-radius:12px">
              <tr><td style="padding:16px">
                <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#397068">Work</div>
                <div style="padding-top:5px;font-size:18px;font-weight:700;color:#063b42">${escapeHtml(snapshot.work.title)}</div>
                <div style="padding-top:5px;font-size:13px;line-height:1.45;color:#55736f">${escapeHtml(snapshot.site.summary)}</div>
              </td></tr>
            </table>
            ${lines.html ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:18px">${lines.html}</table>` : ""}
            ${lines.remaining ? `<p style="margin:0 0 18px;font-size:13px;color:#55736f">Plus ${lines.remaining} more included item${lines.remaining === 1 ? "" : "s"} in the attached quote.</p>` : ""}
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;background:#063b42;border-radius:12px;color:#ffffff">
              <tr><td style="padding:18px 20px"><div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#8debd0">${escapeHtml(displayTotals.label)} including GST</div><div style="padding-top:5px;font-size:28px;font-weight:700">${escapeHtml(money(displayTotals.totalCents))}</div></td></tr>
            </table>
            ${snapshot.choices.length ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#55736f">This quote includes ${snapshot.choices.length} customer choice${snapshot.choices.length === 1 ? "" : "s"} to review online.</p>` : ""}
            ${displayTotals.hasChoices ? `<p style="margin:0 0 20px;font-size:13px;line-height:1.5;color:#6c827f">Your final total is calculated from the options you choose in the secure review.</p>` : ""}
            <table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="border-radius:10px;background:#0bb47c"><a href="${escapeHtml(shareUrl)}" style="display:inline-block;padding:14px 22px;color:#ffffff;text-decoration:none;font-weight:700">Review your quote</a></td></tr></table>
            <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6c827f">Use the private link to review the quote, ask a question, choose options, sign or decline.${expires ? ` It expires ${escapeHtml(expires)}.` : ""} A PDF copy is attached for your records.</p>
          </td></tr>
          <tr><td style="padding:20px 32px;border-top:1px solid #d9e8e5;background:#f7fbfa;font-size:13px;line-height:1.55;color:#55736f">
            <strong style="color:#173f3b">${escapeHtml(snapshot.business.name)}</strong>${contact ? `<br>${escapeHtml(contact)}` : ""}${snapshot.business.abn ? `<br>ABN ${escapeHtml(snapshot.business.abn)}` : ""}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return {
    subject,
    text,
    html,
    replyTo: cleanText(snapshot.business.email, 254) || undefined,
  };
}

export async function tradeQuoteEmailContentSha256(email: TradeQuoteEmail) {
  const bytes = new TextEncoder().encode(
    `${email.subject}\n${email.text}\n${email.html}`,
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
