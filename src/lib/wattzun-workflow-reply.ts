import type { WattzunReply } from "./wattzun-portal";
import type { WattzunWorkflowResult } from "./wattzun-workflow";

/** The application speaks current prepared facts, never a model's invented match or result. */
export function wattzunWorkflowReply(reply: WattzunReply, result: WattzunWorkflowResult): WattzunReply {
  if (result.state === "choose_job") {
    const examples = result.choices.slice(0, 2).map((job, index) => `${index + 1}: ${job.customerName || job.title}, ${job.address || job.workNumber}`);
    const question = examples.length ? `Did you mean ${examples.join(" or ")}${result.choices.length > 2 ? ", or another of the jobs shown" : ""}?` : result.question;
    return { ...reply, kind: "clarification", message: result.question, questions: question === result.question ? [] : [question], workflow: result };
  }
  if (result.state === "needs_details") return { ...reply, kind: "clarification", message: "Yep, I can help with that. I just need these details.", questions: result.questions, workflow: result };
  if (result.state === "review") {
    const target = result.target ? `${result.target.customerName || result.target.title}${result.target.address ? ` at ${result.target.address}` : ""}.` : "";
    const details = result.preview ? [result.preview.subject && `Subject: ${result.preview.subject}.`, `Message: ${result.preview.body}`].filter(Boolean).join(" ")
      : result.lines.filter(line => result.kind === "add_price_book_item" || line.label.startsWith("New line") || line.label === "Included quote total").map(line => `${line.label}: ${line.value}`).join(". ");
    const full = [result.summary, target, details].filter(Boolean).join(" ");
    const message = full.length <= 1_850 ? full : [result.summary, target, "The full proposed details are in the review on screen. Please check them before confirming."].filter(Boolean).join(" ");
    return { ...reply, kind: "clarification", message,
      questions: [result.kind === "customer_message" || result.kind === "invoice_reminder" ? "Shall I send this reviewed message?" : result.kind === "draft_job_quote" ? "Shall I save these changes to this job's quote draft?" : "Shall I add this item to your price book?"], workflow: result };
  }
  return { ...reply, kind: "answer", message: result.receipt.message, questions: [], action: null, workflow: result,
    links: [{ label: result.receipt.label, href: result.receipt.href }] };
}

/** Approval concerns the current displayed/spoken review, never an embedded or future instruction. */
export function isWattzunWorkflowApproval(value: string): boolean {
  const approval = value.trim().replace(/’/g, "'").replace(/\s+/g, " ");
  return /^(?:(?:yes|yep|yeah|okay|ok|sure|absolutely)(?:[, ]+(?:please|go ahead|send it|save it|add it|do it|let's do it|that(?:'s| is) (?:right|fine)))?|(?:please )?(?:send|save|add|confirm|approve) (?:it|that|this|the (?:message|reminder|item|quote|draft|review))(?: please)?|go ahead(?: and (?:send|save|add) it)?|go for it|sounds good|looks good|no worries(?:[, ]+(?:send it|save it|add it|do it))?)[.!]?$/i.test(approval);
}
