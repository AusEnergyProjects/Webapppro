import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { tradeMapConfiguration } from "../src/lib/trade-map-configuration.ts";

test("map configuration exposes only the dedicated browser key and owned map ID", () => {
  assert.deepEqual(tradeMapConfiguration({
    TLINK_GOOGLE_MAPS_BROWSER_KEY: " browser-key ", TLINK_GOOGLE_MAPS_MAP_ID: " owned-map ",
    TLINK_ADDRESS_AUTOCOMPLETE_TOKEN: "server-secret", GOOGLE_CALENDAR_CLIENT_SECRET: "oauth-secret",
  }), { configured: true, apiKey: "browser-key", mapId: "owned-map" });
});

test("missing configuration never falls back to private address lookup credentials", () => {
  for (const configuration of [
    {}, { TLINK_ADDRESS_AUTOCOMPLETE_TOKEN: "server-secret" },
    { TLINK_GOOGLE_MAPS_BROWSER_KEY: "browser-key" },
    { TLINK_GOOGLE_MAPS_MAP_ID: "owned-map" },
    { TLINK_GOOGLE_MAPS_BROWSER_KEY: "browser-key", TLINK_GOOGLE_MAPS_MAP_ID: "DEMO_MAP_ID" },
  ]) assert.deepEqual(tradeMapConfiguration(configuration), { configured: false, apiKey: "", mapId: "" });
});

test("map configuration route requires trade access and returns uncached responses", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const stubs = {
    "@/lib/trade-team-server": `let denied = false; let calls = 0;
      export function denyAccess(value) { denied = value; }
      export function accessCalls() { return calls; }
      export async function requireInstallerTeamAccess() { calls++; if (denied) throw new Error('AUTH_REQUIRED'); }`,
    "@/lib/admin-server": `export function adminJson(body, status = 200) { return Response.json(body, {status, headers:{'Cache-Control':'no-store'}}); }
      export function mfaErrorResponse() { return null; }
      export function sameOrigin(request) { return !request.headers.get('origin') || request.headers.get('origin') === new URL(request.url).origin; }`,
    "@/lib/trade-access-server": "export class TradeAccessError extends Error {}",
  };
  const result = await build({
    stdin: { contents: `export {GET} from './src/app/api/trade-map/config/route.ts';
      export {denyAccess, accessCalls} from '@/lib/trade-team-server';`, resolveDir: root },
    bundle: true, write: false, platform: "node", format: "esm",
    plugins: [{ name: "route-dependencies", setup(builder) {
      builder.onResolve({ filter: /^@\// }, (args) => stubs[args.path]
        ? { path: args.path, namespace: "stub" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] }));
    } }],
  });
  const route = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  const request = () => new Request("https://tlink.example/api/trade-map/config");
  route.denyAccess(true);
  const denied = await route.GET(request());
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get("cache-control"), "no-store");
  assert.equal("apiKey" in await denied.json(), false);
  const calls = route.accessCalls();
  const crossOrigin = await route.GET(new Request(request(), { headers: { origin: "https://other.example" } }));
  assert.equal(crossOrigin.status, 403);
  assert.equal(route.accessCalls(), calls);
  route.denyAccess(false);
  const allowed = await route.GET(request());
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("cache-control"), "no-store");
  assert.equal((await allowed.json()).ok, true);
  assert.equal(route.accessCalls(), calls + 1);
});
