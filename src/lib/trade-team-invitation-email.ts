import {
  reminderProviderFailureOutcome,
  sendServiceReminderProviderMessage,
  serviceReminderProviderConfiguration,
} from "@/lib/service-reminder-delivery";

export type TradeTeamInvitationEmailInput = {
  requestUrl: string;
  inviteId: string;
  email: string;
  displayName: string;
  businessName: string;
  inviteUrl: string;
};

export type TradeTeamInvitationDelivery = {
  status: "sent" | "failed" | "unknown";
  message: string;
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

function singleLine(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

export function tradeTeamInvitationEmail(input: TradeTeamInvitationEmailInput) {
  const requestUrl = new URL(input.requestUrl);
  const inviteUrl = new URL(input.inviteUrl);
  if (!/^https?:$/.test(inviteUrl.protocol) || inviteUrl.origin !== requestUrl.origin
    || inviteUrl.username || inviteUrl.password || inviteUrl.pathname !== "/direct-trade/team"
    || !inviteUrl.searchParams.get("invite")) {
    throw new Error("TEAM_INVITATION_URL_INVALID");
  }
  const name = singleLine(input.displayName) || "there";
  const business = singleLine(input.businessName) || "your team";
  const portalUrl = new URL("/direct-trade/team", requestUrl).toString();
  const subject = `You’re invited to ${business} on TLink`;
  const body = [
    `Hello ${name},`,
    "",
    `${business} has invited you to join their team on TLink.`,
    "",
    "Open your invitation to create your password and join the team. Your business has already set up your access.",
    "",
    `Join team: ${inviteUrl.toString()}`,
    "",
    `Already use TLink? Sign in with your existing account or continue with Google using ${input.email}.`,
    "",
    "This invitation expires in 7 days. If it expires, ask your business to resend it.",
    "After joining, use this portal login for everyday access:",
    portalUrl,
    "",
    "Keep this invitation private. If you were not expecting it, you can ignore this email.",
  ].join("\n");
  const html = `<div style="background:#f3f8f6;color:#123e36;font-family:Arial,Helvetica,sans-serif;padding:24px 12px">
  <div style="background:#ffffff;border:1px solid #d6e5df;border-radius:16px;margin:0 auto;max-width:540px;padding:28px">
    <p style="color:#087e60;font-size:13px;font-weight:700;letter-spacing:1px;margin:0 0 20px">TLINK</p>
    <h1 style="font-size:26px;line-height:1.25;margin:0 0 20px">You’re invited to the team</h1>
    <p style="font-size:16px;line-height:1.6">Hello ${escapeHtml(name)},</p>
    <p style="font-size:16px;line-height:1.6"><strong>${escapeHtml(business)}</strong> has invited you to join their team on TLink.</p>
    <p style="font-size:16px;line-height:1.6">Open your invitation to create your password and join the team. Your business has already set up your access.</p>
    <p style="margin:24px 0"><a href="${escapeHtml(inviteUrl.toString())}" style="background:#087e60;border-radius:8px;color:#ffffff;display:inline-block;font-size:16px;font-weight:700;padding:14px 24px;text-decoration:none">Join team</a></p>
    <p style="font-size:14px;line-height:1.6">Already use TLink? Sign in with your existing account or continue with Google using <strong>${escapeHtml(input.email)}</strong>.</p>
    <p style="color:#526b65;font-size:13px;line-height:1.6;margin-top:24px">This invitation expires in 7 days. If it expires, ask your business to resend it.</p>
    <p style="font-size:14px;line-height:1.6">After joining, use <a href="${escapeHtml(portalUrl)}" style="color:#087e60;font-weight:700">TLink portal login</a> for everyday access.</p>
    <p style="color:#526b65;font-size:13px;line-height:1.6">Keep this invitation private. If you were not expecting it, you can ignore this email.</p>
  </div>
</div>`;
  return { subject, body, html };
}

export async function sendTradeTeamInvitationEmail(input: TradeTeamInvitationEmailInput): Promise<TradeTeamInvitationDelivery> {
  if (!serviceReminderProviderConfiguration().email.configured) {
    return { status: "failed", message: "Team member saved, but invitation email is not configured. Contact your TLink administrator." };
  }
  try {
    const email = tradeTeamInvitationEmail(input);
    await sendServiceReminderProviderMessage({
      channel: "email",
      recipient: input.email,
      subject: email.subject,
      body: email.body,
      html: email.html,
      idempotencyKey: `tlink-team-invitation:${input.inviteId}`,
      callbackUrl: new URL("/api/service-reminder-provider-events/resend", input.requestUrl).toString(),
      messageType: "tlink_team_invitation",
    });
    return { status: "sent", message: `Invitation email submitted to ${input.email}. Ask them to check their inbox and spam folder.` };
  } catch (error) {
    return reminderProviderFailureOutcome(error) === "indeterminate"
      ? { status: "unknown", message: "Team member saved, but email delivery could not be confirmed. Check their inbox before resending the invitation." }
      : { status: "failed", message: "Team member saved, but the invitation email could not be sent. Check the email address and resend the invitation." };
  }
}
