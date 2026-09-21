"use client";

import { useEffect, useRef, useState } from "react";
import { downloadWorkspaceCsv, WorkspaceTableTools } from "./WorkspaceTableTools";
import type { AdminJobRow } from "@/lib/admin-job-register";
import { JobActionsButton, JobRowMenu, useJobRowMenu } from "./JobRowActions";
import styles from "./AdminJobDirectory.module.css";

const columns = [
  {key:"workNumber",label:"Job ID"}, {key:"customerName",label:"Customer"}, {key:"title",label:"Work"},
  {key:"installerBusiness",label:"Trade"}, {key:"serviceCategory",label:"Service"}, {key:"siteArea",label:"Location"},
  {key:"stage",label:"Status"}, {key:"scheduledStart",label:"Scheduled"}, {key:"createdAt",label:"Created"}, {key:"updatedAt",label:"Updated"},
] as const;
type JobRow = AdminJobRow & { createdAt?: string };
type Column = typeof columns[number]["key"];
const emptyFilters = {q:"",stage:"",service:"",installer:"",from:"",to:""};
function readable(value: string) { return value.replaceAll("_", " ").replaceAll("-", " "); }
function dateTime(value: string) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("en-AU",{dateStyle:"medium",timeStyle:"short"}) : value;
}
export function AdminJobDirectory({ api }: { api: (path: string, init?: RequestInit) => Promise<Record<string, unknown>> }) {
  const [filters,setFilters] = useState(emptyFilters);
  const [sort,setSort] = useState("updated-desc");
  const [page,setPage] = useState(1);
  const [revision,setRevision] = useState(0);
  const [jobs,setJobs] = useState<JobRow[]>([]);
  const [facets,setFacets] = useState<{stages:string[];services:string[];installers:string[]}>({stages:[],services:[],installers:[]});
  const [pagination,setPagination] = useState({total:0,pageSize:50,hasNext:false});
  const [visibleColumns,setVisibleColumns] = useState<string[]>(columns.map(column=>column.key));
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const [selectedJob,setSelectedJob] = useState<JobRow | null>(null);
  const [actionMessage,setActionMessage] = useState("");
  const detailRef = useRef<HTMLDialogElement>(null);
  const detailLauncherRef = useRef<HTMLElement | null>(null);
  const { menu, openMenu, closeMenu } = useJobRowMenu();
  useEffect(() => {
    if (selectedJob) detailRef.current?.showModal();
  }, [selectedJob]);
  function viewDetails(job: JobRow, launcher: HTMLElement) { detailLauncherRef.current = launcher; setSelectedJob(job); }
  function closeDetails() {
    detailRef.current?.close(); setSelectedJob(null);
    if (detailLauncherRef.current?.isConnected) detailLauncherRef.current.focus({ preventScroll: true });
  }
  async function copyReference(job: JobRow) {
    try { await navigator.clipboard.writeText(job.workNumber || job.id); setActionMessage("Job reference copied."); }
    catch { setActionMessage("Copy was unavailable. Select the job reference in the details to copy it."); }
  }
  function actions(job: JobRow, launcher: HTMLElement) { return [
    { label: "View job details", run: () => viewDetails(job, launcher) },
    { label: "Copy job reference", run: () => { void copyReference(job); } },
  ]; }
  function filter(key: keyof typeof filters,value:string) { setFilters(current=>({...current,[key]:value}));setPage(1); }
  useEffect(()=>{
    let active=true;
    const timer=window.setTimeout(()=>{
      setLoading(true);setError("");
      closeMenu(false);
      const params=new URLSearchParams({...filters,sort,page:String(page)});
      void api('/api/admin/jobs?'+params).then(result=>{
        if(!active)return;
        setJobs(Array.isArray(result.jobs)?result.jobs as JobRow[]:[]);
        setPagination(result.pagination as typeof pagination);
        setFacets(result.facets as typeof facets);
      }).catch(cause=>{if(active){setJobs([]);setError(cause instanceof Error?cause.message:"Jobs could not be loaded.");}})
        .finally(()=>{if(active)setLoading(false);});
    },220);
    return()=>{active=false;window.clearTimeout(timer);};
  },[api,filters,sort,page,revision,closeMenu]);
  const selectedColumns=visibleColumns.map(key=>columns.find(column=>column.key===key)).filter((column): column is typeof columns[number]=>Boolean(column));
  function cell(job:JobRow,key:Column) {
    if(key==="scheduledStart")return dateTime(job[key]);
    if(key==="createdAt"||key==="updatedAt")return job[key] ? dateTime(job[key]) : "Not recorded";
    if(key==="stage"||key==="serviceCategory")return readable(job[key])||"Not set";
    return job[key]||"Not supplied";
  }
  return <section className={`admin-job-directory ${styles.directory}`}>
    <header className="admin-register-heading"><div><span>Daily work</span><h1>Jobs</h1><p>Find a job, check its progress and see who is responsible.</p></div>
      <button type="button" onClick={()=>setRevision(current=>current+1)} disabled={loading}>Refresh</button></header>
    <div className="admin-register-filters">
      <label className="admin-register-search">Search jobs<input type="search" value={filters.q} onChange={event=>filter("q",event.target.value)} placeholder="Job ID, customer, trade, work or location" /></label>
      <label>Status<select value={filters.stage} onChange={event=>filter("stage",event.target.value)}><option value="">All statuses</option>{facets.stages.map(value=><option key={value} value={value}>{readable(value)}</option>)}</select></label>
      <label>Service<select value={filters.service} onChange={event=>filter("service",event.target.value)}><option value="">All services</option>{facets.services.map(value=><option key={value} value={value}>{readable(value)}</option>)}</select></label>
      <label>Trade<select value={filters.installer} onChange={event=>filter("installer",event.target.value)}><option value="">All trades</option>{facets.installers.map(value=><option key={value}>{value}</option>)}</select></label>
      <label>Scheduled from<input type="date" data-date-range-group="admin-job-scheduled" data-date-range-role="start" value={filters.from} onChange={event=>filter("from",event.target.value)} /></label>
      <label>Scheduled to<input type="date" data-date-range-group="admin-job-scheduled" data-date-range-role="end" value={filters.to} onChange={event=>filter("to",event.target.value)} /></label>
      <label>Sort by<select value={sort} onChange={event=>{setSort(event.target.value);setPage(1);}}>
        <option value="updated-desc">Recently updated</option><option value="updated-asc">Oldest update</option>
        <option value="scheduled-asc">Next scheduled</option><option value="scheduled-desc">Latest scheduled</option>
        <option value="number-asc">Job ID</option><option value="customer-asc">Customer A to Z</option><option value="installer-asc">Trade A to Z</option>
      </select></label>
      <button type="button" className="admin-clear-filters" onClick={()=>{setFilters(emptyFilters);setSort("updated-desc");setPage(1);}}>Clear filters</button>
    </div>
    <div className="admin-register-toolbar"><p role="status">{loading?"Loading jobs...":error?"Jobs unavailable":pagination.total+' matching '+(pagination.total===1?'job':'jobs')}</p>
      <WorkspaceTableTools columns={[...columns]} visibleKeys={visibleColumns} onVisibleKeys={setVisibleColumns} noun="jobs" exportDisabled={!jobs.length||loading||Boolean(error)}
        onExport={()=>downloadWorkspaceCsv('tlink-admin-jobs-page-'+page+'.csv',selectedColumns,jobs.map(job=>Object.fromEntries(selectedColumns.map(column=>[column.key,cell(job,column.key)]))))} /></div>
    <p className={styles.hint}>Right-click a job or use its ⋯ button for job options. Scroll across for all columns.</p>
    {actionMessage && <p className={styles.hint} role="status">{actionMessage}</p>}
    {error?<div className="admin-register-empty" role="alert"><h2>Jobs could not be loaded</h2><p>{error}</p><button type="button" onClick={()=>setRevision(value=>value+1)}>Try again</button></div>
      :<div className={`admin-register-table ${styles.table}`} aria-busy={loading} tabIndex={0} role="region" aria-label="Scrollable jobs register"><table><caption className="sr-only">Jobs matching the selected filters</caption>
        <thead><tr><th scope="col" className={styles.actionsColumn}><span className="sr-only">Job options</span></th>{selectedColumns.map(column=><th scope="col" key={column.key}>{column.label}</th>)}</tr></thead>
        <tbody>{!loading&&jobs.map(job=><tr key={job.id} onContextMenu={event=>openMenu(event,`admin-job-menu-${job.id}`,job.workNumber,launcher=>actions(job,launcher))}>
          <td className={styles.actionsColumn}><JobActionsButton label={job.workNumber} menuId={`admin-job-menu-${job.id}`} expanded={menu?.id===`admin-job-menu-${job.id}`} onClick={event=>openMenu(event,`admin-job-menu-${job.id}`,job.workNumber,launcher=>actions(job,launcher))} /></td>
          {selectedColumns.map(column=><td key={column.key} data-column={column.key}>{column.key==="workNumber"?<button type="button" className={styles.jobLink} onClick={event=>viewDetails(job,event.currentTarget)}>{job.workNumber}</button>:column.key==="stage"?<span className="admin-job-status">{cell(job,column.key)}</span>:cell(job,column.key)}</td>)}</tr>)}</tbody>
      </table>{!loading&&!jobs.length&&<div className="admin-register-empty"><h2>No matching jobs</h2><p>Clear a filter or try a different search.</p></div>}
    </div>}
    <div className="admin-register-pagination"><span>Page {page}{!loading&&!error?' · '+jobs.length+' shown':''}</span><div>
      <button type="button" disabled={page===1||loading} onClick={()=>setPage(value=>value-1)}>Previous</button>
      <button type="button" disabled={!pagination.hasNext||loading||Boolean(error)} onClick={()=>setPage(value=>value+1)}>Next</button></div></div>
    <JobRowMenu menu={menu} onClose={closeMenu} />
    {selectedJob && <dialog ref={detailRef} className={styles.details} aria-labelledby="admin-job-detail-title" onCancel={event=>{event.preventDefault();closeDetails();}}>
      <header><div><span>Job details</span><h2 id="admin-job-detail-title">{selectedJob.workNumber}</h2></div><button type="button" onClick={closeDetails} autoFocus>Close</button></header>
      <dl>{columns.map(column=><div key={column.key}><dt>{column.label}</dt><dd>{cell(selectedJob,column.key)}</dd></div>)}</dl>
    </dialog>}
  </section>;
}
