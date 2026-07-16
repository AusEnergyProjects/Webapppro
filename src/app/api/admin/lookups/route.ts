import { getD1 } from "../../../../../db";
import { adminError, adminJson, cleanAdminText, requireAdminIdentity, sameOrigin } from "@/lib/admin-server";

export const runtime = "edge";

function lookupTerm(value: string) {
  return `%${value.toLowerCase().replaceAll("%", "").replaceAll("_", "")}%`;
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request);
    const db = getD1();
    const url = new URL(request.url);
    const type = cleanAdminText(url.searchParams.get("type"), 30);
    const query = cleanAdminText(url.searchParams.get("q"), 80);
    const selected = cleanAdminText(url.searchParams.get("selected"), 180);
    if (query.length < 2 && !selected) return adminJson({ ok: true, options: [] });
    const term = lookupTerm(query);
    if (type === "installer") {
      const rows = await db.prepare(`SELECT firebase_uid id, business_name label, address_state state, postcode
        FROM trade_accounts WHERE partner_type = 'installer' AND account_status = 'active'
          AND (? = firebase_uid OR LOWER(business_name) LIKE ? OR LOWER(postcode) LIKE ?)
        ORDER BY CASE WHEN firebase_uid = ? THEN 0 ELSE 1 END, business_name COLLATE NOCASE, firebase_uid LIMIT 25`)
        .bind(selected, term, term, selected).all<Record<string, unknown>>();
      return adminJson({ ok: true, options: rows.results.map((row) => ({ id: row.id, label: row.label, secondary: [row.state, row.postcode].filter(Boolean).join(" ") })) });
    }
    if (type === "opportunity") {
      const rows = await db.prepare(`SELECT id, title label, state, postcode FROM trade_opportunities
        WHERE status = 'open' AND (? = id OR LOWER(title) LIKE ? OR LOWER(postcode) LIKE ?)
        ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, updated_at DESC, id DESC LIMIT 25`)
        .bind(selected, term, term, selected).all<Record<string, unknown>>();
      return adminJson({ ok: true, options: rows.results.map((row) => ({ id: row.id, label: row.label, secondary: [row.state, row.postcode].filter(Boolean).join(" ") })) });
    }
    if (type === "customer") {
      const rows = await db.prepare(`SELECT firebase_uid id, display_name label, address_state state, postcode
        FROM customer_accounts WHERE ? = firebase_uid OR LOWER(display_name) LIKE ? OR LOWER(postcode) LIKE ?
        ORDER BY CASE WHEN firebase_uid = ? THEN 0 ELSE 1 END, display_name COLLATE NOCASE, firebase_uid LIMIT 25`)
        .bind(selected, term, term, selected).all<Record<string, unknown>>();
      return adminJson({ ok: true, options: rows.results.map((row) => ({ id: row.id, label: row.label, secondary: [row.state, row.postcode].filter(Boolean).join(" ") })) });
    }
    if (type === "product") {
      const rows = await db.prepare(`SELECT p.id, p.name label, p.brand, p.model_number, a.business_name supplier
        FROM supplier_products p JOIN trade_accounts a ON a.firebase_uid = p.firebase_uid
        WHERE ? = p.id OR LOWER(p.name) LIKE ? OR LOWER(p.brand) LIKE ? OR LOWER(p.model_number) LIKE ?
        ORDER BY CASE WHEN p.id = ? THEN 0 ELSE 1 END, p.name COLLATE NOCASE, p.id LIMIT 25`)
        .bind(selected, term, term, term, selected).all<Record<string, unknown>>();
      return adminJson({ ok: true, options: rows.results.map((row) => ({ id: row.id, label: row.label, secondary: `${row.brand} ${row.model_number} | ${row.supplier}` })) });
    }
    return adminJson({ ok: false, error: "Choose a supported lookup type." }, 400);
  } catch (error) { return adminError(error); }
}
