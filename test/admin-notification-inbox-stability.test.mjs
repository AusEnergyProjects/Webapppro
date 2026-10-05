import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { notificationMatchesQueue, pinExpandedNotification } from "../src/components/admin-notification-inbox-state.ts";

const notification = (id, status = "open") => ({ id, status });
const inbox = fs.readFileSync(
  new URL("../src/components/AdminNotificationInbox.tsx", import.meta.url),
  "utf8",
);

test("binned cases belong only to Bin regardless of their retained workflow state", () => {
  const item = { binnedAt: "2026-10-05T00:00:00Z", status: "read", requiresAction: true, assignedToUid: "admin-a", slaState: "overdue" };
  for (const status of ["open", "read", "resolved"]) {
    for (const queue of ["all", "action_required", "mine", "unassigned", "overdue", "due_soon", "resolved", "bin"]) {
      assert.equal(notificationMatchesQueue({...item, status}, queue, "admin-a"), queue === "bin");
    }
  }
  assert.equal(notificationMatchesQueue({...item, binnedAt: ""}, "bin", "admin-a"), false);
  assert.equal(notificationMatchesQueue({...item, binnedAt: ""}, "action_required", "admin-a"), true);
  assert.equal(notificationMatchesQueue({...item, binnedAt: ""}, "mine", "admin-b"), false);
});

test("Bin loading is separated from active queues and stale responses cannot replace it", () => {
  assert.match(inbox, /binQueue \? "\/api\/admin\/notifications\?queue=bin"/);
  assert.match(inbox, /sequence !== loadSequence.current \|\| binQueue !== \(queueRef.current === "bin"\)/);
  assert.match(inbox, /if \(binChanged\) \{\s*setNotifications\(\[\]\);\s*void load\(\);/);
  assert.match(inbox, /if \(!binQueue\) \{[\s\S]*?seen.current.add\(item.id\)[\s\S]*?initialised.current = true;/);
  assert.match(inbox, /Move \$\{item.title\} to Bin/);
  assert.match(inbox, /Undo move to Bin/);
  assert.match(inbox, /moveBin\("restore", item.id\)/);
  assert.match(inbox, /item.entityType === "trade_opportunity"[\s\S]*?<AdminSubmittedEnquiryDetails key=\{item.entityId\} api=\{api\} opportunityId=\{item.entityId\}/);
});

test("Open record preserves the exact opportunity before generic customer routing", () => {
  const portal = fs.readFileSync(new URL("../src/components/AdminOperationsPortal.tsx", import.meta.url), "utf8");
  const handler = portal.slice(portal.indexOf("function openNotificationRecord"));
  assert.ok(handler.indexOf('notification.entityType === "trade_opportunity"') < handler.indexOf('notification.actorType === "customer"'));
  assert.match(handler, /setOpportunityTarget\(\{ id: notification.entityId, nonce: Date.now\(\) \}\)/);
  assert.match(portal, /targetOpportunityId=\{opportunityTarget\?\.id\}/);
});

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
