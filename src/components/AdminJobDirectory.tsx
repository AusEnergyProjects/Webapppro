"use client";

import { useEffect, useState } from "react";

type Job = { id: string; workNumber: string; title: string; serviceCategory: string; stage: string; siteArea: string; scheduledStart: string; installerBusiness: string; customerName: string; updatedAt: string };

export function AdminJobDirectory({ api }: { api: (path: string, init?: RequestInit) => Promise<Record<string, unknown>> }) {
  const [query, setQuery] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true); setError("");
      void api(`/api/admin/jobs?q=${encodeURIComponent(query.trim())}`).then((result) => {
        if (active) setJobs(Array.isArray(result.jobs) ? result.jobs as Job[] : []);
      }).catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Jobs could not be loaded.");
      }).finally(() => { if (active) setLoading(false); });
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  }, [api, query]);

  return <section className="admin-workspace admin-job-directory">
    <header><div><span>Global job directory</span><h2>Jobs</h2><p>Search the same TLink job ID shown to the installer, or search by customer, installer or title.</p></div></header>
    <label className="admin-job-search"><span>Search all jobs</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="TLJ-X3KHTUEF, customer or installer" autoFocus /></label>
    {error && <p className="status-message error">{error}</p>}
    {loading ? <div className="admin-empty-state">Loading jobs...</div> : jobs.length ? <div className="admin-job-results"><div className="admin-job-result-head"><span>Job ID</span><span>Customer and work</span><span>Installer</span><span>Status</span></div>{jobs.map((job) => <article key={job.id}><strong>{job.workNumber}</strong><span><b>{job.customerName || "No customer linked"}</b><small>{job.title}{job.siteArea ? ` | ${job.siteArea}` : ""}</small></span><span>{job.installerBusiness}</span><span>{job.stage.replaceAll("_", " ")}</span></article>)}</div> : <div className="admin-empty-state">No jobs match this search.</div>}
  </section>;
}
