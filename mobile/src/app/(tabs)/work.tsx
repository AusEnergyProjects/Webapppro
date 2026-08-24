import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
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

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(value: Date) {
  const day = value.getDay() || 7;
  return addDays(new Date(value.getFullYear(), value.getMonth(), value.getDate()), 1 - day);
}

function dateKey(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function JobCard({ job }: { job: FieldJob }) {
  const done = job.tasks.filter((task) => task.status === 'done').length;
  const rental = job.rentalInspection;
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/job/${job.id}`)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.cardTop}>
        <View style={styles.number}><Text style={styles.numberText}>{job.workNumber}</Text></View>
        <View style={[styles.stage, job.stage === 'blocked' && styles.blocked]}><Text style={styles.stageText}>{stageLabel(job.stage)}</Text></View>
      </View>
      <Text style={styles.jobTitle}>{job.title || 'Field job'}</Text>
      <View style={styles.fact}><MaterialCommunityIcons name="clock-outline" color={colours.muted} size={19} /><Text style={styles.factText}>{dayLabel(job.scheduledStart)}</Text></View>
      <View style={styles.fact}><MaterialCommunityIcons name={job.protectedJob ? 'shield-lock-outline' : 'map-marker-outline'} color={job.protectedJob ? colours.green : colours.muted} size={19} /><Text numberOfLines={2} style={styles.factText}>{job.protectedJob ? `${job.siteArea || 'Service region'} | Australian Energy Assessments protected` : job.serviceAddress || job.siteArea || 'Address available when assigned'}</Text></View>
      <View style={styles.progressRow}><Text>{rental
        ? rental.status === 'issued'
          ? `Rental report issued | ${rental.progress.evidenceFiles} evidence files`
          : `${rental.progress.completeModules} of ${rental.progress.moduleTotal} assessment modules complete`
        : `${done} of ${job.tasks.length} checklist items complete`}</Text><MaterialCommunityIcons name="chevron-right" color={colours.green} size={24} /></View>
    </Pressable>
  );
}

export default function WorkScreen() {
  const { jobs, sync, syncNow, user } = useApp();
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const week = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const selectedKey = dateKey(selectedDate);
  const selectedJobs = useMemo(() => jobs
    .filter((job) => dateKey(job.appointmentStartsAt || job.scheduledStart) === selectedKey)
    .sort((left, right) => (left.appointmentStartsAt || left.scheduledStart).localeCompare(right.appointmentStartsAt || right.scheduledStart)), [jobs, selectedKey]);
  const selectedLabel = selectedDate.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });

  function chooseToday() {
    const today = new Date();
    setSelectedDate(today);
    setWeekStart(startOfWeek(today));
  }

  function addJob() {
    if (user?.permissions.canCreateJobs) router.push('/new-job');
    else Alert.alert('New jobs are controlled in TLink', 'Ask your TLink administrator to switch on Create jobs for your field access. Your plus button will then open the simple job form.');
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={sync.running} onRefresh={() => void syncNow()} tintColor={colours.green} />}>
        <View style={styles.hero}>
          <View><Text style={styles.eyebrow}>MY SCHEDULE</Text><Text style={styles.heading}>Good day, {user?.displayName?.split(' ')[0] || 'there'}</Text></View>
          <View style={[styles.connection, !sync.online && styles.offline]}><View style={styles.dot} /><Text>{sync.online ? 'Connected' : 'Offline'}</Text></View>
        </View>
        <View style={styles.calendarCard}>
          <View style={styles.calendarTop}>
            <Pressable accessibilityLabel="Previous week" onPress={() => setWeekStart((value) => addDays(value, -7))} style={styles.iconButton}><MaterialCommunityIcons name="chevron-left" size={26} color={colours.ink} /></Pressable>
            <Pressable onPress={chooseToday}><Text style={styles.month}>{weekStart.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}</Text><Text style={styles.todayLink}>Jump to today</Text></Pressable>
            <Pressable accessibilityLabel="Next week" onPress={() => setWeekStart((value) => addDays(value, 7))} style={styles.iconButton}><MaterialCommunityIcons name="chevron-right" size={26} color={colours.ink} /></Pressable>
          </View>
          <View style={styles.dayStrip}>{week.map((date) => {
            const active = dateKey(date) === selectedKey;
            const count = jobs.filter((job) => dateKey(job.appointmentStartsAt || job.scheduledStart) === dateKey(date)).length;
            return <Pressable key={dateKey(date)} onPress={() => setSelectedDate(date)} style={[styles.day, active && styles.dayActive]}><Text style={[styles.dayName, active && styles.dayTextActive]}>{date.toLocaleDateString('en-AU', { weekday: 'narrow' })}</Text><Text style={[styles.dayNumber, active && styles.dayTextActive]}>{date.getDate()}</Text>{count ? <View style={[styles.jobDot, active && styles.jobDotActive]} /> : <View style={styles.jobDotPlaceholder} />}</Pressable>;
          })}</View>
        </View>
        <View style={styles.syncNote}><MaterialCommunityIcons name={sync.online ? 'cloud-check-outline' : 'cloud-off-outline'} size={21} color={colours.green} /><Text numberOfLines={2} style={styles.syncText}>{sync.message}</Text></View>
        <View style={styles.dayHeading}><View><Text style={styles.section}>{dateKey(new Date()) === selectedKey ? 'Today' : selectedLabel}</Text><Text style={styles.jobCount}>{selectedJobs.length} {selectedJobs.length === 1 ? 'job' : 'jobs'}</Text></View><MaterialCommunityIcons name="calendar-check-outline" size={27} color={colours.green} /></View>
        {selectedJobs.map((job) => <JobCard key={job.id} job={job} />)}
        {!selectedJobs.length && !sync.running ? <View style={styles.empty}><MaterialCommunityIcons name="calendar-blank-outline" size={42} color={colours.green} /><Text style={styles.emptyTitle}>No jobs on this day</Text><Text style={styles.emptyText}>Choose another date or pull down to refresh. A job appears here as soon as the office assigns it to you.</Text></View> : null}
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel="Add a new job" onPress={addJob} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}><MaterialCommunityIcons name="plus" color={colours.white} size={32} /></Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colours.cream },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: 112 },
  hero: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  eyebrow: { color: colours.green, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  heading: { color: colours.ink, fontSize: 28, lineHeight: 34, fontWeight: '800', marginTop: 3 },
  connection: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 8, borderRadius: 999, backgroundColor: colours.mint },
  offline: { backgroundColor: colours.amberSoft },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colours.green },
  syncNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colours.mint, padding: spacing.md, borderRadius: radius.md },
  syncText: { flex: 1, color: colours.ink, lineHeight: 20 },
  calendarCard: { backgroundColor: colours.white, borderWidth: 1, borderColor: colours.line, borderRadius: radius.lg, padding: spacing.sm, gap: spacing.sm },
  calendarTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: colours.mint, alignItems: 'center', justifyContent: 'center' },
  month: { color: colours.ink, fontWeight: '800', fontSize: 17, textAlign: 'center' },
  todayLink: { color: colours.green, fontWeight: '700', fontSize: 12, textAlign: 'center', marginTop: 2 },
  dayStrip: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 },
  day: { flex: 1, minHeight: 70, alignItems: 'center', justifyContent: 'center', borderRadius: 14, gap: 3 },
  dayActive: { backgroundColor: colours.forest },
  dayName: { color: colours.muted, fontSize: 12, fontWeight: '800' },
  dayNumber: { color: colours.ink, fontSize: 18, fontWeight: '800' },
  dayTextActive: { color: colours.white },
  jobDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colours.green },
  jobDotActive: { backgroundColor: '#7ff0c3' },
  jobDotPlaceholder: { width: 6, height: 6 },
  dayHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  section: { color: colours.ink, fontWeight: '800', fontSize: 20 },
  jobCount: { color: colours.muted, marginTop: 2 },
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
  addButton: { position: 'absolute', right: spacing.lg, bottom: spacing.lg, width: 62, height: 62, borderRadius: 22, backgroundColor: colours.green, alignItems: 'center', justifyContent: 'center', elevation: 8, shadowColor: '#001f21', shadowOpacity: 0.24, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
});
