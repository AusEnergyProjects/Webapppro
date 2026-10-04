import { verifiedTradeAccountPredicate } from "./trade-account-predicates.ts";
import { creditexCanonicalSha256 } from "./creditex-interchange-preflight.ts";
import { australiaLocalDateTime } from "./trade-schedule.ts";
import { postcodeCoordinate } from "./postcode-distance.ts";
import { ENERGY_SERVICE_LABELS } from "./energy-service-catalogue.mjs";
import { reportWindow } from "./trade-business-reports.ts";
import { COUNCIL_MINIMUM_COHORT, COUNCIL_REPORT_METHODOLOGY, CouncilReportInputError, councilReportPeriod, councilSmallCohort, type CouncilBreakdown, type CouncilReport, type CouncilReportInput } from "./council-reporting.ts";

type Row = Record<string, unknown>;
const amount = (value: unknown) => { const result = Number(value || 0); if (!Number.isFinite(result)) throw new Error("Invalid council aggregate."); return result; };
const issued = "('issued','part_credited','credited')";

// Only aggregates reach the caller. Governed impact receipts are checked on the
// server and never serialized. Every job relation also checks the owning business.
const base = `WITH area AS (SELECT value postcode FROM json_each(?)),
eligible_accounts AS MATERIALIZED (
  SELECT a.firebase_uid,a.postcode,a.address_state FROM trade_accounts a
  WHERE a.is_synthetic=0 AND a.partner_type='installer' AND ${verifiedTradeAccountPredicate("a")}
), completed AS MATERIALIZED (
  SELECT w.id,w.firebase_uid,COALESCE(NULLIF(w.service_category,''),'other') activity,
    s.postcode,MIN(e.created_at) completed_at,
    CASE WHEN a.postcode='' OR a.address_state='' THEN 'unknown'
      WHEN a.address_state=? AND a.postcode IN (SELECT postcode FROM area) THEN 'local' ELSE 'outside' END locality,
    CASE WHEN d.crm_customer_id<>'' THEN w.firebase_uid||':'||d.crm_customer_id ELSE NULL END customer_key,
    (SELECT ca.campaign_id FROM trade_opportunity_matches m JOIN council_attributions ca ON ca.opportunity_id=m.opportunity_id
      WHERE w.source_type='public_lead' AND w.source_reference=m.id AND m.firebase_uid=w.firebase_uid AND ca.council_id=? LIMIT 1) campaign_id
  FROM trade_work_orders w
  JOIN trade_accounts a ON a.firebase_uid=w.firebase_uid AND a.is_synthetic=0
  JOIN trade_crm_job_details d ON d.work_order_id=w.id AND d.firebase_uid=w.firebase_uid
  JOIN trade_crm_service_sites s ON s.id=d.service_site_id AND s.firebase_uid=w.firebase_uid AND s.record_status='active'
  JOIN trade_work_order_events e ON e.work_order_id=w.id AND e.firebase_uid=w.firebase_uid AND e.event_type='job_completed'
  WHERE w.record_status='active' AND w.partner_type='installer' AND w.work_type='job' AND w.stage='completed'
    AND s.address_state=? AND s.postcode IN (SELECT postcode FROM area)
  GROUP BY w.id,w.firebase_uid
), native_invoices AS MATERIALIZED (
  SELECT q.id,q.work_order_id,q.firebase_uid,q.total_cents-q.tax_cents net_cents,'quick' source
  FROM trade_crm_quick_invoices q JOIN completed j ON j.id=q.work_order_id AND j.firebase_uid=q.firebase_uid
  WHERE q.status IN ${issued} AND q.sent_at<>'' AND q.currency='AUD'
  UNION ALL
  SELECT a.id,a.work_order_id,a.firebase_uid,a.total_cents-a.tax_cents,'accepted'
  FROM trade_crm_accepted_invoices a JOIN completed j ON j.id=a.work_order_id AND j.firebase_uid=a.firebase_uid
  WHERE a.status='issued' AND a.currency='AUD' AND NOT EXISTS (
    SELECT 1 FROM trade_crm_quick_invoices q WHERE q.work_order_id=a.work_order_id AND q.firebase_uid=a.firebase_uid AND q.status IN ${issued} AND q.sent_at<>'' AND q.currency='AUD')
), invoice_values AS (
  SELECT n.work_order_id,n.firebase_uid,COUNT(*) invoice_count,
    SUM(n.net_cents-COALESCE((SELECT SUM(c.total_cents-c.tax_cents) FROM trade_crm_quick_invoice_credits c
      WHERE n.source='quick' AND c.invoice_id=n.id AND c.work_order_id=n.work_order_id AND c.firebase_uid=n.firebase_uid AND c.status='issued'),0)) value_cents
  FROM native_invoices n GROUP BY n.work_order_id,n.firebase_uid
), all_jobs AS MATERIALIZED (
  SELECT j.*,COALESCE(v.invoice_count,0) invoice_count,COALESCE(v.value_cents,0) value_cents
  FROM completed j LEFT JOIN invoice_values v ON v.work_order_id=j.id AND v.firebase_uid=j.firebase_uid
), jobs AS MATERIALIZED (
  SELECT * FROM all_jobs WHERE julianday(completed_at)>=julianday(?) AND julianday(completed_at)<julianday(?)
)`;

const measures = `COUNT(*) jobs,COUNT(DISTINCT customer_key) customers,
  SUM(CASE WHEN customer_key IS NULL THEN 1 ELSE 0 END) missing_customers,
  COALESCE(SUM(value_cents),0) value_cents,
  COALESCE(SUM(CASE WHEN invoice_count>0 THEN 1 ELSE 0 END),0) invoiced_jobs,
  COUNT(DISTINCT CASE WHEN invoice_count>0 THEN customer_key END) invoiced_customers,
  COALESCE(SUM(CASE WHEN locality='local' THEN 1 ELSE 0 END),0) local_jobs,
  COALESCE(SUM(CASE WHEN locality='outside' THEN 1 ELSE 0 END),0) outside_jobs,
  COALESCE(SUM(CASE WHEN locality='unknown' THEN 1 ELSE 0 END),0) unknown_jobs,
  COALESCE(SUM(CASE WHEN campaign_id IS NOT NULL THEN 1 ELSE 0 END),0) attributed_jobs`;

const impactSql = `SELECT j.id job_id,j.customer_key,j.postcode,j.activity,j.completed_at,
  p.organisation_id,p.id packet_id,p.packet_snapshot,p.packet_sha256,p.quantity_text,p.unit,p.output_code,p.program_code,
  p.compliance_case_id,p.case_revision,p.work_pack_final_record_id,p.calculation_run_id,p.calculation_input_sha256,p.calculation_output_sha256,p.calculation_receipt_sha256,
  calc.input_snapshot,calc.output_snapshot,calc.run_by_uid calculation_run_by,
  calculation_review.reviewer_uid calculation_reviewer,calculation_review.reviewed_at calculation_reviewed_at,
  calculator.id calculator_id,calculator.calculator_key,calculator.version calculator_version,calculator.official_source_sha256 calculator_source_sha256,
  receipt.request_snapshot,receipt.request_sha256,receipt.response_snapshot,receipt.response_sha256,
  receipt.provider_reference,receipt.adapter_id,
  latest.actor_kind,latest.actor_uid,submitted.actor_uid submitted_by
  FROM all_jobs j
  JOIN compliance_cases c ON c.work_order_id=j.id AND c.installer_uid=j.firebase_uid AND c.status NOT IN ('rejected','closed')
  JOIN compliance_output_action_packets p ON p.compliance_case_id=c.id AND p.organisation_id=c.organisation_id AND p.case_revision=c.revision
    AND p.action_kind='certificate_submission' AND p.output_class='tradable_certificate'
    AND ((p.program_code='VEU' AND p.unit='VEEC' AND p.output_code='VEEC') OR (p.program_code='SRES' AND p.unit='STC' AND p.output_code='STC'))
  JOIN compliance_activity_work_pack_instances instance ON instance.id=p.work_pack_instance_id AND instance.organisation_id=p.organisation_id
    AND instance.compliance_case_id=c.id AND instance.work_order_id=j.id AND instance.revision=p.work_pack_revision AND instance.status='completed'
    AND NOT EXISTS (SELECT 1 FROM compliance_activity_work_pack_instances newer WHERE newer.organisation_id=instance.organisation_id AND newer.instance_key=instance.instance_key AND newer.revision>instance.revision)
  JOIN compliance_activity_work_pack_final_records final ON final.id=p.work_pack_final_record_id AND final.organisation_id=p.organisation_id
    AND final.case_instance_id=instance.id AND final.instance_sha256=p.work_pack_instance_sha256 AND final.response_sha256=p.work_pack_response_sha256 AND final.pdf_sha256=p.work_pack_final_pdf_sha256
  JOIN compliance_calculation_runs calc ON calc.id=p.calculation_run_id AND calc.organisation_id=p.organisation_id AND calc.case_id=c.id
    AND calc.case_revision=c.revision AND calc.status IN ('calculated','verified')
  JOIN compliance_activity_work_pack_calculation_reviews calculation_review ON calculation_review.organisation_id=calc.organisation_id AND calculation_review.calculation_run_id=calc.id
    AND calculation_review.case_instance_id=instance.id AND calculation_review.instance_key=instance.instance_key
    AND calculation_review.decision='approved' AND calculation_review.reviewer_uid<>calc.run_by_uid
    AND calculation_review.input_sha256=p.calculation_input_sha256 AND calculation_review.output_sha256=p.calculation_output_sha256
    AND calculation_review.calculator_version_id=calc.calculator_version_id
  JOIN compliance_calculator_versions calculator ON calculator.id=calc.calculator_version_id AND calculator.organisation_id=calc.organisation_id
    AND calculator.activity_version_id=c.activity_version_id AND calculator.approval_state='approved' AND p.calculator_version_id=calculator.id
    AND p.engine_calculator_key=calculator.calculator_key AND p.engine_calculator_version=calculator.version
    AND p.calculator_source_sha256=calculator.official_source_sha256 AND calculation_review.calculator_source_sha256=calculator.official_source_sha256
  JOIN compliance_calculator_engine_receipts engine_receipt ON engine_receipt.id=calculation_review.engine_receipt_id AND engine_receipt.organisation_id=calc.organisation_id
    AND engine_receipt.calculator_version_id=calculator.id AND engine_receipt.calculator_version_number=calculator.version AND engine_receipt.result='passed'
    AND engine_receipt.vector_count>0 AND engine_receipt.executed_by_uid<>'' AND datetime(engine_receipt.executed_at) IS NOT NULL
  JOIN compliance_output_action_reviews review ON review.packet_id=p.id AND review.organisation_id=p.organisation_id
    AND review.decision='approved' AND review.packet_sha256=p.packet_sha256 AND review.reviewed_by_uid<>p.prepared_by_uid
    AND review.reviewed_by_uid<>'' AND p.prepared_by_uid<>''
  JOIN compliance_output_action_events latest ON latest.packet_id=p.id AND latest.organisation_id=p.organisation_id
    AND latest.sequence=(SELECT MAX(e.sequence) FROM compliance_output_action_events e WHERE e.packet_id=p.id AND e.organisation_id=p.organisation_id)
    AND latest.to_status='provider_accepted' AND julianday(latest.occurred_at)>=julianday(review.reviewed_at)
  JOIN compliance_output_action_adapter_receipts receipt ON receipt.id=latest.adapter_receipt_id AND receipt.packet_id=p.id AND receipt.organisation_id=p.organisation_id
    AND receipt.provider_status='provider_accepted' AND receipt.provider_reference<>''
  JOIN compliance_output_action_events submitted ON submitted.packet_id=p.id AND submitted.organisation_id=p.organisation_id AND submitted.to_status='submitted'
    AND submitted.sequence=(SELECT MAX(e.sequence) FROM compliance_output_action_events e WHERE e.packet_id=p.id AND e.organisation_id=p.organisation_id AND e.to_status='submitted')
    AND submitted.sequence<latest.sequence
  JOIN compliance_output_action_adapter_receipts submission ON submission.id=submitted.adapter_receipt_id AND submission.packet_id=p.id AND submission.organisation_id=p.organisation_id
    AND submission.provider_status='submitted' AND submission.provider_name=receipt.provider_name AND submission.provider_reference=receipt.provider_reference
  WHERE julianday(j.completed_at)<julianday(?)
    AND ((latest.actor_kind='adapter' AND latest.actor_uid=receipt.adapter_id) OR (latest.actor_kind IN ('admin','compliance') AND latest.actor_uid<>submitted.actor_uid))`;

type Impact = { job: string; customer: string; postcode: string; activity: string; completedAt: string; unit: "VEEC" | "STC"; quantity: number; final: string; calculation: string };
function object(value: unknown): Record<string,unknown> | null { return value && typeof value==="object" && !Array.isArray(value) ? value as Record<string,unknown> : null; }
function verifiedImpact(row: Row): Impact | null {
  try {
    const packet=object(JSON.parse(String(row.packet_snapshot)));
    const calculation=object(packet?.calculation); const pack=object(packet?.workPack);
    const outputSnapshot=JSON.parse(String(row.output_snapshot)); const output=object(object(outputSnapshot)?.output);
    const request=JSON.parse(String(row.request_snapshot)); const response=JSON.parse(String(row.response_snapshot));
    const quantity=Number(row.quantity_text);
    if (!packet || !calculation || !pack || !Number.isSafeInteger(quantity) || quantity<=0 || !/^[1-9][0-9]*$/.test(String(row.quantity_text))
      || (row.unit!=="VEEC" && row.unit!=="STC") || packet.contract!=="creditex-output-action-packet/v1"
      || packet.actionKind!=="certificate_submission" || packet.outputClass!=="tradable_certificate"
      || packet.outputCode!==row.output_code || packet.programCode!==row.program_code
      || packet.complianceCaseId!==row.compliance_case_id || packet.caseRevision!==Number(row.case_revision)
      || pack.finalRecordId!==row.work_pack_final_record_id || calculation.runId!==row.calculation_run_id
      || calculation.quantity!==row.quantity_text || calculation.unit!==row.unit
      || output?.decimal!==row.quantity_text || output?.unit!==row.unit
      || calculation.runByUid!==row.calculation_run_by
      || calculation.verifiedByUid!==row.calculation_reviewer || calculation.verifiedAt!==row.calculation_reviewed_at
      || calculation.calculatorVersionId!==row.calculator_id || calculation.engineCalculatorKey!==row.calculator_key
      || calculation.engineCalculatorVersion!==Number(row.calculator_version) || calculation.calculatorSourceSha256!==row.calculator_source_sha256
      || typeof calculation.runByUid!=="string" || !calculation.runByUid || typeof calculation.verifiedByUid!=="string" || !calculation.verifiedByUid || calculation.runByUid===calculation.verifiedByUid
      || !Number.isFinite(Date.parse(String(calculation.verifiedAt)))
      || creditexCanonicalSha256(packet)!==row.packet_sha256
      || creditexCanonicalSha256(request)!==row.request_sha256 || creditexCanonicalSha256(response)!==row.response_sha256
      || calculation.inputSha256!==row.calculation_input_sha256 || calculation.outputSha256!==row.calculation_output_sha256
      || calculation.receiptSha256!==row.calculation_receipt_sha256 || !/^sha256:[0-9a-f]{64}$/.test(String(calculation.receiptSha256))
      || object(outputSnapshot)?.receiptHash!==calculation.receiptSha256
      || creditexCanonicalSha256(JSON.parse(String(row.input_snapshot)))!==calculation.inputSha256
      || creditexCanonicalSha256(outputSnapshot)!==calculation.outputSha256) return null;
    if (row.adapter_id==="manual-provider-record/v1") {
      const manual=object(response);
      if (!manual || manual.packetSha256!==row.packet_sha256 || manual.outcome!=="provider_accepted" || manual.recordedByUid!==row.actor_uid || manual.providerReference!==row.provider_reference || row.request_sha256!==row.packet_sha256) return null;
    }
    return { job:String(row.job_id),customer:String(row.customer_key || ""),postcode:String(row.postcode),activity:String(row.activity),completedAt:String(row.completed_at),unit:row.unit,quantity,final:`${row.organisation_id}:${row.work_pack_final_record_id}`,calculation:`${row.organisation_id}:${row.calculation_run_id}` };
  } catch { return null; } // Invalid persisted evidence is omitted, never treated as a zero outcome.
}
function acceptedImpacts(rows: Row[]) {
  const candidates=rows.map(verifiedImpact).filter((row): row is Impact => row!==null);
  const identities=new Map<string,Set<string>>();
  for (const row of candidates) for (const key of [row.final,row.calculation]) {
    const values=identities.get(key) || new Set<string>(); values.add(`${row.job}|${row.unit}|${row.quantity}`); identities.set(key,values);
  }
  const groups=new Map<string,Impact[]>();
  for (const row of candidates) {
    if (identities.get(row.final)!.size>1 || identities.get(row.calculation)!.size>1) continue;
    const key=`${row.job}|${row.unit}`; const group=groups.get(key) || [];
    if (!group.some(item => item.final===row.final && item.calculation===row.calculation && item.quantity===row.quantity)) group.push(row);
    groups.set(key,group);
  }
  return [...groups.values()].filter(group => group.length===1).map(group => group[0]);
}

function cohortUnsafe(row: Row) {
  return councilSmallCohort(amount(row.jobs)) || (amount(row.jobs) > 0 && (amount(row.customers) < COUNCIL_MINIMUM_COHORT || amount(row.missing_customers) > 0));
}
function localityUnsafe(row: Row) {
  return [row.local_jobs,row.outside_jobs,row.unknown_jobs].some(value => councilSmallCohort(amount(value)));
}
function money(row: Row, suppressed: boolean) {
  return suppressed || moneyUnsafe(row) ? null : amount(row.value_cents);
}
function moneyUnsafe(row: Row) { return amount(row.invoiced_jobs)>0 && amount(row.invoiced_customers)<COUNCIL_MINIMUM_COHORT; }
function safeNumber(value: unknown) { const n = amount(value); return councilSmallCohort(n) ? null : n; }
function breakdown(row: Row, label: string, suppressLocality: boolean, suppressMoney: boolean): CouncilBreakdown {
  return { key: String(row.key), label, completedJobs: amount(row.jobs), completedValueCents: money(row,suppressMoney), localJobs: suppressLocality ? null : amount(row.local_jobs), veecQuantity: null, stcQuantity: null, estimatedTonnesCo2e: null };
}

export async function loadCouncilReport(database: Pick<D1Database,"prepare"|"batch">, input: CouncilReportInput, now = new Date()): Promise<CouncilReport> {
  if (!input.councilId || !input.name || !Array.isArray(input.postcodes) || input.postcodes.length > 500 || input.postcodes.some(code => !/^\d{4}$/.test(code))) throw new CouncilReportInputError("A council and its approved postcode scope are required.");
  const postcodes = [...new Set(input.postcodes)].sort();
  const period = councilReportPeriod(input.period,input.state,now);
  const quarter = councilReportPeriod("quarter",input.state,now);
  const year = councilReportPeriod("year",input.state,now);
  const args = [JSON.stringify(postcodes),input.state,input.councilId,input.state,period.startUtc,period.endUtc];
  // Fixed month boundaries include Australian daylight-saving transitions.
  const months: Array<{ key: string; start: string; end: string; startUtc: string; endUtc: string }> = [];
  const firstTrendMonth=new Date(`${period.end.slice(0,7)}-01T00:00:00Z`); firstTrendMonth.setUTCMonth(firstTrendMonth.getUTCMonth()-11);
  const trendStart=firstTrendMonth.toISOString().slice(0,10)>period.start ? firstTrendMonth.toISOString().slice(0,10) : period.start;
  for (let date = new Date(`${trendStart.slice(0,7)}-01T00:00:00Z`); date.toISOString().slice(0,10) <= period.end; date.setUTCMonth(date.getUTCMonth()+1)) {
    const start = date.toISOString().slice(0,10);
    const next = new Date(date); next.setUTCMonth(next.getUTCMonth()+1);
    const end = new Date(next.getTime()-86400000).toISOString().slice(0,10);
    months.push({ key: start.slice(0,7), ...reportWindow(start,end < period.end ? end : period.end,input.state) });
  }
  const results = await database.batch<Row>([
    database.prepare(`${base} SELECT ${measures} FROM jobs`).bind(...args),
    database.prepare(`${base} SELECT activity key,${measures} FROM jobs GROUP BY activity ORDER BY jobs DESC,activity`).bind(...args),
    database.prepare(`${base} SELECT postcode key,${measures} FROM jobs GROUP BY postcode ORDER BY postcode`).bind(...args),
    database.prepare(`${base}, months AS (SELECT json_extract(value,'$.key') key,json_extract(value,'$.startUtc') starts,json_extract(value,'$.endUtc') ends FROM json_each(?))
      SELECT m.key,${measures} FROM jobs JOIN months m ON julianday(completed_at)>=julianday(m.starts) AND julianday(completed_at)<julianday(m.ends) GROUP BY m.key ORDER BY m.key`).bind(...args,JSON.stringify(months)),
    database.prepare(`${base} SELECT COUNT(*) businesses FROM eligible_accounts WHERE address_state=? AND postcode IN (SELECT postcode FROM area)`).bind(...args,input.state),
    // Suppress complementary periods when subtraction could reveal a small cohort.
    database.prepare(`${base} SELECT CASE WHEN julianday(completed_at)>=julianday(?) THEN 'quarter' WHEN julianday(completed_at)>=julianday(?) THEN 'earlier_year' ELSE 'earlier_history' END key,${measures}
      FROM all_jobs WHERE julianday(completed_at)<julianday(?) GROUP BY key`).bind(...args,quarter.startUtc,year.startUtc,period.endUtc),
    database.prepare(`${base} SELECT c.id,c.title,c.code,c.kind,
      (SELECT COUNT(*) FROM council_attributions a JOIN trade_opportunities o ON o.id=a.opportunity_id
        WHERE a.campaign_id=c.id AND a.council_id=? AND o.is_synthetic=0 AND o.state=? AND o.postcode IN (SELECT postcode FROM area)
        AND julianday(a.attributed_at)>=julianday(?) AND julianday(a.attributed_at)<julianday(?)) enquiries,
      COUNT(j.id) jobs,COUNT(DISTINCT j.customer_key) customers,COALESCE(SUM(CASE WHEN j.id IS NOT NULL AND j.customer_key IS NULL THEN 1 ELSE 0 END),0) missing_customers,
      COALESCE(SUM(j.value_cents),0) value_cents,COALESCE(SUM(CASE WHEN j.invoice_count>0 THEN 1 ELSE 0 END),0) invoiced_jobs,
      COUNT(DISTINCT CASE WHEN j.invoice_count>0 THEN j.customer_key END) invoiced_customers
      FROM council_campaigns c LEFT JOIN jobs j ON j.campaign_id=c.id WHERE c.council_id=? GROUP BY c.id ORDER BY c.created_at DESC,c.id`).bind(...args,input.councilId,input.state,period.startUtc,period.endUtc,input.councilId),
    database.prepare(`${base}, bands AS MATERIALIZED (
      SELECT *,CASE WHEN julianday(completed_at)>=julianday(?) THEN 'quarter' WHEN julianday(completed_at)>=julianday(?) THEN 'earlier_year' ELSE 'earlier_history' END band
      FROM all_jobs WHERE julianday(completed_at)<julianday(?)
    ) SELECT 'activities' dimension,activity key,band,${measures} FROM bands GROUP BY activity,band
      UNION ALL SELECT 'postcodes',postcode,band,${measures} FROM bands GROUP BY postcode,band
      UNION ALL SELECT 'campaigns',COALESCE(campaign_id,''),band,${measures} FROM bands GROUP BY campaign_id,band`).bind(...args,quarter.startUtc,year.startUtc,period.endUtc),
    database.prepare(`WITH area AS (SELECT value postcode FROM json_each(?)) SELECT a.campaign_id,
      CASE WHEN julianday(a.attributed_at)>=julianday(?) THEN 'quarter' WHEN julianday(a.attributed_at)>=julianday(?) THEN 'earlier_year' ELSE 'earlier_history' END band,COUNT(*) enquiries
      FROM council_attributions a JOIN trade_opportunities o ON o.id=a.opportunity_id
      WHERE a.council_id=? AND o.is_synthetic=0 AND o.state=? AND o.postcode IN (SELECT postcode FROM area) AND julianday(a.attributed_at)<julianday(?)
      GROUP BY a.campaign_id,band`).bind(JSON.stringify(postcodes),quarter.startUtc,year.startUtc,input.councilId,input.state,period.endUtc),
    database.prepare(`${base} ${impactSql}`).bind(...args,period.endUtc),
    database.prepare(`${base} SELECT postcode key,COUNT(*) businesses FROM eligible_accounts
      WHERE address_state=? AND postcode IN (SELECT postcode FROM area) GROUP BY postcode ORDER BY postcode`).bind(...args,input.state),
  ]);
  const total = results[0].results[0] || {};
  const privacyPeriods = results[5].results;
  const suppressed = cohortUnsafe(total) || privacyPeriods.some(cohortUnsafe);
  const suppressedBreakdowns: string[] = [];
  const allGroups = [...results[1].results,...results[2].results,...results[3].results];
  const tradePostcodes=results[10].results;
  const localBusinessCount=(postcode: string) => amount(tradePostcodes.find(row => row.key===postcode)?.businesses);
  const privacyGroups = results[7].results;
  const suppressLocality = suppressed || localityUnsafe(total) || [...allGroups,...privacyPeriods,...privacyGroups].some(localityUnsafe);
  const suppressMoney = suppressed || [total,...allGroups,...privacyPeriods,...privacyGroups].some(moneyUnsafe);
  const groups = (rows: Row[], name: string, label: (key: string) => string) => {
    if (suppressed || rows.some(cohortUnsafe) || privacyGroups.some(row => row.dimension===name && cohortUnsafe(row))) { if (rows.length) suppressedBreakdowns.push(name); return []; }
    return rows.map(row => breakdown(row,label(String(row.key)),suppressLocality,suppressMoney));
  };
  const activities = groups(results[1].results,"activities",key => ENERGY_SERVICE_LABELS[key] || "Other energy upgrade");
  const postcodeGroups = groups(results[2].results,"postcodes",key => key).map(row => ({ ...row,registeredLocalBusinesses:localBusinessCount(row.key) }));
  const trend = groups(results[3].results,"trend",key => new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-AU",{ month:"short",year:"numeric",timeZone:"UTC" })).map(row => {
    const month = months.find(item => item.key === row.key)!;
    return { ...row,start:month.start,end:month.end };
  });
  const campaignRows = results[6].results;
  const enquiries = campaignRows.reduce((sum,row) => sum+amount(row.enquiries),0);
  const campaignSuppressed = suppressed || campaignRows.some(row => cohortUnsafe(row) || councilSmallCohort(amount(row.enquiries))) || privacyGroups.some(row => row.dimension==='campaigns' && cohortUnsafe(row)) || results[8].results.some(row => councilSmallCohort(amount(row.enquiries))) || councilSmallCohort(amount(total.jobs)-amount(total.attributed_jobs));
  if (campaignSuppressed && campaignRows.length) suppressedBreakdowns.push("campaigns");
  const campaigns = campaignRows.map(row => ({ id:String(row.id),name:String(row.title),referenceCode:String(row.code),channel:row.kind === "session" ? "Information session" : "Council campaign",enquiries:campaignSuppressed ? null : amount(row.enquiries),completedJobs:campaignSuppressed ? null : amount(row.jobs),completedValueCents:money(row,campaignSuppressed || suppressMoney) }));
  if (suppressLocality && amount(total.jobs)>0) suppressedBreakdowns.push("local business share");
  const completedJobs = suppressed ? null : amount(total.jobs);
  const localJobs = suppressLocality ? null : amount(total.local_jobs);
  const outsideJobs = suppressLocality ? null : amount(total.outside_jobs);
  const unknownLocalityJobs = suppressLocality ? null : amount(total.unknown_jobs);
  const impacts=acceptedImpacts(results[9].results);
  const selectedImpacts=impacts.filter(row => Date.parse(row.completedAt)>=Date.parse(period.startUtc) && Date.parse(row.completedAt)<Date.parse(period.endUtc));
  const impactUnsafe=(rows: Impact[]) => rows.length>0 && (new Set(rows.map(row => row.job)).size<COUNCIL_MINIMUM_COHORT || new Set(rows.map(row => row.customer).filter(Boolean)).size<COUNCIL_MINIMUM_COHORT);
  const schemeHidden=(unit: Impact["unit"]) => {
    if (suppressed) return true;
    const partitions=new Map<string,Impact[]>();
    for (const row of impacts.filter(row => row.unit===unit)) {
      const band=Date.parse(row.completedAt)>=Date.parse(quarter.startUtc) ? "quarter" : Date.parse(row.completedAt)>=Date.parse(year.startUtc) ? "earlier_year" : "history";
      const month=australiaLocalDateTime(input.state,new Date(row.completedAt)).slice(0,7);
      for (const key of [`band:${band}`,`activity:${band}:${row.activity}`,`postcode:${band}:${row.postcode}`,`month:${month}`]) {
        const values=partitions.get(key) || []; values.push(row); partitions.set(key,values);
      }
    }
    return [...partitions.values()].some(impactUnsafe);
  };
  const hiddenVeec=schemeHidden("VEEC"); const hiddenStc=schemeHidden("STC");
  const impactTotals=(rows: Impact[]) => {
    const sum=(unit: Impact["unit"],hidden: boolean) => { const matches=rows.filter(row => row.unit===unit); return hidden || !matches.length || impactUnsafe(matches) ? null : matches.reduce((total,row) => total+row.quantity,0); };
    const veecQuantity=sum("VEEC",hiddenVeec);
    return { veecQuantity,stcQuantity:sum("STC",hiddenStc),estimatedTonnesCo2e:veecQuantity };
  };
  const totals=impactTotals(selectedImpacts);
  for (const row of activities) Object.assign(row,impactTotals(selectedImpacts.filter(item => item.activity===row.key)));
  for (const row of postcodeGroups) Object.assign(row,impactTotals(selectedImpacts.filter(item => item.postcode===row.key)));
  for (const row of trend) Object.assign(row,impactTotals(selectedImpacts.filter(item => australiaLocalDateTime(input.state,new Date(item.completedAt)).slice(0,7)===row.key)));
  if ((hiddenVeec || hiddenStc) && selectedImpacts.length) suppressedBreakdowns.push("certificate evidence");
  const impactCoverageJobs=suppressed ? null : safeNumber(new Set(selectedImpacts.map(row => row.job)).size);
  const mapCells=postcodes.map(postcode => {
    const coordinate=postcodeCoordinate(postcode);
    const group=postcodeGroups.find(row => row.key===postcode);
    return { postcode,label:`Postcode ${postcode}`,position:coordinate ? { lat:coordinate[0],lng:coordinate[1] } : null,
      completedJobs:suppressed || suppressedBreakdowns.includes("postcodes") ? null : group?.completedJobs ?? 0,
      registeredLocalBusinesses:localBusinessCount(postcode) };
  });
  return {
    generatedAt:now.toISOString(),mode:"live",scope:{ councilId:input.councilId,name:input.name,state:input.state,postcodes },
    period:{ key:period.key,label:period.label,start:period.start,end:period.end,timeZone:period.timeZone },
    metrics:{ completedJobs,completedValueCents:money(total,suppressMoney),localJobs,outsideJobs,unknownLocalityJobs,
      localSharePercent:localJobs !== null && completedJobs ? localJobs/completedJobs*100 : null,
      registeredLocalBusinesses:amount(results[4].results[0]?.businesses),attributedEnquiries:campaignSuppressed ? null : safeNumber(enquiries),attributedCompletedJobs:campaignSuppressed ? null : safeNumber(total.attributed_jobs),
      ...totals },
    activities,postcodes:postcodeGroups,trend,campaigns,
    map:{ coordinateBasis:"postcode_centroid",cells:mapCells,boundaryNote:"Postcode centres show the approved reporting area approximately. They are not business or customer addresses and do not define an official council boundary." },
    dataQuality:{ minimumCohort:COUNCIL_MINIMUM_COHORT,suppressed,suppressedBreakdowns,missingInvoice:suppressed ? null : safeNumber(amount(total.jobs)-amount(total.invoiced_jobs)),missingLocality:unknownLocalityJobs,missingCarbonMethod:totals.veecQuantity===null,
      impactEvidence:totals.veecQuantity!==null || totals.stcQuantity!==null ? "provider_accepted" : "unavailable",impactCoverageJobs,
      coverageNote:"Certificate totals include only provider-accepted, independently reviewed packets with verified evidence hashes. They are not registry-issued certificates. Deemed lifetime abatement uses VEECs only; STCs are excluded. Missing, stale, ambiguous and small-cohort evidence is withheld. This is not annual or measured carbon reduction." },
    methodology:[...COUNCIL_REPORT_METHODOLOGY],
  };
}
