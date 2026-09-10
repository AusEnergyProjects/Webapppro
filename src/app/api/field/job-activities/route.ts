import { getD1 } from "../../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { BoundedJsonRequestError, readBoundedJsonRequest } from "@/lib/bounded-json-request";
import { assignedJob, canManageJobs, requireInstallerTeamAccess, type TeamAccess } from "@/lib/trade-team-server";
import { guardedOnlineJobMutationBatch, jobSyncChangeStatements, nextJobRevision } from "@/lib/trade-team-sync-server";
import { GOVERNMENT_ACTIVITY_TEMPLATES, GOVERNMENT_PROGRAM_TEMPLATES } from "@/lib/australian-government-program-catalogue";
import { activityFieldCatalogue, defaultActivityFieldForm } from "@/lib/trade-activity-forms-library";
import { CREDITEX_PARTNER_ORGANISATION_CODE, MAX_TRADE_COMPLIANCE_ACTIVITIES, resolveTradeComplianceIntent, stableTradeComplianceIntentJson, TradeComplianceIntentError } from "@/lib/trade-compliance-intent";
import { RENTAL_ASSESSMENT_MODULES, normalizeRentalAssessmentModules, rentalAssessmentTemplateSnapshot } from "@/lib/trade-rental-assessment.mjs";
import { ensureTradeRentalSchemaGuards } from "@/lib/trade-rental-schema-guards";
import { rentalAssignmentCredentialSql, rentalAssignmentRequiredGates } from "@/lib/trade-rental-credentials";

export const runtime = "edge";
type Row = Record<string, unknown>;
const text = (value: unknown) => String(value || "");
const editableInspection = new Set(["draft", "scheduled", "in_progress"]);

async function context(access: TeamAccess, workOrderId: string) {
  const job = await assignedJob(access, workOrderId);
  const db = getD1();
  const [details, inspection, intents] = await Promise.all([
    db.prepare(`SELECT w.work_number, w.scheduled_start, w.scheduled_end, d.building_type,
        d.service_site_id, d.crm_customer_id, c.first_name, c.last_name, c.business_name, c.email, c.phone,
        s.address_line_1, s.address_line_2, s.suburb, s.address_state, s.postcode,
        member.member_uid, member.display_name, member.capabilities,
        (SELECT a.id FROM trade_crm_appointments a WHERE a.work_order_id = w.id AND a.firebase_uid = w.firebase_uid
          AND a.status IN ('scheduled', 'en_route', 'arrived', 'in_progress') ORDER BY a.starts_at DESC LIMIT 1) appointment_id
      FROM trade_work_orders w
      JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid AND d.customer_source = 'trade_owned'
      JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid AND c.record_status = 'active'
      JOIN trade_crm_service_sites s ON s.id = d.service_site_id AND s.firebase_uid = w.firebase_uid AND s.customer_id = c.id AND s.record_status = 'active'
      LEFT JOIN trade_team_members member ON member.id = w.assignee_member_id AND member.owner_uid = w.firebase_uid AND member.status = 'active'
      WHERE w.id = ? AND w.firebase_uid = ?`).bind(workOrderId, access.ownerUid).first<Row>(),
    db.prepare("SELECT * FROM trade_rental_inspections WHERE work_order_id = ? AND firebase_uid = ?")
      .bind(workOrderId, access.ownerUid).first<Row>(),
    db.prepare("SELECT activity_template_id FROM trade_work_order_compliance_intents WHERE work_order_id = ? AND installer_uid = ? AND status IN ('planned', 'case_linked')")
      .bind(workOrderId, access.ownerUid).all<{ activity_template_id: string }>(),
  ]);
  return { access, job, details, inspection, intents: intents.results, workOrderId };
}
type Context = Awaited<ReturnType<typeof context>>;

function unavailable(context: Context) {
  if (!canManageJobs(context.access)) return "Your Team role does not allow adding work to jobs.";
  if (["completed", "cancelled"].includes(context.job.stage)) return "Completed and cancelled jobs cannot have more work added.";
  if (!context.details) return "Attach an active customer and property in TLink before adding activity forms.";
  return "";
}

async function workerReason(context: Context, serviceCategory: string, rentalModule = "") {
  const { details, job, access } = context;
  if (!job.assignee_member_id) return "Assign this job to a team member before adding this form.";
  if (!details?.display_name) return "The assigned team member is no longer active. Reassign the job first.";
  let capabilities: unknown = [];
  try { capabilities = JSON.parse(text(details.capabilities) || "[]"); } catch { /* Invalid saved capabilities grant no additional access. */ }
  if (details.member_uid !== access.ownerUid && (!Array.isArray(capabilities) || !capabilities.includes(serviceCategory))) {
    return "The assigned team member does not have this work type enabled in Teams. Reassign the job or update their work types.";
  }
  const gates = rentalAssignmentRequiredGates(rentalModule ? [rentalModule] : []);
  if (gates.length) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date());
    const credentialDate = [today, text(details.scheduled_start).slice(0, 10)].sort().at(-1)!;
    const match = await getD1().prepare(`SELECT member.id FROM trade_team_members member
      WHERE member.id = ? AND member.owner_uid = ? AND member.status = 'active'
        AND ${rentalAssignmentCredentialSql("member.id", "member.owner_uid")}`)
      .bind(job.assignee_member_id, access.ownerUid, JSON.stringify(gates), credentialDate, credentialDate).first();
    if (!match) return "The assigned worker needs a current matching qualification and supporting document in Teams for this safety check.";
  }
  return "";
}

async function options(context: Context) {
  const blocked = unavailable(context);
  const state = text(context.details?.address_state);
  const fieldForms = new Set(activityFieldCatalogue().map((form) => form.activityTemplateId));
  const selectedModules: string[] = context.inspection
    ? normalizeRentalAssessmentModules(context.inspection.selected_modules_snapshot || context.inspection.module_selection_snapshot) : [];
  const programs = GOVERNMENT_PROGRAM_TEMPLATES.filter((program) => ["current", "limited"].includes(program.catalogueState)
    && (program.jurisdiction === "AU" || program.jurisdiction === state));
  const capabilities = new Map<string, Promise<string>>();
  const reasonFor = (category: string) => {
    if (!capabilities.has(category)) capabilities.set(category, workerReason(context, category));
    return capabilities.get(category)!;
  };
  const activities = await Promise.all(GOVERNMENT_ACTIVITY_TEMPLATES.filter((activity) => ["current", "limited"].includes(activity.catalogueState)
    && programs.some((program) => program.programCode === activity.programCode)).map(async (activity) => ({
      id: activity.templateId, programTemplateId: programs.find((program) => program.programCode === activity.programCode)!.templateId,
      programCode: activity.programCode, code: activity.registryActivityCode || activity.activityKey, title: activity.title,
      added: context.intents.some((intent) => intent.activity_template_id === activity.templateId),
      unavailableReason: blocked || (!fieldForms.has(activity.templateId) ? "The activity form is not available in the field app yet." : "")
        || (context.intents.length >= MAX_TRADE_COMPLIANCE_ACTIVITIES ? `This job already has ${MAX_TRADE_COMPLIANCE_ACTIVITIES} program activities.` : "")
        || await reasonFor(activity.serviceCategory),
    })));
  const rentalModules = await Promise.all(RENTAL_ASSESSMENT_MODULES.map(async (module) => ({
    id: module.key, title: module.key === "minimum_standards" ? "Rental assessment + 2027 standards" : module.label,
    added: selectedModules.includes(module.key),
    unavailableReason: blocked || (state !== "VIC" ? "Rental assessment forms currently cover Victorian properties." : "")
      || (context.inspection && !editableInspection.has(text(context.inspection.status)) ? "The rental report is already being issued or has been issued." : "")
      || await workerReason(context, "rental-inspection", module.key),
  })));
  return { ok: true, revision: context.job.revision, buildingType: text(context.details?.building_type), canAdd: !blocked,
    unavailableReason: blocked, programs: programs.map((program) => ({ id: program.templateId, code: program.programCode, label: `${program.claimOutputCode} | ${program.name}` })),
    activities, rentalModules };
}

function failure(error: unknown) {
  if (error instanceof BoundedJsonRequestError) return adminJson({ ok: false, code: error.code, error: error.message }, error.status);
  if (error instanceof TradeComplianceIntentError) return adminJson({ ok: false, code: error.code, error: error.message }, 400);
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "JOB_NOT_FOUND") return adminJson({ ok: false, error: "This job is no longer available." }, 404);
  if (code === "ONLINE_MUTATION_CONFLICT") return adminJson({ ok: false, code: "REVISION_CONFLICT", error: "This job changed while the form was being added. Refresh the library and try again." }, 409);
  if (/ACCESS|AUTH|ASSIGNED|ABN_REVIEW|EMAIL_VERIFICATION/.test(code)) return adminJson({ ok: false, error: "Active authorised Team access is required." }, 403);
  console.error("Adding a job activity failed", code);
  return adminJson({ ok: false, error: "The activity could not be added. Refresh the library before trying again." }, 500);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    return adminJson(await options(await context(access, cleanAdminText(new URL(request.url).searchParams.get("workOrderId"), 180))));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    if (!canManageJobs(access)) return adminJson({ ok: false, error: "Your Team role does not allow adding work to jobs." }, 403);
    const raw = await readBoundedJsonRequest(request);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return adminJson({ ok: false, error: "Choose a form to add." }, 400);
    const body = raw as Row;
    const current = await context(access, cleanAdminText(body.workOrderId, 180));
    const blocked = unavailable(current);
    if (blocked) return adminJson({ ok: false, error: blocked }, 409);
    const catalogue = await options(current);
    const kind = body.kind;
    const selected = kind === "rental" ? catalogue.rentalModules.find((item) => item.id === body.moduleKey)
      : kind === "program" ? catalogue.activities.find((item) => item.id === body.activityTemplateId && item.programTemplateId === body.programTemplateId) : null;
    if (!selected) return adminJson({ ok: false, error: "Choose an available activity from the library." }, 400);
    // An acknowledged or timed-out add can be replayed without creating duplicate modules.
    if (selected.added) return adminJson({ ...catalogue, added: { kind, id: selected.id }, message: "This form is already attached to the job." });
    if (selected.unavailableReason) return adminJson({ ok: false, error: selected.unavailableReason }, 409);
    if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision !== current.job.revision) return adminJson({ ok: false, code: "REVISION_CONFLICT", error: "This job changed. Refresh the library before adding the form." }, 409);
    const db = getD1();
    const now = new Date().toISOString();
    const revision = nextJobRevision(current.job.revision);
    const details = current.details!;
    const activityCategory = kind === "program" ? GOVERNMENT_ACTIVITY_TEMPLATES.find((activity) => activity.templateId === selected.id)!.serviceCategory : "rental-inspection";
    const gates = rentalAssignmentRequiredGates(kind === "rental" ? [selected.id] : []);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date());
    const credentialDate = [today, text(details.scheduled_start).slice(0, 10)].sort().at(-1)!;
    const statements: D1PreparedStatement[] = [db.prepare(`UPDATE trade_work_orders SET revision = ?, updated_at = ?
      WHERE id = ? AND firebase_uid = ? AND revision = ? AND record_status = 'active' AND stage = ? AND assignee_member_id = ?`)
      .bind(revision, now, current.workOrderId, access.ownerUid, current.job.revision, current.job.stage, current.job.assignee_member_id)];
    // The same transaction rechecks the worker's current capability and safety credentials.
    statements.push(db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
      SELECT ?, ?, ?, 'online_mutation_guard', NULL, ? WHERE NOT EXISTS (
        SELECT 1 FROM trade_team_members member WHERE member.id = ? AND member.owner_uid = ? AND member.status = 'active'
          AND (member.member_uid = ? OR EXISTS (SELECT 1 FROM json_each(member.capabilities) capability WHERE capability.value = ?))
          AND ${rentalAssignmentCredentialSql("member.id", "member.owner_uid")})`)
      .bind(crypto.randomUUID(), current.workOrderId, access.ownerUid, now, current.job.assignee_member_id,
        access.ownerUid, access.ownerUid, activityCategory, JSON.stringify(gates), credentialDate, credentialDate));

    if (kind === "program") {
      const intent = resolveTradeComplianceIntent({ mode: "planned", programTemplateId: body.programTemplateId,
        activityTemplateId: body.activityTemplateId, variantId: body.variantId, buildingType: details.building_type,
        siteJurisdiction: details.address_state, plannedStart: details.scheduled_start });
      if (!intent) throw new Error("ACTIVITY_SELECTION_REQUIRED");
      defaultActivityFieldForm(intent.activity.templateId, intent.snapshot.activity.variantId || "");
      const organisation = await db.prepare("SELECT id FROM compliance_organisations WHERE organisation_code = ? AND status = 'active' LIMIT 1")
        .bind(CREDITEX_PARTNER_ORGANISATION_CODE).first<{ id: string }>();
      if (!organisation) return adminJson({ ok: false, error: "The Creditex connection is unavailable. Try adding the program form again when it is restored." }, 409);
      const snapshot = stableTradeComplianceIntentJson(intent.snapshot);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshot));
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      statements.push(db.prepare(`INSERT INTO trade_work_order_compliance_intents
        (id, work_order_id, intent_key, installer_uid, compliance_organisation_id, program_template_id, activity_template_id,
         program_code, registry_activity_code, service_category, site_jurisdiction, planned_start, catalogue_reviewed_on,
         intent_snapshot, intent_snapshot_sha256, status, compliance_case_id, revision, created_by_uid, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', '', 1, ?, ?, ?)`)
        .bind(crypto.randomUUID(), current.workOrderId, `program:${intent.program.templateId}:activity:${intent.activity.templateId}`,
          access.ownerUid, organisation.id, intent.program.templateId, intent.activity.templateId, intent.program.programCode,
          intent.activity.registryActivityCode, intent.activity.serviceCategory, intent.snapshot.siteJurisdiction,
          intent.snapshot.plannedStart, intent.snapshot.catalogueReviewedOn, snapshot, hash, access.actorUid, now, now));
    } else {
      await ensureTradeRentalSchemaGuards(db);
      const moduleKey = selected.id;
      const previous = current.inspection;
      const moduleKeys = [...new Set([...(previous ? normalizeRentalAssessmentModules(previous.selected_modules_snapshot || previous.module_selection_snapshot) : []), moduleKey])];
      const template = rentalAssessmentTemplateSnapshot(moduleKeys, previous?.assessment_scope || "current_minimum_standards");
      const inspectionId = text(previous?.id) || crypto.randomUUID();
      if (previous) {
        statements.push(db.prepare(`UPDATE trade_rental_inspections SET selected_modules_snapshot = ?, module_selection_snapshot = ?,
          status = 'in_progress', revision = revision + 1, updated_at = ? WHERE id = ? AND firebase_uid = ? AND revision = ?`)
          .bind(JSON.stringify(moduleKeys), JSON.stringify([...new Set(["minimum_standards", ...moduleKeys])]), now, inspectionId, access.ownerUid, previous.revision));
      } else {
        const propertySnapshot = { schemaVersion: "tlink-rental-property-v1",
          customer: { id: details.crm_customer_id, displayName: text(details.business_name) || `${text(details.first_name)} ${text(details.last_name)}`.trim(), email: text(details.email), phone: text(details.phone) },
          property: { serviceSiteId: details.service_site_id, buildingType: details.building_type, addressLine1: text(details.address_line_1), addressLine2: text(details.address_line_2), suburb: text(details.suburb), state: text(details.address_state), postcode: text(details.postcode) },
          appointment: { id: text(details.appointment_id), startsAt: text(details.scheduled_start), endsAt: text(details.scheduled_end), assessorMemberId: current.job.assignee_member_id, assessorLabel: current.job.assignee_label } };
        statements.push(db.prepare(`INSERT INTO trade_rental_inspections
          (id, work_order_id, firebase_uid, service_site_id, inspection_number, jurisdiction, status, template_key, template_version,
           rules_effective_from, assessment_scope, module_selection_snapshot, selected_modules_snapshot, property_snapshot,
           assessor_uid, assessor_member_id, assessor_snapshot, revision, creation_request_id, created_by_uid, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'VIC', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
          .bind(inspectionId, current.workOrderId, access.ownerUid, details.service_site_id, `RMS-${text(details.work_number).replace(/^TLJ-/, "")}`,
            details.scheduled_start ? "scheduled" : "draft", template.key, template.version, template.effectiveFrom, template.assessmentScope,
            JSON.stringify([...new Set(["minimum_standards", ...moduleKeys])]), JSON.stringify(moduleKeys), JSON.stringify(propertySnapshot),
            text(details.member_uid), current.job.assignee_member_id, JSON.stringify({ memberId: current.job.assignee_member_id, uid: text(details.member_uid), displayName: current.job.assignee_label }),
            current.workOrderId, access.actorUid, now, now));
      }
      const moduleTemplate = template.modules[moduleKey];
      statements.push(db.prepare(`INSERT INTO trade_rental_inspection_modules
        (id, inspection_id, firebase_uid, module_key, required, selected_required, status, template_version, template_name,
         required_capability, template_snapshot, answers, revision, completed_by_uid, completed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, 'not_started', ?, ?, ?, ?, '{}', 1, '', '', ?, ?)`)
        .bind(crypto.randomUUID(), inspectionId, access.ownerUid, moduleKey, moduleKey === "minimum_standards" ? 1 : 0,
          moduleTemplate.templateVersion, moduleTemplate.title, moduleTemplate.credentialGate || "qualified_assessor", JSON.stringify(moduleTemplate), now, now));
      statements.push(db.prepare(`INSERT INTO trade_rental_inspection_events
        (id, inspection_id, report_id, report_link_id, firebase_uid, actor_type, actor_uid, event_type, request_id, summary, metadata, source_ip_sha256, user_agent_sha256, created_at)
        VALUES (?, ?, '', '', ?, ?, ?, 'inspection_module_attached', ?, ?, ?, '', '', ?)`)
        .bind(crypto.randomUUID(), inspectionId, access.ownerUid, access.isOwner ? "owner" : "assessor", access.actorUid,
          crypto.randomUUID(), `${selected.title} added to this job.`, JSON.stringify({ moduleKey }), now));
    }
    statements.push(db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
      VALUES (?, ?, ?, 'activity_form_attached', ?, ?)`).bind(crypto.randomUUID(), current.workOrderId, access.ownerUid, `${selected.title} added to this job.`, now),
      ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId: current.workOrderId, revision, changedAt: now, audienceMemberId: current.job.assignee_member_id }));
    await guardedOnlineJobMutationBatch(db, statements, { kind: "stage", jobRevision: revision, jobStage: current.job.stage,
      ownerUid: access.ownerUid, updatedAt: now, workOrderId: current.workOrderId });
    return adminJson({ ...await options(await context(access, current.workOrderId)), added: { kind, id: selected.id }, message: `${selected.title} added. Open it from this job's forms.` });
  } catch (error) { return failure(error); }
}
