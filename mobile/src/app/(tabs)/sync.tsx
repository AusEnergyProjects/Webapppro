import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Crypto from 'expo-crypto';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { FieldButton } from '@/components/field-button';
import { Screen } from '@/components/screen';
import { discardAction, getJob, listProblemActions, queueAction } from '@/lib/database';
import { colours, radius, spacing } from '@/lib/theme';
import type { OfflineAction, QueueRow } from '@/lib/types';
import { useApp } from '@/providers/app-provider';

function timeLabel(value: string) {
  if (!value) return 'Not synced yet';
  return new Date(value).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export default function SyncScreen() {
  const { sync, syncNow, refreshLocal } = useApp();
  const [problems, setProblems] = useState<QueueRow[]>([]);
  const load = useCallback(async () => setProblems(await listProblemActions()), []);
  useFocusEffect(useCallback(() => {
    let active = true;
    const expectedCount = sync.conflicts;
    void listProblemActions().then((rows) => { if (active && rows.length >= expectedCount) setProblems(rows); });
    return () => { active = false; };
  }, [sync.conflicts]));

  async function retry(item: QueueRow) {
    const action = JSON.parse(item.payload) as OfflineAction;
    const job = await getJob(action.workOrderId);
    if (!job) return discardAction(item.id);
    const currentRevision = action.type === 'set_task_status'
      ? job.tasks.find((task) => task.id === action.taskId)?.revision
      : job.revision;
    if (!currentRevision) return;
    await discardAction(item.id);
    await queueAction({ ...action, clientActionId: `act-${Crypto.randomUUID()}`, baseRevision: currentRevision });
    await refreshLocal(); await syncNow(); await load();
  }

  function discard(item: QueueRow) {
    Alert.alert('Discard this saved change?', 'The server version will be kept. This cannot be undone.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => void discardAction(item.id).then(refreshLocal).then(load) },
    ]);
  }

  return (
    <Screen>
      <View style={styles.hero}><Text style={styles.eyebrow}>OFFLINE SAFETY</Text><Text style={styles.heading}>Your work is protected</Text><Text style={styles.intro}>Changes save on this device first, then sync automatically when a connection is available.</Text></View>
      {sync.updateRequired ? <View style={styles.update}><MaterialCommunityIcons name="cellphone-arrow-down" size={28} color={colours.red} /><View style={styles.flex}><Text style={styles.cardTitle}>App update required</Text><Text style={styles.body}>Install version {sync.updateRequired} or later to resume sync. Saved work has not been deleted.</Text></View></View> : null}
      <View style={styles.summary}>
        <View style={styles.summaryTop}><MaterialCommunityIcons name={sync.online ? 'cloud-check-outline' : 'cloud-off-outline'} size={34} color={colours.green} /><View style={styles.flex}><Text style={styles.cardTitle}>{sync.online ? 'Ready to sync' : 'Working offline'}</Text><Text style={styles.body}>Last completed: {timeLabel(sync.lastSyncedAt)}</Text></View></View>
        <View style={styles.counts}><View><Text style={styles.count}>{sync.queuedActions}</Text><Text style={styles.countLabel}>saved changes</Text></View><View><Text style={styles.count}>{sync.queuedUploads}</Text><Text style={styles.countLabel}>files waiting</Text></View><View><Text style={styles.count}>{sync.conflicts}</Text><Text style={styles.countLabel}>need review</Text></View></View>
        <FieldButton loading={sync.running} disabled={!sync.online || Boolean(sync.updateRequired)} onPress={() => void syncNow()}>Sync now</FieldButton>
      </View>
      {problems.length ? <View style={styles.section}><Text style={styles.sectionTitle}>Review saved changes</Text><Text style={styles.body}>Another person changed these records before your offline work reached the office.</Text>{problems.map((item) => <View key={item.id} style={styles.problem}><View style={styles.flex}><Text style={styles.problemTitle}>{JSON.parse(item.payload).type.replaceAll('_', ' ')}</Text><Text style={styles.body}>{item.error_message || 'The office record has a newer version.'}</Text></View><View style={styles.row}>{item.status === 'conflict' ? <FieldButton variant="secondary" style={styles.action} onPress={() => void retry(item)}>Apply to latest</FieldButton> : null}<FieldButton variant="danger" style={styles.action} onPress={() => discard(item)}>Discard</FieldButton></View></View>)}</View> : (
        <View style={styles.clear}><MaterialCommunityIcons name="check-decagram-outline" size={38} color={colours.green} /><Text style={styles.cardTitle}>Nothing needs your attention</Text><Text style={styles.body}>Any new assigned work or office changes will arrive through secure sync.</Text></View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: spacing.xs },
  eyebrow: { color: colours.green, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  heading: { color: colours.ink, fontSize: 28, fontWeight: '800' },
  intro: { color: colours.muted, fontSize: 16, lineHeight: 23 },
  summary: { backgroundColor: colours.white, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colours.line, gap: spacing.md },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flex: { flex: 1 },
  cardTitle: { color: colours.ink, fontSize: 19, fontWeight: '800' },
  body: { color: colours.muted, lineHeight: 20, marginTop: 3 },
  counts: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colours.line, paddingVertical: spacing.md },
  count: { color: colours.ink, fontSize: 24, fontWeight: '800' },
  countLabel: { color: colours.muted, fontSize: 12 },
  update: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colours.redSoft },
  section: { gap: spacing.md },
  sectionTitle: { color: colours.ink, fontSize: 20, fontWeight: '800' },
  problem: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colours.white, borderWidth: 1, borderColor: colours.line, gap: spacing.md },
  problemTitle: { color: colours.ink, fontWeight: '800', textTransform: 'capitalize' },
  row: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
  clear: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colours.mint },
});
