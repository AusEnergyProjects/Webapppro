import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import * as catalogue from "../src/lib/australian-government-program-catalogue.ts";
import * as energyServices from "../src/lib/energy-service-catalogue.mjs";
import { tradeFieldPermissions } from "../src/lib/trade-field-permissions.ts";
import * as rentalAssessment from "../src/lib/trade-rental-assessment.mjs";
import * as rentalCredentials from "../src/lib/trade-rental-credentials.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const native = read("../mobile/src/app/new-job.tsx");
const crm = read("../src/app/api/trade-crm/route.ts");
const optionsSource = read("../src/app/api/field/job-options/route.ts");
const admin = {
  cleanAdminText: (value, limit) => String(value || "").trim().slice(0, limit),
  sameOrigin: () => true,
  adminJson: (body, status = 200) => Response.json(body, { status }),
};

function loadModule(source, dependencies) {
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, result, result.exports);
  return result.exports;
}
const intents = loadModule(read("../src/lib/trade-compliance-intent.ts"), { "./australian-government-program-catalogue": catalogue });

function sourceFunction(source, name, dependencies = {}) {
  const ast = ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    if (!declaration) ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(declaration, `Missing function ${name}`);
  const output = ts.transpileModule(declaration.getText(ast).replace(/^export\s+/, ""), {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${output}; return ${name};`)(...Object.values(dependencies));
}

function fixture(overrides = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE trade_team_members (id TEXT, owner_uid TEXT, member_uid TEXT, display_name TEXT, status TEXT, capabilities TEXT);
    CREATE TABLE trade_team_member_credentials (id TEXT, owner_uid TEXT, team_member_id TEXT, file_id TEXT, rental_gate TEXT, status TEXT,
      credential_type TEXT, jurisdiction TEXT, expires_at TEXT, credential_number TEXT);
    CREATE TABLE trade_team_member_files (id TEXT, owner_uid TEXT, team_member_id TEXT, status TEXT, expires_at TEXT);
    CREATE TABLE trade_crm_write_guards (id TEXT PRIMARY KEY, firebase_uid TEXT, operation_id TEXT, step_number INTEGER, verified INTEGER CHECK (verified = 1), created_at TEXT);
    INSERT INTO trade_team_members VALUES
    ('self','business','business','Business owner','active','[]'),
    ('rental','business','rental-user','Rental worker','active','["rental-inspection"]'),
    ('both','business','both-user','Multi-skilled worker','active','["rental-inspection","hot-water"]'),
    ('inactive','business','inactive-user','Inactive worker','inactive','["rental-inspection","hot-water"]'),
    ('foreign','other-business','foreign-user','Other business','active','["rental-inspection","hot-water"]');`);
  const access = { ownerUid: "business", actorUid: "business", memberId: "self", isOwner: true,
    canCreateJobs: false, canAssignJobs: false, jobScope: "own", canRescheduleJobs: false, scheduleScope: "own", ...overrides };
  const d1 = { prepare(sql) { return { bind(...values) { return {
    async all() { return { results: db.prepare(sql).all(...values) }; },
    async first() { return db.prepare(sql).get(...values) || null; },
    async run() { const result = db.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
  }; } }; } };
  const route = loadModule(optionsSource, {
    "../../../../../db": { getD1: () => d1 },
    "@/lib/admin-server": admin,
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async () => access },
    "@/lib/trade-field-permissions": { tradeFieldPermissions },
    "@/lib/energy-service-catalogue.mjs": energyServices,
    "@/lib/australian-government-program-catalogue": catalogue,
    "@/lib/trade-compliance-intent": intents,
    "@/lib/trade-rental-assessment.mjs": rentalAssessment,
    "@/lib/trade-rental-credentials": rentalCredentials,
  });
  const get = (query = {}) => route.GET(new Request(`https://example.test/api/field/job-options?${new URLSearchParams({ state: "VIC", serviceCategory: "rental-inspection", ...query })}`));
  return { db, d1, get };
}

function selection(programCode, activityKey) {
  const program = catalogue.GOVERNMENT_PROGRAM_TEMPLATES.find((item) => item.programCode === programCode);
  const activity = catalogue.GOVERNMENT_ACTIVITY_TEMPLATES.find((item) => item.programCode === programCode && item.activityKey === activityKey);
  assert.ok(program && activity, `Missing ${programCode} ${activityKey}`);
  return { programTemplateId: program.templateId, activityTemplateId: activity.templateId };
}

test("a new job requires a deliberate worker choice and never substitutes self", () => {
  const retain = sourceFunction(native, "retainChosenAssignee");
  const assignees = [{ id: "self" }, { id: "worker" }];
  assert.equal(retain("", assignees), "");
  assert.equal(retain("worker", assignees), "worker");
  assert.equal(retain("removed-worker", assignees), "");
  assert.equal(retain("worker", [{ id: "self" }]), "");
  assert.match(native, /\[assigneeMemberId, setAssigneeMemberId\] = useState\(''\)/);
  assert.match(native, /placeholder="Choose who will do this job"/);
});

test("business owners and field users with full scheduling grants can select eligible active workers", async () => {
  for (const overrides of [{}, { isOwner: false, canCreateJobs: true, canAssignJobs: true, jobScope: "team", canRescheduleJobs: true, scheduleScope: "team" }]) {
    const { db, get } = fixture(overrides);
    try {
      const result = await (await get()).json();
      assert.equal(result.permissions.canAssignJobs, true);
      assert.deepEqual(result.assignees.map((item) => item.id).sort(), ["both", "rental", "self"]);
    } finally { db.close(); }
  }
});

test("electrical, plumbing and insulation specialists can be registered and assigned through the same service catalogue", async () => {
  const { db, get } = fixture();
  try {
    for (const service of ["electrical", "plumbing", "insulation"]) {
      const capabilities = energyServices.normalizeEnergyServiceIds([service]);
      assert.deepEqual(capabilities, [service], `${service} must be accepted by business registration`);
      db.prepare("INSERT INTO trade_team_members VALUES (?, 'business', ?, ?, 'active', ?)")
        .run(service, `${service}-worker`, `${service} specialist`, JSON.stringify(capabilities));
      const response = await get({ serviceCategory: service });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.services.filter((item) => item.id === service).length, 1);
      assert.deepEqual(result.assignees.map((item) => item.id).sort(), [service, "self"].sort());
    }
  } finally { db.close(); }
});

test("own-scope or incomplete scheduling grants cannot expose other workers through search or selected IDs", async () => {
  for (const permissions of [
    { canAssignJobs: false, jobScope: "team", canRescheduleJobs: true, scheduleScope: "team" },
    { canAssignJobs: true, jobScope: "own", canRescheduleJobs: true, scheduleScope: "team" },
    { canAssignJobs: true, jobScope: "team", canRescheduleJobs: false, scheduleScope: "team" },
    { canAssignJobs: true, jobScope: "team", canRescheduleJobs: true, scheduleScope: "own" },
  ]) {
    const { db, get } = fixture({ isOwner: false, canCreateJobs: true, memberId: "rental", ...permissions });
    try {
      const result = await (await get({ search: "Multi", selectedMemberId: "both" })).json();
      assert.equal(result.permissions.canAssignJobs, false);
      assert.deepEqual(result.assignees.map((item) => item.id), ["rental"]);
    } finally { db.close(); }
  }
});

test("an eligible selected worker survives search and a roster page limit", async () => {
  const { db, get } = fixture();
  try {
    const insert = db.prepare("INSERT INTO trade_team_members VALUES (?, 'business', ?, ?, 'active', '[\"rental-inspection\"]')");
    for (let index = 0; index < 70; index += 1) insert.run(`worker-${index}`, `uid-${index}`, `Worker ${index}`);
    const result = await (await get({ selectedMemberId: "worker-69" })).json();
    assert.equal(result.moreAssignees, true);
    assert.equal(result.assignees.length, 50);
    assert.ok(result.assignees.some((item) => item.id === "worker-69"));
    const searched = await (await get({ search: "Rental", selectedMemberId: "worker-69" })).json();
    assert.ok(searched.assignees.some((item) => item.id === "worker-69"));
  } finally { db.close(); }
});

test("a rental visit may explicitly add hot water and only offers workers with both service capabilities", async () => {
  const { db, d1, get } = fixture();
  try {
    const hotWater = selection("VEU", "3");
    const response = await get({ activities: JSON.stringify([hotWater]), search: "Multi", selectedMemberId: "rental" });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.assignees.map((item) => item.id).sort(), ["both", "self"]);
    const assertCapability = sourceFunction(crm, "assertMemberCapability", { parsedCapabilities: JSON.parse });
    await assert.rejects(assertCapability(d1, { uid: "business" }, "rental", "hot-water"), /MEMBER_CAPABILITY_REQUIRED/);
    assert.ok(await assertCapability(d1, { uid: "business" }, "both", "hot-water"));
    assert.equal(await assertCapability(d1, { uid: "business" }, "inactive", "hot-water"), null);
    assert.equal(await assertCapability(d1, { uid: "business" }, "foreign", "hot-water"), null);
  } finally { db.close(); }
});

test("closed and mismatched program activities are rejected; additional current work keeps its own category", async () => {
  const { db, get } = fixture();
  try {
    const closed = await get({ activities: JSON.stringify([selection("VEU", "45")]) });
    assert.equal(closed.status, 400);
    assert.equal((await closed.json()).code, "ACTIVITY_CLOSED");
    const mismatched = { ...selection("VEU", "3"), programTemplateId: catalogue.GOVERNMENT_PROGRAM_TEMPLATES.find((item) => item.claimOutputCode === "STC").templateId };
    const rejected = await get({ activities: JSON.stringify([mismatched]) });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).code, "GOVERNMENT_ACTIVITY_NOT_FOUND");
    const result = await (await get()).json();
    assert.ok(!result.activities.some((item) => item.id === selection("VEU", "45").activityTemplateId));
    const validate = sourceFunction(native, "validPlannedActivities");
    assert.equal(validate([], result), true);
    assert.equal(validate([selection("VEU", "3")], result), true);
    assert.equal(validate([mismatched], result), false);
  } finally { db.close(); }
});

test("scheduled creation refuses an omitted worker before any database mutation", async () => {
  for (const assigneeMemberId of [undefined, "", "   "]) {
    let mutations = 0;
    const post = sourceFunction(crm, "POST", {
      ...admin, crmIdentity: async () => ({ memberId: "self", access: { isOwner: true } }),
      boundedCrmRequestBody: async (request) => request.json(), canCreateJobs: () => true,
      getD1: () => ({ prepare: () => { mutations += 1; throw new Error("Unexpected mutation"); } }),
      errorResponse: (error) => { throw error; },
    });
    const response = await post(new Request("https://example.test/api/trade-crm", { method: "POST", body: JSON.stringify({ action: "create_scheduled_job", assigneeMemberId }) }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "ASSIGNEE_REQUIRED");
    assert.equal(mutations, 0);
  }
});

test("specialised rental checks require credentials valid for the appointment even for the owner", async () => {
  const { db, d1, get } = fixture();
  try {
    db.exec(`INSERT INTO trade_team_member_files VALUES ('electrical-file','business','both','active','2099-01-01');
      INSERT INTO trade_team_member_credentials VALUES ('electrical','business','both','electrical-file','licensed_electrician','active','licence','VIC','2099-01-01','A123');`);
    const ordinary = await (await get({ rentalModules: '["minimum_standards"]' })).json();
    assert.deepEqual(ordinary.assignees.map((item) => item.id).sort(), ["both", "rental", "self"]);
    const selected = { rentalModules: '["minimum_standards","electrical_safety_check"]', appointmentDate: "2030-01-01" };
    assert.deepEqual((await (await get(selected)).json()).assignees.map((item) => item.id), ["both"]);
    const extra = await (await get({ ...selected, rentalModules: '["electrical_safety_check","gas_safety_check"]' })).json();
    assert.deepEqual(extra.assignees, []);
    const guard = sourceFunction(crm, "tradeCrmScheduleMemberGuardStatement", rentalCredentials);
    const guardInput = { ownerUid: "business", memberId: "both", serviceCategory: "rental-inspection", changedAt: "2026-09-07T00:00:00Z",
      credentialDate: "2030-01-01", rentalGates: ["licensed_electrician"] };
    await guard(d1, guardInput).run();
    db.prepare("UPDATE trade_team_member_files SET expires_at = '2029-12-31' WHERE id = 'electrical-file'").run();
    assert.deepEqual((await (await get(selected)).json()).assignees, []);
    await assert.rejects(guard(d1, guardInput).run(), /CHECK constraint failed/);
    db.prepare("UPDATE trade_team_member_files SET expires_at = '2099-01-01', owner_uid = 'other-business' WHERE id = 'electrical-file'").run();
    assert.deepEqual((await (await get(selected)).json()).assignees, []);
    await assert.rejects(guard(d1, guardInput).run(), /CHECK constraint failed/);
  } finally { db.close(); }
});
