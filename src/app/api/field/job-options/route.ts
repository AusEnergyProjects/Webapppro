import { getD1 } from "../../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { tradeFieldPermissions } from "@/lib/trade-field-permissions";
import { ENERGY_SERVICE_CATALOGUE } from "@/lib/energy-service-catalogue.mjs";
import { GOVERNMENT_ACTIVITY_TEMPLATES, GOVERNMENT_PROGRAM_TEMPLATES } from "@/lib/australian-government-program-catalogue";

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
    const services = [
      { id: "rental-inspection", label: "Rental inspections and safety checks" },
      ...ENERGY_SERVICE_CATALOGUE,
      { id: "electrical", label: "Electrical work" }, { id: "plumbing", label: "Plumbing" },
      { id: "mounting-hardware", label: "Mounting hardware" }, { id: "controls", label: "Controls" },
    ];
    if (category && !services.some((item) => item.id === category)) return adminJson({ ok: false, error: "Choose a valid work type." }, 400);
    const rows = await getD1().prepare(`SELECT id, display_name FROM trade_team_members
      WHERE owner_uid = ? AND status = 'active' AND (? = 1 OR id = ?)
        AND (? = '' OR member_uid = ? OR EXISTS (SELECT 1 FROM json_each(capabilities) WHERE value = ?))
        AND (? = '' OR instr(lower(display_name), lower(?)) > 0 OR id = ? OR id = ?)
      ORDER BY id = ? DESC, id = ? DESC, display_name COLLATE NOCASE, id LIMIT 51`)
      .bind(access.ownerUid, permissions.canAssignJobs ? 1 : 0, access.memberId,
        category, access.ownerUid, category, search, search, access.memberId, selectedMemberId, access.memberId, selectedMemberId)
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
    if (error instanceof Error && error.message === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
    if (error instanceof Error && ["ABN_REVIEW_REQUIRED", "TEAM_ACCESS_RECORD_REQUIRED", "EMAIL_VERIFICATION_REQUIRED", "FIELD_ACCESS_REQUIRED"].includes(error.message)) return adminJson({ ok: false, error: "Active approved Team access is required." }, 403);
    return adminJson({ ok: false, error: "Job options could not be loaded. Try again." }, 500);
  }
}
