import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import {
  accountingContactReference,
  accountingProviderUrl,
  accountingReference,
  accountingStatus,
  centsFromProvider,
  isAccountingProvider,
  quickBooksFailureDetail,
  type AccountingProvider,
} from "@/lib/trade-accounting";
import { decryptIntegrationCredentials, encryptIntegrationCredentials } from "@/lib/trade-integration-crypto";
import { providerSetting, requireInstallerOperations } from "@/lib/trade-integrations-server";
import { conciseScopeDescription, type AcceptedScopeLine } from "@/lib/trade-commercial-handoff";

export const runtime = "edge";

type Row = Record<string, unknown>;
type MyobAccount = { id: string; code: string; name: string; taxCodeId: string; taxCode: string };
type QuickBooksItem = { id: string; code: string; name: string; taxCode: string };
type InvoiceSource = "accepted_quote" | "quick_invoice";

const MYOB_DEFAULT_COMPANY_FILE_TOKEN = btoa("Administrator:");

class AccountingProviderRequestError extends Error {
  readonly code = "PROVIDER_REQUEST_FAILED";

  constructor(readonly diagnostic: string) {
    super("PROVIDER_REQUEST_FAILED");
  }
}

function accountingErrorCode(error: unknown) {
  return error instanceof AccountingProviderRequestError ? error.code : error instanceof Error ? error.message : "";
}

function accountingErrorDetail(error: unknown) {
  return error instanceof AccountingProviderRequestError ? error.diagnostic : error instanceof Error ? error.message : "PROVIDER_REQUEST_FAILED";
}

function accountingError(error: unknown) {
  const code = accountingErrorCode(error);
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["PROFILE_REQUIRED", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED", "ACCOUNT_INACTIVE"].includes(code)) {
    return adminJson({ ok: false, error: "Accounting export is not available to this account." }, 403);
  }
  if (code === "DIRECT_CUSTOMER_REQUIRED") return adminJson({ ok: false, error: "Accounting export is only available for customers who contacted your business directly. AEA protected customer details cannot be sent to an accounting provider." }, 403);
  if (code === "ACCEPTED_HANDOFF_REQUIRED") return adminJson({ ok: false, error: "Accept a current quote before preparing its accounting draft." }, 409);
  if (code === "QUICK_INVOICE_REQUIRED") return adminJson({ ok: false, error: "Create the TLink quick invoice before preparing its accounting draft." }, 409);
  if (code === "QUICK_INVOICE_CREDITED") return adminJson({ ok: false, error: "This TLink invoice has a credit. Keep it in TLink until provider credit-note export is added." }, 409);
  if (code === "INTEGRATION_REQUIRED") return adminJson({ ok: false, error: "Connect this accounting provider in Integrations first." }, 409);
  if (code === "INTEGRATION_RECONSENT_REQUIRED") return adminJson({ ok: false, error: "Reconnect MYOB in Integrations once so it can access customers, invoices and your income account list." }, 409);
  if (code === "MYOB_COMPANY_FILE_PASSWORD_UNSUPPORTED") return adminJson({ ok: false, error: "The selected MYOB company file did not accept passwordless access. TLink does not collect company-file usernames or passwords, so password-protected files are not supported." }, 409);
  if (code === "MYOB_ACCOUNT_REQUIRED") return adminJson({ ok: false, error: "Choose the MYOB income account that should receive this sale." }, 400);
  if (code === "QUICKBOOKS_ITEM_REQUIRED") return adminJson({ ok: false, error: "Choose the QuickBooks product or service that should receive this sale." }, 400);
  if (code === "DOCUMENT_ALREADY_EXPORTED") return adminJson({ ok: false, error: "This job already has an accounting invoice. Refresh the existing invoice instead of exporting a duplicate." }, 409);
  if (code === "EXPORT_IN_PROGRESS") return adminJson({ ok: false, error: "This invoice is already being prepared. Wait a moment, then refresh the job." }, 409);
  if (code === "ACCOUNTING_DOCUMENT_REQUIRED") return adminJson({ ok: false, error: "Export the invoice before refreshing it." }, 404);
  if (code === "PROVIDER_REQUEST_FAILED") return adminJson({ ok: false, error: "The accounting provider could not complete the request. Check the connection and try again." }, 502);
  return adminJson({ ok: false, error: "The accounting request could not be completed." }, 500);
}

function documentJson(row: Row) {
  return {
    id: String(row.id || ""), workOrderId: String(row.work_order_id || ""), provider: String(row.provider || ""),
    externalNumber: String(row.external_number || ""), externalUrl: String(row.external_url || ""),
    exported: Boolean(row.external_document_id),
    amountCents: Number(row.amount_cents || 0), paidAmountCents: Number(row.paid_amount_cents || 0),
    status: String(row.status || "draft"), providerStatus: String(row.provider_status || ""),
    dueAt: String(row.due_at || ""), lastSyncedAt: String(row.last_synced_at || ""),
    lastError: String(row.last_error || ""), createdAt: String(row.created_at || ""),
    commercialReference: String(row.commercial_reference || ""),
  };
}

function storedScopes(connection: Row | null) {
  try {
    const parsed = JSON.parse(String(connection?.scopes || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}

function needsMyobReconsent(connection: Row | null) {
  const scopes = storedScopes(connection);
  return connection?.status === "connected" && !["sme-sales", "sme-contacts-customer", "sme-general-ledger"].every((scope) => scopes.includes(scope));
}

function invoiceSource(value: unknown): InvoiceSource {
  return cleanAdminText(value, 30).toLowerCase() === "quick_invoice" ? "quick_invoice" : "accepted_quote";
}

async function directJob(firebaseUid: string, workOrderId: string, source: InvoiceSource): Promise<Row> {
  const row = await getD1().prepare(`SELECT w.id, w.work_number, w.title, w.source_type, w.partner_type,
      d.customer_source, d.crm_customer_id, d.invoiced_value_cents, d.paid_value_cents, d.payment_due_at,
      c.customer_number, c.customer_type, c.first_name, c.last_name, c.business_name, c.email, c.phone,
      c.address_line_1, c.address_line_2, c.suburb, c.address_state, c.postcode,
      h.id commercial_handoff_id, h.commercial_reference, h.scope_snapshot_json, h.subtotal_cents accepted_subtotal_cents,
      h.tax_cents accepted_tax_cents, h.total_cents accepted_total_cents, h.accepted_at,
      q.id quick_invoice_id, q.invoice_number, q.line_items_json, q.subtotal_cents quick_subtotal_cents,
      q.tax_cents quick_tax_cents, q.total_cents quick_total_cents, q.due_at quick_due_at,
      COALESCE((SELECT SUM(credit.total_cents) FROM trade_crm_quick_invoice_credits credit
        WHERE credit.invoice_id = q.id AND credit.status = 'issued'), 0) quick_credited_cents
    FROM trade_work_orders w
    LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid AND c.record_status = 'active'
    LEFT JOIN trade_crm_commercial_handovers h ON h.work_order_id = w.id AND h.firebase_uid = w.firebase_uid
      AND h.accepted_at = (SELECT MAX(h2.accepted_at) FROM trade_crm_commercial_handovers h2 WHERE h2.work_order_id = w.id AND h2.firebase_uid = w.firebase_uid)
    LEFT JOIN trade_crm_quick_invoices q ON q.work_order_id = w.id AND q.firebase_uid = w.firebase_uid
    WHERE w.id = ? AND w.firebase_uid = ? AND w.record_status = 'active'`)
    .bind(workOrderId, firebaseUid).first<Row>();
  if (!row || row.partner_type !== "installer" || row.source_type !== "internal" || row.customer_source !== "trade_owned" || !row.crm_customer_id || !row.customer_number) {
    throw new Error("DIRECT_CUSTOMER_REQUIRED");
  }
  if (source === "quick_invoice") {
    if (!row.quick_invoice_id || Number(row.quick_total_cents || 0) <= 0) throw new Error("QUICK_INVOICE_REQUIRED");
    if (Number(row.quick_credited_cents || 0) > 0) throw new Error("QUICK_INVOICE_CREDITED");
    let lines: Row[];
    try { lines = JSON.parse(String(row.line_items_json || "[]")) as Row[]; }
    catch { throw new Error("QUICK_INVOICE_REQUIRED"); }
    const scope: AcceptedScopeLine[] = lines.map((line, index) => ({
      lineId: cleanAdminText(line.lineId, 180) || `line-${index + 1}`,
      section: line.taxCode === "gst" ? "GST taxable" : "GST-free",
      description: cleanAdminText(line.description, 500),
      quantityMilli: Math.max(1, Number(line.quantity || 1)) * 1000,
      subtotalCents: Number(line.subtotalCents || 0),
      taxCents: Number(line.taxCents || 0),
      totalCents: Number(line.totalCents || 0),
    }));
    return { ...row, invoice_source: source, commercial_handoff_id: "", commercial_reference: row.invoice_number,
      scope_snapshot_json: JSON.stringify(scope), accepted_subtotal_cents: row.quick_subtotal_cents,
      accepted_tax_cents: row.quick_tax_cents, accepted_total_cents: row.quick_total_cents, payment_due_at: row.quick_due_at };
  }
  if (!row.commercial_handoff_id || Number(row.accepted_total_cents || 0) <= 0) throw new Error("ACCEPTED_HANDOFF_REQUIRED");
  return { ...row, invoice_source: source };
}

async function connections(firebaseUid: string) {
  const result = await getD1().prepare(`SELECT * FROM trade_crm_integrations
    WHERE firebase_uid = ? AND provider IN ('xero', 'myob', 'quickbooks') ORDER BY provider`).bind(firebaseUid).all<Row>();
  return Object.fromEntries(result.results.map((row) => [String(row.provider), row])) as Partial<Record<AccountingProvider, Row>>;
}

async function connectionFor(firebaseUid: string, provider: AccountingProvider) {
  const row = await getD1().prepare(`SELECT * FROM trade_crm_integrations
    WHERE firebase_uid = ? AND provider = ? AND status = 'connected'`).bind(firebaseUid, provider).first<Row>();
  if (!row) throw new Error("INTEGRATION_REQUIRED");
  if (provider === "myob" && needsMyobReconsent(row)) throw new Error("INTEGRATION_RECONSENT_REQUIRED");
  return row;
}

async function activeCredentials(provider: AccountingProvider, connection: Row) {
  const credentials = await decryptIntegrationCredentials(String(connection.encrypted_credentials || ""));
  const expiresAt = Date.parse(String(connection.token_expires_at || ""));
  if (Number.isFinite(expiresAt) && expiresAt > Date.now() + 2 * 60 * 1000) return credentials;
  if (!credentials.refresh_token) throw new Error("INTEGRATION_REQUIRED");
  const setting = providerSetting(provider);
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: String(credentials.refresh_token) });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (provider === "xero" || provider === "quickbooks") {
    headers.Authorization = `Basic ${btoa(`${setting.clientId}:${setting.clientSecret}`)}`;
  } else {
    body.set("client_id", setting.clientId); body.set("client_secret", setting.clientSecret);
  }
  const response = await fetch(setting.tokenUrl, { method: "POST", headers, body });
  const refreshed = await response.json().catch(() => ({})) as Row;
  if (!response.ok || !refreshed.access_token) throw new Error("INTEGRATION_REQUIRED");
  const next = {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || credentials.refresh_token,
    token_type: refreshed.token_type || credentials.token_type || "bearer",
    external_metadata: credentials.external_metadata,
  };
  const now = new Date().toISOString();
  const tokenExpiresAt = Number(refreshed.expires_in || 0) > 0
    ? new Date(Date.now() + Number(refreshed.expires_in) * 1000).toISOString()
    : "";
  await getD1().prepare(`UPDATE trade_crm_integrations SET encrypted_credentials = ?, token_expires_at = ?,
    last_error = '', updated_at = ? WHERE id = ? AND firebase_uid = ?`)
    .bind(await encryptIntegrationCredentials(next), tokenExpiresAt, now, connection.id, connection.firebase_uid).run();
  return next;
}

async function xeroFetch(connection: Row, credentials: Row, path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${String(credentials.access_token || "")}`,
      "xero-tenant-id": String(connection.external_account_id || ""),
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const result = await response.json().catch(() => ({})) as Row;
  if (!response.ok) throw new Error("PROVIDER_REQUEST_FAILED");
  return { response, result };
}

function myobCompanyBase(externalAccountId: unknown) {
  const value = String(externalAccountId || "").trim();
  let url: URL;
  try {
    url = new URL(/^https:\/\//i.test(value) ? value : `https://api.myob.com/accountright/${encodeURIComponent(value)}`);
  } catch { throw new Error("INTEGRATION_REQUIRED"); }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "api.myob.com") throw new Error("INTEGRATION_REQUIRED");
  return url.toString().replace(/\/$/, "");
}

function myobCompanyFileAuthenticationRejected(response: Response, result: Row) {
  const detail = JSON.stringify(result).toLowerCase();
  if (detail.includes("invalid_token") || detail.includes("invalid token") || detail.includes("bearer token")) return false;
  return response.status === 401 || (response.status === 403 && (
    detail.includes("accessdenied") || detail.includes("access denied") || detail.includes("not authorised")
  ));
}

async function myobFetch(connection: Row, credentials: Row, path: string, init: RequestInit = {}) {
  const request = async (companyFileToken = "") => {
    const response = await fetch(`${myobCompanyBase(connection.external_account_id)}/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${String(credentials.access_token || "")}`,
        "x-myobapi-key": providerSetting("myob").clientId,
        "x-myobapi-version": "v2",
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {}),
        ...(companyFileToken ? { "x-myobapi-cftoken": companyFileToken } : {}),
      },
    });
    return { response, result: await response.json().catch(() => ({})) as Row };
  };

  const first = await request();
  if (first.response.ok) return first;
  if (!myobCompanyFileAuthenticationRejected(first.response, first.result)) throw new Error("PROVIDER_REQUEST_FAILED");

  const fallback = await request(MYOB_DEFAULT_COMPANY_FILE_TOKEN);
  if (fallback.response.ok) return fallback;
  if (myobCompanyFileAuthenticationRejected(fallback.response, fallback.result)) {
    throw new Error("MYOB_COMPANY_FILE_PASSWORD_UNSUPPORTED");
  }
  throw new Error("PROVIDER_REQUEST_FAILED");
}

async function quickBooksFetch(connection: Row, credentials: Row, path: string, init: RequestInit = {}) {
  const realmId = cleanAdminText(connection.external_account_id, 80);
  if (!realmId || !/^\d+$/.test(realmId)) throw new Error("INTEGRATION_REQUIRED");
  const response = await fetch(`https://quickbooks.api.intuit.com/v3/company/${encodeURIComponent(realmId)}/${path}`,
    { ...init, headers: { Authorization: `Bearer ${String(credentials.access_token || "")}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) } });
  const result = await response.json().catch(() => ({})) as Row;
  if (!response.ok) {
    throw new AccountingProviderRequestError(quickBooksFailureDetail(response.status, response.headers.get("intuit_tid"), result));
  }
  return { response, result };
}

function escapedFilter(value: string) {
  return value.replaceAll("'", "''");
}

function invoiceDueAt(job: Row) {
  return cleanAdminText(job.payment_due_at, 10) || new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
}

function firstItem(value: unknown) {
  return Array.isArray(value) && value[0] && typeof value[0] === "object" ? value[0] as Row : null;
}

function idFromLocation(response: Response) {
  const location = response.headers.get("location") || "";
  return decodeURIComponent(location.split("/").filter(Boolean).at(-1) || "");
}

async function listMyobAccounts(connection: Row, credentials: Row) {
  const { result } = await myobFetch(connection, credentials, "GeneralLedger/Account?$top=1000&$orderby=Number%20asc");
  const items = Array.isArray(result.Items) ? result.Items as Row[] : [];
  return items.filter((item) => ["Income", "OtherIncome"].includes(String(item.Classification || "")) && item.IsActive !== false && item.IsHeader !== true)
    .map((item): MyobAccount => {
      const tax = item.TaxCode && typeof item.TaxCode === "object" ? item.TaxCode as Row : {};
      return { id: String(item.UID || ""), code: String(item.DisplayID || ""), name: String(item.Name || "Income account"), taxCodeId: String(tax.UID || ""), taxCode: String(tax.Code || "") };
    }).filter((item) => item.id);
}

async function listQuickBooksItems(connection: Row, credentials: Row) {
  const query = encodeURIComponent("SELECT * FROM Item WHERE Active = true MAXRESULTS 1000");
  const { result } = await quickBooksFetch(connection, credentials, `query?query=${query}&minorversion=75`);
  const response = result.QueryResponse && typeof result.QueryResponse === "object" ? result.QueryResponse as Row : {};
  const items = Array.isArray(response.Item) ? response.Item as Row[] : [];
  return items.filter((item) => ["Service", "NonInventory", "Inventory"].includes(String(item.Type || "")))
    .map((item): QuickBooksItem => ({ id: String(item.Id || ""), code: String(item.Sku || ""), name: String(item.Name || "Product or service"), taxCode: String((item.SalesTaxCodeRef as Row | undefined)?.value || "") }))
    .filter((item) => item.id);
}

function acceptedScope(job: Row) {
  try {
    const parsed = JSON.parse(String(job.scope_snapshot_json || "[]"));
    return Array.isArray(parsed) ? parsed as AcceptedScopeLine[] : [];
  } catch { return []; }
}

function providerTaxCents(provider: AccountingProvider, invoice: Row) {
  const value = provider === "xero" ? invoice.TotalTax
    : provider === "myob" ? (invoice.GSTAmount ?? invoice.TotalTax)
      : invoice.TxnTaxDetail && typeof invoice.TxnTaxDetail === "object" ? (invoice.TxnTaxDetail as Row).TotalTax : undefined;
  return value === undefined || value === null || value === "" ? null : centsFromProvider(value);
}

async function findXeroContact(connection: Row, credentials: Row, contactNumber: string) {
  const query = new URLSearchParams({ where: `ContactNumber==\"${contactNumber.replaceAll('"', '')}\"` });
  const { result } = await xeroFetch(connection, credentials, `Contacts?${query}`);
  return firstItem(result.Contacts);
}

async function xeroContact(connection: Row, credentials: Row, job: Row, existingId: string) {
  if (existingId) return existingId;
  const contactNumber = accountingContactReference(String(job.customer_number), 50);
  const existing = await findXeroContact(connection, credentials, contactNumber);
  if (existing?.ContactID) return String(existing.ContactID);
  const displayName = cleanAdminText(job.business_name, 140) || [job.first_name, job.last_name].map((value) => cleanAdminText(value, 80)).filter(Boolean).join(" ") || contactNumber;
  const { result } = await xeroFetch(connection, credentials, "Contacts", {
    method: "POST",
    body: JSON.stringify({ Contacts: [{
      Name: displayName, ContactNumber: contactNumber, FirstName: cleanAdminText(job.first_name, 80), LastName: cleanAdminText(job.last_name, 80),
      EmailAddress: cleanAdminText(job.email, 180), Phones: cleanAdminText(job.phone, 40) ? [{ PhoneType: "DEFAULT", PhoneNumber: cleanAdminText(job.phone, 40) }] : [],
      Addresses: [{ AddressType: "STREET", AddressLine1: cleanAdminText(job.address_line_1, 140), AddressLine2: cleanAdminText(job.address_line_2, 140), City: cleanAdminText(job.suburb, 80), Region: cleanAdminText(job.address_state, 20), PostalCode: cleanAdminText(job.postcode, 12), Country: "Australia" }],
    }] }),
  });
  const created = firstItem(result.Contacts);
  if (!created?.ContactID) throw new Error("PROVIDER_REQUEST_FAILED");
  return String(created.ContactID);
}

async function findXeroInvoice(connection: Row, credentials: Row, invoiceNumber: string) {
  const query = new URLSearchParams({ where: `InvoiceNumber==\"${invoiceNumber.replaceAll('"', '')}\"` });
  const { result } = await xeroFetch(connection, credentials, `Invoices?${query}`);
  return firstItem(result.Invoices);
}

async function createXeroInvoice(connection: Row, credentials: Row, job: Row, contactId: string) {
  const invoiceNumber = accountingReference(String(job.commercial_reference), 50);
  const existing = await findXeroInvoice(connection, credentials, invoiceNumber);
  if (existing?.InvoiceID) return existing;
  const today = new Date().toISOString().slice(0, 10);
  const dueAt = invoiceDueAt(job);
  const { result } = await xeroFetch(connection, credentials, "Invoices", {
    method: "POST",
    body: JSON.stringify({ Invoices: [{
      Type: "ACCREC", Contact: { ContactID: contactId }, InvoiceNumber: invoiceNumber,
      Date: today, DueDate: dueAt, Reference: cleanAdminText(job.commercial_reference, 100), CurrencyCode: "AUD",
      Status: "DRAFT", LineAmountTypes: "Inclusive",
      LineItems: [{ Description: conciseScopeDescription(acceptedScope(job), String(job.title)), Quantity: 1,
        UnitAmount: Number(job.accepted_total_cents || 0) / 100, TaxAmount: Number(job.accepted_tax_cents || 0) / 100 }],
    }] }),
  });
  const created = firstItem(result.Invoices);
  if (!created?.InvoiceID) throw new Error("PROVIDER_REQUEST_FAILED");
  return created;
}

async function findMyobItem(connection: Row, credentials: Row, path: string, field: string, value: string) {
  const query = new URLSearchParams({ "$top": "1", "$filter": `${field} eq '${escapedFilter(value)}'` });
  const { result } = await myobFetch(connection, credentials, `${path}?${query}`);
  return firstItem(result.Items);
}

async function myobContact(connection: Row, credentials: Row, job: Row, existingId: string) {
  if (existingId) return existingId;
  const displayId = accountingContactReference(String(job.customer_number), 15);
  const existing = await findMyobItem(connection, credentials, "Contact/Customer", "DisplayID", displayId);
  if (existing?.UID) return String(existing.UID);
  const businessName = cleanAdminText(job.business_name, 50);
  const payload: Row = {
    IsIndividual: !businessName, DisplayID: displayId, IsActive: true,
    Addresses: [{ Location: 1, Street: [cleanAdminText(job.address_line_1, 140), cleanAdminText(job.address_line_2, 140)].filter(Boolean).join("\n"), City: cleanAdminText(job.suburb, 80), State: cleanAdminText(job.address_state, 20), PostCode: cleanAdminText(job.postcode, 12), Country: "Australia", Phone1: cleanAdminText(job.phone, 21), Email: cleanAdminText(job.email, 180) }],
  };
  if (businessName) payload.CompanyName = businessName;
  else { payload.FirstName = cleanAdminText(job.first_name, 20); payload.LastName = cleanAdminText(job.last_name, 30) || displayId; }
  const { response, result } = await myobFetch(connection, credentials, "Contact/Customer", { method: "POST", body: JSON.stringify(payload) });
  const created = String(result.UID || idFromLocation(response));
  if (!created) throw new Error("PROVIDER_REQUEST_FAILED");
  return created;
}

async function createMyobInvoice(connection: Row, credentials: Row, job: Row, contactId: string, account: MyobAccount) {
  const invoiceNumber = accountingReference(String(job.commercial_reference), 13);
  const existing = await findMyobItem(connection, credentials, "Sale/Invoice/Service", "Number", invoiceNumber);
  if (existing?.UID) return existing;
  const line: Row = {
    Type: "Transaction", Description: conciseScopeDescription(acceptedScope(job), String(job.title)),
    Total: Number(job.accepted_total_cents || 0) / 100, Account: { UID: account.id },
  };
  if (account.taxCodeId) line.TaxCode = { UID: account.taxCodeId };
  const { response, result } = await myobFetch(connection, credentials, "Sale/Invoice/Service", {
    method: "POST",
    body: JSON.stringify({
      Number: invoiceNumber, Date: `${new Date().toISOString().slice(0, 10)} 00:00:00`, Customer: { UID: contactId },
      CustomerPurchaseOrderNumber: cleanAdminText(job.commercial_reference, 100), Lines: [line], InvoiceDeliveryStatus: "Nothing",
      IsTaxInclusive: true,
    }),
  });
  const createdId = String(result.UID || idFromLocation(response));
  if (!createdId) throw new Error("PROVIDER_REQUEST_FAILED");
  return { ...result, UID: createdId, Number: String(result.Number || invoiceNumber), Status: String(result.Status || "Open"), TotalAmount: result.TotalAmount ?? Number(job.accepted_total_cents || 0) / 100, BalanceDueAmount: result.BalanceDueAmount ?? Number(job.accepted_total_cents || 0) / 100 };
}

function quickBooksQueryValue(value: unknown) {
  return String(value || "").replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

async function quickBooksContact(connection: Row, credentials: Row, job: Row, existingId: string) {
  if (existingId) return existingId;
  const customerName = cleanAdminText(job.business_name, 100) || [job.first_name, job.last_name].map((value) => cleanAdminText(value, 80)).filter(Boolean).join(" ") || String(job.customer_number);
  const displayName = `TLink ${cleanAdminText(job.customer_number, 40)} | ${customerName}`.slice(0, 100);
  const query = encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${quickBooksQueryValue(displayName)}' MAXRESULTS 1`);
  const { result: found } = await quickBooksFetch(connection, credentials, `query?query=${query}&minorversion=75`);
  const foundResponse = found.QueryResponse && typeof found.QueryResponse === "object" ? found.QueryResponse as Row : {};
  const existing = firstItem(foundResponse.Customer);
  if (existing?.Id) return String(existing.Id);
  const { result } = await quickBooksFetch(connection, credentials, "customer?minorversion=75", { method: "POST", body: JSON.stringify({
    DisplayName: displayName, CompanyName: cleanAdminText(job.business_name, 100), GivenName: cleanAdminText(job.first_name, 80), FamilyName: cleanAdminText(job.last_name, 80),
    PrimaryEmailAddr: cleanAdminText(job.email, 180) ? { Address: cleanAdminText(job.email, 180) } : undefined,
    PrimaryPhone: cleanAdminText(job.phone, 40) ? { FreeFormNumber: cleanAdminText(job.phone, 40) } : undefined,
    BillAddr: { Line1: cleanAdminText(job.address_line_1, 140), Line2: cleanAdminText(job.address_line_2, 140), City: cleanAdminText(job.suburb, 80), CountrySubDivisionCode: cleanAdminText(job.address_state, 20), PostalCode: cleanAdminText(job.postcode, 12), Country: "Australia" },
  }) });
  const customer = result.Customer && typeof result.Customer === "object" ? result.Customer as Row : {};
  if (!customer.Id) throw new Error("PROVIDER_REQUEST_FAILED");
  return String(customer.Id);
}

async function createQuickBooksInvoice(connection: Row, credentials: Row, job: Row, contactId: string, item: QuickBooksItem) {
  const reference = cleanAdminText(job.commercial_reference, 21);
  const query = encodeURIComponent(`SELECT * FROM Invoice WHERE DocNumber = '${quickBooksQueryValue(reference)}' MAXRESULTS 1`);
  const { result: found } = await quickBooksFetch(connection, credentials, `query?query=${query}&minorversion=75`);
  const foundResponse = found.QueryResponse && typeof found.QueryResponse === "object" ? found.QueryResponse as Row : {};
  const existing = firstItem(foundResponse.Invoice);
  if (existing?.Id) return existing;
  const totalCents = Number(job.accepted_total_cents); const scope = acceptedScope(job);
  const salesDetail: Row = { ItemRef: { value: item.id, name: item.name }, Qty: 1, UnitPrice: totalCents / 100 };
  if (item.taxCode) salesDetail.TaxCodeRef = { value: item.taxCode };
  const { result } = await quickBooksFetch(connection, credentials, "invoice?minorversion=75", { method: "POST", body: JSON.stringify({
    CustomerRef: { value: contactId }, DocNumber: reference, TxnDate: new Date().toISOString().slice(0, 10), DueDate: invoiceDueAt(job),
    PrivateNote: `TLink ${job.invoice_source === "quick_invoice" ? "quick invoice" : "accepted quote"} ${String(job.commercial_reference)}`.slice(0, 4000), CustomerMemo: { value: conciseScopeDescription(scope, String(job.title)).slice(0, 1000) },
    GlobalTaxCalculation: "TaxInclusive", Line: [{ Amount: totalCents / 100, Description: conciseScopeDescription(scope, String(job.title)), DetailType: "SalesItemLineDetail", SalesItemLineDetail: salesDetail }],
  }) });
  const invoice = result.Invoice && typeof result.Invoice === "object" ? result.Invoice as Row : {};
  if (!invoice.Id) throw new Error("PROVIDER_REQUEST_FAILED");
  return invoice;
}

async function documentRow(firebaseUid: string, workOrderId: string) {
  return getD1().prepare(`SELECT * FROM trade_crm_accounting_documents
    WHERE firebase_uid = ? AND work_order_id = ? AND document_type = 'invoice'`).bind(firebaseUid, workOrderId).first<Row>();
}

async function addEvent(document: Row, action: string, status: string, providerStatus: string, amountCents: number, paidAmountCents: number, detail = "") {
  await getD1().prepare(`INSERT INTO trade_crm_accounting_events
    (id, accounting_document_id, work_order_id, firebase_uid, provider, action, status, provider_status,
     amount_cents, paid_amount_cents, detail, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), document.id, document.work_order_id, document.firebase_uid, document.provider, action, status,
      providerStatus, amountCents, paidAmountCents, detail, new Date().toISOString()).run();
}

async function exportInvoice(firebaseUid: string, provider: AccountingProvider, job: Row, accountReference: string) {
  const amountCents = Number(job.accepted_total_cents || 0);
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error(job.invoice_source === "quick_invoice" ? "QUICK_INVOICE_REQUIRED" : "ACCEPTED_HANDOFF_REQUIRED");
  const connection = await connectionFor(firebaseUid, provider);
  const credentials = await activeCredentials(provider, connection);
  const db = getD1();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const inserted = await db.prepare(`INSERT INTO trade_crm_accounting_documents
    (id, work_order_id, firebase_uid, commercial_handoff_id, commercial_reference, scope_snapshot_json,
     subtotal_cents, tax_cents, provider, document_type, amount_cents, paid_amount_cents, currency,
     status, due_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'invoice', ?, 0, 'AUD', 'exporting', ?, ?, ?)
    ON CONFLICT(firebase_uid, work_order_id, document_type) DO NOTHING`)
    .bind(id, job.id, firebaseUid, job.commercial_handoff_id, job.commercial_reference, job.scope_snapshot_json,
      job.accepted_subtotal_cents, job.accepted_tax_cents, provider, amountCents, invoiceDueAt(job), now, now).run();
  let document = await documentRow(firebaseUid, String(job.id));
  if (!document) throw new Error("PROVIDER_REQUEST_FAILED");
  if (document.commercial_handoff_id !== job.commercial_handoff_id) throw new Error("DOCUMENT_ALREADY_EXPORTED");
  if (document.provider !== provider) throw new Error("DOCUMENT_ALREADY_EXPORTED");
  if (document.external_document_id) return document;
  if (Number(inserted.meta.changes || 0) !== 1) {
    const retryCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const claimed = await db.prepare(`UPDATE trade_crm_accounting_documents SET status = 'exporting', last_error = '', updated_at = ?
      WHERE id = ? AND external_document_id = '' AND (status = 'error' OR (status = 'exporting' AND updated_at < ?))`)
      .bind(now, document.id, retryCutoff).run();
    if (Number(claimed.meta.changes || 0) !== 1) throw new Error("EXPORT_IN_PROGRESS");
    document = await documentRow(firebaseUid, String(job.id));
    if (!document) throw new Error("PROVIDER_REQUEST_FAILED");
  }
  try {
    let externalContactId = String(document.external_contact_id || "");
    let external: Row;
    let selectedAccount = "";
    if (provider === "xero") {
      externalContactId = await xeroContact(connection, credentials, job, externalContactId);
      await db.prepare("UPDATE trade_crm_accounting_documents SET external_contact_id = ?, updated_at = ? WHERE id = ?")
        .bind(externalContactId, now, document.id).run();
      external = await createXeroInvoice(connection, credentials, job, externalContactId);
    } else if (provider === "myob") {
      const accounts = await listMyobAccounts(connection, credentials);
      const account = accounts.find((item) => item.id === accountReference);
      if (!account) throw new Error("MYOB_ACCOUNT_REQUIRED");
      selectedAccount = account.id;
      externalContactId = await myobContact(connection, credentials, job, externalContactId);
      await db.prepare("UPDATE trade_crm_accounting_documents SET external_contact_id = ?, account_reference = ?, updated_at = ? WHERE id = ?")
        .bind(externalContactId, selectedAccount, now, document.id).run();
      external = await createMyobInvoice(connection, credentials, job, externalContactId, account);
    } else {
      const items = await listQuickBooksItems(connection, credentials);
      const item = items.find((entry) => entry.id === accountReference);
      if (!item) throw new Error("QUICKBOOKS_ITEM_REQUIRED");
      selectedAccount = item.id;
      externalContactId = await quickBooksContact(connection, credentials, job, externalContactId);
      await db.prepare("UPDATE trade_crm_accounting_documents SET external_contact_id = ?, account_reference = ?, updated_at = ? WHERE id = ?")
        .bind(externalContactId, selectedAccount, now, document.id).run();
      external = await createQuickBooksInvoice(connection, credentials, job, externalContactId, item);
    }
    const externalId = String(provider === "xero" ? external.InvoiceID : provider === "myob" ? external.UID : external.Id);
    const externalNumber = String(provider === "xero" ? external.InvoiceNumber : provider === "myob" ? external.Number : external.DocNumber);
    const providerStatus = String(external.Status || (provider === "myob" ? "Open" : "DRAFT"));
    const totalCents = centsFromProvider(provider === "xero" ? external.Total : provider === "myob" ? external.TotalAmount : external.TotalAmt) || amountCents;
    if (totalCents !== amountCents) throw new Error("PROVIDER_REQUEST_FAILED");
    const taxCents = providerTaxCents(provider, external);
    if (job.invoice_source === "quick_invoice" && taxCents !== Number(job.accepted_tax_cents || 0)) throw new Error("PROVIDER_REQUEST_FAILED");
    const paidCents = provider === "xero" ? centsFromProvider(external.AmountPaid) : provider === "myob" ? Math.max(0, totalCents - centsFromProvider(external.BalanceDueAmount)) : Math.max(0, totalCents - centsFromProvider(external.Balance));
    const status = accountingStatus(provider, providerStatus, totalCents, paidCents, cleanAdminText(job.payment_due_at, 10));
    const syncedAt = new Date().toISOString();
    await db.batch([
      db.prepare(`UPDATE trade_crm_accounting_documents SET external_contact_id = ?, external_document_id = ?,
        external_number = ?, external_url = ?, account_reference = ?, amount_cents = ?, paid_amount_cents = ?,
        status = ?, provider_status = ?, last_synced_at = ?, last_error = '', updated_at = ? WHERE id = ?`)
        .bind(externalContactId, externalId, externalNumber, accountingProviderUrl(provider, externalId), selectedAccount,
          totalCents, paidCents, status, providerStatus, syncedAt, syncedAt, document.id),
      db.prepare(`UPDATE trade_crm_job_details SET invoiced_value_cents = ?, invoice_status = ?, updated_at = ?
        WHERE work_order_id = ? AND firebase_uid = ?`).bind(totalCents, status, syncedAt, job.id, firebaseUid),
      db.prepare(`UPDATE trade_crm_integrations SET last_sync_at = ?, last_error = '', updated_at = ? WHERE id = ?`)
        .bind(syncedAt, syncedAt, connection.id),
    ]);
    document = await documentRow(firebaseUid, String(job.id));
    if (!document) throw new Error("PROVIDER_REQUEST_FAILED");
    await addEvent(document, "export", status, providerStatus, totalCents, paidCents);
    return document;
  } catch (error) {
    const message = accountingErrorDetail(error);
    const failedAt = new Date().toISOString();
    if (document) {
      await db.prepare(`UPDATE trade_crm_accounting_documents SET status = 'error', last_error = ?, updated_at = ? WHERE id = ?`)
        .bind(message, failedAt, document.id).run();
    }
    await db.prepare(`UPDATE trade_crm_integrations SET last_error = ?, updated_at = ? WHERE id = ?`)
      .bind(message, failedAt, connection.id).run();
    const failed = await documentRow(firebaseUid, String(job.id));
    if (failed) await addEvent(failed, "export", "error", "", amountCents, 0, message);
    throw error;
  }
}

async function refreshInvoice(firebaseUid: string, job: Row) {
  const document = await documentRow(firebaseUid, String(job.id));
  if (!document?.external_document_id || !isAccountingProvider(String(document.provider))) throw new Error("ACCOUNTING_DOCUMENT_REQUIRED");
  if (String(document.commercial_handoff_id || "") !== String(job.commercial_handoff_id || "")
    || String(document.commercial_reference || "") !== String(job.commercial_reference || "")) throw new Error("DOCUMENT_ALREADY_EXPORTED");
  const provider = document.provider as AccountingProvider;
  const connection = await connectionFor(firebaseUid, provider);
  const credentials = await activeCredentials(provider, connection);
  try {
    let invoice: Row;
    if (provider === "xero") {
      const { result } = await xeroFetch(connection, credentials, `Invoices/${encodeURIComponent(String(document.external_document_id))}`);
      invoice = firstItem(result.Invoices) || {};
    } else if (provider === "myob") {
      const { result } = await myobFetch(connection, credentials, `Sale/Invoice/Service/${encodeURIComponent(String(document.external_document_id))}`);
      invoice = result;
    } else {
      const { result } = await quickBooksFetch(connection, credentials, `invoice/${encodeURIComponent(String(document.external_document_id))}?minorversion=75`);
      invoice = result.Invoice && typeof result.Invoice === "object" ? result.Invoice as Row : {};
    }
    if (!(provider === "xero" ? invoice.InvoiceID : provider === "myob" ? invoice.UID : invoice.Id)) throw new Error("PROVIDER_REQUEST_FAILED");
    const providerStatus = String(invoice.Status || (provider === "quickbooks" ? "DRAFT" : ""));
    const amountCents = centsFromProvider(provider === "xero" ? invoice.Total : provider === "myob" ? invoice.TotalAmount : invoice.TotalAmt) || Number(document.amount_cents || 0);
    const taxCents = providerTaxCents(provider, invoice);
    if (job.invoice_source === "quick_invoice" && taxCents !== Number(job.accepted_tax_cents || 0)) throw new Error("PROVIDER_REQUEST_FAILED");
    const providerPaidCents = provider === "xero" ? centsFromProvider(invoice.AmountPaid) : provider === "myob" ? Math.max(0, amountCents - centsFromProvider(invoice.BalanceDueAmount)) : Math.max(0, amountCents - centsFromProvider(invoice.Balance));
    const effectivePaidCents = Math.max(Number(job.paid_value_cents || 0), providerPaidCents);
    const status = accountingStatus(provider, providerStatus, amountCents, providerPaidCents, String(document.due_at || job.payment_due_at || ""));
    const jobStatus = accountingStatus(provider, providerStatus, amountCents, effectivePaidCents, String(document.due_at || job.payment_due_at || ""));
    const now = new Date().toISOString();
    await getD1().batch([
      getD1().prepare(`UPDATE trade_crm_accounting_documents SET amount_cents = ?, paid_amount_cents = ?, status = ?,
        provider_status = ?, last_synced_at = ?, last_error = '', updated_at = ? WHERE id = ?`)
        .bind(amountCents, providerPaidCents, status, providerStatus, now, now, document.id),
      getD1().prepare(`UPDATE trade_crm_job_details SET invoiced_value_cents = ?, paid_value_cents = MAX(paid_value_cents, ?),
        invoice_status = ?, pipeline_stage = CASE WHEN ? = 'paid' THEN 'paid' WHEN ? IN ('issued', 'part_paid', 'overdue') THEN 'invoiced' ELSE pipeline_stage END,
        updated_at = ? WHERE work_order_id = ? AND firebase_uid = ?`)
        .bind(amountCents, providerPaidCents, jobStatus, jobStatus, jobStatus, now, job.id, firebaseUid),
      getD1().prepare(`UPDATE trade_crm_integrations SET last_sync_at = ?, last_error = '', updated_at = ? WHERE id = ?`)
        .bind(now, now, connection.id),
    ]);
    const updated = await documentRow(firebaseUid, String(job.id));
    if (!updated) throw new Error("PROVIDER_REQUEST_FAILED");
    await addEvent(updated, "refresh", status, providerStatus, amountCents, providerPaidCents);
    return updated;
  } catch (error) {
    const message = accountingErrorDetail(error);
    const now = new Date().toISOString();
    await getD1().prepare(`UPDATE trade_crm_accounting_documents SET last_error = ?, updated_at = ? WHERE id = ?`)
      .bind(message, now, document.id).run();
    await getD1().prepare(`UPDATE trade_crm_integrations SET last_error = ?, updated_at = ? WHERE id = ?`)
      .bind(message, now, connection.id).run();
    await addEvent(document, "refresh", "error", String(document.provider_status || ""), Number(document.amount_cents || 0), Number(document.paid_amount_cents || 0), message);
    throw error;
  }
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await requireInstallerOperations(request);
    const url = new URL(request.url);
    const workOrderId = cleanAdminText(url.searchParams.get("workOrderId"), 180);
    const source = invoiceSource(url.searchParams.get("invoiceSource"));
    const job = await directJob(identity.uid, workOrderId, source);
    const connected = await connections(identity.uid);
    const storedDocument = await documentRow(identity.uid, workOrderId);
    const document = storedDocument && String(storedDocument.commercial_handoff_id || "") === String(job.commercial_handoff_id || "")
      && String(storedDocument.commercial_reference || "") === String(job.commercial_reference || "") ? storedDocument : null;
    const providerValue = cleanAdminText(url.searchParams.get("provider"), 20).toLowerCase();
    let accounts: (MyobAccount | QuickBooksItem)[] = [];
    if (providerValue) {
      if (providerValue !== "myob" && providerValue !== "quickbooks") return adminJson({ ok: false, error: "Choose MYOB or QuickBooks to load its account choice." }, 400);
      const connection = await connectionFor(identity.uid, providerValue);
      const credentials = await activeCredentials(providerValue, connection);
      accounts = providerValue === "myob" ? await listMyobAccounts(connection, credentials) : await listQuickBooksItems(connection, credentials);
    }
    return adminJson({
      ok: true,
      providers: (["xero", "myob", "quickbooks"] as AccountingProvider[]).map((provider) => ({
        provider, label: provider === "xero" ? "Xero" : provider === "myob" ? "MYOB" : "QuickBooks", connected: connected[provider]?.status === "connected",
        needsReconnect: provider === "myob" && needsMyobReconsent(connected.myob || null),
      })),
      documents: document ? [documentJson(document)] : [],
      accounts,
    });
  } catch (error) { return accountingError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await requireInstallerOperations(request);
    let body: Row;
    try { body = await request.json() as Row; }
    catch { return adminJson({ ok: false, error: "Invalid accounting request." }, 400); }
    const workOrderId = cleanAdminText(body.workOrderId, 180);
    const source = invoiceSource(body.invoiceSource);
    const job = await directJob(identity.uid, workOrderId, source);
    const action = cleanAdminText(body.action, 20).toLowerCase();
    let document: Row;
    if (action === "export") {
      const providerValue = cleanAdminText(body.provider, 20).toLowerCase();
      if (!isAccountingProvider(providerValue)) return adminJson({ ok: false, error: "Choose Xero, MYOB or QuickBooks." }, 400);
      document = await exportInvoice(identity.uid, providerValue, job, cleanAdminText(body.accountReference, 180));
    } else if (action === "refresh") {
      document = await refreshInvoice(identity.uid, job);
    } else {
      return adminJson({ ok: false, error: "Choose export or refresh." }, 400);
    }
    return adminJson({ ok: true, document: documentJson(document) }, action === "export" ? 201 : 200);
  } catch (error) { return accountingError(error); }
}
