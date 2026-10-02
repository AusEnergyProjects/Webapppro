export type PortalConnectCustomer = {
  id: string;
  name: string;
  email: string;
  phone: string;
  jobNumber: string;
  jobTitle: string;
  activity: string;
  address: string;
  installer: string;
  headsetAllowed: boolean;
  source?: "certificate" | "enquiry" | "account";
};
export type PortalConnectCustomers = { customers: PortalConnectCustomer[]; page: number; hasNext: boolean; nextCursor?: string; searchLimited?: boolean };

export function customerEmailHref(email: string) {
  return /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(email) ? `mailto:${encodeURIComponent(email)}` : "";
}
export function customerPhoneHref(phone: string) {
  const number = phone.replace(/[\s().-]/g, "");
  return /^\+?\d{8,15}$/.test(number) ? `tel:${number}` : "";
}
