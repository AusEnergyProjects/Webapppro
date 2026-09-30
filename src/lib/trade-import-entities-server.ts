import type { TradeDataforceImportRow } from "./trade-dataforce-import.ts";
import type { ImportAddress, ImportContact, TradeCrmCsvImportRow } from "./trade-crm-csv-import.ts";

type ImportInput = TradeDataforceImportRow | TradeCrmCsvImportRow;
type Stored = Record<string, unknown>;
const phoneKey = (phone: string) => phone.replace(/\D/g, "").replace(/^61(?=[23478]\d{8}$)/, "0");
const equalText = (left: unknown, right: string) => String(left || "").trim().toLowerCase() === right.trim().toLowerCase();
export async function tradeImportHash(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function exactExistingCustomer(db: D1Database, owner: string, input: ImportInput, address: ImportAddress) {
  if (!input.customer.email && !input.customer.contactPhone) return "";
  const rows = await db.prepare(`SELECT id FROM trade_crm_customers WHERE firebase_uid=? AND record_status='active'
    AND lower(trim(first_name))=? AND lower(trim(last_name))=? AND lower(trim(business_name))=?
    AND lower(trim(email))=? AND replace(replace(replace(phone,' ',''),'-',''),'+','')=?
    AND lower(trim(address_line_1))=? AND lower(trim(suburb))=? AND postcode=? LIMIT 2`)
    .bind(owner, input.customer.firstName.toLowerCase(), input.customer.lastName.toLowerCase(), input.customer.businessName.toLowerCase(),
      input.customer.email.toLowerCase(), input.customer.contactPhone.replace(/[ +\-]/g, ""), address.addressLine1.toLowerCase(), address.suburb.toLowerCase(), address.postcode).all<{ id: string }>();
  if (rows.results.length !== 1) return "";
  const contacts = await db.prepare("SELECT phone FROM trade_crm_customer_contacts WHERE firebase_uid=? AND customer_id=? AND record_status='active'")
    .bind(owner, rows.results[0].id).all<{ phone: string }>();
  const phones = new Set([input.customer.contactPhone, ...contacts.results.map(contact => contact.phone)].filter(Boolean).map(phoneKey));
  if ([input.customer.phone, input.customer.mobile].filter(Boolean).some(phone => !phones.has(phoneKey(phone)))) return "";
  return rows.results[0].id;
}

/** Prepare one atomic entity graph. Callers add their immutable source claim and receipt to the same transaction. */
export async function prepareTradeImportEntities(db: D1Database, owner: string, input: ImportInput,
  options: { prefix: "df" | "csv"; workOrderId: string; workNumber: string; now: string }) {
  const generic = "entityType" in input;
  const hasJob = !generic || input.entityType === "job";
  const address = generic ? input.customerAddress : input.site;
  const { prefix, workOrderId, workNumber, now } = options;
  const identityHash = await tradeImportHash(`${owner}\n${input.customerKey}`);
  const sourceTable = generic ? "trade_csv_import_sources" : "trade_dataforce_sources";
  const priorCustomers = await db.prepare(`SELECT DISTINCT customer_id FROM ${sourceTable} WHERE firebase_uid=? AND customer_key=? LIMIT 2`)
    .bind(owner, input.customerKey).all<{ customer_id: string }>();
  if (priorCustomers.results.length > 1) return { ok: false as const, message: "The source customer key has more than one existing link. Review the links before importing." };
  // Explicit generic source keys remain distinct even if two clients share contact details.
  const customerId = priorCustomers.results[0]?.customer_id || (!generic && await exactExistingCustomer(db, owner, input, address)) || `${prefix}c-${identityHash}`;
  const existingSites = hasJob ? await db.prepare(`SELECT id FROM trade_crm_service_sites WHERE firebase_uid=? AND customer_id=? AND record_status='active'
    AND lower(trim(address_line_1))=? AND address_line_2='' AND lower(trim(suburb))=? AND address_state=? AND postcode=? LIMIT 2`)
    .bind(owner, customerId, input.site.addressLine1.toLowerCase(), input.site.suburb.toLowerCase(), input.site.state, input.site.postcode).all<{ id: string }>() : { results: [] };
  const priorSites = hasJob ? await db.prepare(`SELECT DISTINCT source.service_site_id FROM ${sourceTable} source
    JOIN trade_data_import_rows receipt ON receipt.id=source.import_row_id AND receipt.firebase_uid=source.firebase_uid
    WHERE source.firebase_uid=? AND source.customer_id=? AND source.service_site_id<>'' AND json_extract(receipt.normalized_data,'$.siteKey')=? LIMIT 2`)
    .bind(owner, customerId, input.siteKey).all<{ service_site_id: string }>() : { results: [] };
  if (priorSites.results.length > 1) return { ok: false as const, message: "The original service site has more than one existing link. Review the links before importing." };
  const serviceSiteId = !hasJob ? "" : priorSites.results[0]?.service_site_id || (existingSites.results.length === 1 ? existingSites.results[0].id : `${prefix}s-${await tradeImportHash(`${owner}\n${customerId}\n${input.siteKey}`)}`);
  const savedCustomer = await db.prepare("SELECT record_status,first_name,last_name,business_name,email,phone FROM trade_crm_customers WHERE id=? AND firebase_uid=?").bind(customerId, owner).first<Stored>();
  const savedSite = serviceSiteId ? await db.prepare("SELECT record_status,customer_id,address_line_1,address_line_2,suburb,address_state,postcode FROM trade_crm_service_sites WHERE id=? AND firebase_uid=?").bind(serviceSiteId, owner).first<Stored>() : null;
  if (priorCustomers.results.length && !savedCustomer || priorSites.results.length && !savedSite) return { ok: false as const,
    message: "A previously imported customer or service site was deleted. Its original source remains recorded; it will not be recreated automatically." };
  const customerChanged = savedCustomer && (savedCustomer.record_status !== "active"
    || !equalText(savedCustomer.first_name, input.customer.firstName) || !equalText(savedCustomer.last_name, input.customer.lastName)
    || !equalText(savedCustomer.business_name, input.customer.businessName) || !equalText(savedCustomer.email, input.customer.email)
    || phoneKey(String(savedCustomer.phone || "")) !== phoneKey(input.customer.contactPhone));
  const siteChanged = savedSite && (savedSite.record_status !== "active" || savedSite.customer_id !== customerId
    || !equalText(savedSite.address_line_1, input.site.addressLine1) || savedSite.address_line_2 !== ""
    || !equalText(savedSite.suburb, input.site.suburb) || !equalText(savedSite.address_state, input.site.state) || savedSite.postcode !== input.site.postcode);
  if (customerChanged || siteChanged) return { ok: false as const, message: "The previously imported customer or service site has changed or been archived. Review its current details before linking this source row." };
  const statement = (sql: string, ...values: (string | number)[]) => db.prepare(sql).bind(...values);
  const privateNotes = generic ? [
    input.billing.addressLine1 ? `Original billing address: ${[input.billing.addressLine1, input.billing.suburb, input.billing.state, input.billing.postcode, input.billing.country].filter(Boolean).join(", ")}` : "",
    input.paymentTerms ? `Original payment terms: ${input.paymentTerms}` : "", input.taxRate ? `Original tax rate: ${input.taxRate}` : "",
  ].filter(Boolean).join("\n") : "";
  const statements: D1PreparedStatement[] = [statement(`INSERT INTO trade_crm_customers
    (id,firebase_uid,customer_number,customer_type,first_name,last_name,business_name,business_number,email,phone,address_line_1,address_line_2,suburb,address_state,postcode,tags,private_notes,record_status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'',?,?,?,'["Job import"]',?,'active',?,?) ON CONFLICT(id) DO NOTHING`,
    customerId, owner, `CUS-${prefix.toUpperCase()}-${identityHash.slice(0, 16).toUpperCase()}`, input.customer.businessName ? "business" : "residential",
    input.customer.firstName, input.customer.lastName, input.customer.businessName, generic ? input.customer.businessNumber : "", input.customer.email, input.customer.contactPhone,
    address.addressLine1, address.suburb, address.state, address.postcode, privateNotes, now, now)];
  if (hasJob) statements.push(statement(`INSERT INTO trade_crm_service_sites
    (id,firebase_uid,customer_id,site_label,address_line_1,address_line_2,suburb,address_state,postcode,access_instructions,parking_instructions,hazard_notes,is_primary,record_status,created_at,updated_at)
    SELECT ?,?,?,'Imported service site',?,'',?,?,?,'','','',CASE WHEN EXISTS(SELECT 1 FROM trade_crm_service_sites WHERE firebase_uid=? AND customer_id=? AND record_status='active') THEN 0 ELSE 1 END,'active',?,?
    ON CONFLICT(id) DO NOTHING`, serviceSiteId, owner, customerId, input.site.addressLine1, input.site.suburb, input.site.state, input.site.postcode, owner, customerId, now, now));
  const contacts: ImportContact[] = generic ? input.contacts : [{ ...input.customer, roleLabel: "" }];
  const previousContacts = savedCustomer ? (await db.prepare(`SELECT id,first_name,last_name,email,phone FROM trade_crm_customer_contacts
    WHERE firebase_uid=? AND customer_id=? AND record_status='active'`).bind(owner, customerId).all<Stored>()).results : [];
  const addedContacts = new Set<string>();
  for (const contact of contacts) {
    const phones = [...new Set([contact.mobile, contact.phone].filter(Boolean))];
    if (!phones.length) phones.push("");
    for (const phone of phones) {
      const existing = previousContacts.filter(item => equalText(item.first_name, contact.firstName) && equalText(item.last_name, contact.lastName)
        && equalText(item.email, contact.email) && phoneKey(String(item.phone || "")) === phoneKey(phone));
      const legacyName = generic ? [contact.firstName, contact.lastName].filter(Boolean).join(" ") : input.customer.displayName;
      const contactId = existing.length === 1 ? String(existing[0].id) : `${prefix}p-${await tradeImportHash(`${owner}\n${customerId}\n${legacyName}\n${contact.email}\n${phoneKey(phone)}${generic ? `\n${contact.roleLabel}` : ""}`)}`;
      if (addedContacts.has(contactId)) continue;
      addedContacts.add(contactId);
      const label = generic ? contact.roleLabel : phone && phone === contact.mobile ? "Mobile" : phone ? "Phone" : "Primary contact";
      statements.push(statement(`INSERT INTO trade_crm_customer_contacts
        (id,firebase_uid,customer_id,first_name,last_name,role_label,email,phone,is_primary,record_status,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM trade_crm_customer_contacts WHERE firebase_uid=? AND customer_id=? AND is_primary=1 AND record_status='active') THEN 0 ELSE 1 END,'active',?,?
        ON CONFLICT(id) DO NOTHING`, contactId, owner, customerId, contact.firstName, contact.lastName, label, contact.email, phone, owner, customerId, now, now));
      if (hasJob) statements.push(statement(`INSERT INTO trade_crm_site_contacts
        (id,firebase_uid,service_site_id,customer_contact_id,role_label,is_primary,record_status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'active',?,?) ON CONFLICT(firebase_uid,service_site_id,customer_contact_id) DO NOTHING`,
        `${serviceSiteId}:${contactId}`, owner, serviceSiteId, contactId, label, addedContacts.size === 1 ? 1 : 0, now, now));
    }
  }
  if (hasJob) {
    statements.push(statement(`INSERT INTO trade_work_orders
      (id,firebase_uid,partner_type,work_type,source_type,source_reference,work_number,title,service_category,site_area,stage,priority,scheduled_start,scheduled_end,assignee_member_id,assignee_label,revision,record_status,created_at,updated_at)
      VALUES (?,?,'installer','job','import',?,?,?,?,?,'imported','standard',?,?,'',?,1,'active',?,?)`, workOrderId, owner, input.sourceJobId,
      workNumber, input.job.title, input.job.serviceCategory, [input.site.suburb, input.site.postcode].filter(Boolean).join(" "),
      input.job.scheduledStart, input.job.scheduledEnd, input.worker.displayName, now, now),
    statement(`INSERT INTO trade_crm_job_details
      (id,work_order_id,firebase_uid,crm_customer_id,service_site_id,customer_source,pipeline_stage,description,customer_reference,next_action,tags,estimated_value_cents,quoted_value_cents,invoiced_value_cents,paid_value_cents,quote_status,invoice_status,payment_due_at,created_at,updated_at)
      VALUES (?,?,?,?,?,'trade_owned','imported',?,?,'','["Job import"]',0,0,0,0,'not_started','not_started','',?,?)`,
      `${workOrderId}:detail`, workOrderId, owner, customerId, serviceSiteId,
      generic ? input.job.description : `Imported job ${input.sourceJobId}. Original status: ${input.legacy.status}${input.legacy.subStatus ? ` / ${input.legacy.subStatus}` : ""}.`,
      generic ? input.job.customerReference : input.customer.externalReference, now, now));
    if (generic && input.job.completedWork) statements.push(statement(`INSERT INTO trade_crm_job_notes
      (id,work_order_id,firebase_uid,note_type,body,created_at,updated_at) VALUES (?,?,?,'note',?,?,?)`,
      `${workOrderId}:source-work`, workOrderId, owner, `Original work completed notes:\n${input.job.completedWork}`, now, now));
    if (input.job.scheduledStart) statements.push(statement(`INSERT INTO trade_crm_appointments
      (id,work_order_id,firebase_uid,appointment_type,title,starts_at,ends_at,assignee_member_id,assignee_label,status,notes,revision,created_at,updated_at)
      VALUES (?,?,?,'site_visit',?,?,?,'',?,'imported',?,1,?,?)`, `${workOrderId}:visit`, workOrderId, owner, input.job.title,
      input.job.scheduledStart, input.job.scheduledEnd, input.worker.displayName,
      `Imported appointment ${input.sourceAppId}. Original time retained; worker assignment needs confirmation in TLink.`, now, now));
    statements.push(statement(`INSERT INTO trade_work_order_events (id,work_order_id,firebase_uid,event_type,summary,created_at)
      VALUES (?,?,?,'data_imported',?,?)`, `${workOrderId}:import`, workOrderId, owner, `Imported job ${input.sourceJobId}; source retained without issuing invoices, certificates or customer notifications.`, now),
    statement(`INSERT INTO trade_team_sync_changes (owner_uid,audience_member_id,entity_type,entity_id,operation,revision,changed_at)
      VALUES (?,'','job',?,'upsert',1,?)`, owner, workOrderId, now));
  }
  return { ok: true as const, customerId, serviceSiteId, workOrderId, statements };
}
