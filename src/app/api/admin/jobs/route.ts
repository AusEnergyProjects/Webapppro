import { getD1 } from "../../../../../db";
import { adminError, adminJson, cleanAdminText, requireAdminIdentity, sameOrigin } from "@/lib/admin-server";

export const runtime = "edge";

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request);
    const query = cleanAdminText(new URL(request.url).searchParams.get("q"), 100).toLowerCase();
    const term = `%${query.replaceAll("%", "").replaceAll("_", "")}%`;
    const rows = await getD1().prepare(`SELECT w.id, w.work_number, w.title, w.service_category, w.stage,
        w.site_area, w.scheduled_start, w.created_at, w.updated_at, a.business_name installer_business,
        CASE WHEN c.business_name <> '' THEN c.business_name ELSE TRIM(c.first_name || ' ' || c.last_name) END customer_name
      FROM trade_work_orders w
      JOIN trade_accounts a ON a.firebase_uid = w.firebase_uid
      LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid
      WHERE w.partner_type = 'installer' AND w.record_status = 'active'
        AND (? = '' OR LOWER(w.work_number) LIKE ? OR LOWER(w.id) LIKE ? OR LOWER(w.title) LIKE ?
          OR LOWER(a.business_name) LIKE ? OR LOWER(COALESCE(c.business_name, '') || ' ' || COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) LIKE ?)
      ORDER BY CASE WHEN LOWER(w.work_number) = ? THEN 0 ELSE 1 END, w.updated_at DESC LIMIT 100`)
      .bind(query, term, term, term, term, term, query).all<Record<string, unknown>>();
    return adminJson({ ok: true, jobs: rows.results.map((row) => ({
      id: row.id, workNumber: row.work_number, title: row.title, serviceCategory: row.service_category,
      stage: row.stage, siteArea: row.site_area, scheduledStart: row.scheduled_start,
      installerBusiness: row.installer_business, customerName: row.customer_name,
      createdAt: row.created_at, updatedAt: row.updated_at,
    })) });
  } catch (error) { return adminError(error); }
}
