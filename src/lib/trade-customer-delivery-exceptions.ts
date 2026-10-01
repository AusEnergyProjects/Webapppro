export type CustomerDeliveryTab = "quote" | "invoice" | "summary" | "messages" | "files";
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
