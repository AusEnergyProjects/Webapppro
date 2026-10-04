export type CouncilTheme = { primaryColor: string; accentColor: string };

export const COUNCIL_THEME_PRESETS = [
  { name: "TLink", primaryColor: "#032733", accentColor: "#0b765d" },
  { name: "Ocean", primaryColor: "#123c60", accentColor: "#007b91" },
  { name: "Forest", primaryColor: "#193d30", accentColor: "#477c37" },
  { name: "Plum", primaryColor: "#422d58", accentColor: "#92548c" },
] as const;

function channels(hex: string) {
  const safe = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#0b765d";
  return [1, 3, 5].map(offset => parseInt(safe.slice(offset, offset + 2), 16));
}

function mix(first: string, second: string, amount: number) {
  const other = channels(second);
  return `#${channels(first).map((value, index) => Math.round(value + (other[index] - value) * amount).toString(16).padStart(2, "0")).join("")}`;
}

function luminance(hex: string) {
  const linear = channels(hex).map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; });
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}

export function councilContrast(first: string, second: string) {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

function readable(color: string, background: string, target: "#ffffff" | "#000000", minimum = 4.5) {
  for (let step = 0; step <= 100; step++) {
    const candidate = mix(color, target, step / 100);
    if (councilContrast(candidate, background) >= minimum) return candidate;
  }
  return target;
}

/** Derive readable local tokens even when a council chooses very light or dark colours. */
export function councilThemeVariables(theme: CouncilTheme, mode: "day" | "night"): Record<`--c-${string}`, string> {
  const night = mode === "night";
  const sidebar = readable(theme.primaryColor, "#ffffff", "#000000", 9);
  const button = readable(theme.accentColor, "#ffffff", "#000000", 5);
  const surface = night ? mix(theme.primaryColor, "#101b22", .9) : "#ffffff";
  const soft = night ? mix(theme.primaryColor, "#182a31", .85) : mix(theme.primaryColor, "#ffffff", .97);
  const accentSoft = night ? mix(theme.accentColor, "#14232b", .88) : mix(theme.accentColor, "#ffffff", .93);
  const accentBackground = [surface, soft, accentSoft].sort((first, second) => night ? luminance(second) - luminance(first) : luminance(first) - luminance(second))[0];
  const accent = readable(theme.accentColor, accentBackground, night ? "#ffffff" : "#000000", 5);
  return {
    "--c-ink": night ? "#edf3f2" : "#173336", "--c-muted": night ? "#b0c4c0" : "#516864",
    "--c-accent": accent, "--c-line": night ? "#344c50" : "#d5e4df",
    "--c-page": night ? mix(theme.primaryColor, "#081319", .94) : mix(theme.primaryColor, "#ffffff", .96),
    "--c-surface": surface, "--c-soft": soft, "--c-accent-soft": accentSoft,
    "--c-field": night ? "#0b1a20" : "#ffffff", "--c-chart": accent,
    "--c-sidebar": sidebar, "--c-nav-active": mix(sidebar, button, .4), "--c-button": button,
    "--c-button-ink": "#ffffff", "--c-button-hover": mix(button, "#000000", .15), "--c-header-start": readable(theme.primaryColor, "#ffffff", "#000000", 7),
    "--c-header-end": button,
  };
}
