"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { GoogleAuthProvider, createUserWithEmailAndPassword, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signOut, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import type { CouncilAccessScope } from "@/lib/council-access-server";
import type { CouncilCampaign, CouncilCampaignInput } from "@/lib/council-campaigns";
import { parseCouncilCampaignInput } from "@/lib/council-campaigns";
import { COUNCIL_DEMO_STORAGE_KEY, councilDemoReport, createCouncilDemoState, readCouncilDemoState, type CouncilDemoState } from "@/lib/council-demo-state";
import { parseCouncilProfileInput, type CouncilProfile, type CouncilProfileInput } from "@/lib/council-profile";
import type { CouncilPeriodKey, CouncilReport } from "@/lib/council-reporting";
import { councilReportCsv } from "@/lib/council-report-export";
import { FirebaseAccountSecurity, FirebaseMfaChallenge, useFirebaseMfaChallenge } from "./FirebaseMfa";
import { CouncilWorkspace } from "./council/CouncilWorkspace";
import { CouncilMap } from "./council/CouncilMap";
import { CouncilRebateCalculator } from "./council/CouncilRebateCalculator";
import { CouncilAdministration } from "./CouncilAdministration";
import { TLinkBrand } from "./TLinkChrome";
import { TLinkWorkspaceBar } from "./TLinkWorkspaceBar";
import { CouncilTeam } from "./council/CouncilTeam";
import { createCouncilDemoTeam } from "@/lib/council-team";
import { CouncilCommunity, type CouncilCommunityState } from "./council/CouncilCommunity";
import { COMMUNITY_METRICS, type CommunityPeriodKey, type CouncilCommunityReport } from "@/lib/council-community";
import { councilDate } from "./council/CouncilPrimitives";
import { CouncilVeu, type CouncilVeuState } from "./council/CouncilVeu";
import type { CouncilVeuReport } from "@/lib/council-veu";
import styles from "./CouncilPortal.module.css";

type AccessResponse = { ok: true; councils: CouncilAccessScope[]; canProvision: boolean; adminMfaRequired?: boolean };
export type CouncilApi = <T>(path: string, init?: RequestInit) => Promise<T>;
export function CouncilPortal({ demonstration = false, demoAsOf }: { demonstration?: boolean; demoAsOf?: string }) {
  const [initialDemo] = useState(() => createCouncilDemoState(demoAsOf ? new Date(demoAsOf) : new Date()));
  const demoState = useRef(initialDemo);
  const [user,setUser] = useState<User | null>(null);
  const [authReady,setAuthReady] = useState(demonstration);
  const [access,setAccess] = useState<AccessResponse | null>(null);
  const [selected,setSelected] = useState("");
  const selectedCouncil = useRef("");
  const [period,setPeriod] = useState<CouncilPeriodKey>("year");
  const [report,setReport] = useState<CouncilReport | null>(() => demonstration ? councilDemoReport(initialDemo,new Date(initialDemo.profile.updatedAt)) : null);
  const [profile,setProfile] = useState<CouncilProfile | null>(() => demonstration ? initialDemo.profile : null);
  const [campaigns,setCampaigns] = useState<CouncilCampaign[]>(() => demonstration ? initialDemo.campaigns : []);
  const [loading,setLoading] = useState(!demonstration);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");
  const [register,setRegister] = useState(false);
  const [busy,setBusy] = useState(false);
  const [adminOpen,setAdminOpen] = useState(false);
  const [security,setSecurity] = useState(false);
  const [refresh,setRefresh] = useState(0);
  const [demoTeam,setDemoTeam] = useState(createCouncilDemoTeam);
  const [communityPeriod,setCommunityPeriod] = useState<CommunityPeriodKey>("year");
  const [communityState,setCommunityState] = useState<CouncilCommunityState>({report:null,loading:true,error:""});
  const [communityRefresh,setCommunityRefresh] = useState(0);
  const [veuState,setVeuState] = useState<CouncilVeuState>({report:null,loading:true,error:""});
  const generation = useRef(0);
  const {resolver,captureMfaError,clearMfaChallenge} = useFirebaseMfaChallenge();

  const selectCouncil = useCallback((id: string) => {
    if (selectedCouncil.current === id) return;
    selectedCouncil.current = id; generation.current++; setSelected(id);
  },[]);

  const applyDemo = useCallback((next: CouncilDemoState, persist = true) => {
    demoState.current = next;
    setProfile(next.profile); setCampaigns(next.campaigns); setPeriod(next.period); setReport(councilDemoReport(next));
    if (persist) {
      try { window.localStorage.setItem(COUNCIL_DEMO_STORAGE_KEY,JSON.stringify(next)); return true; }
      catch { return false; }
    }
    return true;
  },[]);

  useEffect(() => {
    if (!demonstration) return;
    const frame = requestAnimationFrame(() => {
      try { const restored = readCouncilDemoState(window.localStorage.getItem(COUNCIL_DEMO_STORAGE_KEY)); if (restored) applyDemo(restored,false); }
      catch { /* Practice controls still work when browser storage is unavailable. */ }
    });
    return () => cancelAnimationFrame(frame);
  },[demonstration,applyDemo]);

  const api = useCallback<CouncilApi>(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const activeUser = firebaseAuth.currentUser;
    if (!activeUser) throw new Error("Sign in to your council account to continue.");
    const headers = new Headers(init?.headers);
    headers.set("Authorization",`Bearer ${await activeUser.getIdToken()}`);
    if (init?.body) headers.set("Content-Type","application/json");
    const response = await fetch(path,{...init,headers,cache:"no-store"});
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "The request could not be completed.");
    }
    return result as T;
  },[]);

  const areaKey = profile?.postcodes.join(",") ?? "";
  const communityCouncilId = profile?.councilId ?? "";
  useEffect(() => {
    if (!communityCouncilId || !areaKey) return;
    let disposed = false;
    const frame = requestAnimationFrame(() => setCommunityState({report:null,loading:true,error:""}));
    const query = demonstration ? `postcodes=${encodeURIComponent(areaKey)}` : `councilId=${encodeURIComponent(communityCouncilId)}`;
    const path = `/api/council/community${demonstration ? "/demo" : ""}?${query}&period=${communityPeriod}`;
    const request = demonstration ? fetch(path,{cache:"no-store"}).then(async response => {
      const data: {ok:boolean;report:CouncilCommunityReport;error?:string} = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Official community data could not be loaded.");
      return data;
    }) : api<{report:CouncilCommunityReport}>(path);
    request.then(data => { if (!disposed) { cancelAnimationFrame(frame);setCommunityState({report:data.report,loading:false,error:""}); } }).catch(caught => {
      if (!disposed) { cancelAnimationFrame(frame);setCommunityState({report:null,loading:false,error:caught instanceof Error ? caught.message : "Official community data could not be loaded."}); }
    });
    return () => { disposed=true;cancelAnimationFrame(frame); };
  },[api,demonstration,communityCouncilId,areaKey,communityPeriod,communityRefresh,refresh]);

  useEffect(() => {
    if (!communityCouncilId || !areaKey) return;
    let disposed = false;
    const frame = requestAnimationFrame(() => setVeuState({report:null,loading:true,error:""}));
    const query = demonstration ? `postcodes=${encodeURIComponent(areaKey)}` : `councilId=${encodeURIComponent(communityCouncilId)}`;
    const path = `/api/council/veu${demonstration ? "/demo" : ""}?${query}&period=${period}`;
    const request = demonstration ? fetch(path,{cache:"no-store"}).then(async response => {
      const data: {ok:boolean;report:CouncilVeuReport;error?:string} = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Public upgrade data could not be loaded.");
      return data;
    }) : api<{report:CouncilVeuReport}>(path);
    request.then(data => {if(!disposed){cancelAnimationFrame(frame);setVeuState({report:data.report,loading:false,error:""});}}).catch(caught=>{
      if(!disposed){cancelAnimationFrame(frame);setVeuState({report:null,loading:false,error:caught instanceof Error?caught.message:"Public upgrade data could not be loaded."});}
    });
    return ()=>{disposed=true;cancelAnimationFrame(frame);};
  },[api,demonstration,communityCouncilId,areaKey,period,communityRefresh,refresh]);

  useEffect(() => {
    if (demonstration) return;
    return onAuthStateChanged(firebaseAuth, next => {
      generation.current++;
      setUser(next); setAuthReady(true); setAccess(null); setReport(null); setProfile(null); setCampaigns([]); selectCouncil(""); setError(""); setLoading(Boolean(next));
    });
  },[demonstration,selectCouncil]);

  useEffect(() => {
    if (demonstration || !user) return;
    let disposed = false;
    api<AccessResponse>("/api/council/access").then(result => {
      if (disposed) return;
      setAccess(result); selectCouncil(result.councils.some(council => council.id === selectedCouncil.current) ? selectedCouncil.current : result.councils[0]?.id || "");
      if (!result.councils.length) setLoading(false);
    }).catch(caught => { if (!disposed) { generation.current++; selectCouncil(""); setAccess(null); setReport(null); setProfile(null); setCampaigns([]); setLoading(false); setError(caught instanceof Error ? caught.message : "Access could not be checked."); } });
    return () => { disposed = true; };
  },[api,demonstration,user,refresh,selectCouncil]);

  useEffect(() => {
    if (demonstration || !user || !selected) return;
    let disposed = false;
    const requestGeneration = ++generation.current;
    const frame = requestAnimationFrame(() => {
      setLoading(true);
      setReport(current => current?.scope.councilId === selected ? current : null);
      setError("");
    });
    const councilId = encodeURIComponent(selected);
    Promise.all([
      api<{report:CouncilReport}>(`/api/council/report?councilId=${councilId}&period=${period}`),
      api<{campaigns:CouncilCampaign[]}>(`/api/council/campaigns?councilId=${councilId}`),
      api<{profile:CouncilProfile}>(`/api/council/profile?councilId=${councilId}`),
    ]).then(([data,management,settings]) => {
      if (disposed || requestGeneration !== generation.current) return;
      cancelAnimationFrame(frame);
      setError("");
      setReport(data.report); setCampaigns(management.campaigns); setProfile(settings.profile); setLoading(false);
    }).catch(caught => {
      if (disposed || requestGeneration !== generation.current) return;
      cancelAnimationFrame(frame);
      setReport(null); setProfile(null); setCampaigns([]); setLoading(false); setError(caught instanceof Error ? caught.message : "The workspace could not be loaded.");
    });
    return () => { cancelAnimationFrame(frame); disposed = true; };
  },[api,demonstration,user,selected,period,refresh]);

  async function authenticate(event?: FormEvent, google=false) {
    event?.preventDefault(); if (busy) return;
    setBusy(true);setError("");setNotice("");
    try {
      if (google) await signInWithPopup(firebaseAuth,new GoogleAuthProvider());
      else if (register) {
        const credential = await createUserWithEmailAndPassword(firebaseAuth,email.trim(),password);
        await sendEmailVerification(credential.user);
        setNotice("Check your email to verify your account, then refresh access. Only an approved council invitation grants workspace access.");
      } else await signInWithEmailAndPassword(firebaseAuth,email.trim(),password);
      setPassword("");
    } catch(caught) {
      if (!captureMfaError(caught)) setError(register ? "The account could not be created. Check your email and password, or sign in if you already have an account." : "Sign-in was not completed. Check your details or try again.");
    } finally {setBusy(false);}
  }
  async function resetPassword() {
    if (!email.trim()) {setError("Enter your email address first.");return;}
    setBusy(true);setError("");
    try {await sendPasswordResetEmail(firebaseAuth,email.trim());setNotice("If an account is available for this email, password reset instructions will be sent.");}
    catch {setError("The reset request could not be completed. Please try again.");}
    finally {setBusy(false);}
  }
  async function refreshAccess() { if (user) { await user.reload(); await user.getIdToken(true); } setRefresh(value=>value+1); }
  function changePeriod(next: CouncilPeriodKey) { if(demonstration) applyDemo({...demoState.current,period:next}); else setPeriod(next); }
  async function saveCampaign(input: CouncilCampaignInput,id?:string,status:CouncilCampaign["status"]="active") {
    const clean = parseCouncilCampaignInput(input);
    if (demonstration) {
      const now=new Date().toISOString(); const demoId=id||`demo-${crypto.randomUUID()}`;
      const record:CouncilCampaign={...clean,id:demoId,councilId:"demonstration",code:demoId,status,opens:0,createdAt:now,updatedAt:now,shareUrl:`/council/demo?campaign=${encodeURIComponent(demoId)}`};
      if (!id && demoState.current.campaigns.length >= 100) throw new Error("This demo holds up to 100 campaigns. Reset the demonstration to start again.");
      const saved = applyDemo({...demoState.current,campaigns:id?demoState.current.campaigns.map(campaign=>campaign.id===id?{...campaign,...clean,status,updatedAt:now}:campaign):[record,...demoState.current.campaigns]});
      setNotice(saved ? "Practice campaign saved in this browser. No real campaign was published." : "Practice campaign saved for this visit. Browser storage is unavailable.");return;
    }
    const actor = firebaseAuth.currentUser?.uid, councilId = selected, actionGeneration = generation.current;
    const result=await api<{campaigns:CouncilCampaign[]}>(`/api/council/campaigns?councilId=${encodeURIComponent(councilId)}`,{method:id?"PATCH":"POST",body:JSON.stringify({...clean,...(id?{id,status}:{})})});
    if (firebaseAuth.currentUser?.uid !== actor || selectedCouncil.current !== councilId || generation.current !== actionGeneration) return;
    setCampaigns(result.campaigns);setNotice(id?"Campaign updated.":"Campaign created. Its link is ready to share.");setRefresh(value=>value+1);
  }
  async function saveProfile(input: CouncilProfileInput) {
    if (!profile) throw new Error("Open a council workspace first.");
    const clean = parseCouncilProfileInput(input,profile.state);
    if (demonstration) {
      const saved = applyDemo({...demoState.current,profile:{...demoState.current.profile,...clean,updatedAt:new Date().toISOString()}});
      setNotice(saved ? "Council profile saved in this browser. Your header, map and sample reporting now use these settings." : "Profile updated for this visit. Browser storage is unavailable."); return;
    }
    const councilId = selected, actor = firebaseAuth.currentUser?.uid;
    const result = await api<{profile:CouncilProfile}>(`/api/council/profile?councilId=${encodeURIComponent(councilId)}`,{method:"PATCH",body:JSON.stringify(clean)});
    if (firebaseAuth.currentUser?.uid !== actor || selectedCouncil.current !== councilId) return;
    generation.current++;
    setProfile(current => current?.councilId === councilId ? result.profile : current);
    setNotice("Council profile saved. Updating your reporting area..."); setLoading(true); setRefresh(value=>value+1);
  }
  function resetDemo() {
    const saved = applyDemo(createCouncilDemoState());
    setDemoTeam(createCouncilDemoTeam());
    setNotice(saved ? "Demonstration reset. Start exploring with a fresh council profile." : "Demonstration reset for this visit. Browser storage is unavailable.");
  }
  function exportReport() {
    if(!report)return;
    const url=URL.createObjectURL(new Blob([councilReportCsv(report)],{type:"text/csv;charset=utf-8"}));
    const link=document.createElement("a");link.href=url;link.download=`${demonstration?"DEMONSTRATION-":""}council-report-${report.period.end}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const council=access?.councils.find(item=>item.id===selected);
  const communityProps = {state:communityState,period:communityPeriod,onPeriodChange:setCommunityPeriod,onRefresh:()=>setCommunityRefresh(value=>value+1)};
  const veuProps = {state:veuState,period,onPeriodChange:changePeriod,onRefresh:()=>setCommunityRefresh(value=>value+1)};
  const postcodeDetails = {veu:veuState,community:communityState};
  const publicLayers = [
    ...(veuState.report ? [{id:"public-upgrades",label:"Approved community upgrades",unit:"activities",sourceLabel:`Victorian Energy Upgrades · ${veuState.report.period.label} · source refreshed ${councilDate(veuState.report.source.refreshedAt)}`,postcodes:veuState.report.postcodes.map(row=>({postcode:row.postcode,value:row.activities}))},{id:"public-impact",label:"Estimated lifetime emissions benefit",unit:"t CO₂-e",sourceLabel:`Victorian Energy Upgrades · ${veuState.report.period.label} · lifetime estimate`,postcodes:veuState.report.postcodes.map(row=>({postcode:row.postcode,value:row.estimatedLifetimeTonnesCo2e}))}] : []),
    ...(communityState.report ? COMMUNITY_METRICS.filter(metric=>metric.unit === "systems").map(metric=>({id:metric.id,label:metric.label,unit:metric.unit,sourceLabel:`Clean Energy Regulator · ${communityState.report!.period.label} · data through ${communityState.report!.sourceAsOf}`,postcodes:communityState.report!.postcodes.map(row=>({postcode:row.postcode,value:row.values[metric.id]}))})) : []),
  ];
  if(resolver) return <main id="site-content" className={styles.entry}><FirebaseMfaChallenge resolver={resolver} onCancel={clearMfaChallenge} onComplete={clearMfaChallenge}/></main>;
  if(user&&security) return <main id="site-content" className={styles.entry}><div className={styles.entryPanel}><FirebaseAccountSecurity user={user} onComplete={async()=>{setSecurity(false);await refreshAccess();}}/><button type="button" className={styles.secondary} onClick={()=>setSecurity(false)}>Back to councils</button></div></main>;
  if(user&&access?.canProvision&&adminOpen)return <><TLinkWorkspaceBar current="council" user={user} organisation="Council administration" displayName={user.displayName || undefined} /><main id="site-content" className={styles.entry}><CouncilAdministration api={api} email={user.email||""} onBack={()=>{setAdminOpen(false);setRefresh(value=>value+1);}}/></main></>;
  const workspaceActions = !demonstration&&access&&(access.councils.length>1||access.canProvision) ? <>
      {access.councils.length>1&&<label>Council <select value={selected} onChange={event=>selectCouncil(event.target.value)}>{access.councils.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {access.canProvision&&<button type="button" onClick={()=>setAdminOpen(true)}>Manage council access</button>}
    </> : undefined;
  if(report&&profile&&(demonstration||(user&&council&&report.scope.councilId===selected&&profile.councilId===selected))) return <CouncilWorkspace workspaceActions={workspaceActions} portalUser={demonstration ? null : user} communitySlot={<><CouncilVeu {...veuProps}/><CouncilCommunity {...communityProps}/></>} communitySummarySlot={<><CouncilVeu {...veuProps} compact/><CouncilCommunity {...communityProps} compact/></>} teamSlot={<CouncilTeam councilId={report.scope.councilId} demonstration={demonstration} role={demonstration ? "owner" : council?.role ?? "viewer"} api={demonstration ? undefined : api} demoTeam={demoTeam} onDemoTeamChange={setDemoTeam}/>} key={report.scope.councilId} report={report} profile={profile} onSaveProfile={saveProfile} onResetDemo={demonstration?resetDemo:undefined} calculatorSlot={<CouncilRebateCalculator demonstration={demonstration} postcodes={profile.postcodes} state={profile.state}/>} mapSlot={<CouncilMap key={report.scope.postcodes.join(",")} report={report} api={demonstration?undefined:api} publicLayers={publicLayers} postcodeDetails={postcodeDetails}/>} campaigns={campaigns} loading={loading} error={error} notice={notice} canManage={demonstration||council?.role==="owner"||council?.role==="editor"} onPeriodChange={changePeriod} onRefresh={()=>{if(demonstration)applyDemo(demoState.current,false);setRefresh(value=>value+1);}} onSignOut={demonstration?undefined:()=>{void signOut(firebaseAuth);}} onSaveCampaign={saveCampaign} onExport={exportReport}/>;
  return <><TLinkWorkspaceBar current="council" user={user} organisation="TLink Council" displayName={user?.displayName || undefined} /><main id="site-content" className={styles.entry}><section className={styles.entryPanel}>
    <Link className={styles.brand} href="/council"><TLinkBrand context="Council workspace" /></Link>
    <span className={styles.eyebrow}>Council workspace</span><h1>Local action.<br/>Visible impact.</h1>
    <p className={styles.lead}>Connect your community with energy upgrades. See the work, the local business opportunity and the outcomes of your council campaigns.</p>
    {error&&<p className={styles.error} role="alert">{error}</p>}{notice&&<p className={styles.notice} role="status">{notice}</p>}
    {!authReady||loading?<p role="status">{!authReady?"Checking your sign-in…":"Loading your council workspace…"}</p>:user?<>
      <div className={styles.notice}><strong>{user.email}</strong><p>{!user.emailVerified?"Verify your email to use your council invitation.":!access?.councils.length?"Your account is signed in. Council reporting requires an approved council invitation.":"The workspace could not be loaded. Retry to check your current access."}</p></div>
      <div className={styles.actions}>
        <button type="button" onClick={()=>void refreshAccess().catch(()=>setError("Access could not be refreshed. Please sign in again."))}>Refresh access</button>
        {access?.canProvision&&<button type="button" onClick={()=>setAdminOpen(true)}>Create or manage councils</button>}
        {access?.adminMfaRequired&&<button type="button" onClick={()=>setSecurity(true)}>Verify administrator access</button>}
        <button type="button" className={styles.secondary} onClick={()=>void signOut(firebaseAuth)}>Sign out</button>
      </div>
    </>:<div className={styles.split}><div><ul className={styles.benefits}>
      <li><strong>Your area, in one view</strong>Completed upgrades and local business participation across approved postcodes.</li>
      <li><strong>Campaigns with a traceable outcome</strong>Dedicated referral links and information sessions.</li>
      <li><strong>Useful reports. Private customers.</strong>Aggregate reporting, clear methods and ready-to-share exports.</li>
    </ul><a className={styles.secondary} href="/council/demo">Explore the demonstration <span aria-hidden="true">↗</span></a><p className={styles.fine}>Sample TLink outcomes and real public community data. No customer information or account needed.</p></div>
    <form className={styles.form} onSubmit={event=>void authenticate(event)}><h2>{register?"Activate your invitation":"Welcome back"}</h2>
      <label>Work email<input type="email" autoComplete="email" required value={email} onChange={event=>setEmail(event.target.value)}/></label>
      <label>Password<input type="password" autoComplete={register?"new-password":"current-password"} required minLength={register?12:undefined} value={password} onChange={event=>setPassword(event.target.value)}/></label>
      <button disabled={busy}>{busy?"Please wait…":register?"Create account":"Sign in to council workspace"}</button>
      <button type="button" disabled={busy} className={styles.secondary} onClick={()=>void authenticate(undefined,true)}>Continue with Google</button>
      <button type="button" disabled={busy} className={styles.textButton} onClick={()=>{setRegister(!register);setError("");}}>{register?"Already have an account? Sign in":"Invited for the first time? Create an account"}</button>
      {!register&&<button type="button" disabled={busy} className={styles.textButton} onClick={()=>void resetPassword()}>Reset password</button>}
      <p className={styles.fine}>Council access is by invitation. Creating an account does not grant access to council or customer records.</p>
    </form></div>}
  </section></main></>;
}
