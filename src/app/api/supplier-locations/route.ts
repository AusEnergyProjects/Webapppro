import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { requireFirebaseIdentity } from "@/lib/firebase-server";

export const runtime = "edge";
type Row = Record<string, unknown>;
const TYPES = new Set(["head_office", "warehouse", "dispatch", "showroom"]);
const STATES = new Set(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]);

async function supplier(request: Request) {
  const identity = await requireFirebaseIdentity(request);
  const account = await getD1().prepare(`SELECT partner_type, account_status, verification_status FROM trade_accounts WHERE firebase_uid = ?`).bind(identity.uid).first<Row>();
  if (!account || account.partner_type !== "supplier" || account.account_status !== "active" || account.verification_status !== "approved") throw new Error("SUPPLIER_REQUIRED");
  return identity.uid;
}
const json = (row: Row) => ({ id: row.id, locationName: row.location_name, locationType: row.location_type, addressLine1: row.address_line_1, suburb: row.suburb, addressState: row.address_state, postcode: row.postcode, salesEmail: row.sales_email, contactNumber: row.contact_number, dispatchNotes: row.dispatch_notes, serviceStates: (() => { try { const value = JSON.parse(String(row.service_states_json)); return Array.isArray(value) ? value : []; } catch { return []; } })() });

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try { const uid = await supplier(request); const rows = await getD1().prepare(`SELECT * FROM trade_supplier_locations WHERE firebase_uid = ? AND record_status = 'active' ORDER BY location_type = 'head_office' DESC, location_name`).bind(uid).all<Row>(); return adminJson({ ok: true, locations: rows.results.map(json) }); }
  catch { return adminJson({ ok: false, error: "Verified wholesaler access is required." }, 403); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const uid = await supplier(request); const body = await request.json() as Row; const action = cleanAdminText(body.action, 20); const id = cleanAdminText(body.id, 180);
    if (action === "archive") { await getD1().prepare(`UPDATE trade_supplier_locations SET record_status = 'archived', updated_at = ? WHERE id = ? AND firebase_uid = ?`).bind(new Date().toISOString(), id, uid).run(); return GET(request); }
    const name = cleanAdminText(body.locationName, 100); const type = cleanAdminText(body.locationType, 30); const address = cleanAdminText(body.addressLine1, 160); const suburb = cleanAdminText(body.suburb, 80); const state = cleanAdminText(body.addressState, 10).toUpperCase(); const postcode = cleanAdminText(body.postcode, 4);
    const salesEmail = cleanAdminText(body.salesEmail, 160).toLowerCase(); const phone = cleanAdminText(body.contactNumber, 40); const notes = cleanAdminText(body.dispatchNotes, 500);
    const serviceStates = Array.isArray(body.serviceStates) ? [...new Set(body.serviceStates.map((item) => String(item).toUpperCase()).filter((item) => STATES.has(item)))].slice(0, 8) : [];
    if (!name || !TYPES.has(type) || !address || !suburb || !STATES.has(state) || !/^\d{4}$/.test(postcode) || (salesEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(salesEmail))) return adminJson({ ok: false, error: "Complete the location, Australian address and valid sales contact details." }, 400);
    const now = new Date().toISOString();
    if (id) await getD1().prepare(`UPDATE trade_supplier_locations SET location_name = ?, location_type = ?, address_line_1 = ?, suburb = ?, address_state = ?, postcode = ?, sales_email = ?, contact_number = ?, dispatch_notes = ?, service_states_json = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?`).bind(name, type, address, suburb, state, postcode, salesEmail, phone, notes, JSON.stringify(serviceStates), now, id, uid).run();
    else await getD1().prepare(`INSERT INTO trade_supplier_locations (id, firebase_uid, location_name, location_type, address_line_1, suburb, address_state, postcode, sales_email, contact_number, dispatch_notes, service_states_json, record_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`).bind(crypto.randomUUID(), uid, name, type, address, suburb, state, postcode, salesEmail, phone, notes, JSON.stringify(serviceStates), now, now).run();
    return GET(request);
  } catch (error) { return adminJson({ ok: false, error: error instanceof Error && error.message.includes("UNIQUE") ? "Use a unique location name." : "The wholesaler location could not be saved." }, 409); }
}
