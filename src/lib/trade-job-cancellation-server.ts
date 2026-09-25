import { creditexJobEverCompletedSql } from "./creditex-job-lifecycle-sql";
import { creditexWriteGuard } from "./creditex-onboarding-server";
import { cancelAppointmentInConnectedCalendars } from "./trade-calendar-sync-server";

export async function assertTradeJobCanCancel(db:D1Database,ownerUid:string,workOrderId:string) {
  const record=await db.prepare(`SELECT ${creditexJobEverCompletedSql("work")} completed
    FROM trade_work_orders work WHERE work.id=? AND work.firebase_uid=?`)
    .bind(workOrderId,ownerUid).first<{completed:number}>();
  if(!record||record.completed) throw new Error("JOB_CANCEL_COMPLETED");
}

export function tradeJobCancellationGuard(db:D1Database,ownerUid:string,workOrderId:string) {
  return creditexWriteGuard(db,ownerUid,`EXISTS(SELECT 1 FROM trade_work_orders work WHERE work.id=? AND work.firebase_uid=?
    AND work.record_status='active' AND NOT ${creditexJobEverCompletedSql("work")})`,[workOrderId,ownerUid]);
}

export function cancelledJobAppointmentsStatement(db:D1Database,ownerUid:string,workOrderId:string,now:string) {
  return db.prepare(`UPDATE trade_crm_appointments SET status='cancelled',revision=revision+1,updated_at=?
    WHERE work_order_id=? AND firebase_uid=? AND status IN ('scheduled','en_route','arrived','in_progress','no_show')`)
    .bind(now,workOrderId,ownerUid);
}

export async function reconcileCancelledJobCalendars(db:D1Database,ownerUid:string,workOrderId:string) {
  const appointments=await db.prepare(`SELECT id FROM trade_crm_appointments WHERE work_order_id=? AND firebase_uid=? AND status='cancelled'`)
    .bind(workOrderId,ownerUid).all<{id:string}>();
  const result={attempted:0,synced:0,failed:0};
  for(const appointment of appointments.results){const sync=await cancelAppointmentInConnectedCalendars(ownerUid,appointment.id);
    result.attempted+=sync.attempted;result.synced+=sync.synced;result.failed+=sync.failed;}
  return result;
}
