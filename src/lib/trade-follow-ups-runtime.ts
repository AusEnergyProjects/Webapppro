import type { TeamAccess } from "./trade-team-server";
import { verifiedTradeAccountPredicate } from "./trade-access-server";
import { resolveTradeEmailRecipient } from "./trade-email-recipient-server";
import { sendTradeCustomerEmail } from "./trade-email-server";
import { scanAutomaticFollowUps, drainFollowUps, type FollowUpServices } from "./trade-follow-ups-server";

export function followUpServices(db:D1Database):FollowUpServices {
  return {
    async ownerAccess(ownerUid):Promise<TeamAccess> {
      const account=await db.prepare(`SELECT a.business_name,a.email FROM trade_accounts a WHERE a.firebase_uid=? AND a.partner_type='installer'
        AND ${verifiedTradeAccountPredicate("a")}`).bind(ownerUid).first<{business_name:string;email:string}>();
      if (!account) throw new Error("EMAIL_ACCESS_REQUIRED");
      return {ownerUid,actorUid:"system:follow-up",actorEmail:account.email,memberId:"",displayName:account.business_name,businessName:account.business_name,
        isOwner:true,jobScope:"team",scheduleScope:"team",canCreateJobs:false,canManageJobs:true,canAssignJobs:false,canViewCustomers:true,canManageCustomers:false,
        canViewQuotes:true,canManageQuotes:false,canSendQuotes:true,canViewInvoices:true,canManageInvoices:true,canViewPriceBook:false,canManagePriceBook:false,
        canApplyDiscounts:false,canRescheduleJobs:false,canManageTeam:false,canEditTeamPermissions:false,canViewFieldEvidence:false,canManageFieldEvidence:false,
        canManageForms:false,canRunReports:false,canSearchCustomers:false,canReceiveCustomerQaNotifications:true};
    },
    recipient:(access,workOrderId)=>resolveTradeEmailRecipient(access,{workOrderId},db),
    send:(ownerUid,actorUid,message,beforeSend)=>sendTradeCustomerEmail(ownerUid,actorUid,{...message,channel:"email",callbackUrl:"",messageType:"trade_follow_up"},{db,requireConnection:true,beforeSend}),
  };
}
export async function processBusinessFollowUps(db:D1Database) {
  const services=followUpServices(db);
  await scanAutomaticFollowUps(db,services);
  await drainFollowUps(db,services);
}
