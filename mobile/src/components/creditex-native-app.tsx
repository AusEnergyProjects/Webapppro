import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { FieldButton } from '@/components/field-button';
import { Screen } from '@/components/screen';
import { CreditexSignIn } from '@/components/creditex-sign-in';
import { CreditexConnect, CreditexTasks } from '@/components/creditex-team';
import { creditexStyles as styles } from '@/components/creditex-styles';
import { useCreditexRemote } from '@/components/creditex-remote';
import { createCreditexApi, type CreditexApi, type CreditexAppAccess } from '@/lib/creditex-api';
import { firebaseAuth, firebaseSignOut } from '@/lib/auth';
import { API_BASE_URL } from '@/lib/config';
import { colours } from '@/lib/theme';
import { useNativeWorkspace } from '@/providers/native-workspace-provider';
import type { CreditexNotificationList, CreditexNotificationTarget } from '../../../src/lib/creditex-notifications';
import type { CreditexJobAuditWorkspace } from '../../../src/lib/creditex-job-audit';

type Tab = 'home' | 'jobs' | 'connect' | 'tasks' | 'account';
type Target = { tab: Tab; intentId?: string; peerId?: string; taskId?: string };
type Job = { id: string; jobNumber: string; jobTitle: string; customerName: string; serviceAddress: string; activityTitle: string; installerBusiness: string; lifecycle: { label: string }; plannedStart: string };
type Dashboard = { awaitingAudit: number; correctionsRequired: number; auditCompleted: number; readyForSubmission: number; total: number; countsUnit: string };

export function CreditexNativeApp() {
  const workspace = useNativeWorkspace();
  const [user, setUser] = useState<User | null>(null), [ready, setReady] = useState(false);
  useEffect(() => onAuthStateChanged(firebaseAuth, next => { setUser(next); setReady(true); }), []);
  if (!ready) return <View style={styles.fill}><ActivityIndicator accessibilityLabel="Checking Creditex sign-in" color={colours.green}/></View>;
  return <><StatusBar style="light"/>{user ? <CreditexSession key={user.uid} user={user}/> : <CreditexSignIn onTrade={() => workspace.choose('trade')}/>}</>;
}

function CreditexSession({ user }: { user: User }) {
  const lifetime = useMemo(() => new AbortController(), []);
  const api = useMemo(() => createCreditexApi(user, lifetime.signal), [user, lifetime]);
  useEffect(() => () => lifetime.abort(), [lifetime]);
  const access = useCreditexRemote<CreditexAppAccess>(api, '/api/creditex/app-access');
  const [signingOut, setSigningOut] = useState(false), [error, setError] = useState('');
  async function signOut() { setSigningOut(true); try { await firebaseSignOut(); } catch { setError('Sign-out could not complete. Try again.'); } finally { setSigningOut(false); } }
  if (!access.data) return <Screen><Text style={styles.title}>Creditex workspace</Text><Text style={styles.body}>{user.email}</Text>{access.loading ? <ActivityIndicator accessibilityLabel="Checking Creditex access" color={colours.green}/> : <>
    <Text style={styles.error}>{access.error || 'Access could not be confirmed.'}</Text><FieldButton onPress={access.refresh}>Check access again</FieldButton>
    <FieldButton variant="secondary" onPress={() => void Linking.openURL(`${API_BASE_URL}/direct-trade/security`)}>Account security</FieldButton>
  </>}<FieldButton variant="quiet" loading={signingOut} onPress={() => void signOut()}>Sign out</FieldButton>{error ? <Text style={styles.error}>{error}</Text> : null}</Screen>;
  return <CreditexWorkspace key={`${access.data.member.organisationId}:${access.data.member.id}`} api={api} access={access.data} onSignOut={signOut} signingOut={signingOut} signOutError={error}/>;
}

export function CreditexWorkspace({ api, access, onSignOut, signingOut, signOutError }: { api: CreditexApi; access: CreditexAppAccess; onSignOut: () => Promise<void>; signingOut: boolean; signOutError: string }) {
  const [target, setTarget] = useState<Target>({ tab: 'home' });
  const [bell, setBell] = useState(false), [notificationPage, setNotificationPage] = useState(1), [noticeError, setNoticeError] = useState('');
  const notifications = useCreditexRemote<CreditexNotificationList>(api, `/api/creditex/notifications?filter=all&page=${notificationPage}`);
  const caps = access.capabilities;
  const tabs: Array<{ id: Tab; label: string; icon: 'home-outline' | 'clipboard-list-outline' | 'phone-outline' | 'checkbox-marked-outline' | 'account-circle-outline' }> = [
    { id: 'home', label: 'Home', icon: 'home-outline' }, ...(caps.jobs ? [{ id: 'jobs' as const, label: 'Jobs', icon: 'clipboard-list-outline' as const }] : []),
    ...(caps.messages ? [{ id: 'connect' as const, label: 'Connect', icon: 'phone-outline' as const }] : []), ...(caps.tasks ? [{ id: 'tasks' as const, label: 'Tasks', icon: 'checkbox-marked-outline' as const }] : []),
    { id: 'account', label: 'Account', icon: 'account-circle-outline' },
  ];
  const tab = tabs.some(item => item.id === target.tab) ? target.tab : 'home';
  function openNotification(destination: CreditexNotificationTarget) {
    if (destination.kind === 'task' && caps.tasks) setTarget({ tab: 'tasks', taskId: destination.taskId });
    else if (destination.kind === 'message' && caps.messages) setTarget({ tab: 'connect', peerId: destination.peerId });
    else if ((destination.kind === 'job' || destination.kind === 'call') && caps.jobs) setTarget({ tab: 'jobs', intentId: destination.intentId });
    else return false;
    setBell(false); return true;
  }
  async function viewNotice(id: string, destination: CreditexNotificationTarget) {
    if (!openNotification(destination)) { setNoticeError('Your access to this item has changed.'); return; }
    try { await api('/api/creditex/notifications', { action: 'read', ids: [id] }); notifications.refresh(); }
    catch (cause) { setNoticeError(cause instanceof Error ? cause.message : 'The notification could not be marked read.'); }
  }
  return <SafeAreaView style={styles.fill} edges={['top', 'bottom']}><View style={styles.header}><View style={styles.grow}><Text style={styles.label}>TLink · {access.member.organisationName}</Text><Text style={styles.body}>{access.member.name}</Text></View>
    <Pressable accessibilityRole="button" accessibilityLabel={`Notifications, ${notifications.data?.unreadCount || 0} unread`} onPress={() => setBell(true)} style={{ padding: 10 }}><MaterialCommunityIcons name="bell-outline" size={25} color={colours.ink}/>{Boolean(notifications.data?.unreadCount) && <Text style={styles.selected}>{notifications.data?.unreadCount}</Text>}</Pressable></View>
    <View style={styles.fill}>{tab === 'home' ? <Home api={api} access={access} onNavigate={setTarget}/> : tab === 'jobs' ? <Jobs key={target.intentId || 'list'} api={api} intentId={target.intentId} onBack={() => setTarget({ tab: 'jobs' })}/> : tab === 'connect' ? <CreditexConnect key={target.peerId || 'people'} api={api} access={access} initialPeerId={target.peerId}/> : tab === 'tasks' ? <CreditexTasks key={target.taskId || 'tasks'} api={api} access={access} initialTaskId={target.taskId}/> : <Screen><Text style={styles.title}>My account</Text><Text style={styles.heading}>{access.member.name}</Text><Text style={styles.body}>{access.member.email}</Text><Text style={styles.body}>Creditex access is checked online. Team permissions and suspended access apply here immediately on the server.</Text><Text style={styles.body}>This app provides jobs, messages, tasks and in-app notifications. Full audits, customer calls, calculator, map and administration open in the web workspace.</Text><WebWorkspaceButton/><FieldButton variant="secondary" onPress={() => void Linking.openURL(`${API_BASE_URL}/direct-trade/security`)}>Account security</FieldButton><FieldButton variant="quiet" loading={signingOut} onPress={() => void onSignOut()}>Sign out</FieldButton>{signOutError ? <Text style={styles.error}>{signOutError}</Text> : null}</Screen>}</View>
    <View style={styles.tabBar}>{tabs.map(item => <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: tab === item.id }} onPress={() => setTarget({ tab: item.id })} style={styles.tab}><MaterialCommunityIcons name={item.icon} size={24} color={tab === item.id ? colours.green : colours.muted}/><Text style={[styles.tabText, tab === item.id && styles.selected]}>{item.label}</Text></Pressable>)}</View>
    <Modal visible={bell} transparent animationType="fade" onRequestClose={() => setBell(false)}><Pressable accessibilityLabel="Close notifications" style={styles.overlay} onPress={() => setBell(false)}><Pressable accessibilityRole="none" style={styles.popup} onPress={event => event.stopPropagation()}><View style={styles.row}><Text style={[styles.heading, styles.grow]}>Notifications</Text><Pressable accessibilityRole="button" accessibilityLabel="Close notifications" onPress={() => setBell(false)} style={{ padding: 10 }}><MaterialCommunityIcons name="close" size={24} color={colours.ink}/></Pressable></View><ScrollView><View style={{ gap: 12 }}>{notifications.loading ? <ActivityIndicator color={colours.green}/> : null}{(notifications.error || noticeError) ? <Text style={styles.error}>{notifications.error || noticeError}</Text> : null}{notifications.data?.items.map(item => <Pressable accessibilityRole="button" key={item.id} onPress={() => void viewNotice(item.id, item.target)} style={styles.card}><Text style={[styles.label, !item.read && styles.selected]}>{item.title}</Text><Text style={styles.body}>{item.detail}</Text><Text style={styles.body}>{formatDate(item.createdAt)}</Text></Pressable>)}{notifications.data && !notifications.data.items.length ? <Text style={styles.body}>You’re up to date.</Text> : null}</View></ScrollView><View style={styles.row}><FieldButton variant="quiet" disabled={notificationPage <= 1} onPress={() => setNotificationPage(value => value - 1)}>Previous</FieldButton><FieldButton variant="quiet" disabled={notificationPage >= (notifications.data?.totalPages || 1)} onPress={() => setNotificationPage(value => value + 1)}>Next</FieldButton><FieldButton variant="quiet" onPress={notifications.refresh}>Refresh</FieldButton></View></Pressable></Pressable></Modal>
  </SafeAreaView>;
}

function formatDate(value: string) { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : ''; }
export function WebWorkspaceButton({ label = 'Open web workspace' }: { label?: string }) {
  const [error, setError] = useState('');
  return <><FieldButton variant="secondary" onPress={() => void Linking.openURL(`${API_BASE_URL}/creditex/compliance`).catch(() => setError('Your browser could not open. Try again.'))}>{label}</FieldButton>{error ? <Text style={styles.error}>{error}</Text> : null}</>;
}
function Home({ api, access, onNavigate }: { api: CreditexApi; access: CreditexAppAccess; onNavigate: (target: Target) => void }) {
  const remote = useCreditexRemote<{ dashboard: Dashboard }>(api, '/api/creditex/job-audit?view=dashboard', access.capabilities.jobs);
  return <Screen><Text style={styles.title}>Home dashboard</Text><Text style={styles.body}>Your compliance work, ready to move.</Text>{access.capabilities.jobs ? <>{remote.error ? <Text style={styles.error}>{remote.error}</Text> : null}<View style={styles.row}>{([{ key: 'awaitingAudit', label: 'Awaiting audit' }, { key: 'correctionsRequired', label: 'Corrections required' }, { key: 'auditCompleted', label: 'Audits completed' }, { key: 'readyForSubmission', label: 'Ready for submission' }] as const).map(metric => <Pressable key={metric.key} accessibilityRole="button" onPress={() => onNavigate({ tab: 'jobs' })} style={styles.metric}><Text style={styles.label}>{metric.label}</Text><Text style={styles.metricNumber}>{remote.data?.dashboard[metric.key] ?? '…'}</Text></Pressable>)}</View><Text style={styles.body}>Counts are per job activity.</Text><FieldButton variant="quiet" onPress={remote.refresh}>Refresh workload</FieldButton></> : null}
    {access.capabilities.messages ? <FieldButton onPress={() => onNavigate({ tab: 'connect' })}>Connect with your team</FieldButton> : null}{access.capabilities.tasks ? <FieldButton variant="secondary" onPress={() => onNavigate({ tab: 'tasks' })}>My tasks</FieldButton> : null}<View style={styles.card}><Text style={styles.heading}>Full workspace tools</Text><Text style={styles.body}>Use the calculator, customer and job map, full audit desk and settings in your web workspace. Sign in there with {access.member.email}.</Text><WebWorkspaceButton/></View>
  </Screen>;
}
function Jobs({ api, intentId, onBack }: { api: CreditexApi; intentId?: string; onBack: () => void }) {
  const [search, setSearch] = useState(''), [appliedSearch, setAppliedSearch] = useState(''), [page, setPage] = useState(1), [selected, setSelected] = useState(intentId || '');
  useEffect(() => { const timer = setTimeout(() => { setAppliedSearch(search); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  const query = new URLSearchParams({ status: 'all', certificateType: 'all', search: appliedSearch, page: String(page), sort: 'updatedAt', sortDirection: 'desc' });
  const remote = useCreditexRemote<{ items: Job[]; total: number; totalPages: number; page: number }>(api, `/api/creditex/job-intents?${query}`, !selected);
  if (selected) return <JobDetails key={selected} api={api} intentId={selected} onBack={() => { setSelected(''); onBack(); }}/>;
  return <Screen><Text style={styles.title}>Jobs</Text><TextInput accessibilityLabel="Search jobs and customers" placeholder="Search jobs and customers" placeholderTextColor={colours.muted} style={styles.input} value={search} onChangeText={setSearch}/>{remote.loading ? <ActivityIndicator color={colours.green}/> : null}{remote.error ? <Text style={styles.error}>{remote.error}</Text> : null}{remote.data?.items.map(job => <Pressable key={job.id} accessibilityRole="button" onPress={() => setSelected(job.id)} style={styles.card}><Text style={styles.label}>{job.jobNumber} · {job.lifecycle.label}</Text><Text style={styles.heading}>{job.customerName || job.jobTitle}</Text><Text style={styles.body}>{job.activityTitle}</Text><Text style={styles.body}>{job.serviceAddress}</Text><Text style={styles.body}>{job.installerBusiness}</Text></Pressable>)}{remote.data && !remote.data.items.length ? <Text style={styles.body}>No jobs match this search.</Text> : null}<View style={styles.row}><FieldButton variant="quiet" disabled={page <= 1} onPress={() => setPage(value => value - 1)}>Previous</FieldButton><Text style={styles.body}>{remote.data ? `Page ${remote.data.page} of ${remote.data.totalPages}` : ''}</Text><FieldButton variant="quiet" disabled={page >= (remote.data?.totalPages || 1)} onPress={() => setPage(value => value + 1)}>Next</FieldButton><FieldButton variant="quiet" onPress={remote.refresh}>Refresh</FieldButton></View></Screen>;
}
function JobDetails({ api, intentId, onBack }: { api: CreditexApi; intentId: string; onBack: () => void }) {
  const remote = useCreditexRemote<{ workspace: CreditexJobAuditWorkspace }>(api, `/api/creditex/job-audit?intentId=${encodeURIComponent(intentId)}`);
  const job = remote.data?.workspace;
  return <Screen><FieldButton variant="quiet" onPress={onBack}>Back to jobs</FieldButton>{remote.loading ? <ActivityIndicator color={colours.green}/> : null}{remote.error ? <><Text style={styles.error}>{remote.error}</Text><FieldButton onPress={remote.refresh}>Try again</FieldButton></> : null}{job ? <><Text style={styles.title}>{job.target.jobNumber}</Text><Text style={styles.heading}>{job.target.customerName}</Text><Text style={styles.body}>{job.target.siteAddress}</Text><Text style={styles.body}>{job.target.activityTitle} · {job.target.assignee}</Text><Text style={styles.body}>{job.auditCompleted ? 'Audit completed' : 'Awaiting audit'}{job.submissionReady ? ' · Ready for submission' : ''}</Text><WebWorkspaceButton label="Open full audit workspace"/><Text style={styles.body}>Complete the audit and preview original files in the web workspace.</Text><Text style={styles.heading}>Field answers</Text>{job.records.map(record => <View key={`${record.kind}:${record.id}`} style={styles.card}><Text style={styles.heading}>{record.title}</Text>{record.answers.map(answer => <View key={answer.key}><Text style={styles.label}>{answer.label}</Text><Text style={styles.body}>{typeof answer.value === 'string' ? answer.value : answer.value == null ? 'Not answered' : JSON.stringify(answer.value)}</Text></View>)}</View>)}<Text style={styles.heading}>Files · {job.files.length}</Text>{job.files.map(file => <View key={`${file.kind}:${file.id}`} style={styles.card}><Text style={styles.label}>{file.label}</Text><Text style={styles.body}>{file.contentType}{file.unavailableReason ? ` · ${file.unavailableReason}` : ''}</Text></View>)}</> : null}</Screen>;
}
