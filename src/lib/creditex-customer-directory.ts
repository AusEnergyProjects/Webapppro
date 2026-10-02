export type CreditexCustomer = {
  id: string; name: string; email: string; phone: string; address: string;
  installer: string; jobCount: number;
};
export type CreditexCustomerJob = { id: string; number: string; title: string; activity: string; address: string };
export type CreditexCustomerPage = { customers: CreditexCustomer[]; total: number; page: number; totalPages: number };
export type CreditexCustomerDetail = { customer: CreditexCustomer; jobs: CreditexCustomerJob[]; page: number; totalPages: number };
