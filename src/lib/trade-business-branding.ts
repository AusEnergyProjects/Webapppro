export const TRADE_BRAND_THEME_KEYS = [
  "emerald_navy",
  "ocean_mint",
  "cobalt_aqua",
  "violet_sunset",
  "amber_ink",
  "charcoal_silver",
] as const;

export const TRADE_BRAND_BORDER_STYLES = [
  "soft",
  "square",
  "rounded",
] as const;

export type TradeBrandThemeKey = (typeof TRADE_BRAND_THEME_KEYS)[number];
export type TradeBrandBorderStyle = (typeof TRADE_BRAND_BORDER_STYLES)[number];

export const DEFAULT_TRADE_BRAND_THEME: TradeBrandThemeKey = "emerald_navy";
export const DEFAULT_TRADE_BRAND_BORDER: TradeBrandBorderStyle = "soft";
export const DEFAULT_QUOTE_EMAIL_SUBJECT =
  "{business_name} sent quote {quote_number}";
export const DEFAULT_QUOTE_EMAIL_INTRO =
  "Thank you for the opportunity to quote for your project. Review the scope, choices and total below.";

export const QUOTE_SUBJECT_PLACEHOLDERS = new Set([
  "business_name",
  "quote_number",
  "customer_name",
  "work_title",
]);
