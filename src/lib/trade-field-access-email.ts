type FieldSetupEmailInput = {
  recipientName: string;
  username: string;
  pin: string;
  expiresAt: string;
  appUrl: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] || character);
}

function expiryLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("FIELD_SETUP_EXPIRY_INVALID");
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Australia/Melbourne",
  }).format(date);
}

export function tradeFieldAccessEmail(input: FieldSetupEmailInput) {
  const name = input.recipientName.trim() || "there";
  const expires = expiryLabel(input.expiresAt);
  const subject = "Your TLink app username and PIN";
  const body = [
    `Hello ${name},`,
    "",
    "Your TLink field app sign-in details are ready.",
    "",
    `Username: ${input.username}`,
    `One-time PIN: ${input.pin}`,
    `PIN expires: ${expires}`,
    "",
    `Open or install TLink: ${input.appUrl}`,
    "",
    "Enter the username and PIN on your phone. The PIN works once. Creating another PIN cancels this one.",
    "",
    "For security, do not forward this email. If you were not expecting it, contact your TLink administrator.",
  ].join("\n");
  const html = `<p>Hello ${escapeHtml(name)},</p>
<p>Your TLink field app sign-in details are ready.</p>
<table role="presentation" style="border-collapse:collapse;margin:20px 0">
  <tr><td style="padding:6px 16px 6px 0;color:#526b65">Username</td><td style="padding:6px 0;font-weight:700">${escapeHtml(input.username)}</td></tr>
  <tr><td style="padding:6px 16px 6px 0;color:#526b65">One-time PIN</td><td style="padding:6px 0;font-size:24px;font-weight:800;letter-spacing:4px">${escapeHtml(input.pin)}</td></tr>
  <tr><td style="padding:6px 16px 6px 0;color:#526b65">PIN expires</td><td style="padding:6px 0">${escapeHtml(expires)}</td></tr>
</table>
<p><a href="${escapeHtml(input.appUrl)}" style="background:#20c997;border-radius:8px;color:#061f2c;display:inline-block;font-weight:700;padding:12px 18px;text-decoration:none">Open or install TLink</a></p>
<p>Enter the username and PIN on your phone. The PIN works once. Creating another PIN cancels this one.</p>
<p style="color:#526b65;font-size:13px">For security, do not forward this email. If you were not expecting it, contact your TLink administrator.</p>`;
  return { subject, body, html };
}
