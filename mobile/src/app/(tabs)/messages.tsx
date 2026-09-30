import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { randomUUID } from 'expo-crypto';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { DeviceNotificationSettings } from '@/components/device-notification-settings';
import { FieldButton } from '@/components/field-button';
import { MessagesConversation } from '@/components/messages-conversation';
import { customerColour, MessageAvatar, MessageIconButton, MessageKeyboardView, MessageLoading, MessageNotice, messagePresenceLabel, messageStyles } from '@/components/messages-ui';
import { Screen } from '@/components/screen';
import { ApiError } from '@/lib/api';
import { acknowledgeTeamDeliveries, customerThreads, definitiveMessageFailure, emptyMessageDraft, messageContacts, messagesOverview, messageThread, selectionKey, teamAction, teamThreadName, type CustomerThread, type MessageContacts, type MessageDraft, type MessageMember, type MessageOverview, type MessageSelection, type TeamThread } from '@/lib/messages-client';
import { teamNotificationTarget } from '@/lib/team-messages';
import { colours, radius } from '@/lib/theme';
import { useApp } from '@/providers/app-provider';
import { useNativeTeamCalls } from '@/providers/native-team-call-provider';

type InboxRow = { key: string; thread: TeamThread; customer: null } | { key: string; thread: null; customer: CustomerThread };

function NewChat({ overview, online, onSelect, onClose }: { overview: MessageOverview | null; online: boolean; onSelect: (selection: MessageSelection) => void; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<MessageContacts | null>(null);
  const [members, setMembers] = useState<MessageMember[]>([]);
  const [subject, setSubject] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ memberIds: string[]; subject: string; requestId: string } | null>(null);
  const active = useRef(true), inFlight = useRef(false);
  const lifetime = useRef(new AbortController());
  useEffect(() => { active.current = true; lifetime.current = new AbortController(); return () => { active.current = false; lifetime.current.abort(); }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    let refreshing = false;
    const refresh = (initial = false) => {
      if (refreshing || controller.signal.aborted || AppState.currentState !== 'active') return;
      if (initial) { setLoading(true); setResults(null); }
      if (!online) { setLoading(false); setError('Connect to the internet to find your contacts.'); return; }
      refreshing = true;
      void messageContacts(search, controller.signal).then(result => { if (!controller.signal.aborted) { setResults(result); setError(''); } })
        .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Contacts could not load.'); })
        .finally(() => { refreshing = false; if (!controller.signal.aborted) setLoading(false); });
    };
    const timer = setTimeout(() => refresh(true), search ? 250 : 0);
    const poll = setInterval(() => refresh(), 10000);
    const app = AppState.addEventListener('change', () => refresh());
    return () => { controller.abort(); clearTimeout(timer); clearInterval(poll); app.remove(); };
  }, [search, online]);
  async function create() {
    if (inFlight.current || !members.length || !online) return;
    const submission = pending || { memberIds: members.map(member => member.id), subject: subject.trim(), requestId: randomUUID() };
    inFlight.current = true; setBusy(true); setPending(submission); setError('');
    try {
      const result = await teamAction<{ thread: Pick<TeamThread, 'id' | 'subject' | 'kind'> }>({ action: 'create', ...submission }, lifetime.current.signal);
      if (!active.current) return;
      onSelect({ kind: 'team', thread: { ...result.thread, latest: '', latestSender: '', unread: 0, members: [...members, ...(overview?.members.filter(member => member.id === overview.memberId) || [])] } });
    } catch (caught) {
      if (!active.current) return;
      if (definitiveMessageFailure(caught)) setPending(null);
      setError(caught instanceof Error && definitiveMessageFailure(caught) ? caught.message : 'The result is not confirmed. Tap Check chat to safely retry the same request.');
    } finally { inFlight.current = false; if (active.current) setBusy(false); }
  }
  return <Modal animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
    <Screen scroll={false}><MessageKeyboardView style={styles.fill}>
      <View style={messageStyles.row}><Text style={[styles.heading, messageStyles.grow]}>New chat</Text><MessageIconButton icon="close" label="Close new chat" disabled={busy} onPress={onClose} /></View>
      <TextInput autoFocus accessibilityLabel="Find a name or phone number" placeholder="Name or phone number" placeholderTextColor={colours.muted} value={search} onChangeText={setSearch} editable={!busy && !pending} style={messageStyles.input} autoCapitalize="none" />
      {members.length ? <View style={styles.selectedPeople}>{members.map(member => <Pressable key={member.id} accessibilityRole="button" accessibilityLabel={`Remove ${member.name}`} disabled={busy || Boolean(pending)} onPress={() => setMembers(current => current.filter(item => item.id !== member.id))} style={styles.selectedPerson}><Text style={messageStyles.label}>{member.name} ×</Text></Pressable>)}</View> : <Text style={messageStyles.muted}>Choose a teammate, or several for a group.</Text>}
      {members.length > 1 ? <TextInput accessibilityLabel="Group name" value={subject} onChangeText={setSubject} editable={!busy && !pending} maxLength={80} placeholder="Group name, for example Office & installers" placeholderTextColor={colours.muted} style={messageStyles.input} /> : null}
      {error ? <MessageNotice error>{error}</MessageNotice> : null}
      {loading ? <MessageLoading /> : null}
      <FlatList data={[...(results?.members || []).map(member => ({ key: `member:${member.id}`, member, customer: null })), ...(results?.customerThreads || []).map(customer => ({ key: `customer:${customer.customerId}:${customer.workOrderId}`, member: null, customer }))]}
        keyExtractor={item => item.key} keyboardShouldPersistTaps="handled" style={styles.fill}
        ListEmptyComponent={!loading && results && !error ? <View style={messageStyles.empty}><Text style={messageStyles.body}>No matching contacts</Text><Text style={messageStyles.muted}>Search another name or saved phone number. Customers are shown only for jobs you can message.</Text></View> : null}
        renderItem={({ item }) => item.member ? <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: members.some(member => member.id === item.member!.id) }} disabled={busy || Boolean(pending)} onPress={() => { const member = item.member; if (!member) return; setMembers(current => current.some(value => value.id === member.id) ? current.filter(value => value.id !== member.id) : current.length < 24 ? [...current, member] : current); }} style={styles.contact}>
          <MessageAvatar name={item.member.name} presence={item.member.presence} /><View style={messageStyles.grow}><Text style={messageStyles.title}>{item.member.name}</Text><Text style={messageStyles.label}>Team{messagePresenceLabel(item.member.presence) ? ` · ${messagePresenceLabel(item.member.presence)}` : ''}{item.member.isOwner ? ' · Owner' : ''}</Text></View><MaterialCommunityIcons name={members.some(member => member.id === item.member!.id) ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={25} color={colours.green} />
        </Pressable> : item.customer ? <Pressable accessibilityRole="button" disabled={busy || Boolean(pending)} onPress={() => { if (item.customer) onSelect({ kind: 'customer', customer: item.customer }); }} style={styles.contact}>
          <MessageAvatar name={item.customer.name} customer /><View style={messageStyles.grow}><Text style={messageStyles.title}>{item.customer.name}</Text><Text style={[messageStyles.label, { color: customerColour }]}>Customer SMS</Text><Text style={messageStyles.muted}>{item.customer.phone}{item.customer.jobNumber ? ` · ${item.customer.jobNumber}` : ''}</Text></View><MaterialCommunityIcons name="chevron-right" size={23} color={colours.muted} />
        </Pressable> : null} />
      {members.length ? <FieldButton disabled={!online || (members.length > 1 && !subject.trim())} loading={busy} onPress={() => void create()}>{pending ? 'Check chat' : members.length > 1 ? 'Start group chat' : 'Start chat'}</FieldButton> : null}
    </MessageKeyboardView></Screen>
  </Modal>;
}

function NativeMessages({ online }: { online: boolean }) {
  const params = useLocalSearchParams<{ threadId?: string; callId?: string; notificationId?: string }>();
  const calls = useNativeTeamCalls();
  const [overview, setOverview] = useState<MessageOverview | null>(null);
  const [customers, setCustomers] = useState<CustomerThread[]>([]);
  const [moreCustomers, setMoreCustomers] = useState(false);
  const [mode, setMode] = useState<'team' | 'customers'>('team');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<MessageSelection | null>(null);
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, MessageDraft>>({});
  const active = useRef(true);
  const delivered = useRef(new Map<string, number>());
  const delivering = useRef(false);
  const deliveryController = useRef(new AbortController());
  const requestEpoch = useRef(0);
  const lastNotification = useRef('');
  const openInvitationRef = useRef(calls.openInvitation);
  useEffect(() => { openInvitationRef.current = calls.openInvitation; }, [calls.openInvitation]);
  useEffect(() => { active.current = true; deliveryController.current = new AbortController(); return () => { active.current = false; deliveryController.current.abort(); }; }, []);
  const refresh = useCallback(async () => {
    if (!online) { setLoading(false); return; }
    const epoch = ++requestEpoch.current;
    try {
      const next = await messagesOverview(mode === 'team' ? search : '', mode === 'team' ? page : 1);
      if (!active.current || epoch !== requestEpoch.current) return;
      setOverview(next);
      if (!delivering.current) {
        delivering.current = true;
        void acknowledgeTeamDeliveries(next.threads.map(thread => ({ id: thread.id, sequence: thread.latestSequence || 0 })), delivered.current, deliveryController.current.signal)
          .finally(() => { delivering.current = false; });
      }
      if (!next.canUseSms) { setCustomers([]); setMoreCustomers(false); if (mode === 'customers') setMode('team'); }
      if (mode === 'customers' && next.canUseSms) {
        const result = await customerThreads(search, page);
        if (!active.current || epoch !== requestEpoch.current) return;
        setCustomers(result.customerThreads); setMoreCustomers(result.hasMore);
      }
      setError('');
    } catch (caught) {
      if (!active.current || epoch !== requestEpoch.current) return;
      if (caught instanceof ApiError && [401, 403].includes(caught.status)) { setOverview(null); setCustomers([]); setSelection(null); setDrafts({}); }
      setError(caught instanceof Error ? caught.message : 'Messages could not load. Try again.');
    } finally { if (active.current && epoch === requestEpoch.current) setLoading(false); }
  }, [mode, online, page, search]);
  useFocusEffect(useCallback(() => {
    let focused = true;
    setLoading(true);
    const tick = () => { if (focused && !selection && AppState.currentState === 'active') void refresh(); };
    const initial = setTimeout(tick, search ? 250 : 0);
    const timer = setInterval(tick, 10000);
    const app = AppState.addEventListener('change', tick);
    return () => { focused = false; clearTimeout(initial); clearInterval(timer); app.remove(); requestEpoch.current++; };
  }, [refresh, search, selection]));
  useEffect(() => {
    if (!params.notificationId || params.notificationId === lastNotification.current) return;
    const target = teamNotificationTarget({ type: params.callId ? 'team_call' : 'team_message', threadId: params.threadId, callId: params.callId });
    if (!target) return;
    const controller = new AbortController();
    void Promise.all([messageThread(target.threadId, controller.signal), messagesOverview('', 1, controller.signal)]).then(async ([result, nextOverview]) => {
      if (controller.signal.aborted || !active.current) return;
      if (!result.thread) throw new Error('This conversation is no longer available.');
      setOverview(nextOverview); setSelection({ kind: 'team', thread: result.thread }); setMode('team');
      if (target.callId) await openInvitationRef.current({ threadId: target.threadId, callId: target.callId });
      if (controller.signal.aborted || !active.current) return;
      lastNotification.current = params.notificationId || ''; router.setParams({ notificationId: '', threadId: '', callId: '' });
    }).catch(caught => { if (!controller.signal.aborted && active.current) setError(caught instanceof Error ? caught.message : 'The conversation could not open.'); });
    return () => controller.abort();
  }, [params.notificationId, params.threadId, params.callId]);
  const select = (next: MessageSelection) => { setSelection(next); setCreating(false); setError(''); };
  const key = selection ? selectionKey(selection) : '';
  const hasMore = mode === 'team' ? overview?.hasMore : moreCustomers;
  return <Screen scroll={false} style={{ gap: 12 }}>
    {selection ? <MessagesConversation key={key} selection={selection} memberId={overview?.memberId || ''} online={online} draft={drafts[key] || emptyMessageDraft()} onDraft={value => setDrafts(current => ({ ...current, [key]: value }))} onBack={() => { setSelection(null); }} onRead={() => { void refresh(); }} /> : <>
      <View style={messageStyles.row}><View style={messageStyles.grow}><Text style={styles.heading}>Messages</Text><Text style={messageStyles.muted}>Your team and customers, together.</Text></View><MessageIconButton icon="bell-outline" label="Notification settings" onPress={() => setSettings(true)} /><MessageIconButton icon="square-edit-outline" label="New chat" disabled={!online} onPress={() => setCreating(true)} /></View>
      <View style={styles.tabs}>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: mode === 'team' }} onPress={() => { setMode('team'); setPage(1); setSearch(''); }} style={[styles.tab, mode === 'team' && { backgroundColor: colours.mintStrong }]}><MaterialCommunityIcons name="account-group-outline" size={20} color={colours.green} /><Text style={[styles.tabText, { color: colours.green }]}>Team</Text></Pressable>
        {overview?.canUseSms ? <Pressable accessibilityRole="tab" accessibilityState={{ selected: mode === 'customers' }} onPress={() => { setMode('customers'); setPage(1); setSearch(''); }} style={[styles.tab, mode === 'customers' && { backgroundColor: '#302441' }]}><MaterialCommunityIcons name="message-text-outline" size={20} color={customerColour} /><Text style={[styles.tabText, { color: customerColour }]}>Customers</Text></Pressable> : null}
      </View>
      <TextInput accessibilityLabel="Search conversations" value={search} onChangeText={value => { setSearch(value); setPage(1); }} placeholder={mode === 'team' ? 'Find a person or group' : 'Name, number or job reference'} placeholderTextColor={colours.muted} style={messageStyles.input} />
      {!online ? <MessageNotice>You’re offline. Reconnect to load messages.</MessageNotice> : null}
      {error ? <><MessageNotice error>{error}</MessageNotice><FieldButton variant="quiet" disabled={!online} onPress={() => { setLoading(true); void refresh(); }}>Try again</FieldButton></> : null}
      {loading && !overview ? <MessageLoading /> : null}
      <FlatList<InboxRow> style={styles.fill} data={mode === 'team' ? (overview?.threads || []).map(thread => ({ key: thread.id, thread, customer: null })) : customers.map(customer => ({ key: `${customer.customerId}:${customer.workOrderId}`, customer, thread: null }))} keyExtractor={item => item.key}
        refreshing={loading && Boolean(overview)} onRefresh={() => { setLoading(true); void refresh(); }} keyboardShouldPersistTaps="handled"
        ListEmptyComponent={!loading && overview && !error && online ? <View style={messageStyles.empty}><MaterialCommunityIcons name={mode === 'team' ? 'message-text-outline' : 'message-processing-outline'} size={44} color={mode === 'team' ? colours.green : customerColour} /><Text style={messageStyles.title}>{search ? 'No matching conversations' : 'No conversations yet'}</Text><Text style={[messageStyles.muted, { textAlign: 'center' }]}>{mode === 'team' ? 'Start a chat with a teammate, or create a group for the job.' : 'Customer texts appear here when your business has a saved mobile number and you have permission for the job.'}</Text><FieldButton onPress={() => setCreating(true)}>New chat</FieldButton></View> : null}
        renderItem={({ item }) => {
          const name = item.thread ? teamThreadName(item.thread, overview?.memberId || '') : item.customer?.name || '';
          const presence = item.thread?.kind === 'dm' ? item.thread.members.find(member => member.id !== overview?.memberId)?.presence : undefined;
          return <Pressable accessibilityRole="button" onPress={() => item.thread ? select({ kind: 'team', thread: item.thread }) : item.customer && select({ kind: 'customer', customer: item.customer })} style={({ pressed }) => [styles.contact, pressed && { backgroundColor: colours.surfaceRaised }]}>
            <MessageAvatar name={name} customer={Boolean(item.customer)} group={item.thread?.kind === 'group'} presence={presence} /><View style={messageStyles.grow}><View style={messageStyles.row}><Text numberOfLines={1} style={[styles.contactTitle, messageStyles.grow]}>{name}</Text>{Boolean(item.thread?.unread) ? <View style={styles.badge}><Text style={styles.badgeText}>{item.thread!.unread > 99 ? '99+' : item.thread!.unread}</Text></View> : null}</View><Text numberOfLines={1} style={messageStyles.muted}>{item.thread ? item.thread.latest ? `${item.thread.latestSender}: ${item.thread.latest}` : 'No messages yet' : item.customer?.latest || 'Start a service text'}</Text>{messagePresenceLabel(presence) ? <Text style={messageStyles.muted}>{messagePresenceLabel(presence)}</Text> : null}{item.customer ? <Text style={[messageStyles.label, { color: customerColour }]}>{item.customer.jobNumber || item.customer.phone}</Text> : null}</View><MaterialCommunityIcons name="chevron-right" size={22} color={colours.muted} />
          </Pressable>;
        }} />
      {(page > 1 || hasMore) ? <View style={messageStyles.row}><FieldButton variant="quiet" disabled={page === 1 || loading} onPress={() => setPage(value => value - 1)}>Previous</FieldButton><Text style={[messageStyles.muted, messageStyles.grow, { textAlign: 'center' }]}>Page {page}</Text><FieldButton variant="quiet" disabled={!hasMore || loading} onPress={() => setPage(value => value + 1)}>Next</FieldButton></View> : null}
    </>}
    {creating ? <NewChat overview={overview} online={online} onClose={() => setCreating(false)} onSelect={select} /> : null}
    <Modal visible={settings} animationType="slide" onRequestClose={() => setSettings(false)}><Screen><View style={messageStyles.row}><Text style={[styles.heading, messageStyles.grow]}>Notifications</Text><MessageIconButton icon="close" label="Close notifications" onPress={() => setSettings(false)} /></View><DeviceNotificationSettings /></Screen></Modal>
  </Screen>;
}

export default function MessagesScreen() {
  const { user, access, sync } = useApp();
  if (!user || access.status !== 'approved') return <Screen><MessageNotice>Sign in with approved team access to open messages.</MessageNotice></Screen>;
  // Changing member remounts every private conversation, draft and attachment.
  return <NativeMessages key={user.localOwnerKey} online={sync.online} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1, gap: 12 }, heading: { fontSize: 27, fontWeight: '800', color: colours.ink }, tabs: { flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: colours.surface, gap: 6 }, tab: { flex: 1, minHeight: 44, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, tabText: { fontSize: 15, fontWeight: '700' },
  contact: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colours.line, gap: 12 }, contactTitle: { color: colours.ink, fontSize: 16, fontWeight: '700' }, badge: { backgroundColor: colours.green, borderRadius: 12, minWidth: 22, alignItems: 'center', padding: 3 }, badgeText: { color: colours.forest, fontSize: 11, fontWeight: '800' }, selectedPeople: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, selectedPerson: { backgroundColor: colours.mintStrong, borderRadius: radius.sm, padding: 12 },
});
