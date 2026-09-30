import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/lib/api';
import { definitiveMessageFailure, emptyMessageDraft, mergeTeamMessages, pendingMessage, smsAction, smsHistory, smsSendBlock, smsStatusLabels, teamAction, teamHistory, teamThreadName, type MessageDraft, type MessageSelection, type SmsConversation, type SmsMessage, type TeamMessage } from '@/lib/messages-client';
import { colours, radius } from '@/lib/theme';
import { useNativeTeamCalls } from '@/providers/native-team-call-provider';
import { FieldButton } from '@/components/field-button';
import { MessageMedia, MessageMediaComposer } from '@/components/messages-media';
import { customerColour, MessageAvatar, MessageIconButton, MessageKeyboardView, MessageLoading, MessageNotice, messageStyles } from '@/components/messages-ui';

type DisplayMessage = { id: string; sender: string; body: string; mine: boolean; createdAt: string; status?: string; attachments: TeamMessage['attachments'] };

export function MessagesConversation({ selection, memberId, draft, onDraft, onBack, onRead, online }: {
  selection: MessageSelection; memberId: string; draft: MessageDraft; onDraft: (draft: MessageDraft) => void; onBack: () => void; onRead: () => void; online: boolean;
}) {
  const calls = useNativeTeamCalls();
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [sms, setSms] = useState<SmsConversation | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [mediaBusy, setMediaBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [consent, setConsent] = useState('');
  const [denied, setDenied] = useState(false);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const loadingRequest = useRef(false);
  const controller = useRef(new AbortController());
  const readSequence = useRef(0);
  const draftRef = useRef(draft);
  const updateDraftRef = useRef(onDraft);
  const onReadRef = useRef(onRead);
  useEffect(() => { draftRef.current = draft; updateDraftRef.current = onDraft; onReadRef.current = onRead; }, [draft, onDraft, onRead]);
  const internal = selection.kind === 'team';
  const name = internal ? teamThreadName(selection.thread, memberId) : selection.customer.name;
  const accent = internal ? colours.green : customerColour;

  useEffect(() => {
    alive.current = true; controller.current = new AbortController();
    return () => { alive.current = false; controller.current.abort(); };
  }, []);

  const caughtError = useCallback((caught: unknown) => {
    if (!alive.current) return;
    if (caught instanceof ApiError && [401, 403].includes(caught.status)) { setDenied(true); setMessages([]); setSms(null); }
    setError(caught instanceof Error ? caught.message : 'Messages could not refresh. Try again.');
  }, []);
  const reconcile = useCallback((records: { requestId: string }[]) => {
    const pending = draftRef.current.pending;
    if (pending && records.some(message => message.requestId === pending.requestId)) {
      updateDraftRef.current(emptyMessageDraft()); setNotice('Message saved. Check its delivery status below.');
    }
  }, []);
  const load = useCallback(async (before = 0) => {
    if (!online || !alive.current || loadingRequest.current || inFlight.current) return;
    loadingRequest.current = true;
    try {
      if (selection.kind === 'team') {
        const result = await teamHistory(selection.thread.id, before, controller.current.signal);
        if (!alive.current) return;
        setMessages(current => mergeTeamMessages(current, result.messages));
        if (before || readSequence.current === 0) setHasOlder(result.hasOlder);
        reconcile(result.messages);
        const through = result.messages.at(-1)?.sequence || 0;
        if (!before && through > readSequence.current && AppState.currentState === 'active') {
          await teamAction({ action: 'read', threadId: selection.thread.id, throughSequence: through }, controller.current.signal);
          if (!alive.current) return;
          readSequence.current = through; onReadRef.current();
        }
      } else {
        const result = await smsHistory(selection.customer, controller.current.signal);
        if (!alive.current) return;
        setSms(result); reconcile(result.messages);
      }
      if (alive.current) { setDenied(false); setError(''); }
    } catch (caught) { caughtError(caught); }
    finally { loadingRequest.current = false; if (alive.current) setLoading(false); }
  }, [selection, online, caughtError, reconcile]);

  useFocusEffect(useCallback(() => {
    let focused = true;
    const refresh = () => { if (focused && AppState.currentState === 'active') void load(); };
    refresh();
    const timer = setInterval(refresh, 3000);
    const app = AppState.addEventListener('change', refresh);
    return () => { focused = false; clearInterval(timer); app.remove(); };
  }, [load]));

  async function send() {
    if (inFlight.current || mediaBusy || !online || denied || (!draftRef.current.body.trim() && !draftRef.current.attachments.length)) return;
    if (!internal && smsSendBlock(sms)) return;
    const current = draftRef.current;
    const pending = pendingMessage(current);
    updateDraftRef.current({ ...current, pending });
    inFlight.current = true; setBusy('send'); setError(''); setNotice('');
    try {
      if (selection.kind === 'team') {
        const result = await teamAction<{ message: TeamMessage }>({ action: 'send', threadId: selection.thread.id, ...pending }, controller.current.signal);
        if (!alive.current) return;
        setMessages(records => mergeTeamMessages(records, [result.message]));
      } else {
        const result = await smsAction<{ message: SmsMessage }>(selection.customer, { action: 'send', ...pending }, controller.current.signal);
        if (!alive.current) return;
        setSms(currentSms => currentSms ? { ...currentSms, messages: [...currentSms.messages.filter(item => item.id !== result.message.id), result.message] } : currentSms);
        setNotice(smsStatusLabels[result.message.status] || 'Message saved. Delivery status will update here.');
      }
      updateDraftRef.current(emptyMessageDraft()); onReadRef.current();
    } catch (caught) {
      if (!alive.current) return;
      if (definitiveMessageFailure(caught)) { updateDraftRef.current({ ...current, pending: null }); caughtError(caught); }
      else setError('The send result is not confirmed. Your message is kept. Tap Check send to retry this same request safely.');
    } finally { inFlight.current = false; if (alive.current) setBusy(''); }
  }

  async function recordConsent() {
    if (selection.kind !== 'customer' || inFlight.current || !online || consent.trim().length < 8) return;
    inFlight.current = true; setBusy('consent'); setError('');
    try {
      await smsAction(selection.customer, { action: 'consent', consentNote: consent.trim() }, controller.current.signal);
      if (alive.current) { setConsent(''); setNotice('Service text permission saved.'); }
    } catch (caught) { caughtError(caught); }
    finally { inFlight.current = false; if (alive.current) { setBusy(''); void load(); } }
  }

  const display: DisplayMessage[] = internal ? messages.map(message => ({ ...message, sender: message.senderName })) : (sms?.messages || []).map(message => ({ ...message, sender: message.direction === 'inbound' ? name : message.senderName || 'Your business', mine: message.direction === 'outbound', attachments: [], status: smsStatusLabels[message.status] || 'Status pending' }));
  const sendBlocked = !online || denied || loading || Boolean(busy) || mediaBusy || (!internal && Boolean(smsSendBlock(sms)));
  return <MessageKeyboardView style={styles.container}>
    <View style={styles.header}>
      <MessageIconButton icon="arrow-left" label="All chats" onPress={onBack} />
      <MessageAvatar name={name} customer={!internal} group={internal && selection.thread.kind === 'group'} />
      <View style={messageStyles.grow}><Text numberOfLines={2} style={messageStyles.title}>{name}</Text><Text style={[messageStyles.label, { color: accent }]}>{internal ? 'Team chat' : 'Customer SMS'}</Text></View>
      {internal ? <View style={styles.callButtons}>
        <MessageIconButton surface icon="phone-outline" label="Voice call" disabled={calls.busy || !online || denied || mediaBusy} onPress={() => { void calls.start(selection.thread.id, 'audio'); }} />
        <MessageIconButton surface icon="video-outline" label="Video call" disabled={calls.busy || !online || denied || mediaBusy} onPress={() => { void calls.start(selection.thread.id, 'video'); }} />
      </View> : null}
    </View>
    {!internal ? <Text style={styles.context}>{selection.customer.phone}{selection.customer.jobNumber ? ` · ${selection.customer.jobNumber}` : ''}{sms?.connection ? `\nFrom ${sms.connection.number} · Shared with your business` : ''}</Text> : null}
    {!online ? <MessageNotice>You’re offline. Reconnect to load and send messages.</MessageNotice> : null}
    {error ? <View style={styles.noticeRow}><MessageNotice error>{error}</MessageNotice><FieldButton variant="quiet" disabled={Boolean(busy) || !online} onPress={() => { setLoading(true); void load(); }}>Refresh</FieldButton></View> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.context}>{notice}</Text> : null}
    {!internal && sms && smsSendBlock(sms) ? <MessageNotice>{smsSendBlock(sms)}</MessageNotice> : null}
    {!internal && sms?.connection?.accountType.toLowerCase() === 'trial' ? <MessageNotice>Trial SMS account: the customer’s number must be verified with your provider.</MessageNotice> : null}
    {!internal && sms?.connection?.status === 'connected' && sms.customerPhone && sms.consent === 'required' ? <View style={styles.consent}>
      <Text style={messageStyles.muted}>How and when did they agree to service texts?</Text>
      <TextInput accessibilityLabel="Customer permission for service texts" multiline maxLength={500} value={consent} onChangeText={setConsent} editable={!busy} placeholder="For example: agreed by phone today to appointment updates" placeholderTextColor={colours.muted} style={messageStyles.input} />
      <FieldButton disabled={consent.trim().length < 8 || !online} loading={busy === 'consent'} onPress={() => void recordConsent()}>Save permission</FieldButton>
    </View> : null}
    {loading && !display.length ? <MessageLoading /> : null}
    <FlatList style={styles.history} inverted data={[...display].reverse()} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets={false}
      contentContainerStyle={styles.historyContent}
      ListEmptyComponent={!loading && !error ? <Text style={styles.empty}>{internal ? 'No messages yet. Say hello below.' : 'No texts yet. Replies will appear here.'}</Text> : null}
      ListFooterComponent={internal && hasOlder ? <FieldButton variant="quiet" loading={busy === 'older'} onPress={() => { setBusy('older'); void load(messages[0]?.sequence || 0).finally(() => { if (alive.current) setBusy(''); }); }}>Earlier messages</FieldButton> : !internal && display.length >= 100 ? <Text style={styles.context}>Showing the latest 100 texts</Text> : null}
      renderItem={({ item }) => <View style={[styles.bubble, item.mine ? (internal ? styles.mine : styles.customerMine) : styles.theirs]}>
        <Text style={[styles.sender, { color: item.mine ? accent : colours.muted }]}>{item.sender}</Text>
        {item.body ? <Text selectable style={messageStyles.body}>{item.body}</Text> : null}
        {item.attachments.map(attachment => <MessageMedia key={attachment.id} attachment={attachment} callsBusy={calls.busy} />)}
        <Text style={styles.time}>{new Date(item.createdAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}{item.status ? ` · ${item.status}` : ''}</Text>
      </View>} />
    <View style={styles.composer}>
      {draft.attachments.length ? <View style={styles.pendingFiles}>{draft.attachments.map((file, index) => <View key={file.id} style={styles.pendingFile}><Text style={messageStyles.muted}>{file.kind === 'image' ? 'Photo' : 'Voice note'} {index + 1}</Text><MessageIconButton icon="close" label={`Remove attachment ${index + 1}`} disabled={Boolean(busy || draft.pending)} onPress={() => onDraft({ ...draft, attachments: draft.attachments.filter(item => item.id !== file.id) })} /></View>)}</View> : null}
      <View style={styles.entry}>
        <TextInput accessibilityLabel={internal ? 'Team message' : 'Customer SMS'} value={draft.body} onChangeText={body => onDraft({ ...draft, body })} multiline maxLength={internal ? 2000 : 480} editable={!busy && !draft.pending && !denied} placeholder={internal ? 'Message your team' : 'Write a service update'} placeholderTextColor={colours.muted} style={styles.messageInput} />
        <Pressable accessibilityRole="button" accessibilityLabel={draft.pending ? 'Check send' : internal ? 'Send message' : 'Send SMS'} disabled={sendBlocked || (!draft.body.trim() && !draft.attachments.length)} onPress={() => void send()} style={[styles.send, { backgroundColor: accent }, (sendBlocked || (!draft.body.trim() && !draft.attachments.length)) && { opacity: 0.4 }]}><Text style={styles.sendText}>{busy === 'send' ? 'Sending' : draft.pending ? 'Check send' : 'Send'}</Text></Pressable>
      </View>
      {internal ? <MessageMediaComposer threadId={selection.thread.id} disabled={Boolean(busy || draft.pending) || !online || denied} callsBusy={calls.busy} count={draft.attachments.length}
        onAdd={attachment => onDraft({ ...draftRef.current, attachments: [...draftRef.current.attachments, attachment] })} onBusyChange={setMediaBusy} onError={setError} /> : <Text style={styles.smsHint}>{draft.body.length}/480 · Business name, job reference and STOP instructions are added automatically.</Text>}
    </View>
  </MessageKeyboardView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0, gap: 8 }, header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colours.line },
  callButtons: { flexDirection: 'row', gap: 6 }, context: { color: colours.muted, fontSize: 12, lineHeight: 18, paddingHorizontal: 8 }, noticeRow: { gap: 2 },
  consent: { gap: 8, padding: 10, borderRadius: radius.sm, backgroundColor: colours.surfaceRaised }, history: { flex: 1, minHeight: 0 }, historyContent: { padding: 6, gap: 10 },
  bubble: { maxWidth: '90%', minWidth: 130, borderRadius: 16, padding: 12, gap: 6, borderWidth: 1 }, mine: { alignSelf: 'flex-end', backgroundColor: '#153e36', borderColor: '#28634f' }, customerMine: { alignSelf: 'flex-end', backgroundColor: '#312642', borderColor: '#61467c' }, theirs: { alignSelf: 'flex-start', backgroundColor: colours.surfaceRaised, borderColor: colours.line },
  sender: { fontSize: 12, fontWeight: '700' }, time: { color: colours.muted, fontSize: 10, lineHeight: 15 }, empty: { textAlign: 'center', color: colours.muted, padding: 30 },
  composer: { borderTopWidth: 1, borderTopColor: colours.line, paddingTop: 10, gap: 6 }, entry: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' }, messageInput: { flex: 1, minHeight: 48, maxHeight: 116, padding: 12, borderWidth: 1, borderColor: colours.line, borderRadius: 16, color: colours.ink, backgroundColor: colours.surface, fontSize: 16 }, send: { minHeight: 48, minWidth: 64, borderRadius: 14, paddingHorizontal: 12, justifyContent: 'center' }, sendText: { color: colours.forest, fontSize: 14, fontWeight: '800' },
  pendingFiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, pendingFile: { flexDirection: 'row', alignItems: 'center', backgroundColor: colours.surfaceRaised, paddingLeft: 10, borderRadius: 10 }, smsHint: { fontSize: 11, lineHeight: 17, color: colours.muted },
});
