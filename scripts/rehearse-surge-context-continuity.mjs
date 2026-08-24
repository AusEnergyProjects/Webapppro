import assert from "node:assert/strict";
import { selectPreferredSurgeSession } from "../src/lib/surge-session-continuity.ts";

const metrics = (session) => session;
const completeLocal = { source: "local-primary", reviewedAnswers: 45, knownAnswers: 44, completed: true, conversationActivityAt: 100, profileUpdatedAt: 100 };
const newerIncompleteTab = { source: "session-primary", reviewedAnswers: 37, knownAnswers: 37, completed: false, conversationActivityAt: 900, profileUpdatedAt: 900 };
const localBackup = { source: "local-backup", reviewedAnswers: 44, knownAnswers: 44, completed: false, conversationActivityAt: 800, profileUpdatedAt: 800 };

assert.equal(selectPreferredSurgeSession([newerIncompleteTab, localBackup, completeLocal], metrics)?.source, "local-primary");
assert.equal(selectPreferredSurgeSession([newerIncompleteTab, localBackup], metrics)?.source, "local-backup");
assert.equal(selectPreferredSurgeSession([localBackup, { ...localBackup, source: "newer-conversation", conversationActivityAt: 801 }], metrics)?.source, "newer-conversation");
console.log("Surge continuity rehearsal passed: complete persistent context wins across tabs; backup recovery and conversation recency are deterministic.");
