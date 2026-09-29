const TLINK_ORIGIN = "https://ausenergyassessments.com";
const DEFAULT_CONTINUE = "/direct-trade/team";
const CONTINUE_PATHS = new Set([
  DEFAULT_CONTINUE,
  "/direct-trade/partners",
  "/direct-trade/dashboard",
  "/creditex/compliance",
  "/operations/control-centre",
]);

export function normalizeTLinkPasswordResetContinue(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || /[\\\u0000-\u001f\u007f]/.test(value)) return DEFAULT_CONTINUE;
  const input = value.trim();
  if (!input.startsWith("/") && !input.startsWith(`${TLINK_ORIGIN}/`)) return DEFAULT_CONTINUE;
  if (input.startsWith("//")) return DEFAULT_CONTINUE;
  try {
    const url = new URL(input, TLINK_ORIGIN);
    if (url.origin !== TLINK_ORIGIN || url.username || url.password || !CONTINUE_PATHS.has(url.pathname)) return DEFAULT_CONTINUE;
    const invite = url.searchParams.get("invite");
    if (url.pathname === DEFAULT_CONTINUE && invite && /^[A-Za-z0-9_-]{1,256}$/.test(invite)) {
      return `${DEFAULT_CONTINUE}?${new URLSearchParams({ invite })}`;
    }
    return url.pathname;
  } catch {
    return DEFAULT_CONTINUE;
  }
}
