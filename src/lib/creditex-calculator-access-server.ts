import {
  ComplianceAccessError,
  requireComplianceIdentity,
  type ComplianceIdentity,
} from "./compliance-access-server";
import {
  requireFirebaseIdentity,
} from "./firebase-server";
import {
  requireVerifiedTradeIdentity,
  TradeAccessError,
  type VerifiedTradeAccess,
} from "./trade-access-server";

export type CreditexCalculatorAccess =
  | { accessType: "compliance"; identity: ComplianceIdentity }
  | { accessType: "installer"; identity: VerifiedTradeAccess };

export class CreditexCalculatorAccessError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function requireCreditexCalculatorAccess(
  request: Request,
  database?: D1Database,
): Promise<CreditexCalculatorAccess> {
  const identity = await requireFirebaseIdentity(request);

  try {
    const complianceIdentity = await requireComplianceIdentity(identity, {
      allowedRoles: ["admin", "case_manager", "reviewer", "auditor"],
      claimPendingInvitation: false,
    }, database);
    return { accessType: "compliance", identity: complianceIdentity };
  } catch (error) {
    if (!(error instanceof ComplianceAccessError)) throw error;
  }

  try {
    const tradeIdentity = await requireVerifiedTradeIdentity(identity, {
      partnerTypes: ["installer"],
    });
    return { accessType: "installer", identity: tradeIdentity };
  } catch (error) {
    if (!(error instanceof TradeAccessError)) throw error;
    throw new CreditexCalculatorAccessError(
      "CREDITEX_CALCULATOR_ACCESS_REQUIRED",
      403,
      "An active Creditex membership or verified installer account is required to use this calculator.",
    );
  }
}
