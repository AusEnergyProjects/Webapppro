import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { canonicalAustralianState, AUSTRALIAN_STATE_CODES } from "../src/lib/australian-postcodes.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"));

test("production migrations contain no synthetic population payload", () => {
  const migrations = fs.readdirSync(path.join(root, "drizzle")).filter((name) => name.endsWith(".sql"));
  const combined = migrations.map((name) => fs.readFileSync(path.join(root, "drizzle", name), "utf8")).join("\n");
  assert.doesNotMatch(combined, /aea-demo-\d+\.consumer|Synthetic private planning note|AEA Demo Energy Supply/i);
  assert.equal(fs.existsSync(path.join(root, "fixtures", "synthetic", "migrations", "0033_synthetic_benchmark_population.sql")), true);
});

test("synthetic credentials and generated output are ignored", () => {
  const ignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(ignore, /\/synthetic-test-output\//);
});

test("Australian states have one canonical stored representation", () => {
  assert.deepEqual(AUSTRALIAN_STATE_CODES, ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]);
  assert.equal(canonicalAustralianState("Qld"), "QLD");
  assert.equal(canonicalAustralianState("vic"), "VIC");
  assert.equal(canonicalAustralianState("Tas"), "TAS");
});

test("commercial Stripe links and identifiers are server configured", () => {
  const billing = fs.readFileSync(path.join(root, "src", "lib", "direct-trade-billing.ts"), "utf8");
  const webhook = fs.readFileSync(path.join(root, "src", "app", "api", "stripe", "webhook", "route.ts"), "utf8");
  assert.doesNotMatch(billing, /buy\.stripe\.com|billing\.stripe\.com/);
  assert.doesNotMatch(webhook, /plink_[A-Za-z0-9]+/);
  assert.match(webhook, /stripeMembershipPlanByPaymentLink/);
});

test("inactive Netlify deployment targets are removed", () => {
  assert.equal(fs.existsSync(path.join(root, "netlify.toml")), false);
  assert.equal(fs.existsSync(path.join(root, "netlify", "functions", "api-health-monitor.mts")), false);
});
