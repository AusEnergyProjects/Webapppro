"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { ENERGY_SERVICE_CATALOGUE } from "@/lib/energy-service-catalogue.mjs";
import { TRAINING_SERVICE_SECTIONS, trainingServiceSection } from "@/lib/training-service-sections.mjs";
import styles from "./TradeTrainingWorkspace.module.css";

type ApiResult = { ok?: boolean; error?: string; code?: string };
type BusinessStatus = { status: string; revision: number; insuranceExpiresOn: string; approved: boolean; blockedReasons: string[]; completionReference?: string; completedAt?: string };
type Person = { name: string; address: string; email: string; mobile: string; idDocumentId: string; selfieDocumentId: string };
export type CreditexOnboardingApplication = {
  legalName: string; acn: string; hasWebsite: boolean; website: string; address: string;
  insuranceDocumentId: string; insuranceExpiresOn: string; priorProposalDocumentId: string; agreementDocumentId: string;
  doesNswWork: boolean; contractorLicenceDocumentId: string; director: Person;
  directorIsGuarantor: boolean; guarantor: Person & { position: string };
  witness: { name: string; position: string; email: string }; acceptedPrivacy: boolean; acceptedCompliance: boolean;
};
type Document = { id: string; kind: string; fileName: string; createdAt?: string };
type OnboardingResult = ApiResult & {
  actor?: { isOwner: boolean; displayName: string; memberId: string };
  business?: BusinessStatus; application?: CreditexOnboardingApplication | null; documents?: Document[];
};
type Source = { id: string; title: string; url: string };
type Lesson = { title: string; body: string; sourceIds: string[] };
type Completion = { reference: string; passedAt: string; expiresAt: string; revokedAt: string };
type Module = { id: string; programCode?: string; version: string | number; title: string; activityTemplateIds: string[];
  serviceCategory?: string; trainingSection?: string; businessServiceEnabled?: boolean;
  estimatedMinutes: number; passPercent: number; validityDays: number; lessons: Lesson[]; sources: Source[];
  availability: string; assessmentAvailable: boolean; assessmentUnavailableReason: string; completion: Completion | null; status: string };
type TeamProgress = { memberId: string; displayName: string; officeOnly?: boolean; modules: { id: string; title: string; serviceCategory?: string; trainingSection?: string; status: string; reference?: string; expiresAt?: string }[] };
type UnavailableActivity = { id: string; title: string; programCode: string; serviceCategory: string; trainingSection?: string; status: "unavailable"; message: string };
type SavedSubmission = { id: string; moduleId: string; version: string; scorePercent: number; firstTryScorePercent: number; reference: string; completedAt: string };
type SubmittedAnswers = SavedSubmission & { snapshot: { title: string; questions: { id: string; prompt: string; options: { id: string; text: string }[]; selectedOptionId: string; explanation: string }[] } };
type TrainingResult = ApiResult & { business: BusinessStatus; memberId: string; officeOnly?: boolean; selectedMember?: { isOwner: boolean }; trainingServiceStates?: string[]; modules: Module[]; team?: TeamProgress[]; unavailableActivities?: UnavailableActivity[]; submissions?: SavedSubmission[] };
type Attempt = { id: string; moduleId: string; version: string | number; expiresAt: string;
  answers?: Record<string, string>; feedback?: Record<string, AnswerFeedback>;
  questions: { id: string; prompt: string; options: { id: string; text: string }[]; critical: boolean }[] };
type AnswerFeedback = { questionId: string; correct: boolean; explanation: string; correctAnswer: string; sourceIds: string[] };
type AssessmentResult = { passed: boolean; scorePercent: number; criticalPassed: boolean; reference: string; expiresAt: string;
  firstTryScorePercent?: number;
  feedback?: { questionId: string; prompt: string; correct: boolean; explanation: string; sourceIds: string[]; correctAnswer: string }[] };

const emptyPerson = (): Person => ({ name: "", address: "", email: "", mobile: "", idDocumentId: "", selfieDocumentId: "" });
const emptyApplication = (): CreditexOnboardingApplication => ({
  legalName: "", acn: "", hasWebsite: false, website: "", address: "", insuranceDocumentId: "", insuranceExpiresOn: "",
  priorProposalDocumentId: "", agreementDocumentId: "", doesNswWork: false, contractorLicenceDocumentId: "", director: emptyPerson(),
  directorIsGuarantor: true, guarantor: { ...emptyPerson(), position: "" }, witness: { name: "", position: "", email: "" }, acceptedPrivacy: false, acceptedCompliance: false,
});
const label = (value: string) => value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
const serviceLabel = (id?: string) => ENERGY_SERVICE_CATALOGUE.find((service) => service.id === id)?.label || "Other activity training";
const learnerSource = (source: Source) => source.id !== "creditex-review" && !source.url.includes("creditex-source-review.md");
const learningStatus = (status: string) => ["awaiting_review", "unavailable"].includes(status) ? "Assessment unavailable" : label(status);
const assessmentReason = (module: Module) => module.assessmentUnavailableReason || "Assessment is unavailable. Refresh the module status for the current requirements.";
const date = (value: string) => value ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value.length === 10 ? `${value}T12:00:00` : value)) : "Not set";
const moduleProgram = (module: Module) => {
  if (module.programCode) return module.programCode.replaceAll("-", " ");
  const id = module.activityTemplateIds[0] || module.id;
  return id.startsWith("nsw-ess") ? "NSW ESS" : id.startsWith("nsw-pdrs") ? "NSW PDRS" : id.split("-")[0].toUpperCase();
};

async function request<T extends ApiResult>(user: User, url: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => {
    controller.abort(); reject(new Error("The connection took too long. Your answers are still here. Try again to check or save this same attempt."));
  }, 25000); });
  try {
    return await Promise.race([timeout, (async () => {
      const token = await user.getIdToken();
      const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store", headers: { ...init.headers, Authorization: `Bearer ${token}` } });
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("The service did not return a result. Your answers are still here. Try again to check or save this same attempt.");
      const result: T = await response.json();
      if (!response.ok || result.ok === false) throw new Error(result.error || "The request could not be completed. Please try again.");
      return result;
    })()]);
  } finally { clearTimeout(timer); }
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

  useEffect(() => { let active = true; void request<OnboardingResult>(user, "/api/creditex-onboarding").then((next) => {
    if (active) { setData(next); if (next.application) setApplication({ ...emptyApplication(), ...next.application, acceptedCompliance: next.application.acceptedCompliance === true }); }
  }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Onboarding could not be loaded."); });
  return () => { active = false; }; }, [user]);

  function change<K extends keyof CreditexOnboardingApplication>(key: K, value: CreditexOnboardingApplication[K]) {
    setApplication((current) => ({ ...current, [key]: value })); setDirty(true); setNotice("");
  }
  function personChange(kind: "director" | "guarantor", key: keyof Person, value: string) {
    setApplication((current) => ({ ...current, [kind]: { ...current[kind], [key]: value } })); setDirty(true); setNotice("");
  }
  async function persistApplication(expectedRevision: number) {
    const saved = await request<OnboardingResult>(user, "/api/creditex-onboarding", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision, application }) });
    if (!saved.business) throw new Error("The saved setup revision could not be confirmed. Refresh before completing setup.");
    setData((current) => current ? { ...current, business: saved.business, application } : current);
    setDirty(false);
    return saved.business;
  }
  async function save() {
    if (!data?.business || busy) return;
    setBusy("save"); setError(""); setNotice("");
    try {
      await persistApplication(data.business.revision);
      setNotice("Progress saved privately. Complete business setup when your details, documents and declarations are ready.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The application could not be saved."); }
    finally { setBusy(""); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data?.business || busy) return;
    setBusy("submit"); setError(""); setNotice("");
    try {
      const saved = dirty || !data.application ? await persistApplication(data.business.revision) : data.business;
      const completed = await request<OnboardingResult>(user, "/api/creditex-onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "submit", expectedRevision: saved.revision }) });
      if (!completed.business) throw new Error("Setup completion could not be confirmed. Refresh your status before trying again.");
      setData((current) => current ? { ...current, business: completed.business } : current);
      setNotice(completed.business.approved ? "Business setup complete. Your completion record is saved." : "Complete the remaining setup requirements shown below.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Business setup could not be completed. Check the details and try again."); }
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
      else if (uploadKind === "partnership_agreement") change("agreementDocumentId", id);
      else if (uploadKind === "contractor_licence") change("contractorLicenceDocumentId", id);
      else if (uploadKind === "prior_proposal") change("priorProposalDocumentId", id);
      else if (uploadKind === "director_id") personChange("director", "idDocumentId", id);
      else if (uploadKind === "director_selfie") personChange("director", "selfieDocumentId", id);
      else if (uploadKind === "guarantor_id") personChange("guarantor", "idDocumentId", id);
      else if (uploadKind === "guarantor_selfie") personChange("guarantor", "selfieDocumentId", id);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setNotice("Document uploaded privately. Complete business setup or save progress to attach it to your record.");
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
  const setupComplete = Boolean(data?.business?.approved);
  const setupStatus = !data?.business ? "Not started" : setupComplete ? "Setup complete" : data.business.status === "suspended" ? "Setup suspended" : "Finish setup";
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
    <header><div><span className={styles.eyebrow}>Business setup</span><h3>Creditex onboarding</h3><p className={styles.muted}>Complete your business details, private documents and declarations. Current insurance, a signed agreement and the required activity training remain necessary for government program work.</p></div><span className={styles.badge}>{setupStatus}</span></header>
    {error && <p className={`${styles.notice} ${styles.error}`} role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {!data && !error && <p role="status">Loading private onboarding status...</p>}
    {data?.business && <><ol className={styles.steps}>{data.business.blockedReasons.map((reason) => <li key={reason}>{reason}</li>)}</ol>{setupComplete && <div className={styles.completion}><strong>Business setup complete</strong>{data.business.completionReference && <code>{data.business.completionReference}</code>}{data.business.completedAt && <small>Completed {date(data.business.completedAt)}</small>}<p>People carrying out activity work still need current training, licences and compliance evidence.</p></div>}</>}
    {data && !isOwner && <p>The business owner manages the application and private documents. Activity training is needed if you carry out on-site work.</p>}
    {isOwner && <><button className={styles.secondary} type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Close application details" : setupComplete ? "View business setup" : "Finish business setup"}</button>
      {expanded && <><p className={styles.muted}>Creditex&apos;s current intake requires a Pty Ltd company, a valid ACN, business email addresses and Australian mobile numbers. Supporting identity documents remain private to the business owner and authorised compliance staff. <a href="https://form.jotform.com/260537951473867" target="_blank" rel="noreferrer">View the Creditex reference form</a>.</p><p className={styles.notice}><strong>Automated ABN verification: connection to be supplied.</strong> Business verification continues through the <a href="/direct-trade/dashboard/verification">existing verification centre</a>. This placeholder does not verify the business.</p>
        <section className={styles.card} aria-label="Upload private onboarding documents"><h4>1. Add supporting documents</h4><div className={styles.fields}><label className={styles.field}>Document purpose<select value={uploadKind} onChange={(event) => setUploadKind(event.target.value)}>{[["insurance", "Public and product liability insurance"], ["partnership_agreement", "Signed Creditex partnership agreement"], ["contractor_licence", "NSW contractor licence"], ["director_id", "Director identity"], ["director_selfie", "Director selfie holding photo ID"], ["guarantor_id", "Guarantor identity"], ["guarantor_selfie", "Guarantor selfie holding photo ID"], ["prior_proposal", "Previous proposal"]].map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label><label className={styles.field}>Private file<input ref={fileInputRef} type="file" accept="application/pdf,image/jpeg,image/png" /></label></div><div className={styles.actions}><button className={styles.secondary} type="button" disabled={Boolean(busy)} onClick={() => void upload()}>{busy === "upload" ? "Uploading..." : "Upload document"}</button></div>{(data?.documents || []).map((item) => <div className={styles.document} key={item.id}><span>{item.fileName}<br /><small>{label(item.kind)}</small></span><button className={styles.secondary} disabled={Boolean(busy)} type="button" onClick={() => void download(item)}>Download</button></div>)}</section>
        <form onSubmit={(event) => void submit(event)} className={styles.shell}><fieldset className={styles.formFields} disabled={Boolean(busy)}>
          <section className={styles.card}><h4>2. Business details</h4><div className={styles.fields}><TextField title="Pty Ltd company legal name" value={application.legalName} onChange={(value) => change("legalName", value)} /><TextField title="Company ACN" value={application.acn} onChange={(value) => change("acn", value)} /><TextField title="Business address" value={application.address} onChange={(value) => change("address", value)} maxLength={500} /><TextField title="Insurance expiry" type="date" value={application.insuranceExpiresOn} onChange={(value) => change("insuranceExpiresOn", value)} />{documentSelect("Public and product liability insurance", "insurance", application.insuranceDocumentId, (value) => change("insuranceDocumentId", value))}{documentSelect("Previous proposal, if applicable", "prior_proposal", application.priorProposalDocumentId, (value) => change("priorProposalDocumentId", value))}</div><label className={styles.check}><input type="checkbox" checked={application.hasWebsite} onChange={(event) => change("hasWebsite", event.target.checked)} />The business has a website</label>{application.hasWebsite && <TextField title="Website" type="url" value={application.website} onChange={(value) => change("website", value)} />}<label className={styles.check}><input type="checkbox" checked={application.doesNswWork} onChange={(event) => change("doesNswWork", event.target.checked)} />The business performs work in NSW</label>{application.doesNswWork && documentSelect("NSW contractor licence", "contractor_licence", application.contractorLicenceDocumentId, (value) => change("contractorLicenceDocumentId", value))}</section>
          <section className={styles.card}><h4>3. Director</h4>{personFields("director")}</section>
          <section className={styles.card}><h4>4. Guarantor and witness</h4><label className={styles.check}><input type="checkbox" checked={application.directorIsGuarantor} onChange={(event) => change("directorIsGuarantor", event.target.checked)} />The director is also the guarantor</label>{!application.directorIsGuarantor && <>{personFields("guarantor")}<TextField title="Guarantor position" value={application.guarantor.position} onChange={(value) => change("guarantor", { ...application.guarantor, position: value })} /></>}<div className={styles.fields}><TextField title="Witness full name" value={application.witness.name} onChange={(value) => change("witness", { ...application.witness, name: value })} /><TextField title="Witness position" value={application.witness.position} onChange={(value) => change("witness", { ...application.witness, position: value })} /><TextField title="Witness business email" type="email" value={application.witness.email} onChange={(value) => change("witness", { ...application.witness, email: value })} /></div></section>
          <section className={styles.card}><h4>5. Signed agreement and declarations</h4>{documentSelect("Signed Creditex partnership agreement", "partnership_agreement", application.agreementDocumentId, (value) => change("agreementDocumentId", value))}{!application.agreementDocumentId && <div className={styles.notice}><strong>Creditex partnership agreement: document to be supplied</strong><p>You can save your business details and complete training now. A real signed agreement is required before certificate work. If you already have it, upload it under Add supporting documents and select it here.</p></div>}<p className={styles.muted}>Use the agreement already signed by the required parties. Completing this setup records your declarations; it does not sign a contract.</p><label className={styles.check}><input type="checkbox" checked={application.acceptedCompliance} onChange={(event) => change("acceptedCompliance", event.target.checked)} /><span>I am authorised to complete this setup for the business. The information and documents are accurate and current, and the uploaded Creditex partnership agreement is signed. Each person must pass the activity training they need and maintain the required licences and compliance evidence.</span></label></section>
          <label className={styles.check}><input type="checkbox" checked={application.acceptedPrivacy} onChange={(event) => change("acceptedPrivacy", event.target.checked)} /><span>I am authorised to provide these details and documents to Australian Energy Assessments and Creditex for onboarding, identity checks and compliance purposes. I have informed the other people named in this application. <a href="/privacy" target="_blank" rel="noreferrer">Privacy policy</a></span></label>
          {setupComplete && dirty && <p className={styles.notice}>Your changes need to be saved and checked. Complete business setup to update the record before government program work continues.</p>}<div className={styles.actions}><button className={styles.button} disabled={Boolean(busy) || (setupComplete && !dirty)} type="submit">{busy === "submit" ? "Completing setup..." : "Complete business setup"}</button><button className={styles.secondary} disabled={Boolean(busy) || (!dirty && Boolean(data?.application))} type="button" onClick={() => void save()}>{busy === "save" ? "Saving..." : "Save progress"}</button></div>
        </fieldset></form>
      </>}
    </>}
  </section>;
}

export function TradeTrainingWorkspace({ user }: { user: User }) {
  const [data, setData] = useState<TrainingResult | null>(null);
  const [moduleSearch, setModuleSearch] = useState(""); const [programFilter, setProgramFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("todo");
  const [serviceFilter, setServiceFilter] = useState("");
  const [visibleModuleCount, setVisibleModuleCount] = useState(12); const [expandedTeamMember, setExpandedTeamMember] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState("");
  const [selectedId, setSelectedId] = useState(""); const [lessonIndex, setLessonIndex] = useState(0);
  const [readLessons, setReadLessons] = useState<string[]>([]);
  const [attempt, setAttempt] = useState<Attempt | null>(null); const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({}); const [result, setResult] = useState<AssessmentResult | null>(null);
  const [answerFeedback, setAnswerFeedback] = useState<Record<string, AnswerFeedback>>({});
  const [savedForm, setSavedForm] = useState<SubmittedAnswers | null>(null);
  const questionHeading = useRef<HTMLLegendElement | null>(null);
  const lessonHeading = useRef<HTMLHeadingElement | null>(null);
  const initialModuleOpened = useRef(false);
  const acknowledgedLesson = useRef("");
  const startingAssessment = useRef(false);
  const load = useCallback(async () => { const next = await request<TrainingResult>(user, "/api/trade-training"); setData(next); }, [user]);
  useEffect(() => { let active = true; void request<TrainingResult>(user, "/api/trade-training").then((next) => {
    if (!active) return;
    setData(next);
    if (!initialModuleOpened.current) {
      initialModuleOpened.current = true;
      const moduleId = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("module");
      if (!next.officeOnly && moduleId && next.modules.some((module) => module.id === moduleId)) setSelectedId(moduleId);
    }
  }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Training could not be loaded."); }); return () => { active = false; }; }, [user]);
  useEffect(() => { if (attempt) questionHeading.current?.focus(); }, [questionIndex, attempt]);
  useEffect(() => { lessonHeading.current?.focus(); }, [selectedId, lessonIndex]);
  const selected = data?.modules.find((module) => module.id === selectedId);
  const lesson = selected?.lessons[lessonIndex]; const question = attempt?.questions[questionIndex];
  const reviewingPassedModule = selected?.status === "passed" || result?.passed === true;
  const allRead = Boolean(selected && selected.lessons.length && selected.lessons.every((_, index) => readLessons.includes(`${selected.id}:${selected.version}:${index}`)));
  function openModule(module: Module) { acknowledgedLesson.current = ""; setSelectedId(module.id); setLessonIndex(0); setAttempt(null); setResult(null); setAnswers({}); setAnswerFeedback({}); setError(""); }
  async function start(completedLessons: string[]) {
    if (!selected || !selected.lessons.length || !selected.lessons.every((_, index) => completedLessons.includes(`${selected.id}:${selected.version}:${index}`)) || !selected.assessmentAvailable || reviewingPassedModule || busy || startingAssessment.current) return;
    startingAssessment.current = true; setBusy("start"); setError("");
    try { const next = await request<ApiResult & { attempt: Attempt }>(user, "/api/trade-training", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", moduleId: selected.id }) }); setAttempt(next.attempt); setQuestionIndex(Math.min(next.attempt.questions.length - 1, next.attempt.questions.filter(item => next.attempt.feedback?.[item.id]?.correct).length)); setAnswers(next.attempt.answers || {}); setAnswerFeedback(next.attempt.feedback || {}); setResult(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The assessment could not be started."); } finally { startingAssessment.current = false; setBusy(""); }
  }
  function acknowledgeAndContinue(clickCount: number) {
    if (!selected || !lesson || busy || attempt || reviewingPassedModule || clickCount > 1) return;
    const key = `${selected.id}:${selected.version}:${lessonIndex}`;
    const finalLesson = lessonIndex === selected.lessons.length - 1;
    if (!finalLesson && acknowledgedLesson.current === key) return;
    acknowledgedLesson.current = key;
    const completedLessons = [...new Set([...readLessons, key])];
    setReadLessons(completedLessons);
    const firstUnread = selected.lessons.findIndex((_, index) => !completedLessons.includes(`${selected.id}:${selected.version}:${index}`));
    if (firstUnread >= 0 && firstUnread < lessonIndex) {
      acknowledgedLesson.current = ""; setLessonIndex(firstUnread); return;
    }
    if (finalLesson) { void start(completedLessons); return; }
    setLessonIndex(lessonIndex + 1);
  }
  function previousLesson() {
    if (busy || lessonIndex === 0) return;
    acknowledgedLesson.current = "";
    setLessonIndex(lessonIndex - 1);
  }
  async function checkAnswer(answer: string) {
    if (!attempt || !question || busy || answerFeedback[question.id]?.correct) return;
    setAnswers(current => ({ ...current, [question.id]: answer })); setBusy("check"); setError("");
    try {
      const next = await request<ApiResult & { feedback: AnswerFeedback }>(user, "/api/trade-training", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check", attemptId: attempt.id, questionId: question.id, answer }) });
      setAnswerFeedback(current => ({ ...current, [question.id]: next.feedback }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "This answer could not be checked. Try again."); }
    finally { setBusy(""); }
  }
  async function submitQuiz() {
    if (!attempt || busy || attempt.questions.some((item) => !answerFeedback[item.id]?.correct)) return; setBusy("submit"); setError("");
    try { const next = await request<ApiResult & { result: AssessmentResult }>(user, "/api/trade-training", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "submit", attemptId: attempt.id, answers }) }); setResult(next.result); setAttempt(null); void load().catch(() => setError("Your result is saved. Refresh status to update the module list.")); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The assessment could not be submitted."); } finally { setBusy(""); }
  }
  async function openSavedForm(id: string) {
    setBusy("history"); setError("");
    try { const next = await request<ApiResult & { submission: SubmittedAnswers }>(user, `/api/trade-training?submissionId=${encodeURIComponent(id)}`); setSavedForm(next.submission); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "This saved form could not be opened."); }
    finally { setBusy(""); }
  }
  const passed = data?.modules.filter((module) => module.status === "passed").length || 0;
  const pending = (data?.modules.length || 0) - passed + (data?.unavailableActivities?.length || 0);
  const startReason = selected && !selected.assessmentAvailable ? assessmentReason(selected)
    : reviewingPassedModule ? "Your learning pass is recorded. You can review the lessons at any time."
    : !allRead ? "Each button confirms you have read the lesson and its relevant source guidance. The final lesson opens your assessment." : "All lessons are marked read. You are ready to start the assessment.";
  const programs = [...new Set([...(data?.modules || []).map(moduleProgram), ...(data?.unavailableActivities || []).map((item) => item.programCode.replaceAll("-", " "))])].sort();
  const matchingModules = (data?.modules || []).filter((module) => (statusFilter === "all" || (statusFilter === "passed" ? module.status === "passed" : module.status !== "passed")) && (!programFilter || moduleProgram(module) === programFilter)
    && (!serviceFilter || trainingServiceSection(module).id === serviceFilter)
    && `${module.title} ${module.id} ${module.activityTemplateIds.join(" ")} ${serviceLabel(module.serviceCategory)} ${trainingServiceSection(module).label}`.toLowerCase().includes(moduleSearch.trim().toLowerCase()));
  const matchingUnavailable = (data?.unavailableActivities || []).filter((item) => statusFilter !== "passed" && (!programFilter || item.programCode.replaceAll("-", " ") === programFilter)
    && (!serviceFilter || trainingServiceSection(item).id === serviceFilter)
    && `${item.title} ${item.id} ${item.programCode} ${serviceLabel(item.serviceCategory)} ${trainingServiceSection(item).label}`.toLowerCase().includes(moduleSearch.trim().toLowerCase()));

  const assignedSections = new Set([...(data?.modules || []), ...(data?.unavailableActivities || [])].map((item) => trainingServiceSection(item).id));
  const serviceGroups = TRAINING_SERVICE_SECTIONS.filter((service) => assignedSections.has(service.id)).map((service) => ({
      ...service,
      modules: matchingModules.filter((module) => trainingServiceSection(module).id === service.id),
      unavailable: matchingUnavailable.filter((item) => trainingServiceSection(item).id === service.id),
      total: (data?.modules || []).filter((module) => trainingServiceSection(module).id === service.id).length,
      passed: (data?.modules || []).filter((module) => trainingServiceSection(module).id === service.id && module.status === "passed").length,
    })).filter((group) => group.modules.length || group.unavailable.length);
  return <div className={styles.shell}>
    <header className={styles.hero}><span className={styles.eyebrow}>Your compliance to-do list</span><h2>To do &amp; training</h2><p>{data?.officeOnly ? "Your saved team profile has no on-site services. Installation training is not required for office work." : "Saving your on-site services assigns the relevant activity modules here. Complete your own learning and assessments before carrying out government-program work, alongside business setup, current insurance and required credentials."}</p>{data && !data.officeOnly && <><strong>{pending} training {pending === 1 ? "task" : "tasks"} to do</strong><span>{passed} of {data.modules.length} activity modules passed</span></>}</header>
    {!data?.officeOnly && data?.trainingServiceStates?.length ? <p className={styles.muted}>Training for {data.trainingServiceStates.join(", ")}, plus relevant national programs. {data.selectedMember?.isOwner ? "Change your business regions in Business > Services and areas." : "Your business owner or team manager can change your regions in Team > your profile > Service regions. Only regions the business also serves apply."}</p> : null}
    <TradeCreditexOnboarding user={user} />
    {error && <p className={`${styles.notice} ${styles.error}`} role="alert">{error}</p>}
    {!data && !error && <p role="status">Loading your activity training...</p>}
    {data?.officeOnly && <section className={styles.panel} aria-label="Office work training status"><h3>No installation training needed</h3><p>You can book and manage work within your access permissions once the business is eligible for that activity. The technician assigned to carry out the work must have their own current training and credentials.</p><p className={styles.muted}>If you will also carry out on-site work, ask the business owner or team manager to select those services in your Team profile. The relevant training will then appear here.</p></section>}
    {data && !data.officeOnly && <section className={styles.panel} aria-label="Your activity modules"><header><div><h3>Your training to-do list</h3><p className={styles.muted}>Each person carrying out on-site activity work completes their own assessment. Passing records learning completion; business setup, current insurance, licences and job evidence remain required.</p></div><button className={styles.secondary} type="button" disabled={Boolean(busy)} onClick={() => { setError(""); void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Status could not be refreshed.")); }}>Refresh status</button></header>
      {data.selectedMember?.isOwner && <p className={styles.notice}>Your current activity pass counts for both the business training requirement and your own on-site work. You complete each current module once, including when you work alone. Any other on-site team member must earn their own pass.</p>}
      <div className={styles.fields}><label className={styles.field}>Find an activity<input type="search" value={moduleSearch} placeholder="Activity number, program or work type" onChange={(event) => { setModuleSearch(event.target.value); setVisibleModuleCount(12); }} /></label><label className={styles.field}>Service category<select aria-label="Service category" value={serviceFilter} onChange={(event) => { setServiceFilter(event.target.value); setVisibleModuleCount(12); }}><option value="">All assigned services</option>{TRAINING_SERVICE_SECTIONS.filter((service) => assignedSections.has(service.id)).map((service) => <option key={service.id} value={service.id}>{service.label}</option>)}</select></label><label className={styles.field}>Program<select aria-label="Program" value={programFilter} onChange={(event) => { setProgramFilter(event.target.value); setVisibleModuleCount(12); }}><option value="">All programs</option>{programs.map((program) => <option key={program} value={program}>{program}</option>)}</select></label><label className={styles.field}>Status<select aria-label="Training status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setVisibleModuleCount(12); }}><option value="todo">To do</option><option value="passed">Passed</option><option value="all">All modules</option></select></label></div>
      <p className={styles.muted}>Training is grouped by the services in Business and Team. Complete the module for the activity you will carry out. The list already reflects your service states and relevant national programs.</p>
      <small>{matchingModules.length + matchingUnavailable.length} matching activities across {serviceGroups.length} training sections.</small>
      {serviceGroups.map((group) => <details className={styles.serviceGroup} key={group.id} open={serviceGroups.length === 1 || Boolean(moduleSearch)}>
        <summary><span><strong>{group.label}</strong><small>{group.modules.length + group.unavailable.length} matching {group.modules.length + group.unavailable.length === 1 ? "activity" : "activities"}</small></span><span className={styles.badge}>{group.passed} of {group.total} modules passed</span></summary>
        <div className={styles.serviceContent}><p className={styles.muted}>Choose the activity for your {group.label.toLowerCase()} work. Each activity has its own required training and a 100% pass mark.</p><div className={styles.grid}>{group.modules.slice(0, visibleModuleCount).map((module) => <article className={styles.card} key={module.id}><header><div><small>{module.activityTemplateIds.join(" · ")}</small><h4>{module.title}</h4></div><span className={`${styles.badge} ${module.status === "passed" ? styles.passed : ""}`}>{module.status === "passed" ? "✓ Passed" : learningStatus(module.status)}</span></header><p className={styles.requirement}>Required for {group.label} jobs using this activity under {moduleProgram(module)}. The business owner and the technician doing this work need current passes. Office staff can book eligible work within their permissions.</p><p className={styles.muted}>{module.estimatedMinutes} minutes · Version {module.version} · Pass mark {module.passPercent}%</p>{module.businessServiceEnabled === false && <p className={styles.notice}>You can study this activity now. The business owner must also enable this service in Business settings before programme work can be booked.</p>}{module.completion && module.status === "passed" && <div className={styles.completion}><strong>Learning completion reference</strong><code>{module.completion.reference}</code><small>Valid until {date(module.completion.expiresAt)}</small></div>}{!module.assessmentAvailable && <p className={styles.notice}>{assessmentReason(module)}</p>}<button type="button" className={styles.secondary} onClick={() => openModule(module)} disabled={Boolean(busy)}>{module.status === "passed" ? "Review learning material" : "Open learning material"}</button></article>)}</div>
          {group.modules.length > visibleModuleCount && <button className={styles.secondary} type="button" onClick={() => setVisibleModuleCount((count) => count + 12)}>Show 12 more activities for {group.label}</button>}
          {group.unavailable.length > 0 && <div className={styles.notice}><strong>These activities remain locked</strong><p>A complete activity-specific curriculum is needed before this work can be enabled.</p>{group.unavailable.map((item) => <p key={item.id}><strong>{item.programCode} · {item.title}</strong><br /><span className={styles.muted}>{item.message}</span></p>)}</div>}
        </div>
      </details>)}
      {(data.modules.length > 0 || Boolean(data.unavailableActivities?.length)) && !serviceGroups.length && <p>No activity matches these filters. Change the search, service, program or status.</p>}
      {!data.modules.length && !data.unavailableActivities?.length && <p>No activity modules are assigned to your current work types and service locations. The business owner should check service selections in Business settings and each person&apos;s capabilities in Team. An empty list does not approve government program work.</p>}
    </section>}
    {selected && !data?.officeOnly && <section className={styles.panel} aria-label={`${selected.title} learning and assessment`}><header><div><span className={styles.eyebrow}>{selected.activityTemplateIds.join(" · ")}</span><h3>{selected.title}</h3><p className={styles.muted}>Service: {trainingServiceSection(selected).label} · Required for this activity under {moduleProgram(selected)}</p></div><span className={styles.badge}>Version {selected.version}</span></header>
      {!attempt && <>{lesson && <div className={styles.lesson}>
        <div className={styles.row}><strong>Lesson {lessonIndex + 1} of {selected.lessons.length}</strong>{!reviewingPassedModule && <small>{readLessons.filter((key) => key.startsWith(`${selected.id}:${selected.version}:`)).length} marked read</small>}</div>
        <progress className={styles.progress} value={lessonIndex + 1} max={selected.lessons.length} aria-label="Lesson progress" />
        <h4 ref={lessonHeading} tabIndex={-1}>{lesson.title}</h4><p className={styles.lessonBody}>{lesson.body}</p>
        <ul className={styles.sources}>{lesson.sourceIds.map((id) => selected.sources.find((source) => source.id === id)).filter((source): source is Source => Boolean(source && learnerSource(source))).map((source) => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul>
        {error && <p className={`${styles.notice} ${styles.error}`} role="alert">{error}</p>}
        <div className={styles.actions}>
          <button className={styles.secondary} type="button" disabled={lessonIndex === 0 || Boolean(busy)} onClick={previousLesson}>Previous lesson</button>
          {reviewingPassedModule ? lessonIndex < selected.lessons.length - 1 && <button className={styles.secondary} type="button" onClick={() => setLessonIndex(lessonIndex + 1)}>Next lesson</button>
            : lessonIndex === selected.lessons.length - 1 && allRead && !selected.assessmentAvailable ? <strong role="status">Lessons complete</strong>
              : <button key={`${selected.id}:${selected.version}:${lessonIndex}`} className={styles.button} type="button" disabled={Boolean(busy)} aria-describedby="training-assessment-readiness" onClick={(event) => acknowledgeAndContinue(event.detail)}>
                {busy === "start" ? "Starting..." : lessonIndex < selected.lessons.length - 1 ? "I have read this. Continue" : !selected.assessmentAvailable ? "I have read this lesson" : allRead ? "Start assessment" : "I have read this. Start assessment"}
              </button>}
        </div>
        <small id="training-assessment-readiness" role="status">{startReason}</small>
      </div>}
        {!reviewingPassedModule && <div className={styles.notice}><p>Choose an answer to check it straight away. If it is incorrect, read the explanation and try another answer. Complete every question correctly to pass. There is no limit on corrections.</p></div>}
      </>}
      {attempt && question && <><div className={styles.row}><strong>Question {questionIndex + 1} of {attempt.questions.length}</strong><small>{Object.keys(answers).length} answered</small></div><progress className={styles.progress} value={questionIndex + 1} max={attempt.questions.length} aria-label="Assessment progress" /><fieldset className={styles.question} disabled={Boolean(busy) || answerFeedback[question.id]?.correct}><legend ref={questionHeading} tabIndex={-1}>{question.prompt}</legend>{question.options.map((option) => <label key={option.id} className={styles.option}><input type="radio" name={`question-${question.id}`} value={option.id} checked={answers[question.id] === option.id} onChange={() => void checkAnswer(option.id)} /><span>{option.text}</span></label>)}</fieldset>{busy === "check" && <p role="status">Checking your answer...</p>}{answerFeedback[question.id] && <div className={answerFeedback[question.id].correct ? styles.completion : styles.notice} role="status"><strong>{answerFeedback[question.id].correct ? "Correct" : "Incorrect answer. Read this explanation, then choose again."}</strong><p>{answerFeedback[question.id].correctAnswer}</p><p>{answerFeedback[question.id].explanation}</p></div>}{error && <p className={`${styles.notice} ${styles.error}`} role="alert">{error}</p>}{answers[question.id] && !answerFeedback[question.id]?.correct && !busy && <button className={styles.secondary} type="button" onClick={() => void checkAnswer(answers[question.id])}>Check selected answer</button>}<div className={styles.actions}><button className={styles.secondary} type="button" disabled={questionIndex === 0 || Boolean(busy)} onClick={() => setQuestionIndex((value) => value - 1)}>Previous question</button>{questionIndex < attempt.questions.length - 1 ? <button className={styles.button} type="button" disabled={!answerFeedback[question.id]?.correct || Boolean(busy)} onClick={() => setQuestionIndex((value) => value + 1)}>Next question</button> : <button className={styles.button} type="button" disabled={attempt.questions.some((item) => !answerFeedback[item.id]?.correct) || Boolean(busy)} onClick={() => void submitQuiz()}>{busy === "submit" ? "Submitting..." : "Submit assessment"}</button>}</div><small>Checked answers are saved as you go. Reopen this module to resume before the attempt expires on {date(attempt.expiresAt)}.</small></>}
      {result && <div className={result.passed ? styles.completion : styles.notice} role="status"><h4>{result.passed ? "✓ Assessment passed" : "More learning is needed"}</h4><p>Your score: {result.scorePercent}%. {result.firstTryScorePercent !== undefined && <>First answers: {result.firstTryScorePercent}% correct before corrections. </>} {result.criticalPassed ? "Mandatory compliance questions passed." : "One or more mandatory compliance questions need review."}</p>{result.passed ? <><strong>Learning completion reference</strong><code>{result.reference}</code><small>Valid until {date(result.expiresAt)}. This is a training record, not a government certificate, licence or accreditation.</small></> : <p>Review the activity lessons and official sources before starting a new assessment.</p>}</div>}
      {result?.feedback && <section className={styles.shell} aria-label="Assessment learning feedback"><h4>Review your assessment</h4>{result.feedback.map((item, index) => <details className={styles.details} key={item.questionId}><summary>{item.correct ? "✓ Correct" : "Review required"}: question {index + 1}</summary><div><p><strong>{item.prompt}</strong></p><p>Correct answer: {item.correctAnswer}</p><p>{item.explanation}</p><ul className={styles.sources}>{item.sourceIds.map((id) => selected.sources.find((source) => source.id === id)).filter((source): source is Source => Boolean(source && learnerSource(source))).map((source) => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul></div></details>)}</section>}
    </section>}
    {Boolean(data?.submissions?.length) && <section className={styles.panel} aria-label="Your compliance profile"><h3>Your saved training forms</h3><p>These records keep the questions and your answers as they were when you submitted them.</p>{data?.submissions?.map(form => <div className={styles.person} key={form.id}><strong>{data.modules.find(module => module.id === form.moduleId)?.title || form.moduleId}</strong><p>{form.scorePercent}% complete · {form.firstTryScorePercent}% correct first time · {date(form.completedAt)}</p><button className={styles.secondary} type="button" disabled={Boolean(busy)} onClick={() => void openSavedForm(form.id)}>View submitted answers</button></div>)}{savedForm && <article className={styles.card}><h4>{savedForm.snapshot.title}</h4><p>Version {savedForm.version} · {savedForm.reference}</p>{savedForm.snapshot.questions.map((item, index) => <details key={item.id}><summary>{index + 1}. {item.prompt}</summary><p>Your final answer: {item.options.find(option => option.id === item.selectedOptionId)?.text}</p><p>{item.explanation}</p></details>)}</article>}</section>}
    {data?.team && <section className={styles.panel} aria-label="Team training progress"><h3>Team progress</h3><p className={styles.muted}>Current training status only. Team members&apos; answers and private onboarding identity documents are not shown here.</p>{data.team.map((person) => <div className={styles.person} key={person.memberId}><button className={styles.secondary} type="button" aria-expanded={expandedTeamMember === person.memberId} onClick={() => setExpandedTeamMember((current) => current === person.memberId ? "" : person.memberId)}>{person.displayName} · {person.officeOnly ? "Office only · no installation training required" : `${person.modules.filter((item) => item.status === "passed").length}/${person.modules.length} passed`}</button>{expandedTeamMember === person.memberId && person.officeOnly && <p className={styles.muted}>No on-site services are selected. Office work follows this person&apos;s access permissions; the business and assigned technician must meet the activity requirements.</p>}{expandedTeamMember === person.memberId && !person.officeOnly && <div className={styles.scroll}><table className={styles.table}><thead><tr><th>Service</th><th>Activity</th><th>Status</th><th>Completion reference</th></tr></thead><tbody>{person.modules.map((module) => <tr key={module.id}><td data-label="Service">{trainingServiceSection(module).label}</td><td data-label="Activity">{module.title}</td><td data-label="Status">{learningStatus(module.status)}</td><td data-label="Completion reference">{module.reference || "Not passed"}{module.expiresAt && <><br /><small>Until {date(module.expiresAt)}</small></>}</td></tr>)}</tbody></table></div>}</div>)}</section>}
  </div>;
}
