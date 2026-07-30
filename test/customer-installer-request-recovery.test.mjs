import test from "node:test";
import assert from "node:assert/strict";
import {
  canRecoverInstallerRequest,
  canUpdateReplayedCustomerDraft,
  installerContactFingerprint,
  installerRequestFingerprint,
} from "../src/lib/customer-installer-request-recovery.mjs";

const contact = {
  phone: "0400 000 000",
  addressLine1: "12 Example Street",
  addressLine2: "Unit 2",
  suburb: "Melbourne",
};

test("uncertain installer requests recover only the exact attempted inputs", () => {
  assert.equal(
    installerContactFingerprint({ ...contact, phone: " 0400 000 000 " }),
    installerContactFingerprint(contact),
  );
  const attempt = {
    projectId: "project-1",
    planRevision: 4,
    editGeneration: 7,
    requestFingerprint: installerRequestFingerprint(contact, true),
  };
  assert.equal(canRecoverInstallerRequest(attempt, { ...attempt }), true);
  assert.equal(canRecoverInstallerRequest(attempt, {
    ...attempt,
    requestFingerprint: installerRequestFingerprint({
      ...contact,
      phone: "0411 111 111",
    }, true),
  }), false);
  assert.equal(canRecoverInstallerRequest(attempt, {
    ...attempt,
    requestFingerprint: installerRequestFingerprint(contact, false),
  }), false);
  assert.equal(canRecoverInstallerRequest(attempt, {
    ...attempt,
    editGeneration: 8,
  }), false);
  assert.equal(canRecoverInstallerRequest(attempt, {
    ...attempt,
    planRevision: 5,
  }), false);
});

test("a replayed create can update only its untouched first draft revision", () => {
  assert.equal(canUpdateReplayedCustomerDraft({
    status: "draft",
    planRevision: 1,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  }), true);
  assert.equal(canUpdateReplayedCustomerDraft({
    status: "draft",
    planRevision: 2,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  }), false);
  assert.equal(canUpdateReplayedCustomerDraft({
    status: "matching",
    planRevision: 1,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  }), false);
  assert.equal(canUpdateReplayedCustomerDraft({
    status: "draft",
    planRevision: 1,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:05:00.000Z",
  }), false);
  assert.equal(canUpdateReplayedCustomerDraft(null), false);
});
