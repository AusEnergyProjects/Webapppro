import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import postcss from "postcss";
import ts from "typescript";

const read = (name) => fs.readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
function load(source, dependencies) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", code)((key) => {
    assert.ok(key in dependencies, `Unexpected dependency ${key}`);
    return dependencies[key];
  }, result, result.exports);
  return result.exports;
}
const branding = load(read("lib/trade-business-branding.ts"), {});
const profile = load(read("lib/portal-workspace-profile.ts"), { "./trade-business-branding": branding });
function palette(colourMode) {
  let stateIndex = 0;
  const react = {
    useState: (initial) => [stateIndex++ === 0 ? { identity: "creditex:tester", profile: { ...profile.DEFAULT_PORTAL_PROFILE, colourMode } } : initial, () => {}],
    useCallback: (callback) => callback,
    useRef: (current) => ({ current }),
    useEffect: () => {},
  };
  const loaded = load(read("components/PortalWorkspacePreferences.tsx"), {
    react, "react/jsx-runtime": {}, "@/lib/portal-workspace-profile": profile,
    "@/lib/trade-business-branding": branding, "./PortalWorkspacePreferences.module.css": {},
    "./PortalProfileAvatar": { PortalProfileAvatar: () => null },
  });
  return loaded.usePortalWorkspacePreferences({ workspace: "creditex", user: { uid: "tester" }, currentDisplayName: "Test" }).rootProps;
}
function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((channel) => parseInt(channel, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a, b) {
  const first = luminance(a), second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
function value(css, selector, property) {
  let result;
  postcss.parse(css).walkRules((rule) => {
    if (rule.parent.type === "atrule" || !rule.selectors.includes(selector)) return;
    rule.walkDecls(property, (decl) => { result = decl.value; });
  });
  return result;
}

for (const mode of ["day", "night"]) {
  test(`${mode} portal text, controls and status messages meet normal-text contrast`, () => {
    const { style, "data-portal-mode": selectedMode } = palette(mode);
    assert.equal(selectedMode, mode);
    for (const background of ["background", "surface", "soft", "raised", "input"]) {
      for (const foreground of ["ink", "text", "muted"]) {
        const ratio = contrast(style[`--portal-${foreground}`], style[`--portal-${background}`]);
        assert.ok(ratio >= 4.5, `${foreground} on ${background}: ${ratio.toFixed(2)}:1`);
      }
    }
    for (const state of ["selected", "success", "warning", "error"]) {
      assert.ok(contrast(style[`--portal-${state}-ink`], style[`--portal-${state}-bg`]) >= 4.5, state);
    }
    assert.ok(contrast(style["--portal-button-ink"], style["--portal-green"]) >= 4.5, "primary button");
    const queueCss = read("components/CreditexPlannedIntakeQueue.module.css");
    const resolveColour = (colour) => colour.replace(/^var\((--[\w-]+)\)$/, (_, token) => style[token]);
    for (const selector of [".controls button", '.filterDrawer button[type="submit"]']) {
      const foreground = resolveColour(value(queueCss, selector, "color"));
      const background = resolveColour(value(queueCss, selector, "background"));
      assert.ok(contrast(foreground, background) >= 4.5, `${mode} ${selector} contrast`);
    }
  });
}

test("Team access inherits the portal palette without an independent dark canvas", () => {
  const css = read("components/CreditexOperationsWorkspace.module.css");
  assert.match(value(css, ".workspace", "background"), /^(transparent|var\(--portal-)/);
  for (const selector of [".localForm", ".compactList article", ".accessPolicy", ".empty"]) {
    assert.match(value(css, selector, "background"), /^var\(--portal-/, selector);
  }
  assert.ok(parseFloat(value(css, ".localForm label", "font-size")) >= .8);
  assert.ok(parseFloat(value(css, ".localForm input", "min-height")) >= 44);
  for (const selector of [".localForm input", ".localForm select", ".memberAccessControls select"]) {
    assert.match(value(css, selector, "background"), /^var\(--portal-input/);
    assert.match(value(css, selector, "color"), /^var\(--portal-ink/);
  }
});

test("a prior TLink document mode cannot override Creditex's locally selected appearance", () => {
  const shell = read("components/CreditexCompliancePortal.module.css");
  assert.doesNotMatch(shell, /html\[data-tlink-colour-mode/);
  assert.doesNotMatch(read("components/CreditexActivityWorkPackGovernance.module.css"), /html\[data-tlink-colour-mode/);
  assert.equal(value(shell, ".shell", "display"), "flex");
  assert.equal(value(shell, ".shell", "flex-direction"), "column");
  assert.equal(value(shell, ".frame", "min-height"), "0");
});
