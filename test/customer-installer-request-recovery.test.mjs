import test from "node:test";
import assert from "node:assert/strict";
import {
  canRecoverInstallerRequest,
  canUpdateReplayedCustomerDraft,
  installerContactFingerprint,
  installerRequestFingerprint,
  isProvenInstallerProfileRevisionConflict,
  saveInstallerRequestProfileWithOneConflictRetry,
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

test("an installer profile save succeeds without an unnecessary retry", async () => {
  const calls = [];
  const saved = { ok: true, status: 200, profile: { updatedAt: "r2" } };
  const outcome = await saveInstallerRequestProfileWithOneConflictRetry({
    contact,
    expectedUpdatedAt: "r1",
    save: async (expectedUpdatedAt, submittedContact) => {
      calls.push({ expectedUpdatedAt, submittedContact });
      return saved;
    },
    loadLatest: async () => {
      throw new Error("a successful save must not reload the profile");
    },
  });

  assert.equal(outcome.result, saved);
  assert.equal(outcome.retried, false);
  assert.equal(outcome.latestProfile, null);
  assert.deepEqual(calls, [{
    expectedUpdatedAt: "r1",
    submittedContact: contact,
  }]);
});

test("a proven profile revision conflict retries once with the same entered contact", async () => {
  const calls = [];
  const latestProfile = {
    updatedAt: "r2",
    phone: "0499 999 999",
    addressLine1: "Old saved address",
    addressLine2: "",
    suburb: "Old suburb",
  };
  const outcomes = [
    {
      ok: false,
      status: 409,
      code: "PROFILE_REVISION_CONFLICT",
      updatedAt: "r2",
      error: "Profile changed.",
    },
    {
      ok: true,
      status: 200,
      profile: { ...latestProfile, ...contact, updatedAt: "r3" },
    },
  ];

  const outcome = await saveInstallerRequestProfileWithOneConflictRetry({
    contact,
    expectedUpdatedAt: "r1",
    save: async (expectedUpdatedAt, submittedContact) => {
      calls.push({ expectedUpdatedAt, submittedContact });
      return outcomes.shift();
    },
    loadLatest: async () => latestProfile,
  });

  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.retried, true);
  assert.equal(outcome.latestProfile, latestProfile);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].expectedUpdatedAt, "r1");
  assert.equal(calls[1].expectedUpdatedAt, "r2");
  assert.equal(calls[0].submittedContact, contact);
  assert.equal(calls[1].submittedContact, contact);
});

test("a second profile revision conflict stops without a third save", async () => {
  const calls = [];
  const firstConflict = {
    ok: false,
    status: 409,
    code: "PROFILE_REVISION_CONFLICT",
    updatedAt: "r2",
    error: "Profile changed.",
  };
  const secondConflict = {
    ok: false,
    status: 409,
    code: "PROFILE_REVISION_CONFLICT",
    updatedAt: "r3",
    error: "Profile changed again.",
  };
  const outcomes = [firstConflict, secondConflict];
  let latestLoads = 0;

  const outcome = await saveInstallerRequestProfileWithOneConflictRetry({
    contact,
    expectedUpdatedAt: "r1",
    save: async (expectedUpdatedAt, submittedContact) => {
      calls.push({ expectedUpdatedAt, submittedContact });
      return outcomes.shift();
    },
    loadLatest: async () => {
      latestLoads += 1;
      return { updatedAt: "r2" };
    },
  });

  assert.equal(outcome.result, secondConflict);
  assert.equal(outcome.retried, true);
  assert.equal(calls.length, 2);
  assert.equal(latestLoads, 1);
  assert.deepEqual(calls.map((call) => call.expectedUpdatedAt), ["r1", "r2"]);
});

test("an unproven conflict cannot retry or apply a mismatched profile revision", async () => {
  const conflict = {
    ok: false,
    status: 409,
    code: "PROFILE_REVISION_CONFLICT",
    updatedAt: "r2",
    error: "Profile changed.",
  };
  let saves = 0;
  const outcome = await saveInstallerRequestProfileWithOneConflictRetry({
    contact,
    expectedUpdatedAt: "r1",
    save: async () => {
      saves += 1;
      return conflict;
    },
    loadLatest: async () => ({ updatedAt: "r3" }),
  });

  assert.equal(
    isProvenInstallerProfileRevisionConflict(
      conflict,
      { updatedAt: "r3" },
      "r1",
    ),
    false,
  );
  assert.equal(outcome.result, conflict);
  assert.equal(outcome.retried, false);
  assert.equal(saves, 1);
});
