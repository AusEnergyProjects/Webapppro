import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, View, type KeyboardEvent, type StyleProp, type ViewStyle } from 'react-native';

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
  notice: { color: colours.muted, backgroundColor: colours.surfaceRaised, borderRadius: radius.sm, padding: 12, fontSize: 14, lineHeight: 20 },
  empty: { padding: 24, gap: 12, alignItems: 'center' },
  divider: { height: 1, backgroundColor: colours.line },
});
