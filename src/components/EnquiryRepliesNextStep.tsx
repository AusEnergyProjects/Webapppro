import styles from "./PublicPlanEnquiryForm.module.css";

export type EnquiryEmailDeliveryStatus = "queued" | "sent" | "delivered" | "not_queued";

export function EnquiryRepliesNextStep({ email, deliveryStatus, replyLinkExpected }: { email: string; deliveryStatus: EnquiryEmailDeliveryStatus; replyLinkExpected: boolean }) {
  const deliveryMessage = deliveryStatus === "queued"
    ? "Your email is queued for delivery."
    : deliveryStatus === "delivered"
      ? "Your email has been delivered."
      : deliveryStatus === "sent"
        ? "Your email has been accepted for delivery."
        : "Your email is being prepared.";

  return <aside className={styles.repliesNextStep} aria-label="How to see replies">
    <h4>{replyLinkExpected ? "See replies and quotes in one place" : "Keep your confirmation email"}</h4>
    <p>{deliveryMessage} Look for the email we send to <strong>{email}</strong>{replyLinkExpected ? <>, then choose <strong>Open my quotes &amp; questions</strong>.</> : ". It contains your plan and enquiry reference."}</p>
    {replyLinkExpected ? <p>Use that private link to see quotes, answer questions and share any files you choose. No account or extra form is needed. Keep the link private.</p> : <p>Your email explains how to contact us about this request. No account or extra form is needed.</p>}
    <p>If the email does not arrive, check your spam folder or call <a href="tel:1300241149">1300 241 149</a> with your enquiry reference.</p>
  </aside>;
}
