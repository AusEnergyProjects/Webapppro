import type { TeamAccess } from "./trade-team-server";

/** UI projection only. Every write still rechecks the current Team grant. */
export function tradeFieldPermissions(access: TeamAccess) {
  return {
    canCreateJobs: access.isOwner || access.canCreateJobs,
    canAssignJobs: access.isOwner || (access.canAssignJobs && access.jobScope === "team" && access.canRescheduleJobs && access.scheduleScope === "team"),
    canViewQuotes: access.isOwner || access.canViewQuotes,
    canManageQuotes: access.isOwner || (access.canViewQuotes && access.canManageQuotes),
    canSendQuotes: access.isOwner || (access.canViewQuotes && access.canManageQuotes && access.canSendQuotes),
    canViewInvoices: access.isOwner || access.canViewInvoices,
    canManageInvoices: access.isOwner || (access.canViewInvoices && access.canManageInvoices),
    canViewPriceBook: access.isOwner || access.canViewPriceBook,
    canManagePriceBook: access.isOwner || (access.canViewPriceBook && access.canManagePriceBook),
    canApplyDiscounts: access.isOwner || access.canApplyDiscounts,
  };
}
