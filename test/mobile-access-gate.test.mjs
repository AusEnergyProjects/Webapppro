import assert from "node:assert/strict";
import test from "node:test";

import {
  accessStateForServerError,
  approvedAccess,
  networkVerificationRequired,
} from "../mobile/src/lib/access.ts";

test("mobile access remains locked while ABN review is pending", () => {
  const state = accessStateForServerError(
    403,
    "ABN_REVIEW_REQUIRED",
    "ABN review and trade approval are required.",
  );

  assert.equal(state.status, "pending");
  assert.equal(state.code, "ABN_REVIEW_REQUIRED");
  assert.match(state.guidance, /valid ABN/i);
});

test("mobile access treats inactive and unauthorised accounts as denied", () => {
  const inactive = accessStateForServerError(403, "ACCOUNT_INACTIVE", "This account is not active.");
  const unauthorised = accessStateForServerError(401, "", "Sign in to continue.");

  assert.equal(inactive.status, "denied");
  assert.equal(unauthorised.status, "denied");
  assert.equal(unauthorised.code, "AUTH_REQUIRED");
});

test("missing team access and offline verification never grant protected access", () => {
  const teamAccess = accessStateForServerError(404, "", "No active installer team access was found.");

  assert.equal(teamAccess.status, "pending");
  assert.equal(networkVerificationRequired.status, "pending");
  assert.equal(approvedAccess.status, "approved");
});
