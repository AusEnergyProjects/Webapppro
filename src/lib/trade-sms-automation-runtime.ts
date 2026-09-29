import { verifiedTradeAccountPredicate } from "./trade-access-server";
import { sendTradeSms } from "./trade-sms-server";
import { scanSmsAutomations, type SmsAutomationServices } from "./trade-sms-automation-server";

export function smsAutomationServices(db: D1Database): SmsAutomationServices {
  return {
    async ownerAccess(ownerUid) {
      const account = await db.prepare(`SELECT a.business_name FROM trade_accounts a WHERE a.firebase_uid=? AND a.partner_type='installer' AND ${verifiedTradeAccountPredicate("a")}`)
        .bind(ownerUid).first<{ business_name: string }>();
      if (!account) throw new Error("SMS_JOB_ACCESS_REQUIRED");
      return { ownerUid, actorUid: "system:sms-automation", memberId: "", displayName: "Automatic SMS", isOwner: true, businessName: account.business_name, canSendSms: true };
    },
    send: (actor, customerId, body, requestId, workOrderId, purpose, automation) => sendTradeSms(actor, customerId, body, requestId, workOrderId, db, fetch, { purpose, automation }),
  };
}
export async function processSmsAutomations(db: D1Database) {
  await scanSmsAutomations(db, smsAutomationServices(db));
}
