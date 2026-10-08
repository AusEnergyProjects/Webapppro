import { getD1 } from "../../../../db";
import { adminJson, mfaErrorResponse, sameOrigin } from "@/lib/admin-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { TradeBusinessContextError } from "@/lib/trade-business-context-server";
import { assertTradeFormAttachmentAccess, TradeFormSelectionError } from "@/lib/trade-job-form-attachment-server";
import { ENERGY_SERVICE_IDS, LEGACY_ENERGY_SERVICE_ALIASES } from "@/lib/energy-service-catalogue.mjs";
import { loadTradeJobFormLibrary, type SavedJobFormEligibility } from "@/lib/trade-job-form-library-server";
import { GET as jobActivityLibrary } from "../field/job-activities/route";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const states = new Set(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]);
const buildingTypes = new Set(["house_townhouse", "apartment_unit", "commercial_office", "retail_hospitality", "industrial_warehouse", "institutional_community_health", "other", "not_sure"]);
const serviceCategories = new Set<string>([...ENERGY_SERVICE_IDS, ...Object.keys(LEGACY_ENERGY_SERVICE_ALIASES), "mounting-hardware", "controls"]);
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function savedEligibility(value: unknown): SavedJobFormEligibility {
  if (!object(value) || value.ok !== true || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision)
    || typeof value.canAdd !== "boolean" || typeof value.unavailableReason !== "string"
    || !Array.isArray(value.activities) || !Array.isArray(value.rentalModules)) throw new Error("JOB_FORM_LIBRARY_UNAVAILABLE");
  const activities = value.activities.map(entry => {
    if (!object(entry) || typeof entry.id !== "string" || typeof entry.programTemplateId !== "string"
      || typeof entry.added !== "boolean" || typeof entry.unavailableReason !== "string") throw new Error("JOB_FORM_LIBRARY_UNAVAILABLE");
    return { id: entry.id, programTemplateId: entry.programTemplateId, added: entry.added, unavailableReason: entry.unavailableReason };
  });
  const rentalModules = value.rentalModules.map(entry => {
    if (!object(entry) || typeof entry.id !== "string" || typeof entry.added !== "boolean" || typeof entry.unavailableReason !== "string") throw new Error("JOB_FORM_LIBRARY_UNAVAILABLE");
    return { id: entry.id, added: entry.added, unavailableReason: entry.unavailableReason };
  });
  return { revision: value.revision, canAdd: value.canAdd, unavailableReason: value.unavailableReason, activities, rentalModules };
}

/** Catalogue metadata only. Job answers, drafts and customer details never enter this response. */
export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    const database = getD1();
    await assertTradeFormAttachmentAccess(access, database);
    const query = new URL(request.url).searchParams;
    const workOrderId = query.get("workOrderId") || "";
    let serviceCategory = query.get("serviceCategory") || "";
    let addressState = (query.get("addressState") || "").toUpperCase();
    let buildingType = query.get("buildingType") || "not_sure";
    let saved: SavedJobFormEligibility | undefined;
    let attachedBusinessIds: string[] = [];
    let piesaAdded = false;
    let piesaUnavailableReason = "";
    let businessUnavailableReason = "";
    if (workOrderId) {
      if (!/^[A-Za-z0-9:_-]{1,180}$/.test(workOrderId)) return adminJson({ ok: false, error: "Choose an available job." }, 400);
      const activityUrl = new URL(request.url);
      activityUrl.pathname = "/api/field/job-activities";
      activityUrl.search = new URLSearchParams({ workOrderId }).toString();
      const activityResponse = await jobActivityLibrary(new Request(activityUrl, { headers: request.headers }));
      if (!activityResponse.ok) return activityResponse;
      saved = savedEligibility(await activityResponse.json());
      const job = await database.prepare(`SELECT w.service_category, w.stage, d.building_type, site.address_state
        FROM trade_work_orders w LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
        LEFT JOIN trade_crm_service_sites site ON site.id = d.service_site_id AND site.firebase_uid = w.firebase_uid
          AND site.customer_id = d.crm_customer_id AND site.record_status = 'active'
        WHERE w.id = ? AND w.firebase_uid = ? AND w.record_status = 'active' AND w.partner_type = 'installer'`)
        .bind(workOrderId, access.ownerUid).first<{ service_category: string; stage: string; building_type: string | null; address_state: string | null }>();
      if (!job) return adminJson({ ok: false, error: "This job is no longer available." }, 404);
      serviceCategory = job.service_category;
      addressState = (job.address_state || "").toUpperCase();
      buildingType = job.building_type || "not_sure";
      const attached = await database.prepare("SELECT template_key, template_version FROM trade_job_forms WHERE work_order_id = ? AND firebase_uid = ?")
        .bind(workOrderId, access.ownerUid).all<{ template_key: string; template_version: number }>();
      attachedBusinessIds = attached.results.map(entry => `business:${entry.template_key}:${entry.template_version}`);
      piesaAdded = Boolean(await database.prepare("SELECT id FROM trade_veu_electrical_assessments WHERE work_order_id = ? AND owner_uid = ?")
        .bind(workOrderId, access.ownerUid).first());
      if (["imported", "completed", "cancelled"].includes(job.stage)) {
        piesaUnavailableReason = "Imported, completed and cancelled jobs cannot have more forms added.";
        businessUnavailableReason = piesaUnavailableReason;
      }
    } else if (!serviceCategories.has(serviceCategory) || addressState && !states.has(addressState) || !buildingTypes.has(buildingType)) {
      return adminJson({ ok: false, error: "Choose a valid work type, job address state and premises type." }, 400);
    }
    const options = await loadTradeJobFormLibrary({ serviceCategory, addressState, buildingType, saved,
      attachedBusinessIds, piesaAdded, piesaUnavailableReason, businessUnavailableReason }, database, access.ownerUid);
    return adminJson({ ok: true, options, ...(saved ? { revision: saved.revision } : {}) });
  } catch (error) {
    const mfa = mfaErrorResponse(error); if (mfa) return mfa;
    if (error instanceof TradeBusinessContextError) return adminJson({ ok: false, error: error.publicMessage }, error.status);
    if (error instanceof TradeFormSelectionError) return adminJson({ ok: false, error: error.message }, error.status);
    const code = error instanceof Error ? error.message : "";
    if (/AUTH|TOKEN|ACCESS|VERIFICATION|ROLE|SUSPENDED|INACTIVE/.test(code)) return adminJson({ ok: false, error: "Sign in with active authorised business access." }, 403);
    return adminJson({ ok: false, error: "The form library could not be loaded. Try again." }, 503);
  }
}
