import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { errors } from "jose";
import ts from "typescript";

import {
  FirebaseAuthError,
  requireFirebaseIdentity,
} from "../src/lib/firebase-server.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

function loadTypescriptModule(path, mocks = {}) {
  const source = read(path);
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: path,
  }).outputText;
  const moduleRecord = { exports: {} };
  const require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error(`Unexpected module dependency: ${specifier}`);
  };
  const execute = new Function("require", "module", "exports", output);
  execute(require, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

const firebaseIdentity = {
  uid: "installer-uid",
  email: "installer@example.com",
  emailVerified: true,
  authTime: 0,
  signInProvider: "password",
};

function pendingInvitationDatabase() {
  const state = {
    membershipReads: 0,
    invitationReads: 0,
    batches: 0,
    claimed: false,
  };
  const member = {
    membership_id: "membership-1",
    organisation_id: "creditex-org",
    firebase_uid: firebaseIdentity.uid,
    email: firebaseIdentity.email,
    display_name: "Installer Admin",
    role: "admin",
    membership_status: "active",
    governance_identity_verified: 0,
    last_login_at: new Date().toISOString(),
    organisation_code: "CREDITEX-AU",
    organisation_legal_name: "Creditex Pty Ltd",
    organisation_trading_name: "Creditex",
    organisation_status: "active",
  };
  const invitation = {
    id: "invitation-1",
    organisation_id: "creditex-org",
    email: firebaseIdentity.email,
    display_name: "Installer Admin",
    role: "admin",
    invited_by_uid: "existing-admin",
    expires_at: "2099-01-01T00:00:00.000Z",
  };
  const database = {
    prepare(sql) {
      const statement = {
        bind() {
          return statement;
        },
        async all() {
          if (sql.includes("FROM compliance_users member")) {
            state.membershipReads += 1;
            return { results: state.claimed ? [member] : [] };
          }
          if (sql.includes("FROM compliance_invitations invitation")) {
            state.invitationReads += 1;
            return { results: [invitation] };
          }
          throw new Error(`Unexpected all query: ${sql}`);
        },
        async run() {
          throw new Error(`Unexpected standalone write: ${sql}`);
        },
      };
      return statement;
    },
    async batch() {
      state.batches += 1;
      state.claimed = true;
      return [];
    },
  };
  return { database, state };
}

function complianceAccessModule(database) {
  return loadTypescriptModule("../src/lib/compliance-access-server.ts", {
    "../../db": { getD1: () => database },
    "./firebase-server": {
      requireFirebaseIdentity: async () => firebaseIdentity,
    },
    "./creditex-schema-guards": {
      ensureCreditexSchemaGuards: async () => {},
    },
  });
}

test("non-claiming compliance lookup leaves a pending invitation untouched", async () => {
  const { database, state } = pendingInvitationDatabase();
  const access = complianceAccessModule(database);

  await assert.rejects(
    access.requireComplianceIdentity(
      firebaseIdentity,
      { claimPendingInvitation: false },
      database,
    ),
    (error) => {
      assert.ok(error instanceof access.ComplianceAccessError);
      assert.equal(error.code, "COMPLIANCE_ACCESS_REQUIRED");
      return true;
    },
  );
  assert.equal(state.membershipReads, 1);
  assert.equal(state.invitationReads, 0);
  assert.equal(state.batches, 0);
  assert.equal(state.claimed, false);
});

test("explicit compliance onboarding keeps invitation claiming enabled by default", async () => {
  const { database, state } = pendingInvitationDatabase();
  const access = complianceAccessModule(database);

  const identity = await access.requireComplianceIdentity(
    firebaseIdentity,
    {},
    database,
  );
  assert.equal(identity.role, "admin");
  assert.equal(state.membershipReads, 2);
  assert.equal(state.invitationReads, 1);
  assert.equal(state.batches, 1);
  assert.equal(state.claimed, true);
});

test("calculator access requests a non-claiming compliance lookup", async () => {
  class MockComplianceAccessError extends Error {}
  class MockTradeAccessError extends Error {}
  let complianceOptions;
  const installerAccess = { identity: firebaseIdentity };
  const calculatorAccess = loadTypescriptModule(
    "../src/lib/creditex-calculator-access-server.ts",
    {
      "./compliance-access-server": {
        ComplianceAccessError: MockComplianceAccessError,
        requireComplianceIdentity: async (_identity, options) => {
          complianceOptions = options;
          throw new MockComplianceAccessError("No existing membership");
        },
      },
      "./firebase-server": {
        requireFirebaseIdentity: async () => firebaseIdentity,
      },
      "./trade-access-server": {
        TradeAccessError: MockTradeAccessError,
        requireVerifiedTradeIdentity: async () => installerAccess,
      },
    },
  );

  const result = await calculatorAccess.requireCreditexCalculatorAccess(
    new Request("https://compare.ausenergyassessments.com/api/creditex/program-estimates"),
    {},
  );
  assert.equal(complianceOptions.claimPendingInvitation, false);
  assert.equal(result.accessType, "installer");
  assert.equal(result.identity, installerAccess);
});

test("calculator access permits only an explicitly enabled anonymous quote", async () => {
  class MockComplianceAccessError extends Error {}
  class MockTradeAccessError extends Error {}
  let firebaseReads = 0;
  const calculatorAccess = loadTypescriptModule(
    "../src/lib/creditex-calculator-access-server.ts",
    {
      "./compliance-access-server": {
        ComplianceAccessError: MockComplianceAccessError,
        requireComplianceIdentity: async () => {
          throw new Error("Public quote must not probe compliance membership");
        },
      },
      "./firebase-server": {
        requireFirebaseIdentity: async () => {
          firebaseReads += 1;
          throw new Error("AUTH_REQUIRED");
        },
      },
      "./trade-access-server": {
        TradeAccessError: MockTradeAccessError,
        requireVerifiedTradeIdentity: async () => {
          throw new Error("Public quote must not probe installer membership");
        },
      },
    },
  );

  const request = new Request(
    "https://compare.ausenergyassessments.com/api/creditex/program-estimates",
  );
  const result = await calculatorAccess.requireCreditexCalculatorAccess(
    request,
    {},
    { allowPublicQuote: true },
  );
  assert.deepEqual(result, { accessType: "public_quote", identity: null });
  assert.equal(firebaseReads, 0);

  await assert.rejects(
    calculatorAccess.requireCreditexCalculatorAccess(request, {}),
    /AUTH_REQUIRED/,
  );
  assert.equal(firebaseReads, 1);
});

test("an invalid supplied credential never falls back to public quote access", async () => {
  class MockComplianceAccessError extends Error {}
  class MockTradeAccessError extends Error {}
  const calculatorAccess = loadTypescriptModule(
    "../src/lib/creditex-calculator-access-server.ts",
    {
      "./compliance-access-server": {
        ComplianceAccessError: MockComplianceAccessError,
        requireComplianceIdentity: async () => {
          throw new MockComplianceAccessError("No membership");
        },
      },
      "./firebase-server": {
        requireFirebaseIdentity: async () => {
          throw new Error("AUTH_REQUIRED");
        },
      },
      "./trade-access-server": {
        TradeAccessError: MockTradeAccessError,
        requireVerifiedTradeIdentity: async () => {
          throw new MockTradeAccessError("No installer");
        },
      },
    },
  );

  await assert.rejects(
    calculatorAccess.requireCreditexCalculatorAccess(
      new Request(
        "https://compare.ausenergyassessments.com/api/creditex/program-estimates",
        { headers: { Authorization: "Bearer invalid" } },
      ),
      {},
      { allowPublicQuote: true },
    ),
    /AUTH_REQUIRED/,
  );
});

test("missing and malformed Firebase credentials return a typed 401 without credential details", async () => {
  const malformedCredential = "credential-that-must-not-appear";
  const requests = [
    new Request("https://compare.ausenergyassessments.com/api/creditex/program-estimates"),
    new Request("https://compare.ausenergyassessments.com/api/creditex/program-estimates", {
      headers: { Authorization: `Bearer ${malformedCredential}` },
    }),
  ];
  for (const request of requests) {
    await assert.rejects(requireFirebaseIdentity(request), (error) => {
      assert.ok(error instanceof FirebaseAuthError);
      assert.equal(error.code, "AUTH_REQUIRED");
      assert.equal(error.status, 401);
      assert.equal(error.message, "AUTH_REQUIRED");
      assert.equal(String(error).includes(malformedCredential), false);
      return true;
    });
  }
});

test("expired Firebase credentials map to the same typed 401 without leaking JOSE details", async () => {
  const rejectedDetail = "expired-token-detail-that-must-not-appear";
  const expiredFirebase = loadTypescriptModule("../src/lib/firebase-server.ts", {
    jose: {
      createRemoteJWKSet: () => ({}),
      errors,
      jwtVerify: async () => {
        throw new errors.JWTExpired(
          rejectedDetail,
          { sub: firebaseIdentity.uid },
          "exp",
          "check_failed",
        );
      },
    },
  });

  await assert.rejects(
    expiredFirebase.requireFirebaseIdentity(new Request(
      "https://compare.ausenergyassessments.com/api/creditex/program-estimates",
      { headers: { Authorization: "Bearer expired-credential" } },
    )),
    (error) => {
      assert.ok(error instanceof expiredFirebase.FirebaseAuthError);
      assert.equal(error.code, "AUTH_REQUIRED");
      assert.equal(error.status, 401);
      assert.equal(error.message, "AUTH_REQUIRED");
      assert.equal(String(error).includes(rejectedDetail), false);
      assert.equal(String(error).includes("expired-credential"), false);
      return true;
    },
  );
});
