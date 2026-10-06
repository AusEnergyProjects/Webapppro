import type { TeamAccess } from './trade-team-server';
import { jobMemberSql } from './trade-job-collaboration.ts';
import { messageActorGuard } from './trade-message-media-access.ts';
import { australiaLocalDateTime } from './trade-schedule.ts';
import { encodeKeysetCursor, decodeKeysetCursor } from './keyset-pagination.ts';
import { guardedOnlineJobMutationBatch, jobSyncChangeStatements, nextJobRevision } from './trade-team-sync-server.ts';
import {
  DEFAULT_SALES_STAGES, SalesError, salesContactDay, salesDay, salesRevision, salesStages, salesText,
  type SalesConfig, type SalesItem, type SalesList, type SalesPermissions, type SalesSettings, type SalesStatus,
} from './trade-sales.ts';

type Row = Record<string, string | number | null>;
const OWNER_ELIGIBLE = `(person.member_uid=person.owner_uid OR (person.job_scope='team' AND person.can_manage_jobs=1
  AND person.can_manage_quotes=1 AND person.can_view_quotes=1 AND person.can_view_customers=1))
  AND person.status='active' AND NOT EXISTS (SELECT 1 FROM trade_crew_members member_crew WHERE member_crew.owner_uid=person.owner_uid AND member_crew.member_id=person.id)`;
const WON = `EXISTS (SELECT 1 FROM trade_crm_quote_acceptances accepted WHERE accepted.work_order_id=w.id
  AND accepted.firebase_uid=w.firebase_uid AND accepted.decision='accepted')`;
const STATUS = `CASE WHEN d.pipeline_stage='lost' THEN 'lost' WHEN ${WON} THEN 'won' ELSE 'open' END`;
const ELIGIBLE = `w.record_status='active' AND w.partner_type='installer' AND w.stage<>'imported' AND d.pipeline_stage<>'imported'
  AND (d.pipeline_stage='lost' OR ${WON} OR (w.stage NOT IN ('in_progress','completed','cancelled')
    AND d.pipeline_stage NOT IN ('approved','in_progress','complete','invoiced','paid')
    AND d.quote_status<>'accepted' AND d.invoice_status='not_started' AND d.invoiced_value_cents=0 AND d.paid_value_cents=0))`;
const PROTECTED = `(w.source_type='opportunity' OR d.customer_source='platform_private')`;
const FROM = `FROM trade_work_orders w JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
  LEFT JOIN trade_crm_customers customer ON customer.id=d.crm_customer_id AND customer.firebase_uid=w.firebase_uid
  LEFT JOIN trade_sales_job_metadata m ON m.work_order_id=w.id AND m.owner_uid=w.firebase_uid
  LEFT JOIN trade_team_members sales_owner ON sales_owner.id=m.owner_member_id AND sales_owner.owner_uid=w.firebase_uid`;
const string = (value: unknown) => typeof value === 'string' ? value : '';
const denied = () => new SalesError('Your current team access does not allow this sales action.', 403, 'SALES_ACCESS_REQUIRED');
const conflict = () => new SalesError('This sales record changed. Refresh it before saving.', 409, 'REVISION_CONFLICT');

function authority(access: TeamAccess, write = false, editValue = false) {
  const actor = messageActorGuard(access);
  return { sql: `${actor.sql} AND EXISTS (SELECT 1 FROM trade_team_members sales_actor
    WHERE sales_actor.id=? AND sales_actor.owner_uid=w.firebase_uid AND sales_actor.status='active'
      AND NOT EXISTS (SELECT 1 FROM trade_crew_members actor_crew WHERE actor_crew.owner_uid=sales_actor.owner_uid AND actor_crew.member_id=sales_actor.id)
      AND (sales_actor.member_uid=sales_actor.owner_uid OR (sales_actor.can_view_customers=1 AND sales_actor.can_view_quotes=1
        ${write ? 'AND sales_actor.can_manage_jobs=1' : ''} ${editValue ? 'AND sales_actor.can_manage_quotes=1' : ''}
        AND (sales_actor.job_scope='team' OR ${jobMemberSql('w', 'sales_actor.id')}))))`, values: [...actor.values, access.memberId] };
}
async function permissions(db: D1Database, access: TeamAccess): Promise<SalesPermissions> {
  if (access.fieldSessionId) throw denied();
  const actor = messageActorGuard(access);
  const row = await db.prepare(`SELECT person.member_uid=person.owner_uid is_owner,person.can_manage_jobs,person.can_view_quotes,person.can_manage_quotes
    FROM trade_team_members person WHERE person.id=? AND person.owner_uid=? AND ${actor.sql}
      AND NOT EXISTS (SELECT 1 FROM trade_crew_members member_crew WHERE member_crew.owner_uid=person.owner_uid AND member_crew.member_id=person.id)
      AND (person.member_uid=person.owner_uid OR (person.can_view_customers=1 AND person.can_view_quotes=1))`)
    .bind(access.memberId, access.ownerUid, ...actor.values).first<Row>();
  if (!row) throw denied();
  const owner = Boolean(row.is_owner);
  return { canManage: owner || Boolean(row.can_manage_jobs), canViewValues: owner || Boolean(row.can_view_quotes),
    canEditValues: owner || (Boolean(row.can_manage_jobs) && Boolean(row.can_manage_quotes)), canConfigure: owner };
}
async function settings(db: D1Database, ownerUid: string): Promise<SalesSettings> {
  const row = await db.prepare('SELECT stages_json,revision FROM trade_sales_settings WHERE owner_uid=?').bind(ownerUid).first<Row>();
  return row ? { revision: Number(row.revision), stages: salesStages(JSON.parse(string(row.stages_json))) }
    : { revision: 0, stages: DEFAULT_SALES_STAGES.map(stage => ({ ...stage })) };
}
export async function loadSalesConfig(db: D1Database, access: TeamAccess): Promise<SalesConfig> {
  const grants = await permissions(db, access);
  const owners = await db.prepare(`SELECT person.id,person.display_name name FROM trade_team_members person
    WHERE person.owner_uid=? AND ${OWNER_ELIGIBLE} ORDER BY person.member_uid=person.owner_uid DESC,person.display_name COLLATE NOCASE,person.id`)
    .bind(access.ownerUid).all<{ id: string; name: string }>();
  return { settings: await settings(db, access.ownerUid), owners: owners.results, permissions: grants };
}
function projection(row: Row, config: SalesSettings, grants: SalesPermissions): SalesItem {
  const status = string(row.sales_status) as SalesStatus;
  const stageId = string(row.sales_stage_id);
  const protectedCustomer = Boolean(row.customer_protected);
  const canEdit = status === 'open' && grants.canManage && !protectedCustomer;
  return { id: string(row.id), workNumber: string(row.work_number), title: protectedCustomer ? 'Protected opportunity' : string(row.title),
    customerName: protectedCustomer ? '' : string(row.customer_name), customerProtected: protectedCustomer, serviceCategory: string(row.service_category),
    stageId, stageName: status === 'won' ? 'Won' : status === 'lost' ? 'Lost' : config.stages.find(stage => stage.id === stageId)?.name || config.stages[0].name,
    status, ownerMemberId: string(row.owner_member_id), ownerName: string(row.owner_name),
    estimatedValueCents: grants.canViewValues && !protectedCustomer ? Number(row.estimated_value_cents) : null,
    expectedCloseOn: string(row.expected_close_on), lastContactOn: string(row.last_contact_on),
    nextAction: protectedCustomer ? '' : string(row.next_action), nextActionOn: string(row.next_action_on),
    revision: Number(row.metadata_revision || 0), jobRevision: Number(row.revision), canEdit, canEditValue: canEdit && grants.canEditValues };
}
function salesBase(access: TeamAccess, config: SalesSettings) {
  const guard = authority(access);
  const fallback = `CASE WHEN d.pipeline_stage IN ('enquiry','qualifying','quoting') THEN d.pipeline_stage ELSE 'enquiry' END`;
  const openStage = `CASE WHEN COALESCE(NULLIF(m.stage_id,''),${fallback}) IN (SELECT json_extract(value,'$.id') FROM json_each(?))
    THEN COALESCE(NULLIF(m.stage_id,''),${fallback}) ELSE ? END`;
  return { sql: `WITH sales AS (
    SELECT w.id,w.work_number,w.title,w.service_category,w.stage job_stage,w.revision,w.updated_at,d.pipeline_stage,d.next_action,d.estimated_value_cents,
      d.quote_status,${PROTECTED} customer_protected,
      COALESCE(NULLIF(customer.business_name,''),trim(COALESCE(customer.first_name,'')||' '||COALESCE(customer.last_name,''))) customer_name,
      COALESCE(m.owner_member_id,'') owner_member_id,COALESCE(sales_owner.display_name,'') owner_name,
      COALESCE(m.expected_close_on,'') expected_close_on,COALESCE(m.last_contact_on,'') last_contact_on,
      COALESCE(m.next_action_on,'') next_action_on,COALESCE(m.revision,0) metadata_revision,${STATUS} sales_status,
      CASE WHEN d.pipeline_stage='lost' THEN 'lost' WHEN ${WON} THEN 'won' ELSE ${openStage} END sales_stage_id
    ${FROM} WHERE w.firebase_uid=? AND ${ELIGIBLE} AND ${guard.sql})`,
    values: [JSON.stringify(config.stages), config.stages[0].id, access.ownerUid, ...guard.values] };
}
export async function listSales(db: D1Database, access: TeamAccess, params: URLSearchParams): Promise<SalesList> {
  const grants = await permissions(db, access), config = await settings(db, access.ownerUid);
  const stage = salesText(params.get('stage') || '', 80), owner = salesText(params.get('owner') || '', 180);
  const status = params.get('status') || 'open', search = salesText(params.get('search') || '', 100).toLowerCase();
  if (!['open','won','lost','all'].includes(status) || (stage && !['won','lost',...config.stages.map(item => item.id)].includes(stage))) throw new SalesError('Choose a current sales stage or status.');
  const pageSize = Number(params.get('pageSize') || 25);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new SalesError('Choose a page size between 1 and 100.');
  const needsNextAction = params.get('needsNextAction') === '1';
  const conditions: string[] = []; const filters: unknown[] = [];
  if (status !== 'all') { conditions.push('sales_status=?'); filters.push(status); }
  if (owner) { conditions.push('owner_member_id=?'); filters.push(owner === 'unassigned' ? '' : owner); }
  if (needsNextAction) conditions.push("sales_status='open' AND (trim(next_action)='' OR next_action_on='')");
  if (search) { conditions.push("instr(lower(work_number||' '||service_category||CASE WHEN customer_protected=1 THEN '' ELSE ' '||title||' '||customer_name END),?)>0"); filters.push(search); }
  const where = conditions.length ? conditions.join(' AND ') : '1=1';
  const scope = JSON.stringify(['sales',access.ownerUid,access.memberId,status,stage,owner,search,needsNextAction,config.revision]);
  let cursor;
  try { cursor = decodeKeysetCursor(params.get('cursor') || '', scope, 2); } catch { throw new SalesError('This sales page changed. Refresh the list.', 409, 'REVISION_CONFLICT'); }
  const base = salesBase(access, config);
  const countRows = await db.prepare(`${base.sql} SELECT sales_stage_id,COUNT(*) count FROM sales WHERE ${where} GROUP BY sales_stage_id`)
    .bind(...base.values,...filters).all<{ sales_stage_id: string; count: number }>();
  const rowWhere = stage ? `${where} AND sales_stage_id=?` : where;
  const rowValues = [...filters,...(stage ? [stage] : [])];
  const after = cursor ? ' AND (updated_at,id)<(?,?)' : '';
  const rows = await db.prepare(`${base.sql} SELECT * FROM sales WHERE ${rowWhere}${after} ORDER BY updated_at DESC,id DESC LIMIT ?`)
    .bind(...base.values,...rowValues,...(cursor || []),pageSize+1).all<Row>();
  const items = rows.results.slice(0,pageSize).map(row => projection(row,config,grants)), hasNext = rows.results.length > pageSize;
  const last = rows.results[pageSize-1];
  const counts = new Map(countRows.results.map(row => [row.sales_stage_id,Number(row.count)]));
  const stages = [...config.stages,{id:'won',name:'Won'},{id:'lost',name:'Lost'}].map(item => ({...item,count:counts.get(item.id)||0}));
  return { items, stages, total: stage ? counts.get(stage)||0 : [...counts.values()].reduce((sum,value)=>sum+value,0), pageSize, hasNext,
    nextCursor: hasNext && last ? encodeKeysetCursor(scope,[string(last.updated_at),string(last.id)]) : '' };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SalesError('Check the sales details.');
  return value as Record<string, unknown>;
}
function onlyFields(value: Record<string, unknown>, fields: string[]) {
  if (Object.keys(value).some(key => !fields.includes(key))) throw new SalesError('The sales request contains unsupported fields.');
}
export async function saveSalesStages(db: D1Database, access: TeamAccess, value: unknown, now=new Date().toISOString()): Promise<SalesSettings> {
  const grants = await permissions(db,access); if (!grants.canConfigure) throw denied();
  const input = object(value); onlyFields(input,['action','expectedRevision','stages']);
  const revision = salesRevision(input.expectedRevision), stages = salesStages(input.stages), current = await settings(db,access.ownerUid);
  if (revision !== current.revision) throw conflict();
  const removed = current.stages.filter(stage => !stages.some(next => next.id===stage.id));
  if (removed.length) throw new SalesError('Keep existing stages. You can add, rename or reorder them.',409,'SALES_STAGE_REMOVAL_UNSUPPORTED');
  const actor = messageActorGuard(access), json=JSON.stringify(stages), next=revision+1;
  const freshOwner = `${actor.sql} AND EXISTS (SELECT 1 FROM trade_team_members person WHERE person.id=? AND person.owner_uid=?
    AND person.member_uid=person.owner_uid AND NOT EXISTS (SELECT 1 FROM trade_crew_members c WHERE c.owner_uid=person.owner_uid AND c.member_id=person.id))`;
  const oldConfig = revision ? 'EXISTS (SELECT 1 FROM trade_sales_settings WHERE owner_uid=? AND revision=?)' : 'NOT EXISTS (SELECT 1 FROM trade_sales_settings WHERE owner_uid=?)';
  const values = [...actor.values,access.memberId,access.ownerUid,access.ownerUid,...(revision?[revision]:[])];
  try {
    await db.batch([
      db.prepare(`INSERT INTO trade_sales_settings(owner_uid,stages_json,revision,updated_at)
        SELECT NULL,?,1,? WHERE NOT (${freshOwner} AND ${oldConfig})`).bind(json,now,...values),
      db.prepare(`INSERT INTO trade_sales_settings(owner_uid,stages_json,revision,updated_at) VALUES (?,?,?,?)
        ON CONFLICT(owner_uid) DO UPDATE SET stages_json=excluded.stages_json,revision=excluded.revision,updated_at=excluded.updated_at WHERE trade_sales_settings.revision=?`)
        .bind(access.ownerUid,json,next,now,revision),
      db.prepare(`INSERT INTO trade_team_member_events(id,owner_uid,team_member_id,actor_uid,entity_type,entity_id,event_type,metadata,created_at)
        SELECT ?,?,?,?,'member',?,'sales_stages_updated',?,? WHERE changes()=1`)
        .bind(crypto.randomUUID(),access.ownerUid,access.memberId,access.actorUid,access.memberId,JSON.stringify({revision:next,stages}),now),
    ]);
  } catch(error) { if (error instanceof Error && error.message.includes('trade_sales_settings.owner_uid')) throw conflict(); throw error; }
  return {revision:next,stages};
}
export async function updateSales(db: D1Database, access: TeamAccess, value: unknown, now=new Date().toISOString()): Promise<SalesItem> {
  const grants=await permissions(db,access); if(!grants.canManage) throw denied();
  const input=object(value); onlyFields(input,['action','workOrderId','expectedRevision','expectedJobRevision','stageId','ownerMemberId','estimatedValueCents','expectedCloseOn','lastContactOn','nextAction','nextActionOn']);
  const id=salesText(input.workOrderId,180,true), revision=salesRevision(input.expectedRevision), jobRevision=salesRevision(input.expectedJobRevision,false);
  const config=await settings(db,access.ownerUid), base=salesBase(access,config);
  const row=await db.prepare(`${base.sql} SELECT * FROM sales WHERE id=?`).bind(...base.values,id).first<Row>();
  if(!row) throw new SalesError('This opportunity is no longer available to you.',404,'SALES_NOT_FOUND');
  const current=projection(row,config,grants); if(!current.canEdit) throw new SalesError('Recorded outcomes and protected opportunities cannot be changed here.',409,'SALES_RECORD_CLOSED');
  if(current.revision!==revision||current.jobRevision!==jobRevision) throw conflict();
  const stageId=input.stageId===undefined?current.stageId:salesText(input.stageId,80,true);
  if(!config.stages.some(stage=>stage.id===stageId)) throw new SalesError('Choose a current open sales stage.');
  const ownerId=input.ownerMemberId===undefined?current.ownerMemberId:salesText(input.ownerMemberId,180);
  if(ownerId && !await db.prepare(`SELECT person.id FROM trade_team_members person WHERE person.owner_uid=? AND person.id=? AND ${OWNER_ELIGIBLE}`)
    .bind(access.ownerUid,ownerId).first()) throw new SalesError('Choose an active office teammate with sales access.');
  const editValue=input.estimatedValueCents!==undefined;
  if(editValue&&!grants.canEditValues) throw denied();
  const estimate=editValue?input.estimatedValueCents:Number(row.estimated_value_cents);
  if(typeof estimate!=='number'||!Number.isSafeInteger(estimate)||estimate<0||estimate>1_000_000_000) throw new SalesError('Enter a valid estimate excluding GST.');
  const expectedClose=input.expectedCloseOn===undefined?current.expectedCloseOn:salesDay(input.expectedCloseOn);
  const business=await db.prepare('SELECT address_state FROM trade_accounts WHERE firebase_uid=?').bind(access.ownerUid).first<{address_state:string}>();
  const contacted=input.lastContactOn===undefined?current.lastContactOn:salesContactDay(input.lastContactOn,australiaLocalDateTime(business?.address_state||'NSW',new Date(now)).slice(0,10));
  const action=input.nextAction===undefined?current.nextAction:salesText(input.nextAction,200);
  const due=input.nextActionOn===undefined?current.nextActionOn:salesDay(input.nextActionOn);
  if(due&&!action) throw new SalesError('Add a next action before setting its due date.');
  const write=authority(access,true,editValue), nextJob=nextJobRevision(jobRevision),nextMetadata=revision+1;
  const configGuard=config.revision?'EXISTS (SELECT 1 FROM trade_sales_settings WHERE owner_uid=? AND revision=?)':'NOT EXISTS (SELECT 1 FROM trade_sales_settings WHERE owner_uid=?)';
  const targetOwnerGuard=ownerId?`EXISTS (SELECT 1 FROM trade_team_members person WHERE person.owner_uid=? AND person.id=? AND ${OWNER_ELIGIBLE})`:'1=1';
  const guard=`EXISTS (SELECT 1 ${FROM} WHERE w.id=? AND w.firebase_uid=? AND ${ELIGIBLE} AND ${STATUS}='open' AND NOT ${PROTECTED}
    AND w.revision=? AND COALESCE(m.revision,0)=? AND ${write.sql}) AND ${configGuard} AND ${targetOwnerGuard}`;
  const guardValues=[id,access.ownerUid,jobRevision,revision,...write.values,access.ownerUid,...(config.revision?[config.revision]:[]),...(ownerId?[access.ownerUid,ownerId]:[])];
  try {
    await guardedOnlineJobMutationBatch(db,[
      db.prepare(`INSERT INTO trade_work_order_events(id,work_order_id,firebase_uid,event_type,summary,created_at)
        SELECT ?,?,?,'online_mutation_guard',NULL,? WHERE NOT (${guard})`).bind(crypto.randomUUID(),id,access.ownerUid,now,...guardValues),
      db.prepare(`INSERT INTO trade_sales_job_metadata(owner_uid,work_order_id,stage_id,owner_member_id,expected_close_on,last_contact_on,next_action_on,revision,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_uid,work_order_id) DO UPDATE SET stage_id=excluded.stage_id,owner_member_id=excluded.owner_member_id,
          expected_close_on=excluded.expected_close_on,last_contact_on=excluded.last_contact_on,next_action_on=excluded.next_action_on,revision=excluded.revision,updated_at=excluded.updated_at
        WHERE trade_sales_job_metadata.revision=?`).bind(access.ownerUid,id,stageId,ownerId||null,expectedClose,contacted,due,nextMetadata,now,revision),
      db.prepare('UPDATE trade_crm_job_details SET next_action=?,estimated_value_cents=?,updated_at=? WHERE work_order_id=? AND firebase_uid=?')
        .bind(action,estimate,now,id,access.ownerUid),
      db.prepare('UPDATE trade_work_orders SET revision=?,updated_at=? WHERE id=? AND firebase_uid=? AND revision=?').bind(nextJob,now,id,access.ownerUid,jobRevision),
      db.prepare(`INSERT INTO trade_work_order_events(id,work_order_id,firebase_uid,event_type,summary,created_at) VALUES (?,?,?,'sales_updated',?,?)`)
        .bind(crypto.randomUUID(),id,access.ownerUid,`Sales details updated by ${access.actorUid || access.memberId}.`,now),
      ...jobSyncChangeStatements(db,{ownerUid:access.ownerUid,workOrderId:id,revision:nextJob,changedAt:now}),
    ],{kind:'stage',ownerUid:access.ownerUid,workOrderId:id,jobStage:string(row.job_stage),jobRevision:nextJob,updatedAt:now});
  } catch(error) { if(error instanceof Error && error.message==='ONLINE_MUTATION_CONFLICT') throw conflict(); throw error; }
  const updated=await db.prepare(`${base.sql} SELECT * FROM sales WHERE id=?`).bind(...base.values,id).first<Row>();
  if(!updated) throw conflict();
  return projection(updated,config,grants);
}
