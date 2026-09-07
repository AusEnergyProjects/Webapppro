import { getD1 } from "../../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { tradeFieldPermissions } from "@/lib/trade-field-permissions";
import { ENERGY_SERVICE_CATALOGUE } from "@/lib/energy-service-catalogue.mjs";
import { GOVERNMENT_ACTIVITY_TEMPLATES, GOVERNMENT_PROGRAM_TEMPLATES } from "@/lib/australian-government-program-catalogue";
import { resolveTradeComplianceIntents, TradeComplianceIntentError } from "@/lib/trade-compliance-intent";
import { normalizeRentalAssessmentModules } from "@/lib/trade-rental-assessment.mjs";
import { rentalAssignmentRequiredGates, rentalAssignmentCredentialSql } from "@/lib/trade-rental-credentials";

export const runtime = "edge";

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    const permissions = tradeFieldPermissions(access);
    if (!permissions.canCreateJobs) return adminJson({ ok: false, code: "JOB_CREATE_REQUIRED", error: "Your Team access does not allow new jobs." }, 403);
    const url = new URL(request.url);
    const state = cleanAdminText(url.searchParams.get("state"), 3).toUpperCase();
    const category = cleanAdminText(url.searchParams.get("serviceCategory"), 60);
    const selectedMemberId = cleanAdminText(url.searchParams.get("selectedMemberId"), 180);
    const search = cleanAdminText(url.searchParams.get("search"), 80);
    const appointmentDate = cleanAdminText(url.searchParams.get("appointmentDate"), 10);
    if (appointmentDate && (!/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate) || !Number.isFinite(Date.parse(appointmentDate))
      || new Date(appointmentDate).toISOString().slice(0, 10) !== appointmentDate)) return adminJson({ ok: false, error: "Choose a valid appointment date." }, 400);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date());
    const credentialDate = appointmentDate > today ? appointmentDate : today;
    const rawRentalModules = url.searchParams.get("rentalModules");
    const rentalModules = category === "rental-inspection" ? normalizeRentalAssessmentModules(rawRentalModules || undefined) : [];
    if (category === "rental-inspection" && rawRentalModules && rawRentalModules !== "[]" && !rentalModules.length) return adminJson({ ok: false, error: "Choose valid rental assessment modules." }, 400);
    const rentalGates = rentalAssignmentRequiredGates(rentalModules);
    const selectedActivities = resolveTradeComplianceIntents({
      mode: "none", activities: url.searchParams.get("activities") || "[]", siteJurisdiction: state,
    });
    const services = [
      { id: "rental-inspection", label: "Rental inspections and safety checks" },
      ...ENERGY_SERVICE_CATALOGUE,
      { id: "electrical", label: "Electrical work" }, { id: "plumbing", label: "Plumbing" },
      { id: "mounting-hardware", label: "Mounting hardware" }, { id: "controls", label: "Controls" },
    ];
    if (category && !services.some((item) => item.id === category)) return adminJson({ ok: false, error: "Choose a valid work type." }, 400);
    const requiredCapabilities = [...new Set([category, ...selectedActivities.map((item) => item.activity.serviceCategory)].filter(Boolean))];
    const rows = await getD1().prepare(`SELECT id, display_name FROM trade_team_members
      WHERE owner_uid = ? AND status = 'active' AND (? = 1 OR id = ?)
        AND (member_uid = ? OR NOT EXISTS (SELECT 1 FROM json_each(?) required_capability
          WHERE NOT EXISTS (SELECT 1 FROM json_each(capabilities) member_capability WHERE member_capability.value = required_capability.value)))
        AND ${rentalAssignmentCredentialSql("trade_team_members.id", "trade_team_members.owner_uid")}
        AND (? = '' OR instr(lower(display_name), lower(?)) > 0 OR id = ? OR id = ?)
      ORDER BY id = ? DESC, id = ? DESC, display_name COLLATE NOCASE, id LIMIT 51`)
      .bind(access.ownerUid, permissions.canAssignJobs ? 1 : 0, access.memberId,
        access.ownerUid, JSON.stringify(requiredCapabilities), JSON.stringify(rentalGates), credentialDate, credentialDate,
        search, search, access.memberId, selectedMemberId, access.memberId, selectedMemberId)
      .all<{ id: string; display_name: string }>();
    const programs = GOVERNMENT_PROGRAM_TEMPLATES.filter((program) =>
      (program.jurisdiction === "AU" || program.jurisdiction === state)
      && ["current", "limited"].includes(program.catalogueState));
    const activities = GOVERNMENT_ACTIVITY_TEMPLATES.filter((activity) =>
      ["current", "limited"].includes(activity.catalogueState)
      && programs.some((program) => program.programCode === activity.programCode));
    return adminJson({ ok: true, permissions, memberId: access.memberId, services,
      assignees: rows.results.slice(0, 50).map((row) => ({ id: row.id, displayName: row.display_name })),
      moreAssignees: rows.results.length > 50,
      programs: programs.filter((program) => activities.some((activity) => activity.programCode === program.programCode))
        .map((program) => ({ id: program.templateId, code: program.programCode, label: `${program.claimOutputCode} | ${program.name}` })),
      activities: activities.map((activity) => ({ id: activity.templateId, programCode: activity.programCode,
        code: activity.registryActivityCode || activity.activityKey, title: activity.title, serviceCategory: activity.serviceCategory })),
    });
  } catch (error) {
    if (error instanceof TradeComplianceIntentError) return adminJson({ ok: false, code: error.code, error: error.message }, 400);
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
    if (error instanceof Error && ["ABN_REVIEW_REQUIRED", "TEAM_ACCESS_RECORD_REQUIRED", "EMAIL_VERIFICATION_REQUIRED", "FIELD_ACCESS_REQUIRED"].includes(error.message)) return adminJson({ ok: false, error: "Active approved Team access is required." }, 403);
    return adminJson({ ok: false, error: "Job options could not be loaded. Try again." }, 500);
  }
}
