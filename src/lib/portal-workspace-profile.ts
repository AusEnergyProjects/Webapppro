import { DEFAULT_TRADE_BRAND_THEME, TRADE_BRAND_THEME_KEYS, type TradeBrandThemeKey } from "./trade-business-branding";

export type PortalWorkspace = "admin" | "creditex";
export type PortalWorkspaceProfile = { displayName: string; themeKey: TradeBrandThemeKey; colourMode: "day" | "night" };
export const DEFAULT_PORTAL_PROFILE: PortalWorkspaceProfile = { displayName: "", themeKey: DEFAULT_TRADE_BRAND_THEME, colourMode: "day" };

export function portalProfileInput(value: unknown): PortalWorkspaceProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!("displayName" in value) || !("themeKey" in value) || !("colourMode" in value)) return null;
  if (Object.keys(value).some((key) => !["displayName", "themeKey", "colourMode"].includes(key))) return null;
  if (typeof value.displayName !== "string" || typeof value.themeKey !== "string") return null;
  const displayName = value.displayName.trim();
  const themeKey = TRADE_BRAND_THEME_KEYS.find((key) => key === value.themeKey);
  if (!displayName || displayName.length > 120 || /[\u0000-\u001f\u007f]/.test(displayName) || !themeKey) return null;
  if (value.colourMode !== "day" && value.colourMode !== "night") return null;
  return { displayName, themeKey, colourMode: value.colourMode };
}
