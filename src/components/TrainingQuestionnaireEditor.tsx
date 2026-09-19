"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TradeTrainingModule } from "@/data/creditex-training-curriculum";
import styles from "./TrainingQuestionnaireEditor.module.css";

type Api = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
type Assignment = import("@/lib/training-questionnaire-store").TrainingAssignment;
type Questionnaire = import("@/lib/training-questionnaire-store").TrainingQuestionnaire;
type ModuleSummary = import("@/lib/training-questionnaire-store").TrainingQuestionnaireSummary;
type Version = import("@/lib/training-questionnaire-store").TrainingQuestionnaireVersion;
type Submission = import("@/lib/training-questionnaire-store").TrainingSubmissionSummary;
type Person = import("@/lib/training-questionnaire-store").TrainingSubmissionPerson;
type SubmissionCursor = { completedAt: string; id: string };
type SubmittedForm = import("@/lib/training-questionnaire-store").TrainingSubmissionDetail;
type Catalogue = { modules: ModuleSummary[]; programs: { programCode: string; name: string; jurisdiction: string }[]; services: { id: string; label: string }[] };
const endpoint = "/api/creditex-training-questionnaires";
const states = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"];

function newQuestion(sourceIds: string[]): TradeTrainingModule["questions"][number] {
  return { id: `q-${crypto.randomUUID()}`, prompt: "", options: [{ id: "a", text: "" }, { id: "b", text: "" }, { id: "c", text: "" }, { id: "d", text: "" }], correctOptionId: "a", critical: true, explanation: "", sourceIds };
}
function newQuestionnaire(): Questionnaire {
  return {
    module: { id: "", title: "", programCode: "", version: "", activityTemplateIds: [], estimatedMinutes: 25, passPercent: 100, validityDays: 365, retakeCooldownMinutes: 0, reviewStatus: "published", scope: "", sourceCoverage: { status: "source_transcribed", gaps: [] },
      questions: [newQuestion(["source-1"])], lessons: [{ title: "Before you start", body: "", sourceIds: ["source-1"] }], sources: [{ id: "source-1", title: "", url: "" }] },
    assignment: { kind: "additional", serviceCategory: "", jurisdictions: [], activityLabel: "" }, revision: 0, publishedVersion: "", publishedAt: "", updatedAt: "", hasDraft: true,
  };
}
function dateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Not yet" : date.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }); }
function failure(reason: unknown) { return reason instanceof Error ? reason.message : "The request could not be completed. Your changes are still here."; }
function safeSource(url: string) {
  if (url.startsWith("/creditex-resources/")) return /^\/creditex-resources\/[a-zA-Z0-9._-]+\.pdf$/.test(url);
  try { const parsed = new URL(url); return parsed.protocol === "https:" && !parsed.username && !parsed.password && !/\.md(?:$|[?#])/i.test(url); } catch { return false; }
}

// The authenticated endpoint returns these DTOs. Keep their boundary here, away from form state.
function catalogueResult(result: Record<string, unknown>): Catalogue {
  if (!Array.isArray(result.modules) || !Array.isArray(result.programs) || !Array.isArray(result.services)) throw new Error("The questionnaire list could not be read. Try loading it again.");
  return { modules: result.modules as ModuleSummary[], programs: result.programs as Catalogue["programs"], services: result.services as Catalogue["services"] };
}
function questionnaireResult(result: Record<string, unknown>): Questionnaire {
  const value = result.questionnaire;
  if (!value || typeof value !== "object" || !("module" in value) || !("revision" in value) || !("assignment" in value)) throw new Error("The questionnaire could not be read. Try loading it again.");
  return value as Questionnaire;
}

export function TrainingQuestionnaireEditor({ api, canEdit, onDirtyChange }: { api: Api; canEdit: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [submissionCursor, setSubmissionCursor] = useState<SubmissionCursor | null>(null);
  const [submission, setSubmission] = useState<SubmittedForm | null>(null);
  const [view, setView] = useState<"questions" | "profiles">("questions");
  const [search, setSearch] = useState("");
  const [person, setPerson] = useState("");
  const [index, setIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [checkedSources, setCheckedSources] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const loadSequence = useRef(0);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([api(path, { ...init, signal: controller.signal }), new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { controller.abort(); reject(new Error("The service took too long to respond. Your edits are still here. Reload the saved form before retrying a save or publish.")); }, 25_000);
      })]);
    } finally { clearTimeout(timeout); }
  }, [api]);

  useEffect(() => {
    let active = true;
    void request(endpoint).then((result) => { if (active) setCatalogue(catalogueResult(result)); }).catch((reason: unknown) => { if (active) setError(failure(reason)); });
    return () => { active = false; loadSequence.current += 1; };
  }, [request]);

  useEffect(() => {
    onDirtyChange?.(dirty || busy === "save" || busy === "publish");
    return () => onDirtyChange?.(false);
  }, [dirty, busy, onDirtyChange]);
  useEffect(() => {
    if (!dirty && busy !== "save" && busy !== "publish") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);

  function mayDiscard() { return !dirty || window.confirm("Discard the unsaved changes to this questionnaire?"); }
  async function loadModule(moduleId: string) {
    if (!mayDiscard()) return;
    const sequence = ++loadSequence.current;
    setError(""); setNotice(""); setBusy("load");
    try {
      const result = await request(`${endpoint}?moduleId=${encodeURIComponent(moduleId)}`);
      if (sequence !== loadSequence.current) return;
      setQuestionnaire(questionnaireResult(result)); setVersions(Array.isArray(result.versions) ? result.versions as Version[] : []);
      setIndex(0); setDirty(false); setCheckedSources(false);
    } catch (reason) { if (sequence === loadSequence.current) setError(failure(reason)); }
    finally { if (sequence === loadSequence.current) setBusy(""); }
  }
  function create() {
    if (!canEdit || !mayDiscard()) return;
    ++loadSequence.current; setQuestionnaire(newQuestionnaire()); setVersions([]); setDirty(true); setIndex(0); setCheckedSources(false); setError(""); setNotice(""); setView("questions");
  }
  function changeModule(change: Partial<TradeTrainingModule>) {
    setQuestionnaire((current) => current ? { ...current, module: { ...current.module, ...change } } : null); setDirty(true); setNotice(""); setCheckedSources(false);
  }
  function changeAssignment(change: Partial<Assignment>) {
    setQuestionnaire((current) => current ? { ...current, assignment: { ...current.assignment, ...change } } : null); setDirty(true); setNotice(""); setCheckedSources(false);
  }
  function changeQuestion(change: Partial<TradeTrainingModule["questions"][number]>) {
    if (!questionnaire) return;
    changeModule({ questions: questionnaire.module.questions.map((question, questionIndex) => questionIndex === index ? { ...question, ...change } : question) });
  }
  function removeQuestion() {
    if (!questionnaire) return;
    changeModule({ questions: questionnaire.module.questions.filter((_, questionIndex) => questionIndex !== index) }); setIndex(Math.max(0, index - 1));
  }
  function moveQuestion(direction: -1 | 1) {
    if (!questionnaire) return;
    const nextIndex = index + direction;
    const questions = [...questionnaire.module.questions];
    if (nextIndex < 0 || nextIndex >= questions.length) return;
    [questions[index], questions[nextIndex]] = [questions[nextIndex], questions[index]];
    changeModule({ questions }); setIndex(nextIndex);
  }
  async function save(publish: boolean) {
    if (!questionnaire || !canEdit || busy || (publish && (!checkedSources || !hasUnpublishedChanges))) return;
    setBusy(publish ? "publish" : "save"); setError(""); setNotice("");
    try {
      let saved = questionnaire;
      if (dirty || !saved.module.id) {
        const result = await request(endpoint, { method: "POST", body: JSON.stringify({ action: "save_draft", moduleId: saved.module.id || undefined, expectedRevision: saved.revision, module: saved.module, assignment: saved.assignment }) });
        saved = questionnaireResult(result); setQuestionnaire(saved); setDirty(false);
      }
      if (publish) {
        const result = await request(endpoint, { method: "POST", body: JSON.stringify({ action: "publish", moduleId: saved.module.id, expectedRevision: saved.revision, sourcesChecked: true }) });
        saved = questionnaireResult(result); setQuestionnaire(saved); setCheckedSources(false);
        setNotice("Published. Learners will use this version. Previously submitted answers remain saved with the version they completed.");
      } else { setNotice("Draft saved. Learners continue to see the published version until you publish your changes."); }
      const [list, detail] = await Promise.all([request(endpoint), request(`${endpoint}?moduleId=${encodeURIComponent(saved.module.id)}`)]);
      setCatalogue(catalogueResult(list)); setVersions(Array.isArray(detail.versions) ? detail.versions as Version[] : []);
    } catch (reason) { setError(failure(reason)); }
    finally { setBusy(""); }
  }
  function applySubmissionPage(result: Record<string, unknown>, append = false) {
    if (!Array.isArray(result.submissions)) throw new Error("The submitted forms could not be read. Try loading them again.");
    const page = result.submissions as Submission[];
    setSubmissions((current) => append ? [...current, ...page.filter((record) => !current.some((saved) => saved.id === record.id))] : page);
    const cursor = result.nextCursor;
    setSubmissionCursor(cursor && typeof cursor === "object" && "completedAt" in cursor && typeof cursor.completedAt === "string" && "id" in cursor && typeof cursor.id === "string" ? { completedAt: cursor.completedAt, id: cursor.id } : null);
  }
  async function openProfiles() {
    setView("profiles"); setError(""); setBusy("profiles");
    try { const result = await request(`${endpoint}?view=submissions`); setPeople(Array.isArray(result.people) ? result.people as Person[] : []); applySubmissionPage(result); setPerson(""); setSubmission(null); }
    catch (reason) { setError(failure(reason)); } finally { setBusy(""); }
  }
  async function selectPerson(personKey: string) {
    setPerson(personKey); setSubmission(null); setError(""); setBusy("profiles"); setSubmissions([]); setSubmissionCursor(null);
    const selected = people.find((record) => personKey === JSON.stringify([record.ownerUid, record.memberId]));
    try {
      const query = selected ? `&ownerUid=${encodeURIComponent(selected.ownerUid)}&memberId=${encodeURIComponent(selected.memberId)}` : "";
      const result = await request(`${endpoint}?view=submissions${query}`);
      applySubmissionPage(result);
    } catch (reason) { setError(failure(reason)); } finally { setBusy(""); }
  }
  async function loadOlderSubmissions() {
    if (!submissionCursor || busy) return;
    setError(""); setBusy("older");
    const selected = people.find((record) => person === JSON.stringify([record.ownerUid, record.memberId]));
    try {
      const query = selected ? `&ownerUid=${encodeURIComponent(selected.ownerUid)}&memberId=${encodeURIComponent(selected.memberId)}` : "";
      const result = await request(`${endpoint}?view=submissions${query}&beforeCompletedAt=${encodeURIComponent(submissionCursor.completedAt)}&beforeId=${encodeURIComponent(submissionCursor.id)}`);
      applySubmissionPage(result, true);
    } catch (reason) { setError(failure(reason)); } finally { setBusy(""); }
  }
  async function openSubmission(id: string) {
    setError(""); setBusy("submission");
    try {
      const result = await request(`${endpoint}?submissionId=${encodeURIComponent(id)}`);
      if (!result.submission || typeof result.submission !== "object") throw new Error("The saved form could not be read.");
      setSubmission(result.submission as SubmittedForm);
    } catch (reason) { setError(failure(reason)); } finally { setBusy(""); }
  }

  const course = questionnaire?.module;
  const question = course?.questions[index];
  const isNew = Boolean(questionnaire && !course?.id);
  const locked = !canEdit || Boolean(busy);
  const hasUnpublishedChanges = dirty || questionnaire?.hasDraft === true;
  const selectedProgram = catalogue?.programs.find((program) => program.programCode === course?.programCode);
  const visibleModules = catalogue?.modules.filter((item) => `${item.title} ${item.programCode} ${item.id}`.toLowerCase().includes(search.toLowerCase())) || [];
  const visibleSubmissions = submissions.filter((record) => !person || JSON.stringify([record.ownerUid, record.memberId]) === person);

  return <div className={styles.shell}>
    <header className={styles.header}><div><h2>Compliance activation questions</h2><p className={styles.muted}>Choose an activity, write clear questions and explain each correct answer. Every learner must answer every question correctly.</p></div>{canEdit && <button className={styles.button} type="button" disabled={Boolean(busy)} onClick={create}>Create questionnaire</button>}</header>
    <nav className={styles.actions} aria-label="Compliance questions views"><button className={view === "questions" ? styles.button : styles.secondary} type="button" aria-pressed={view === "questions"} disabled={Boolean(busy)} onClick={() => setView("questions")}>Questionnaires</button><button className={view === "profiles" ? styles.button : styles.secondary} type="button" aria-pressed={view === "profiles"} disabled={Boolean(busy)} onClick={() => void openProfiles()}>Trade compliance profiles</button></nav>
    {error && <p className={`${styles.notice} ${styles.error}`} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
    {!catalogue && !error && <p role="status">Loading questionnaires...</p>}
    {!catalogue && error && <button className={styles.secondary} type="button" disabled={Boolean(busy)} onClick={() => { setError(""); void request(endpoint).then((result) => setCatalogue(catalogueResult(result))).catch((reason: unknown) => setError(failure(reason))); }}>Reload questionnaires</button>}
    {view === "questions" && catalogue && <>
      <section className={styles.panel} aria-label="Choose an activity"><div className={styles.fields}><label className={styles.field}>Find an activity<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Activity number, name or program" /></label><label className={styles.field}>Questionnaire<select value={visibleModules.some((item) => item.id === course?.id) ? course?.id : ""} disabled={Boolean(busy)} onChange={(event) => { if (event.target.value) void loadModule(event.target.value); }}><option value="">Choose an activity</option>{visibleModules.map((item) => <option key={item.id} value={item.id}>{item.title}{item.hasDraft ? " · draft changes" : ""}</option>)}</select></label></div><small>{visibleModules.length} questionnaires found. Saved drafts are private until you publish them.</small></section>
      {busy === "load" && <p role="status">Loading the questionnaire...</p>}
      {questionnaire && course && <>
        <section className={styles.panel}><header className={styles.row}><div><h3>{isNew ? "New activity questionnaire" : course.title}</h3><small>{questionnaire.publishedVersion ? `Published version ${questionnaire.publishedVersion}` : "Not published yet"}</small></div><span className={styles.badge}>{dirty ? "Unsaved changes" : "Saved"}</span></header>
          <div className={styles.fields}><label className={styles.field}>Activity name<input value={course.title} maxLength={240} disabled={locked} onChange={(event) => changeModule({ title: event.target.value })} placeholder="For example, heat pump installation" /></label><label className={styles.field}>Program<select value={course.programCode} disabled={locked || !isNew} onChange={(event) => { const program = catalogue.programs.find((item) => item.programCode === event.target.value); changeModule({ programCode: event.target.value }); changeAssignment({ jurisdictions: program && states.includes(program.jurisdiction) ? [program.jurisdiction] : [] }); }}><option value="">Choose a program</option>{catalogue.programs.map((program) => <option key={program.programCode} value={program.programCode}>{program.name}</option>)}</select></label></div>
          <label className={styles.field}>What does this training cover?<textarea value={course.scope} rows={3} disabled={locked} onChange={(event) => changeModule({ scope: event.target.value })} placeholder="Say what the installer needs to know before carrying out this work." /></label>
          {questionnaire.assignment.kind === "additional" && <><div className={styles.fields}><label className={styles.field}>Service that needs this training<select value={questionnaire.assignment.serviceCategory} disabled={locked || !isNew} onChange={(event) => changeAssignment({ serviceCategory: event.target.value })}><option value="">Choose a service</option>{catalogue.services.map((service) => <option key={service.id} value={service.id}>{service.label}</option>)}</select></label><label className={styles.field}>Activity label<input value={questionnaire.assignment.activityLabel} maxLength={240} disabled={locked || !isNew} onChange={(event) => changeAssignment({ activityLabel: event.target.value })} placeholder="For example, Activity 48 ceiling insulation" /></label></div><div className={styles.stack}><strong>Where is this training needed?</strong><div className={styles.checks}>{[...(!states.includes(selectedProgram?.jurisdiction || "") ? ["AU"] : []), ...states].map((state) => <label className={styles.check} key={state}><input type="checkbox" checked={questionnaire.assignment.jurisdictions.includes(state)} disabled={locked || !isNew || (states.includes(selectedProgram?.jurisdiction || "") && state !== selectedProgram?.jurisdiction)} onChange={(event) => changeAssignment({ jurisdictions: event.target.checked ? state === "AU" ? ["AU"] : [...questionnaire.assignment.jurisdictions.filter((value) => value !== "AU"), state] : questionnaire.assignment.jurisdictions.filter((value) => value !== state) })} />{state === "AU" ? "Australia wide" : state}</label>)}</div><small>Added training is assigned to people offering this service in these states. Government job eligibility still follows the program&apos;s activity rules.</small></div></>}
          {questionnaire.assignment.kind === "catalogue" && <small>The activity&apos;s existing service and state rules stay attached to this questionnaire.</small>}
        </section>
        <section className={styles.panel} aria-label="Edit questions"><header className={styles.row}><div><h3>Questions and answers</h3><p className={styles.muted}>Use a real job situation. Keep the choices clearly different, then explain why the right choice matters.</p></div><button className={styles.secondary} type="button" disabled={locked || course.questions.length >= 60} onClick={() => { changeModule({ questions: [...course.questions, newQuestion(course.sources.map((source) => source.id))] }); setIndex(course.questions.length); }}>Add question</button></header>
          <div className={styles.questionLayout}><nav className={styles.questionList} aria-label="Questions">{course.questions.map((item, questionIndex) => <button className={styles.questionLink} type="button" key={item.id} aria-current={index === questionIndex} aria-label={`Edit question ${questionIndex + 1}`} onClick={() => setIndex(questionIndex)}><strong>{questionIndex + 1}</strong><span>{item.prompt || "New question"}</span></button>)}</nav>
            {question && <div className={styles.question}><header className={styles.row}><h4>Question {index + 1} of {course.questions.length}</h4><div className={styles.actions}><button className={styles.secondary} type="button" disabled={locked || index === 0} onClick={() => moveQuestion(-1)}>Move up</button><button className={styles.secondary} type="button" disabled={locked || index === course.questions.length - 1} onClick={() => moveQuestion(1)}>Move down</button><button className={styles.danger} type="button" disabled={locked || course.questions.length <= 1} onClick={removeQuestion}>Remove question</button></div></header>
              <label className={styles.field}>Question<textarea value={question.prompt} rows={3} disabled={locked} onChange={(event) => changeQuestion({ prompt: event.target.value })} /></label>
              <p className={styles.muted}>Write the answer choices. Select the circle beside the correct answer.</p>
              {question.options.map((option, optionIndex) => <div key={`${question.id}:${option.id}`} className={styles.option}><label className={styles.check}><input type="radio" name={`correct-${question.id}`} aria-label={`Answer ${optionIndex + 1} is correct`} checked={question.correctOptionId === option.id} disabled={locked} onChange={() => changeQuestion({ correctOptionId: option.id })} /></label><label className={styles.field}>Answer {optionIndex + 1}{question.correctOptionId === option.id ? " · correct" : ""}<textarea value={option.text} rows={2} disabled={locked} onChange={(event) => changeQuestion({ options: question.options.map((item) => item.id === option.id ? { ...item, text: event.target.value } : item) })} /></label><button className={styles.secondary} type="button" disabled={locked || question.options.length <= 2} aria-label={`Remove answer ${optionIndex + 1}`} onClick={() => { const options = question.options.filter((item) => item.id !== option.id); changeQuestion({ options, correctOptionId: question.correctOptionId === option.id ? options[0].id : question.correctOptionId }); }}>Remove</button></div>)}
              <div><button className={styles.secondary} type="button" disabled={locked || question.options.length >= 6} onClick={() => changeQuestion({ options: [...question.options, { id: `option-${crypto.randomUUID()}`, text: "" }] })}>Add answer choice</button></div>
              <label className={styles.field}>Why is this answer correct?<textarea rows={4} value={question.explanation} disabled={locked} onChange={(event) => changeQuestion({ explanation: event.target.value })} placeholder="Explain what the installer should do, why it matters, and what would go wrong with the other choices." /><small>This explanation appears when the learner checks their answer.</small></label>
              <details className={styles.details}><summary>Sources for this answer</summary><div className={styles.stack}>{course.sources.map((source) => <label key={source.id} className={styles.check}><input type="checkbox" disabled={locked} checked={question.sourceIds.includes(source.id)} onChange={(event) => changeQuestion({ sourceIds: event.target.checked ? [...question.sourceIds, source.id] : question.sourceIds.filter((id) => id !== source.id) })} />{source.title || "Untitled source"}</label>)}</div></details>
            </div>}
          </div>
        </section>
        <details className={styles.details}><summary>Learning material ({course.lessons.length} lessons)</summary><div className={styles.stack}>{course.lessons.map((lesson, lessonIndex) => <div className={`${styles.stack} ${lessonIndex ? styles.divider : ""}`} key={lessonIndex}><label className={styles.field}>Lesson {lessonIndex + 1} title<input value={lesson.title} disabled={locked} onChange={(event) => changeModule({ lessons: course.lessons.map((item, position) => position === lessonIndex ? { ...item, title: event.target.value } : item) })} /></label><label className={styles.field}>Lesson content<textarea rows={5} value={lesson.body} disabled={locked} onChange={(event) => changeModule({ lessons: course.lessons.map((item, position) => position === lessonIndex ? { ...item, body: event.target.value } : item) })} /></label><fieldset className={styles.lessonSources}><legend>Resources for lesson {lessonIndex + 1}</legend>{course.sources.map((source) => <label className={styles.check} key={source.id}><input type="checkbox" disabled={locked} checked={lesson.sourceIds.includes(source.id)} onChange={(event) => changeModule({ lessons: course.lessons.map((item, position) => position === lessonIndex ? { ...item, sourceIds: event.target.checked ? [...item.sourceIds, source.id] : item.sourceIds.filter((id) => id !== source.id) } : item) })} />{source.title || "Untitled source"}</label>)}</fieldset><div className={styles.actions}><button className={styles.secondary} type="button" disabled={locked || course.lessons.length <= 1} onClick={() => changeModule({ lessons: course.lessons.filter((_, position) => position !== lessonIndex) })}>Remove lesson {lessonIndex + 1}</button></div></div>)}<button className={styles.secondary} type="button" disabled={locked} onClick={() => changeModule({ lessons: [...course.lessons, { title: "", body: "", sourceIds: course.sources.map((source) => source.id) }] })}>Add lesson</button></div></details>
        <details className={styles.details}><summary>Official resources ({course.sources.length})</summary><div className={styles.stack}>{course.sources.map((source, sourceIndex) => <div key={source.id} className={`${styles.stack} ${sourceIndex ? styles.divider : ""}`}><div className={styles.fields}><label className={styles.field}>Resource title<input value={source.title} disabled={locked} onChange={(event) => changeModule({ sources: course.sources.map((item) => item.id === source.id ? { ...item, title: event.target.value } : item) })} /></label><label className={styles.field}>Official webpage or supplied PDF<input value={source.url} disabled={locked} onChange={(event) => changeModule({ sources: course.sources.map((item) => item.id === source.id ? { ...item, url: event.target.value } : item) })} placeholder="https://..." /></label></div><div className={styles.actions}>{safeSource(source.url) && <a className={styles.sourceLink} href={source.url} target="_blank" rel="noreferrer">Open resource</a>}<button className={styles.secondary} type="button" disabled={locked || course.sources.length <= 1} onClick={() => changeModule({ sources: course.sources.filter((item) => item.id !== source.id), questions: course.questions.map((item) => ({ ...item, sourceIds: item.sourceIds.filter((id) => id !== source.id) })), lessons: course.lessons.map((item) => ({ ...item, sourceIds: item.sourceIds.filter((id) => id !== source.id) })) })}>Remove resource</button></div></div>)}<button className={styles.secondary} type="button" disabled={locked} onClick={() => changeModule({ sources: [...course.sources, { id: `source-${crypto.randomUUID()}`, title: "", url: "" }] })}>Add official resource</button></div></details>
        <section className={styles.panel}><div className={styles.fields}><label className={styles.field}>Estimated learning time (minutes)<input type="number" min={1} max={180} value={course.estimatedMinutes} disabled={locked} onChange={(event) => changeModule({ estimatedMinutes: Number(event.target.value) })} /></label><label className={styles.field}>Training is current for (days)<input type="number" min={1} max={730} value={course.validityDays} disabled={locked} onChange={(event) => changeModule({ validityDays: Number(event.target.value) })} /></label></div><p className={styles.muted}>Pass mark: 100%. Learners can correct a wrong answer straight away. Publishing a changed version requires learners to complete the current training again; older records remain available.</p><div className={styles.saveBar}><label className={styles.check}><input type="checkbox" checked={checkedSources} disabled={locked} onChange={(event) => setCheckedSources(event.target.checked)} />I have checked the questions, correct answers and explanations against the activity&apos;s current source material.</label><div className={styles.actions}><button className={styles.secondary} type="button" disabled={locked || (!dirty && !isNew)} onClick={() => void save(false)}>{busy === "save" ? "Saving draft..." : "Save draft"}</button><button className={styles.button} type="button" disabled={locked || !checkedSources || !hasUnpublishedChanges} onClick={() => void save(true)}>{busy === "publish" ? "Publishing..." : "Publish questionnaire"}</button>{course.id && <button className={styles.secondary} type="button" disabled={Boolean(busy)} onClick={() => void loadModule(course.id)}>Reload saved form</button>}</div></div></section>
        {versions.length > 0 && <details className={styles.details}><summary>Published versions ({versions.length})</summary><div className={styles.stack}>{versions.map((version) => <div key={version.version}><strong>{version.version}</strong><p className={styles.muted}>Published {dateTime(version.publishedAt)}</p></div>)}</div></details>}
      </>}
    </>}
    {view === "profiles" && <section className={styles.panel}><header><h3>Trade compliance profiles</h3><p className={styles.muted}>Submitted questionnaires are kept against the person and business. Open a record to see the exact questions, answers and explanations they completed.</p></header><label className={styles.field}>Person and business<select value={person} disabled={Boolean(busy)} onChange={(event) => void selectPerson(event.target.value)}><option value="">All people</option>{people.map((record) => <option key={JSON.stringify([record.ownerUid, record.memberId])} value={JSON.stringify([record.ownerUid, record.memberId])}>{record.displayName} · {record.businessName} ({record.submissionCount})</option>)}</select></label>{busy === "profiles" && <p role="status">Loading submitted questionnaires...</p>}{!busy && !visibleSubmissions.length && <p>No submitted questionnaires are saved for this selection.</p>}{submissionCursor && <small>Showing {submissions.length} recent submissions{person ? " for this person" : ""}. Load older submissions below for more records.</small>}<div className={styles.stack}>{visibleSubmissions.map((record) => <button className={`${styles.secondary} ${styles.recordButton}`} key={record.id} type="button" disabled={Boolean(busy)} onClick={() => void openSubmission(record.id)}><strong>{record.displayName} · {record.businessName}</strong><span>{catalogue?.modules.find((item) => item.id === record.moduleId)?.title || record.moduleId} · {record.scorePercent}% · {dateTime(record.completedAt)}</span><small>{record.reference || "Assessment record"}</small></button>)}</div>
      {submissionCursor && <button className={styles.secondary} type="button" disabled={Boolean(busy)} onClick={() => void loadOlderSubmissions()}>{busy === "older" ? "Loading older submissions..." : "Load older submissions"}</button>}
      {submission && <section className={styles.panel} aria-label="Saved questionnaire"><header><h3>{submission.snapshot.title}</h3><p>{submission.displayName} · {submission.businessName}</p><small>Version {submission.version} · {dateTime(submission.completedAt)}</small></header><p><strong>{submission.snapshot.scorePercent}% completed correctly</strong> · First try: {submission.snapshot.firstTryScorePercent}%</p>{submission.reference && <p>Completion reference: <strong>{submission.reference}</strong></p>}{submission.snapshot.questions.map((savedQuestion, questionIndex) => <article className={styles.savedQuestion} key={savedQuestion.id}><h4>{questionIndex + 1}. {savedQuestion.prompt}</h4><ol type="A">{savedQuestion.options.map((option) => <li className={option.id === savedQuestion.correctOptionId ? styles.correct : undefined} key={option.id}>{option.text}{option.id === savedQuestion.correctOptionId ? " (correct)" : ""}{option.id === savedQuestion.selectedOptionId ? " (submitted answer)" : ""}{savedQuestion.incorrectOptionIds?.includes(option.id) ? " (tried before correcting)" : ""}</li>)}</ol><p>{savedQuestion.explanation}</p></article>)}<div className={styles.stack}>{submission.snapshot.sources.filter((source) => safeSource(source.url)).map((source) => <a className={styles.sourceLink} key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</div></section>}
    </section>}
  </div>;
}
