import { handleEnergyAssistantRequest } from "@/lib/energy-assistant-server";

function unavailable() {
  return Response.json({
    ok: false,
    error: {
      code: "ASSISTANT_UNAVAILABLE",
      message: "The energy assistant is temporarily unavailable. Please try again.",
    },
  }, {
    status: 500,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function handle(request: Request) {
  try {
    return await handleEnergyAssistantRequest(request);
  } catch {
    return unavailable();
  }
}

export const POST = handle;
