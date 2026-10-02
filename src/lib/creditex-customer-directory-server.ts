import { portalCustomerScope } from './portal-customer-connect-server';
import { tradeMapAddressSql, type TradeMapDataset } from './trade-map-dataset-server';
import { CreditexJobAuditError, type CreditexJobAuditActor } from './creditex-job-audit-server';
import type { CreditexCustomerDetail, CreditexCustomerPage } from './creditex-customer-directory';

const NAME = "COALESCE(NULLIF(trim(customer.first_name || ' ' || customer.last_name),''),NULLIF(customer.business_name,''),'Customer')";
const CUSTOMER_SEARCH = `${NAME} || ' ' || COALESCE(customer.email,'') || ' ' || COALESCE(customer.phone,'') || ' ' || COALESCE(account.business_name,'') || ' ' || ${tradeMapAddressSql('customer')}`;
const LIMIT = 30;
function requestedPage(params: URLSearchParams) { const value = Number(params.get('page') || 1); return Number.isSafeInteger(value) ? Math.max(1, Math.min(10000, value)) : 1; }
function customerDataset(actor: CreditexJobAuditActor, params: URLSearchParams) {
  const scope = portalCustomerScope(actor);
  const search = (params.get('search') || '').trim().slice(0, 120).toLowerCase();
  return { sql: `SELECT customer.id, ${NAME} name, customer.email, customer.phone, ${tradeMapAddressSql('customer')} address,
      COALESCE(account.business_name,'') installer, COUNT(DISTINCT work.id) jobCount
    ${scope.sql} AND (?='' OR instr(lower(${CUSTOMER_SEARCH}),?)>0)
    GROUP BY customer.id,customer.firebase_uid`, bindings: [...scope.bindings, search, search] };
}
export async function loadCreditexCustomers(db: D1Database, actor: CreditexJobAuditActor, params: URLSearchParams): Promise<CreditexCustomerPage> {
  const dataset = customerDataset(actor, params);
  const count = await db.prepare(`SELECT COUNT(*) total FROM (${dataset.sql})`).bind(...dataset.bindings).first<{ total: number }>();
  const total = Number(count?.total || 0), totalPages = Math.max(1, Math.ceil(total / LIMIT)), page = Math.min(totalPages, requestedPage(params));
  const rows = await db.prepare(`${dataset.sql} ORDER BY name COLLATE NOCASE,customer.id LIMIT ? OFFSET ?`).bind(...dataset.bindings, LIMIT, (page - 1) * LIMIT).all<CreditexCustomerPage['customers'][number]>();
  return { customers: rows.results, total, page, totalPages };
}
export async function loadCreditexCustomer(db: D1Database, actor: CreditexJobAuditActor, id: string, params: URLSearchParams): Promise<CreditexCustomerDetail> {
  const dataset = customerDataset(actor, new URLSearchParams());
  const customer = await db.prepare(`SELECT * FROM (${dataset.sql}) WHERE id=?`).bind(...dataset.bindings, id).first<CreditexCustomerDetail['customer']>();
  if (!customer) throw new CreditexJobAuditError('CUSTOMER_NOT_FOUND', 'This customer is no longer available in your workspace.', 404);
  const scope = portalCustomerScope(actor);
  const jobs = `SELECT intent.id, work.work_number number, work.title, COALESCE(json_extract(intent.intent_snapshot,'$.activity.title'),intent.registry_activity_code) activity,
    ${tradeMapAddressSql('site')} address ${scope.sql} AND customer.id=?`;
  const count = await db.prepare(`SELECT COUNT(*) total FROM (${jobs})`).bind(...scope.bindings, id).first<{ total: number }>();
  const totalPages = Math.max(1, Math.ceil(Number(count?.total || 0) / LIMIT)), page = Math.min(totalPages, requestedPage(params));
  const rows = await db.prepare(`${jobs} ORDER BY work.work_number,intent.id LIMIT ? OFFSET ?`).bind(...scope.bindings, id, LIMIT, (page - 1) * LIMIT).all<CreditexCustomerDetail['jobs'][number]>();
  return { customer, jobs: rows.results, page, totalPages };
}
export function creditexMapDataset(actor: CreditexJobAuditActor, params: URLSearchParams): TradeMapDataset {
  const jobs = params.get('resource') === 'jobs', scope = portalCustomerScope(actor, jobs ? 'jobs' : 'customers');
  const search = (params.get('search') || '').trim().slice(0,120).toLowerCase();
  const address = tradeMapAddressSql(jobs ? 'site' : 'customer');
  return { cacheOwnerColumn: 'owner_uid', sql: `SELECT ${jobs ? 'intent.id' : 'customer.id'} id, '${jobs ? 'job' : 'customer'}' kind,
      ${jobs ? 'work.title' : NAME} title, ${jobs ? 'work.work_number' : "COALESCE(customer.customer_number,'')"} reference,
      ${address} address, LOWER(TRIM(${address})) address_key, work.firebase_uid owner_uid,
      ${jobs ? `${NAME} || ' · ' || COALESCE(account.business_name,'')` : "COALESCE(account.business_name,'')"} detail,
      '${jobs ? 'unknown' : 'customer'}' category
    ${scope.sql} AND (?='' OR instr(lower(${jobs ? `${CUSTOMER_SEARCH} || ' ' || work.title || ' ' || work.work_number || ' ' || ${address}` : CUSTOMER_SEARCH}),?)>0)
    ${jobs ? '' : 'GROUP BY customer.id,customer.firebase_uid'}`, bindings: [...scope.bindings, search, search] };
}
