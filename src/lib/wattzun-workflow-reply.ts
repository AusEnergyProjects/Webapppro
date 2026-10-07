import type { WattzunReply } from "./wattzun-portal";
import type { WattzunWorkflowResult } from "./wattzun-workflow";
import type { WattzunFormGuideStep, WattzunFormStep } from "./wattzun-form-step";

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
      : result.lines.filter(line => result.kind === "fill_form" || result.kind === "complete_form" || result.kind === "form_step" || result.kind === "add_price_book_item" || line.label.startsWith("New line") || line.label === "Included quote total").map(line => `${line.label}: ${line.value}`).join(". ");
    const full = [result.summary, target, details].filter(Boolean).join(" ");
    const message = full.length <= 1_850 ? full : [result.summary, target, "The full proposed details are in the review on screen. Please check them before confirming."].filter(Boolean).join(" ");
    return { ...reply, kind: "clarification", message,
      questions: [result.kind === "customer_message" || result.kind === "invoice_reminder" ? "Shall I send this reviewed message?" : result.kind === "draft_job_quote" ? "Shall I save these changes to this job's quote draft?" : result.kind === "fill_form" ? "Shall I save these answers to this form's draft?" : result.kind === "complete_form" ? "Shall I complete and submit this form now?" : result.kind === "form_step" ? "Shall I record this reviewed form step?" : "Shall I add this item to your price book?"], workflow: result };
  }
  return { ...reply, kind: "answer", message: result.receipt.message, questions: [], action: null, workflow: result,
    links: [{ label: result.receipt.label, href: result.receipt.href }] };
}

/** Approval concerns the current displayed/spoken review, never an embedded or future instruction. */
export function isWattzunWorkflowApproval(value: string): boolean {
  const approval = value.trim().replace(/’/g, "'").replace(/\s+/g, " ");
  if (/^(?:(?:yes|yep|yeah|okay|ok|sure)[, ]+)?(?:please )?(?:complete|submit|complete and submit|finalise|finalize) (?:it|this|that|the form|this form|that form)(?: now)?(?: please)?[.!]?$/i.test(approval)) return true;
  if (/^(?:(?:yes|yep|yeah|okay|ok|sure)[, ]+)?(?:please )?save (?:these|those|the) (?:form )?answers(?: please)?[.!]?$/i.test(approval)) return true;
  return /^(?:(?:yes|yep|yeah|okay|ok|sure|absolutely)(?:[, ]+(?:please|go ahead|send it|save it|add it|do it|let's do it|that(?:'s| is) (?:right|fine)))?|(?:please )?(?:send|save|add|confirm|approve) (?:it|that|this|the (?:message|reminder|item|quote|draft|review))(?: please)?|go ahead(?: and (?:send|save|add) it)?|go for it|sounds good|looks good|no worries(?:[, ]+(?:send it|save it|add it|do it))?)[.!]?$/i.test(approval);
}
/** A draft-save or message-send approval is never permission to finalise a form. */
export function isWattzunFormCompletionApproval(value: string): boolean {
  return isWattzunWorkflowApproval(value) && !/\b(?:save|send|add|quote|invoice|draft|answers?)\b/i.test(value);
}

/** Present consent applies only to the exact source-backed step just offered. */
export function isWattzunFormStepApproval(value: string, step: WattzunFormStep, current: WattzunFormGuideStep): boolean {
  if (step.kind !== current.kind) return false;
  const request = value.trim().replace(/’/g, "'").replace(/\s+/g, " ").replace(/[.!]+$/, "").toLowerCase();
  if (!request || /[?"“”\n]/.test(request) || /\b(?:not|no|don't|dont|never|maybe|might|later|tomorrow|yesterday|if|when|said|says|wrote|quote|invoice|draft|answers?|save|send|delete|change|instead)\b/.test(request)) return false;
  const yes = /^(?:yes|yep|yeah|okay|ok|sure|absolutely)(?:,? (?:please|go ahead|that's right|that is right))?$/.test(request) || /^(?:go ahead|go for it|sounds good|looks good)$/.test(request);
  const intent = request.replace(/^(?:(?:yes|yep|yeah|okay|ok|sure),? )?(?:please )?/, "").replace(/ please$/, "");
  if (step.kind === "reference_document" && current.kind === "reference_document") {
    if (step.fieldKey !== current.fieldKey || step.sourceArtifactId !== current.sourceArtifactId || !step.acknowledged) return false;
    const verb = current.mode === "confirmed" ? "read and understood" : "(?:read|viewed|read and understood)";
    return yes || new RegExp(`^(?:(?:i have|i've|ive) ${verb}|i confirm (?:i have|i've|ive) ${verb}) (?:it|this|that|the document|this document|that document)(?: now)?$`).test(intent);
  }
  if (step.kind === "calculator" && current.kind === "calculator") return step.dependencyKey === current.dependencyKey
    && (yes || /^(?:run|calculate|run the calculator|run this calculator|run that calculator|calculate it|run it)(?: now)?$/.test(intent));
  if (step.kind === "prepare_signing" && current.kind === "prepare_signing") return yes || /^(?:prepare|open|start) (?:signing|the signing|this form for signing)(?: now)?$/.test(intent);
  if (step.kind === "scenario" && current.kind === "scenario") {
    if (step.dependencyKey !== current.dependencyKey || !current.scenarioCodes.includes(step.scenarioCode)) return false;
    if (yes) return current.scenarioCodes.length === 1;
    const code = step.scenarioCode.toLowerCase();
    return intent === code || intent === `use ${code}` || intent === `select ${code}` || intent === `choose ${code}` || intent === `use scenario ${code}`;
  }
  if (step.kind === "official_product" && current.kind === "official_product") {
    if (step.dependencyKey !== current.dependencyKey || step.search !== current.search || step.selections.length < current.minimumCount || step.selections.length > current.maximumCount) return false;
    if (yes) return current.choices.length === 1 && step.selections.length === 1 && step.selections[0].quantity === 1
      && step.selections[0].selectionId === current.choices[0].selectionId && step.selections[0].snapshotId === current.choices[0].snapshotId;
    const ordinals = ["first", "second", "third", "fourth", "fifth"];
    const parts = intent.replace(/^(?:use|select|choose) /, "").split(/\s+and\s+|,\s*/);
    if (parts.length !== step.selections.length) return false;
    const quantities: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    for (const [position, selection] of step.selections.entries()) {
      const index = current.choices.findIndex(choice => choice.selectionId === selection.selectionId && choice.snapshotId === selection.snapshotId);
      if (index < 0) return false;
      let part = parts[position];
      const count = /^(\d+|one|two|three|four|five|six|seven|eight|nine|ten) (.+)$/.exec(part);
      if (count) { if ((quantities[count[1]] ?? Number(count[1])) !== selection.quantity) return false; part = count[2]; }
      else if (selection.quantity !== 1) return false;
      const namedChoices = current.choices.filter(choice => [choice.label, choice.model, `${choice.brand} ${choice.model}`]
        .some(label => label.trim().length >= 2 && part === label.toLowerCase()));
      if (namedChoices.length === 1 && namedChoices[0].selectionId === selection.selectionId && namedChoices[0].snapshotId === selection.snapshotId) continue;
      if (!new RegExp(`^(?:the )?${ordinals[index]}(?: (?:one|product|option))?$`).test(part) && !new RegExp(`^(?:product|option|number) ${index + 1}$`).test(part)) return false;
    }
    return true;
  }
  return false;
}
