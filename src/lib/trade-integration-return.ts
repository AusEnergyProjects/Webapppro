export const INTEGRATION_RETURN_PROVIDERS = [
  "xero",
  "myob",
  "quickbooks",
  "stripe",
  "square",
  "google_calendar",
  "microsoft_calendar",
] as const;

export type IntegrationReturnProvider = typeof INTEGRATION_RETURN_PROVIDERS[number];
export type CalendarIntegrationProvider = Extract<IntegrationReturnProvider, "google_calendar" | "microsoft_calendar">;
export type IntegrationReturnStatus = "connected" | "cancelled" | "failed";
export type IntegrationReturn = {
  provider: IntegrationReturnProvider;
  status: IntegrationReturnStatus;
};

export function readIntegrationReturn(search: string): IntegrationReturn | null {
  const parameters = new URLSearchParams(search);
  const provider = parameters.get("integration");
  const status = parameters.get("integration_status");
  if (!provider || !(INTEGRATION_RETURN_PROVIDERS as readonly string[]).includes(provider)) return null;
  if (status !== "connected" && status !== "cancelled" && status !== "failed") return null;
  return { provider: provider as IntegrationReturnProvider, status };
}

export function isCalendarIntegration(provider: IntegrationReturnProvider): provider is CalendarIntegrationProvider {
  return provider === "google_calendar" || provider === "microsoft_calendar";
}

export function integrationProviderLabel(provider: IntegrationReturnProvider) {
  const labels: Record<IntegrationReturnProvider, string> = {
    xero: "Xero",
    myob: "MYOB",
    quickbooks: "QuickBooks",
    stripe: "Stripe",
    square: "Square",
    google_calendar: "Google Calendar",
    microsoft_calendar: "Outlook Calendar",
  };
  return labels[provider];
}

export function clearIntegrationReturnFromAddress() {
  const url = new URL(window.location.href);
  url.searchParams.delete("integration");
  url.searchParams.delete("integration_status");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}
