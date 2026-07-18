import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { calculateJobPacketSummary, normalisePacketLines, normaliseSuggestedCrewSize } from "../src/lib/trade-job-packet.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0065_trade_job_packets.sql");
const route = read("../src/app/api/trade-job-packets/route.ts");
const server = read("../src/lib/trade-job-packet-server.ts");
const quoteRoute = read("../src/app/api/trade-quotes/route.ts");
const workspace = read("../src/components/TradeJobPacketWorkspace.tsx");
const priceBookWorkspace = read("../src/components/TradePriceBookWorkspace.tsx");
const quoteUi = read("../src/components/TradeQuotePanel.tsx");

const apply = (db, sql) => {
  for (const statement of sql.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
};

const items = new Map([
  ["labour", { id: "labour", itemCode: "ITM-1", name: "Licensed labour", itemType: "labour", unitLabel: "hour",
    supplierCostCentsExGst: 8_000, sellPriceCentsExGst: 12_000, taxCode: "gst", expectedDurationMinutes: 60, requiredSkill: "electrical" }],
  ["material", { id: "material", itemCode: "ITM-2", name: "Cable", itemType: "material", unitLabel: "metre",
    supplierCostCentsExGst: 250, sellPriceCentsExGst: 500, taxCode: "gst", expectedDurationMinutes: 2, requiredSkill: "" }],
]);

test("job-packet quantities produce deterministic money, duration and capability summaries", () => {
  const lines = normalisePacketLines([
    { priceBookItemId: "labour", quantity: "1.5" },
    { priceBookItemId: "material", quantity: "10" },
  ], items);
  assert.deepEqual(lines, [
    { priceBookItemId: "labour", quantityMilli: 1500 },
    { priceBookItemId: "material", quantityMilli: 10000 },
  ]);
  assert.deepEqual(calculateJobPacketSummary(lines, items), {
    costCentsExGst: 14_500,
    sellCentsExGst: 23_000,
    estimatedDurationMinutes: 110,
    requiredCapabilities: ["electrical"],
    markupBasisPoints: 5_862,
    marginBasisPoints: 3_696,
  });
  assert.equal(normaliseSuggestedCrewSize("3"), 3);
  assert.throws(() => normalisePacketLines([{ priceBookItemId: "labour", quantity: "1" }, { priceBookItemId: "labour", quantity: "2" }], items), /INVALID_JOB_PACKET_LINES/);
  assert.throws(() => normaliseSuggestedCrewSize("0"), /INVALID_JOB_PACKET_CREW/);
});

test("the additive migration stores packet composition and quote revision references", () => {
  for (const table of ["trade_job_packets", "trade_job_packet_items", "trade_job_packet_forms"]) {
    assert.equal((schema.match(new RegExp(`sqliteTable\\("${table}"`, "g")) || []).length, 1);
    assert.match(migration, new RegExp("CREATE TABLE `" + table + "`"));
  }
  for (const column of ["job_packet_id", "job_packet_revision", "job_packet_line_id"]) {
    assert.match(migration, new RegExp("ALTER TABLE `trade_crm_quote_items` ADD `" + column + "`"));
    assert.match(schema, new RegExp(column));
  }
  for (const index of ["trade_job_packets_owner_code_idx", "trade_job_packet_items_price_idx", "trade_job_packet_forms_template_idx"]) assert.match(migration, new RegExp(index));
});

test("the job-packet migration applies after the quote and price-book dependencies", () => {
  const db = new DatabaseSync(":memory:"); const directory = new URL("../drizzle/", import.meta.url);
  for (const file of ["0000_complex_absorbing_man.sql", "0001_futuristic_frog_thor.sql", "0011_even_reavers.sql",
    "0015_aromatic_black_knight.sql", "0019_melodic_unus.sql", "0047_customer_service_site_foundation.sql",
    "0050_versioned_trade_quotes.sql", "0064_trade_price_book.sql", "0065_trade_job_packets.sql"]) apply(db, fs.readFileSync(new URL(file, directory), "utf8"));
  const columns = db.prepare("PRAGMA table_info(trade_crm_quote_items)").all().map((row) => row.name);
  assert.ok(columns.includes("job_packet_revision"));
  assert.equal(db.prepare("SELECT COUNT(*) count FROM trade_job_packets").get().count, 0);
});

test("packet management reuses authoritative owner-scoped business sources", () => {
  for (const boundary of ["sameOrigin(request)", "requireInstallerTeamAccess(request, false)", "canDispatch(access)", "firebase_uid = ?"]) assert.ok(route.includes(boundary));
  assert.match(route, /trade_price_book_items/);
  assert.match(route, /trade_crm_job_templates/);
  assert.match(route, /publishedTradeFormTemplatesFor/);
  assert.match(server, /trade_team_members WHERE owner_uid = \? AND status = 'active'/);
  assert.match(server, /recordStatus === "active" && lines\.length > 0 && unavailableItemCount === 0/);
  for (const duplicate of ["trade_job_packet_tasks", "trade_job_packet_capabilities", "trade_job_packet_team", "trade_job_packet_form_templates"]) assert.doesNotMatch(migration, new RegExp("CREATE TABLE `" + duplicate + "`"));
});

test("ready packets apply once and preserve immutable quote snapshots", () => {
  assert.match(quoteRoute, /jobPacketsForQuote\(identity\.uid\)/);
  assert.match(quoteRoute, /resolveJobPacketQuoteLines\(identity\.uid, body\.lines\)/);
  assert.match(quoteRoute, /resolvedPacket\.references\[position\]\?\.packetRevision/);
  assert.match(server, /JOB_PACKET_DUPLICATE_LINE/);
  assert.match(server, /p\.record_status = 'active' AND i\.record_status = 'active'/);
  assert.match(quoteUi, /Applying the same packet again replaces its lines instead of duplicating them/);
  assert.match(quoteUi, /currentLines\.filter\(\(line\) => line\.jobPacketId !== packet\.id\)/);
  assert.match(quoteUi, /Saving uses current price-book values and keeps a quote snapshot/);
});

test("the packet workspace keeps the installer path short and details optional", () => {
  for (const copy of ["Job packets", "Start in under a minute", "Add a price-book item first", "New job packet",
    "The essential path is name, service and saved items", "Tasks, forms and crew, optional", "Save ready packet"]) {
    assert.match(`${workspace}\n${priceBookWorkspace}`, new RegExp(copy));
  }
  assert.match(priceBookWorkspace, /Price-book items/);
  assert.match(quoteUi, /Start with a job packet/);
  assert.doesNotMatch(`${workspace}\n${priceBookWorkspace}\n${quoteUi}\n${route}`, /[\u2013\u2014]/);
});
