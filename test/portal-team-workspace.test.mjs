import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import * as contracts from "../src/lib/portal-team-workspace.ts";
import * as boundedJson from "../src/lib/bounded-json-request.ts";
import * as permissions from "../src/lib/creditex-permissions.ts";
import * as notifications from "../src/lib/creditex-notifications.ts";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const uuid = () => crypto.randomUUID();
function load(path, require) {
  const loaded = { exports: {} };
  const compiled = ts.transpileModule(read(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("require", "module", "exports", compiled)(require, loaded, loaded.exports);
  return loaded.exports;
}
function fixture(t) {
  const sqlite = new DatabaseSync(":memory:"); t.after(() => sqlite.close());
  sqlite.exec(`CREATE TABLE admin_users(id TEXT PRIMARY KEY,firebase_uid TEXT,display_name TEXT,role TEXT,status TEXT);
    CREATE TABLE compliance_organisations(id TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE compliance_users(id TEXT PRIMARY KEY,organisation_id TEXT,firebase_uid TEXT,display_name TEXT,role TEXT,status TEXT);
    INSERT INTO compliance_organisations VALUES('creditex','active'),('another','active');`);
  sqlite.exec(read("drizzle/0239_portal_team_workspace.sql"));
  sqlite.exec(read("drizzle/0238_portal_workspace_profiles.sql"));
  sqlite.exec(read("drizzle/0240_portal_profile_avatars.sql"));
  for (const [id, role] of [["owner", "owner"], ["a", "support"], ["b", "reviewer"], ["outside", "reviewer"], ["admin", "admin"]]) {
    sqlite.prepare("INSERT INTO admin_users VALUES(?,?,?,?, 'active')").run(id, `${id}-uid`, id, role);
  }
  for (const [id, role, organisation] of [["a", "auditor", "creditex"], ["b", "case_manager", "creditex"], ["outside", "reviewer", "creditex"], ["admin", "admin", "creditex"], ["foreign", "admin", "another"]]) {
    sqlite.prepare("INSERT INTO compliance_users VALUES(?,?,?,?,?,'active')").run(id, organisation, `${id}-uid`, id, role);
  }
  sqlite.exec("ALTER TABLE compliance_users ADD COLUMN permissions_json TEXT");
  let beforeWrite;
  function beforeMutation(sql) {
    if (beforeWrite && /(?:INSERT INTO portal_team_|UPDATE portal_team_)/.test(sql)) { const next = beforeWrite; beforeWrite = null; next(); }
  }
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async first() { return sqlite.prepare(this.sql).get(...this.values) || null; }
    async all() { return { results: sqlite.prepare(this.sql).all(...this.values) }; }
    runSync() { beforeMutation(this.sql); return { meta: { changes: Number(sqlite.prepare(this.sql).run(...this.values).changes) } }; }
    async run() { return this.runSync(); }
  }
  const db = { prepare: sql => new Statement(sql), async batch(statements) {
    if (beforeWrite) { const next = beforeWrite; beforeWrite = null; next(); }
    sqlite.exec("BEGIN"); try { const result = statements.map(statement => statement.runSync()); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  const authCalls = [];
  const adminAuth = async () => { authCalls.push("admin"); return { adminId: "a", uid: "a-uid" }; };
  const creditexAuth = async (_request, options) => { authCalls.push(["creditex", options]); return { membershipId: "a", organisationId: "creditex", uid: "a-uid" }; };
  const api = load("src/lib/portal-team-workspace-server.ts", name => {
    if (name === "../../db") return { getD1: () => db };
    if (name === "./portal-team-workspace") return contracts;
    if (name === "./creditex-permissions") return permissions;
    if (name === "./admin-server") return { requireAdminIdentity: adminAuth };
    if (name === "./compliance-access-server") return { requireComplianceAccess: creditexAuth };
    throw new Error(name);
  });
  const actor = (workspace = "creditex", id = "a", scopeId = workspace === "admin" ? "platform" : "creditex") => ({ workspace, scopeId, memberId: id, uid: `${id}-uid` });
  const create = (workspace = "creditex", creator = "a", assignee = "b", extras = {}) => api.savePortalTask(actor(workspace, creator), { action: "create_task", id: uuid(), title: "Check tomorrow's bookings", assigneeId: assignee, ...extras }, db);
  const message = (workspace = "creditex", sender = "a", recipient = "b", extras = {}) => api.sendPortalMessage(actor(workspace, sender), { id: uuid(), recipientId: recipient, body: "Please check the booking.", ...extras }, db);
  return { sqlite, db, api, actor, create, message, authCalls, beforeWrite: callback => { beforeWrite = callback; } };
}

for (const workspace of ["admin", "creditex"]) {
  test(`${workspace}: messages are visible only to their two active participants`, async t => {
    const f = fixture(t); await f.message(workspace);
    const outgoing = await f.api.portalMessages(f.actor(workspace, "a"), "b", "", f.db);
    const incoming = await f.api.portalMessages(f.actor(workspace, "b"), "a", "", f.db);
    assert.equal(outgoing.messages.length, 1); assert.equal(incoming.messages.length, 1);
    assert.equal(outgoing.messages[0].senderName, "a");
    assert.equal((await f.api.portalMessages(f.actor(workspace, "admin"), "a", "", f.db)).messages.length, 0, "administrator role does not reveal others' direct messages");
    assert.equal((await f.api.portalMessages(f.actor(workspace, "outside"), "a", "", f.db)).messages.length, 0);
  });
  test(`${workspace}: direct sends are idempotent and retain immutable sender and timestamp`, async t => {
    const f = fixture(t); const id = uuid();
    const first = await f.message(workspace, "a", "b", { id }); const second = await f.message(workspace, "a", "b", { id });
    assert.deepEqual(first, second);
    assert.equal(f.sqlite.prepare("SELECT count(*) count FROM portal_team_messages").get().count, 1);
    await assert.rejects(() => f.message(workspace, "a", "b", { id, body: "Different" }), /different details/);
    assert.throws(() => f.sqlite.prepare("UPDATE portal_team_messages SET sender_name='fake' WHERE id=?").run(id), /IMMUTABLE/);
    assert.throws(() => f.sqlite.prepare("DELETE FROM portal_team_messages WHERE id=?").run(id), /IMMUTABLE/);
  });
  test(`${workspace}: creator, assignee and workspace admin receive only their authorised task views`, async t => {
    const f = fixture(t); const task = await f.create(workspace);
    assert.equal((await f.api.portalTasks(f.actor(workspace, "a"), { view: "assigned" }, f.db)).total, 1);
    assert.equal((await f.api.portalTasks(f.actor(workspace, "b"), {}, f.db)).total, 1);
    assert.equal((await f.api.portalTasks(f.actor(workspace, "outside"), {}, f.db)).total, 0);
    assert.equal((await f.api.portalTasks(f.actor(workspace, "admin"), { view: "team" }, f.db)).total, 1);
    await assert.rejects(() => f.api.portalTasks(f.actor(workspace, "b"), { view: "team" }, f.db), /does not include viewing all team tasks/);
    await assert.rejects(() => f.api.savePortalTask(f.actor(workspace, "outside"), { action: "task_status", id: task.id, revision: 1, status: "done" }, f.db), /no longer available/);
  });
  test(`${workspace}: recipient can complete a task but only creator/admin can edit or reassign it`, async t => {
    const f = fixture(t); const task = await f.create(workspace);
    const edit = { action: "edit_task", id: task.id, revision: 1, title: "Changed", assigneeId: "outside" };
    await assert.rejects(() => f.api.savePortalTask(f.actor(workspace, "b"), edit, f.db), /does not allow editing/);
    await f.api.savePortalTask(f.actor(workspace, "b"), { action: "task_status", id: task.id, revision: 1, status: "done" }, f.db);
    const done = (await f.api.portalTasks(f.actor(workspace, "b"), { status: "done" }, f.db)).tasks[0];
    assert.ok(done.completedAt); assert.equal(done.revision, 2);
    await f.api.savePortalTask(f.actor(workspace, "a"), { ...edit, revision: 2, dueOn: "2028-02-29" }, f.db);
    const assigned = (await f.api.portalTasks(f.actor(workspace, "outside"), { status: "done" }, f.db)).tasks[0];
    assert.equal(assigned.dueOn, "2028-02-29"); assert.equal(assigned.creatorId, "a");
    await f.api.savePortalTask(f.actor(workspace, "admin"), { ...edit, revision: 3, assigneeId: "a" }, f.db);
    assert.equal((await f.api.portalTasks(f.actor(workspace, "a"), { status: "done" }, f.db)).tasks[0].revision, 4);
  });
  test(`${workspace}: live revocation stops writes even after the request identity was checked`, async t => {
    const f = fixture(t); const task = await f.create(workspace);
    const table = workspace === "admin" ? "admin_users" : "compliance_users";
    f.beforeWrite(() => f.sqlite.exec(`UPDATE ${table} SET status='suspended' WHERE id='a'`));
    await assert.rejects(() => f.api.savePortalTask(f.actor(workspace), { action: "task_status", id: task.id, revision: 1, status: "done" }, f.db), /access changed/);
    assert.equal(f.sqlite.prepare("SELECT status FROM portal_team_tasks").get().status, "open");
    assert.equal(f.sqlite.prepare("SELECT count(*) count FROM portal_team_events").get().count, 1);
    await assert.rejects(() => f.api.portalTasks(f.actor(workspace), {}, f.db), /access changed/);
    await assert.rejects(() => f.api.portalPeople(f.actor(workspace), "", f.db), /access changed/);
    f.sqlite.exec(`UPDATE ${table} SET status='active' WHERE id='a'`);
    f.beforeWrite(() => f.sqlite.exec(`UPDATE ${table} SET status='suspended' WHERE id='a'`));
    await assert.rejects(() => f.message(workspace), /access changed/);
    assert.equal(f.sqlite.prepare("SELECT count(*) count FROM portal_team_messages").get().count, 0);
  });
  test(`${workspace}: demoted administrators cannot mutate unrelated team tasks`, async t => {
    const f = fixture(t); const task = await f.create(workspace);
    const table = workspace === "admin" ? "admin_users" : "compliance_users";
    f.beforeWrite(() => f.sqlite.exec(`UPDATE ${table} SET role='reviewer' WHERE id='admin'`));
    await assert.rejects(() => f.api.savePortalTask(f.actor(workspace, "admin"), { action: "edit_task", id: task.id, revision: 1, title: "Changed", assigneeId: "admin" }, f.db), /access changed/);
    assert.equal(f.sqlite.prepare("SELECT title FROM portal_team_tasks").get().title, task.title);
  });
  test(`${workspace}: inactive recipients and identity changes cannot receive messages or tasks`, async t => {
    const f = fixture(t); const table = workspace === "admin" ? "admin_users" : "compliance_users";
    f.sqlite.exec(`UPDATE ${table} SET status='suspended' WHERE id='b'`);
    await assert.rejects(() => f.message(workspace), /access changed/);
    await assert.rejects(() => f.create(workspace), /no longer available/);
    assert.equal((await f.api.portalPeople(f.actor(workspace), "b", f.db)).people.length, 0);
    f.sqlite.exec(`UPDATE ${table} SET firebase_uid='replacement' WHERE id='a'`);
    await assert.rejects(() => f.api.portalMessages(f.actor(workspace), "outside", "", f.db), /access changed/);
  });
}

test("Creditex organisation isolation applies to directory, conversation and task IDs", async t => {
  const f = fixture(t); const task = await f.create(); await f.message();
  assert.equal((await f.api.portalPeople(f.actor(), "foreign", f.db)).people.length, 0);
  await assert.rejects(() => f.message("creditex", "a", "foreign"), /access changed/);
  await assert.rejects(() => f.create("creditex", "a", "foreign"), /no longer available/);
  const foreign = f.actor("creditex", "foreign", "another");
  assert.equal((await f.api.portalTasks(foreign, { view: "team" }, f.db)).total, 0);
  await assert.rejects(() => f.api.portalMessages(foreign, "a", "", f.db), /no longer available/);
  await assert.rejects(() => f.api.savePortalTask(foreign, { action: "task_status", id: task.id, revision: 1, status: "done" }, f.db), /no longer available/);
  await assert.rejects(() => f.api.portalPeople({ ...f.actor(), scopeId: "another" }, "", f.db), /access changed/);
});
test("identical member IDs in the two portals do not share messages or tasks", async t => {
  const f = fixture(t); await f.create(); await f.message();
  assert.equal((await f.api.portalTasks(f.actor("admin", "b"), {}, f.db)).total, 0);
  assert.equal((await f.api.portalMessages(f.actor("admin", "b"), "a", "", f.db)).messages.length, 0);
  await f.create("admin"); await f.message("admin");
  assert.equal((await f.api.portalTasks(f.actor("creditex", "b"), {}, f.db)).total, 1);
  assert.equal((await f.api.portalMessages(f.actor("creditex", "b"), "a", "", f.db)).messages.length, 1);
});
test("organisation suspension and a mid-request move revoke Creditex access", async t => {
  const f = fixture(t); const task = await f.create();
  f.beforeWrite(() => f.sqlite.exec("UPDATE compliance_users SET organisation_id='another' WHERE id='a'"));
  await assert.rejects(() => f.api.savePortalTask(f.actor(), { action: "edit_task", id: task.id, revision: 1, title: "Changed", assigneeId: "b" }, f.db), /access changed/);
  f.sqlite.exec("UPDATE compliance_users SET organisation_id='creditex' WHERE id='a'; UPDATE compliance_organisations SET status='suspended' WHERE id='creditex'");
  await assert.rejects(() => f.api.portalPeople(f.actor(), "", f.db), /access changed/);
  await assert.rejects(() => f.api.portalMessages(f.actor(), "b", "", f.db), /access changed/);
});
test("task creation is idempotent and an optimistic revision conflict creates no audit event", async t => {
  const f = fixture(t); const id = uuid(); const first = await f.create("creditex", "a", "b", { id });
  await f.create("creditex", "a", "b", { id });
  assert.equal(f.sqlite.prepare("SELECT count(*) count FROM portal_team_events").get().count, 1);
  await assert.rejects(() => f.create("creditex", "a", "b", { id, title: "Different" }), /different details/);
  f.beforeWrite(() => f.sqlite.exec("UPDATE portal_team_tasks SET revision=2"));
  await assert.rejects(() => f.api.savePortalTask(f.actor(), { action: "task_status", id, revision: first.revision, status: "done" }, f.db), /changed/);
  assert.equal(f.sqlite.prepare("SELECT count(*) count FROM portal_team_events").get().count, 1);
  assert.throws(() => f.sqlite.exec("UPDATE portal_team_tasks SET creator_uid='fake'"), /IDENTITY_IMMUTABLE/);
  assert.throws(() => f.sqlite.exec("UPDATE portal_team_events SET actor_uid='fake'"), /IMMUTABLE/);
});
test("new messages do not shift older message history pages", async t => {
  const f = fixture(t); for (let index = 0; index < 55; index++) await f.message("creditex", "a", "b", { body: `Message ${index}` });
  const first = await f.api.portalMessages(f.actor(), "b", "", f.db);
  assert.equal(first.messages.length, 50); assert.equal(first.hasMore, true);
  await f.message("creditex", "b", "a", { body: "Newest" });
  const older = await f.api.portalMessages(f.actor(), "b", first.before, f.db);
  assert.equal(older.messages.length, 5); assert.equal(older.hasMore, false);
  assert.equal(new Set([...first.messages, ...older.messages].map(row => row.id)).size, 55);
});
test("task and people lists are bounded and every task page is reachable", async t => {
  const f = fixture(t); for (let index = 0; index < 27; index++) await f.create("creditex", "a", "a", { title: `Task ${index}` });
  const first = await f.api.portalTasks(f.actor(), {}, f.db); const next = await f.api.portalTasks(f.actor(), { page: "2" }, f.db);
  assert.equal(first.total, 27); assert.equal(first.tasks.length, 25); assert.equal(first.totalPages, 2); assert.equal(next.tasks.length, 2);
  for (let index = 0; index < 35; index++) f.sqlite.prepare("INSERT INTO compliance_users VALUES(?,'creditex',?,?, 'reviewer','active',NULL)").run(`extra${index}`, `uid${index}`, `Worker ${index}`);
  const people = await f.api.portalPeople(f.actor(), "", f.db); assert.equal(people.people.length, 30); assert.equal(people.hasMore, true);
  assert.equal((await f.api.portalPeople(f.actor(), "Worker 34", f.db)).people[0].id, "extra34");
});
test("input bounds reject invalid IDs, dates, status and oversized bodies before mutation", async t => {
  const f = fixture(t);
  for (const input of [{ id: "not-a-uuid" }, { title: "" }, { title: "a".repeat(181) }, { detail: "a".repeat(3001) }, { dueOn: "2026-02-30" }, { assigneeId: "bad id" }]) {
    await assert.rejects(() => f.create("creditex", "a", "b", input), contracts.PortalTeamError);
  }
  for (const input of [{ body: " " }, { body: "a".repeat(4001) }, { recipientId: "a" }, { id: "invalid" }]) await assert.rejects(() => f.message("creditex", "a", "b", input), contracts.PortalTeamError);
  await assert.rejects(() => f.api.portalTasks(f.actor(), { page: "-1" }, f.db), contracts.PortalTeamError);
  await assert.rejects(() => f.api.portalTasks(f.actor(), { status: "deleted" }, f.db), contracts.PortalTeamError);
  await assert.rejects(() => f.api.portalMessages(f.actor(), "b", "invalid", f.db), contracts.PortalTeamError);
  assert.equal(f.sqlite.prepare("SELECT count(*) count FROM portal_team_tasks").get().count, 0);
});
test("request identity resolves only through its selected portal without client organisation scope", async t => {
  const f = fixture(t); const request = new Request("https://example.com/api/portal-team-workspace?workspace=creditex&organisationId=another");
  const compliance = await f.api.requirePortalTeamAccess(request, "creditex");
  assert.equal(compliance.scopeId, "creditex"); assert.equal(compliance.memberId, "a");
  assert.deepEqual(f.authCalls, [["creditex", { claimPendingInvitation: false, requiredAnyPermission: ["messages", "tasks"] }]]);
  const admin = await f.api.requirePortalTeamAccess(request, "admin"); assert.equal(admin.scopeId, "platform");
  assert.equal(f.authCalls.at(-1), "admin");
});

test("current Creditex message and task permissions isolate tools and prevent mid-request writes", async t => {
  const f = fixture(t); const task = await f.create(); await f.message();
  f.sqlite.exec("UPDATE compliance_users SET permissions_json='[\"tasks\"]' WHERE id='a'");
  await assert.rejects(f.api.portalMessages(f.actor(), "b", "", f.db), /access changed/);
  await assert.rejects(f.message(), /access changed/);
  assert.equal((await f.api.portalPeople(f.actor(), "", f.db)).memberId, "a");
  await assert.rejects(f.api.portalPeople(f.actor(), "", f.db, "", "messages"), /access changed/);
  assert.equal((await f.api.portalPeople(f.actor(), "", f.db, "", "tasks")).memberId, "a");
  assert.equal((await f.api.portalTasks(f.actor(), { view: "assigned" }, f.db)).total, 1);
  f.sqlite.exec("UPDATE compliance_users SET permissions_json='[\"messages\",\"messages_send\"]' WHERE id='a'");
  assert.equal((await f.api.portalMessages(f.actor(), "b", "", f.db)).messages.length, 1);
  await assert.rejects(f.api.portalTasks(f.actor(), {}, f.db), /access changed/);
  await assert.rejects(f.api.savePortalTask(f.actor(), { action: "task_status", id: task.id, revision: 1, status: "done" }, f.db), /access changed/);
  f.beforeWrite(() => f.sqlite.exec("UPDATE compliance_users SET permissions_json='[]' WHERE id='a'"));
  await assert.rejects(f.message(), /access changed/);
  assert.equal(f.sqlite.prepare("SELECT count(*) total FROM portal_team_messages").get().total, 1);
});

test("Creditex read access does not grant message sending or task mutations", async t => {
  const f = fixture(t), task = await f.create(); await f.message();
  f.sqlite.prepare("UPDATE compliance_users SET permissions_json=? WHERE id='a'").run(JSON.stringify(["messages", "tasks"]));
  const conversation = await f.api.portalMessages(f.actor(), "b", "", f.db);
  assert.equal(conversation.canSend, false); assert.equal(conversation.messages.length, 1);
  const tasks = await f.api.portalTasks(f.actor(), { view: "assigned" }, f.db);
  assert.equal(tasks.total, 1); assert.equal(tasks.canCreate, false); assert.equal(tasks.canAssign, false); assert.equal(tasks.canComplete, false);
  assert.equal(tasks.tasks[0].canEdit, false); assert.equal(tasks.tasks[0].canComplete, false);
  await assert.rejects(f.message(), /not sending/);
  await assert.rejects(f.create("creditex", "a", "a"), /creating tasks/);
  await assert.rejects(f.api.savePortalTask(f.actor(), { action: "edit_task", id: task.id, revision: 1, title: "Changed", assigneeId: "b" }, f.db), /editing this task/);
  await assert.rejects(f.api.savePortalTask(f.actor(), { action: "task_status", id: task.id, revision: 1, status: "done" }, f.db), /completing or reopening/);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM portal_team_events").get().n, 1);
});

test("Creditex task creation, reassignment, editing and completion are independent capabilities", async t => {
  const f = fixture(t);
  const grants = keys => f.sqlite.prepare("UPDATE compliance_users SET permissions_json=? WHERE id='a'").run(JSON.stringify(["tasks", ...keys]));
  grants(["tasks_create"]);
  const own = await f.create("creditex", "a", "a");
  await assert.rejects(f.create("creditex", "a", "b"), /for yourself/);
  grants(["tasks_assign"]);
  assert.equal((await f.api.portalTasks(f.actor(), { view: "assigned" }, f.db)).canCreate, false);
  await assert.rejects(f.create(), /creating tasks/);
  grants(["tasks_create", "tasks_assign"]);
  const assigned = await f.create();
  const list = await f.api.portalTasks(f.actor(), { view: "assigned" }, f.db);
  assert.equal(list.canCreate, true); assert.equal(list.canAssign, true); assert.equal(list.canComplete, false);
  grants(["tasks_edit"]);
  await f.api.savePortalTask(f.actor(), { action: "edit_task", id: assigned.id, revision: 1, title: "Details changed", assigneeId: "b" }, f.db);
  await assert.rejects(f.api.savePortalTask(f.actor(), { action: "edit_task", id: assigned.id, revision: 2, title: "Move it", assigneeId: "outside" }, f.db), /reassigning tasks/);
  grants(["tasks_complete"]);
  await f.api.savePortalTask(f.actor(), { action: "task_status", id: own.id, revision: 1, status: "done" }, f.db);
  assert.equal(f.sqlite.prepare("SELECT status FROM portal_team_tasks WHERE id=?").get(own.id).status, "done");
  assert.equal(f.sqlite.prepare("SELECT assignee_id FROM portal_team_tasks WHERE id=?").get(assigned.id).assignee_id, "b");
});

test("Creditex all-team task access follows explicit grants rather than the admin role", async t => {
  const f = fixture(t), task = await f.create();
  f.sqlite.prepare("UPDATE compliance_users SET permissions_json=? WHERE id='admin'").run(JSON.stringify(["tasks"]));
  await assert.rejects(f.api.portalTasks(f.actor("creditex", "admin"), { view: "team" }, f.db), /does not include viewing all team tasks/);
  assert.equal((await f.api.portalTasks(f.actor("creditex", "admin"), { taskId: task.id }, f.db)).total, 0);
  f.sqlite.prepare("UPDATE compliance_users SET permissions_json=? WHERE id='outside'").run(JSON.stringify(["tasks", "tasks_team", "tasks_edit"]));
  const list = await f.api.portalTasks(f.actor("creditex", "outside"), { view: "team" }, f.db);
  assert.equal(list.total, 1); assert.equal(list.tasks[0].canEdit, true); assert.equal(list.tasks[0].canComplete, false);
  await f.api.savePortalTask(f.actor("creditex", "outside"), { action: "edit_task", id: task.id, revision: 1, title: "Team review", assigneeId: "b" }, f.db);
});

test("revoking only a Creditex action permission at write time blocks that action and its audit", async t => {
  const f = fixture(t), task = await f.create();
  const grants = keys => f.sqlite.prepare("UPDATE compliance_users SET permissions_json=? WHERE id='a'").run(JSON.stringify(keys));
  grants(["tasks", "tasks_complete"]);
  f.beforeWrite(() => grants(["tasks"]));
  await assert.rejects(f.api.savePortalTask(f.actor(), { action: "task_status", id: task.id, revision: 1, status: "done" }, f.db), /access changed/);
  grants(["tasks", "tasks_edit", "tasks_assign"]);
  f.beforeWrite(() => grants(["tasks", "tasks_edit"]));
  await assert.rejects(f.api.savePortalTask(f.actor(), { action: "edit_task", id: task.id, revision: 1, title: "Reassigned", assigneeId: "outside" }, f.db), /access changed/);
  grants(["tasks", "tasks_create"]);
  f.beforeWrite(() => grants(["tasks"]));
  await assert.rejects(f.create("creditex", "a", "a"), /no longer available/);
  grants(["messages", "messages_send"]);
  f.beforeWrite(() => grants(["messages"]));
  await assert.rejects(f.message(), /access changed/);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM portal_team_events").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM portal_team_messages").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT revision FROM portal_team_tasks WHERE id=?").get(task.id).revision, 1);
});

test("notification targets resolve a specific authorised teammate and task beyond normal paging", async t => {
  const f = fixture(t), task = await f.create();
  for (let index = 0; index < 35; index++) f.sqlite.prepare("INSERT INTO compliance_users VALUES(?,'creditex',?,?, 'reviewer','active',NULL)").run(`extra${index}`, `uid${index}`, `Worker ${index}`);
  assert.equal((await f.api.portalPeople(f.actor(), "", f.db, "extra34")).people[0].id, "extra34");
  assert.equal((await f.api.portalPeople(f.actor(), "", f.db, "foreign")).people.length, 0);
  assert.equal((await f.api.portalTasks(f.actor(), { taskId: task.id }, f.db)).tasks[0].id, task.id);
  assert.equal((await f.api.portalTasks(f.actor("creditex", "outside"), { taskId: task.id }, f.db)).tasks.length, 0);
});

test("team directory and conversation photo revisions use the profile in the matching tenant only", async t => {
  const f = fixture(t); await f.message();
  const insert = f.sqlite.prepare("INSERT INTO portal_workspace_profiles(workspace,tenant_id,member_id,display_name,updated_at,avatar_revision) VALUES(?,?,?,?,?,?)");
  insert.run("creditex", "creditex", "a", "Preferred A", "now", "creditex-photo");
  insert.run("admin", "operations", "a", "Admin A", "now", "admin-photo");
  assert.equal((await f.api.portalPeople(f.actor(), "Preferred", f.db)).people[0].avatarRevision, "creditex-photo");
  assert.equal((await f.api.portalPeople(f.actor("admin"), "", f.db, "a")).people[0].name, "Admin A");
  assert.equal((await f.api.portalMessages(f.actor(), "b", "", f.db)).messages[0].senderAvatarRevision, "creditex-photo");
  assert.equal((await f.api.portalMessages(f.actor(), "b", "", f.db)).messages[0].senderName, "a", "immutable message attribution stays intact");
});
test("route rejects cross-origin and oversized requests, then dispatches only scoped actions", async t => {
  const f = fixture(t); let calls = 0;
  class ComplianceAccessError extends Error { constructor(message) { super(message); this.status = 403; } }
  const route = load("src/app/api/portal-team-workspace/route.ts", name => {
    if (name === "@/lib/portal-team-workspace") return contracts;
    if (name === "@/lib/bounded-json-request") return boundedJson;
    if (name === "../../../../db") return { getD1: () => f.db };
    if (name === "@/lib/creditex-notification-server") return { markCreditexConversationRead: async () => {} };
    if (name === "@/lib/creditex-notifications") return notifications;
    if (name === "@/lib/compliance-access-server") return { ComplianceAccessError };
    if (name === "@/lib/admin-server") return { adminJson: (body, status = 200) => Response.json(body, { status }), mfaErrorResponse: () => null,
      sameOrigin: request => !request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin,
      adminError: () => Response.json({ ok: false }, { status: 403 }) };
    if (name === "@/lib/portal-team-workspace-server") return { ...f.api, requirePortalTeamAccess: async (...args) => { calls++; return f.api.requirePortalTeamAccess(...args); } };
    throw Error(name);
  });
  const request = (body, origin = "https://example.com") => new Request("https://example.com/api/portal-team-workspace?workspace=creditex", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await route.POST(request({}, "https://foreign.com"))).status, 403); assert.equal(calls, 0);
  assert.equal((await route.POST(request({ body: "x".repeat(17000) }))).status, 413);
  const response = await route.POST(request({ action: "send_message", id: uuid(), recipientId: "b", body: "Hello", scopeId: "another", organisationId: "another", senderId: "foreign" }));
  assert.equal(response.status, 200);
  const saved = f.sqlite.prepare("SELECT scope_id,sender_id FROM portal_team_messages").get(); assert.equal(saved.scope_id, "creditex"); assert.equal(saved.sender_id, "a");
  assert.equal((await route.POST(request({ action: "unknown", id: uuid() }))).status, 400);
});
