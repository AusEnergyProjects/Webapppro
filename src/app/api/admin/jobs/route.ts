import { getD1 } from "../../../../../db";
import { adminError, adminJson, requireAdminIdentity, sameOrigin } from "@/lib/admin-server";
import { adminJobQuery, ADMIN_JOB_JOINS } from "@/lib/admin-job-register";

export const runtime = "edge";

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request);
    const query = adminJobQuery(new URL(request.url).searchParams);
    const db = getD1();
    const [rows, count, facets] = await Promise.all([db.prepare(`SELECT w.id, w.work_number, w.title, w.service_category, w.stage,
        w.site_area, w.scheduled_start, w.created_at, w.updated_at, a.business_name installer_business,
        c.first_name customer_first_name, c.last_name customer_last_name, c.business_name customer_business_name,
        CASE WHEN c.business_name <> '' THEN c.business_name ELSE TRIM(c.first_name || ' ' || c.last_name) END customer_name
      ${ADMIN_JOB_JOINS} WHERE ${query.where}
      ORDER BY ${query.orderBy} LIMIT ? OFFSET ?`)
      .bind(...query.values, query.pageSize, query.offset).all<Record<string, unknown>>(),
      db.prepare(`SELECT COUNT(*) total ${ADMIN_JOB_JOINS} WHERE ${query.where}`).bind(...query.values).first<{total: number}>(),
      db.prepare(`SELECT DISTINCT w.stage, w.service_category, a.business_name
        FROM trade_work_orders w JOIN trade_accounts a ON a.firebase_uid = w.firebase_uid
        WHERE w.partner_type = 'installer' AND w.record_status = 'active'`).all<{stage: string; service_category: string; business_name: string}>(),
    ]);
    const total = Number(count?.total || 0);
    return adminJson({ ok: true, pagination: { page: query.page, pageSize: query.pageSize, total, hasNext: query.offset + rows.results.length < total },
      facets: { stages: [...new Set(facets.results.map((row) => row.stage))].filter(Boolean).sort(),
        services: [...new Set(facets.results.map((row) => row.service_category))].filter(Boolean).sort(),
        installers: [...new Set(facets.results.map((row) => row.business_name))].filter(Boolean).sort() },
      jobs: rows.results.map((row) => ({
      id: row.id, workNumber: row.work_number, title: row.title, serviceCategory: row.service_category,
      stage: row.stage, siteArea: row.site_area, scheduledStart: row.scheduled_start,
      installerBusiness: row.installer_business, customerName: row.customer_name,
      customerFirstName: String(row.customer_first_name || ""), customerLastName: String(row.customer_last_name || ""), customerBusinessName: String(row.customer_business_name || ""),
      createdAt: row.created_at, updatedAt: row.updated_at,
    })) });
  } catch (error) { return adminError(error); }
}
