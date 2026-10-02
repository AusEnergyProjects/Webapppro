import { randomUUID } from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, Text, TextInput, View } from 'react-native';
import { FieldButton } from '@/components/field-button';
import { FieldSelect } from '@/components/field-select';
import { FieldDatePicker } from '@/components/field-date-picker';
import { Screen } from '@/components/screen';
import { creditexStyles as styles } from '@/components/creditex-styles';
import { useCreditexRemote } from '@/components/creditex-remote';
import type { CreditexApi, CreditexAppAccess } from '@/lib/creditex-api';
import { colours } from '@/lib/theme';
import type { PortalMessageList, PortalPeople, PortalTask, PortalTaskList } from '../../../src/lib/portal-team-workspace';

const endpoint = '/api/portal-team-workspace?workspace=creditex';
function message(error: unknown) { return error instanceof Error ? error.message : 'The change could not be saved. Try again.'; }

export function CreditexConnect({ api, access, initialPeerId }: { api: CreditexApi; access: CreditexAppAccess; initialPeerId?: string }) {
  const [search, setSearch] = useState(''), [peerId, setPeerId] = useState(initialPeerId || '');
  const directory = useCreditexRemote<PortalPeople>(api, `${endpoint}&mode=people&purpose=messages&q=${encodeURIComponent(search)}${peerId ? `&memberId=${encodeURIComponent(peerId)}` : ''}`);
  const peer = directory.data?.people.find(person => person.id === peerId);
  return <Screen><Text style={styles.title}>Connect</Text><Text style={styles.body}>Private messages with your Creditex team.</Text>{directory.error ? <Text style={styles.error}>{directory.error}</Text> : null}
    {peerId ? <><FieldButton variant="quiet" onPress={() => setPeerId('')}>All teammates</FieldButton>{peer ? <Conversation key={peer.id} api={api} access={access} peerId={peer.id} name={peer.name}/> : directory.loading ? <ActivityIndicator color={colours.green}/> : <Text style={styles.body}>This teammate is no longer available to you.</Text>}</> : <><TextInput accessibilityLabel="Find a teammate" placeholder="Find a teammate" placeholderTextColor={colours.muted} style={styles.input} value={search} onChangeText={setSearch}/>{directory.loading ? <ActivityIndicator color={colours.green}/> : null}{directory.data?.people.filter(person => person.id !== directory.data?.memberId).map(person => <Pressable key={person.id} accessibilityRole="button" style={styles.card} onPress={() => setPeerId(person.id)}><Text style={styles.heading}>{person.name}</Text><Text style={styles.body}>Open conversation</Text></Pressable>)}{directory.data?.hasMore ? <Text style={styles.body}>Search by name to find more teammates.</Text> : null}{directory.data && directory.data.people.every(person => person.id === directory.data?.memberId) ? <Text style={styles.body}>{search ? 'No matching teammates.' : 'No teammates available yet.'}</Text> : null}</>}
  </Screen>;
}
function Conversation({ api, access, peerId, name }: { api: CreditexApi; access: CreditexAppAccess; peerId: string; name: string }) {
  const [cursor, setCursor] = useState(''), [body, setBody] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const remote = useCreditexRemote<PortalMessageList>(api, `${endpoint}&mode=messages&peer=${encodeURIComponent(peerId)}&before=${encodeURIComponent(cursor)}`);
  const pendingId = useRef(''), lock = useRef(false), active = useRef(true), marked = useRef(new Set<string>());
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!remote.data || AppState.currentState !== 'active') return;
    const ids = remote.data.messages.filter(item => item.recipientId === remote.data?.memberId && !marked.current.has(item.id)).map(item => item.id);
    if (!ids.length) return;
    const controller = new AbortController();
    void api(endpoint, { action: 'read_messages', messageIds: ids }, controller.signal).then(() => { if (!controller.signal.aborted) ids.forEach(id => marked.current.add(id)); }).catch(cause => { if (!controller.signal.aborted) setError(message(cause)); });
    return () => controller.abort();
  }, [api, remote.data]);
  async function send() {
    if (lock.current || !body.trim() || !access.capabilities.sendMessages || !remote.data?.canSend) return;
    lock.current = true; setBusy(true); setError(''); pendingId.current ||= randomUUID();
    try { await api(endpoint, { action: 'send_message', id: pendingId.current, recipientId: peerId, body }); if (active.current) { pendingId.current = ''; setBody(''); setCursor(''); remote.refresh(); } }
    catch (cause) { if (active.current) setError(message(cause)); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  }
  return <><Text style={styles.heading}>{name}</Text>{remote.error || error ? <Text style={styles.error}>{remote.error || error}</Text> : null}{remote.loading ? <ActivityIndicator color={colours.green}/> : null}
    {remote.data?.hasMore ? <FieldButton variant="quiet" onPress={() => setCursor(remote.data?.before || '')}>Earlier messages</FieldButton> : null}{cursor ? <FieldButton variant="quiet" onPress={() => setCursor('')}>Latest messages</FieldButton> : null}
    {remote.data?.messages.map(item => <View key={item.id} style={styles.message}><Text style={styles.label}>{item.senderId === remote.data?.memberId ? 'You' : item.senderName}</Text><Text style={styles.body}>{item.body}</Text><Text style={styles.body}>{new Date(item.createdAt).toLocaleString('en-AU')}</Text></View>)}{remote.data && !remote.data.messages.length ? <Text style={styles.body}>No messages yet.</Text> : null}
    {access.capabilities.sendMessages && remote.data?.canSend ? <><TextInput accessibilityLabel="Message" placeholder={`Message ${name}`} placeholderTextColor={colours.muted} style={[styles.input, { minHeight: 85 }]} multiline maxLength={4000} value={body} editable={!busy} onChangeText={value => { setBody(value); pendingId.current = ''; }}/><FieldButton loading={busy} disabled={!remote.data || !body.trim()} onPress={() => void send()}>Send message</FieldButton></> : <Text style={styles.body}>Your access lets you read messages.</Text>}
    <FieldButton variant="quiet" onPress={remote.refresh}>Refresh</FieldButton>
  </>;
}

export function CreditexTasks({ api, access, initialTaskId }: { api: CreditexApi; access: CreditexAppAccess; initialTaskId?: string }) {
  const [status, setStatus] = useState(initialTaskId ? 'all' : 'open'), [page, setPage] = useState(1), [view, setView] = useState('mine');
  const [focused, setFocused] = useState(initialTaskId || ''), [editing, setEditing] = useState<PortalTask | 'new' | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const remote = useCreditexRemote<PortalTaskList>(api, `${endpoint}&mode=tasks&view=${view}&status=${status}&page=${page}&taskId=${encodeURIComponent(focused)}`);
  const lock = useRef(false), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function complete(task: PortalTask) {
    if (lock.current || !access.capabilities.completeTasks || !task.canComplete) return;
    lock.current = true; setBusy(task.id); setError('');
    try { await api(endpoint, { action: 'task_status', id: task.id, revision: task.revision, status: task.status === 'done' ? 'open' : 'done' }); if (active.current) remote.refresh(); }
    catch (cause) { if (active.current) setError(message(cause)); }
    finally { lock.current = false; if (active.current) setBusy(''); }
  }
  return <Screen><Text style={styles.title}>Tasks</Text>{focused ? <FieldButton variant="quiet" onPress={() => setFocused('')}>Show all my tasks</FieldButton> : null}
    <View style={styles.row}><FieldButton variant={view === 'mine' ? 'primary' : 'quiet'} onPress={() => { setFocused(''); setPage(1); setView('mine'); }}>My tasks</FieldButton><FieldButton variant={view === 'assigned' ? 'primary' : 'quiet'} onPress={() => { setFocused(''); setPage(1); setView('assigned'); }}>Assigned by me</FieldButton></View>
    <FieldSelect label="Status" value={status} options={[{ value: 'open', label: 'Open' }, { value: 'done', label: 'Done' }, { value: 'all', label: 'All' }]} onChange={value => { setStatus(value); setPage(1); setFocused(''); }}/>
    {access.capabilities.createTasks && remote.data?.canCreate && !editing ? <FieldButton onPress={() => setEditing('new')}>New task</FieldButton> : null}
    {editing ? <TaskEditor key={typeof editing === 'string' ? editing : editing.id} api={api} access={access} task={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); remote.refresh(); }}/> : null}
    {remote.error || error ? <Text style={styles.error}>{remote.error || error}</Text> : null}{remote.loading ? <ActivityIndicator color={colours.green}/> : null}
    {remote.data?.tasks.map(task => <View key={task.id} style={styles.card}><Text style={styles.heading}>{task.title}</Text><Text style={styles.body}>{task.assigneeName}{task.dueOn ? ` · Due ${task.dueOn}` : ''}</Text>{task.detail ? <Text style={styles.body}>{task.detail}</Text> : null}<Text style={styles.body}>Assigned by {task.creatorName}</Text><View style={styles.row}>{access.capabilities.completeTasks && task.canComplete ? <FieldButton variant="secondary" disabled={Boolean(busy)} loading={busy === task.id} onPress={() => void complete(task)}>{task.status === 'done' ? 'Reopen' : 'Mark done'}</FieldButton> : null}{task.canEdit && access.capabilities.editTasks ? <FieldButton variant="quiet" disabled={Boolean(editing) || Boolean(busy)} onPress={() => setEditing(task)}>Edit</FieldButton> : null}</View></View>)}
    {remote.data && !remote.data.tasks.length ? <Text style={styles.body}>No tasks in this view.</Text> : null}<View style={styles.row}><FieldButton variant="quiet" disabled={page <= 1} onPress={() => setPage(value => value - 1)}>Previous</FieldButton><Text style={styles.body}>{remote.data ? `Page ${remote.data.page} of ${remote.data.totalPages}` : ''}</Text><FieldButton variant="quiet" disabled={page >= (remote.data?.totalPages || 1)} onPress={() => setPage(value => value + 1)}>Next</FieldButton><FieldButton variant="quiet" onPress={remote.refresh}>Refresh</FieldButton></View>
  </Screen>;
}
function TaskEditor({ api, access, task, onClose, onSaved }: { api: CreditexApi; access: CreditexAppAccess; task: PortalTask | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(task?.title || ''), [detail, setDetail] = useState(task?.detail || ''), [assignee, setAssignee] = useState(task?.assigneeId || access.member.id), [search, setSearch] = useState('');
  const [dueOn, setDueOn] = useState(task?.dueOn || '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const directory = useCreditexRemote<PortalPeople>(api, `${endpoint}&mode=people&purpose=tasks&q=${encodeURIComponent(search)}`, access.capabilities.assignTasks);
  const id = useRef(task?.id || randomUUID()), lock = useRef(false), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const options = directory.data?.people.map(person => ({ value: person.id, label: person.name })) || [];
  if (!options.some(option => option.value === assignee)) options.unshift({ value: assignee, label: task?.assigneeName || access.member.name });
  async function save() {
    if (lock.current || !title.trim() || !(task ? access.capabilities.editTasks : access.capabilities.createTasks)) return;
    lock.current = true; setBusy(true); setError('');
    try { await api(endpoint, { action: task ? 'edit_task' : 'create_task', id: id.current, ...(task ? { revision: task.revision } : {}), title, detail, assigneeId: assignee, dueOn }); if (active.current) onSaved(); }
    catch (cause) { if (active.current) setError(message(cause)); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  }
  return <View style={styles.card}><Text style={styles.heading}>{task ? 'Edit task' : 'New task'}</Text><TextInput accessibilityLabel="What needs doing?" placeholder="What needs doing?" placeholderTextColor={colours.muted} style={styles.input} value={title} onChangeText={setTitle} maxLength={180} editable={!busy}/>
    {access.capabilities.assignTasks ? <><TextInput accessibilityLabel="Find teammate" placeholder="Find teammate" placeholderTextColor={colours.muted} style={styles.input} value={search} onChangeText={setSearch} editable={!busy}/><FieldSelect label="Assigned to" value={assignee} options={options} onChange={setAssignee} disabled={busy}/>{directory.data?.hasMore ? <Text style={styles.body}>Search by name to find more teammates.</Text> : null}</> : <Text style={styles.body}>Assigned to {task?.assigneeName || access.member.name}</Text>}
    <FieldDatePicker label="Due date (optional)" value={dueOn} onChange={setDueOn} disabled={busy}/>{dueOn ? <FieldButton variant="quiet" disabled={busy} onPress={() => setDueOn('')}>Clear due date</FieldButton> : null}<TextInput accessibilityLabel="Task details" placeholder="Details (optional)" placeholderTextColor={colours.muted} style={styles.input} multiline value={detail} onChangeText={setDetail} maxLength={3000} editable={!busy}/>{error || directory.error ? <Text style={styles.error}>{error || directory.error}</Text> : null}<FieldButton loading={busy} disabled={!title.trim()} onPress={() => void save()}>Save task</FieldButton><FieldButton variant="quiet" disabled={busy} onPress={onClose}>Cancel</FieldButton></View>;
}
