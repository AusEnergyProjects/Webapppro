import {
  DEFAULT_TRADE_BRAND_THEME,
  TRADE_BRAND_THEME_OPTIONS,
  type TradeBrandThemeKey,
} from "@/lib/trade-business-branding";

export function tradeBusinessThemeGradient(themeKey?: TradeBrandThemeKey) {
  return TRADE_BRAND_THEME_OPTIONS[themeKey || DEFAULT_TRADE_BRAND_THEME].gradient;
}
