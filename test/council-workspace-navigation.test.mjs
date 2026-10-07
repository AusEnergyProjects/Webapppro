import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transformSync } from "esbuild";
import * as navigation from "../src/lib/council-workspace-navigation.ts";

const allPanels = { community: true, map: true, calculator: true, team: true, wattzun: true };
test("Council panel links use an exact allowlist and cannot select a council, role or creation action", () => {
  for (const view of ["overview", "community", "map", "calculator", "activities", "economy", "campaigns", "sessions", "reports", "settings", "team", "wattzun"]) {
    assert.equal(navigation.councilWorkspaceFromSearch(`?workspace=${view}&councilId=other&role=owner&create=true`, allPanels), view);
  }
  for (const search of ["", "?workspace=Reports", "?workspace=reports&workspace=team", "?workspace=__proto__", "?workspace=constructor", "?workspace=https://outside.test", "?workspace=reports%00", "?view=reports"]) {
    assert.equal(navigation.councilWorkspaceFromSearch(search, allPanels), "overview", search);
  }
});

test("unavailable panels and demonstration Wattzun links fall back without exposing tools", () => {
  for (const panel of Object.keys(allPanels)) assert.equal(navigation.councilWorkspaceFromSearch(`?workspace=${panel}`, { ...allPanels, [panel]: false }), "overview");
  assert.equal(navigation.councilWorkspaceFromSearch("?workspace=reports", { community: false, map: false, calculator: false, team: false, wattzun: false }), "reports");
});

test("panel navigation preserves existing query context without duplicated workspace selectors", () => {
  const params = new URLSearchParams(navigation.councilWorkspaceSearch("?campaign=reference&workspace=map&workspace=team", "reports"));
  assert.deepEqual(params.getAll("workspace"), ["reports"]);
  assert.equal(params.get("campaign"), "reference");
});

const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "Fragment" };
const css = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
function compile(file, dependencies, globals = {}) {
  const code = transformSync(readFileSync(new URL(file, import.meta.url), "utf8"), { loader: "tsx", format: "cjs", target: "es2022", jsx: "automatic" }).code;
  const record = { exports: {} };
  Function("require", "module", "exports", ...Object.keys(globals), code)(id => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency ${id}`); return dependencies[id];
  }, record, record.exports, ...Object.values(globals));
  return record.exports;
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function fixture({ mode = "live", user = { uid: "staff-a" }, mismatchedProfile = false, search = "?workspace=reports" } = {}) {
  const values = [], effects = [], frames = new Map(), listeners = new Map(), requests = [], history = [];
  let stateIndex = 0, frameId = 0;
  const react = { useState: initial => {
    const index = stateIndex++; if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial;
    return [values[index], value => { values[index] = typeof value === "function" ? value(values[index]) : value; }];
  }, useRef: value => ({ current: value }), useEffect: effect => effects.push(effect) };
  const window = { location: { search, pathname: "/council", hash: "#report" },
    history: { state: { preserved: true }, pushState(state, _title, href) {
      history.push({ state, href }); const url = new URL(href, "https://fixture.invalid"); window.location.search = url.search;
    } }, addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); },
    dispatchEvent: event => listeners.get(event.type)?.(event), scrollTo() {} };
  const globals = { window, requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; }, cancelAnimationFrame: id => frames.delete(id), PopStateEvent: Event };
  const report = { mode, scope: { councilId: "council-a", name: "Fixture Council", postcodes: ["3805"] }, period: { key: "year", label: "This year" },
    generatedAt: "2026-10-07T00:00:00Z", dataQuality: { suppressed: true } };
  const profile = { councilId: mismatchedProfile ? "other" : "council-a", name: "Fixture Council", state: "VIC", postcodes: ["3805"], logoDataUrl: null,
    theme: { primaryColor: "#032733", accentColor: "#0b765d" } };
  const analytics = Object.fromEntries(["CouncilActivities", "CouncilAttribution", "CouncilEnquiries", "CouncilLocalShare", "CouncilPostcodes", "CouncilReports", "CouncilSummary", "CouncilTrend"].map(name => [name, name]));
  const dependencies = { react, "react/jsx-runtime": jsx, "next/image": { default: "Image" },
    "@/lib/council-theme": { councilThemeVariables: () => ({}) }, "@/lib/trade-device-client": {},
    "../TLinkChrome": { TLinkMark: "TLinkMark" }, "./CouncilAnalytics": analytics, "./CouncilCampaigns": { CouncilCampaigns: "CouncilCampaigns" },
    "./CouncilPrimitives": { CouncilIcon: "Icon", CouncilPanel: "Panel", councilDateTime: value => value, councilNumber: value => value },
    "./CouncilProfileSettings": { CouncilProfileSettings: "CouncilProfileSettings" }, "./CouncilWorkspace.module.css": css,
    "../TLinkWorkspaceBar": { TLinkWorkspaceBar: "WorkspaceBar" }, "../WattzunToolsWorkspace": { WattzunToolsWorkspace: "WattzunToolsWorkspace" },
    "../TLinkNavigationIcon": { TLinkNavigationIcon: "NavigationIcon" }, "@/lib/council-workspace-navigation": navigation,
    "@/lib/wattzun-appearance": { requestWattzunAssistant: async request => { requests.push(request); return true; } } };
  const component = compile("../src/components/council/CouncilWorkspace.tsx", dependencies, globals).CouncilWorkspace;
  const props = { report, profile, campaigns: [], canManage: false, portalUser: user, onRefresh() {}, onPeriodChange() {}, onSaveCampaign() {}, onSaveProfile() {}, onExport() {} };
  const render = () => { stateIndex = 0; effects.length = 0; return component(props); };
  const flushFrames = () => { const current = [...frames.values()]; frames.clear(); current.forEach(callback => callback()); };
  return { values, effects, frames, listeners, requests, history, window, props, render, flushFrames };
}

test("actual Council workspace applies initial and popstate report links and removes its navigation listener", () => {
  const f = fixture(); f.render(); const cleanup = f.effects[0](); f.flushFrames();
  assert.equal(f.values[0], "reports");
  f.window.location.search = "?workspace=campaigns&role=owner&create=true"; f.window.dispatchEvent(new Event("popstate"));
  const tree = f.render(); assert.equal(f.values[0], "campaigns"); assert.equal(f.values[1], false, "A panel link never opens a new-record editor");
  const campaigns = nodes(tree).find(node => node.type === "CouncilCampaigns"); assert.equal(campaigns.props.canManage, false);
  f.window.location.search = "?workspace=wattzun"; f.window.dispatchEvent(new Event("popstate")); assert.equal(f.values[0], "wattzun");
  cleanup(); assert.equal(f.listeners.has("popstate"), false);
});

test("demonstration campaign links remain selected when campaigns or available panels arrive", () => {
  for (const [kind, view] of [["campaign", "campaigns"], ["session", "sessions"]]) {
    const f = fixture({ mode: "demonstration", search: "?campaign=known-campaign" });
    f.render(); f.effects[0](); f.flushFrames(); assert.equal(f.values[0], "overview", "Unknown references do not select a panel");
    f.props.campaigns = [{ id: "known-campaign", kind }];
    f.render(); f.effects[0](); f.flushFrames(); assert.equal(f.values[0], view);
    f.props.communitySlot = "Community";
    f.render(); f.effects[0](); f.flushFrames(); assert.equal(f.values[0], view, "Availability changes do not reset the linked campaign");
    f.window.location.search = "?campaign=known-campaign&workspace=reports";
    f.window.dispatchEvent(new Event("popstate")); assert.equal(f.values[0], "reports", "Explicit panels take priority");
    f.window.location.search = "?campaign=known-campaign";
    f.window.dispatchEvent(new Event("popstate")); assert.equal(f.values[0], view);
  }
  const live = fixture({ search: "?campaign=known-campaign" }); live.props.campaigns = [{ id: "known-campaign", kind: "campaign" }];
  live.render(); live.effects[0](); live.flushFrames(); assert.equal(live.values[0], "overview", "Live council campaign identities are never selected by this demo route");
});

test("actual Council navigation changes only the panel and retains unsaved profile guards and preview", () => {
  const f = fixture(); f.render(); f.values[3] = { ...f.props.profile, name: "Unsaved Council", theme: f.props.profile.theme };
  const tree = f.render();
  const reportButton = nodes(tree).find(node => node.type === "button" && node.props.children?.[1] === "Reports & insights");
  assert.ok(reportButton); reportButton.props.onClick();
  assert.equal(f.values[0], "reports"); assert.equal(f.values[3].name, "Unsaved Council");
  assert.equal(f.history.at(-1).href, "/council?workspace=reports#report");
  assert.deepEqual(f.history.at(-1).state, { preserved: true });
  const bar = nodes(tree).find(node => node.type === "WorkspaceBar"); let prompts = 0;
  f.window.confirm = () => { prompts++; return false; };
  assert.equal(bar.props.onBeforeSwitch(), false); assert.equal(prompts, 1, "Leaving the council retains the unsaved-profile confirmation");
});

test("Ask Wattzun opens a message with only the current Council report reference", async () => {
  const f = fixture(); f.render(); f.values[0] = "reports";
  const report = nodes(f.render()).find(node => node.type === "CouncilReports"); await report.props.onAskWattzun();
  assert.deepEqual(f.requests, [{ userUid: "staff-a", portal: "council", scopeId: "council-a", mode: "message",
    workReference: { kind: "council_report", period: "year" }, initialMessage: "Explain this report, its coverage and the main next steps." }]);
  assert.equal(Object.hasOwn(f.requests[0], "facts"), false);
});

test("report assistant entry is absent for demonstrations, missing identity or mismatched Council profile", () => {
  for (const options of [{ mode: "demonstration" }, { user: null }, { mismatchedProfile: true }]) {
    const f = fixture(options); f.render(); f.values[0] = "reports";
    const report = nodes(f.render()).find(node => node.type === "CouncilReports"); assert.equal(report.props.onAskWattzun, undefined);
  }
});

test("actual report component exposes an explicit assistant action only when authorised by its workspace", () => {
  const { CouncilReports } = compile("../src/components/council/CouncilAnalytics.tsx", { react: {}, "react/jsx-runtime": jsx,
    "./CouncilWorkspace.module.css": css, "./CouncilPrimitives": { councilDate: value => value, councilDateTime: value => value } }, { window: { print() {} } });
  const report = { scope: { name: "Fixture Council" }, period: { key: "year", label: "This year", start: "2026-01-01", end: "2026-10-07" },
    dataQuality: { minimumCohort: 5, missingCarbonMethod: true }, activities: [], postcodes: [], methodology: [] };
  let called = 0; const callback = () => { called++; };
  const tree = CouncilReports({ report, onExport() {}, onAskWattzun: callback });
  const button = nodes(tree).find(node => node.type === "button" && node.props.children === "Ask Wattzun about this report");
  assert.ok(button); button.props.onClick(); assert.equal(called, 1);
  assert.match(button.props.className, /printHidden/);
  assert.equal(nodes(CouncilReports({ report, onExport() {} })).filter(node => node.type === "button" && node.props.children === "Ask Wattzun about this report").length, 0);
});
