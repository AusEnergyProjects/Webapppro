import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, StyleSheet, Switch, Text, View } from 'react-native';

import { FieldButton } from '@/components/field-button';
import { apiRequest } from '@/lib/api';
import { deviceRegistration, getNativePushToken, notificationDeviceState, setNotificationsMuted } from '@/lib/device';
import { resolveFieldAccessModes } from '@/lib/sync';
import { colours, radius, spacing } from '@/lib/theme';
import { useApp } from '@/providers/app-provider';

export function DeviceNotificationSettings() {
  const { sync } = useApp();
  const [state, setState] = useState<Awaited<ReturnType<typeof notificationDeviceState>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const refresh = useCallback(() => notificationDeviceState()
    .then(setState)
    .catch(() => setMessage('Notification settings could not be read. Try again.')), []);

  useEffect(() => {
    void refresh();
    const foreground = AppState.addEventListener('change', (value) => { if (value === 'active') void refresh(); });
    return () => foreground.remove();
  }, [refresh]);

  async function changeEnabled(enabled: boolean) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await setNotificationsMuted(!enabled);
      if (enabled) {
        const push = await getNativePushToken(true);
        const current = await notificationDeviceState();
        if (!current.granted) setMessage('Allow notifications in your phone settings to receive alerts.');
        else if (!push.token) setMessage('Your phone allowed notifications, but registration is not ready. Reconnect and try again.');
      }
      if (!sync.online) setMessage('Reconnect to finish applying this notification setting.');
      else {
        const modes = await resolveFieldAccessModes();
        const registration = await deviceRegistration();
        if (!modes.length) throw new Error('Reconnect and check your team access to update notifications.');
        await Promise.all(modes.map((mode) => apiRequest(mode === 'creditex_manual'
          ? '/api/creditex/manual-field/devices' : '/api/trade-team/devices', {
          method: 'POST', body: JSON.stringify(registration),
        })));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'This setting could not be updated. Try again.');
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  const enabled = Boolean(state?.granted && !state.muted);
  return <View style={styles.card}>
    <View style={styles.heading}>
      <View style={styles.flex}><Text style={styles.title}>Notifications on this phone</Text><Text style={styles.body}>{enabled ? 'Alerts are allowed' : state?.muted ? 'Muted on this phone' : 'Allow alerts to stay up to date'}</Text></View>
      <Switch accessibilityLabel="Notifications on this phone" value={enabled} disabled={!state || busy || !state.physicalDevice} onValueChange={(value) => void changeEnabled(value)} trackColor={{ true: colours.green }} />
    </View>
    <Text style={styles.body}>Get work updates and team alerts. Your phone controls sounds and when alerts appear.</Text>
    {state && !state.physicalDevice ? <Text style={styles.body}>Use an installed app on a physical phone for notifications.</Text> : null}
    {state && !state.granted && !state.canAskAgain ? <FieldButton variant="secondary" onPress={() => void Linking.openSettings().catch(() => setMessage('Open your phone settings, choose TLink, then Notifications.'))}>Open phone settings</FieldButton> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colours.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colours.line, gap: spacing.sm },
  heading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flex: { flex: 1 },
  title: { color: colours.ink, fontSize: 19, fontWeight: '800' },
  body: { color: colours.muted, lineHeight: 21 },
  message: { color: colours.ink, backgroundColor: colours.mint, borderRadius: radius.sm, padding: spacing.sm, lineHeight: 20 },
});
