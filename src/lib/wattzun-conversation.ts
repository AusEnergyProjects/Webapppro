import { WATTZUN_MAX_HISTORY_CHARACTERS, WATTZUN_MAX_HISTORY_TURNS, type WattzunReply, type WattzunTurn } from "./wattzun-portal.ts";

/** Carry review facts between native audio turns without waiting for a transcript. */
export function wattzunConversationHistory(messages: Array<WattzunTurn & { reply?: WattzunReply; reviewDraft?: WattzunReply["action"]; requestSummary?: string }>): WattzunTurn[] {
  const history: WattzunTurn[] = [];
  for (const { role, content, reply, reviewDraft, requestSummary } of messages) {
    if (role === "assistant" && requestSummary?.trim()) history.push({ role,
      content: "Earlier spoken request as interpreted by Wattzun, unconfirmed facts, not a transcript or saved record: " + requestSummary.slice(0, 1800) });
    const receipt = role === "assistant" && reply?.workflow?.state === "complete" ? reply.workflow.receipt : undefined;
    const recordedContent = receipt ? receipt.message : content;
    if (recordedContent.trim()) history.push({ role, content: recordedContent.slice(0, 4000) });
    if (receipt) continue;
    const proposal = reviewDraft || reply?.action;
    if (role !== "assistant" || !proposal) continue;
    if (proposal.kind === "confirm_workflow") continue;
    const lines = "lines" in proposal ? proposal.lines : [];
    const details = Object.fromEntries(Object.entries(proposal).filter(([field]) => field !== "lines"));
    const prefix = "Earlier proposed draft, unconfirmed facts, not a saved record: ";
    const review = prefix + JSON.stringify(details);
    if (review.length <= 4000) history.push({ role, content: review });
    else for (const [field, value] of Object.entries(details)) history.push({ role, content: `${prefix}${field}: ${value}` });
    if (lines.length) {
      let group: typeof lines = [];
      for (const line of lines) {
        if ((prefix + JSON.stringify({ lines: [...group, line] })).length > 4000 && group.length) {
          history.push({ role, content: prefix + JSON.stringify({ lines: group }) }); group = [];
        }
        group.push(line);
      }
      if (group.length) history.push({ role, content: prefix + JSON.stringify({ lines: group }) });
    }
  }
  while (history.length > WATTZUN_MAX_HISTORY_TURNS || JSON.stringify(history).length > WATTZUN_MAX_HISTORY_CHARACTERS) history.shift();
  return history;
}
