import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CERTIFICATE_CODES } from "../src/lib/certificate-prices.ts";
import { loadCertificatePriceDataset, syncCertificatePriceHistory } from "../src/lib/certificate-prices-server.ts";

const NOW = new Date("2026-10-12T02:00:00Z");
function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const migrations = new URL("../drizzle/", import.meta.url);
  const file = readdirSync(migrations).find(name => name.includes("certificate_price"));
  sqlite.exec(readFileSync(new URL(file, migrations), "utf8").replaceAll("--> statement-breakpoint", ""));
  const database = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return { bind(...values) {
        return {
          run: async () => statement.run(...values),
          first: async () => statement.get(...values) || null,
          all: async () => ({ results: statement.all(...values) }),
        };
      }, first: async () => statement.get() || null };
    },
    batch: async statements => Promise.all(statements.map(statement => statement.run())),
  };
  return { database, sqlite };
}
function html() {
  return CERTIFICATE_CODES.map((code, index) => `{
    type: "scatter", dataPoints: [{"x":1791590400000,"y":${index + 30}},{"x":1791676800000,"y":${index + 31}}],
    markerType: "circle", legendText: "${code}"
  }`).join("\n");
}
const sourceResponse = () => new Response(html());

test("a completed price refresh makes subsequent fresh reads skip the source", async t => {
  const { database, sqlite } = fixture(t);
  let resolveSource;
  let requests = 0;
  const source = new Promise(resolve => { resolveSource = resolve; });
  const fetchImpl = async (_url, input) => {
    requests++;
    assert.equal(input.method, "POST");
    assert.ok(input.signal instanceof AbortSignal);
    return source;
  };
  const first = loadCertificatePriceDataset(database, { now: NOW, fetchImpl });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1);
  resolveSource(sourceResponse());
  const dataset = await first;
  assert.equal(dataset.source.status, "current");
  assert.equal(dataset.certificates[0].latest.priceCents, 3100);
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM certificate_price_sync_runs").get().count, 1);
  await loadCertificatePriceDataset(database, { now: NOW, fetchImpl });
  assert.equal(requests, 1);
  await syncCertificatePriceHistory(database, { now: new Date(NOW.getTime() + 1), fetchImpl: async () => {
    requests++; return sourceResponse();
  } });
  assert.equal(requests, 2, "an explicit refresh must read the source again");
});

test("price refresh work stays independent across database request contexts", async t => {
  const first = fixture(t), second = fixture(t);
  let requests = 0;
  const fetchImpl = async () => { requests++; return sourceResponse(); };
  await Promise.all([
    syncCertificatePriceHistory(first.database, { now: NOW, fetchImpl }),
    syncCertificatePriceHistory(second.database, { now: NOW, fetchImpl }),
  ]);
  assert.equal(requests, 2);
  for (const { sqlite } of [first, second]) {
    assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM certificate_price_sync_runs").get().count, 1);
  }
});

test("the source deadline covers a stalled body and allows a later refresh to recover", async t => {
  const { database, sqlite } = fixture(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  const pending = syncCertificatePriceHistory(database, { now: NOW, fetchImpl: async (_url, input) => {
    signal = input.signal;
    return { ok: true, text: async () => new Promise(() => {}) };
  } });
  const rejected = assert.rejects(pending, /Certificate price source did not respond in time/);
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(7_999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM certificate_price_history").get().count, 0);
  assert.equal(sqlite.prepare("SELECT status FROM certificate_price_sync_runs").get().status, "failed");
  await syncCertificatePriceHistory(database, { now: new Date(NOW.getTime() + 1), fetchImpl: async () => sourceResponse() });
  assert.ok(sqlite.prepare("SELECT COUNT(*) count FROM certificate_price_history").get().count > 0);
});

test("a timed-out due refresh returns retained prices explicitly marked stale", async t => {
  const { database } = fixture(t);
  const old = new Date(NOW.getTime() - 21 * 60 * 60 * 1000);
  await syncCertificatePriceHistory(database, { now: old, fetchImpl: async () => sourceResponse() });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = loadCertificatePriceDataset(database, { now: NOW, fetchImpl: async () => new Promise(() => {}) });
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(8_000);
  const dataset = await pending;
  assert.equal(dataset.source.status, "stale");
  assert.equal(dataset.source.lastCheckedAt, old.toISOString());
  assert.equal(dataset.certificates[0].latest.priceCents, 3100);
});
