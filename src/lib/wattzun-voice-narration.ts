import { wattzunSpokenReply, type WattzunReply } from "./wattzun-portal.ts";

/** The exact native narration, shared by provider speech and delivered history. */
export function wattzunNativeSpokenReply(reply: WattzunReply): string {
  const next = reply.questions[0];
  const normalise = (text: string) => text.toLocaleLowerCase("en-AU").replace(/\s+/g, " ").trim();
  // All outstanding requirements stay in the structured workflow. Ask the
  // next question once, and never record an unspoken checklist as delivered.
  return wattzunSpokenReply({ ...reply, questions: next && !normalise(reply.message).includes(normalise(next)) ? [next] : [] });
}
