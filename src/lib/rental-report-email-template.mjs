function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** Presentation only. The caller owns report access, link validity and PDF delivery. */
export function rentalReportEmailDraft({ recipientName, reportNumber, shareUrl, hasAttachment }) {
  const number = String(reportNumber || "").replace(/[\r\n\u0000]/g, " ").trim();
  const name = String(recipientName || "Client").trim();
  let url;
  try { url = new URL(shareUrl); } catch { throw new Error("RENTAL_REPORT_EMAIL_CONTENT_INVALID"); }
  if (!number || !["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("RENTAL_REPORT_EMAIL_CONTENT_INVALID");
  }
  const greeting = name === "Client" || !name ? "Hello," : `Hi ${name},`;
  const attachment = hasAttachment
    ? "A PDF copy is attached for your records. You can also download it from your report link."
    : "Your evidence report is available to download as a PDF from your report link.";
  const review = "Start with the findings and any items marked for action, then review the evidence for each completed check. An issued report does not mean that every check passed. It records the scope and results of this assessment.";
  const actions = "If the report identifies an urgent safety issue, follow the instructions in the report promptly and contact the inspecting business. Any further work needs its own arrangements; this email does not authorise repairs.";
  const sharing = "You can share this secure link with your landlord or rental agent. Anyone with the link can access the report, so only forward it to people who need these property records. If the link has expired or been withdrawn, ask the inspecting business for a renewed link.";
  const help = "If you have any questions or would like to talk through the report, please get in touch with the inspecting business using the details in your report. Quote the report number so they can find the correct assessment.";
  const body = `${greeting}\n\nYour rental assessment report ${number} is ready for you to review.\n\n${attachment}\n\nYou can view and download your report using the secure link below:\n${url.href}\n\nYour next steps\n1. Review the findings. ${review}\n2. Follow up any actions. ${actions}\n3. Save or share your records. ${sharing}\n\n${help}\n\nKind regards,\nTLink`;
  const step = (index, title, copy) => `<tr><td width="38" valign="top" style="width:38px;padding:0 0 22px"><span style="display:inline-block;width:26px;height:26px;line-height:26px;border-radius:50%;background:#e2f6ed;color:#0c6955;text-align:center;font-size:12px;font-weight:bold">${index}</span></td><td style="padding:0 0 22px"><h3 style="margin:0 0 6px;font-size:16px;line-height:22px;color:#183d47">${title}</h3><p style="margin:0;color:#4b676f;font-size:14px;line-height:23px">${copy}</p></td></tr>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your assessment report is ready</title></head>
<body style="margin:0;padding:0;background:#edf2f3;color:#193b45;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Report ${escapeHtml(number)} is ready. Review the findings, download your PDF and share your records securely.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="620" cellpadding="0" cellspacing="0" style="width:100%;max-width:620px;background:#ffffff;border:1px solid #dce7e9;border-radius:16px;overflow:hidden">
<tr><td style="padding:30px 26px;background:#071d30;border-bottom:4px solid #79e7be"><p style="margin:0 0 24px;font-size:22px;line-height:26px;font-weight:bold;letter-spacing:-.5px;color:#ffffff">T<span style="color:#9af3d3">Link</span> <span style="font-size:10px;letter-spacing:1.2px;color:#b7d0d8;font-weight:normal">&nbsp; PROPERTY RECORDS</span></p><p style="margin:0 0 10px;font-size:10px;line-height:16px;letter-spacing:1.6px;color:#9af3d3;font-weight:bold">ISSUED REPORT</p><h1 style="margin:0;color:#ffffff;font-size:31px;line-height:38px;font-weight:600">Your assessment.<br>Your records, together.</h1><p style="margin:14px 0 0;color:#c1d8df;font-size:15px;line-height:24px">Findings, evidence and the next steps for your property.</p></td></tr>
<tr><td style="padding:28px 26px"><p style="margin:0 0 14px;font-size:16px;line-height:25px">${escapeHtml(greeting)}</p><p style="margin:0 0 24px;font-size:16px;line-height:25px">Your rental assessment report is ready for you to review.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:22px;background:#f0f8f5;border:1px solid #cfe9de;border-radius:10px"><p style="margin:0 0 5px;color:#53756b;font-size:10px;line-height:16px;letter-spacing:1.2px;font-weight:bold">REPORT NUMBER</p><p style="margin:0 0 14px;color:#164b3e;font-size:22px;line-height:28px;font-weight:bold;word-break:break-word">${escapeHtml(number)}</p><p style="margin:0 0 20px;color:#3d675b;font-size:14px;line-height:23px">${escapeHtml(attachment)}</p><a href="${escapeHtml(url.href)}" style="display:inline-block;padding:14px 21px;background:#096957;color:#ffffff;border-radius:6px;text-decoration:none;font-size:15px;line-height:20px;font-weight:bold">View report &amp; download PDF &rarr;</a><p style="margin:14px 0 0;color:#557469;font-size:11px;line-height:18px">Your report link also lets you share the record with your landlord or rental agent.</p></td></tr></table>
<h2 style="margin:28px 0 20px;color:#163d48;font-size:21px;line-height:28px">Three useful next steps</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${step(1, "Read the findings", review)}${step(2, "Check what needs attention", actions)}${step(3, "Keep the right people informed", sharing)}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:20px 0 0;border-top:1px solid #dde9e9"><h2 style="margin:0 0 8px;font-size:18px;line-height:25px;color:#193d47">A question about your report?</h2><p style="margin:0;color:#4b676f;font-size:14px;line-height:23px">${help}</p><p style="margin:20px 0 0;color:#617b82;font-size:11px;line-height:18px">If the button does not open, copy this secure address into your browser:</p><p style="margin:5px 0 0;font-size:11px;line-height:18px;word-break:break-all;overflow-wrap:anywhere"><a href="${escapeHtml(url.href)}" style="color:#096957">${escapeHtml(url.href)}</a></p></td></tr></table></td></tr>
<tr><td style="padding:20px 26px;background:#071d30;color:#bed1d8;font-size:11px;line-height:18px"><strong style="color:#ffffff">Delivered through TLink</strong><br>Keep this email with your property records. The report identifies the inspecting business, completed checks and any limitations.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: `Rental assessment report | ${number}`, body, html };
}
