"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import type { PortalMessage, PortalMessageList, PortalPeople, PortalPerson, PortalTask, PortalTaskList, PortalWorkspace } from "@/lib/portal-team-workspace";
import { MFA_SETUP_URL } from "@/lib/firebase-mfa";
import styles from "./PortalTeamWorkspace.module.css";
import { PortalProfileAvatar } from "./PortalProfileAvatar";

type Props = { workspace: PortalWorkspace; user: User; view: "connect" | "tasks"; initialPeerId?: string; initialTaskId?: string };
type Failure = { message: string; code?: string };
type Api = <T>(query: Record<string, string>, body?: Record<string, unknown>, signal?: AbortSignal) => Promise<T>;

function failure(error: unknown): Failure {
  return error instanceof Error ? { message: error.message, code: "code" in error ? String(error.code) : undefined } : { message: "The workspace could not be updated. Try again." };
}
function ErrorNotice({ error, onDismiss }: { error: Failure | null; onDismiss: () => void }) {
  return error && <p className={styles.error} role="alert">{error.message}{error.code === "MFA_REQUIRED" && <> <a href={MFA_SETUP_URL}>Verify authenticator</a></>} <button type="button" onClick={onDismiss}>Dismiss</button></p>;
}
function usePortalApi(workspace: PortalWorkspace, user: User): Api {
  return useCallback(async <T,>(query: Record<string, string>, body?: Record<string, unknown>, signal?: AbortSignal) => {
    const token = await user.getIdToken();
    const response = await fetch(`/api/portal-team-workspace?${new URLSearchParams({ ...query, workspace })}`, {
      method: body ? "POST" : "GET", cache: "no-store", signal,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json() as T & { ok?: boolean; error?: string; code?: string };
    if (!response.ok || !data.ok) throw Object.assign(new Error(data.error || "The workspace could not be loaded."), { code: data.code });
    return data;
  }, [workspace, user]);
}
function usePeople(api: Api, purpose: "messages" | "tasks" = "tasks") {
  const [search, setSearch] = useState("");
  const [data, setData] = useState<PortalPeople>({ people: [], hasMore: false, memberId: "", canViewTeam: false, canCreate: false, canAssign: false, canComplete: false });
  const [error, setError] = useState<Failure | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<PortalPeople>({ mode: "people", q: search, purpose }, undefined, controller.signal).then(value => {
        if (!controller.signal.aborted) { setData(value); setError(null); }
      }).catch(cause => {
        if (!controller.signal.aborted) { setData({ people: [], hasMore: false, memberId: "", canViewTeam: false, canCreate: false, canAssign: false, canComplete: false }); setError(failure(cause)); }
      });
    }, search ? 180 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [api, search, purpose]);
  return { ...data, search, setSearch, error, setError };
}

export function PortalTeamWorkspace(props: Props) {
  return <PortalTeamWorkspaceView key={`${props.workspace}:${props.user.uid}:${props.view}:${props.initialPeerId || ""}:${props.initialTaskId || ""}`} {...props} />;
}
function PortalTeamWorkspaceView({ workspace, user, view, initialPeerId, initialTaskId }: Props) {
  const api = usePortalApi(workspace, user);
  return <section className={styles.workspace} aria-label={view === "connect" ? "Connect with your team" : "Team tasks"}>
    <header className={styles.heading}><div><span>{workspace === "creditex" ? "Creditex team" : "Operations team"}</span><h2>{view === "connect" ? "Connect" : "Tasks"}</h2><p>{view === "connect" ? "Message a teammate in your workspace." : "Keep track of your work and hand tasks to your team."}</p></div></header>
    {view === "connect" ? <ConnectWorkspace api={api} workspace={workspace} user={user} initialPeerId={initialPeerId} /> : <TasksWorkspace api={api} initialTaskId={initialTaskId} />}
  </section>;
}
function ConnectWorkspace({ api, workspace, user, initialPeerId }: { api: Api; workspace: PortalWorkspace; user: User; initialPeerId?: string }) {
  const directory = usePeople(api, "messages"); const [peer, setPeer] = useState<PortalPerson | null>(null);
  const [targetError, setTargetError] = useState<Failure | null>(null);
  useEffect(() => {
    if (!initialPeerId) return;
    const controller = new AbortController();
    void api<PortalPeople>({ mode: "people", memberId: initialPeerId, purpose: "messages" }, undefined, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      const person = result.people.find(value => value.id === initialPeerId && value.id !== result.memberId);
      if (person) setPeer(person); else setTargetError({ message: "This teammate is no longer available to you." });
    }).catch(cause => { if (!controller.signal.aborted) setTargetError(failure(cause)); });
    return () => controller.abort();
  }, [api, initialPeerId]);
  return <>
    <ErrorNotice error={targetError} onDismiss={() => setTargetError(null)} />
    <ErrorNotice error={directory.error} onDismiss={() => directory.setError(null)} />
    <div className={styles.connect}>
      <aside className={styles.people} aria-label="Team conversations">
        <label><span>Find a teammate</span><input type="search" value={directory.search} onChange={event => directory.setSearch(event.target.value)} maxLength={100} placeholder="Search names" /></label>
        {directory.people.filter(person => person.id !== directory.memberId).map(person => <button className={styles.person} type="button" key={person.id} aria-pressed={peer?.id === person.id} onClick={() => setPeer(person)}><PortalProfileAvatar workspace={workspace} user={user} memberId={person.id} revision={person.avatarRevision} name={person.name} /><span><strong>{person.name || "Team member"}</strong><small>{person.role.replaceAll("_", " ")}</small></span></button>)}
        {directory.hasMore && <p>Search by name to find more teammates.</p>}
        {!directory.error && directory.memberId && directory.people.every(person => person.id === directory.memberId) && <p>{directory.search ? "No teammate matches that name." : "Add team members to start a conversation."}</p>}
      </aside>
      {peer && directory.memberId ? <Conversation key={peer.id} api={api} peer={peer} workspace={workspace} user={user} /> : <div className={styles.empty}>Choose a teammate to open your conversation.</div>}
    </div>
  </>;
}
function Conversation({ api, peer, workspace, user }: { api: Api; peer: PortalPerson; workspace: PortalWorkspace; user: User }) {
  const [messages, setMessages] = useState<PortalMessage[]>([]); const [memberId, setMemberId] = useState("");
  const [canSend, setCanSend] = useState(false);
  const [before, setBefore] = useState(""); const [hasMore, setHasMore] = useState(false);
  const [historyCursor, setHistoryCursor] = useState("");
  const [error, setError] = useState<Failure | null>(null); const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false); const [refresh, setRefresh] = useState(0);
  const sendLock = useRef(false); const requestId = useRef("");
  const readMessages = useRef(new Set<string>());
  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      if (document.visibilityState === "hidden") return;
      void api<PortalMessageList>({ mode: "messages", peer: peer.id, before: historyCursor }, undefined, controller.signal).then(data => {
        if (controller.signal.aborted) return;
        setMessages(data.messages); setMemberId(data.memberId); setCanSend(data.canSend); setBefore(data.before); setHasMore(data.hasMore); setError(null);
      }).catch(cause => {
        if (!controller.signal.aborted) { setMessages([]); setMemberId(""); setCanSend(false); setBefore(""); setHasMore(false); setError(failure(cause)); }
      });
    };
    load(); const timer = setInterval(load, 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [api, peer.id, historyCursor, refresh]);
  useEffect(() => {
    if (workspace !== "creditex" || !memberId || document.visibilityState === "hidden") return;
    const ids = messages.filter(message => message.recipientId === memberId && !readMessages.current.has(message.id)).map(message => message.id);
    if (!ids.length) return;
    const controller = new AbortController();
    void api({}, { action: "read_messages", messageIds: ids }, controller.signal).then(() => {
      if (!controller.signal.aborted) { ids.forEach(id => readMessages.current.add(id)); window.dispatchEvent(new Event("creditex-notifications-changed")); }
    }).catch(cause => { if (!controller.signal.aborted) setError(failure(cause)); });
    return () => controller.abort();
  }, [api, memberId, messages, workspace]);
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (sendLock.current || !body.trim() || !canSend) return;
    sendLock.current = true; setBusy(true); setError(null);
    requestId.current ||= crypto.randomUUID();
    try {
      await api({}, { action: "send_message", id: requestId.current, recipientId: peer.id, body });
      setBody(""); requestId.current = ""; setHistoryCursor(""); setRefresh(value => value + 1);
    } catch (cause) { setError(failure(cause)); }
    finally { sendLock.current = false; setBusy(false); }
  }
  return <section className={styles.conversation} aria-label={`Conversation with ${peer.name}`}>
    <header><div className={styles.conversationPerson}><PortalProfileAvatar workspace={workspace} user={user} memberId={peer.id} revision={messages.find(message => message.senderId === peer.id)?.senderAvatarRevision ?? peer.avatarRevision} name={peer.name} /><h3>{peer.name || "Team member"}</h3></div><button type="button" onClick={() => setRefresh(value => value + 1)}>Refresh</button></header>
    <ErrorNotice error={error} onDismiss={() => setError(null)} />
    <div className={styles.messages} role="log" aria-label="Message history" aria-live="polite">
      {(hasMore || historyCursor) && <div className={styles.actions}>{hasMore && <button type="button" onClick={() => { setMessages([]); setHistoryCursor(before); }}>Earlier messages</button>}{historyCursor && <button type="button" onClick={() => { setMessages([]); setHistoryCursor(""); }}>Latest messages</button>}</div>}
      {!messages.length && !error && <p>No messages yet.</p>}
      {messages.map(message => <article key={message.id} className={message.senderId === memberId ? styles.mine : styles.message}><header><strong>{message.senderId === memberId ? "You" : message.senderName}</strong><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString("en-AU", { dateStyle: "short", timeStyle: "short" })}</time></header><p>{message.body}</p></article>)}
    </div>
    {canSend ? <form className={styles.compose} onSubmit={send}><label><span>Message</span><textarea required maxLength={4000} value={body} disabled={busy} onChange={event => { setBody(event.target.value); requestId.current = ""; }} rows={3} placeholder={`Message ${peer.name || "your teammate"}`} /></label><button type="submit" disabled={busy || !memberId || !body.trim()}>{busy ? "Sending..." : "Send message"}</button></form> : memberId && <p>You have read-only access to team messages.</p>}
  </section>;
}
function TasksWorkspace({ api, initialTaskId }: { api: Api; initialTaskId?: string }) {
  const directory = usePeople(api);
  const [view, setView] = useState("mine"); const [status, setStatus] = useState(initialTaskId ? "all" : "open"); const [page, setPage] = useState(1);
  const [data, setData] = useState<PortalTaskList | null>(null); const [error, setError] = useState<Failure | null>(null);
  const [refresh, setRefresh] = useState(0); const [editing, setEditing] = useState<PortalTask | "new" | null>(null); const [busy, setBusy] = useState("");
  const mutationLock = useRef(false);
  const [focusedTask, setFocusedTask] = useState(initialTaskId || "");
  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      if (document.visibilityState === "hidden") return;
      void api<PortalTaskList>({ mode: "tasks", view, status, page: String(page), taskId: focusedTask }, undefined, controller.signal).then(result => {
        if (!controller.signal.aborted) { setData(result); setError(null); }
      }).catch(cause => { if (!controller.signal.aborted) { setData(null); setError(failure(cause)); } });
    };
    load(); const timer = setInterval(load, 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [api, view, status, page, refresh, focusedTask]);
  async function changeStatus(task: PortalTask) {
    if (mutationLock.current) return; mutationLock.current = true; setBusy(task.id); setError(null);
    try { await api({}, { action: "task_status", id: task.id, revision: task.revision, status: task.status === "done" ? "open" : "done" }); setRefresh(value => value + 1); }
    catch (cause) { setError(failure(cause)); }
    finally { mutationLock.current = false; setBusy(""); }
  }
  return <>
    {focusedTask && <div className={styles.focusedTask}><span>Task from your notification</span><button type="button" onClick={() => { setFocusedTask(""); setView("mine"); setStatus("all"); setPage(1); }}>Show all my tasks</button></div>}
    <div className={styles.toolbar}><label><span>Tasks</span><select value={view} onChange={event => { setView(event.target.value); setFocusedTask(""); setPage(1); }}><option value="mine">My tasks</option><option value="assigned">Assigned by me</option>{data?.canViewTeam && <option value="team">All team tasks</option>}</select></label><label><span>Status</span><select value={status} onChange={event => { setStatus(event.target.value); setFocusedTask(""); setPage(1); }}><option value="open">Open</option><option value="done">Done</option><option value="all">All</option></select></label><button type="button" onClick={() => setRefresh(value => value + 1)}>Refresh</button>{data?.canCreate && <button type="button" disabled={!directory.memberId || Boolean(editing)} onClick={() => setEditing("new")}>New task</button>}</div>
    <ErrorNotice error={error || directory.error} onDismiss={() => { setError(null); directory.setError(null); }} />
    {editing && <TaskEditor key={typeof editing === "string" ? editing : editing.id} api={api} memberId={directory.memberId} task={editing === "new" ? null : editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setRefresh(value => value + 1); }} />}
    <div className={styles.tasks}>
      {data?.tasks.map(task => <article key={task.id} className={styles.task}><div><h3>{task.title}</h3><p>{task.assigneeName}{task.dueOn ? ` · Due ${new Date(`${task.dueOn}T00:00:00`).toLocaleDateString("en-AU")}` : ""}</p>{task.detail && <p className={styles.taskDetail}>{task.detail}</p>}<small>Assigned by {task.creatorName} · {new Date(task.createdAt).toLocaleDateString("en-AU")}</small></div><div className={styles.actions}>{task.canComplete && <button type="button" disabled={Boolean(busy)} onClick={() => void changeStatus(task)}>{busy === task.id ? "Saving..." : task.status === "done" ? "Reopen" : "Mark done"}</button>}{task.canEdit && <button type="button" disabled={Boolean(editing)} onClick={() => setEditing(task)}>Edit</button>}</div></article>)}
      {data && !data.tasks.length && <p className={styles.empty}>No {status === "all" ? "" : `${status} `}tasks in this view.</p>}
    </div>
    {data && data.totalPages > 1 && <nav className={styles.pagination} aria-label="Task pages"><button type="button" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>Previous</button><span>Page {data.page} of {data.totalPages}</span><button type="button" disabled={data.page >= data.totalPages} onClick={() => setPage(data.page + 1)}>Next</button></nav>}
  </>;
}
function TaskEditor({ api, memberId, task, onCancel, onSaved }: { api: Api; memberId: string; task: PortalTask | null; onCancel: () => void; onSaved: () => void }) {
  const directory = usePeople(api);
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId || memberId);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<Failure | null>(null);
  const id = useRef(task?.id || crypto.randomUUID()); const lock = useRef(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current) return;
    const data = new FormData(event.currentTarget); lock.current = true; setBusy(true); setError(null);
    try {
      await api({}, { action: task ? "edit_task" : "create_task", id: id.current, revision: task?.revision,
        title: data.get("title"), detail: data.get("detail"), dueOn: data.get("dueOn"), assigneeId });
      onSaved();
    } catch (cause) { setError(failure(cause)); }
    finally { lock.current = false; setBusy(false); }
  }
  const people = directory.people.some(person => person.id === assigneeId) ? directory.people
    : [...directory.people, { id: assigneeId, name: task?.assigneeName || "Me", role: "", avatarRevision: "" }];
  return <form className={styles.editor} onSubmit={save} aria-label={task ? "Edit task" : "New task"}>
    <h3>{task ? "Edit task" : "New task"}</h3><ErrorNotice error={error || directory.error} onDismiss={() => { setError(null); directory.setError(null); }} />
    <label><span>What needs doing?</span><input name="title" required maxLength={180} defaultValue={task?.title || ""} disabled={busy} /></label>
    <div className={styles.editorRow}>{directory.canAssign && <label><span>Find teammate</span><input type="search" maxLength={100} value={directory.search} onChange={event => directory.setSearch(event.target.value)} placeholder="Search names" disabled={busy} /></label>}<label><span>Assigned to</span><select value={assigneeId} onChange={event => setAssigneeId(event.target.value)} required disabled={busy || !directory.canAssign}>{people.map(person => <option key={person.id} value={person.id}>{person.id === memberId ? `${person.name || "Me"} (me)` : person.name}</option>)}</select></label><label><span>Due date (optional)</span><input type="date" name="dueOn" defaultValue={task?.dueOn || ""} disabled={busy} /></label></div>
    {directory.canAssign && directory.hasMore && <small>Search by name to find more teammates.</small>}
    <label><span>Details (optional)</span><textarea name="detail" rows={3} maxLength={3000} defaultValue={task?.detail || ""} disabled={busy} /></label>
    <div className={styles.actions}><button type="submit" disabled={busy || !assigneeId}>{busy ? "Saving..." : "Save task"}</button><button type="button" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </form>;
}
