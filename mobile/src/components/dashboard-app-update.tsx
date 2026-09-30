import { usePathname } from 'expo-router';
import * as Updates from 'expo-updates';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, StyleSheet, Text, View } from 'react-native';

import { FieldButton } from '@/components/field-button';
import { colours, spacing } from '@/lib/theme';
import { checkForAppUpdate, restartIntoUpdate, type UpdateCheckResult } from '@/lib/updates';
import { useApp } from '@/providers/app-provider';

export function DashboardAppUpdate() {
  const pathname = usePathname();
  const { sync, access } = useApp();
  const { isUpdatePending, isStartupProcedureRunning } = Updates.useUpdates();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState('');
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null);
  const checking = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const lastCheck = useRef(0);
  const onDashboard = pathname === '/work';
  const mayInstall = onDashboard && foreground && access.status === 'approved' && !sync.running;

  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => { mounted.current = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    if (!mayInstall || !sync.online || checking.current || Date.now() - lastCheck.current < 5 * 60_000) return;
    const controller = new AbortController();
    checking.current = controller;
    void (async () => {
      try {
        const result = await checkForAppUpdate({ signal: controller.signal, checkOta: !isStartupProcedureRunning && !isUpdatePending });
        if (!controller.signal.aborted) {
          setUpdate(result);
          lastCheck.current = Date.now();
        }
      } catch {
        // Offline work remains usable; Settings exposes the explicit retry and its result.
      } finally {
        if (checking.current === controller) checking.current = null;
      }
    })();
    return () => { controller.abort(); if (checking.current === controller) checking.current = null; };
  }, [mayInstall, sync.online, isStartupProcedureRunning, isUpdatePending]);

  async function install() {
    if (!mayInstall || installing) return;
    setInstalling(true);
    setError('');
    try {
      if (update?.kind === 'download') {
        await Linking.openURL(update.url);
        if (mounted.current) setInstalling(false);
      } else await restartIntoUpdate();
    } catch {
      if (!mounted.current) return;
      setInstalling(false);
      setError(update?.kind === 'download' ? 'The update link could not open. Try again when this phone is ready.'
        : 'The update could not restart. Try again when this phone is ready.');
    }
  }

  const nativeUpdate = update?.kind === 'download';
  const ready = update?.kind === 'ready' || (update?.kind === 'current' && isUpdatePending);
  if (!onDashboard || (!nativeUpdate && !ready)) return null;
  return <View style={styles.banner}>
    <View style={styles.copy}><Text style={styles.title}>{nativeUpdate ? 'New TLink app available' : 'TLink update ready'}</Text><Text style={styles.text}>{error || (nativeUpdate ? update.message : 'Install the latest app improvements. Saved drafts stay on this phone.')}</Text></View>
    <FieldButton disabled={!mayInstall} loading={installing} onPress={() => void install()}>{nativeUpdate ? 'Open app update' : 'Install now'}</FieldButton>
  </View>;
}

const styles = StyleSheet.create({
  banner: { backgroundColor: colours.mint, padding: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colours.line },
  copy: { gap: spacing.xs },
  title: { color: colours.ink, fontWeight: '800', fontSize: 16 },
  text: { color: colours.ink, lineHeight: 20 },
});
