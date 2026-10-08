import { TRADE_BRAND_THEME_KEYS, type TradeBrandThemeKey } from "./trade-business-branding";

export type TradePersonalAppearance = { colourMode: "day" | "night"; themeKey: TradeBrandThemeKey | null };
export const DEFAULT_TRADE_PERSONAL_APPEARANCE: TradePersonalAppearance = { colourMode: "day", themeKey: null };

export function tradePersonalAppearanceStorageKey(userUid: string, ownerUid: string): string | null {
  if (!userUid || !ownerUid) return null;
  return `tlink-personal-appearance:v1:${encodeURIComponent(userUid)}:${encodeURIComponent(ownerUid)}`;
}

export function readTradePersonalAppearance(storage: Pick<Storage, "getItem"> | null, key: string | null): { appearance: TradePersonalAppearance; storageAvailable: boolean } {
  const fallback = { ...DEFAULT_TRADE_PERSONAL_APPEARANCE };
  if (!storage || !key) return { appearance: fallback, storageAvailable: false };
  let raw: string | null;
  try { raw = storage.getItem(key); } catch { return { appearance: fallback, storageAvailable: false }; }
  if (raw) {
    try {
      const value: unknown = JSON.parse(raw);
      if (value && typeof value === "object" && "colourMode" in value && "themeKey" in value
        && (value.colourMode === "day" || value.colourMode === "night")
        && (value.themeKey === null || TRADE_BRAND_THEME_KEYS.some(theme => theme === value.themeKey))) {
        const themeKey = TRADE_BRAND_THEME_KEYS.find(theme => theme === value.themeKey) ?? null;
        return { appearance: { colourMode: value.colourMode, themeKey }, storageAvailable: true };
      }
    } catch { /* An invalid saved preference uses the business default. */ }
  }
  return { appearance: fallback, storageAvailable: true };
}

export function writeTradePersonalAppearance(storage: Pick<Storage, "setItem"> | null, key: string | null, appearance: TradePersonalAppearance): boolean {
  if (!storage || !key) return false;
  try { storage.setItem(key, JSON.stringify(appearance)); return true; } catch { return false; }
}
