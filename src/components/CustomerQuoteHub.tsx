"use client";
import {useCallback,useEffect,useRef,useState,type ComponentProps} from "react";
import type {CustomerQuoteHub as Hub,HubQuestion,HubBusinessProfile} from "@/lib/customer-quote-hub";
import {prepareCustomerPhotoUpload} from "@/lib/customer-photo-upload";
import {QuoteLinkReview,QuoteDecisionReceiptView} from "./QuoteLinkReview";
import styles from "./CustomerQuoteHub.module.css";
import type {CustomerHubBusinessRating} from "@/lib/customer-hub-business-profile";

type Receipt=ComponentProps<typeof QuoteDecisionReceiptView>["receipt"];
type Result={ok?:boolean;hub?:Hub;quoteToken?:string;receipt?:Receipt;error?:string};
type Tab='overview'|'quotes'|'requests';
export function CustomerQuoteHub({token}:{token:string}){return <HubWorkspace key={token} token={token}/>;}
function HubWorkspace({token}:{token:string}){
  const endpoint=`/api/customer-hub/${encodeURIComponent(token)}`;
  const [hub,setHub]=useState<Hub|null>(null),[tab,setTab]=useState<Tab>('overview'),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState('');
  const [service,setService]=useState(''),[drafts,setDrafts]=useState<Record<string,string>>({}),[pending,setPending]=useState<Record<string,File>>({}),[capture,setCapture]=useState(false);
  const [newQuestion,setNewQuestion]=useState(''),[replies,setReplies]=useState<Record<string,string>>({});
  const [ratings,setRatings]=useState<Record<string,CustomerHubBusinessRating>>({});
  const requestedRatings=useRef(new Set<string>());
  const [opened,setOpened]=useState<{id:string;token?:string;receipt?:Receipt}|null>(null);
  const generation=useRef(0),active=useRef(true),acting=useRef(false);
  const applyHub=useCallback((next:Hub)=>{setHub(next);setOpened(current=>current&&next.quotes.some(quote=>quote.id===current.id)?current:null);},[]);
  const load=useCallback(async()=>{
    if(acting.current)return;
    const request=++generation.current;
    try{const response=await fetch(endpoint,{cache:'no-store'}),result=await response.json() as Result;
      if(!active.current||request!==generation.current)return;
      if(!response.ok||!result.ok||!result.hub)throw new Error(result.error||'Your project could not be opened.');applyHub(result.hub);setError('');
    }catch(failure){if(!active.current||request!==generation.current)return;setHub(null);setOpened(null);setError(failure instanceof Error?failure.message:'Your project could not be opened.');}
  },[endpoint,applyHub]);
  useEffect(()=>{
    active.current=true;
    const refresh=()=>void load(),media=window.matchMedia('(pointer: coarse)'),updateCapture=()=>setCapture(media.matches);
    const frame=window.requestAnimationFrame(()=>{updateCapture();if(new URLSearchParams(window.location.search).get('section')==='qa')setTab('requests');});
    refresh();window.addEventListener('focus',refresh);media.addEventListener('change',updateCapture);
    return()=>{active.current=false;window.cancelAnimationFrame(frame);window.removeEventListener('focus',refresh);media.removeEventListener('change',updateCapture);};
  },[load]);
  useEffect(()=>{
    if(!hub)return;
    const profiles=[...hub.quotes.map(q=>q.businessProfile),...hub.questions.flatMap(q=>[q.businessProfile,...(q.replies||[]).map(r=>r.businessProfile)])];
    for(const profile of profiles){
      if(!profile?.googleProfileUrl)continue;
      const key=profile.id+'|'+profile.googleProfileUrl;
      if(requestedRatings.current.has(key))continue;
      requestedRatings.current.add(key);
      void fetch(endpoint+'/businesses/'+encodeURIComponent(profile.id),{cache:'no-store'}).then(async response=>{
        const result=await response.json();
        if(active.current)setRatings(current=>({...current,[key]:response.ok&&result.ok?result.rating:{status:'unavailable'}}));
      }).catch(()=>{if(active.current)setRatings(current=>({...current,[key]:{status:'unavailable'}}));});
    }
  },[hub,endpoint]);
  function business(name:string,profile?:HubBusinessProfile){
    const rating=profile?ratings[profile.id+'|'+profile.googleProfileUrl]:undefined;
    return <span className={styles.businessIdentity}>
      {profile?.websiteUrl?<a href={profile.websiteUrl} target="_blank" rel="noopener noreferrer">{name}</a>:<span>{name}</span>}
      {profile?.googleProfileUrl&&<span className={styles.googleRating}>
        <a href={rating?.status==='available'?rating.googleMapsUrl:profile.googleProfileUrl} target="_blank" rel="noopener noreferrer">
          {rating?.status==='available'?<>★ {rating.rating.toFixed(1)} · {rating.reviewCount.toLocaleString('en-AU')} {rating.reviewCount===1?'review':'reviews'} <span translate="no">Google Maps</span></>:rating?'Google rating unavailable · View reviews':'Loading Google rating…'}
        </a>
        {rating?.status==='available'&&rating.attributions.map((item,index)=><a key={index} href={item.url} target="_blank" rel="noopener noreferrer">{item.name}</a>)}
      </span>}
    </span>;
  }
  async function shareConversation(questionId=''){
    const value=questionId?replies[questionId]||'':newQuestion;
    if(!begin(questionId||'new-question'))return;
    try{await update('POST',questionId?{action:'reply',questionId,body:value}:{action:'ask',prompt:value});
      if(questionId)setReplies(current=>({...current,[questionId]:''}));else setNewQuestion('');setNotice('Shared in Customer Q&A. Interested businesses have an update to review.');
    }catch(failure){setNotice(failure instanceof Error?failure.message:'Could not share.');}finally{finish();void load();}
  }
  function begin(id:string){if(acting.current)return false;acting.current=true;++generation.current;setBusy(id);setNotice('');return true;}
  function finish(){acting.current=false;if(active.current)setBusy('');}
  async function update(method:string,body:object|FormData,path=''){
    const response=await fetch(`${endpoint}${path}`,{method,...(body instanceof FormData?{body}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    const result=await response.json() as Result;if(!response.ok||!result.ok||!result.hub){if(response.status===404&&active.current){setHub(null);setOpened(null);setError(result.error||'Your link is unavailable.');}throw new Error(result.error||'Your change could not be saved.');}if(active.current)applyHub(result.hub);return result;
  }
  async function toggle(){if(!hub||!begin('toggle'))return;try{await update('PATCH',{accepting:!hub.accepting,revision:hub.revision});setNotice(hub.accepting?'Quotes and questions are now closed. Your existing records are still here.':'Quotes and questions are open again.');}catch(failure){setNotice(failure instanceof Error?failure.message:'Could not save.');}finally{finish();void load();}}
  async function answer(question:HubQuestion){if(!begin(question.id))return;try{await update('POST',{questionId:question.id,answer:drafts[question.id]??question.answer,revision:question.revision});setDrafts(current=>{const next={...current};delete next[question.id];return next;});setNotice('Answer shared with the participating businesses.');}catch(failure){setNotice(failure instanceof Error?failure.message:'Could not share.');}finally{finish();void load();}}
  async function upload(question:HubQuestion){const selected=pending[question.id];if(!selected||!begin(question.id))return;try{
    const file=selected.type.startsWith('image/')?await prepareCustomerPhotoUpload(selected,question.id):selected;
    const form=new FormData();form.append('questionId',question.id);form.append('file',file);await update('POST',form,'/files');
    setPending(current=>{const next={...current};delete next[question.id];return next;});setNotice('File shared. The participating businesses have an update to review.');
  }catch(failure){setNotice(failure instanceof Error&&failure.message==='PHOTO_CONVERSION_FAILED'?'This photo could not be opened. Try a JPG or PNG, or take another photo.':failure instanceof Error?failure.message:'Could not upload.');}finally{finish();void load();}}
  async function openQuote(id:string){if(!begin(id))return;try{const response=await fetch(`${endpoint}/quotes/${encodeURIComponent(id)}`,{cache:'no-store'}),result=await response.json() as Result;
    if(!response.ok||!result.ok||(!result.quoteToken&&!result.receipt))throw new Error(result.error||'The quote could not be opened.');if(active.current)setOpened({id,token:result.quoteToken,receipt:result.receipt});
  }catch(failure){setNotice(failure instanceof Error?failure.message:'Could not open quote.');}finally{finish();}}
  const outstanding=hub?.questions.filter(q=>q.authorType!=='customer'&&(q.kind==='text'?!q.answer:!q.files.length))||[];
  return <main id="site-content" className={styles.shell}><div className={styles.container}>
    <div className={styles.brand}><strong>TLink<span>●</span></strong><span>Your private project</span></div>
    {!hub?<section className={styles.panel}><h1>{error?'Your link is unavailable':'Opening your project'}</h1><p role={error?'alert':undefined}>{error||'Checking your private link…'}</p>{error&&<button onClick={()=>void load()}>Try again</button>}</section>:<>
      <header className={styles.header}><div><h1>{hub.title}</h1><p>One place for all {hub.services.length>1?`${hub.services.length} services`:'your quotes and requests'}.</p></div>
        <div className={styles.switchBox}><span id="hub-accepting-label">Accepting quotes and questions</span><button type="button" role="switch" aria-checked={hub.accepting} aria-labelledby="hub-accepting-label" disabled={Boolean(busy)} onClick={()=>void toggle()} className={styles.switch}><i/>{hub.accepting?'On':'Off'}</button></div>
      </header>
      <nav className={styles.nav} aria-label="Project"><button aria-current={tab==='overview'?'page':undefined} onClick={()=>setTab('overview')}>Overview</button><button aria-current={tab==='quotes'?'page':undefined} onClick={()=>setTab('quotes')}>Quotes <span>{hub.quotes.length}</span></button><button aria-current={tab==='requests'?'page':undefined} onClick={()=>setTab('requests')}>Q&A {outstanding.length>0&&<span>{outstanding.length}</span>}</button></nav>
      {notice&&<p className={styles.notice} role="status">{notice}</p>}
      {!hub.accepting&&<p className={styles.closed}>New quotes and questions are paused. Turn the switch on whenever you are ready.</p>}
      {opened&&<div hidden={tab!=='quotes'}><button className={styles.back} onClick={()=>setOpened(null)}>← Back to all quotes</button>
        {opened.token?<QuoteLinkReview key={opened.id} token={opened.token} embedded onDecisionRecorded={()=>void load()}/>:opened.receipt?<QuoteDecisionReceiptView receipt={opened.receipt} embedded receiptPdfUrl={`${endpoint}/quotes/${opened.id}/receipt`}/>:null}
      </div>}
      {tab==='overview'?<>
        <section className={styles.next}><small>{outstanding.length&&hub.accepting?'Needs your attention':'Your project at a glance'}</small><h2>{outstanding.length&&hub.accepting?outstanding[0].prompt:hub.quotes.length?'Your quotes are together here':'You’re ready for the next step'}</h2>
          <p>{outstanding.length&&hub.accepting?'Share it once. The businesses quoting on your project can use the same answer or file.':hub.quotes.length?'Open any quote to review its work, price and terms. You stay in control of when to close enquiries.':'New quotes and requests will appear here. There is no need to enter your details again.'}</p>
          {(hub.quotes.length>0||outstanding.length>0)&&<button onClick={()=>setTab(outstanding.length&&hub.accepting?'requests':'quotes')}>{outstanding.length&&hub.accepting?'View requests':'View quotes'}</button>}
        </section><div className={styles.summary}><button onClick={()=>setTab('quotes')}><strong>{hub.quotes.length}</strong><span>Quotes received</span></button><button onClick={()=>setTab('requests')}><strong>{outstanding.length}</strong><span>Requests to answer</span></button></div>
        <details className={styles.services}><summary>{hub.services.length} selected {hub.services.length===1?'service':'services'}</summary><p>{hub.services.map(s=>s.label).join(' · ')}</p></details>
      </>:tab==='quotes'?!opened&&<section aria-label="Your quotes">
        {hub.services.length>1&&<label className={styles.filter}>Show <select value={service} onChange={event=>setService(event.target.value)}><option value="">All services</option>{hub.services.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>}
        {!hub.quotes.length&&<div className={styles.panel}><h2>No quotes yet</h2><p>Quotes from your invited businesses will appear here. You will still receive each quote and PDF by email.</p></div>}
        <div className={styles.quoteList}>{hub.quotes.filter(q=>!service||q.services.includes(service)).map(quote=><article key={quote.id} className={styles.quote}><div><small>{quote.number} · {quote.status==='active'?(quote.blocked?'Expired':'Ready to review'):quote.status}</small><h2>{business(quote.business,quote.businessProfile)}</h2><p>Enquiry: {quote.services.map(id=>hub.services.find(s=>s.id===id)?.label||id).join(', ')}</p></div><div className={styles.quoteAction}><strong>{new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(quote.totalCents/100)}</strong><small>See quote for options and final total</small>{quote.blocked?<a href={`${endpoint}/quotes/${quote.id}/pdf`}>View PDF</a>:<button disabled={Boolean(busy)} onClick={()=>void openQuote(quote.id)}>{busy===quote.id?'Opening…':'Open quote'}</button>}</div></article>)}</div>
      </section>:<section aria-label="Customer Q&A"><div className={styles.intro}><h2>Answer once, keep everyone up to date</h2><p>Answers and files here are shared with the approved businesses invited to this project. Questions about one business’s price or terms stay inside its quote.</p></div>
        {hub.accepting&&<details className={styles.request}><summary>Ask a question</summary><div className={styles.answer}>
          <label htmlFor="hub-new-question">What would you like the businesses to clarify?</label><textarea id="hub-new-question" rows={2} maxLength={500} value={newQuestion} onChange={event=>setNewQuestion(event.target.value)}/>
          <button disabled={Boolean(busy)||newQuestion.trim().length<5} onClick={()=>void shareConversation()}>Share question</button>
        </div></details>}
        {!hub.questions.length&&<div className={styles.panel}><h2>No requests yet</h2><p>You are up to date. New requests will appear here.</p></div>}
        {hub.questions.map(question=><details className={styles.request} key={question.id} open={outstanding.some(q=>q.id===question.id)||undefined}><summary><span>{question.prompt}</span><small>{question.authorType==='customer'?((question.replies||[]).length?'Replies received':'Awaiting a reply'):question.kind==='text'?(question.answer?'Answered':'Answer needed'):(question.files.length?'File shared':'File needed')}</small></summary><div className={styles.byline}>{question.authorType==='customer'?'Asked by you':<>Asked by {business(question.business,question.businessProfile)}</>} · Shared with participating businesses</div>
          {question.answer&&<p><strong>Your answer</strong><br/>{question.answer}</p>}
          {(question.replies||[]).map(reply=><div className={styles.reply} key={reply.id}><small>{reply.authorType==='customer'?'You':business(reply.business||'Trade business',reply.businessProfile)}</small><p>{reply.body}</p></div>)}
          {hub.accepting&&<details className={styles.replyComposer}><summary>Reply to this conversation</summary><div className={styles.answer}><label htmlFor={'reply-'+question.id}>Your reply</label><textarea id={'reply-'+question.id} rows={2} maxLength={2000} value={replies[question.id]||''} onChange={event=>setReplies({...replies,[question.id]:event.target.value})}/><button disabled={Boolean(busy)||!replies[question.id]?.trim()} onClick={()=>void shareConversation(question.id)}>Share reply</button></div></details>}
          {question.files.length>0&&<ul className={styles.files}>{question.files.map(file=><li key={file.id}><a href={`${endpoint}/files?id=${encodeURIComponent(file.id)}`}>{file.name}</a></li>)}</ul>}
          {hub.accepting&&question.authorType!=='customer'&&(question.kind==='text'?<div className={styles.answer}><label htmlFor={`answer-${question.id}`}>Your answer</label><textarea id={`answer-${question.id}`} maxLength={2000} rows={3} value={drafts[question.id]??question.answer} onChange={event=>setDrafts({...drafts,[question.id]:event.target.value})}/><button disabled={Boolean(busy)||!(drafts[question.id]??question.answer).trim()} onClick={()=>void answer(question)}>{busy===question.id?'Sharing…':'Share answer'}</button></div>:<div className={styles.upload}>
            <div className={styles.uploadActions}>{capture&&<label className={styles.fileButton}>Capture photo<input type="file" accept="image/*" capture="environment" disabled={Boolean(busy)} onChange={event=>{const file=event.target.files?.[0];if(file)setPending({...pending,[question.id]:file});event.target.value='';}}/></label>}<label className={styles.fileButton}>Upload {question.kind==='photo'?'photo':'file'}<input type="file" accept={question.kind==='photo'?'image/jpeg,image/png,image/webp':'image/jpeg,image/png,image/webp,application/pdf'} disabled={Boolean(busy)} onChange={event=>{const file=event.target.files?.[0];if(file)setPending({...pending,[question.id]:file});event.target.value='';}}/></label></div>
            <small>{question.kind==='photo'?'Photos':'Photos or PDFs'} up to 8 MB. Check that private information is not visible.</small>
            {pending[question.id]&&<div className={styles.pending}><span>{pending[question.id].name}</span><button disabled={Boolean(busy)} onClick={()=>void upload(question)}>{busy===question.id?'Sharing…':'Share file'}</button></div>}
          </div>)}
        </details>)}
      </section>}
      <footer className={styles.footer}><span>{hub.reference}</span><span>Keep this link private · <a href="/privacy">Privacy</a></span></footer>
    </>}
  </div></main>;
}
