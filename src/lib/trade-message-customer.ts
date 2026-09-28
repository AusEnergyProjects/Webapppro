import { normalizeAustralianMobile } from "./service-reminder-delivery";

// SMS intake still creates the canonical CRM customer. Reuse an existing number
// and deterministic IDs so retrying Save & chat cannot create another contact.
export async function messageCustomerIdentity(db: D1Database, ownerUid: string, phoneInput: unknown) {
  const phone = normalizeAustralianMobile(phoneInput);
  if (!phone) throw new Error("MESSAGE_CUSTOMER_PHONE_INVALID");
  const compact = "replace(replace(replace(replace(replace(phone,' ',''),'-',''),'(',''),')',''),'+','')";
  const rows = (await db.prepare(`SELECT id,customer_number FROM trade_crm_customers WHERE firebase_uid=? AND record_status='active'
    AND ${compact} IN (?,?) LIMIT 2`).bind(ownerUid, phone.slice(1), `0${phone.slice(3)}`).all<{id:string;customer_number:string}>()).results;
  if (rows.length > 1) throw new Error("MESSAGE_CUSTOMER_AMBIGUOUS");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([ownerUid, phone]))))].map(byte => byte.toString(16).padStart(2,"0")).join("");
  const id = `sms-customer-${hash.slice(0,48)}`;
  const previous = await db.prepare("SELECT id FROM trade_crm_customers WHERE id=? AND firebase_uid=? AND record_status<>'active'").bind(id,ownerUid).first();
  if (previous && !rows.length) throw new Error("MESSAGE_CUSTOMER_ARCHIVED");
  return { phone, id, existing: rows[0] || null };
}
