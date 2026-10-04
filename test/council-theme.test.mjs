import assert from "node:assert/strict";
import test from "node:test";
import { councilContrast, councilThemeVariables, COUNCIL_THEME_PRESETS } from "../src/lib/council-theme.ts";

test("council custom themes retain readable foregrounds in day and night", () => {
  for (const primaryColor of ["#ffffff", "#000000", "#ffff00", "#ff00ff", ...COUNCIL_THEME_PRESETS.map(theme => theme.primaryColor)]) {
    for (const accentColor of ["#ffffff", "#000000", "#ffff00", "#ff0000", ...COUNCIL_THEME_PRESETS.map(theme => theme.accentColor)]) {
      for (const mode of ["day", "night"]) {
        const tokens = councilThemeVariables({ primaryColor, accentColor }, mode);
        for (const key of ["--c-sidebar", "--c-button", "--c-header-start", "--c-header-end"]) assert.ok(councilContrast(tokens[key], "#ffffff") >= 4.5, `${mode} ${key} ${primaryColor} ${accentColor}`);
        for (const background of ["--c-surface", "--c-soft", "--c-accent-soft"]) {
          for (const foreground of ["--c-ink", "--c-muted", "--c-accent"]) assert.ok(councilContrast(tokens[foreground], tokens[background]) >= 4.5, `${mode} ${foreground}/${background} ${primaryColor} ${accentColor}`);
        }
      }
    }
  }
});
