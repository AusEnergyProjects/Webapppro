/** Only the dedicated, website-restricted browser key may cross this boundary. */
export function tradeMapConfiguration(environment: Readonly<Record<string, unknown>>) {
  const apiKey = typeof environment.TLINK_GOOGLE_MAPS_BROWSER_KEY === "string"
    ? environment.TLINK_GOOGLE_MAPS_BROWSER_KEY.trim() : "";
  const mapId = typeof environment.TLINK_GOOGLE_MAPS_MAP_ID === "string"
    ? environment.TLINK_GOOGLE_MAPS_MAP_ID.trim() : "";
  const configured = Boolean(apiKey && mapId && mapId !== "DEMO_MAP_ID");
  return { configured, apiKey: configured ? apiKey : "", mapId: configured ? mapId : "" };
}

export function tlinkMapConfiguration(environment: Readonly<Record<string, unknown>>) {
  const apiKey = typeof environment.TLINK_MAPTILER_BROWSER_KEY === "string" ? environment.TLINK_MAPTILER_BROWSER_KEY.trim() : "";
  return { provider: "maptiler" as const, configured: Boolean(apiKey), apiKey };
}
