import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, Text, View, type KeyboardEvent, type StyleProp, type ViewStyle } from 'react-native';

import type { MessageMember, TeamMessage } from '@/lib/messages-client';
import { colours, radius } from '@/lib/theme';

export const customerColour = '#c7a8ff';

/** The outer frame stays unchanged by the inset, including under Android adjustResize. */
export function MessageKeyboardView({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const viewport = useRef<View>(null);
  const measure = useRef(() => {});
  const [bottomInset, setBottomInset] = useState(0);
  useEffect(() => {
    let active = true;
    let generation = 0;
    let frame: number | undefined;
    let keyboard = Keyboard.metrics();
    const update = () => {
      const ticket = ++generation;
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = undefined;
        viewport.current?.measureInWindow((_x, y, _width, height) => {
          if (!active || ticket !== generation || height <= 0) return;
          // Measure in the keyboard's window coordinates, not a guessed header/tab offset.
          setBottomInset(keyboard && keyboard.height > 0
            ? Math.min(height, Math.max(0, y + height - keyboard.screenY)) : 0);
        });
      });
    };
    const changed = (event: KeyboardEvent) => { keyboard = event.endCoordinates; update(); };
    const hidden = () => { keyboard = undefined; update(); };
    measure.current = update;
    const subscriptions = [
      Keyboard.addListener('keyboardWillChangeFrame', changed),
      Keyboard.addListener('keyboardDidShow', changed),
      Keyboard.addListener('keyboardDidChangeFrame', changed),
      Keyboard.addListener('keyboardWillHide', hidden),
      Keyboard.addListener('keyboardDidHide', hidden),
    ];
    update();
    return () => {
      active = false; generation++;
      measure.current = () => {};
      if (frame !== undefined) cancelAnimationFrame(frame);
      subscriptions.forEach(subscription => subscription.remove());
    };
  }, []);
  return <View ref={viewport} collapsable={false} onLayout={() => measure.current()} style={messageStyles.keyboardViewport}>
    <View style={[messageStyles.keyboardViewport, style, { marginBottom: bottomInset }]}>{children}</View>
  </View>;
}

export function MessageIconButton({ icon, label, onPress, disabled, colour = colours.green, surface = false }: {
  icon: ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; onPress: () => void; disabled?: boolean; colour?: string; surface?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [messageStyles.iconButton, surface && messageStyles.iconSurface, pressed && { opacity: 0.65 }, disabled && { opacity: 0.35 }]}>
    <MaterialCommunityIcons name={icon} size={24} color={colour} />
  </Pressable>;
}
export function messagePresenceLabel(status: MessageMember['presence']) {
  return status === 'online' ? 'Online' : status === 'busy' ? 'Busy' : status === 'offline' ? 'Offline' : '';
}
export function MessagePresence({ status, name }: { status: MessageMember['presence']; name: string }) {
  const label = messagePresenceLabel(status);
  if (!label) return null;
  return <View accessible accessibilityLabel={`${name}: ${label}`} style={[messageStyles.presence,
    { backgroundColor: status === 'online' ? colours.green : status === 'busy' ? colours.amber : colours.muted }]} />;
}
export function MessageParticipants({ members }: { members: MessageMember[] }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={messageStyles.participants} contentContainerStyle={messageStyles.participantsContent}>
    {members.map(member => <View key={member.id} style={messageStyles.participant}>
      <MessagePresence name={member.name} status={member.presence} />
      <Text style={messageStyles.muted}>{member.name}{member.active === false ? ' · Former member' : ''}</Text>
    </View>)}
  </ScrollView>;
}
export function MessageAvatar({ name, customer = false, group = false, presence }: { name: string; customer?: boolean; group?: boolean; presence?: MessageMember['presence'] }) {
  return <View style={[messageStyles.avatar, customer && { backgroundColor: '#302441' }]}>
    {group ? <MaterialCommunityIcons name="account-group-outline" size={25} color={colours.green} /> : <Text style={[messageStyles.avatarText, customer && { color: customerColour }]}>{name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?'}</Text>}
    {!customer && !group && messagePresenceLabel(presence) ? <View style={messageStyles.avatarPresence}><MessagePresence name={name} status={presence} /></View> : null}
  </View>;
}
function receiptTime(value: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'time unavailable';
}
export function MessageReceipt({ receipt }: { receipt?: TeamMessage['receipt'] }) {
  const [expanded, setExpanded] = useState(false);
  const status = receipt?.status || 'sent';
  const label = status === 'read' ? `Read · ${receiptTime(receipt?.readAt || null)}` : status === 'delivered' ? 'Delivered' : 'Sent';
  const colour = status === 'read' ? colours.blue : colours.muted;
  return <View style={messageStyles.receipt}>
    <View accessible accessibilityLabel={label} style={messageStyles.receiptSummary}>
      <MaterialCommunityIcons name={status === 'sent' ? 'check' : 'check-all'} color={colour} size={16} />
      <Text style={[messageStyles.receiptText, { color: colour }]}>{label}</Text>
    </View>
    {receipt && receipt.recipientCount > 1 ? <>
      <Pressable accessibilityRole="button" accessibilityLabel="Message receipt details" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={messageStyles.receiptDetailsButton}>
        <Text style={messageStyles.receiptText}>{receipt.readCount}/{receipt.recipientCount} read · {receipt.deliveredCount}/{receipt.recipientCount} delivered</Text>
        <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={15} color={colours.muted} />
      </Pressable>
      {expanded ? receipt.recipients.map(person => <Text key={person.memberId} style={messageStyles.receiptText}>
        {person.name} · {person.status === 'read' ? `Read · ${receiptTime(person.readAt)}` : person.status === 'delivered' ? `Delivered · ${receiptTime(person.deliveredAt)}` : 'Sent'}
      </Text>) : null}
    </> : null}
  </View>;
}
export function SmsMessageReceipt({ status }: { status: string }) {
  if (status !== 'sent' && status !== 'delivered') return null;
  const label = status === 'delivered' ? 'Delivered' : 'Sent to carrier';
  return <View accessible accessibilityLabel={label} style={messageStyles.receiptSummary}>
    <MaterialCommunityIcons name={status === 'delivered' ? 'check-all' : 'check'} color={colours.muted} size={16} />
    <Text style={messageStyles.receiptText}>{label}</Text>
  </View>;
}
export function MessageNotice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <Text accessibilityLiveRegion="polite" style={[messageStyles.notice, error && { color: colours.red, backgroundColor: colours.redSoft }]}>{children}</Text>;
}
export function MessageLoading() { return <ActivityIndicator color={colours.green} style={{ padding: 24 }} />; }
export const messageStyles = StyleSheet.create({
  keyboardViewport: { flex: 1, minHeight: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1, minWidth: 0 },
  title: { color: colours.ink, fontSize: 18, fontWeight: '700' },
  body: { color: colours.ink, fontSize: 16, lineHeight: 23 },
  muted: { color: colours.muted, fontSize: 13, lineHeight: 19 },
  label: { color: colours.green, fontSize: 12, fontWeight: '700' },
  input: { minHeight: 48, borderWidth: 1, borderColor: colours.line, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 12, color: colours.ink, fontSize: 16, backgroundColor: colours.surface },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  iconSurface: { backgroundColor: colours.mintStrong, borderRadius: 16, borderWidth: 1, borderColor: colours.line },
  avatar: { width: 46, height: 46, borderRadius: 16, backgroundColor: colours.mintStrong, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: colours.green, fontWeight: '700', fontSize: 18 },
  presence: { width: 10, height: 10, borderRadius: 5 }, avatarPresence: { position: 'absolute', bottom: -2, right: -2, padding: 3, borderRadius: 10, backgroundColor: colours.surface },
  participants: { flexGrow: 0 }, participantsContent: { gap: 8, paddingHorizontal: 4 }, participant: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12, backgroundColor: colours.surfaceRaised },
  receipt: { gap: 3 }, receiptSummary: { flexDirection: 'row', alignItems: 'center', gap: 4 }, receiptText: { color: colours.muted, fontSize: 11, lineHeight: 16 }, receiptDetailsButton: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 4 },
  notice: { color: colours.muted, backgroundColor: colours.surfaceRaised, borderRadius: radius.sm, padding: 12, fontSize: 14, lineHeight: 20 },
  empty: { padding: 24, gap: 12, alignItems: 'center' },
  divider: { height: 1, backgroundColor: colours.line },
});
