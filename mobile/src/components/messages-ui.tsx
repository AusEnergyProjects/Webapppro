import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colours, radius } from '@/lib/theme';

export const customerColour = '#c7a8ff';
export function MessageIconButton({ icon, label, onPress, disabled, colour = colours.green }: {
  icon: ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; onPress: () => void; disabled?: boolean; colour?: string;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [messageStyles.iconButton, pressed && { opacity: 0.65 }, disabled && { opacity: 0.35 }]}>
    <MaterialCommunityIcons name={icon} size={24} color={colour} />
  </Pressable>;
}
export function MessageAvatar({ name, customer = false, group = false }: { name: string; customer?: boolean; group?: boolean }) {
  return <View style={[messageStyles.avatar, customer && { backgroundColor: '#302441' }]}>
    {group ? <MaterialCommunityIcons name="account-group-outline" size={25} color={colours.green} /> : <Text style={[messageStyles.avatarText, customer && { color: customerColour }]}>{name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?'}</Text>}
  </View>;
}
export function MessageNotice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <Text accessibilityLiveRegion="polite" style={[messageStyles.notice, error && { color: colours.red, backgroundColor: colours.redSoft }]}>{children}</Text>;
}
export function MessageLoading() { return <ActivityIndicator color={colours.green} style={{ padding: 24 }} />; }
export const messageStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1, minWidth: 0 },
  title: { color: colours.ink, fontSize: 18, fontWeight: '700' },
  body: { color: colours.ink, fontSize: 16, lineHeight: 23 },
  muted: { color: colours.muted, fontSize: 13, lineHeight: 19 },
  label: { color: colours.green, fontSize: 12, fontWeight: '700' },
  input: { minHeight: 48, borderWidth: 1, borderColor: colours.line, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 12, color: colours.ink, fontSize: 16, backgroundColor: colours.surface },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  avatar: { width: 46, height: 46, borderRadius: 16, backgroundColor: colours.mintStrong, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: colours.green, fontWeight: '700', fontSize: 18 },
  notice: { color: colours.muted, backgroundColor: colours.surfaceRaised, borderRadius: radius.sm, padding: 12, fontSize: 14, lineHeight: 20 },
  empty: { padding: 24, gap: 12, alignItems: 'center' },
  divider: { height: 1, backgroundColor: colours.line },
});
