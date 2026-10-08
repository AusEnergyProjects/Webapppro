import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { migratedDataforceD1 } from "./helpers/trade-dataforce-database.mjs";
import * as contract from "../src/lib/council-journey-metrics.ts";

const record = { exports: {} };
new Function("require", "module", "exports", transformSync(readFileSync(new URL("../src/lib/council-journey-metrics-server.ts", import.meta.url), "utf8"), { loader: "ts", format: "cjs" }).code)(id => {
  assert.equal(id, "./council-journey-metrics"); return contract;
}, record, record.exports);
const { readCouncilJourneyContext, loadCouncilJourneyMetrics } = record.exports;
const now = "2026-10-08T04:00:00.000Z";

test("own-journey counters execute under actual full-schema D1 limits with confirmed version deduplication", async t => {
  const runtime = await migratedDataforceD1(); t.after(() => runtime.close());
  const db = runtime.db;
  const postcodes = ["3182", ...Array.from({ length: 99 }, (_, index) => String(3000 + index))];
  await db.batch([
    db.prepare("INSERT INTO council_organisations(id,name,slug,state,created_at,updated_at) VALUES('journey-council','Synthetic council','synthetic-journey','VIC',?,?)").bind(now, now),
    db.prepare("INSERT INTO council_memberships(id,council_id,firebase_uid,email,role,invited_by_uid,created_at,updated_at) VALUES('journey-member','journey-council','actor-fixture','actor@example.invalid','viewer','admin',?,?)").bind(now, now),
    db.prepare("INSERT INTO council_campaigns(id,council_id,code,title,kind,audience,created_at,updated_at) VALUES('journey-campaign','journey-council','synthetic-journey','Synthetic page','campaign','everyone',?,?)").bind(now, now),
    db.prepare("UPDATE council_organisations SET public_campaign_id='journey-campaign',public_journey_enabled=1 WHERE id='journey-council'"),
  ]);
  for (const size of [1, 10, 100]) {
    await db.prepare("DELETE FROM council_postcodes WHERE council_id='journey-council'").run();
    await db.batch(postcodes.slice(0, size).map(postcode => db.prepare("INSERT INTO council_postcodes VALUES('journey-council','VIC',?,'admin',?)").bind(postcode, now)));
    const context = await readCouncilJourneyContext(db, "journey-council", "actor-fixture");
    assert.equal(context.postcodes.length, size);
    assert.deepEqual(await loadCouncilJourneyMetrics(db, context, new Date(now)), { submittedEnquiries: 0, enquiriesQuoted: 0, quotesSent: 0, checkedAt: now });
  }
  await db.batch([
    db.prepare(`INSERT INTO trade_opportunities(id,title,project_type,postcode,state,summary,created_by_uid,source_reference,created_at,updated_at)
      VALUES('journey-lead','Synthetic enquiry','residential','3182','VIC','','lead-intake','synthetic-intake',?,?)`).bind(now, now),
    db.prepare("INSERT INTO council_attributions VALUES('journey-lead','journey-campaign','journey-council',?,'explicit_referral')").bind(now),
    db.prepare("INSERT INTO trade_opportunity_matches(id,opportunity_id,firebase_uid,matched_by_uid,matched_at,updated_at) VALUES('journey-match','journey-lead','synthetic-trade','admin',?,?)").bind(now, now),
    db.prepare("INSERT INTO trade_work_orders(id,firebase_uid,partner_type,source_type,source_reference,work_number,title,created_at,updated_at) VALUES('journey-work','synthetic-trade','installer','public_lead','journey-match','SYNTHETIC-1','Synthetic quote',?,?)").bind(now, now),
    db.prepare(`INSERT INTO trade_crm_job_details(id,work_order_id,firebase_uid,crm_customer_id,service_site_id,customer_source,
      accepted_disclosure_snapshot,accepted_disclosure_sha256,accepted_disclosure_at,created_at,updated_at)
      VALUES('journey-detail','journey-work','synthetic-trade','synthetic-customer','synthetic-site','public_lead_released',?,?, ?,?,?)`)
      .bind(JSON.stringify({ contract: "tlink-public-lead-accepted-disclosure-v1" }), "a".repeat(64), now, now, now),
    db.prepare("INSERT INTO trade_crm_quotes(id,work_order_id,firebase_uid,crm_customer_id,service_site_id,quote_number,created_at,updated_at) VALUES('journey-quote','journey-work','synthetic-trade','synthetic-customer','synthetic-site','SYNTHETIC-Q1',?,?)").bind(now, now),
    db.prepare("INSERT INTO trade_crm_quote_versions(id,quote_id,firebase_uid,version_number,status,issued_at,created_at,updated_at) VALUES('journey-version','journey-quote','synthetic-trade',1,'issued',?,?,?)").bind(now, now, now),
    db.prepare("INSERT INTO trade_crm_quote_links(id,quote_id,quote_version_id,work_order_id,firebase_uid,crm_customer_id,token_hash,expires_at,created_at,updated_at) VALUES('journey-link','journey-quote','journey-version','journey-work','synthetic-trade','synthetic-customer','synthetic-token','2027-01-01',?,?)").bind(now, now),
  ]);
  for (const [id, status, accepted] of [["accepted", "provider_accepted", true], ["retry", "delivered", true], ["failed", "failed", false]]) {
    await db.prepare(`INSERT INTO trade_crm_quote_deliveries(id,quote_link_id,quote_version_id,work_order_id,firebase_uid,crm_customer_id,
      channel,provider,status,idempotency_key,provider_message_id,recipient_role,created_at,updated_at)
      VALUES(?,'journey-link','journey-version','journey-work','synthetic-trade','synthetic-customer','email','resend',?,?,?,'acceptance',?,?)`)
      .bind(id, status, `synthetic-key-${id}`, accepted ? `synthetic-receipt-${id}` : "", now, now).run();
    if (accepted) await db.prepare(`INSERT INTO trade_crm_quote_events(id,quote_link_id,quote_id,quote_version_id,work_order_id,firebase_uid,event_type,actor_type,evidence_key,occurred_at)
      VALUES(?,'journey-link','journey-quote','journey-version','journey-work','synthetic-trade','provider_accepted','system',?,?)`)
      .bind(`synthetic-event-${id}`, `provider_accepted:synthetic-key-${id}`, now).run();
  }
  const context = await readCouncilJourneyContext(db, "journey-council", "actor-fixture");
  assert.deepEqual(await loadCouncilJourneyMetrics(db, context, new Date(now)), { submittedEnquiries: 1, enquiriesQuoted: 1, quotesSent: 1, checkedAt: now });
  await db.prepare("UPDATE trade_crm_quote_deliveries SET status='bounced' WHERE id IN ('accepted','retry')").run();
  assert.equal((await loadCouncilJourneyMetrics(db, context, new Date(now))).quotesSent, 1);
  assert.equal(await readCouncilJourneyContext(db, "journey-council", "another-actor"), null);
});
