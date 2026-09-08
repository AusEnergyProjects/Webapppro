import { usePathname } from 'expo-router';
import * as Updates from 'expo-updates';
import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import { FieldButton } from '@/components/field-button';
import { colours, spacing } from '@/lib/theme';
import { useApp } from '@/providers/app-provider';

export function DashboardAppUpdate() {
  const pathname = usePathname();
  const { sync, access } = useApp();
  const { isUpdatePending, isStartupProcedureRunning } = Updates.useUpdates();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState('');
  const checking = useRef(false);
  const lastCheck = useRef(0);
  const onDashboard = pathname === '/work';
  const mayInstall = onDashboard && foreground && access.status === 'approved' && !sync.running;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!Updates.isEnabled || !mayInstall || !sync.online || isStartupProcedureRunning
      || isUpdatePending || checking.current || Date.now() - lastCheck.current < 5 * 60_000) return;
    checking.current = true;
    lastCheck.current = Date.now();
    void (async () => {
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) await Updates.fetchUpdateAsync();
      } catch {
        // Offline work remains usable; Settings exposes the explicit retry and its result.
      } finally {
        checking.current = false;
      }
    })();
  }, [mayInstall, sync.online, isStartupProcedureRunning, isUpdatePending]);

  async function install() {
    if (!mayInstall || installing) return;
    setInstalling(true);
    setError('');
    try {
      await Updates.reloadAsync();
    } catch {
      setInstalling(false);
      setError('The update could not restart. Try again when this phone is ready.');
    }
  }

  if (!onDashboard || !isUpdatePending) return null;
  return <View style={styles.banner}>
    <View style={styles.copy}><Text style={styles.title}>TLink update ready</Text><Text style={styles.text}>{error || 'Install the latest app improvements. Saved drafts stay on this phone.'}</Text></View>
    <FieldButton disabled={!mayInstall} loading={installing} onPress={() => void install()}>Install now</FieldButton>
  </View>;
}

const styles = StyleSheet.create({
  banner: { backgroundColor: colours.mint, padding: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colours.line },
  copy: { gap: spacing.xs },
  title: { color: colours.ink, fontWeight: '800', fontSize: 16 },
  text: { color: colours.ink, lineHeight: 20 },
});
