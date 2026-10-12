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

function tokens(css, selector) {
  const result = {};
  postcss.parse(css).walkRules((rule) => {
    if (rule.parent.type === "atrule" || !rule.selectors.includes(selector)) return;
    rule.walkDecls((decl) => { if (decl.prop.startsWith("--")) result[decl.prop] = decl.value; });
  });
  return result;
}

function resolveToken(colour, style) {
  assert.equal(typeof colour, "string", "Every compliance surface/control must set its colour pair");
  const variable = colour.match(/^var\((--[\w-]+)(?:,\s*(.*))?\)$/);
  if (!variable) return colour.length === 4 ? `#${[...colour.slice(1)].map(char => char.repeat(2)).join("")}` : colour;
  return resolveToken(style[variable[1]] ?? variable[2], style);
}

const complianceCss = read("components/FormCompliancePanel.module.css");
for (const mode of ["day", "night"]) {
  for (const workspace of ["creditex", "trade"]) {
    test(`${mode} ${workspace} compliance questions, notes and buttons have readable colour pairs`, () => {
      const tradeStyle = tokens(read("app/protected-workspaces.css"), ".trade-portal-shell");
      if (mode === "night") Object.assign(tradeStyle, tokens(read("app/tlink-colour-mode.css"), 'html[data-tlink-colour-mode="night"] .trade-portal-shell'));
      const style = { ...(workspace === "creditex" ? palette(mode).style : tradeStyle), ...tokens(complianceCss, ".panel") };
      for (const selector of [".editorQuestion", ".reviewQuestion", ".source", ".linkedAnswer", ".queue article", ".panel header > span", ".panel input:not([type=checkbox])", ".panel textarea", ".panel button", ".panel button:global(.btn)", '.choices button[aria-pressed=true]']) {
        const foreground = resolveToken(value(complianceCss, selector, "color"), style);
        const background = resolveToken(value(complianceCss, selector, "background"), style);
        const ratio = contrast(foreground, background);
        assert.ok(ratio >= 4.5, `${selector}: ${foreground} on ${background} has ${ratio.toFixed(2)}:1 contrast`);
      }
      assert.equal(resolveToken(value(complianceCss, ".panel input:not([type=checkbox])", "background"), style), style[workspace === "creditex" ? "--portal-input" : "--trade-field"]);
      assert.doesNotMatch(complianceCss, /--tlink-(?:surface|border|text-primary)/, "Unowned theme tokens previously produced white cards with light text");
    });
  }
}

test("compliance inputs retain keyboard focus and the question layout fits narrow screens", () => {
  assert.equal(value(complianceCss, ".panel textarea", "field-sizing"), "content");
  assert.ok(parseFloat(value(complianceCss, ".panel button", "min-height")) >= 44);
  assert.ok(parseFloat(value(complianceCss, ".panel input:not([type=checkbox])", "min-height")) >= 44);
  assert.equal(value(complianceCss, ".panel label", "min-width"), "0");
  assert.match(value(complianceCss, ".panel :is(input, textarea, button):focus-visible", "outline"), /^3px solid /);
  const mobile = postcss.parse(complianceCss).nodes.find(node => node.type === "atrule" && node.name === "media" && node.params === "(max-width: 700px)");
  assert.ok(mobile);
  assert.equal(mobile.nodes.find(node => node.selector === ".editorQuestion").nodes.find(node => node.prop === "grid-template-columns").value, "1fr");
});

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
    const formCss = read("components/CreditexActivityWorkPackGovernance.module.css");
    const selectedView = '.masterLibrary .masterViewPicker > button[aria-pressed="true"]';
    const foreground = resolveToken(value(formCss, selectedView, "color"), style);
    const background = resolveToken(value(formCss, selectedView, "background"), style);
    assert.ok(contrast(foreground, background) >= 4.5, `${mode} selected form view contrast`);
  });
}

test("Team access inherits the portal palette without an independent dark canvas", () => {
  const css = read("components/CreditexOperationsWorkspace.module.css");
  assert.match(value(css, ".workspace", "background"), /^(transparent|var\(--portal-)/);
  for (const selector of [".dialog", ".memberCard", ".accessPolicy", ".empty", ".portalAccessPanel", ".fieldAccessPanel", ".permissionFields fieldset", ".memberTable th"]) {
    assert.match(value(css, selector, "background"), /^var\(--portal-/, selector);
  }
  assert.ok(parseFloat(value(css, ".localForm label", "font-size")) >= .8);
  assert.ok(parseFloat(value(css, ".localForm input", "min-height")) >= 44);
  for (const selector of [".localForm input", ".localForm select"]) {
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
