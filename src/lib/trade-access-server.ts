import { getD1 } from "../../db";
import {
  requireFirebaseIdentity,
  type FirebaseIdentity,
} from "./firebase-server";
import { ensureCreditexSchemaGuards } from "./creditex-schema-guards";
import { isValidAbn, normalizeAbn } from "./trade-abn";

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

function checkedSqlAlias(alias: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error("A static SQL table alias is required.");
  }
  return alias;
}

function validAbnSqlPredicate(alias: string) {
  const account = checkedSqlAlias(alias);
  return `length(${account}.abn) = 11
    AND ${account}.abn NOT GLOB '*[^0-9]*'
    AND (
      ((CAST(substr(${account}.abn, 1, 1) AS INTEGER) - 1) * 10)
      + (CAST(substr(${account}.abn, 2, 1) AS INTEGER) * 1)
      + (CAST(substr(${account}.abn, 3, 1) AS INTEGER) * 3)
      + (CAST(substr(${account}.abn, 4, 1) AS INTEGER) * 5)
      + (CAST(substr(${account}.abn, 5, 1) AS INTEGER) * 7)
      + (CAST(substr(${account}.abn, 6, 1) AS INTEGER) * 9)
      + (CAST(substr(${account}.abn, 7, 1) AS INTEGER) * 11)
      + (CAST(substr(${account}.abn, 8, 1) AS INTEGER) * 13)
      + (CAST(substr(${account}.abn, 9, 1) AS INTEGER) * 15)
      + (CAST(substr(${account}.abn, 10, 1) AS INTEGER) * 17)
      + (CAST(substr(${account}.abn, 11, 1) AS INTEGER) * 19)
    ) % 89 = 0`;
}

export function approvedTradeReviewPredicate(alias: string) {
  const account = checkedSqlAlias(alias);
  return `${account}.verification_review_id <> ''
    AND EXISTS (
      SELECT 1 FROM trade_account_verification_reviews verified_review
      WHERE verified_review.id = ${account}.verification_review_id
        AND verified_review.firebase_uid = ${account}.firebase_uid
        AND verified_review.abn = ${account}.verified_abn
        AND verified_review.business_name = ${account}.business_name
        AND verified_review.partner_type = ${account}.partner_type
        AND verified_review.decision = 'approved'
        AND verified_review.review_method = 'official_abr_lookup'
        AND verified_review.reviewed_by_uid = ${account}.verification_reviewed_by_uid
        AND verified_review.reviewed_at = ${account}.verification_reviewed_at
    )`;
}

export function verifiedTradeAccountPredicate(alias: string) {
  const account = checkedSqlAlias(alias);
  return `${account}.partner_type IN ('installer', 'supplier')
    AND ${account}.account_status = 'active'
    AND ${account}.verification_status = 'approved'
    AND ${account}.verified_abn = ${account}.abn
    AND ${account}.verified_abn <> ''
    AND ${validAbnSqlPredicate(account)}
    AND ${account}.verification_reviewed_at <> ''
    AND ${account}.verification_reviewed_by_uid <> ''
    AND ${approvedTradeReviewPredicate(account)}`;
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
  return { ...account, identity };
}

export async function requireVerifiedTradeAccess(
  request: Request,
  options: AccessOptions = {},
) {
  return requireVerifiedTradeIdentity(
    await requireFirebaseIdentity(request),
    options,
  );
}
