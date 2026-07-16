import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  CERTIFICATE_CODES,
  CERTIFICATE_DEFINITIONS,
  collapseCertificateTradesByDay,
  isoDateMonthsBefore,
  parseDemandManagerCertificateHtml,
} from "../src/lib/certificate-prices.ts";

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"));

function sourceHtml(codes = CERTIFICATE_CODES) {
  return codes.map((code, index) => `{
    type: "scatter",
    dataPoints: [{"x":1767225600000,"y":${index + 3}},{"x":1767225600000,"y":${index + 3.25}},{"x":1767312000000,"y":${index + 3.5}}],
    markerType: "circle",
    legendText: "${code}"
  }`).join("\n");
}

test("certificate definitions explain every supported market in plain language", () => {
  assert.deepEqual(CERTIFICATE_DEFINITIONS.map((item) => item.code), [...CERTIFICATE_CODES]);
  for (const definition of CERTIFICATE_DEFINITIONS) {
    assert.ok(definition.name.length > definition.code.length);
    assert.ok(definition.plainEnglish.length > 70);
    assert.ok(definition.represents.length > 40);
    assert.ok(definition.whyPriceMatters.length > 60);
    assert.match(definition.officialUrl, /^https:\/\//);
  }
});

test("Demand Manager chart data is validated and converted to cents", () => {
  const trades = parseDemandManagerCertificateHtml(sourceHtml());
  assert.equal(trades.length, CERTIFICATE_CODES.length * 3);
  assert.deepEqual(trades[0], { code: "STC", tradedOn: "2026-01-01", priceCents: 300 });
  assert.throws(() => parseDemandManagerCertificateHtml(sourceHtml(CERTIFICATE_CODES.slice(0, -1))), /did not include SMC/);
});

test("daily history keeps the final reported trade for each certificate and date", () => {
  const daily = collapseCertificateTradesByDay(parseDemandManagerCertificateHtml(sourceHtml()));
  const stc = daily.filter((trade) => trade.code === "STC");
  assert.deepEqual(stc, [
    { code: "STC", tradedOn: "2026-01-01", priceCents: 325 },
    { code: "STC", tradedOn: "2026-01-02", priceCents: 350 },
  ]);
});

test("calendar month ranges clamp safely at shorter month boundaries", () => {
  assert.equal(isoDateMonthsBefore(new Date("2026-03-31T00:00:00Z"), 1), "2026-02-28");
  assert.equal(isoDateMonthsBefore(new Date("2024-03-31T00:00:00Z"), 1), "2024-02-29");
});

test("certificate history migration creates durable uniqueness and sync records", () => {
  const migrationPath = fs.readdirSync(path.join(root, "drizzle")).find((name) => name.includes("certificate_price"));
  assert.ok(migrationPath, "certificate price migration is missing");
  const migration = fs.readFileSync(path.join(root, "drizzle", migrationPath), "utf8");
  const db = new DatabaseSync(":memory:");
  for (const statement of migration.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
  db.prepare(`INSERT INTO certificate_price_history
    (id, certificate_code, traded_on, price_cents, source_url, captured_at)
    VALUES ('STC:2026-01-01', 'STC', '2026-01-01', 3900, 'source', 'now')`).run();
  assert.throws(() => db.prepare(`INSERT INTO certificate_price_history
    (id, certificate_code, traded_on, price_cents, source_url, captured_at)
    VALUES ('duplicate', 'STC', '2026-01-01', 3950, 'source', 'later')`).run());
  assert.match(migration, /certificate_price_sync_runs/);
});

test("tracker is linked from guides and exposes accessible chart controls", () => {
  const guides = fs.readFileSync(path.join(root, "src", "app", "guides", "page.tsx"), "utf8");
  const page = fs.readFileSync(path.join(root, "src", "app", "guides", "certificate-prices", "page.tsx"), "utf8");
  const tracker = fs.readFileSync(path.join(root, "src", "components", "CertificatePriceTracker.tsx"), "utf8");
  const chrome = fs.readFileSync(path.join(root, "src", "components", "ComparatorChrome.tsx"), "utf8");
  const worker = fs.readFileSync(path.join(root, "worker", "index.ts"), "utf8");
  assert.match(guides, /\/guides\/certificate-prices/);
  assert.match(page, /What “spot price” means here/);
  assert.match(tracker, /onPointerMove={selectPointerPoint}/);
  assert.match(tracker, /onKeyDown={selectKeyboardPoint}/);
  assert.match(tracker, /aria-live="polite"/);
  assert.match(tracker, /Plain-English guide/);
  assert.match(worker, /syncCertificatePriceHistory/);
  assert.match(chrome, /href: "\/guides\/certificate-prices", label: "Certificates"/);
  assert.doesNotMatch(tracker, /<span>{dateLabel\(active\.tradedOn\)}<\/span>/);
  assert.doesNotMatch(`${page}\n${tracker}`, /[\u2013\u2014]/);
});
