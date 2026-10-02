"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { useTradeBusiness, useTradeBusinessFetch } from './TradeBusinessProvider';
import type { BusinessTask, BusinessTaskList, BusinessTaskStatus, TaskPerson } from '@/lib/trade-business-tasks';
import { taskStatus } from '@/lib/trade-business-tasks';
import styles from './TradeTasksWorkspace.module.css';

type Result = BusinessTaskList & { ok: boolean; error?: string };
type PeopleResult = { ok: boolean; people: TaskPerson[]; hasMore: boolean; error?: string };
const statusNames = { open: 'To do', in_progress: 'In progress', done: 'Done' };
const dateLabel = (date: string) => new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

export function TradeTasksWorkspace({ user, compact = false }: { user: User; compact?: boolean }) {
  const business = useTradeBusiness();
  return <TaskList key={`${user.uid}:${business?.ownerUid}:${business?.memberId}`} user={user} compact={compact} />;
}
function TaskList({ user, compact }: { user: User; compact: boolean }) {
  const request = useTradeBusinessFetch(); const business = useTradeBusiness();
  const [view, setView] = useState('mine'); const [status, setStatus] = useState('active'); const [page, setPage] = useState(1);
  const [data, setData] = useState<{ key: string; value: Result } | null>(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(''); const [detail, setDetail] = useState(''); const [dueOn, setDueOn] = useState('');
  const [assignee, setAssignee] = useState(business?.memberId || ''); const [assigneeName, setAssigneeName] = useState('Me');
  const [peopleSearch, setPeopleSearch] = useState(''); const [people, setPeople] = useState<TaskPerson[]>([]);
  const [peopleMore, setPeopleMore] = useState(false); const [peopleError, setPeopleError] = useState('');
  const [choosingPerson, setChoosingPerson] = useState(false); const [editing, setEditing] = useState<BusinessTask | null>(null);
  const alive = useRef(true); const createId = useRef(''); const titleInput = useRef<HTMLInputElement>(null);
  const loadSequence = useRef(0);
  const key = `${view}:${status}:${page}`; const current = data?.key === key ? data.value : null;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++loadSequence.current;
    try {
      const token = await user.getIdToken(); if (!alive.current || signal?.aborted) return;
      const response = await request(`/api/trade-tasks?view=${view}&status=${status}&page=${page}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal });
      const result: Result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Your tasks could not be loaded.');
      if (alive.current && !signal?.aborted && sequence === loadSequence.current) { setData({ key: `${view}:${status}:${result.page}`, value: result }); setPage(result.page); setError(''); }
    } catch (cause) {
      if (alive.current && !signal?.aborted && sequence === loadSequence.current) { setData(null); setError(cause instanceof Error ? cause.message : 'Your tasks could not be loaded.'); }
    }
  }, [user, request, view, status, page]);
  useEffect(() => {
    const controller = new AbortController(); const frame = requestAnimationFrame(() => void load(controller.signal));
    const refresh = () => { if (document.visibilityState === 'visible') void load(controller.signal); };
    const timer = window.setInterval(refresh, 30000); window.addEventListener('focus', refresh);
    return () => { controller.abort(); cancelAnimationFrame(frame); clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [load]);
  useEffect(() => {
    if (!choosingPerson) return;
    const controller = new AbortController();
    const timer = setTimeout(() => { void (async () => {
      try {
        const token = await user.getIdToken(); if (controller.signal.aborted) return;
        const response = await request(`/api/trade-tasks?mode=people&q=${encodeURIComponent(peopleSearch)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal });
        const result: PeopleResult = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || 'Team members could not be loaded.');
        if (!controller.signal.aborted) { setPeople(result.people); setPeopleMore(result.hasMore); setPeopleError(''); }
      } catch (cause) { if (!controller.signal.aborted) { setPeople([]); setPeopleError(cause instanceof Error ? cause.message : 'Team members could not be loaded.'); } }
    })(); }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [choosingPerson, peopleSearch, request, user]);
  function clearForm() {
    setTitle(''); setDetail(''); setDueOn(''); setAssignee(current?.memberId || business?.memberId || ''); setAssigneeName('Me');
    setEditing(null); setChoosingPerson(false); setPeopleSearch(''); createId.current = '';
  }
  async function mutate(body: Record<string, unknown>) {
    setBusy(true); setError(''); setNotice('');
    try {
      const token = await user.getIdToken();
      const response = await request('/api/trade-tasks', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result: { ok?: boolean; error?: string } = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'The task could not be saved.');
      if (!alive.current) return false;
      await load(); return true;
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'The task could not be saved.'); return false; }
    finally { if (alive.current) setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    createId.current ||= crypto.randomUUID();
    const assignedName = assigneeName;
    if (await mutate({ action: editing ? 'edit' : 'create', id: editing?.id || createId.current, revision: editing?.revision, title, detail, dueOn, assigneeMemberId: assignee || current?.memberId })) {
      setNotice(editing ? 'Task updated.' : `Task added for ${assignedName === 'Me' ? 'you' : assignedName}.`); clearForm(); titleInput.current?.focus();
    }
  }
  async function changeStatus(task: BusinessTask, next: BusinessTaskStatus) {
    if (await mutate({ action: 'status', id: task.id, revision: task.revision, status: next })) setNotice(`${task.title}: ${statusNames[next]}.`);
  }
  function edit(task: BusinessTask) {
    setEditing(task); setTitle(task.title); setDetail(task.detail); setDueOn(task.dueOn); setAssignee(task.assigneeMemberId);
    setAssigneeName(task.assigneeMemberId === current?.memberId ? 'Me' : task.assigneeName); setChoosingPerson(false); titleInput.current?.focus();
  }
  const today = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const tasks = compact ? current?.tasks.slice(0, 3) : current?.tasks;
  const tasksHref = `${business?.role === 'member' ? '/direct-trade/team' : '/direct-trade/dashboard'}?workspace=tasks`;
  return <section className={`${styles.workspace} ${compact ? styles.compact : ''}`} aria-label={compact ? 'Quick tasks' : 'Business tasks'}>
    <header className={styles.heading}><div><h2>{compact ? 'Your tasks' : 'Tasks'}</h2><p>{compact ? 'Capture a quick to-do for you or a teammate.' : 'Keep everyday work moving. Assign it, track it, tick it off.'}</p></div>{compact ? <a className={styles.secondary} href={tasksHref}>View all tasks{current ? ` (${current.total})` : ''}</a> : <button className={styles.secondary} type="button" onClick={() => void load()} disabled={busy}>Refresh</button>}</header>
    <form className={styles.composer} onSubmit={event => void save(event)} aria-label={editing ? 'Edit task' : 'Quick task'}>
      <div className={styles.quickRow}><label className={styles.titleField}>{editing ? 'Edit task' : 'What needs doing?'}<input ref={titleInput} value={title} onChange={event => setTitle(event.target.value)} maxLength={180} required placeholder="e.g. Order parts for tomorrow" disabled={busy} /></label>
        <div className={styles.assignee}><span>Assign to</span><button type="button" className={styles.secondary} aria-expanded={choosingPerson} onClick={() => setChoosingPerson(value => !value)} disabled={busy}>{assigneeName}</button></div>
        <button className={styles.primary} type="submit" disabled={busy || !current}>{busy ? 'Saving...' : editing ? 'Save changes' : 'Add task'}</button>
        {editing && <button type="button" className={styles.secondary} disabled={busy} onClick={clearForm}>Cancel</button>}</div>
      {choosingPerson && <div className={styles.people}><label>Find a teammate<input type="search" value={peopleSearch} onChange={event => setPeopleSearch(event.target.value)} placeholder="Search by name" /></label><div className={styles.personOptions}><button type="button" onClick={() => { setAssignee(current?.memberId || business?.memberId || ''); setAssigneeName('Me'); setChoosingPerson(false); }}>Me</button>{people.filter(person => person.id !== current?.memberId).map(person => <button type="button" key={person.id} onClick={() => { setAssignee(person.id); setAssigneeName(person.name); setChoosingPerson(false); }}>{person.name}</button>)}</div>{peopleMore && <p>Search a name to find more people.</p>}{peopleError && <p role="alert">{peopleError}</p>}</div>}
      <details className={styles.details} key={editing?.id || 'new'} open={editing ? true : undefined}><summary>{dueOn ? `Due ${dateLabel(dueOn)}` : 'Due date and notes (optional)'}</summary><div className={styles.extraFields}><label>Due date<input type="date" value={dueOn} onChange={event => setDueOn(event.target.value)} disabled={busy} /></label><label>Notes<textarea value={detail} onChange={event => setDetail(event.target.value)} maxLength={3000} rows={2} disabled={busy} /></label></div></details>
    </form>
    {notice && <p className={styles.notice} role="status">{notice}</p>}{error && <p className={styles.error} role="alert">{error} <button type="button" onClick={() => void load()}>Refresh tasks</button></p>}
    {!compact && <div className={styles.filters}><nav aria-label="Task lists">{[['mine', 'My tasks'], ['delegated', 'Assigned by me'], ...(current?.canViewTeam ? [['team', 'Team tasks']] : [])].map(([value, label]) => <button type="button" key={value} aria-pressed={view === value} onClick={() => { setView(value); setPage(1); }}>{label}</button>)}</nav><label>Show<select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="active">To do and in progress</option><option value="done">Done</option><option value="all">All tasks</option></select></label></div>}
    {!current && !error && <p role="status">Loading tasks...</p>}
    {current && <><ul className={styles.list}>{tasks?.map(task => <li className={styles.task} key={task.id}><div className={styles.taskContent}>{task.canEdit ? <button className={styles.taskTitle} type="button" onClick={() => edit(task)} disabled={busy}>{task.title}</button> : <strong>{task.title}</strong>}<small>{task.assigneeMemberId === current.memberId ? 'For you' : `For ${task.assigneeName}`} · {task.createdByMemberId === current.memberId ? 'Assigned by you' : `From ${task.createdByName}`}{task.dueOn && <span className={task.status !== 'done' && task.dueOn < today ? styles.overdue : ''}> · {task.status !== 'done' && task.dueOn < today ? 'Overdue: ' : 'Due '}{dateLabel(task.dueOn)}</span>}</small>{task.detail && <details><summary>Notes</summary><p>{task.detail}</p></details>}</div><label className={styles.status}><span className={styles.srOnly}>Status for {task.title}</span><select aria-label={`Status for ${task.title}`} value={task.status} disabled={busy} onChange={event => void changeStatus(task, taskStatus(event.target.value))}>{Object.entries(statusNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></li>)}</ul>{!current.total && <p className={styles.empty}>{status === 'done' ? 'Completed tasks will appear here.' : view === 'delegated' ? 'Tasks you assign to teammates appear here.' : 'No tasks here. Add one above when something needs doing.'}</p>}{!compact && current.totalPages > 1 && <nav className={styles.pagination} aria-label="Task pages"><button type="button" disabled={page <= 1 || busy} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page} of {current.totalPages}</span><button type="button" disabled={page >= current.totalPages || busy} onClick={() => setPage(value => value + 1)}>Next</button></nav>}</>}
  </section>;
}

