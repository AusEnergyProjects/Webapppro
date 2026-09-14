import assert from "node:assert/strict";
import test from "node:test";
import { AEA_SERVICES, AEA_BUNDLES, AEA_BUNDLE_FAQS, gstInclusiveCents } from "../src/lib/aea-services.mjs";

const service = (id) => {
  const value = AEA_SERVICES.find((item) => item.id === id);
  assert.ok(value, id);
  return value;
};
const faqText = (item) => item.faqs.map(([question, answer]) => `${question} ${answer}`).join(" ");

test("the approved annual smoke and blind price includes the agreed consumables, replacements and callouts", () => {
  const smoke = service("smoke-alarm-blind-safety");
  assert.equal(smoke.priceExGstCents, 10000);
  assert.equal(gstInclusiveCents(smoke.priceExGstCents), 11000);
  const includes = smoke.inclusions.join(" ");
  for (const included of [/replacement batteries/i, /like-for-like replacement.*faulty or expired/i, /cord anchors/i, /safety labels/i, /between-visit fault callouts/i]) {
    assert.match(includes, included);
  }
  assert.match(smoke.scope, /Hardwired|hardwired/);
  assert.match(smoke.scope, /appropriately licensed electrician/);
  assert.match(smoke.scope, /New wiring.*specialist.*major blind repairs.*separately/);
  assert.doesNotMatch(smoke.scope, /replacement alarms.*identified separately/);
});

test("both two-year bundles carry the approved smoke and blind inclusions without changing price arithmetic", () => {
  assert.deepEqual(AEA_BUNDLES.map((bundle) => [bundle.priceExGstCents, bundle.priceExGstCents / 2, gstInclusiveCents(bundle.priceExGstCents)]), [
    [45000, 22500, 49500], [70000, 35000, 77000],
  ]);
  for (const bundle of AEA_BUNDLES) {
    assert.equal(bundle.durationMonths, 24);
    const includes = bundle.inclusions.join(" ");
    for (const included of [/2 smoke alarm checks/, /2 blind safety checks/, /Batteries and standard replacement smoke alarms/, /cord anchors and safety labels/, /Between-visit.*fault callouts/]) {
      assert.match(includes, included);
    }
  }
  assert.match(AEA_BUNDLES[1].inclusions.join(" "), /no extra appliance charge/);
});

test("the gas service retains all in-scope appliances without implying that repairs are included", () => {
  const gas = service("gas-safety-check");
  assert.equal(gas.priceExGstCents, 25000);
  assert.match(gas.inclusions.join(" "), /Every in-scope gas appliance included, with no additional appliance charge/);
  assert.match(gas.scope, /Repairs, replacement parts and appliance replacement.*separately/);
  assert.match(faqText(gas), /complete customer service record/);
  assert.match(gas.legal, /AS 4575/);
});

test("each service provides a completed record by email, secure link and downloadable PDF", () => {
  for (const item of [...AEA_SERVICES, ...AEA_BUNDLES]) {
    const includes = item.inclusions.join(" ");
    assert.match(includes, /Same-day email/i, item.id);
    assert.match(includes, /[Ss]ecure shareable.*link/, item.id);
    assert.match(includes, /downloadable PDF/, item.id);
  }
  for (const id of ["nathers-new", "nathers-existing"]) {
    const rating = service(id);
    assert.match(rating.inclusions.join(" "), /once modelling and certification are complete/, id);
    assert.match(faqText(rating), /modelling.*complete/, id);
  }
});

test("the public records keep safety, repair certification and energy advice distinct", () => {
  const electrical = service("electrical-safety-check");
  assert.match(electrical.legal, /AS\/NZS 3019:2022/);
  assert.match(electrical.legal, /report is not a substitute for that certificate/);
  assert.match(faqText(electrical), /completed report|report is complete/);
  const advice = service("onsite-energy-assessment");
  assert.match(advice.inclusions.join(" "), /no formal rating or compliance certificate/);
  assert.match(faqText(advice), /neither a NatHERS or Home Energy Rating certificate nor a formal star rating/);
  assert.match(faqText(service("minimum-rental-standards")), /not a government-issued certificate/);
  assert.match(faqText(service("smoke-alarm-blind-safety")), /untested item is never recorded as passing/);
});

test("FAQs explain meaningful service decisions and preserve the due-date boundary for bundles", () => {
  for (const item of AEA_SERVICES) {
    assert.ok(item.faqs.length >= 7 && item.faqs.length <= 10, item.id);
    assert.equal(new Set(item.faqs.map(([question]) => question)).size, item.faqs.length, item.id);
    for (const [question, answer] of item.faqs) {
      assert.ok(question.endsWith("?"), question);
      assert.ok(answer.length > 80, question);
    }
    assert.match(faqText(item), item.id === "nathers-new" ? /plans and specifications/i : /access/i, item.id);
    assert.match(faqText(item), /report|summary|documentation/i, item.id);
    assert.ok(item.sources.every(({ url }) => new URL(url).protocol === "https:"), item.id);
  }
  assert.ok(Object.isFrozen(AEA_BUNDLE_FAQS));
  assert.ok(AEA_BUNDLE_FAQS.every(Object.isFrozen));
  const bundles = AEA_BUNDLE_FAQS.flat().join(" ");
  assert.match(bundles, /overdue.*not deferred.*second year/);
  assert.match(bundles, /does not specify a payment schedule/);
  assert.match(bundles, /does not certify work that has not happened yet/);
});
