export type DirectCustomerDuplicateInput = {
  email?: unknown;
  phone?: unknown;
  businessNumber?: unknown;
  addressLine1?: unknown;
  suburb?: unknown;
  addressState?: unknown;
  postcode?: unknown;
};

export type DirectCustomerDuplicate = {
  customerId: string;
  customerNumber: string;
  customerType: string;
  displayName: string;
  firstName: string;
  lastName: string;
  businessName: string;
  email: string;
  phone: string;
  serviceSiteId: string;
  siteLabel: string;
  addressLine1: string;
  suburb: string;
  addressState: string;
  postcode: string;
  reasons: string[];
};

const text = (value: unknown) => String(value || "").trim();
const normalEmail = (value: unknown) => text(value).toLowerCase();
const normalPhone = (value: unknown) => text(value).replace(/\D/g, "");
const normalAddress = (value: DirectCustomerDuplicateInput) => [value.addressLine1, value.suburb, value.addressState, value.postcode]
  .map((item) => text(item).toLowerCase()).join("|");

export async function findDirectCustomerDuplicates(db: D1Database, uid: string, input: DirectCustomerDuplicateInput): Promise<DirectCustomerDuplicate[]> {
  const email = normalEmail(input.email);
  const phone = normalPhone(input.phone);
  const businessNumber = normalPhone(input.businessNumber);
  const address = normalAddress(input);
  if (!email && !phone && !businessNumber && !address.replaceAll("|", "")) return [];
  const rows = await db.prepare(`SELECT c.id, c.customer_number, c.customer_type, c.first_name, c.last_name, c.business_name,
      c.business_number, c.email, c.phone, s.id service_site_id, s.site_label, s.address_line_1, s.suburb, s.address_state, s.postcode,
      COALESCE(GROUP_CONCAT(DISTINCT cc.email), '') contact_emails, COALESCE(GROUP_CONCAT(DISTINCT cc.phone), '') contact_phones
    FROM trade_crm_customers c
    LEFT JOIN trade_crm_customer_contacts cc ON cc.customer_id = c.id AND cc.firebase_uid = c.firebase_uid AND cc.record_status = 'active'
    LEFT JOIN trade_crm_service_sites s ON s.customer_id = c.id AND s.firebase_uid = c.firebase_uid AND s.record_status = 'active'
    WHERE c.firebase_uid = ? AND c.record_status = 'active'
    GROUP BY c.id, s.id ORDER BY c.updated_at DESC LIMIT 500`).bind(uid).all<Record<string, unknown>>();
  return rows.results.flatMap((row) => {
    const reasons: string[] = [];
    const emails = [row.email, ...String(row.contact_emails || "").split(",")].map(normalEmail).filter(Boolean);
    const phones = [row.phone, ...String(row.contact_phones || "").split(",")].map(normalPhone).filter(Boolean);
    if (email && emails.includes(email)) reasons.push("email");
    if (phone && phones.includes(phone)) reasons.push("phone");
    if (businessNumber && normalPhone(row.business_number) === businessNumber) reasons.push("business number");
    if (address.replaceAll("|", "") && normalAddress({ addressLine1: row.address_line_1, suburb: row.suburb, addressState: row.address_state, postcode: row.postcode }) === address) reasons.push("service address");
    return reasons.length ? [{ customerId: String(row.id), customerNumber: String(row.customer_number),
      customerType: String(row.customer_type || "residential"),
      displayName: String(row.business_name || [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unnamed customer"),
      firstName: String(row.first_name || ""), lastName: String(row.last_name || ""),
      businessName: String(row.business_name || ""), email: String(row.email || ""), phone: String(row.phone || ""),
      serviceSiteId: String(row.service_site_id || ""), siteLabel: String(row.site_label || ""),
      addressLine1: String(row.address_line_1 || ""), suburb: String(row.suburb || ""),
      addressState: String(row.address_state || ""), postcode: String(row.postcode || ""), reasons }] : [];
  });
}

export async function directCustomerHasEmail(db: D1Database, uid: string, customerId: string, emailInput: unknown) {
  const email = normalEmail(emailInput);
  if (!email) return false;
  const match = await db.prepare(`SELECT 1 matched
    FROM trade_crm_customers c
    LEFT JOIN trade_crm_customer_contacts cc ON cc.customer_id = c.id
      AND cc.firebase_uid = c.firebase_uid AND cc.record_status = 'active'
    WHERE c.id = ? AND c.firebase_uid = ? AND c.record_status = 'active'
      AND (lower(c.email) = ? OR lower(cc.email) = ?)
    LIMIT 1`).bind(customerId, uid, email, email).first<Record<string, unknown>>();
  return Boolean(match?.matched);
}
