function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] || character);
}

const resetEmailHtml = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">Choose a new password and get back to TLink.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f2f6f5;font-family:Arial,Helvetica,sans-serif;color:#173d37">
  <tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #dce7e3;border-radius:16px;overflow:hidden">
      <tr><td style="background:#07182b;padding:26px 28px;border-bottom:4px solid #37dbac">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
          <td style="padding-right:12px"><img src="https://ausenergyassessments.com/tlink-icon-192.png" width="44" height="44" alt="" style="display:block;border:0;border-radius:10px"></td>
          <td style="color:#ffffff;font-size:30px;font-weight:700;letter-spacing:-1px">TLink</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:32px 28px">
        <h1 style="margin:0 0 18px;font-size:28px;line-height:1.25;font-weight:700;color:#173d37">Reset your password</h1>
        <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#42645c">We received a request to reset the password for your TLink account.</p>
        <p style="margin:0 0 26px;font-size:15px;line-height:1.5;font-weight:700;color:#173d37;word-break:break-word">%EMAIL%</p>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#087e60" style="border-radius:9px;text-align:center">
          <a href="%LINK%" style="background:#087e60;border:1px solid #087e60;border-radius:9px;color:#ffffff;display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;line-height:24px;padding:14px 28px;text-align:center;text-decoration:none">Reset password</a>
        </td></tr></table>
        <p style="margin:22px 0 0;font-size:14px;line-height:1.6;color:#617970">This secure link can be used once. If it has expired, request another reset from TLink.</p>
        <p style="margin:12px 0 0;font-size:13px;line-height:1.6;color:#617970">Button not opening? <a href="%LINK%" style="color:#087e60;text-decoration:underline">Open the password reset page</a>.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:26px;border-top:1px solid #e0e9e5"><tr><td style="padding-top:22px">
          <p style="margin:0;font-size:14px;line-height:1.6;color:#617970">Didn't request this? You can ignore this email. Your password will stay the same.</p>
          <p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#617970">Need help? <a href="mailto:info@ausenergyassessments.com" style="color:#087e60;text-decoration:underline">Contact the TLink team</a>.</p>
        </td></tr></table>
      </td></tr>
    </table>
    <p style="margin:20px 0 0;color:#6b8179;font-size:12px;line-height:1.6">TLink by Australian Energy Assessments<br><a href="https://ausenergyassessments.com/direct-trade" style="color:#6b8179;text-decoration:none">ausenergyassessments.com</a></p>
  </td></tr>
</table>`;

export function tlinkPasswordResetEmail(input: { email: string; resetUrl: string }) {
  const url = new URL(input.resetUrl);
  if (url.origin !== "https://ausenergyassessments.com" || url.pathname !== "/direct-trade/reset-password"
    || url.username || url.password || url.hash || !url.searchParams.get("oobCode")) {
    throw new Error("Invalid password reset destination.");
  }
  const email = input.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid password reset recipient.");
  return {
    subject: "Reset your TLink password",
    html: resetEmailHtml.replace(/%EMAIL%|%LINK%/g, placeholder => escapeHtml(placeholder === "%EMAIL%" ? email : url.toString())),
    body: [
      "TLink", "", "Reset your password",
      "We received a request to reset the password for your TLink account.",
      email, "", `Reset password: ${url.toString()}`, "",
      "This secure link can be used once. If it has expired, request another reset from TLink.",
      "Didn't request this? You can ignore this email. Your password will stay the same.",
      "", "Need help? info@ausenergyassessments.com", "TLink by Australian Energy Assessments",
    ].join("\n"),
  };
}
