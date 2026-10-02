import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const read = path => fs.readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const text = node => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join(" ") : text(node.props?.children);
const nodes = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
const button = (tree, label) => nodes(tree, node => node.type === "button" && text(node) === label)[0];
const labelled = (tree, label) => nodes(tree, node => node.props?.["aria-label"] === label)[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const css = { default: new Proxy({}, { get: (_, key) => String(key) }) };

function load(path, dependencies, environment = {}) {
  const source = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(environment), source)(key => {
    assert.ok(key in dependencies, `Unexpected dependency ${key}`);
    return dependencies[key];
  }, result, result.exports, ...Object.values(environment));
  return result.exports;
}

function hooksHarness() {
  const slots = [], effects = [], queued = [];
  let cursor = 0;
  const changed = (first, second) => !first || first.length !== second.length || second.some((value, index) => !Object.is(value, first[index]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useCallback(callback, deps) {
      const index = cursor++;
      if (changed(slots[index]?.deps, deps)) slots[index] = { deps, callback };
      return slots[index].callback;
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!changed(effects[index]?.deps, deps)) return;
      effects[index]?.cleanup?.();
      effects[index] = { deps };
      queued.push(() => { effects[index].cleanup = callback(); });
    },
  };
  return {
    hooks,
    begin() { cursor = 0; },
    commit() { for (const callback of queued.splice(0)) callback(); },
    cleanup() { for (const effect of effects) effect?.cleanup?.(); },
  };
}

function headerHarness() {
  const h = hooksHarness(), listeners = new Map(), properties = new Map(), observers = [], searches = [], saved = [];
  const calls = { notifications: 0, settings: 0, profile: 0, signOut: 0, focus: 0, select: 0 };
  const input = { focus() { calls.focus++; }, select() { calls.select++; } };
  const shell = { style: { setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key) } };
  const header = { offsetHeight: 96, closest(selector) { assert.equal(selector, "[data-portal-theme]"); return shell; } };
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  }
  const props = {
    context: "Compliance workspace", organisation: "Creditex", displayName: "Named reviewer",
    preferences: { profile: { displayName: "Named reviewer", themeKey: "indigo_orchid", colourMode: "day" }, loading: false, savingProfile: false, error: "", saveProfile: async value => { saved.push(value); return true; } },
    onSearch: query => { searches.push(query); return true; }, onNotifications: () => { calls.notifications++; }, onProfile: () => { calls.profile++; },
    onSettings: () => { calls.settings++; }, onSignOut: () => { calls.signOut++; },
  };
  const loaded = load("components/PortalWorkspaceHeader.tsx", {
    react: h.hooks, "react/jsx-runtime": jsx, "next/image": { default: () => null },
    "./TLinkChrome": { AeaProductLink: () => null, TLinkBrand: () => null }, "./PortalWorkspaceHeader.module.css": css,
    "./PortalProfileAvatar": { PortalProfileAvatar: () => null },
  }, { window: { addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener: (type, callback) => { if (listeners.get(type) === callback) listeners.delete(type); } }, ResizeObserver });
  const render = () => {
    h.begin();
    const tree = loaded.PortalWorkspaceHeader(props);
    for (const node of nodes(tree, value => value.props?.ref)) node.props.ref.current = node.type === "header" ? header : input;
    h.commit();
    return tree;
  };
  return { props, render, listeners, properties, observers, searches, saved, calls, header, cleanup: h.cleanup };
}

test("header search trims submitted queries and Ctrl-K focuses without leaking listeners", () => {
  const h = headerHarness(); let tree = h.render();
  labelled(tree, "Search jobs and customers").props.onChange({ target: { value: "  Laura 123 Fake Street  " } });
  tree = h.render();
  let prevented = 0;
  labelled(tree, "Search workspace jobs").props.onSubmit({ preventDefault: () => { prevented++; } });
  assert.deepEqual(h.searches, ["Laura 123 Fake Street"]);
  assert.equal(prevented, 1);
  const keydown = h.listeners.get("keydown");
  for (const modifier of [{ ctrlKey: true, metaKey: false, key: "k" }, { ctrlKey: false, metaKey: true, key: "K" }]) keydown({ ...modifier, preventDefault: () => { prevented++; } });
  keydown({ ctrlKey: false, metaKey: false, key: "k", preventDefault: () => { prevented++; } });
  keydown({ ctrlKey: true, metaKey: false, key: "j", preventDefault: () => { prevented++; } });
  assert.equal(h.calls.focus, 2);
  assert.equal(h.calls.select, 2);
  assert.equal(prevented, 3);
  h.render();
  assert.equal(h.listeners.get("keydown"), keydown);
  h.cleanup();
  assert.equal(h.listeners.size, 0);
});

test("header measures wrapping height for the sidebar and removes observer state on unmount", () => {
  const h = headerHarness(); h.render();
  assert.equal(h.properties.get("--portal-header-height"), "96px");
  assert.equal(h.observers.length, 1);
  assert.equal(h.observers[0].target, h.header);
  h.header.offsetHeight = 168;
  h.observers[0].callback();
  assert.equal(h.properties.get("--portal-header-height"), "168px");
  h.render();
  assert.equal(h.observers.length, 1);
  h.cleanup();
  assert.equal(h.observers[0].disconnected, true);
  assert.equal(h.properties.has("--portal-header-height"), false);
});

test("mode toggle preserves the personal name and palette and is disabled while loading or saving", () => {
  const h = headerHarness(); let tree = h.render();
  let toggle = labelled(tree, "Night mode");
  assert.equal(toggle.props["aria-pressed"], false);
  toggle.props.onClick();
  assert.deepEqual(h.saved, [{ displayName: "Named reviewer", themeKey: "indigo_orchid", colourMode: "night" }]);
  h.props.preferences.profile = h.saved[0];
  tree = h.render(); toggle = labelled(tree, "Night mode");
  assert.equal(toggle.props["aria-pressed"], true);
  assert.equal(toggle.props.title, "Switch to day mode");
  toggle.props.onClick();
  assert.deepEqual(h.saved[1], { displayName: "Named reviewer", themeKey: "indigo_orchid", colourMode: "day" });
  h.props.preferences.savingProfile = true;
  assert.equal(labelled(h.render(), "Night mode").props.disabled, true);
  h.props.preferences.savingProfile = false; h.props.preferences.loading = true;
  assert.equal(labelled(h.render(), "Night mode").props.disabled, true);
  h.props.preferences.loading = false;
  assert.equal(labelled(h.render(), "Night mode").props.disabled, false);
  h.cleanup();
});

test("header opens real notifications, counted inbox and separate profile and workspace settings callbacks", () => {
  const h = headerHarness(); let tree = h.render();
  assert.match(text(tree).replace(/\s+/g, " "), /Working with Creditex.*Welcome Named reviewer/);
  labelled(tree, "Open notifications").props.onClick();
  assert.equal(h.calls.notifications, 1);
  h.props.notificationCount = 0; tree = h.render();
  assert.equal(nodes(labelled(tree, "Open inbox, 0 unread alerts"), node => node.type === "strong").length, 0);
  h.props.notificationCount = 7; tree = h.render();
  const inbox = labelled(tree, "Open inbox, 7 unread alerts");
  assert.equal(text(nodes(inbox, node => node.type === "strong")[0]), "7");
  inbox.props.onClick();
  labelled(tree, "Workspace settings").props.onClick();
  button(tree, "Sign out").props.onClick();
  assert.equal(h.calls.notifications, 2); assert.equal(h.calls.settings, 1); assert.equal(h.calls.signOut, 1);
  nodes(tree, node => node.type === "button" && text(node).trim() === "My profile")[0].props.onClick(); assert.equal(h.calls.profile, 1);
  const app = nodes(tree, node => node.type === "a" && node.props.href === "/direct-trade/field-app")[0];
  assert.match(text(app), /Get the app/);
  h.props.preferences.error = "Appearance could not be saved.";
  tree = h.render();
  const alert = nodes(tree, node => node.props?.role === "alert")[0];
  assert.match(text(alert), /Appearance could not be saved/);
  button(alert, "Open settings").props.onClick();
  assert.equal(h.calls.settings, 2);
  h.cleanup();
});

function preferencesHarness() {
  const h = hooksHarness(), requests = [], timers = new Map(), updated = [];
  let timerId = 0;
  const branding = load("lib/trade-business-branding.ts", {});
  const pure = load("lib/portal-workspace-profile.ts", { "./trade-business-branding": branding });
  const props = { workspace: "creditex", user: { uid: "reviewer-1", getIdToken: async () => "verified-token" }, currentDisplayName: "Named reviewer", onProfileChanged: value => updated.push(value) };
  const loaded = load("components/PortalWorkspacePreferences.tsx", {
    react: h.hooks, "react/jsx-runtime": jsx, "@/lib/trade-business-branding": branding,
    "@/lib/portal-workspace-profile": pure, "./PortalWorkspacePreferences.module.css": css,
    "./PortalProfileAvatar": { PortalProfileAvatar: () => null },
  }, {
    window: { setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id) },
    fetch: (path, init) => new Promise(resolve => requests.push({ path, init, respond(data, status = 200) { resolve({ ok: status < 400, status, json: async () => data }); } })),
  });
  return { props, requests, updated, render() { h.begin(); const result = loaded.usePortalWorkspacePreferences(props); h.commit(); return result; }, cleanup: h.cleanup };
}

test("actual preferences reject duplicate saves immediately and recover after a failed save", async () => {
  const h = preferencesHarness(); let preferences = h.render();
  const profile = { displayName: "Team reviewer", themeKey: "indigo_orchid", colourMode: "night" };
  const first = preferences.saveProfile(profile);
  assert.equal(await preferences.saveProfile({ ...profile, colourMode: "day" }), false);
  preferences = h.render(); assert.equal(preferences.savingProfile, true);
  await flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].init.method, "PATCH");
  assert.equal(h.requests[0].init.headers.Authorization, "Bearer verified-token");
  assert.deepEqual(JSON.parse(h.requests[0].init.body), profile);
  h.requests[0].respond({ error: "Please retry your appearance change." }, 503);
  assert.equal(await first, false);
  preferences = h.render();
  assert.equal(preferences.savingProfile, false);
  assert.match(preferences.error, /Please retry/);
  assert.equal(h.updated.length, 0);
  const retry = preferences.saveProfile(profile); await flush();
  assert.equal(h.requests.length, 2);
  h.requests[1].respond({ profile });
  assert.equal(await retry, true);
  preferences = h.render();
  assert.deepEqual(preferences.profile, profile);
  assert.equal(preferences.savingProfile, false);
  assert.equal(preferences.error, "");
  assert.deepEqual(h.updated, [profile]);
  h.cleanup();
});

test("a save response from the previous member never changes the newly signed-in profile", async () => {
  const h = preferencesHarness(); const preferences = h.render();
  const profile = { displayName: "Old reviewer", themeKey: "indigo_orchid", colourMode: "night" };
  const saved = preferences.saveProfile(profile); await flush();
  h.props.user = { uid: "reviewer-2", getIdToken: async () => "second-token" };
  h.props.currentDisplayName = "New reviewer";
  assert.equal(h.render().profile.displayName, "New reviewer");
  h.requests[0].respond({ profile });
  assert.equal(await saved, false);
  assert.equal(h.render().profile.displayName, "New reviewer");
  assert.equal(h.updated.length, 0);
  h.cleanup();
});
