export type AdminProductEnquiry = {
  id: string;
  status: string;
  message: string;
  supplierNote: string;
  createdAt: string;
  updatedAt: string;
  listId: string;
  listName: string;
  projectPostcode: string;
  installerBusiness: string;
  installerEmail: string;
  supplierBusiness: string;
  supplierEmail: string;
  itemCount: number;
  subtotalCentsExGst: number;
};

export type ProductEnquirySummary = { total: number; open: number; responded: number; valueCents: number };

export function summariseProductEnquiries(enquiries: AdminProductEnquiry[]): ProductEnquirySummary {
  return {
    total: enquiries.length,
    open: enquiries.filter((item) => ["new", "viewed"].includes(item.status)).length,
    responded: enquiries.filter((item) => item.status === "responded").length,
    valueCents: enquiries.reduce((total, item) => total + item.subtotalCentsExGst, 0),
  };
}
