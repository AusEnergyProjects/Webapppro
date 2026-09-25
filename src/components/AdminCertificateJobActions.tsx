"use client";
import {useEffect,useState} from "react";
import type {User} from "firebase/auth";
import {CreditexJobLifecycleActions} from "./CreditexJobLifecycleActions";
type Api=(path:string,init?:RequestInit)=>Promise<Record<string,unknown>>;
type Activity={intentId:string;label:string};
export function AdminCertificateJobActions({user,workOrderId,api,onChanged}:{user:User;workOrderId:string;api:Api;onChanged:()=>void|Promise<void>}) {
  return <CertificateActions key={`${user.uid}:${workOrderId}`} user={user} workOrderId={workOrderId} api={api} onChanged={onChanged}/>;
}
function CertificateActions({user,workOrderId,api,onChanged}:{user:User;workOrderId:string;api:Api;onChanged:()=>void|Promise<void>}) {
  const [activities,setActivities]=useState<Activity[]|null>(null),[selected,setSelected]=useState(""),[error,setError]=useState("");
  useEffect(()=>{let active=true;void api(`/api/admin/compliance-job-lifecycle?workOrderId=${encodeURIComponent(workOrderId)}`)
    .then(result=>{if(active){const rows=Array.isArray(result.activities)?result.activities as Activity[]:[];setActivities(rows);setSelected(rows[0]?.intentId||"");}})
    .catch(e=>{if(active)setError(e instanceof Error?e.message:"Certificate job actions could not be loaded.");});return()=>{active=false;};},[api,workOrderId]);
  if(error)return <p role="alert">{error}</p>;
  if(!activities)return <p role="status">Loading certificate job actions…</p>;
  if(!activities.length)return null;
  return <section aria-label="Certificate job management">
    {activities.length>1&&<label>Certificate activity<select value={selected} onChange={e=>setSelected(e.target.value)}>{activities.map(activity=><option key={activity.intentId} value={activity.intentId}>{activity.label}</option>)}</select></label>}
    <CreditexJobLifecycleActions user={user} intentId={selected} actorMode="admin" onChanged={onChanged}/>
  </section>;
}
