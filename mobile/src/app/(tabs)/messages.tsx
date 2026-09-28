import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { DeviceNotificationSettings } from '@/components/device-notification-settings';
import { FieldButton } from '@/components/field-button';
import { Screen } from '@/components/screen';
import { openTeamMessages, teamNotificationTarget, type TeamNotificationTarget } from '@/lib/team-messages';
import { colours, radius, spacing } from '@/lib/theme';
import { useApp } from '@/providers/app-provider';

export default function MessagesScreen() {
  const { access, sync } = useApp();
  const params = useLocalSearchParams<{ threadId?: string; callId?: string; notificationId?: string }>();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const openingRef = useRef(false);
  const lastNotification = useRef('');

  const open = useCallback(async (target?: TeamNotificationTarget) => {
    if (openingRef.current || access.status !== 'approved') return;
    openingRef.current = true;
    setOpening(true);
    setError('');
    try { await openTeamMessages(target); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Team messages could not open. Reconnect and try again.'); }
    finally { openingRef.current = false; setOpening(false); }
  }, [access.status]);

  useEffect(() => {
    if (access.status !== 'approved' || !params.notificationId || params.notificationId === lastNotification.current) return;
    const target = teamNotificationTarget({ type: params.callId ? 'team_call' : 'team_message', threadId: params.threadId, callId: params.callId });
    if (!target) return;
    lastNotification.current = params.notificationId;
    openingRef.current = true;
    void openTeamMessages(target)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Team messages could not open. Reconnect and try again.'))
      .finally(() => {
        openingRef.current = false;
        router.setParams({ notificationId: '' });
      });
  }, [access.status, params.callId, params.notificationId, params.threadId]);

  const target = teamNotificationTarget({ type: params.callId ? 'team_call' : 'team_message', threadId: params.threadId, callId: params.callId });
  return <Screen>
    <View style={styles.hero}><Text style={styles.eyebrow}>YOUR TEAM</Text><Text style={styles.heading}>Messages & calls</Text><Text style={styles.intro}>Chat with the office or call another team member from the job.</Text></View>
    <View style={styles.card}>
      <View style={styles.icon}><MaterialCommunityIcons name="message-video" size={38} color={colours.green} /></View>
      <Text style={styles.title}>Keep the team close</Text>
      <Text style={styles.body}>Team chat, voice and video open securely in your phone browser. You stay signed in.</Text>
      <FieldButton loading={opening} disabled={!sync.online} onPress={() => void open(target || undefined)}>{target ? 'Open conversation' : 'Open team messages'}</FieldButton>
      {!sync.online ? <Text style={styles.body}>Connect to the internet to open team messages.</Text> : null}
      {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      <Text style={styles.note}>Allow your browser to use the microphone or camera when you start or answer a call. Keep that page open during the call.</Text>
    </View>
    <DeviceNotificationSettings />
  </Screen>;
}

const styles = StyleSheet.create({
  hero: { gap: spacing.xs },
  eyebrow: { color: colours.green, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  heading: { color: colours.ink, fontSize: 28, fontWeight: '800' },
  intro: { color: colours.muted, fontSize: 16, lineHeight: 23 },
  card: { backgroundColor: colours.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colours.line, gap: spacing.md },
  icon: { alignSelf: 'flex-start', padding: spacing.md, backgroundColor: colours.mint, borderRadius: radius.md },
  title: { color: colours.ink, fontSize: 21, fontWeight: '800' },
  body: { color: colours.muted, fontSize: 16, lineHeight: 23 },
  note: { color: colours.muted, fontSize: 13, lineHeight: 20 },
  error: { color: colours.red, backgroundColor: colours.redSoft, borderRadius: radius.sm, padding: spacing.md, lineHeight: 21 },
});
