import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { canAssignWithinScope, canRescheduleWithinScope } from "../src/lib/trade-team-permission-policy.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

class TestD1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new TestD1Statement(this.database, this.sql, values);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  runSync() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  async run() {
    return this.runSync();
  }
}

function testD1(database) {
  let beforeBatch = null;
  return {
    prepare(sql) {
      return new TestD1Statement(database, sql);
    },
    setBeforeBatch(callback) {
      beforeBatch = callback;
    },
    async batch(statements) {
      const callback = beforeBatch;
      beforeBatch = null;
      if (callback) callback();
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.runSync());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function loadTypescriptModule(path, mocks = {}) {
  const output = ts.transpileModule(read(path), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: path,
  }).outputText;
  const moduleRecord = { exports: {} };
  const require = (specifier) => Object.hasOwn(mocks, specifier) ? mocks[specifier] : {};
  new Function("require", "module", "exports", output)(require, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}


function fixture(overrides = {}, effects = {}) {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE trade_work_orders(id text primary key, firebase_uid text, partner_type text, source_type text,
      source_reference text, assignee_member_id text, assignee_label text, stage text, service_category text,
      revision integer, record_status text, scheduled_start text, scheduled_end text, updated_at text);
    CREATE TABLE trade_crm_job_details(work_order_id text, firebase_uid text, crm_customer_id text, customer_source text);
    CREATE TABLE trade_crm_appointments(id text primary key, work_order_id text, firebase_uid text, revision integer,
      status text, starts_at text, ends_at text, assignee_member_id text, updated_at text, created_at text);
    CREATE TABLE trade_crm_customers(id text primary key, firebase_uid text, first_name text, last_name text,
      business_name text, phone text, email text, updated_at text, record_status text);
    CREATE TABLE trade_crm_customer_contacts(customer_id text, firebase_uid text, first_name text, last_name text,
      phone text, email text, updated_at text, is_primary integer, record_status text);
    CREATE TABLE trade_work_order_events(id text, work_order_id text, firebase_uid text, event_type text, summary text, created_at text);
    CREATE TABLE trade_crm_write_guards(id text, firebase_uid text, operation_id text, step_number integer,
      verified integer CONSTRAINT trade_crm_write_guard_verified_check CHECK(verified = 1), created_at text);
    INSERT INTO trade_work_orders VALUES('job','owner','installer','internal','','worker','Worker','scheduled','general',4,'active','2026-10-10','2026-10-10','before');
    INSERT INTO trade_crm_job_details VALUES('job','owner','customer','trade_owned');
    INSERT INTO trade_crm_appointments VALUES('appointment','job','owner',2,'scheduled','2026-10-10T09:00','2026-10-10T10:00','worker','before','before');
    INSERT INTO trade_crm_customers VALUES('customer','owner','Jane','Smith','','0400000000','jane@example.test','before','active');
    INSERT INTO trade_crm_customer_contacts VALUES('customer','owner','Jane','Smith','0400000000','jane@example.test','before',1,'active');
  `);
  const db = testD1(database);
  const access = { ownerUid: 'owner', actorUid: 'actor', memberId: 'worker', displayName: 'Worker', isOwner: false,
    jobScope: 'own', scheduleScope: 'own', canRescheduleJobs: true, canManageJobs: true, canManageCustomers: true, ...overrides };
  const guards = loadTypescriptModule('../src/lib/trade-compliance-intent-replan-server.ts');
  const teams = loadTypescriptModule('../src/lib/trade-team-server.ts', { '../../db': { getD1: () => db } });
  const messages = []; const calendars = []; const scheduleChanges = [];
  const route = loadTypescriptModule('../src/app/api/field/appointment-actions/route.ts', {
    '../../../../../db': { getD1: () => db },
    '@/lib/admin-server': { sameOrigin: () => true, cleanAdminText: (value, max) => String(value || '').trim().slice(0,max),
      adminJson: (body,status=200) => Response.json(body,{status}) },
    '@/lib/trade-team-server': { requireInstallerTeamAccess: async () => access,
      assignedJob: teams.assignedJob, canAssignJob: canAssignWithinScope },
    '@/lib/trade-team-permission-policy.mjs': { canRescheduleWithinScope },
    '@/lib/trade-schedule': loadTypescriptModule('../src/lib/trade-schedule.ts'),
    '@/lib/trade-team-sync-server': { nextJobRevision: (value) => Number(value) + 1, jobSyncChangeStatements: () => [] },
    '@/lib/trade-compliance-intent-replan-server': guards,
    '@/lib/trade-calendar-sync-server': { cancelAppointmentInConnectedCalendars: async (...args) => { calendars.push(args); if (effects.calendar) await effects.calendar(...args); return {attempted:1,synced:1,failed:0}; } },
    '@/lib/direct-appointment-invite-server': { sendDirectAppointmentCalendarInvite: async (args) => { messages.push(args); if (effects.email) await effects.email(args); return {status:'accepted'}; } },
    '@/lib/trade-rental-credentials': loadTypescriptModule('../src/lib/trade-rental-credentials.ts'),
    '../../trade-schedule/route': { PATCH: async (request) => { scheduleChanges.push(await request.json()); return Response.json({ok:true,customerEmails:[],calendarSync:{failed:0}}); } },
  });
  const patch = (action, extra={}) => route.PATCH(new Request('https://example.test/api/field/appointment-actions', {
    method:'PATCH', body:JSON.stringify({workOrderId:'job',action,expectedRevision:4,appointmentId:'appointment',expectedAppointmentRevision:2,...extra}) }));
  return { database, db, access, messages, calendars, scheduleChanges, patch };
}

test('no show removes the slot, preserves the job and evidence identity, and updates connected calendar', async () => {
  const f=fixture();const response=await f.patch('no_show');assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.jobPatch.stage,'no_show');assert.equal(body.jobPatch.scheduledStart,'');
  assert.equal(f.database.prepare('select status from trade_crm_appointments').get().status,'no_show');
  assert.equal(f.database.prepare('select revision from trade_work_orders').get().revision,5);
  assert.equal(f.calendars.length,1);assert.equal(f.messages.length,0);
});
test('cancel changes appointment and job status and sends one cancellation update',async()=>{
  const f=fixture();assert.equal((await f.patch('cancel')).status,200);
  assert.equal(f.messages[0].change,'cancelled');assert.equal(f.calendars.length,1);
  assert.equal((await f.patch('cancel')).status,409);assert.equal(f.messages.length,1);
});
test('other worker, protected customer and missing permission are rejected without writes or messages',async()=>{
  for(const kind of ['other','protected','permission']) {
    const f=fixture(kind==='other'?{memberId:'other'}:kind==='permission'?{canRescheduleJobs:false}:{});
    if(kind==='protected') f.database.exec("UPDATE trade_crm_job_details SET customer_source='platform_private'");
    assert.equal((await f.patch('cancel')).status,403,kind);
    assert.equal(f.messages.length,0);assert.equal(f.calendars.length,0);
    assert.equal(f.database.prepare('select stage from trade_work_orders').get().stage,'scheduled');
  }
});
test('appointment update rolls back when job changes during write',async()=>{
  const f=fixture();f.db.setBeforeBatch(()=>f.database.exec('UPDATE trade_work_orders SET revision=5'));
  assert.equal((await f.patch('no_show')).status,409);
  assert.equal(f.database.prepare('select status from trade_crm_appointments').get().status,'scheduled');
  assert.equal(f.calendars.length,0);
});
test('reschedule delegates both appointment and job compare-and-swap revisions',async()=>{
  const f=fixture();assert.equal((await f.patch('reschedule',{startsAt:'2026-10-11T10:00',durationMinutes:60,memberId:'worker'})).status,200);
  assert.equal(f.scheduleChanges[0].expectedJobRevision,4);assert.equal(f.scheduleChanges[0].expectedRevision,2);
});
test('contact editing updates primary contact and job revision, and stale customer edits conflict',async()=>{
  const f=fixture();const customer={expectedUpdatedAt:'before',firstName:'Janet',lastName:'Smith',phone:'0411111111',email:'JANET@example.test'};
  assert.equal((await f.patch('update_customer',{customer})).status,200);
  assert.equal(f.database.prepare('select email from trade_crm_customers').get().email,'janet@example.test');
  assert.equal(f.database.prepare('select first_name from trade_crm_customer_contacts').get().first_name,'Janet');
  assert.equal((await f.patch('update_customer',{customer,expectedRevision:5})).status,409);
});


test('reschedule rechecks rental credentials for the new date before calling scheduling', async () => {
 const f=fixture();f.database.exec(`
 UPDATE trade_work_orders SET service_category='rental-inspection';
 CREATE TABLE trade_rental_inspections(id text,firebase_uid text,work_order_id text);
 CREATE TABLE trade_rental_inspection_modules(inspection_id text,firebase_uid text,module_key text,status text);
 CREATE TABLE trade_team_members(id text,owner_uid text,status text);
 CREATE TABLE trade_team_member_credentials(owner_uid text,team_member_id text,file_id text,rental_gate text,status text,
   credential_number text,jurisdiction text,credential_type text,expires_at text);
 CREATE TABLE trade_team_member_files(id text,owner_uid text,team_member_id text,status text,expires_at text);
 INSERT INTO trade_rental_inspections VALUES('inspection','owner','job');
 INSERT INTO trade_rental_inspection_modules VALUES('inspection','owner','electrical_safety_check','draft');
 INSERT INTO trade_team_members VALUES('worker','owner','active');
 INSERT INTO trade_team_member_files VALUES('file','owner','worker','active','2026-10-12');
 INSERT INTO trade_team_member_credentials VALUES('owner','worker','file','licensed_electrician','active','123','VIC','licence','2026-10-12');`);
 const response=await f.patch('reschedule',{startsAt:'2026-10-13T09:00',durationMinutes:60,memberId:'worker'});
 assert.equal(response.status,409);assert.equal(f.scheduleChanges.length,0);
 assert.equal((await f.patch('reschedule',{startsAt:'2026-10-11T09:00',durationMinutes:60,memberId:'worker'})).status,200);
 assert.equal(f.scheduleChanges.length,1);
});

test('cancellation starts its email while calendar removal is still pending', async () => {
  let releaseCalendar;
  let markCalendarStarted;
  const calendarPending = new Promise(resolve => { releaseCalendar = resolve; });
  const calendarStarted = new Promise(resolve => { markCalendarStarted = resolve; });
  const f = fixture({}, { calendar: async () => { markCalendarStarted(); await calendarPending; } });
  const pending = f.patch('cancel');
  await calendarStarted;
  try {
    assert.equal(f.database.prepare('select stage from trade_work_orders').get().stage, 'cancelled');
    assert.equal(f.messages.length, 1, 'customer email must not wait for the calendar provider');
  } finally {
    releaseCalendar();
  }
  const result = await (await pending).json();
  assert.equal(result.email.status, 'accepted');
  assert.equal(result.calendarSync.synced, 1);
});

test('an invalid reschedule date is rejected before delegation or external updates', async () => {
  const f=fixture();
  try {
    const response=await f.patch('reschedule',{startsAt:'2026-02-30T11:00',durationMinutes:60,memberId:'worker'});
    assert.equal(response.status,400);
    assert.equal((await response.json()).error,'Choose a valid appointment date.');
    assert.equal(f.scheduleChanges.length,0);
    assert.equal(f.messages.length,0);assert.equal(f.calendars.length,0);
  } finally { f.database.close(); }
});
