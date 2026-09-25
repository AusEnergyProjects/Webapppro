"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import styles from "./JobLifecycleActions.module.css";
import type { User } from "firebase/auth";
import type { loadTradeJobReview } from "@/lib/creditex-job-lifecycle-server";
type Review=Awaited<ReturnType<typeof loadTradeJobReview>>;

type Props={user:User;workOrderId:string;onChanged:()=>void|Promise<void>};
export function TradeJobReviewPanel(props:Props) {
  return <ReviewPanel key={`${props.user.uid}:${props.workOrderId}`} {...props}/>;
}
function ReviewPanel({user,workOrderId,onChanged}:Props) {
  const [state,setState]=useState<Review|null>(null),[note,setNote]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const inFlight=useRef(false),pending=useRef<{identity:string;body:string}|null>(null);
  const active=useRef(true),loadVersion=useRef(0);
  const fetchState=useCallback(async()=>{const response=await fetch(`/api/trade-job-review?workOrderId=${encodeURIComponent(workOrderId)}`,{headers:{Authorization:`Bearer ${await user.getIdToken()}`},cache:"no-store"});
    const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Review could not be loaded.");return payload.state as Review;
  },[user,workOrderId]);
  const load=useCallback(()=>{const version=++loadVersion.current;return fetchState().then(value=>{if(active.current&&loadVersion.current===version){setState(value);setError("");}})
    .catch(e=>{if(active.current&&loadVersion.current===version)setError(e instanceof Error?e.message:"Review could not be loaded.");});},[fetchState]);
  useEffect(()=>{active.current=true;const version=++loadVersion.current;
    void fetchState().then(value=>{if(active.current&&loadVersion.current===version){setState(value);setError("");}})
      .catch(e=>{if(active.current&&loadVersion.current===version)setError(e instanceof Error?e.message:"Review could not be loaded.");});
    return()=>{active.current=false;};},[fetchState]);
  async function act(action:string,deliveryId?:string){if(!state||state.workOrderId!==workOrderId||inFlight.current)return;inFlight.current=true;setBusy(true);setError("");setMessage("");
    const body={workOrderId,action,note,deliveryId,expectedRevision:state.revision,expectedSourceSha256:state.sourceSha256},identity=JSON.stringify(body);
    if(pending.current?.identity!==identity)pending.current={identity,body:JSON.stringify({...body,requestId:crypto.randomUUID()})};
    const requestBody=pending.current.body;
    try{const token=await user.getIdToken();if(!active.current)return;
      const response=await fetch("/api/trade-job-review",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:requestBody});
      const payload=await response.json();if(!active.current)return;if(!response.ok)throw new Error(payload.error||"Review could not be saved.");setState(payload.state);
      setMessage(action==="reviewed"?"Review passed. Ready for Creditex audit.":action==="correction_required"?"Returned to the technician with your notes. Check the email status below.":"Email status updated.");
      pending.current=null;await onChanged();
    }catch(e){if(active.current)setError(e instanceof Error?e.message:"Review could not be saved.");}finally{inFlight.current=false;if(active.current)setBusy(false);}}
  return <section className={styles.panel} aria-label="Business job review">
    <h3 className="font-semibold">Review this job</h3><p className="mt-1 text-sm text-slate-600">Check the files below, then pass the job or return it to the assigned technician.</p>
    {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{message&&<p role="status" className="mt-3 text-sm text-emerald-700">{message}</p>}
    {!state&&!error&&<p className="mt-3 text-sm">Loading review…</p>}
    {state&&state.workOrderId===workOrderId&&<><p className="mt-3 text-sm">{state.activities.length} activities · {state.activities.filter(a=>a.complete).length} complete{state.reviewed?" · Review passed":""}</p>
      {state.reason&&<p className="mt-2 text-sm text-slate-600">{state.reason}</p>}
      <label className="mt-3 block text-sm font-medium" htmlFor={`review-note-${workOrderId}`}>Notes <span className="font-normal">(required for corrections)</span></label>
      <textarea id={`review-note-${workOrderId}`} value={note} onChange={e=>setNote(e.target.value)} maxLength={2000} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 text-slate-900" placeholder="Explain what needs fixing so the technician can act on it."/>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy||!state.canReview||state.reviewed} onClick={()=>void act("reviewed")} className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy?"Saving…":"Pass"}</button>
      <button type="button" disabled={busy||!state.canReview||!note.trim()} onClick={()=>void act("correction_required")} className="rounded-lg border border-amber-600 bg-amber-50 px-4 py-2 font-semibold text-amber-900 disabled:opacity-50">Correction required</button>
      <button type="button" disabled={busy} onClick={()=>void load()} className="rounded-lg border border-slate-300 px-3 py-2">Refresh</button></div>
      {state.notifications.map(n=><div key={n.id} className="mt-3 rounded-lg border border-slate-200 p-3 text-sm"><strong>Technician email: {n.status==="accepted"?"accepted by email provider":n.status}</strong><p>{n.recipient}</p>{n.error&&<p className="text-amber-800">{n.error}</p>}{n.status!=="accepted"&&<button disabled={busy} type="button" className="mt-1 underline" onClick={()=>void act("retry_notification",n.id)}>Retry email</button>}</div>)}
      {state.history.filter(e=>["reviewed","correction_required"].includes(e.action)).slice(0,4).map(e=><p key={e.id} className="mt-3 text-sm text-slate-600">{e.action==="reviewed"?"Passed":"Correction required"}: {e.note}</p>)}
    </>}
  </section>;
}
