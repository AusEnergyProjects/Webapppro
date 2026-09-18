"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import styles from "./TradeTrainingWorkspace.module.css";

type ApiResult = { ok?: boolean; error?: string; code?: string };
type BusinessStatus = { status: string; revision: number; insuranceExpiresOn: string; approved: boolean; blockedReasons: string[] };
type Person = { name: string; address: string; email: string; mobile: string; idDocumentId: string; selfieDocumentId: string };
export type CreditexOnboardingApplication = {
  legalName: string; acn: string; hasWebsite: boolean; website: string; address: string;
  insuranceDocumentId: string; insuranceExpiresOn: string; priorProposalDocumentId: string;
  doesNswWork: boolean; contractorLicenceDocumentId: string; director: Person;
  directorIsGuarantor: boolean; guarantor: Person & { position: string };
  witness: { name: string; position: string; email: string }; acceptedPrivacy: boolean;
};
type Document = { id: string; kind: string; fileName: string; createdAt?: string };
type OnboardingResult = ApiResult & {
  actor?: { isOwner: boolean; displayName: string; memberId: string };
  business?: BusinessStatus; application?: CreditexOnboardingApplication; documents?: Document[];
};
type Source = { id: string; title: string; url: string };
type Lesson = { title: string; body: string; sourceIds: string[] };
type Completion = { reference: string; passedAt: string; expiresAt: string; revokedAt: string };
type Module = { id: string; programCode?: string; version: string | number; title: string; activityTemplateIds: string[];
  serviceCategory?: string; businessServiceEnabled?: boolean;
  estimatedMinutes: number; passPercent: number; validityDays: number; lessons: Lesson[]; sources: Source[];
  availability: string; completion: Completion | null; status: string };
type TeamProgress = { memberId: string; displayName: string; modules: { id: string; title: string; status: string; reference?: string; expiresAt?: string }[] };
type UnavailableActivity = { id: string; title: string; programCode: string; serviceCategory: string; status: "unavailable"; message: string };
type TrainingResult = ApiResult & { business: BusinessStatus; memberId: string; modules: Module[]; team?: TeamProgress[]; unavailableActivities?: UnavailableActivity[] };
type Attempt = { id: string; moduleId: string; version: string | number; expiresAt: string;
  questions: { id: string; prompt: string; options: { id: string; text: string }[]; critical: boolean }[] };
type AssessmentResult = { passed: boolean; scorePercent: number; criticalPassed: boolean; reference: string; expiresAt: string;
  feedback?: { questionId: string; prompt: string; correct: boolean; explanation: string; sourceIds: string[]; correctAnswer: string }[] };

const emptyPerson = (): Person => ({ name: "", address: "", email: "", mobile: "", idDocumentId: "", selfieDocumentId: "" });
const emptyApplication = (): CreditexOnboardingApplication => ({
  legalName: "", acn: "", hasWebsite: false, website: "", address: "", insuranceDocumentId: "", insuranceExpiresOn: "",
  priorProposalDocumentId: "", doesNswWork: false, contractorLicenceDocumentId: "", director: emptyPerson(),
  directorIsGuarantor: true, guarantor: { ...emptyPerson(), position: "" }, witness: { name: "", position: "", email: "" }, acceptedPrivacy: false,
});
const label = (value: string) => value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
const date = (value: string) => value ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value.length === 10 ? `${value}T12:00:00` : value)) : "Not set";
const moduleProgram = (module: Module) => {
  if (module.programCode) return module.programCode.replaceAll("-", " ");
  const id = module.activityTemplateIds[0] || module.id;
  return id.startsWith("nsw-ess") ? "NSW ESS" : id.startsWith("nsw-pdrs") ? "NSW PDRS" : id.split("-")[0].toUpperCase();
};

async function request<T extends ApiResult>(user: User, url: string, init: RequestInit = {}): Promise<T> {
  const token = await user.getIdToken();
  const response = await fetch(url, { ...init, cache: "no-store", headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  const result: T = await response.json();
  if (!response.ok || result.ok === false) throw new Error(result.error || "The request could not be completed. Please try again.");
  return result;
}

function TextField({ title, value, onChange, type = "text", required = false, maxLength = 300 }: {
  title: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; maxLength?: number;
}) {
  return <label className={styles.field}>{title}<input type={type} value={value} required={required} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} /></label>;
}

export function TradeCreditexOnboarding({ user, initialExpanded = false, businessName = "", businessAddress = "" }: { user: User; initialExpanded?: boolean; businessName?: string; businessAddress?: string }) {
  const [data, setData] = useState<OnboardingResult | null>(null);
  const [application, setApplication] = useState<CreditexOnboardingApplication>(() => ({ ...emptyApplication(), legalName: businessName, address: businessAddress }));
  const [expanded, setExpanded] = useState(initialExpanded);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadKind, setUploadKind] = useState("insurance");

  const load = useCallback(async () => {
    const next = await request<OnboardingResult>(user, "/api/creditex-onboarding");
    setData(next); if (next.application) setApplication(next.application); setDirty(false);
  }, [user]);
  useEffect(() => { let active = true; void request<OnboardingResult>(user, "/api/creditex-onboarding").then((next) => {
    if (active) { setData(next); if (next.application) setApplication(next.application); }
  }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Onboarding could not be loaded."); });
  return () => { active = false; }; }, [user]);

  function change<K extends keyof CreditexOnboardingApplication>(key: K, value: CreditexOnboardingApplication[K]) {
    setApplication((current) => ({ ...current, [key]: value })); setDirty(true); setNotice("");
  }
  function personChange(kind: "director" | "guarantor", key: keyof Person, value: string) {
    setApplication((current) => ({ ...current, [kind]: { ...current[kind], [key]: value } })); setDirty(true); setNotice("");
  }
  async function save(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault(); if (!data?.business) return;
    setBusy("save"); setError(""); setNotice("");
    try {
      await request(user, "/api/creditex-onboarding", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: data.business.revision, application }) });
      await load(); setNotice("Application saved privately. Submit it when all details and documents are ready.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The application could not be saved."); }
    finally { setBusy(""); }
  }
  async function submit() {
    if (!data?.business || dirty) return;
    setBusy("submit"); setError(""); setNotice("");
    try {
      await request(user, "/api/creditex-onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "submit", expectedRevision: data.business.revision }) });
      await load(); setNotice("Application submitted for Creditex review. The signed agreement and approval are separate steps.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The application could not be submitted."); }
    finally { setBusy(""); }
  }
  async function upload() {
    const file = fileInputRef.current?.files?.[0]; if (!file) return;
    setBusy("upload"); setError("");
    try {
      const form = new FormData(); form.set("action", "upload"); form.set("kind", uploadKind); form.set("file", file);
      const result = await request<ApiResult & { document: Document }>(user, "/api/creditex-onboarding", { method: "POST", body: form });
      setData((current) => current ? { ...current, documents: [...(current.documents || []), result.document] } : current);
      const id = result.document.id;
      if (uploadKind === "insurance") change("insuranceDocumentId", id);
      else if (uploadKind === "contractor_licence") change("contractorLicenceDocumentId", id);
      else if (uploadKind === "prior_proposal") change("priorProposalDocumentId", id);
      else if (uploadKind === "director_id") personChange("director", "idDocumentId", id);
      else if (uploadKind === "director_selfie") personChange("director", "selfieDocumentId", id);
      else if (uploadKind === "guarantor_id") personChange("guarantor", "idDocumentId", id);
      else if (uploadKind === "guarantor_selfie") personChange("guarantor", "selfieDocumentId", id);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setNotice("Document uploaded privately. Save the application to attach it to this submission.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The document could not be uploaded."); }
    finally { setBusy(""); }
  }
  async function download(document: Document) {
    setBusy(document.id); setError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/creditex-onboarding?documentId=${encodeURIComponent(document.id)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) throw new Error("This private document could not be opened.");
      const url = URL.createObjectURL(await response.blob()); const link = window.document.createElement("a"); link.href = url; link.download = document.fileName; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The document could not be opened."); }
    finally { setBusy(""); }
  }
  const isOwner = Boolean(data?.actor?.isOwner);
  const documentSelect = (title: string, kind: string, value: string, onChange: (value: string) => void) => <label className={styles.field}>{title}<select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Choose an uploaded document</option>{(data?.documents || []).filter((item) => item.kind === kind).map((item) => <option key={item.id} value={item.id}>{item.fileName}</option>)}</select></label>;
  const personFields = (kind: "director" | "guarantor") => <div className={styles.fields}>
    <TextField title="Full legal name" value={application[kind].name} onChange={(value) => personChange(kind, "name", value)} />
    <TextField title="Residential address" value={application[kind].address} onChange={(value) => personChange(kind, "address", value)} maxLength={500} />
    <TextField title="Business email" type="email" value={application[kind].email} onChange={(value) => personChange(kind, "email", value)} />
    <TextField title="Australian mobile number" type="tel" value={application[kind].mobile} onChange={(value) => personChange(kind, "mobile", value)} />
    {documentSelect("Identity document", `${kind}_id`, application[kind].idDocumentId, (value) => personChange(kind, "idDocumentId", value))}
    {documentSelect("Selfie holding photo ID", `${kind}_selfie`, application[kind].selfieDocumentId, (value) => personChange(kind, "selfieDocumentId", value))}
  </div>;

  return <section className={`${styles.shell} ${styles.panel}`} aria-label="Creditex business onboarding">
    <header><div><span className={styles.eyebrow}>Business setup</span><h3>Creditex onboarding</h3><p className={styles.muted}>Business review, signed agreement and activity training must be current before government program work can proceed.</p></div><span className={styles.badge}>{label(data?.business?.status || "Not submitted")}</span></header>
    {error && <p className={`${styles.notice} ${styles.error}`} role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {!data && !error && <p role="status">Loading private onboarding status...</p>}
    {data?.business && <><ol className={styles.steps}>{data.business.blockedReasons.map((reason) => <li key={reason}>{reason}</li>)}</ol>{data.business.approved && <p className={styles.passed}>Business approved. Each person still needs current training and credentials for the exact activity.</p>}</>}
    {data && !isOwner && <p>The business owner manages the application and private documents. Complete your own activity modules below.</p>}
    {isOwner && <><button className={styles.secondary} type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Close application details" : "Continue business onboarding"}</button>
      {expanded && <><p className={styles.muted}>Creditex&apos;s current intake requires a Pty Ltd company, a valid ACN, business email addresses and Australian mobile numbers. Supporting identity documents remain private to the business owner and authorised reviewers. <a href="https://form.jotform.com/260537951473867" target="_blank" rel="noreferrer">View the Creditex reference form</a>.</p>
        <section className={styles.card} aria-label="Upload private onboarding documents"><h4>1. Add supporting documents</h4><div className={styles.fields}><label className={styles.field}>Document purpose<select value={uploadKind} onChange={(event) => setUploadKind(event.target.value)}>{[["insurance", "Public and product liability insurance"], ["contractor_licence", "NSW contractor licence"], ["director_id", "Director identity"], ["director_selfie", "Director selfie holding photo ID"], ["guarantor_id", "Guarantor identity"], ["guarantor_selfie", "Guarantor selfie holding photo ID"], ["prior_proposal", "Previous proposal"]].map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label><label className={styles.field}>Private file<input ref={fileInputRef} type="file" accept="application/pdf,image/jpeg,image/png" /></label></div><div className={styles.actions}><button className={styles.secondary} type="button" disabled={Boolean(busy)} onClick={() => void upload()}>{busy === "upload" ? "Uploading..." : "Upload document"}</button></div>{(data?.documents || []).map((item) => <div className={styles.document} key={item.id}><span>{item.fileName}<br /><small>{label(item.kind)}</small></span><button className={styles.secondary} disabled={Boolean(busy)} type="button" onClick={() => void download(item)}>Download</button></div>)}</section>
        <form onSubmit={(event) => void save(event)} className={styles.shell}>
          <section className={styles.card}><h4>2. Business details</h4><div className={styles.fields}><TextField title="Pty Ltd company legal name" value={application.legalName} onChange={(value) => change("legalName", value)} /><TextField title="Company ACN" value={application.acn} onChange={(value) => change("acn", value)} /><TextField title="Business address" value={application.address} onChange={(value) => change("address", value)} maxLength={500} /><TextField title="Insurance expiry" type="date" value={application.insuranceExpiresOn} onChange={(value) => change("insuranceExpiresOn", value)} />{documentSelect("Public and product liability insurance", "insurance", application.insuranceDocumentId, (value) => change("insuranceDocumentId", value))}{documentSelect("Previous proposal, if applicable", "prior_proposal", application.priorProposalDocumentId, (value) => change("priorProposalDocumentId", value))}</div><label className={styles.check}><input type="checkbox" checked={application.hasWebsite} onChange={(event) => change("hasWebsite", event.target.checked)} />The business has a website</label>{application.hasWebsite && <TextField title="Website" type="url" value={application.website} onChange={(value) => change("website", value)} />}<label className={styles.check}><input type="checkbox" checked={application.doesNswWork} onChange={(event) => change("doesNswWork", event.target.checked)} />The business performs work in NSW</label>{application.doesNswWork && documentSelect("NSW contractor licence", "contractor_licence", application.contractorLicenceDocumentId, (value) => change("contractorLicenceDocumentId", value))}</section>
          <section className={styles.card}><h4>3. Director</h4>{personFields("director")}</section>
          <section className={styles.card}><h4>4. Guarantor and witness</h4><label className={styles.check}><input type="checkbox" checked={application.directorIsGuarantor} onChange={(event) => change("directorIsGuarantor", event.target.checked)} />The director is also the guarantor</label>{!application.directorIsGuarantor && <>{personFields("guarantor")}<TextField title="Guarantor position" value={application.guarantor.position} onChange={(value) => change("guarantor", { ...application.guarantor, position: value })} /></>}<div className={styles.fields}><TextField title="Witness full name" value={application.witness.name} onChange={(value) => change("witness", { ...application.witness, name: value })} /><TextField title="Witness position" value={application.witness.position} onChange={(value) => change("witness", { ...application.witness, position: value })} /><TextField title="Witness business email" type="email" value={application.witness.email} onChange={(value) => change("witness", { ...application.witness, email: value })} /></div></section>
          <label className={styles.check}><input type="checkbox" checked={application.acceptedPrivacy} onChange={(event) => change("acceptedPrivacy", event.target.checked)} /><span>I am authorised to provide these details and documents to Australian Energy Assessments and Creditex for onboarding, identity checks and compliance review. I have informed the other people named in this application. <a href="/privacy" target="_blank" rel="noreferrer">Privacy policy</a></span></label>
          <p className={styles.muted}>Submitting this intake does not sign a partnership agreement. Creditex records the executed agreement and its review decision separately.</p>
          {data?.business?.approved && dirty && <p className={styles.notice}>Saving changed application details removes the previous approval. Creditex must review and approve the new revision before government program work continues.</p>}<div className={styles.actions}><button className={styles.button} disabled={Boolean(busy) || !dirty} type="submit">{busy === "save" ? "Saving..." : "Save application"}</button><button className={styles.secondary} disabled={Boolean(busy) || dirty || !["draft", "rejected"].includes(data?.business?.status || "")} type="button" onClick={() => void submit()}>{busy === "submit" ? "Submitting..." : "Submit for Creditex review"}</button>{dirty && <small>Save your changes before submitting.</small>}</div>
        </form>
      </>}
    </>}
  </section>;
}

export function TradeTrainingWorkspace({ user }: { user: User }) {
  const [data, setData] = useState<TrainingResult | null>(null);
  const [moduleSearch, setModuleSearch] = useState(""); const [programFilter, setProgramFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("todo");
  const [visibleModuleCount, setVisibleModuleCount] = useState(12); const [expandedTeamMember, setExpandedTeamMember] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState("");
  const [selectedId, setSelectedId] = useState(""); const [lessonIndex, setLessonIndex] = useState(0);
  const [readLessons, setReadLessons] = useState<string[]>([]);
  const [attempt, setAttempt] = useState<Attempt | null>(null); const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({}); const [result, setResult] = useState<AssessmentResult | null>(null);
  const questionHeading = useRef<HTMLLegendElement | null>(null);
  const lessonHeading = useRef<HTMLHeadingElement | null>(null);
  const load = useCallback(async () => { const next = await request<TrainingResult>(user, "/api/trade-training"); setData(next); }, [user]);
  useEffect(() => { let active = true; void request<TrainingResult>(user, "/api/trade-training").then((next) => { if (active) setData(next); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Training could not be loaded."); }); return () => { active = false; }; }, [user]);
  useEffect(() => { if (attempt) questionHeading.current?.focus(); }, [questionIndex, attempt]);
  useEffect(() => { if (selectedId) lessonHeading.current?.focus(); }, [selectedId]);
  const selected = data?.modules.find((module) => module.id === selectedId);
  const lesson = selected?.lessons[lessonIndex]; const question = attempt?.questions[questionIndex];
  const allRead = Boolean(selected && selected.lessons.length && selected.lessons.every((_, index) => readLessons.includes(`${selected.id}:${selected.version}:${index}`)));
  function openModule(module: Module) { setSelectedId(module.id); setLessonIndex(0); setAttempt(null); setResult(null); setAnswers({}); setError(""); }
  async function start() {
    if (!selected || !allRead) return; setBusy("start"); setError("");
    try { const next = await request<ApiResult & { attempt: Attempt }>(user, "/api/trade-training", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", moduleId: selected.id }) }); setAttempt(next.attempt); setQuestionIndex(0); setAnswers({}); setResult(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The assessment could not be started."); } finally { setBusy(""); }
  }
  async function submitQuiz() {
    if (!attempt || attempt.questions.some((item) => !answers[item.id])) return; setBusy("submit"); setError("");
    try { const next = await request<ApiResult & { result: AssessmentResult }>(user, "/api/trade-training", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "submit", attemptId: attempt.id, answers }) }); setResult(next.result); setAttempt(null); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The assessment could not be submitted."); } finally { setBusy(""); }
  }
  const passed = data?.modules.filter((module) => module.status === "passed").length || 0;
  const pending = (data?.modules.length || 0) - passed + (data?.unavailableActivities?.length || 0);
  const programs = [...new Set([...(data?.modules || []).map(moduleProgram), ...(data?.unavailableActivities || []).map((item) => item.programCode.replaceAll("-", " "))])].sort();
  const matchingModules = (data?.modules || []).filter((module) => (statusFilter === "all" || (statusFilter === "passed" ? module.status === "passed" : module.status !== "passed")) && (!programFilter || moduleProgram(module) === programFilter)
    && `${module.title} ${module.id} ${module.activityTemplateIds.join(" ")}`.toLowerCase().includes(moduleSearch.trim().toLowerCase()));
  const matchingUnavailable = (data?.unavailableActivities || []).filter((item) => statusFilter !== "passed" && (!programFilter || item.programCode.replaceAll("-", " ") === programFilter)
    && `${item.title} ${item.id} ${item.programCode} ${item.serviceCategory}`.toLowerCase().includes(moduleSearch.trim().toLowerCase()));

  return <div className={styles.shell}>
    <header className={styles.hero}><span className={styles.eyebrow}>Your compliance to-do list</span><h2>To do &amp; training</h2><p>Saving your services assigns the relevant activity modules here. Complete your own learning and assessments to qualify for government-program work, alongside business approval and required credentials.</p>{data && <><strong>{pending} training {pending === 1 ? "task" : "tasks"} to do</strong><span>{passed} of {data.modules.length} activity modules current</span></>}</header>
    <TradeCreditexOnboarding user={user} />
    {error && <p className={`${styles.notice} ${styles.error}`} role="alert">{error}</p>}
    {!data && !error && <p role="status">Loading your activity training...</p>}
    {data && <section className={styles.panel} aria-label="Your activity modules"><header><div><h3>Your training to-do list</h3><p className={styles.muted}>Each person completes their own assessment. Passing records learning completion; Creditex approval, licences and job evidence remain required.</p></div><button className={styles.secondary} type="button" disabled={Boolean(busy)} onClick={() => { setError(""); void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Status could not be refreshed.")); }}>Refresh status</button></header>
      <div className={styles.fields}><label className={styles.field}>Find an activity<input type="search" value={moduleSearch} placeholder="Activity number, program or work type" onChange={(event) => { setModuleSearch(event.target.value); setVisibleModuleCount(12); }} /></label><label className={styles.field}>Program<select aria-label="Program" value={programFilter} onChange={(event) => { setProgramFilter(event.target.value); setVisibleModuleCount(12); }}><option value="">All programs</option>{programs.map((program) => <option key={program} value={program}>{program}</option>)}</select></label><label className={styles.field}>Status<select aria-label="Training status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setVisibleModuleCount(12); }}><option value="todo">To do</option><option value="passed">Passed</option><option value="all">All modules</option></select></label></div><small>Showing {Math.min(visibleModuleCount, matchingModules.length)} of {matchingModules.length} matching activities.</small><div className={styles.grid}>{matchingModules.slice(0, visibleModuleCount).map((module) => <article className={styles.card} key={module.id}><header><div><small>{module.activityTemplateIds.join(" · ")}</small><h4>{module.title}</h4></div><span className={`${styles.badge} ${module.status === "passed" ? styles.passed : ""}`}>{module.status === "passed" ? "✓ Passed" : label(module.status)}</span></header><p className={styles.muted}>{module.estimatedMinutes} minutes · Version {module.version} · Pass mark {module.passPercent}%</p>{module.businessServiceEnabled === false && <p className={styles.notice}>You can study this activity now. The business owner must also enable this service in Business settings before programme work can be booked.</p>}{module.completion && module.status === "passed" && <div className={styles.completion}><strong>Learning completion reference</strong><code>{module.completion.reference}</code><small>Valid until {date(module.completion.expiresAt)}</small></div>}{module.availability !== "active" && <p className={styles.muted}>{module.availability === "awaiting_review" ? "Creditex must review and activate this exact curriculum before assessment is available." : "This curriculum is unavailable. Government-program booking stays locked until a current module is available."}</p>}<button type="button" className={styles.secondary} onClick={() => openModule(module)} disabled={Boolean(busy)}>{module.status === "passed" ? "Review learning material" : "Open learning material"}</button></article>)}</div>
      {matchingModules.length > visibleModuleCount && <button className={styles.secondary} type="button" onClick={() => setVisibleModuleCount((count) => count + 12)}>Show 12 more activities</button>}
      {data.modules.length > 0 && !matchingModules.length && <p>No activity matches these filters. Change the search, program or status.</p>}
      {!data.modules.length && <p>No activity modules are assigned to your current work types and service locations. The business owner should check service selections in Business settings and each person’s capabilities in Team. An empty list does not approve government program work.</p>}
      {matchingUnavailable.length > 0 && <details className={styles.details}><summary>{matchingUnavailable.length} declared activities awaiting a suitable curriculum</summary><div><p>These activities remain locked. A completion for a different activity cannot qualify this work.</p>{matchingUnavailable.map((item) => <p key={item.id}><strong>{item.programCode} · {item.title}</strong><br /><span className={styles.muted}>{item.message}</span></p>)}</div></details>}
    </section>}
    {selected && <section className={styles.panel} aria-label={`${selected.title} learning and assessment`}><header><div><span className={styles.eyebrow}>{selected.activityTemplateIds.join(" · ")}</span><h3 ref={lessonHeading} tabIndex={-1}>{selected.title}</h3></div><span className={styles.badge}>Version {selected.version}</span></header>
      {!attempt && <>{lesson && <div className={styles.lesson}><div className={styles.row}><strong>Lesson {lessonIndex + 1} of {selected.lessons.length}</strong><small>{readLessons.filter((key) => key.startsWith(`${selected.id}:${selected.version}:`)).length} marked read</small></div><progress className={styles.progress} value={lessonIndex + 1} max={selected.lessons.length} aria-label="Lesson progress" /><h4>{lesson.title}</h4><p className={styles.lessonBody}>{lesson.body}</p><ul className={styles.sources}>{lesson.sourceIds.map((id) => selected.sources.find((source) => source.id === id)).filter((source): source is Source => Boolean(source)).map((source) => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul><label className={styles.check}><input type="checkbox" checked={readLessons.includes(`${selected.id}:${selected.version}:${lessonIndex}`)} onChange={(event) => { const key = `${selected.id}:${selected.version}:${lessonIndex}`; setReadLessons((current) => event.target.checked ? [...new Set([...current, key])] : current.filter((item) => item !== key)); }} />I have read this lesson and its relevant source guidance.</label><div className={styles.actions}><button className={styles.secondary} type="button" disabled={lessonIndex === 0} onClick={() => setLessonIndex((value) => value - 1)}>Previous lesson</button><button className={styles.secondary} type="button" disabled={lessonIndex >= selected.lessons.length - 1} onClick={() => setLessonIndex((value) => value + 1)}>Next lesson</button></div></div>}
        <div className={styles.notice}><p>The assessment is scored on the server. You need {selected.passPercent}% with every compliance question correct. You can retry immediately as often as needed. Your personal completion record cannot qualify another team member.</p></div><div className={styles.actions}><button className={styles.button} type="button" disabled={!allRead || selected.availability !== "active" || Boolean(busy) || selected.status === "passed"} onClick={() => void start()}>{busy === "start" ? "Starting..." : result && !result.passed ? "Try the assessment again" : "Start assessment"}</button>{!allRead && <small>Read and mark each lesson before starting.</small>}</div>
      </>}
      {attempt && question && <><div className={styles.row}><strong>Question {questionIndex + 1} of {attempt.questions.length}</strong><small>{Object.keys(answers).length} answered</small></div><progress className={styles.progress} value={questionIndex + 1} max={attempt.questions.length} aria-label="Assessment progress" /><fieldset className={styles.question} disabled={Boolean(busy)}><legend ref={questionHeading} tabIndex={-1}>{question.prompt}</legend>{question.options.map((option) => <label key={option.id} className={styles.option}><input type="radio" name={`question-${question.id}`} value={option.id} checked={answers[question.id] === option.id} onChange={() => setAnswers((current) => ({ ...current, [question.id]: option.id }))} /><span>{option.text}</span></label>)}</fieldset><div className={styles.actions}><button className={styles.secondary} type="button" disabled={questionIndex === 0 || Boolean(busy)} onClick={() => setQuestionIndex((value) => value - 1)}>Previous question</button>{questionIndex < attempt.questions.length - 1 ? <button className={styles.button} type="button" disabled={!answers[question.id] || Boolean(busy)} onClick={() => setQuestionIndex((value) => value + 1)}>Next question</button> : <button className={styles.button} type="button" disabled={attempt.questions.some((item) => !answers[item.id]) || Boolean(busy)} onClick={() => void submitQuiz()}>{busy === "submit" ? "Submitting..." : "Submit assessment"}</button>}</div><small>Keep this page open until submission. Your answers are sent only when you submit. Attempt expires {date(attempt.expiresAt)}.</small></>}
      {result && <div className={result.passed ? styles.completion : styles.notice} role="status"><h4>{result.passed ? "✓ Assessment passed" : "More learning is needed"}</h4><p>Your score: {result.scorePercent}%. {result.criticalPassed ? "Mandatory compliance questions passed." : "One or more mandatory compliance questions need review."}</p>{result.passed ? <><strong>Learning completion reference</strong><code>{result.reference}</code><small>Valid until {date(result.expiresAt)}. This is a training record, not a government certificate, licence or accreditation.</small></> : <p>Review the activity lessons and official sources before starting a new assessment.</p>}</div>}
      {result?.feedback && <section className={styles.shell} aria-label="Assessment learning feedback"><h4>Review your assessment</h4>{result.feedback.map((item, index) => <details className={styles.details} key={item.questionId}><summary>{item.correct ? "✓ Correct" : "Review required"}: question {index + 1}</summary><div><p><strong>{item.prompt}</strong></p><p>Correct answer: {item.correctAnswer}</p><p>{item.explanation}</p><ul className={styles.sources}>{item.sourceIds.map((id) => selected.sources.find((source) => source.id === id)).filter((source): source is Source => Boolean(source)).map((source) => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul></div></details>)}</section>}
    </section>}
    {data?.team && <section className={styles.panel} aria-label="Team training progress"><h3>Team progress</h3><p className={styles.muted}>Current training status only. Team members&apos; answers and private onboarding identity documents are not shown here.</p>{data.team.map((person) => <div className={styles.person} key={person.memberId}><button className={styles.secondary} type="button" aria-expanded={expandedTeamMember === person.memberId} onClick={() => setExpandedTeamMember((current) => current === person.memberId ? "" : person.memberId)}>{person.displayName} · {person.modules.filter((item) => item.status === "passed").length}/{person.modules.length} current</button>{expandedTeamMember === person.memberId && <div className={styles.scroll}><table className={styles.table}><thead><tr><th>Activity</th><th>Status</th><th>Completion reference</th></tr></thead><tbody>{person.modules.map((module) => <tr key={module.id}><td data-label="Activity">{module.title}</td><td data-label="Status">{label(module.status)}</td><td data-label="Completion reference">{module.reference || "Not passed"}{module.expiresAt && <><br /><small>Until {date(module.expiresAt)}</small></>}</td></tr>)}</tbody></table></div>}</div>)}</section>}
  </div>;
}
