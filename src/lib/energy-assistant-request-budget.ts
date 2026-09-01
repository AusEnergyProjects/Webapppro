export const ENERGY_ASSISTANT_MAX_BODY_BYTES = 65_536;

export type EnergyAssistantRequestTurn = {
  role: "user" | "assistant";
  content: string;
};

export type EnergyAssistantAskRequest = {
  action: "ask";
  requestId: string;
  message: string;
  recentTurns: EnergyAssistantRequestTurn[];
  continuation: unknown;
  planContext: unknown;
  pageContext: string;
  audience: "public" | "customer" | "trade";
};

export function buildEnergyAssistantAskRequestBody(
  payload: EnergyAssistantAskRequest,
  maximumBytes = ENERGY_ASSISTANT_MAX_BODY_BYTES,
) {
  const recentTurns = [...payload.recentTurns];
  const encoder = new TextEncoder();
  const serialize = () => JSON.stringify({ ...payload, recentTurns });
  let body = serialize();

  while (recentTurns.length && encoder.encode(body).byteLength > maximumBytes) {
    recentTurns.shift();
    if (recentTurns[0]?.role === "assistant") recentTurns.shift();
    body = serialize();
  }

  if (encoder.encode(body).byteLength > maximumBytes) {
    throw new Error(
      "Wattzun AI kept your conversation intact but could not fit this turn into one request. "
      + "Please clear the chat to start a new conversation; your saved home details will remain.",
    );
  }

  return body;
}
