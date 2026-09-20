"use client";

import { useEffect, useState } from "react";
import { downloadWorkspaceCsv, WorkspaceTableTools } from "./WorkspaceTableTools";
import type { AdminJobRow } from "@/lib/admin-job-register";

const columns = [
  {key:"workNumber",label:"Job ID"}, {key:"customerName",label:"Customer"}, {key:"title",label:"Work"},
  {key:"installerBusiness",label:"Trade"}, {key:"serviceCategory",label:"Service"}, {key:"siteArea",label:"Location"},
  {key:"stage",label:"Status"}, {key:"scheduledStart",label:"Scheduled"}, {key:"updatedAt",label:"Updated"},
] as const;
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
  const [jobs,setJobs] = useState<AdminJobRow[]>([]);
  const [facets,setFacets] = useState<{stages:string[];services:string[];installers:string[]}>({stages:[],services:[],installers:[]});
  const [pagination,setPagination] = useState({total:0,pageSize:50,hasNext:false});
  const [visibleColumns,setVisibleColumns] = useState<string[]>(columns.map(column=>column.key));
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  function filter(key: keyof typeof filters,value:string) { setFilters(current=>({...current,[key]:value}));setPage(1); }
  useEffect(()=>{
    let active=true;
    const timer=window.setTimeout(()=>{
      setLoading(true);setError("");
      const params=new URLSearchParams({...filters,sort,page:String(page)});
      void api('/api/admin/jobs?'+params).then(result=>{
        if(!active)return;
        setJobs(Array.isArray(result.jobs)?result.jobs as AdminJobRow[]:[]);
        setPagination(result.pagination as typeof pagination);
        setFacets(result.facets as typeof facets);
      }).catch(cause=>{if(active){setJobs([]);setError(cause instanceof Error?cause.message:"Jobs could not be loaded.");}})
        .finally(()=>{if(active)setLoading(false);});
    },220);
    return()=>{active=false;window.clearTimeout(timer);};
  },[api,filters,sort,page,revision]);
  const selectedColumns=visibleColumns.map(key=>columns.find(column=>column.key===key)).filter((column): column is typeof columns[number]=>Boolean(column));
  function cell(job:AdminJobRow,key:Column) {
    if(key==="scheduledStart"||key==="updatedAt")return dateTime(job[key]);
    if(key==="stage"||key==="serviceCategory")return readable(job[key])||"Not set";
    return job[key]||"Not supplied";
  }
  return <section className="admin-job-directory">
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
    {error?<div className="admin-register-empty" role="alert"><h2>Jobs could not be loaded</h2><p>{error}</p><button type="button" onClick={()=>setRevision(value=>value+1)}>Try again</button></div>
      :<div className="admin-register-table" aria-busy={loading} tabIndex={0} aria-label="Scrollable jobs register"><table><caption className="sr-only">Jobs matching the selected filters</caption>
        <thead><tr>{selectedColumns.map(column=><th scope="col" key={column.key}>{column.label}</th>)}</tr></thead>
        <tbody>{!loading&&jobs.map(job=><tr key={job.id}>{selectedColumns.map(column=><td key={column.key}>{column.key==="workNumber"?<strong>{job.workNumber}</strong>:column.key==="stage"?<span className="admin-job-status">{cell(job,column.key)}</span>:cell(job,column.key)}</td>)}</tr>)}</tbody>
      </table>{!loading&&!jobs.length&&<div className="admin-register-empty"><h2>No matching jobs</h2><p>Clear a filter or try a different search.</p></div>}
    </div>}
    <div className="admin-register-pagination"><span>Page {page}{!loading&&!error?' · '+jobs.length+' shown':''}</span><div>
      <button type="button" disabled={page===1||loading} onClick={()=>setPage(value=>value-1)}>Previous</button>
      <button type="button" disabled={!pagination.hasNext||loading||Boolean(error)} onClick={()=>setPage(value=>value+1)}>Next</button></div></div>
  </section>;
}
