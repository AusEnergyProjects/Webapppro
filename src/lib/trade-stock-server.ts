import { getD1 } from "../../db";
import { ensureTradeStockSchemaGuards } from "./trade-stock-schema-guards";
import type { TeamAccess } from "./trade-team-server";
import { normaliseStockMutation, normaliseStockLocationMutation, normaliseStockUsageLocations, type StockLocation, type StockLocationBalance, type JobStockSummary, type StockHistoryEntry, type StockItem, type StockMutation } from "./trade-stock";

type Row = Record<string, unknown>;
const ITEM_PROJECTION = `p.id item_id,p.item_code,p.name,p.item_type,p.unit_label,p.record_status,
  COALESCE(s.tracked,0) tracked,COALESCE(s.on_hand_milli,0) on_hand_milli,
  COALESCE(s.low_stock_milli,0) low_stock_milli,COALESCE(s.revision,0) revision,
  COALESCE((SELECT SUM(r.quantity_milli) FROM trade_stock_active_reservations r WHERE r.item_id=p.id AND r.firebase_uid=p.firebase_uid),0) reserved_milli`;

export function requireStockAccess(access: TeamAccess, manage = false) {
  if (!access.isOwner && (!access.canViewPriceBook || (manage && !access.canManagePriceBook))) throw new Error("STOCK_ACCESS_REQUIRED");
}
function item(row: Row, locations: StockLocationBalance[] = []): StockItem {
  const onHandMilli = Number(row.on_hand_milli); const reservedMilli = Number(row.reserved_milli);
  return { itemId: String(row.item_id), itemCode: String(row.item_code), name: String(row.name), itemType: String(row.item_type),
    unitLabel: String(row.unit_label), recordStatus: String(row.record_status), tracked: Boolean(row.tracked), onHandMilli, reservedMilli,
    availableMilli: onHandMilli - reservedMilli, lowStockMilli: Number(row.low_stock_milli), revision: Number(row.revision), locations };
}
export async function listStock(ownerUid: string): Promise<StockItem[]> {
  const rows = await getD1().prepare(`SELECT ${ITEM_PROJECTION} FROM trade_price_book_items p
    LEFT JOIN trade_stock_items s ON s.item_id=p.id AND s.firebase_uid=p.firebase_uid
    WHERE p.firebase_uid=? AND p.item_type IN ('material','equipment') AND (p.record_status='active' OR s.tracked=1 OR s.on_hand_milli>0)
    ORDER BY p.name COLLATE NOCASE,p.id LIMIT 5000`).bind(ownerUid).all<Row>();
  const locations = await stockLocations(ownerUid); const balances = await getD1().prepare("SELECT item_id,location_id,on_hand_milli FROM trade_stock_location_balances WHERE firebase_uid=?").bind(ownerUid).all<Row>();
  const balanceByProductLocation = new Map(balances.results.map(balance => [`${balance.item_id}:${balance.location_id}`, Number(balance.on_hand_milli)]));
  return rows.results.map(row => item(row, locations.map(location => ({ locationId: location.id, name: location.name, responsibleName: location.responsibleName, onHandMilli: balanceByProductLocation.get(`${row.item_id}:${location.id}`) ?? 0 }))));
}
export async function stockItem(ownerUid: string, itemId: string): Promise<StockItem> {
  const row = await getD1().prepare(`SELECT ${ITEM_PROJECTION} FROM trade_price_book_items p
    LEFT JOIN trade_stock_items s ON s.item_id=p.id AND s.firebase_uid=p.firebase_uid
    WHERE p.id=? AND p.firebase_uid=? AND p.item_type IN ('material','equipment')`).bind(itemId, ownerUid).first<Row>();
  if (!row) throw new Error("STOCK_ITEM_NOT_FOUND");
  const locations = await stockLocations(ownerUid); const balances = await getD1().prepare("SELECT location_id,on_hand_milli FROM trade_stock_location_balances WHERE firebase_uid=? AND item_id=?").bind(ownerUid, itemId).all<Row>();
  return item(row, locations.map(location => ({ locationId: location.id, name: location.name, responsibleName: location.responsibleName, onHandMilli: Number(balances.results.find(balance => balance.location_id === location.id)?.on_hand_milli || 0) })));
}
export async function stockDetail(ownerUid: string, itemId: string) {
  const product = await stockItem(ownerUid, itemId);
  const rows = await getD1().prepare(`SELECT id,action,quantity_milli,change_milli,on_hand_milli,note,work_order_id,created_at
    FROM trade_stock_movements WHERE item_id=? AND firebase_uid=? ORDER BY created_at DESC,rowid DESC LIMIT 50`).bind(itemId, ownerUid).all<Row>();
  const history: StockHistoryEntry[] = rows.results.map((row) => ({ id: String(row.id), action: String(row.action), quantityMilli: Number(row.quantity_milli),
    changeMilli: Number(row.change_milli), onHandMilli: Number(row.on_hand_milli), note: String(row.note), workOrderId: String(row.work_order_id), createdAt: String(row.created_at) }));
  const transfers = await getD1().prepare(`SELECT t.*,COALESCE(fm.display_name,f.name) from_name,COALESCE(lm.display_name,l.name) to_name FROM trade_stock_transfers t JOIN trade_stock_locations f ON f.id=t.from_location_id JOIN trade_stock_locations l ON l.id=t.to_location_id LEFT JOIN trade_team_members fm ON fm.id=f.responsible_member_id AND fm.owner_uid=t.firebase_uid LEFT JOIN trade_team_members lm ON lm.id=l.responsible_member_id AND lm.owner_uid=t.firebase_uid WHERE t.firebase_uid=? AND t.item_id=? ORDER BY t.created_at DESC LIMIT 50`).bind(ownerUid,itemId).all<Row>();
  for (const row of transfers.results) history.push({ id:String(row.id),action:"transfer",quantityMilli:Number(row.quantity_milli),changeMilli:0,onHandMilli:Number(row.on_hand_milli),note:`${row.from_name} to ${row.to_name}${row.note ? `: ${row.note}` : ""}`,workOrderId:"",createdAt:String(row.created_at) });
  history.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  return { item: product, history:history.slice(0,50), locations:await stockLocations(ownerUid), members:await stockMembers(ownerUid) };
}

export async function requireOwnedStockJob(ownerUid: string, workOrderId: string) {
  const row = await getD1().prepare(`SELECT w.id,w.stage FROM trade_work_orders w
    JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
    WHERE w.id=? AND w.firebase_uid=? AND w.partner_type='installer' AND w.record_status='active' AND d.customer_source='trade_owned'`)
    .bind(workOrderId, ownerUid).first<Row>();
  if (!row) throw new Error("JOB_NOT_FOUND");
  return row;
}

export async function jobStock(ownerUid: string, workOrderId: string): Promise<JobStockSummary> {
  const job = await requireOwnedStockJob(ownerUid, workOrderId);
  const rows = await getD1().prepare(`SELECT r.id requirement_id,r.description,r.quantity_milli,r.status,r.source_id,
    COALESCE(a.quantity_milli,0) used_milli,COALESCE(v.quantity_milli,0) allocated_milli,${ITEM_PROJECTION}
    FROM trade_crm_job_plan_requirements r
    JOIN trade_crm_job_plans j ON j.id=r.job_plan_id AND j.firebase_uid=r.firebase_uid
    JOIN trade_price_book_items p ON p.id=r.source_id AND p.firebase_uid=r.firebase_uid AND p.item_type IN ('material','equipment')
    LEFT JOIN trade_stock_items s ON s.item_id=p.id AND s.firebase_uid=p.firebase_uid
    LEFT JOIN trade_crm_job_actuals a ON a.job_plan_requirement_id=r.id AND a.firebase_uid=r.firebase_uid
    LEFT JOIN trade_stock_active_reservations v ON v.requirement_id=r.id AND v.firebase_uid=r.firebase_uid
    WHERE r.firebase_uid=? AND j.work_order_id=? AND r.requirement_type='material' AND r.status<>'not_needed' AND s.tracked=1
    AND j.commercial_handoff_id=(SELECT h.id FROM trade_crm_commercial_handovers h WHERE h.firebase_uid=j.firebase_uid AND h.work_order_id=j.work_order_id ORDER BY h.accepted_at DESC,h.id DESC LIMIT 1)
    ORDER BY r.position,r.id`).bind(ownerUid, workOrderId).all<Row>();
  const locations = await stockLocations(ownerUid);
  const balances = await getD1().prepare("SELECT item_id,location_id,on_hand_milli FROM trade_stock_location_balances WHERE firebase_uid=?").bind(ownerUid).all<Row>();
  const issues = await getD1().prepare("SELECT requirement_id,baseline_milli FROM trade_stock_actual_issues WHERE firebase_uid=? AND work_order_id=?").bind(ownerUid,workOrderId).all<Row>();
  const usage = await getD1().prepare("SELECT u.requirement_id,u.location_id,u.quantity_milli FROM trade_stock_usage_locations u JOIN trade_stock_actual_issues i ON i.requirement_id=u.requirement_id AND i.firebase_uid=u.firebase_uid WHERE u.firebase_uid=? AND i.work_order_id=?").bind(ownerUid,workOrderId).all<Row>();
  const freeByItem = new Map<string, number>();
  const reservedDeficitByItem = new Map<string, number>();
  return { workOrderId, canManage: !["cancelled", "completed"].includes(String(job.stage)), requirements: rows.results.map((row) => {
    const product = item(row); const requiredMilli = Number(row.quantity_milli); const usedMilli = Number(row.used_milli); const reservedMilli = Number(row.allocated_milli);
    const free = freeByItem.get(product.itemId) ?? Math.max(0, product.availableMilli);
    const reservedDeficit = reservedDeficitByItem.get(product.itemId) ?? Math.max(0, -product.availableMilli);
    const outstanding = row.status === "completed" || ["cancelled", "completed"].includes(String(job.stage)) ? 0 : Math.max(0, requiredMilli - usedMilli);
    const remaining = Math.max(0, outstanding - reservedMilli);
    const allocatedShortage = Math.min(outstanding, reservedMilli, reservedDeficit);
    const shortageMilli = Math.max(0, remaining - free) + allocatedShortage;
    freeByItem.set(product.itemId, Math.max(0, free - remaining));
    reservedDeficitByItem.set(product.itemId, reservedDeficit - allocatedShortage);
    return { requirementId: String(row.requirement_id), itemId: product.itemId, description: String(row.description), unitLabel: product.unitLabel,
      requiredMilli, usedMilli, remainingMilli: outstanding, reservedMilli, availableMilli: product.availableMilli, shortageMilli, revision: product.revision, tracked: product.tracked,
      stockBaselineMilli: Number(issues.results.find(issue=>issue.requirement_id===row.requirement_id)?.baseline_milli ?? usedMilli),
      stockLocations: locations.map(location=>({ locationId:location.id,name:location.name,responsibleName:location.responsibleName,isDefault:location.isDefault,onHandMilli:Number(balances.results.find(balance=>balance.item_id===product.itemId&&balance.location_id===location.id)?.on_hand_milli||0),usedMilli:Number(usage.results.find(use=>use.requirement_id===row.requirement_id&&use.location_id===location.id)?.quantity_milli||0) })) };
  }) };
}

function mainLocationId(ownerUid: string) { return `stock-main-${ownerUid}`; }
function ensureMainStatement(db: D1Database, ownerUid: string, now: string) {
  return db.prepare(`INSERT INTO trade_stock_locations(id,firebase_uid,name,is_default,revision,created_at,updated_at)
    VALUES(?,?,'Main storage',1,1,?,?) ON CONFLICT(id) DO NOTHING`).bind(mainLocationId(ownerUid),ownerUid,now,now);
}
export async function stockLocations(ownerUid: string): Promise<StockLocation[]> {
  const rows = await getD1().prepare(`SELECT l.*,m.display_name responsible_name FROM trade_stock_locations l
    LEFT JOIN trade_team_members m ON m.id=l.responsible_member_id AND m.owner_uid=l.firebase_uid
    WHERE l.firebase_uid=? ORDER BY l.is_default DESC,l.name COLLATE NOCASE,l.id`).bind(ownerUid).all<Row>();
  return rows.results.length ? rows.results.map(row=>({id:String(row.id),name:String(row.responsible_name||row.name),isDefault:Boolean(row.is_default),revision:Number(row.revision),responsibleMemberId:String(row.responsible_member_id||""),responsibleName:String(row.responsible_name||"")})) :
    [{id:mainLocationId(ownerUid),name:"Main storage",isDefault:true,revision:1,responsibleMemberId:"",responsibleName:""}];
}
export async function stockMembers(ownerUid: string) {
  const rows = await getD1().prepare("SELECT id,display_name FROM trade_team_members WHERE owner_uid=? AND status='active' ORDER BY display_name COLLATE NOCASE,id").bind(ownerUid).all<Row>();
  return rows.results.map(row=>({id:String(row.id),name:String(row.display_name)}));
}
export async function mutateStockLocation(ownerUid: string, actorUid: string, raw: unknown) {
  const input=normaliseStockLocationMutation(raw),db=getD1(); await ensureTradeStockSchemaGuards(db);
  const payload=JSON.stringify(input);
  const previous=await db.prepare("SELECT payload_json,location_id FROM trade_stock_location_operations WHERE firebase_uid=? AND operation_id=?").bind(ownerUid,input.operationId).first<Row>();
  if(previous){ if(previous.payload_json!==payload) throw new Error("STOCK_OPERATION_REUSED"); return (await stockLocations(ownerUid)).find(location=>location.id===previous.location_id)!; }
  if(input.responsibleMemberId && !(await stockMembers(ownerUid)).some(member=>member.id===input.responsibleMemberId)) throw new Error("STOCK_INVALID_MEMBER");
  const locations=await stockLocations(ownerUid),current=locations.find(location=>location.id===input.locationId);
  if(input.action==='rename_location'&&!current) throw new Error("STOCK_LOCATION_NOT_FOUND");
  const id=crypto.randomUUID(),locationId=input.action==='create_location'?crypto.randomUUID():input.locationId!,now=new Date().toISOString();
  const gate="EXISTS(SELECT 1 FROM trade_stock_location_operations WHERE id=?)";
  const statements=[ensureMainStatement(db,ownerUid,now),db.prepare(`INSERT INTO trade_stock_location_operations(id,firebase_uid,operation_id,location_id,action,payload_json,expected_revision,actor_uid,created_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(firebase_uid,operation_id) DO NOTHING`).bind(id,ownerUid,input.operationId,locationId,input.action,payload,input.expectedRevision||0,actorUid,now)];
  if(input.action==='create_location') statements.push(db.prepare(`INSERT INTO trade_stock_locations(id,firebase_uid,name,responsible_member_id,is_default,revision,created_at,updated_at)
    SELECT ?,?,?,?,0,1,?,? WHERE ${gate}`).bind(locationId,ownerUid,input.name,input.responsibleMemberId||"",now,now,id));
  else statements.push(db.prepare(`UPDATE trade_stock_locations SET name=?,responsible_member_id=?,revision=revision+1,updated_at=? WHERE id=? AND firebase_uid=? AND ${gate}`).bind(input.name,input.responsibleMemberId??current!.responsibleMemberId,now,locationId,ownerUid,id));
  await db.batch(statements);
  const saved=await db.prepare("SELECT payload_json,location_id FROM trade_stock_location_operations WHERE firebase_uid=? AND operation_id=?").bind(ownerUid,input.operationId).first<Row>();
  if(saved?.payload_json!==payload) throw new Error("STOCK_OPERATION_REUSED");
  return (await stockLocations(ownerUid)).find(location=>location.id===saved.location_id)!;
}
export async function mutateStock(ownerUid: string, actorUid: string, raw: unknown) {
  const input: StockMutation = normaliseStockMutation(raw); const db=getD1(); await ensureTradeStockSchemaGuards(db);
  const product=await stockItem(ownerUid,input.itemId),payloadJson=JSON.stringify(input);
  if(input.action==='transfer') return transferStock(ownerUid,actorUid,input,product,payloadJson);
  const previous=await db.prepare("SELECT payload_json FROM trade_stock_operations WHERE firebase_uid=? AND operation_id=?").bind(ownerUid,input.operationId).first<Row>();
  if(previous){ if(previous.payload_json!==payloadJson) throw new Error("STOCK_OPERATION_REUSED"); return input; }
  const jobAction=input.action==='reserve'||input.action==='release';
  if(jobAction){
    await requireOwnedStockJob(ownerUid,input.workOrderId!);
    const requirement=await db.prepare(`SELECT r.id FROM trade_crm_job_plan_requirements r JOIN trade_crm_job_plans p ON p.id=r.job_plan_id AND p.firebase_uid=r.firebase_uid
      WHERE r.id=? AND r.firebase_uid=? AND r.source_id=? AND p.work_order_id=?`).bind(input.requirementId!,ownerUid,input.itemId,input.workOrderId!).first<Row>();
    if(!requirement) throw new Error("STOCK_REQUIREMENT_UNAVAILABLE");
  }
  const locations=await stockLocations(ownerUid);
  const physical=input.action==='receive'||input.action==='count';
  if(physical&&!input.locationId&&locations.length!==1) throw new Error("STOCK_LOCATION_REQUIRED");
  const locationId=input.locationId||mainLocationId(ownerUid);
  if((physical||input.action==='enable')&&!locations.some(location=>location.id===locationId)) throw new Error("STOCK_LOCATION_NOT_FOUND");
  const id=crypto.randomUUID(),now=new Date().toISOString(),quantity=input.quantityMilli??0;
  const gate="EXISTS(SELECT 1 FROM trade_stock_operations WHERE id=?)";
  const statements=[db.prepare(`INSERT INTO trade_stock_operations(id,firebase_uid,operation_id,item_id,action,payload_json,expected_revision,actor_uid,created_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(firebase_uid,operation_id) DO NOTHING`).bind(id,ownerUid,input.operationId,input.itemId,input.action,payloadJson,input.expectedRevision,actorUid,now),ensureMainStatement(db,ownerUid,now)];
  let delta=0;
  if(input.action==='enable'){
    delta=product.revision===0?quantity:0;
    statements.push(db.prepare(`INSERT INTO trade_stock_items(item_id,firebase_uid,tracked,on_hand_milli,low_stock_milli,revision,updated_at)
      SELECT ?,?,1,COALESCE((SELECT SUM(on_hand_milli) FROM trade_stock_location_balances WHERE item_id=? AND firebase_uid=?),0),?,1,? WHERE ${gate}
      ON CONFLICT(item_id) DO UPDATE SET tracked=1,low_stock_milli=excluded.low_stock_milli,revision=trade_stock_items.revision+1,updated_at=excluded.updated_at`).bind(input.itemId,ownerUid,input.itemId,ownerUid,input.lowStockMilli!,now,id));
    statements.push(db.prepare(`INSERT INTO trade_stock_location_balances(item_id,location_id,firebase_uid,on_hand_milli,updated_at)
      SELECT ?,?,?,?,? WHERE ${gate} AND NOT EXISTS(SELECT 1 FROM trade_stock_location_balances WHERE item_id=? AND firebase_uid=?)
      ON CONFLICT(item_id,location_id) DO NOTHING`).bind(input.itemId,locationId,ownerUid,quantity,now,id,input.itemId,ownerUid));
    statements.push(db.prepare(`UPDATE trade_stock_items SET on_hand_milli=(SELECT SUM(on_hand_milli) FROM trade_stock_location_balances WHERE item_id=trade_stock_items.item_id AND firebase_uid=trade_stock_items.firebase_uid) WHERE item_id=? AND firebase_uid=? AND ${gate}`).bind(input.itemId,ownerUid,id));
  } else {
    if(jobAction){
      statements.push(db.prepare(`DELETE FROM trade_stock_reservations WHERE requirement_id=? AND item_id=? AND firebase_uid=? AND ${gate}`).bind(input.requirementId!,input.itemId,ownerUid,id));
      if(input.action==='reserve'&&quantity>0) statements.push(db.prepare(`INSERT INTO trade_stock_reservations(requirement_id,item_id,firebase_uid,work_order_id,quantity_milli,updated_at)
        SELECT ?,?,?,?,?,? WHERE ${gate}`).bind(input.requirementId!,input.itemId,ownerUid,input.workOrderId!,quantity,now,id));
    }
    if(physical){
      const before=product.locations.find(location=>location.locationId===locationId)?.onHandMilli||0;
      delta=input.action==='receive'?quantity:quantity-before;
      statements.push(db.prepare(`INSERT INTO trade_stock_location_balances(item_id,location_id,firebase_uid,on_hand_milli,updated_at)
        SELECT ?,?,?,0,? WHERE ${gate} ON CONFLICT(item_id,location_id) DO NOTHING`).bind(input.itemId,locationId,ownerUid,now,id));
      statements.push(db.prepare(`UPDATE trade_stock_location_balances SET on_hand_milli=${input.action==='receive'?'on_hand_milli+?':'?'},updated_at=? WHERE item_id=? AND location_id=? AND firebase_uid=? AND ${gate}`).bind(quantity,now,input.itemId,locationId,ownerUid,id));
    }
    const change=physical?"on_hand_milli=(SELECT SUM(on_hand_milli) FROM trade_stock_location_balances WHERE item_id=trade_stock_items.item_id AND firebase_uid=trade_stock_items.firebase_uid),":input.action==='configure'?"low_stock_milli=?,":input.action==='disable'?"tracked=0,":"";
    statements.push(db.prepare(`UPDATE trade_stock_items SET ${change}revision=revision+1,updated_at=? WHERE item_id=? AND firebase_uid=? AND ${gate}`)
      .bind(...(input.action==='configure'?[input.lowStockMilli!]:[]),now,input.itemId,ownerUid,id));
  }
  const locationName=locations.find(location=>location.id===locationId)?.name||"";
  const note=[input.note,physical||input.action==='enable'?locationName:""] .filter(Boolean).join(" | ");
  statements.push(db.prepare(`INSERT INTO trade_stock_movements(id,item_id,firebase_uid,action,quantity_milli,change_milli,on_hand_milli,work_order_id,requirement_id,note,actor_uid,created_at)
    SELECT ?,item_id,firebase_uid,?,?,?,on_hand_milli,?,?,?,?,? FROM trade_stock_items WHERE item_id=? AND firebase_uid=? AND ${gate}`)
    .bind(id,input.action,quantity,delta,input.workOrderId||"",input.requirementId||"",note,actorUid,now,input.itemId,ownerUid,id));
  await db.batch(statements);
  const saved=await db.prepare("SELECT payload_json FROM trade_stock_operations WHERE firebase_uid=? AND operation_id=?").bind(ownerUid,input.operationId).first<Row>();
  if(saved?.payload_json!==payloadJson) throw new Error("STOCK_OPERATION_REUSED");
  return input;
}
async function transferStock(ownerUid:string,actorUid:string,input:StockMutation,product:StockItem,payload:string){
  const db=getD1();const previous=await db.prepare("SELECT payload_json FROM trade_stock_transfers WHERE firebase_uid=? AND operation_id=?").bind(ownerUid,input.operationId).first<Row>();
  if(previous){if(previous.payload_json!==payload)throw new Error("STOCK_OPERATION_REUSED");return input;}
  const locations=await stockLocations(ownerUid);
  if(!locations.some(location=>location.id===input.fromLocationId)||!locations.some(location=>location.id===input.toLocationId))throw new Error("STOCK_LOCATION_NOT_FOUND");
  const id=crypto.randomUUID(),now=new Date().toISOString(),gate="EXISTS(SELECT 1 FROM trade_stock_transfers WHERE id=?)";
  await db.batch([
    db.prepare(`INSERT INTO trade_stock_transfers(id,firebase_uid,operation_id,item_id,from_location_id,to_location_id,quantity_milli,on_hand_milli,expected_revision,payload_json,note,actor_uid,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(firebase_uid,operation_id) DO NOTHING`).bind(id,ownerUid,input.operationId,input.itemId,input.fromLocationId!,input.toLocationId!,input.quantityMilli!,product.onHandMilli,input.expectedRevision,payload,input.note||"",actorUid,now),
    db.prepare(`INSERT INTO trade_stock_location_balances(item_id,location_id,firebase_uid,on_hand_milli,updated_at) SELECT ?,?,?,0,? WHERE ${gate} ON CONFLICT(item_id,location_id) DO NOTHING`).bind(input.itemId,input.toLocationId!,ownerUid,now,id),
    db.prepare(`UPDATE trade_stock_location_balances SET on_hand_milli=on_hand_milli-?,updated_at=? WHERE item_id=? AND location_id=? AND firebase_uid=? AND ${gate}`).bind(input.quantityMilli!,now,input.itemId,input.fromLocationId!,ownerUid,id),
    db.prepare(`UPDATE trade_stock_location_balances SET on_hand_milli=on_hand_milli+?,updated_at=? WHERE item_id=? AND location_id=? AND firebase_uid=? AND ${gate}`).bind(input.quantityMilli!,now,input.itemId,input.toLocationId!,ownerUid,id),
    db.prepare(`UPDATE trade_stock_items SET revision=revision+1,updated_at=? WHERE item_id=? AND firebase_uid=? AND ${gate}`).bind(now,input.itemId,ownerUid,id)
  ]);
  const saved=await db.prepare("SELECT payload_json FROM trade_stock_transfers WHERE firebase_uid=? AND operation_id=?").bind(ownerUid,input.operationId).first<Row>();
  if(saved?.payload_json!==payload)throw new Error("STOCK_OPERATION_REUSED");return input;
}
/** Prepare the complete desired issued quantities. The caller executes these before the actual upsert in the same atomic batch. */
export async function stockActualStatements(ownerUid:string,requirementId:string,quantityMilli:number,rawLocations:unknown):Promise<D1PreparedStatement[]> {
  const db=getD1();
  const row=await db.prepare(`SELECT r.source_id,i.tracked,i.revision,a.quantity_milli actual_milli,u.baseline_milli,u.issued_milli
    FROM trade_crm_job_plan_requirements r LEFT JOIN trade_stock_items i ON i.item_id=r.source_id AND i.firebase_uid=r.firebase_uid
    LEFT JOIN trade_crm_job_actuals a ON a.job_plan_requirement_id=r.id AND a.firebase_uid=r.firebase_uid
    LEFT JOIN trade_stock_actual_issues u ON u.requirement_id=r.id AND u.firebase_uid=r.firebase_uid
    WHERE r.id=? AND r.firebase_uid=? AND r.requirement_type='material'`).bind(requirementId,ownerUid).first<Row>();
  if(!row?.tracked)return [];
  await ensureTradeStockSchemaGuards(db);
  const baseline=Number(row.baseline_milli??row.actual_milli??0),desired=Math.max(0,quantityMilli-baseline),locations=await stockLocations(ownerUid);
  let selection;
  if(rawLocations!==undefined) selection=normaliseStockUsageLocations(rawLocations);
  else if(locations.length===1)selection=[{locationId:locations[0].id,quantityMilli:desired}];
  else if(Number(row.issued_milli||0)===desired){
    const current=await db.prepare("SELECT location_id,quantity_milli FROM trade_stock_usage_locations WHERE requirement_id=? AND firebase_uid=?").bind(requirementId,ownerUid).all<Row>();
    selection=current.results.map(use=>({locationId:String(use.location_id),quantityMilli:Number(use.quantity_milli)}));
  } else throw new Error("STOCK_LOCATION_REQUIRED");
  if(selection.some(use=>!locations.some(location=>location.id===use.locationId))||selection.reduce((sum,use)=>sum+use.quantityMilli,0)!==desired)throw new Error("STOCK_INVALID_LOCATION");
  return [db.prepare("DELETE FROM trade_stock_usage_selections WHERE requirement_id=? AND firebase_uid=?").bind(requirementId,ownerUid),
    db.prepare("INSERT INTO trade_stock_usage_selections(requirement_id,item_id,firebase_uid,quantity_milli,locations_json,expected_revision) VALUES(?,?,?,?,?,?)").bind(requirementId,String(row.source_id),ownerUid,quantityMilli,JSON.stringify(selection),Number(row.revision))];
}
