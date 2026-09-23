import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { canonicalGoogleBusinessProfileUrl } from "../src/lib/trade-google-business-profile.mjs";

test("public Google business listing links preserve their exact listing destination", () => {
  for (const value of [
    "https://maps.app.goo.gl/abcDEF123?g_st=ic",
    "https://g.page/example-business",
    "https://g.page/r/Example123/review",
    "https://www.google.com/maps/place/Example+Business/@-37,145,16z/data=test",
    "https://www.google.com/maps/place/?q=place_id:ChIJS2WVhrVD1moRFxEPRjRPxtE",
    "https://www.google.com.au/maps?cid=123456789",
    "https://www.google.com/maps/search/?api=1&query=Example&query_place_id=ChIJ123",
    "https://maps.google.com/?cid=1234",
  ]) assert.equal(canonicalGoogleBusinessProfileUrl(` ${value} `), value);
  for (const value of [undefined, null, "", "  "]) assert.equal(canonicalGoogleBusinessProfileUrl(value), "");
});

test("Google profile validation rejects unsafe, unrelated and misleading URL forms", () => {
  for (const value of [
    "javascript:alert(1)", "http://g.page/example", "//g.page/example", "https://example.com/reviews",
    "https://g.page.example.com/example", "https://maps.app.goo.gl.evil.com/abc", "https://google.com/search?q=trade",
    "https://www.google.com/maps", "https://www.google.com/maps/place/", "https://www.google.com/maps/place/?q=", "https://www.google.com/maps/dir/Somewhere",
    "https://username:password@g.page/example", "https://g.page:444/example",
    "https://maps.app.goo.gl/", "https://g.page/example\n/review", "https://g.page\\@example.com/path",
    "https://www.google.com/maps/place/Business?url=https://example.com", "https://g.page/example?continue=https://example.com",
    "https://g.page/" + "x".repeat(2048), {}, 123,
  ]) assert.equal(canonicalGoogleBusinessProfileUrl(value), null, String(value));
});

test("Google business profile migration preserves existing business websites and starts blank", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("CREATE TABLE trade_accounts (firebase_uid TEXT PRIMARY KEY, business_website TEXT NOT NULL);");
    database.prepare("INSERT INTO trade_accounts VALUES (?, ?)").run("owner-1", "https://business.example");
    database.exec(fs.readFileSync(new URL("../drizzle/0187_google_business_profile.sql", import.meta.url), "utf8"));
    assert.deepEqual({ ...database.prepare("SELECT * FROM trade_accounts").get() }, {
      firebase_uid: "owner-1", business_website: "https://business.example", google_business_profile_url: "",
    });
    const link = canonicalGoogleBusinessProfileUrl("https://maps.app.goo.gl/Business123");
    database.prepare("UPDATE trade_accounts SET google_business_profile_url = ? WHERE firebase_uid = ?").run(link, "owner-1");
    assert.equal(database.prepare("SELECT google_business_profile_url FROM trade_accounts").get().google_business_profile_url, link);
  } finally { database.close(); }
});
