import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_SURGE_STARTER_PROFILE,
  SURGE_PROFILE_FIELDS,
  parseSurgeStarterProfile,
} from "../src/lib/surge-assessor-profile.ts";
import { homeContextTips } from "../src/lib/surge-home-context-tips.ts";

const reviewedProfile = (overrides = {}) => parseSurgeStarterProfile({
  ...EMPTY_SURGE_STARTER_PROFILE,
  reviewed: SURGE_PROFILE_FIELDS.map((field) => field.id),
  completed: true,
  ...overrides,
});

const text = (profile) => homeContextTips(profile)
  .map((tip) => `${tip.title} ${tip.detail}`)
  .join(" ");

test("draught guidance does not retain moisture language after moisture is removed", () => {
  const withMoisture = reviewedProfile({
    features: ["ceiling-insulation-limited", "draughty", "condensation-moisture", "single-glazing"],
  });
  assert.match(text(withMoisture), /moisture|damp|mould/i);

  const withoutMoisture = reviewedProfile({
    features: ["ceiling-insulation-limited", "draughty", "single-glazing"],
  });
  const refreshed = text(withoutMoisture);
  assert.doesNotMatch(refreshed, /moisture|damp|mould/i);
  assert.match(refreshed, /draught/i);
});

test("moisture guidance only appears for the reviewed moisture selection", () => {
  const tips = text(reviewedProfile({
    features: ["condensation-moisture", "ceiling-insulation-well", "double-glazing"],
  }));
  assert.match(tips, /Control moisture before sealing/);
  assert.match(tips, /exhaust fans|dehumidifier/i);
});

test("tips are ranked and limited to the three most relevant current signals", () => {
  const tips = homeContextTips(reviewedProfile({
    features: [
      "ceiling-insulation-limited",
      "draughty",
      "comfort-too-hot",
      "single-glazing",
      "window-coverings-basic",
      "external-shading-none",
    ],
    billPressure: "hard-to-manage",
    gasConnection: "connected",
    plannedWorks: "renovation",
  }));
  assert.equal(tips.length, 3);
  assert.deepEqual(tips.map((tip) => tip.title), [
    "Check the ceiling first",
    "Stop the easy draughts first",
    "Improve windows without replacing them",
  ]);
});

test("early tips prefer practical low-cost actions supported by the saved home context", () => {
  const tips = homeContextTips(reviewedProfile({
    features: [
      "draughty",
      "electric-resistance-heating",
      "evaporative-ducts",
      "single-glazing",
      "window-coverings-basic",
      "external-shading-none",
    ],
  }));

  assert.deepEqual(tips.map((tip) => tip.title), [
    "Stop the easy draughts first",
    "Avoid portable heaters for whole rooms",
    "Check unused evaporative outlets",
  ]);
  const guidance = tips.map((tip) => tip.detail).join(" ");
  assert.match(guidance, /door snake/i);
  assert.match(guidance, /reverse-cycle/i);
  assert.match(guidance, /removable outlet covers/i);
  assert.doesNotMatch(guidance, /Duck|Renshade/i);
});

test("solar and tariff tips explain load shifting without promoting a plan", () => {
  const tips = homeContextTips(reviewedProfile({
    features: ["solar"],
    billPressure: "hard-to-manage",
  }));
  const guidance = tips.map((tip) => `${tip.title} ${tip.detail}`).join(" ");

  assert.match(guidance, /Use more of your solar directly/i);
  assert.match(guidance, /heat-pump dryer/i);
  assert.match(guidance, /free-use windows/i);
  assert.match(guidance, /complete tariff/i);
});
