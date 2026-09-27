import test from "node:test";
import assert from "node:assert/strict";
import { createMapNavigationGuard } from "../src/lib/trade-map-navigation.ts";

test("workspace and related target remain unchanged until map save completes", async () => {
  const guard = createMapNavigationGuard(); let release;
  guard.register(() => new Promise(resolve => { release = resolve; }));
  let workspace = "map", target = "old";
  const navigation = guard.run(() => { workspace = "work"; target = "jobs"; });
  assert.equal(workspace, "map"); assert.equal(target, "old");
  release(); assert.equal(await navigation, true);
  assert.equal(workspace, "work"); assert.equal(target, "jobs");
});

test("a failed autosave blocks navigation and a retry can then leave normally", async () => {
  const guard = createMapNavigationGuard(); let workspace = "map";
  guard.register(async () => { throw new Error("offline"); });
  assert.equal(await guard.run(() => { workspace = "finance"; }), false);
  assert.equal(workspace, "map");
  guard.register(async () => {});
  assert.equal(await guard.run(() => { workspace = "finance"; }), true);
  assert.equal(workspace, "finance");
});

test("ordinary navigation remains synchronous and auth reset cancels pending navigation", async () => {
  const guard = createMapNavigationGuard(); let value = "work", release;
  const normal = guard.run(() => { value = "map"; });
  assert.equal(value, "map"); assert.equal(await normal, true);
  guard.register(() => new Promise(resolve => { release = resolve; }));
  const pending = guard.run(() => { value = "old-account-job"; });
  guard.reset(); release();
  assert.equal(await pending, false); assert.equal(value, "map");
});
