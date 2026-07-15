import { getD1 } from "../../../../../db";
import {
  adminError,
  adminJson,
  requireAdminIdentity,
  sameOrigin,
} from "@/lib/admin-server";

export const runtime = "edge";

type CountRow = Record<string, number | string | null>;

function number(row: CountRow | null, key: string) {
  return Number(row?.[key] || 0);
}

export async function GET(request: Request) {
  if (!sameOrigin(request))
    return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);

  try {
    await requireAdminIdentity(request);
    const db = getD1();
    const [accounts, projects, opportunities, products, responses, quotes] =
      await Promise.all([
        db.prepare(`SELECT
          SUM(CASE WHEN partner_type = 'installer' AND COALESCE(is_synthetic, 0) = 1 THEN 1 ELSE 0 END) installers,
          SUM(CASE WHEN partner_type = 'supplier' AND COALESCE(is_synthetic, 0) = 1 THEN 1 ELSE 0 END) wholesalers,
          SUM(CASE WHEN partner_type = 'installer' AND COALESCE(is_synthetic, 0) = 1
            AND account_status = 'active' AND verification_status = 'approved' AND billing_status IN ('active', 'trial')
            THEN 1 ELSE 0 END) ready_installers,
          SUM(CASE WHEN partner_type = 'supplier' AND COALESCE(is_synthetic, 0) = 1
            AND account_status = 'active' AND verification_status = 'approved' AND billing_status IN ('active', 'trial')
            THEN 1 ELSE 0 END) ready_wholesalers,
          (SELECT COUNT(*) FROM customer_accounts WHERE COALESCE(is_synthetic, 0) = 1) customers
          FROM trade_accounts`).first<CountRow>(),
        db.prepare(`SELECT COUNT(*) total,
          SUM(CASE WHEN opportunity_id != '' THEN 1 ELSE 0 END) submitted
          FROM customer_projects WHERE COALESCE(is_synthetic, 0) = 1`).first<CountRow>(),
        db.prepare(`SELECT COUNT(*) total,
          SUM(CASE WHEN match_count >= 6 THEN 1 ELSE 0 END) six_matched
          FROM (
            SELECT o.id, COUNT(m.id) match_count
            FROM trade_opportunities o
            LEFT JOIN trade_opportunity_matches m ON m.opportunity_id = o.id
            WHERE COALESCE(o.is_synthetic, 0) = 1
            GROUP BY o.id
          )`).first<CountRow>(),
        db.prepare(`SELECT COUNT(*) total,
          SUM(CASE WHEN listing_status = 'published' AND review_status = 'approved' THEN 1 ELSE 0 END) live
          FROM supplier_products WHERE COALESCE(is_synthetic, 0) = 1`).first<CountRow>(),
        db.prepare(`SELECT
          SUM(CASE WHEN m.status IN ('interested', 'connected') THEN 1 ELSE 0 END) positive,
          SUM(CASE WHEN m.status = 'connected' THEN 1 ELSE 0 END) connected
          FROM trade_opportunity_matches m
          JOIN trade_opportunities o ON o.id = m.opportunity_id
          WHERE COALESCE(o.is_synthetic, 0) = 1`).first<CountRow>(),
        db.prepare(`SELECT COUNT(*) total
          FROM customer_project_quotes q
          JOIN customer_projects p ON p.id = q.project_id
          WHERE COALESCE(p.is_synthetic, 0) = 1 AND q.status = 'submitted'`).first<CountRow>(),
      ]);

    const counts = {
      customers: number(accounts, "customers"),
      installers: number(accounts, "installers"),
      wholesalers: number(accounts, "wholesalers"),
      readyInstallers: number(accounts, "ready_installers"),
      readyWholesalers: number(accounts, "ready_wholesalers"),
      projects: number(projects, "total"),
      submittedProjects: number(projects, "submitted"),
      opportunities: number(opportunities, "total"),
      sixMatchedOpportunities: number(opportunities, "six_matched"),
      products: number(products, "total"),
      liveProducts: number(products, "live"),
      positiveResponses: number(responses, "positive"),
      connectedResponses: number(responses, "connected"),
      quotes: number(quotes, "total"),
    };

    const checks = [
      {
        key: "accounts",
        label: "Demo account network",
        passed:
          counts.customers >= 200 &&
          counts.readyInstallers >= 100 &&
          counts.readyWholesalers >= 50,
        detail: `${counts.customers} customers, ${counts.readyInstallers} ready installers and ${counts.readyWholesalers} ready wholesalers`,
      },
      {
        key: "projects",
        label: "Customer project intake",
        passed: counts.projects >= 200 && counts.submittedProjects >= 200,
        detail: `${counts.submittedProjects} of ${counts.projects} projects submitted for matching`,
      },
      {
        key: "matching",
        label: "Six-installer allocation",
        passed:
          counts.opportunities > 0 &&
          counts.sixMatchedOpportunities === counts.opportunities,
        detail: `${counts.sixMatchedOpportunities} of ${counts.opportunities} opportunities reached six installers`,
      },
      {
        key: "catalogue",
        label: "Wholesaler catalogue visibility",
        passed: counts.liveProducts >= 150,
        detail: `${counts.liveProducts} approved products are visible to installers`,
      },
      {
        key: "response",
        label: "Installer response",
        passed: counts.positiveResponses > 0,
        detail: `${counts.positiveResponses} interested or connected responses recorded`,
      },
      {
        key: "quote",
        label: "Structured customer quote",
        passed: counts.quotes > 0,
        detail: `${counts.quotes} submitted quote options visible in customer projects`,
      },
    ];

    return adminJson({
      ok: true,
      status: checks.every((check) => check.passed) ? "healthy" : "attention",
      checkedAt: new Date().toISOString(),
      counts,
      checks,
    });
  } catch (error) {
    return adminError(error);
  }
}
