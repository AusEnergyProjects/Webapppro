import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { pinExpandedNotification } from "../src/components/admin-notification-inbox-state.ts";

const notification = (id, status = "open") => ({ id, status });
const inbox = fs.readFileSync(
  new URL("../src/components/AdminNotificationInbox.tsx", import.meta.url),
  "utf8",
);

test("an expanded case keeps its queue position when a refresh reorders it", () => {
  const refreshed = [
    notification("still-unread"),
    notification("active-case", "read"),
    notification("older-read", "read"),
  ];

  assert.deepEqual(
    pinExpandedNotification(refreshed, refreshed, "active-case", 0).map(
      (item) => item.id,
    ),
    ["active-case", "still-unread", "older-read"],
  );
});

test("an expanded case stays visible when its audited update changes the active filter", () => {
  const active = notification("active-case", "read");
  const filtered = [notification("still-unread")];
  const all = [...filtered, active];

  assert.deepEqual(
    pinExpandedNotification(filtered, all, "active-case", 1).map(
      (item) => item.id,
    ),
    ["still-unread", "active-case"],
  );
});

test("an unavailable or closed case does not change the filtered queue", () => {
  const filtered = [notification("case-a"), notification("case-b")];

  assert.equal(pinExpandedNotification(filtered, filtered, "", 0), filtered);
  assert.equal(
    pinExpandedNotification(filtered, filtered, "missing-case", 0),
    filtered,
  );
});

test("manual queue and filter changes reset the expanded case boundary", () => {
  assert.match(
    inbox,
    /function resetExpandedCase\(\) \{[\s\S]*?expandedIdRef\.current = "";[\s\S]*?setExpandedId\(""\);[\s\S]*?setExpandedVisibleIndex\(0\);/,
  );
  assert.match(
    inbox,
    /function setQueue\(value: string\) \{\s*resetExpandedCase\(\);\s*setQueueState\(value\);/,
  );
  for (const handler of [
    "changeSearch",
    "changeCategory",
    "changePriority",
    "changeNotificationStatus",
    "changeAssignedFilter",
    "changeActionOnly",
  ]) {
    assert.match(
      inbox,
      new RegExp(`function ${handler}\\([^)]*\\) \\{\\s*resetExpandedCase\\(\\);`),
      `${handler} must close the active editor before changing the filter`,
    );
  }
});
