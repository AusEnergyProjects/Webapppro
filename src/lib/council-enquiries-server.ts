import { councilReportPeriod, councilSmallCohort, type CouncilEnquirySummary, type CouncilReportInput } from "./council-reporting.ts";
import { reportWindow } from "./trade-business-reports.ts";

type Cell = { dimension: string; key: string; count: number; people: number; missing: number };

/** Public enquiry aggregates only. Contact fields are used inside SQL for cohort protection and never returned. */
export async function loadCouncilEnquiries(db: Pick<D1Database,"prepare">, input: CouncilReportInput, now = new Date()): Promise<CouncilEnquirySummary> {
  const period = councilReportPeriod(input.period,input.state,now);
  const quarter = councilReportPeriod("quarter",input.state,now);
  const year = councilReportPeriod("year",input.state,now);
  const months: Array<{ key: string; startUtc: string; endUtc: string }> = [];
  const firstMonth = new Date(`${period.end.slice(0,7)}-01T00:00:00Z`);
  firstMonth.setUTCMonth(firstMonth.getUTCMonth()-11);
  for (let index=0;index<12;index++) {
    const startDate = new Date(firstMonth);
    startDate.setUTCMonth(firstMonth.getUTCMonth()+index);
    const endDate = new Date(Date.UTC(startDate.getUTCFullYear(),startDate.getUTCMonth()+1,0));
    const start = startDate.toISOString().slice(0,10);
    const end = endDate.toISOString().slice(0,10);
    const window = reportWindow(start,end<period.end ? end : period.end,input.state);
    months.push({key:start.slice(0,7),startUtc:window.startUtc,endUtc:window.endUtc});
  }
  const query = `WITH area AS (SELECT value postcode FROM json_each(?)), months AS (
    SELECT json_extract(value,'$.key') key,json_extract(value,'$.startUtc') starts,json_extract(value,'$.endUtc') ends FROM json_each(?)
  ), source AS MATERIALIZED (
    SELECT o.id,o.postcode,o.created_at,
      CASE WHEN julianday(o.created_at)>=julianday(?) THEN 'quarter' WHEN julianday(o.created_at)>=julianday(?) THEN 'earlier_year' ELSE 'earlier_history' END band,
      NULLIF(lower(trim(r.customer_email,char(9)||char(10)||char(13)||' ')),'') customer
    FROM trade_opportunities o
    JOIN public_trade_lead_contact_releases r ON r.opportunity_id=o.id AND r.status='active' AND r.withdrawn_at=''
    WHERE o.state=? AND o.postcode IN (SELECT postcode FROM area) AND o.is_synthetic=0
      AND o.source_reference<>'' AND o.created_by_uid='lead-intake'
      AND julianday(o.created_at)<julianday(?)
  ), selected AS (SELECT * FROM source WHERE julianday(created_at)>=julianday(?)), cells AS (
    SELECT 'total' dimension,'' key,COUNT(*) count,COUNT(DISTINCT customer) people,SUM(customer IS NULL) missing FROM selected
    UNION ALL SELECT 'postcode',postcode,COUNT(*),COUNT(DISTINCT customer),SUM(customer IS NULL) FROM selected GROUP BY postcode
    UNION ALL SELECT 'month',m.key,COUNT(*),COUNT(DISTINCT s.customer),SUM(s.customer IS NULL)
      FROM selected s JOIN months m ON julianday(s.created_at)>=julianday(m.starts) AND julianday(s.created_at)<julianday(m.ends) GROUP BY m.key
    UNION ALL SELECT 'privacy',s.band||':'||s.postcode||':'||COALESCE(m.key,'before_trend'),COUNT(*),COUNT(DISTINCT s.customer),SUM(s.customer IS NULL)
      FROM source s LEFT JOIN months m ON julianday(s.created_at)>=julianday(m.starts) AND julianday(s.created_at)<julianday(m.ends)
      GROUP BY s.band,s.postcode,COALESCE(m.key,'before_trend')
  ) SELECT * FROM cells`;
  const {results} = await db.prepare(query).bind(JSON.stringify(input.postcodes),JSON.stringify(months),quarter.startUtc,year.startUtc,input.state,period.endUtc,period.startUtc).all<Cell>();
  // Protect postcode/month intersections and the older remainder as well as visible
  // totals. Otherwise all-time minus the last 12 months could reveal a small cohort.
  const suppressed = results.some(row => (row.count>0 && (councilSmallCohort(row.people) || row.people===0 || row.missing>0)));
  return {
    total: suppressed ? null : Number(results.find(row=>row.dimension==='total')?.count ?? 0),
    postcodes: input.postcodes.map(postcode=>({postcode,count:suppressed ? null : Number(results.find(row=>row.dimension==='postcode' && row.key===postcode)?.count ?? 0)})),
    trend: suppressed ? [] : results.filter(row=>row.dimension==='month').sort((a,b)=>a.key.localeCompare(b.key)).map(row=>({month:row.key,count:Number(row.count)})),
    suppressed,
  };
}
