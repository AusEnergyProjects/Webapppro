function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** One consistent destination across customer enquiry and Q&A emails. */
export function customerHubEmailCta(url) {
  const parsed = new URL(url);
  if (parsed.origin !== "https://ausenergyassessments.com" || !parsed.pathname.startsWith("/customer-hub/") || parsed.username || parsed.password) {
    throw new Error("CUSTOMER_HUB_EMAIL_URL_INVALID");
  }
  const label = "Open my quotes & questions";
  const explanation = "As businesses send quotes or ask questions, they will appear on your private page for this request. Read quotes, answer questions and share photos or documents, all in one place. No account or extra form is needed.";
  return {
    text: `\n\nYOUR QUOTES AND QUESTIONS, TOGETHER\n${explanation}\n\n${label}:\n${url}\n\nUse this same link for every update about this request. Keep your link private.`,
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr><td style="padding:24px 20px;background:#e7f7f1;border:1px solid #b9dfd2;border-radius:12px;font-family:Arial,Helvetica,sans-serif"><h2 style="margin:0 0 12px;color:#123d39;font-size:24px;line-height:31px">Your quotes and questions, together</h2><p style="margin:0 0 20px;color:#294e49;font-size:16px;line-height:25px">${explanation}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" bgcolor="#08775b" style="border-radius:8px"><a href="${escapeHtml(url)}" style="display:block;padding:18px 16px;border:1px solid #08775b;border-radius:8px;background:#08775b;color:#ffffff;text-align:center;text-decoration:none;font-size:19px;line-height:27px;font-weight:bold">${escapeHtml(label)} &rarr;</a></td></tr></table><p style="margin:14px 0 0;color:#3f625b;font-size:14px;line-height:22px">Click above whenever you receive an update about this request. Keep your link private.</p></td></tr></table>`,
  };
}

export function customerHubUpdateEmailHtml(message, url) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#edf2f3;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="620" cellpadding="0" cellspacing="0" style="width:100%;max-width:620px;background:#ffffff"><tr><td style="padding:24px;background:#071d30;color:#ffffff"><strong style="font-size:24px">TLink</strong><h1 style="font-size:26px;line-height:34px;margin:16px 0 0">An update about your request</h1></td></tr><tr><td style="padding:24px"><p style="font-size:17px;line-height:27px;color:#193b45;margin:0">${escapeHtml(message)}</p>${customerHubEmailCta(url).html}</td></tr></table></td></tr></table></body></html>`;
}
