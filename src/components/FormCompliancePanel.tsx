"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import type { FormComplianceAnswer, FormComplianceQuestion, FormComplianceTemplate, FormComplianceWorkspace, FormComplianceQueueItem } from '@/lib/form-compliance';
import { initialComplianceAnswers } from '@/lib/form-compliance';
import { useTradeBusinessFetch } from './TradeBusinessProvider';
import styles from './FormCompliancePanel.module.css';

type Api = (path: string, init?: RequestInit) => Promise<unknown>;
type Scope = 'business' | 'creditex';
type ReviewTarget = { workOrderId: string; formId: string } | { intentId: string; recordId: string; recordKind: string };
const responses = ['pass', 'fail', 'na', 'unchecked'] as const;
const responseLabels = { pass: 'Pass', fail: 'Needs fixing', na: 'Not applicable', unchecked: 'Not checked' };
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function question(value: unknown): value is FormComplianceQuestion { return record(value) && typeof value.key === 'string' && typeof value.label === 'string' && typeof value.required === 'boolean' && (value.sourceFieldKey === undefined || typeof value.sourceFieldKey === 'string'); }
function template(value: unknown): value is FormComplianceTemplate { return record(value) && typeof value.formKey === 'string' && typeof value.title === 'string' && Number.isSafeInteger(value.revision) && Array.isArray(value.questions) && value.questions.every(question); }
function answer(value: unknown): value is FormComplianceAnswer { return record(value) && typeof value.key === 'string' && typeof value.note === 'string' && responses.some(response => response === value.response); }
function workspace(value: unknown): value is FormComplianceWorkspace {
  if (!record(value) || !template(value.template) || !record(value.source) || typeof value.source.id !== 'string' || typeof value.source.title !== 'string' || !Number.isSafeInteger(value.source.revision) || typeof value.source.hash !== 'string' || !Array.isArray(value.source.answers) || !value.source.answers.every(row => record(row) && typeof row.key === 'string' && typeof row.label === 'string') || typeof value.canReview !== 'boolean' || typeof value.stale !== 'boolean') return false;
  return value.review === null || record(value.review) && Number.isSafeInteger(value.review.revision) && ['draft', 'complete'].includes(String(value.review.status)) && Array.isArray(value.review.answers) && value.review.answers.every(answer) && typeof value.review.actorName === 'string' && typeof value.review.createdAt === 'string' && typeof value.review.sourceHash === 'string' && Number.isSafeInteger(value.review.templateRevision);
}
function queueItem(value: unknown): value is FormComplianceQueueItem { return record(value) && typeof value.formId === 'string' && typeof value.workOrderId === 'string' && typeof value.title === 'string' && typeof value.jobNumber === 'string' && typeof value.status === 'string'; }
function resultObject(value: unknown) { if (!record(value) || value.ok !== true) throw new Error(record(value) && typeof value.error === 'string' ? value.error : 'The compliance information could not be loaded.'); return value; }
function path(scope: Scope, values: Record<string, string>, actorMode?: string) { return `/api/form-compliance?${new URLSearchParams({ scope, ...values, ...(scope === 'creditex' ? { actorMode: actorMode === 'admin' ? 'admin' : 'compliance' } : {}) })}`; }
function targetValues(target: ReviewTarget): Record<string, string> { return 'formId' in target ? { workOrderId: target.workOrderId, formId: target.formId } : { intentId: target.intentId, recordId: target.recordId, recordKind: target.recordKind }; }
function display(value: unknown): string { if (value === true) return 'Yes'; if (value === false) return 'No'; if (value === null || value === undefined || value === '') return 'No answer recorded'; return typeof value === 'object' ? JSON.stringify(value) : String(value); }
function useMounted() {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return mounted;
}
function useDirty(dirty: boolean, onDirtyChange?: (dirty: boolean) => void) {
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
}

export function FormComplianceEditor({ api, scope, formKey, actorMode, onDirtyChange }: { api: Api; scope: Scope; formKey: string; actorMode?: string; onDirtyChange?: (dirty: boolean) => void }) {
  const mounted = useMounted();
  const [saved, setSaved] = useState<FormComplianceTemplate | null>(null), [questions, setQuestions] = useState<FormComplianceQuestion[]>([]);
  const [canManage, setCanManage] = useState(false), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const dirty = Boolean(saved && JSON.stringify(saved.questions) !== JSON.stringify(questions)); useDirty(dirty || busy, onDirtyChange);
  const endpoint = path(scope, { formKey }, actorMode);
  useEffect(() => { let active = true; void api(endpoint).then(value => { const result = resultObject(value); if (!template(result.template) || typeof result.canManage !== 'boolean') throw new Error('The compliance questionnaire is incomplete. Refresh this form.'); if (active) { setSaved(result.template); setQuestions(result.template.questions); setCanManage(result.canManage); } }).catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'Could not load compliance questions.'); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [api, endpoint]);
  function edit(key: string, change: Partial<FormComplianceQuestion>) { setQuestions(items => items.map(item => item.key === key ? { ...item, ...change } : item)); setMessage(''); }
  function move(index: number, offset: number) { setQuestions(items => { const next = [...items]; const destination = index + offset; if (destination < 0 || destination >= next.length) return items; [next[index], next[destination]] = [next[destination], next[index]]; return next; }); }
  async function save() { if (!saved || busy || !canManage) return; setBusy(true); setError(''); setMessage(''); try { const result = resultObject(await api(endpoint, { method: 'POST', body: JSON.stringify({ action: 'save_template', formKey, expectedRevision: saved.revision, questions }) })); if (!template(result.template)) throw new Error('The saved version could not be confirmed. Refresh before saving again.'); if (!mounted.current) return; setSaved(result.template); setQuestions(result.template.questions); setMessage('Compliance questionnaire saved. Existing reviews keep the questions they used.'); } catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : 'The questionnaire was not saved.'); } finally { if (mounted.current) setBusy(false); } }
  if (loading) return <p role="status">Loading compliance questions...</p>;
  return <section className={styles.panel} aria-label="Compliance questionnaire"><header><div><h3>Compliance</h3><p>Checks for the person reviewing the work. These are separate from the technician&apos;s form.</p></div>{saved && <span>{questions.length} checks · {saved.revision ? `Version ${saved.revision}` : 'Starter questions'}</span>}</header>{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}{saved && <><fieldset disabled={busy || !canManage} className={styles.questionList}>{questions.map((item, index) => <div key={item.key} className={styles.editorQuestion}><label><span>Check {index + 1}</span><textarea aria-label={`Compliance check ${index + 1}`} rows={2} maxLength={300} value={item.label} onChange={event => edit(item.key, { label: event.target.value })} /></label><div className={styles.actions}><label><input type="checkbox" checked={item.required} onChange={event => edit(item.key, { required: event.target.checked })} /> Required</label><button type="button" aria-label={`Move compliance check ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" aria-label={`Move compliance check ${index + 1} down`} disabled={index === questions.length - 1} onClick={() => move(index, 1)}>↓</button><button type="button" onClick={() => setQuestions(items => items.filter(question => question.key !== item.key))}>Remove</button></div></div>)}</fieldset>{canManage ? <div className={styles.actions}><button type="button" disabled={busy || questions.length >= 60} onClick={() => setQuestions(items => [...items, { key: `check_${crypto.randomUUID().replaceAll('-', '_')}`, label: 'New compliance check', required: true }])}>Add check</button><button className="btn" type="button" disabled={busy || !questions.length || saved.revision > 0 && !dirty} onClick={() => void save()}>{busy ? 'Saving...' : 'Save compliance questions'}</button></div> : <p>Only the form&apos;s authorised managers can change these checks.</p>}</>}</section>;
}

export function FormComplianceReview({ api, scope, target, actorMode, onDirtyChange }: { api: Api; scope: Scope; target: ReviewTarget; actorMode?: string; onDirtyChange?: (dirty: boolean) => void }) {
  const mounted = useMounted();
  const [data, setData] = useState<FormComplianceWorkspace | null>(null), [answers, setAnswers] = useState<FormComplianceAnswer[]>([]);
  const [baseline, setBaseline] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const dirty = baseline !== JSON.stringify(answers); useDirty(!loading && (dirty || busy), onDirtyChange);
  const endpoint = path(scope, targetValues(target), actorMode);
  function apply(next: FormComplianceWorkspace) { const initial = initialComplianceAnswers(next); setData(next); setAnswers(initial); setBaseline(JSON.stringify(initial)); }
  useEffect(() => { let active = true; void api(endpoint).then(value => { const result = resultObject(value); if (!workspace(result.workspace)) throw new Error('This review could not be loaded. Refresh the form.'); if (active) apply(result.workspace); }).catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'The review could not be loaded.'); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [api, endpoint]);
  function edit(key: string, patch: Partial<FormComplianceAnswer>) { setAnswers(items => items.map(item => item.key === key ? { ...item, ...patch } : item)); setMessage(''); }
  const complete = Boolean(data && data.template.questions.every(question => { const item = answers.find(answer => answer.key === question.key); return item && (item.response === 'pass' || item.response === 'na' && Boolean(item.note.trim()) || !question.required && item.response === 'unchecked'); }) && !answers.some(item => item.response === 'fail'));
  async function save(status: 'draft' | 'complete') { if (!data || busy || !data.canReview) return; setBusy(true); setError(''); setMessage(''); try { const result = resultObject(await api(endpoint, { method: 'POST', body: JSON.stringify({ action: 'save_review', ...targetValues(target), expectedRevision: data.review?.revision || 0, expectedSourceHash: data.source.hash, templateRevision: data.template.revision, answers, status }) })); if (!workspace(result.workspace)) throw new Error('The saved review could not be confirmed. Refresh before saving again.'); if (!mounted.current) return; apply(result.workspace); setMessage(status === 'complete' ? 'Compliance review completed and saved.' : 'Compliance review draft saved.'); } catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : 'The review was not saved.'); } finally { if (mounted.current) setBusy(false); } }
  if (loading) return <p role="status">Loading compliance review...</p>;
  return <section className={styles.panel} aria-label="Form compliance review">{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}{data && <><header><div><h3>{data.source.title}: compliance</h3><p>Review the saved answers and evidence, then record each check. Installer answers stay unchanged.</p></div><span>{data.review?.status === 'complete' && !data.stale ? 'Reviewed' : data.stale ? 'Needs a fresh review' : 'Awaiting review'}</span></header>{data.stale && <p role="note">The form or its evidence changed after the last review. Check the current version before completing a new review.</p>}{data.review && <p>Last saved by {data.review.actorName} on {new Date(data.review.createdAt).toLocaleDateString('en-AU')}.</p>}<section className={styles.source} aria-label="Saved installer answers"><h4>Saved installer answers · version {data.source.revision}</h4><dl>{data.source.answers.map(row => <div key={row.key}><dt>{row.label}</dt><dd>{display(row.value)}</dd></div>)}</dl></section><fieldset disabled={busy || !data.canReview} className={styles.questionList}>{data.template.questions.map((question, index) => { const item = answers.find(answer => answer.key === question.key); if (!item) return null; const sourceAnswer = data.source.answers.find(row => row.key === question.sourceFieldKey); return <section className={styles.reviewQuestion} key={question.key}><h4>{index + 1}. {question.label}{question.required ? ' *' : ''}</h4>{sourceAnswer && <p className={styles.linkedAnswer}>Recorded: {display(sourceAnswer.value)}</p>}<div className={styles.choices} role="group" aria-label={question.label}>{responses.map(response => <button type="button" key={response} aria-pressed={item.response === response} onClick={() => edit(question.key, { response })}>{responseLabels[response]}</button>)}</div><label>{item.response === 'na' || item.response === 'fail' ? 'Reason / follow-up' : 'Review note (optional)'}<textarea rows={2} maxLength={1200} value={item.note} onChange={event => edit(question.key, { note: event.target.value })} /></label></section>; })}</fieldset>{data.canReview && <div className={styles.actions}><button type="button" disabled={busy} onClick={() => void save('draft')}>Save review draft</button><button className="btn" type="button" disabled={busy || !complete} onClick={() => void save('complete')}>{busy ? 'Saving...' : 'Complete compliance review'}</button></div>}<p>Completing this checklist records the review. Programme approval and certificate submission use their existing workflow.</p></>}</section>;
}

export function TradeFormComplianceWorkflow({ user, onRegisterLeave }: { user: User; onRegisterLeave?: (check: (() => Promise<unknown>) | null) => void }) {
  const fetch = useTradeBusinessFetch();
  const mounted = useMounted();
  const [items, setItems] = useState<FormComplianceQueueItem[]>([]);
  const [selected, setSelected] = useState<FormComplianceQueueItem | null>(null);
  const [query, setQuery] = useState(''), [appliedQuery, setAppliedQuery] = useState('');
  const [cursor, setCursor] = useState<string | null>(null), [nextCursor, setNextCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<(string | null)[]>([]);
  const [dirty, setDirty] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const api = useCallback<Api>(async (url, init) => { const response = await fetch(url, { ...init, cache: 'no-store', headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' } }); const result: unknown = await response.json(); if (!response.ok) throw new Error(record(result) && typeof result.error === 'string' ? result.error : 'Could not open compliance reviews.'); return result; }, [fetch, user]);
  const requestPage = useCallback(async (pageCursor: string | null, search: string) => {
    const result = resultObject(await api(path('business', { view: 'queue', ...(pageCursor ? { cursor: pageCursor } : {}), ...(search ? { q: search } : {}) })));
    if (!Array.isArray(result.items) || !result.items.every(queueItem) || !(result.nextCursor === null || typeof result.nextCursor === 'string')) throw new Error('The review queue could not be read.');
    return { items: result.items, nextCursor: result.nextCursor };
  }, [api]);
  const leave = useCallback(async () => { if (dirty && !window.confirm('Discard unsaved compliance review changes?')) throw new Error('Keep reviewing'); }, [dirty]);
  useEffect(() => { onRegisterLeave?.(leave); return () => onRegisterLeave?.(null); }, [leave, onRegisterLeave]);
  useEffect(() => {
    let active = true;
    void requestPage(null, '').then(page => { if (active) { setItems(page.items); setNextCursor(page.nextCursor); } })
      .catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'Reviews could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [requestPage]);
  async function openPage(pageCursor: string | null, history: (string | null)[], search: string) {
    if (loading) return;
    setLoading(true); setError('');
    try {
      const page = await requestPage(pageCursor, search);
      if (!mounted.current) return;
      setItems(page.items); setNextCursor(page.nextCursor); setCursor(pageCursor); setPrevious(history); setAppliedQuery(search);
    } catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : 'Reviews could not be loaded.'); }
    finally { if (mounted.current) setLoading(false); }
  }
  return <section className={styles.panel} aria-label="Business compliance reviews">
    {error && <p role="alert">{error}</p>}
    {selected ? <>
      <button type="button" onClick={() => void leave().then(() => {
        setSelected(null); setDirty(false); void openPage(cursor, previous, appliedQuery);
      }).catch(() => {})}>Back to compliance reviews</button>
      <FormComplianceReview key={selected.formId} api={api} scope="business" target={{ workOrderId: selected.workOrderId, formId: selected.formId }} onDirtyChange={setDirty} />
    </> : <>
      <header><div><h2>Compliance reviews</h2><p>Check completed business forms without adding questions to the technician&apos;s workflow.</p></div></header>
      <form className={styles.actions} onSubmit={event => { event.preventDefault(); void openPage(null, [], query.trim()); }}>
        <label>Find a form or job<input type="search" maxLength={160} disabled={loading} value={query} onChange={event => setQuery(event.target.value)} /></label>
        <button type="submit" disabled={loading}>Search forms</button>
      </form>
      {loading ? <p role="status">Loading compliance reviews...</p> : <>
        <div className={styles.queue}>{items.map(item => <article key={item.formId}>
          <div><h3>{item.title}</h3><p>{item.jobNumber} · {item.status === 'not_started' ? 'Not started' : item.status === 'stale' ? 'Needs a fresh review' : item.status === 'complete' ? 'Completed' : 'Draft'}</p></div>
          <button type="button" onClick={() => setSelected(item)}>Review compliance</button>
        </article>)}</div>
        {!items.length && <p>{appliedQuery ? 'No completed forms match this search.' : 'Completed business job forms will appear here for review.'}</p>}
      </>}
      <nav className={styles.actions} aria-label="Compliance review pages">
        <button type="button" disabled={loading || !previous.length} onClick={() => void openPage(previous.at(-1) ?? null, previous.slice(0, -1), appliedQuery)}>Previous</button>
        <span>Page {previous.length + 1}</span>
        <button type="button" disabled={loading || !nextCursor} onClick={() => { if (nextCursor) void openPage(nextCursor, [...previous, cursor], appliedQuery); }}>Next</button>
      </nav>
    </>}
  </section>;
}
