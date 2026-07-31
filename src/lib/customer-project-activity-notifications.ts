export type CustomerProjectActivityEventType =
  | "installer_quote_submitted"
  | "customer_installer_accepted";

export type CustomerProjectActivityAudience = "customer" | "installer";

export const CUSTOMER_QUOTE_INBOX_URL =
  "https://compare.ausenergyassessments.com/account/quotes";
export const INSTALLER_LEAD_INBOX_URL =
  "https://compare.ausenergyassessments.com/direct-trade/dashboard?workspace=leads#opportunity-inbox";

const encoder = new TextEncoder();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bounded(value: unknown, maximum: number) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function escapeHtml(value: unknown) {
  return bounded(value, 240)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(value),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function customerProjectActivityIdentity(
  eventKey: string,
  audience: CustomerProjectActivityAudience,
) {
  const safeEventKey = bounded(eventKey, 260);
  return {
    eventId: await sha256(`aea-project-activity-event-v1|${safeEventKey}`),
    deliveryId: await sha256(
      `aea-project-activity-delivery-v1|${safeEventKey}|${audience}|email`,
    ),
    idempotencyKey: await sha256(
      `aea-project-activity-provider-v1|${safeEventKey}|${audience}|email`,
    ),
  };
}

export function customerProjectQuoteId(
  opportunityMatchId: string,
  installerUid: string,
) {
  return sha256(
    `aea-platform-quote-v1|${bounded(opportunityMatchId, 180)}|${bounded(installerUid, 180)}`,
  );
}

export function customerProjectActivityEmailHash(email: string) {
  return sha256(
    `aea-project-activity-email-v1|${bounded(email, 320).toLowerCase()}`,
  );
}

export function customerProjectActivityDraft({
  eventType,
  audience,
  businessName,
  opportunityMatchId,
}: {
  eventType: CustomerProjectActivityEventType;
  audience: CustomerProjectActivityAudience;
  businessName?: string;
  opportunityMatchId?: string;
}) {
  const installerName = bounded(businessName, 120) || "A verified installer";
  const customerMessage =
    eventType === "installer_quote_submitted" && audience === "customer";
  const subject = customerMessage
    ? "Your installer quote is ready to review"
    : "Your customer wants to get in touch";
  const heading = customerMessage
    ? "A quote is ready"
    : "The customer chose your business";
  const intro = customerMessage
    ? `${installerName} has sent a structured quote for your home project.`
    : "The customer chose your business to discuss the next step and released their contact details.";
  const action = customerMessage
    ? "Review the quote in your secure AEA account. Choose Get in touch only if you want that business to receive your contact details. This does not accept a quote, make a payment or authorise work."
    : "Open the lead in TLink, call or email the customer, and schedule the next step.";
  const exactInstallerLeadUrl = UUID_PATTERN.test(
    String(opportunityMatchId || ""),
  )
    ? `https://compare.ausenergyassessments.com/direct-trade/dashboard?workspace=leads&matchId=${encodeURIComponent(String(opportunityMatchId))}#opportunity-inbox`
    : INSTALLER_LEAD_INBOX_URL;
  const link = customerMessage
    ? CUSTOMER_QUOTE_INBOX_URL
    : exactInstallerLeadUrl;
  const htmlLink = escapeHtml(link);
  const button = customerMessage ? "Review my quote" : "Open the connected lead";
  const boundary = customerMessage
    ? "Your private notes and full service details remain protected in the signed-in workflow."
    : "Customer contact details are available only inside the signed-in lead. They are not included in this email.";
  const body = [
    "Australian Energy Assessments",
    "",
    heading,
    "",
    intro,
    action,
    "",
    `${button}: ${link}`,
    "",
    boundary,
  ].join("\n").slice(0, 1800);
  const html = `<!doctype html>
<html lang="en-AU">
  <body style="margin:0;background:#eaf4f6;color:#062d3d;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#eaf4f6;">
      <tr>
        <td align="center" style="padding:28px 14px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;border-collapse:separate;border-spacing:0;border-radius:22px;overflow:hidden;background:#ffffff;box-shadow:0 16px 40px rgba(0,33,50,.14);">
            <tr>
              <td style="padding:28px 32px;background:#063448;background-image:linear-gradient(135deg,#001b34 0%,#087c86 100%);border-bottom:6px solid #20d8c1;color:#ffffff;">
                <div style="color:#63f1d7;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">Australian Energy Assessments</div>
                <h1 style="margin:12px 0 0;font-size:30px;line-height:1.15;color:#ffffff;">${escapeHtml(heading)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 32px 34px;">
                <p style="margin:0 0 14px;font-size:17px;line-height:1.6;color:#153f4b;">${escapeHtml(intro)}</p>
                <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#45636c;">${escapeHtml(action)}</p>
                <p style="margin:0 0 26px;">
                  <a href="${htmlLink}" style="display:inline-block;border-radius:12px;background:#0b9562;color:#ffffff;font-size:16px;font-weight:800;padding:14px 20px;text-decoration:none;">${escapeHtml(button)}</a>
                </p>
                <div style="border-radius:14px;background:#e9f8f3;border-left:5px solid #16b87a;padding:16px 18px;color:#315f56;font-size:14px;line-height:1.55;">${escapeHtml(boundary)}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return {
    subject: subject.slice(0, 160),
    body,
    html: html.slice(0, 12_000),
  };
}
