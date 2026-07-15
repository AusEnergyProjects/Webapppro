import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colours, radius, spacing } from '@/lib/theme';
import type { FieldJob } from '@/lib/types';
import { useApp } from '@/providers/app-provider';

function dayLabel(value: string) {
  if (!value) return 'Date to be arranged';
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return `Today, ${date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`;
  return date.toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function stageLabel(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }

function JobCard({ job }: { job: FieldJob }) {
  const done = job.tasks.filter((task) => task.status === 'done').length;
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/job/${job.id}`)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.cardTop}>
        <View style={styles.number}><Text style={styles.numberText}>{job.workNumber}</Text></View>
        <View style={[styles.stage, job.stage === 'blocked' && styles.blocked]}><Text style={styles.stageText}>{stageLabel(job.stage)}</Text></View>
      </View>
      <Text style={styles.jobTitle}>{job.title || 'Field job'}</Text>
      <View style={styles.fact}><MaterialCommunityIcons name="clock-outline" color={colours.muted} size={19} /><Text style={styles.factText}>{dayLabel(job.scheduledStart)}</Text></View>
      <View style={styles.fact}><MaterialCommunityIcons name={job.protectedJob ? 'shield-lock-outline' : 'map-marker-outline'} color={job.protectedJob ? colours.green : colours.muted} size={19} /><Text numberOfLines={2} style={styles.factText}>{job.protectedJob ? `${job.siteArea || 'Service region'} | AEA protected` : job.serviceAddress || job.siteArea || 'Address available when assigned'}</Text></View>
      <View style={styles.progressRow}><Text>{done} of {job.tasks.length} checklist items complete</Text><MaterialCommunityIcons name="chevron-right" color={colours.green} size={24} /></View>
    </Pressable>
  );
}

export default function WorkScreen() {
  const { jobs, sync, syncNow } = useApp();
  const today = useMemo(() => jobs.filter((job) => job.scheduledStart && new Date(job.scheduledStart).toDateString() === new Date().toDateString()), [jobs]);
  const next = jobs.filter((job) => !today.includes(job));
  return (
    <SafeAreaView edges={['bottom']} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={sync.running} onRefresh={() => void syncNow()} tintColor={colours.green} />}>
        <View style={styles.hero}>
          <View><Text style={styles.eyebrow}>FIELD WORK</Text><Text style={styles.heading}>A clear day in one place</Text></View>
          <View style={[styles.connection, !sync.online && styles.offline]}><View style={styles.dot} /><Text>{sync.online ? 'Connected' : 'Offline'}</Text></View>
        </View>
        <View style={styles.syncNote}><MaterialCommunityIcons name={sync.online ? 'cloud-check-outline' : 'cloud-off-outline'} size={21} color={colours.green} /><Text style={styles.syncText}>{sync.message}</Text></View>
        {today.length ? <><Text style={styles.section}>Today</Text>{today.map((job) => <JobCard key={job.id} job={job} />)}</> : null}
        {next.length ? <><Text style={styles.section}>{today.length ? 'Coming up' : 'Assigned work'}</Text>{next.map((job) => <JobCard key={job.id} job={job} />)}</> : null}
        {!jobs.length && !sync.running ? <View style={styles.empty}><MaterialCommunityIcons name="clipboard-check-outline" size={42} color={colours.green} /><Text style={styles.emptyTitle}>No assigned jobs right now</Text><Text style={styles.emptyText}>Pull down to check again. New work will appear after it is assigned in the office CRM.</Text></View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colours.cream },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  hero: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  eyebrow: { color: colours.green, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  heading: { color: colours.ink, fontSize: 28, lineHeight: 34, fontWeight: '800', marginTop: 3 },
  connection: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 8, borderRadius: 999, backgroundColor: colours.mint },
  offline: { backgroundColor: colours.amberSoft },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colours.green },
  syncNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colours.mint, padding: spacing.md, borderRadius: radius.md },
  syncText: { flex: 1, color: colours.ink, lineHeight: 20 },
  section: { color: colours.ink, fontWeight: '800', fontSize: 19, marginTop: spacing.xs },
  card: { backgroundColor: colours.white, borderRadius: radius.md, borderWidth: 1, borderColor: colours.line, padding: spacing.md, gap: spacing.sm },
  pressed: { opacity: 0.72 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  number: { backgroundColor: colours.forest, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 6 },
  numberText: { color: colours.white, fontSize: 12, fontWeight: '800' },
  stage: { backgroundColor: colours.mint, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  blocked: { backgroundColor: colours.amberSoft },
  stageText: { color: colours.ink, fontSize: 12, fontWeight: '700' },
  jobTitle: { color: colours.ink, fontSize: 20, fontWeight: '800' },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  factText: { flex: 1, color: colours.muted, lineHeight: 21 },
  progressRow: { borderTopWidth: 1, borderTopColor: colours.line, paddingTop: spacing.sm, marginTop: spacing.xs, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  empty: { alignItems: 'center', padding: spacing.xl, backgroundColor: colours.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colours.line, gap: spacing.sm },
  emptyTitle: { color: colours.ink, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  emptyText: { color: colours.muted, lineHeight: 21, textAlign: 'center' },
});
