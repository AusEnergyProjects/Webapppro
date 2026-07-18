import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { canDispatch, requireInstallerTeamAccess, type TeamAccess } from "@/lib/trade-team-server";
import {
  normalisePhotoRequirements,
  normalisePhotoTemplateFeedback,
  PHOTO_REQUEST_SERVICE_CATEGORIES,
  PHOTO_TEMPLATE_LIMIT,
  type PhotoRequirement,
} from "@/lib/trade-photo-requests";

export const runtime = "edge";

type TemplateRow = {
  id: string;
  firebase_uid: string;
  name: string;
  service_category: string;
  status: string;
  draft_requirements: string;
  published_version: number;
  created_at: string;
  updated_at: string;
};

type VersionRow = {
  id: string;
  template_id: string;
  version: number;
  name: string;
  service_category: string;
  requirements: string;
  published_at: string;
};

type RequestUsageRow = {
  id: string;
  source_template_id: string;
  source_template_version_id: string;
  source_template_edited: number;
  requirements: string;
  template_feedback: string;
  template_missing_feedback: number;
};

const serviceCategories = new Set<string>(PHOTO_REQUEST_SERVICE_CATEGORIES);

function responseForError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["ACCOUNT_INACTIVE", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED", "TEAM_ACCESS_REQUIRED"].includes(code)) {
    return adminJson({ ok: false, error: "An active verified installer account is required." }, 403);
  }
  if (code === "PHOTO_TEMPLATE_MANAGEMENT_REQUIRED") return adminJson({ ok: false, error: "Only the owner, manager or coordinator can manage photo templates." }, 403);
  if (code === "PHOTO_TEMPLATE_NOT_FOUND") return adminJson({ ok: false, error: "Photo template not found." }, 404);
  if (code === "PHOTO_TEMPLATE_ARCHIVED") return adminJson({ ok: false, error: "Archived photo templates cannot be changed or used for new requests." }, 409);
  if (code === "PHOTO_TEMPLATE_LIMIT") return adminJson({ ok: false, error: "This workspace has reached its 60 photo-template limit." }, 409);
  if (code === "PHOTO_TEMPLATE_NAME_REQUIRED") return adminJson({ ok: false, error: "Add a clear template name." }, 400);
  if (code === "PHOTO_TEMPLATE_UNCHANGED") return adminJson({ ok: false, error: "Change the draft before publishing another version." }, 409);
  if (code === "INVALID_PHOTO_REQUIREMENTS") return adminJson({ ok: false, error: "Add between 1 and 12 complete, uniquely named photo requirements." }, 400);
  return adminJson({ ok: false, error: "The photo template could not be completed." }, 500);
}

function requireManager(access: TeamAccess) {
  if (!canDispatch(access)) throw new Error("PHOTO_TEMPLATE_MANAGEMENT_REQUIRED");
}

function parseRequirements(value: string): PhotoRequirement[] {
  try { return normalisePhotoRequirements(JSON.parse(value)); }
  catch { return []; }
}

function cleanTemplateInput(body: Record<string, unknown>) {
  const name = cleanAdminText(body.name, 100);
  if (!name) throw new Error("PHOTO_TEMPLATE_NAME_REQUIRED");
  const requestedCategory = cleanAdminText(body.serviceCategory, 60);
  const serviceCategory = serviceCategories.has(requestedCategory) ? requestedCategory : "other";
  const requirements = normalisePhotoRequirements(body.requirements);
  return { name, serviceCategory, requirements };
}

async function ownedTemplate(ownerUid: string, templateId: string) {
  const row = await getD1().prepare("SELECT * FROM trade_crm_photo_templates WHERE id = ? AND firebase_uid = ?")
    .bind(templateId, ownerUid).first<TemplateRow>();
  if (!row) throw new Error("PHOTO_TEMPLATE_NOT_FOUND");
  return row;
}

async function libraryPayload(ownerUid: string) {
  const db = getD1();
  const [templateRows, versionRows, usageRows, completionRows] = await Promise.all([
    db.prepare(`SELECT * FROM trade_crm_photo_templates WHERE firebase_uid = ?
      ORDER BY status = 'archived', updated_at DESC, name COLLATE NOCASE`).bind(ownerUid).all<TemplateRow>(),
    db.prepare(`SELECT id, template_id, version, name, service_category, requirements, published_at
      FROM trade_crm_photo_template_versions WHERE firebase_uid = ? ORDER BY published_at DESC`).bind(ownerUid).all<VersionRow>(),
    db.prepare(`SELECT id, source_template_id, source_template_version_id, source_template_edited, requirements,
        template_feedback, template_missing_feedback
      FROM trade_crm_photo_requests WHERE firebase_uid = ? AND source_template_version_id <> ''`).bind(ownerUid).all<RequestUsageRow>(),
    db.prepare(`SELECT r.id request_id, m.photo_requirement_id
      FROM trade_crm_photo_requests r JOIN trade_crm_job_media m
        ON m.photo_request_id = r.id AND m.firebase_uid = r.firebase_uid
      WHERE r.firebase_uid = ? AND r.source_template_version_id <> '' AND m.source = 'customer_request'
      GROUP BY r.id, m.photo_requirement_id`).bind(ownerUid).all<Record<string, unknown>>(),
  ]);
  const completedByRequest = new Map<string, Set<string>>();
  for (const row of completionRows.results) {
    const requestId = String(row.request_id || "");
    const completed = completedByRequest.get(requestId) || new Set<string>();
    completed.add(String(row.photo_requirement_id || ""));
    completedByRequest.set(requestId, completed);
  }
  const versionsByTemplate = new Map<string, VersionRow[]>();
  const versionsById = new Map<string, VersionRow>();
  for (const version of versionRows.results) {
    versionsById.set(version.id, version);
    const versions = versionsByTemplate.get(version.template_id) || [];
    versions.push(version);
    versionsByTemplate.set(version.template_id, versions);
  }

  return templateRows.results.map((template) => {
    const versions = versionsByTemplate.get(template.id) || [];
    const latestVersion = versions.find((version) => Number(version.version) === Number(template.published_version)) || null;
    const usage = usageRows.results.filter((row) => row.source_template_id === template.id);
    const parsedUsage = usage.map((row) => ({
      ...row,
      parsedRequirements: parseRequirements(row.requirements),
      feedback: normalisePhotoTemplateFeedback(
        (() => { try { return JSON.parse(row.template_feedback); } catch { return {}; } })(),
        parseRequirements(versionsById.get(row.source_template_version_id)?.requirements || "[]"),
      ),
    }));
    const latestUsage = latestVersion ? parsedUsage.filter((row) => row.source_template_version_id === latestVersion.id) : [];
    const latestRequirements = latestVersion ? parseRequirements(latestVersion.requirements) : [];
    const feedbackCounts = { useful: 0, unclear: 0, unnecessary: 0 };
    for (const row of parsedUsage) for (const value of Object.values(row.feedback)) feedbackCounts[value] += 1;
    const requirementStats = latestRequirements.map((requirement) => {
      let selectedCount = 0; let completedCount = 0; let usefulCount = 0; let unclearCount = 0; let unnecessaryCount = 0;
      for (const row of latestUsage) {
        if (row.parsedRequirements.some((item) => item.id === requirement.id)) selectedCount += 1;
        if (completedByRequest.get(row.id)?.has(requirement.id)) completedCount += 1;
        if (row.feedback[requirement.id] === "useful") usefulCount += 1;
        if (row.feedback[requirement.id] === "unclear") unclearCount += 1;
        if (row.feedback[requirement.id] === "unnecessary") unnecessaryCount += 1;
      }
      return { id: requirement.id, label: requirement.label, selectedCount, completedCount, usefulCount, unclearCount, unnecessaryCount };
    });
    return {
      id: template.id,
      name: template.name,
      serviceCategory: template.service_category,
      status: template.status,
      draftRequirements: parseRequirements(template.draft_requirements),
      publishedVersion: Number(template.published_version),
      canSeed: template.status !== "archived" && Boolean(latestVersion),
      latestVersion: latestVersion ? {
        id: latestVersion.id,
        version: Number(latestVersion.version),
        name: latestVersion.name,
        serviceCategory: latestVersion.service_category,
        requirements: latestRequirements,
        publishedAt: latestVersion.published_at,
      } : null,
      metrics: {
        selections: parsedUsage.length,
        editedJobs: parsedUsage.filter((row) => Boolean(row.source_template_edited)).length,
        requestedRequirements: parsedUsage.reduce((sum, row) => sum + row.parsedRequirements.length, 0),
        completedRequirements: parsedUsage.reduce((sum, row) => sum + row.parsedRequirements.filter((item) => completedByRequest.get(row.id)?.has(item.id)).length, 0),
        missingFeedback: parsedUsage.filter((row) => Boolean(row.template_missing_feedback)).length,
        feedbackCounts,
        requirementStats,
      },
      createdAt: template.created_at,
      updatedAt: template.updated_at,
    };
  });
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request, false);
    requireManager(access);
    return adminJson({ ok: true, templates: await libraryPayload(access.ownerUid) });
  } catch (error) { return responseForError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request, false);
    requireManager(access);
    const body = await request.json() as Record<string, unknown>;
    const action = cleanAdminText(body.action, 30);
    const db = getD1();
    const now = new Date().toISOString();

    if (action === "create") {
      const input = cleanTemplateInput(body);
      const count = await db.prepare("SELECT COUNT(*) count FROM trade_crm_photo_templates WHERE firebase_uid = ? AND status <> 'archived'")
        .bind(access.ownerUid).first<Record<string, unknown>>();
      if (Number(count?.count || 0) >= PHOTO_TEMPLATE_LIMIT) throw new Error("PHOTO_TEMPLATE_LIMIT");
      await db.prepare(`INSERT INTO trade_crm_photo_templates
        (id, firebase_uid, name, service_category, status, draft_requirements, published_version,
         created_by_uid, updated_by_uid, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'draft', ?, 0, ?, ?, ?, ?)`).bind(
        crypto.randomUUID(), access.ownerUid, input.name, input.serviceCategory, JSON.stringify(input.requirements),
        access.actorUid, access.actorUid, now, now,
      ).run();
    } else if (action === "save_draft") {
      const template = await ownedTemplate(access.ownerUid, cleanAdminText(body.templateId, 180));
      if (template.status === "archived") throw new Error("PHOTO_TEMPLATE_ARCHIVED");
      const input = cleanTemplateInput(body);
      await db.prepare(`UPDATE trade_crm_photo_templates SET name = ?, service_category = ?, status = 'draft',
        draft_requirements = ?, updated_by_uid = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?`).bind(
        input.name, input.serviceCategory, JSON.stringify(input.requirements), access.actorUid, now, template.id, access.ownerUid,
      ).run();
    } else if (action === "publish") {
      const template = await ownedTemplate(access.ownerUid, cleanAdminText(body.templateId, 180));
      if (template.status === "archived") throw new Error("PHOTO_TEMPLATE_ARCHIVED");
      const input = cleanTemplateInput(body);
      const latest = Number(template.published_version) > 0 ? await db.prepare(`SELECT name, service_category, requirements
        FROM trade_crm_photo_template_versions WHERE template_id = ? AND firebase_uid = ? AND version = ?`)
        .bind(template.id, access.ownerUid, template.published_version).first<VersionRow>() : null;
      if (latest && latest.name === input.name && latest.service_category === input.serviceCategory
        && JSON.stringify(parseRequirements(latest.requirements)) === JSON.stringify(input.requirements)) throw new Error("PHOTO_TEMPLATE_UNCHANGED");
      const version = Number(template.published_version) + 1;
      await db.batch([
        db.prepare(`INSERT INTO trade_crm_photo_template_versions
          (id, template_id, firebase_uid, version, name, service_category, requirements, requirement_count, published_by_uid, published_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          crypto.randomUUID(), template.id, access.ownerUid, version, input.name, input.serviceCategory,
          JSON.stringify(input.requirements), input.requirements.length, access.actorUid, now,
        ),
        db.prepare(`UPDATE trade_crm_photo_templates SET name = ?, service_category = ?, status = 'published',
          draft_requirements = ?, published_version = ?, updated_by_uid = ?, updated_at = ?
          WHERE id = ? AND firebase_uid = ? AND published_version = ?`).bind(
          input.name, input.serviceCategory, JSON.stringify(input.requirements), version, access.actorUid, now,
          template.id, access.ownerUid, template.published_version,
        ),
      ]);
    } else if (action === "duplicate") {
      const template = await ownedTemplate(access.ownerUid, cleanAdminText(body.templateId, 180));
      const count = await db.prepare("SELECT COUNT(*) count FROM trade_crm_photo_templates WHERE firebase_uid = ? AND status <> 'archived'")
        .bind(access.ownerUid).first<Record<string, unknown>>();
      if (Number(count?.count || 0) >= PHOTO_TEMPLATE_LIMIT) throw new Error("PHOTO_TEMPLATE_LIMIT");
      const sourceRequirements = parseRequirements(template.draft_requirements);
      const copyName = cleanAdminText(body.name, 100) || `Copy of ${template.name}`.slice(0, 100);
      await db.prepare(`INSERT INTO trade_crm_photo_templates
        (id, firebase_uid, name, service_category, status, draft_requirements, published_version,
         created_by_uid, updated_by_uid, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'draft', ?, 0, ?, ?, ?, ?)`).bind(
        crypto.randomUUID(), access.ownerUid, copyName, template.service_category, JSON.stringify(sourceRequirements),
        access.actorUid, access.actorUid, now, now,
      ).run();
    } else if (action === "archive") {
      const template = await ownedTemplate(access.ownerUid, cleanAdminText(body.templateId, 180));
      await db.prepare(`UPDATE trade_crm_photo_templates SET status = 'archived', updated_by_uid = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ?`).bind(access.actorUid, now, template.id, access.ownerUid).run();
    } else {
      return adminJson({ ok: false, error: "Unsupported photo template action." }, 400);
    }
    return adminJson({ ok: true, templates: await libraryPayload(access.ownerUid) }, action === "create" || action === "duplicate" ? 201 : 200);
  } catch (error) { return responseForError(error); }
}
