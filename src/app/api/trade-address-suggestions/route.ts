import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { requireInstallerOperations } from "@/lib/trade-integrations-server";

export const runtime = "edge";

type ProviderSuggestion = {
  id?: unknown; label?: unknown; addressLine1?: unknown; addressLine2?: unknown;
  suburb?: unknown; state?: unknown; postcode?: unknown;
};

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try { await requireInstallerOperations(request); }
  catch (error) {
    const code = error instanceof Error ? error.message : "";
    return adminJson({ ok: false, error: code === "AUTH_REQUIRED" ? "Sign in to search addresses." : "Address search is not available to this account." }, code === "AUTH_REQUIRED" ? 401 : 403);
  }
  const query = cleanAdminText(new URL(request.url).searchParams.get("query"), 140);
  if (query.length < 3) return adminJson({ ok: true, configured: false, suggestions: [] });
  const endpoint = String(process.env.TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT || "").trim();
  const token = String(process.env.TLINK_ADDRESS_AUTOCOMPLETE_TOKEN || "").trim();
  if (!endpoint || !token) return adminJson({ ok: true, configured: false, suggestions: [] });
  try {
    const url = new URL(endpoint); url.searchParams.set("query", query); url.searchParams.set("country", "AU");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(4_000) });
    if (!response.ok) throw new Error("provider unavailable");
    const result = await response.json() as { suggestions?: ProviderSuggestion[] };
    const suggestions = (result.suggestions || []).slice(0, 8).map((item) => ({
      id: cleanAdminText(item.id, 180), label: cleanAdminText(item.label, 240),
      addressLine1: cleanAdminText(item.addressLine1, 140), addressLine2: cleanAdminText(item.addressLine2, 140),
      suburb: cleanAdminText(item.suburb, 80), addressState: cleanAdminText(item.state, 10).toUpperCase(), postcode: cleanAdminText(item.postcode, 12),
    })).filter((item) => item.id && item.label && item.addressLine1);
    return adminJson({ ok: true, configured: true, suggestions });
  } catch { return adminJson({ ok: false, configured: true, suggestions: [], error: "Address suggestions are temporarily unavailable. Enter the address manually." }, 502); }
}
