export type CustomerDeliveryTab = "quote" | "invoice" | "summary" | "schedule" | "messages" | "files";
export type CustomerDeliveryPermissions = {
  canViewQuotes: boolean;
  canSendQuotes: boolean;
  canViewInvoices: boolean;
  canManageInvoices: boolean;
  canViewCustomers: boolean;
  canRescheduleJobs: boolean;
  crewLead?: boolean;
};

/** Visibility is a UI hint only; the server checks current membership and grants. */
export function canReviewCustomerDeliveries(permissions?: CustomerDeliveryPermissions): boolean {
  return !permissions || (!permissions.crewLead && (
    (permissions.canViewQuotes && permissions.canSendQuotes)
    || (permissions.canViewInvoices && permissions.canManageInvoices)
    || (permissions.canViewCustomers && permissions.canRescheduleJobs)
  ));
}
export type CustomerDeliveryException = {
  id: string;
  workOrderId: string;
  workNumber: string;
  jobTitle: string;
  label: string;
  status: "failed" | "uncertain" | "blocked";
  message: string;
  updatedAt: string;
  tab: CustomerDeliveryTab;
};
export type CustomerDeliveryExceptions = {
  items: CustomerDeliveryException[];
  total: number;
  page: number;
  hasNext: boolean;
};
