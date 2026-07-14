import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";

export const runtime = "edge";

const STATUSES = new Set(["new", "viewed", "responded", "closed"]);

async function supplierIdentity(request: Request) {
  const identity = await requireFirebaseIdentity(request);
  const account = await getD1().prepare("SELECT partner_type, account_status FROM trade_accounts WHERE firebase_uid = ?")
    .bind(identity.uid).first<Record<string, unknown>>();
  if (!account) throw new Error("PROFILE_REQUIRED");
  if (account.partner_type !== "supplier") throw new Error("SUPPLIER_REQUIRED");
  if (account.account_status !== "active") throw new Error("ACCOUNT_INACTIVE");
  return identity;
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the wholesaler profile first." }, 404);
  if (code === "SUPPLIER_REQUIRED") return adminJson({ ok: false, error: "Product enquiries are reserved for wholesaler accounts." }, 403);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This wholesaler account is not active." }, 403);
  return adminJson({ ok: false, error: "The product enquiry request could not be completed." }, 500);
}

async function enquiries(supplierUid: string) {
  const db = getD1();
  const rows = await db.prepare(`SELECT e.id, e.list_id, e.status, e.message, e.supplier_note, e.created_at, e.updated_at,
    l.name list_name, l.project_postcode, l.notes list_notes,
    a.business_name installer_business, a.contact_name installer_contact, a.email installer_email,
    a.phone installer_phone, a.business_website installer_website
    FROM supplier_product_enquiries e
    JOIN installer_product_lists l ON l.id = e.list_id
    JOIN trade_accounts a ON a.firebase_uid = e.installer_uid
    WHERE e.supplier_uid = ? ORDER BY CASE e.status WHEN 'new' THEN 0 WHEN 'viewed' THEN 1 WHEN 'responded' THEN 2 ELSE 3 END, e.updated_at DESC
    LIMIT 100`).bind(supplierUid).all<Record<string, unknown>>();
  if (!rows.results.length) return [];
  const listIds = [...new Set(rows.results.map((row: Record<string, unknown>) => String(row.list_id)))];
  const items = await db.prepare(`SELECT i.list_id, i.id, i.product_id, i.quantity, i.unit_price_cents_ex_gst,
    p.model_number, p.brand, p.name product_name, p.unit_label
    FROM installer_product_list_items i JOIN supplier_products p ON p.id = i.product_id
    WHERE i.supplier_uid = ? AND i.list_id IN (${listIds.map(() => "?").join(",")})
    ORDER BY p.brand, p.name`).bind(supplierUid, ...listIds).all<Record<string, unknown>>();
  return rows.results.map((row: Record<string, unknown>) => ({
    id: row.id,
    listId: row.list_id,
    status: row.status,
    message: row.message,
    supplierNote: row.supplier_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    listName: row.list_name,
    projectPostcode: row.project_postcode,
    listNotes: row.list_notes,
    installerBusiness: row.installer_business,
    installerContact: row.installer_contact,
    installerEmail: row.installer_email,
    installerPhone: row.installer_phone,
    installerWebsite: row.installer_website,
    items: items.results.filter((item: Record<string, unknown>) => item.list_id === row.list_id).map((item: Record<string, unknown>) => ({
      id: item.id,
      productId: item.product_id,
      quantity: Number(item.quantity),
      unitPriceCentsExGst: Number(item.unit_price_cents_ex_gst),
      modelNumber: item.model_number,
      brand: item.brand,
      name: item.product_name,
      unitLabel: item.unit_label,
    })),
  }));
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await supplierIdentity(request);
    return adminJson({ ok: true, enquiries: await enquiries(identity.uid) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const identity = await supplierIdentity(request);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid product enquiry update." }, 400); }
    const id = cleanAdminText(body.id, 180);
    const status = cleanAdminText(body.status, 30);
    const supplierNote = cleanAdminText(body.supplierNote, 800);
    if (!id || !STATUSES.has(status)) return adminJson({ ok: false, error: "Choose a valid enquiry status." }, 400);
    const now = new Date().toISOString();
    const result = await getD1().prepare(`UPDATE supplier_product_enquiries
      SET status = ?, supplier_note = ?, updated_at = ? WHERE id = ? AND supplier_uid = ?`)
      .bind(status, supplierNote, now, id, identity.uid).run();
    if (!result.meta.changes) return adminJson({ ok: false, error: "Product enquiry not found." }, 404);
    return adminJson({ ok: true, enquiries: await enquiries(identity.uid) });
  } catch (error) {
    return errorResponse(error);
  }
}
