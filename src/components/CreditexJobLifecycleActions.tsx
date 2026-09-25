"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import styles from "./JobLifecycleActions.module.css";
import type { User } from "firebase/auth";
import type { loadJobLifecycle } from "@/lib/creditex-job-lifecycle-server";
type State=Awaited<ReturnType<typeof loadJobLifecycle>>;

type Props={user:User;intentId:string;onChanged:()=>void|Promise<void>;actorMode?:"creditex"|"admin"};
export function CreditexJobLifecycleActions(props:Props) {
  return <LifecycleActions key={`${props.user.uid}:${props.actorMode}:${props.intentId}`} {...props}/>;
}
function LifecycleActions({user,intentId,onChanged,actorMode="creditex"}:Props) {
  const endpoint=actorMode==="admin"?"/api/admin/compliance-job-lifecycle":"/api/creditex/job-lifecycle";
  const [state,setState]=useState<State|null>(null),[action,setAction]=useState(""),[note,setNote]=useState(""),[amount,setAmount]=useState(""),[reference,setReference]=useState(""),[paidOn,setPaidOn]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const inFlight=useRef(false),pending=useRef<{identity:string;body:string}|null>(null);
  const active=useRef(true),loadVersion=useRef(0);
  const fetchState=useCallback(async()=>{const response=await fetch(`${endpoint}?intentId=${encodeURIComponent(intentId)}`,{headers:{Authorization:`Bearer ${await user.getIdToken()}`},cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.error||"Job actions could not be loaded.");return data.state as State;},[endpoint,intentId,user]);
  useEffect(()=>{active.current=true;const version=++loadVersion.current;
    void fetchState().then(value=>{if(active.current&&loadVersion.current===version){setState(value);setError("");}})
      .catch(e=>{if(active.current&&loadVersion.current===version)setError(e instanceof Error?e.message:"Job actions could not be loaded.");});
    return()=>{active.current=false;};},[fetchState]);
  async function save(selectedAction=action,deliveryId?:string){if(!state||state.intentId!==intentId||inFlight.current)return;inFlight.current=true;setBusy(true);setError("");
    const body={intentId,action:selectedAction,deliveryId,note,amount,reference,paidOn,expectedRevision:state.revision,expectedCorrectionSourceSha256:state.correctionSourceSha256},identity=JSON.stringify(body);
    if(pending.current?.identity!==identity)pending.current={identity,body:JSON.stringify({...body,requestId:crypto.randomUUID()})};
    const requestBody=pending.current.body;
    try{const token=await user.getIdToken();if(!active.current)return;const response=await fetch(endpoint,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:requestBody});const data=await response.json();if(!active.current)return;if(!response.ok)throw new Error(data.error);setState(data.state);setAction("");setNote("");pending.current=null;await onChanged();}catch(e){if(active.current)setError(e instanceof Error?e.message:"The action could not be saved.");}finally{inFlight.current=false;if(active.current)setBusy(false);}}
  const labels:Record<string,string>={payout_recorded:"Record payout",cancelled:"Cancel job",deleted:"Move job to bin",restored:"Restore job",correction_required:"Correction required"};
  return <section className={styles.panel} aria-label="Job actions"><h3 className="font-semibold">Job actions</h3>
    {error&&<p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {state&&state.intentId===intentId&&<><div className="mt-3 flex flex-wrap gap-2">{[["payout_recorded",state.capabilities.canRecordPayout],["correction_required",state.capabilities.canRequestCorrection],["cancelled",state.capabilities.canCancel],["deleted",state.capabilities.canDelete],["restored",state.capabilities.canRestore]].filter(([,allowed])=>allowed).map(([key])=><button type="button" key={String(key)} onClick={()=>{setAction(String(key));setNote("");}} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">{labels[String(key)]}</button>)}</div>
      {state.paid&&<p className="mt-2 text-sm text-emerald-700">Creditex payout recorded.</p>}
      {state.notifications.map(n=><div key={n.id} className="mt-3 rounded-lg border border-slate-200 p-3 text-sm"><strong>Technician email: {n.status==="accepted"?"accepted by email provider":n.status}</strong><p>{n.recipient}</p>{n.error&&<p>{n.error}</p>}{n.status!=="accepted"&&<button type="button" disabled={busy} onClick={()=>void save("retry_notification",n.id)} className="mt-1 underline">Retry email</button>}</div>)}
      {action&&<div className="mt-3 space-y-3 rounded-lg bg-slate-50 p-3"><strong>{labels[action]}</strong>
        {["deleted","restored","cancelled"].includes(action)&&<p className="text-sm">This applies to the whole job and all its activities. Signed files and submission history are retained.</p>}
        {action==="correction_required"&&<p className="text-sm">Return the completed activities to the assigned technician with editable correction copies and an email.</p>}
        {action==="payout_recorded"&&<><p className="text-sm">Record a payment already made to <strong>{state.recipient}</strong>. This does not transfer funds.</p>
          <label className="block text-sm">Payout reference<input value={reference} onChange={e=>setReference(e.target.value)} className="mt-1 block w-full rounded border border-slate-300 bg-white p-2"/></label>
          <label className="block text-sm">Amount paid (AUD)<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} className="mt-1 block w-full rounded border border-slate-300 bg-white p-2"/></label>
          <label className="block text-sm">Date paid<input type="date" value={paidOn} onChange={e=>setPaidOn(e.target.value)} className="mt-1 block w-full rounded border border-slate-300 bg-white p-2"/></label></>}
        <label className="block text-sm">{action==="correction_required"?"What needs fixing":"Action note"}<textarea value={note} maxLength={2000} onChange={e=>setNote(e.target.value)} rows={3} className="mt-1 block w-full rounded border border-slate-300 bg-white p-2"/></label>
        <div className="flex gap-2"><button type="button" disabled={busy||!note.trim()} onClick={()=>void save()} className="rounded-lg bg-emerald-700 px-4 py-2 text-white disabled:opacity-50">{busy?"Saving…":labels[action]}</button><button type="button" disabled={busy} onClick={()=>setAction("")} className="rounded-lg border border-slate-300 px-3 py-2">Keep as is</button></div>
      </div>}
    </>}
  </section>;
}
