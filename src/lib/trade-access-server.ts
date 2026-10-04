import { getD1 } from "../../db";
import {
  requireFirebaseIdentity,
  type FirebaseIdentity,
} from "./firebase-server";
import { ensureCreditexSchemaGuards } from "./creditex-schema-guards";
import { isValidAbn, normalizeAbn } from "./trade-abn";
import { requireTradeMyobSecondFactor } from "./trade-mfa-server";

import { approvedTradeReviewPredicate } from "./trade-account-predicates";
export { approvedTradeReviewPredicate, verifiedTradeAccountPredicate } from "./trade-account-predicates";

export type TradePartnerType = "installer" | "supplier";

export type TradeAccountProjection = {
  firebaseUid: string;
  email: string;
  businessName: string;
  abn: string;
  partnerType: TradePartnerType;
  accountStatus: string;
  verificationStatus: string;
  verifiedAbn: string;
  verificationReviewId: string;
  verificationReviewedAt: string;
  verificationReviewedByUid: string;
  approvalReviewExists: boolean;
  approvedAbnAccess: boolean;
};

export type VerifiedTradeAccess = TradeAccountProjection & {
  identity: FirebaseIdentity;
};

type AccessOptions = {
  partnerTypes?: readonly TradePartnerType[];
};

export class TradeAccessError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    status: number,
    message: string,
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function approvedAbnAccess(
  account: Pick<
    TradeAccountProjection,
    | "abn"
    | "accountStatus"
    | "verificationStatus"
    | "verifiedAbn"
    | "verificationReviewId"
    | "verificationReviewedAt"
    | "verificationReviewedByUid"
    | "approvalReviewExists"
  > & { partnerType: unknown },
) {
  const abn = normalizeAbn(account.abn);
  return (
    (account.partnerType === "installer" || account.partnerType === "supplier") &&
    account.accountStatus === "active" &&
    account.verificationStatus === "approved" &&
    isValidAbn(abn) &&
    normalizeAbn(account.verifiedAbn) === abn &&
    Boolean(account.verificationReviewId) &&
    Boolean(account.verificationReviewedAt) &&
    Boolean(account.verificationReviewedByUid) &&
    account.approvalReviewExists
  );
}

export async function tradeAccountProjection(firebaseUid: string) {
  const row = await getD1().prepare(`SELECT account.firebase_uid, account.email,
      account.business_name, account.abn, account.partner_type, account.account_status,
      account.verification_status, account.verified_abn, account.verification_review_id,
      account.verification_reviewed_at, account.verification_reviewed_by_uid,
      CASE WHEN ${approvedTradeReviewPredicate("account")} THEN 1 ELSE 0 END approval_review_exists
    FROM trade_accounts account WHERE account.firebase_uid = ?`)
    .bind(firebaseUid)
    .first<Record<string, unknown>>();
  if (!row) return null;
  if (row.partner_type !== "installer" && row.partner_type !== "supplier") {
    throw new TradeAccessError(
      "TRADE_ROLE_REQUIRED",
      403,
      "This trade account role cannot use TLink operations.",
    );
  }
  const projection: TradeAccountProjection = {
    firebaseUid: String(row.firebase_uid),
    email: String(row.email),
    businessName: String(row.business_name),
    abn: normalizeAbn(row.abn),
    partnerType: row.partner_type,
    accountStatus: String(row.account_status),
    verificationStatus: String(row.verification_status),
    verifiedAbn: normalizeAbn(row.verified_abn),
    verificationReviewId: String(row.verification_review_id || ""),
    verificationReviewedAt: String(row.verification_reviewed_at || ""),
    verificationReviewedByUid: String(row.verification_reviewed_by_uid || ""),
    approvalReviewExists: Boolean(row.approval_review_exists),
    approvedAbnAccess: false,
  };
  projection.approvedAbnAccess = approvedAbnAccess(projection);
  return projection;
}

export async function requireVerifiedTradeIdentity(
  identity: FirebaseIdentity,
  options: AccessOptions = {},
): Promise<VerifiedTradeAccess> {
  if (!identity.emailVerified) {
    throw new TradeAccessError(
      "EMAIL_VERIFICATION_REQUIRED",
      403,
      "Verify the account email before using TLink.",
    );
  }
  await ensureCreditexSchemaGuards(getD1());
  const account = await tradeAccountProjection(identity.uid);
  if (!account) {
    throw new TradeAccessError(
      "PROFILE_REQUIRED",
      403,
      "Complete the business profile before using TLink.",
    );
  }
  if (account.accountStatus !== "active") {
    throw new TradeAccessError(
      "ACCOUNT_INACTIVE",
      403,
      "This trade account is not active.",
    );
  }
  if (options.partnerTypes && !options.partnerTypes.includes(account.partnerType)) {
    throw new TradeAccessError(
      "TRADE_ROLE_REQUIRED",
      403,
      "This trade account role cannot use that operation.",
    );
  }
  if (!account.approvedAbnAccess) {
    throw new TradeAccessError(
      "ABN_REVIEW_REQUIRED",
      403,
      "ABN review and trade approval are required before using TLink operations.",
    );
  }
  await requireTradeMyobSecondFactor(identity, identity.uid);
  return { ...account, identity };
}

export async function requireVerifiedTradeAccess(
  request: Request,
  options: AccessOptions = {},
) {
  const identity = await requireFirebaseIdentity(request);
  assertTradeOwnerContext(request, identity);
  return requireVerifiedTradeIdentity(
    identity,
    options,
  );
}

/** Owner-only tools must never act on the actor's own business while a different team is selected. */
export function assertTradeOwnerContext(request: Request, identity: FirebaseIdentity) {
  const selected = request.headers.get("X-TLink-Business");
  if (selected !== null && selected !== identity.uid) {
    throw new TradeAccessError("BUSINESS_OWNER_CONTEXT_REQUIRED", 403,
      "This tool is for your own business. Switch to your business to use it.");
  }
}
