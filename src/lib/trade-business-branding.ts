export const TRADE_BRAND_THEME_KEYS = [
  "emerald_navy",
  "ocean_mint",
  "cobalt_aqua",
  "violet_sunset",
  "amber_ink",
  "charcoal_silver",
  "rose_plum",
  "forest_jade",
  "bronze_olive",
  "midnight_rose",
  "teal_indigo",
  "graphite_copper",
  "indigo_orchid",
  "burgundy_slate",
] as const;

export const TRADE_BRAND_BORDER_STYLES = [
  "soft",
  "square",
  "rounded",
] as const;

export type TradeBrandThemeKey = (typeof TRADE_BRAND_THEME_KEYS)[number];
export type TradeBrandBorderStyle = (typeof TRADE_BRAND_BORDER_STYLES)[number];

export type TradeBrandThemeOption = {
  label: string;
  gradient: string;
  ink: "#ffffff";
};

export const TRADE_BRAND_THEME_OPTIONS: Record<
  TradeBrandThemeKey,
  TradeBrandThemeOption
> = {
  emerald_navy: {
    label: "Emerald navy",
    gradient: "linear-gradient(135deg, #062d3d 0%, #0d765f 100%)",
    ink: "#ffffff",
  },
  ocean_mint: {
    label: "Ocean mint",
    gradient: "linear-gradient(135deg, #0b405f 0%, #087966 100%)",
    ink: "#ffffff",
  },
  cobalt_aqua: {
    label: "Cobalt aqua",
    gradient: "linear-gradient(135deg, #16378b 0%, #08778b 100%)",
    ink: "#ffffff",
  },
  violet_sunset: {
    label: "Violet sunset",
    gradient: "linear-gradient(135deg, #4b2a84 0%, #b14f69 100%)",
    ink: "#ffffff",
  },
  amber_ink: {
    label: "Amber ink",
    gradient: "linear-gradient(135deg, #8a5306 0%, #162533 100%)",
    ink: "#ffffff",
  },
  charcoal_silver: {
    label: "Charcoal silver",
    gradient: "linear-gradient(135deg, #111827 0%, #4b5563 100%)",
    ink: "#ffffff",
  },
  rose_plum: {
    label: "Rose plum",
    gradient: "linear-gradient(135deg, #5a296f 0%, #b94767 100%)",
    ink: "#ffffff",
  },
  forest_jade: {
    label: "Forest jade",
    gradient: "linear-gradient(135deg, #123d2d 0%, #17725f 100%)",
    ink: "#ffffff",
  },
  bronze_olive: {
    label: "Bronze olive",
    gradient: "linear-gradient(135deg, #6b4108 0%, #4d6120 100%)",
    ink: "#ffffff",
  },
  midnight_rose: {
    label: "Midnight rose",
    gradient: "linear-gradient(135deg, #121942 0%, #9d3f61 100%)",
    ink: "#ffffff",
  },
  teal_indigo: {
    label: "Teal indigo",
    gradient: "linear-gradient(135deg, #075b58 0%, #34479a 100%)",
    ink: "#ffffff",
  },
  graphite_copper: {
    label: "Graphite copper",
    gradient: "linear-gradient(135deg, #25262b 0%, #954326 100%)",
    ink: "#ffffff",
  },
  indigo_orchid: {
    label: "Indigo orchid",
    gradient: "linear-gradient(135deg, #31317a 0%, #824091 100%)",
    ink: "#ffffff",
  },
  burgundy_slate: {
    label: "Burgundy slate",
    gradient: "linear-gradient(135deg, #6b2038 0%, #34495e 100%)",
    ink: "#ffffff",
  },
};

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
