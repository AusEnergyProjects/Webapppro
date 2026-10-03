"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {useTradeBusiness,useTradeBusinessFetch} from './TradeBusinessProvider';
import type {HubQuestion} from '@/lib/customer-quote-hub';
type Result={ok?:boolean;available?:boolean;accepting?:boolean;canAsk?:boolean;questions?:HubQuestion[];error?:string};
export function TradeCustomerHubPanel({workOrderId}:{workOrderId:string}){const business=useTradeBusiness();return <Panel key={`${business?.ownerUid||''}:${workOrderId}`} workOrderId={workOrderId}/>;}
function Panel({workOrderId}:{workOrderId:string}){
  const request=useTradeBusinessFetch(),[data,setData]=useState<Result|null>(null),[prompt,setPrompt]=useState(''),[kind,setKind]=useState('text'),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const endpoint=`/api/trade-customer-hub?workOrderId=${encodeURIComponent(workOrderId)}`;
  const generation=useRef(0),active=useRef(true),acting=useRef(false);
  const load=useCallback(async()=>{if(acting.current)return;const current=++generation.current;try{
    const response=await request(endpoint,{cache:'no-store'}),result=await response.json() as Result;if(!active.current||current!==generation.current)return;
    if(!response.ok||!result.ok)throw new Error(result.error||'Shared requests could not be opened.');setData(result);
  }catch(error){if(!active.current||current!==generation.current)return;setData(null);setMessage(error instanceof Error?error.message:'Shared requests could not be opened.');}},[request,endpoint]);
  useEffect(()=>{active.current=true;const refresh=()=>void load();refresh();window.addEventListener('focus',refresh);return()=>{active.current=false;window.removeEventListener('focus',refresh);};},[load]);
  async function ask(){if(acting.current)return;acting.current=true;++generation.current;setBusy(true);setMessage('');try{const response=await request('/api/trade-customer-hub',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workOrderId,prompt,kind})}),result=await response.json() as Result;
    if(!active.current)return;if(!response.ok||!result.ok)throw new Error(result.error||'The request could not be shared.');setData(result);setPrompt('');setMessage('Request added to the customer’s project.');}catch(error){if(active.current)setMessage(error instanceof Error?error.message:'Could not add request.');}finally{acting.current=false;if(active.current){setBusy(false);void load();}}}
  async function download(id:string,name:string){setBusy(true);try{const response=await request(`${endpoint}&fileId=${encodeURIComponent(id)}`);if(!response.ok)throw new Error('This shared file is no longer available.');const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=name;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){setMessage(error instanceof Error?error.message:'Could not download.');}finally{setBusy(false);}}
  if(!data?.available)return message?<p role="status">{message}</p>:null;
  return <details className="trade-quote-customer-message" style={{margin:'16px 0',padding:16,border:'1px solid var(--trade-line, #cadbd5)',borderRadius:12}}><summary style={{cursor:'pointer',minHeight:44}}>Shared customer requests {data.questions?.length?`(${data.questions.length})`:''}</summary>
    <p>Check existing answers before asking. These requests are shared across the customer’s project; your quote and pricing stay private.</p>
    {!data.accepting&&<p role="status"><strong>The customer is no longer accepting quotes or questions.</strong> Existing records remain available.</p>}
    {data.questions?.map(question=><article key={question.id} style={{borderTop:'1px solid var(--trade-line, #cadbd5)',padding:'14px 0'}}><strong>{question.prompt}</strong><p>{question.answer|| (question.files.length?'Files shared by customer':'Awaiting customer')}</p>{question.files.map(file=><button key={file.id} disabled={busy} onClick={()=>void download(file.id,file.name)}>{file.name}</button>)}</article>)}
    {data.accepting&&data.canAsk&&<div style={{display:'grid',gap:10}}><label>What do you need? <select value={kind} onChange={event=>setKind(event.target.value)}><option value="text">An answer</option><option value="photo">A photo</option><option value="document">A document</option></select></label><label>Request<textarea maxLength={500} rows={2} value={prompt} onChange={event=>setPrompt(event.target.value)} placeholder="For example: Please share a clear photo of the switchboard."/></label><button disabled={busy||prompt.trim().length<5} onClick={()=>void ask()}>{busy?'Adding…':'Ask customer'}</button></div>}
    {message&&<p role="status">{message}</p>}
  </details>;
}
