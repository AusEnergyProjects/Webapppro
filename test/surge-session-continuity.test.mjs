import assert from "node:assert/strict";
import test from "node:test";
import { preferSurgeConversation, preferSurgeProfile, selectPreferredSurgeSession } from "../src/lib/surge-session-continuity.ts";

const metric = (overrides = {}) => ({ reviewedAnswers: 40, knownAnswers: 38, completed: false, conversationActivityAt: 100, profileUpdatedAt: 100, ...overrides });

test("more complete browser context wins over a newer incomplete tab", () => {
  assert.equal(preferSurgeConversation(metric({ reviewedAnswers: 45 }), metric({ reviewedAnswers: 37, conversationActivityAt: 900 })), true);
  assert.equal(selectPreferredSurgeSession([metric({ reviewedAnswers: 37 }), metric({ reviewedAnswers: 45 })], (entry) => entry).reviewedAnswers, 45);
});

test("conversation and profile recency break only otherwise equal sessions", () => {
  assert.equal(preferSurgeConversation(metric({ conversationActivityAt: 101 }), metric()), true);
  assert.equal(preferSurgeProfile(metric({ profileUpdatedAt: 101 }), metric()), true);
  assert.equal(preferSurgeProfile(metric({ reviewedAnswers: 39, profileUpdatedAt: 999 }), metric()), false);
});
