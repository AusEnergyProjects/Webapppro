import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { FieldButton } from '@/components/field-button';
import { Screen } from '@/components/screen';
import { colours, radius, spacing } from '@/lib/theme';
import type { FieldForm, FieldJob } from '@/lib/types';
import { useApp } from '@/providers/app-provider';

const fieldActions: Record<string, { transition: 'start_travel' | 'arrive' | 'start_work' | 'finish'; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }> = {
  scheduled: { transition: 'start_travel', label: 'Start travel', icon: 'car-arrow-right' },
  en_route: { transition: 'arrive', label: 'Arrive', icon: 'map-marker-check-outline' },
  arrived: { transition: 'start_work', label: 'Start work', icon: 'play-circle-outline' },
  in_progress: { transition: 'finish', label: 'Finish', icon: 'check-circle-outline' },
};

function readable(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }

export default function JobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { findJob, saveAction, saveUpload, sync } = useApp();
  const [job, setJob] = useState<FieldJob | null>(null);
  const [duration, setDuration] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => setJob(await findJob(String(id))), [findJob, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function advanceFieldJob() {
    if (!job) return; const action = fieldActions[job.appointmentStatus]; if (!action) return;
    const localBlockers = [job.tasks.some((item) => item.status !== 'done') ? 'assigned tasks' : '', job.forms.some((item) => item.status !== 'complete') ? 'required forms' : '', job.openIssues ? 'open issues' : ''].filter(Boolean);
    if (action.transition === 'finish' && !sync.online) return Alert.alert('Reconnect before finishing', 'Finish must check current forms, evidence, issues and unsynchronised changes. Other field updates remain safely queued offline.');
    if (action.transition === 'finish' && localBlockers.length) return Alert.alert('Finish the required work', `Complete ${localBlockers.join(', ')} first.`);
    setBusy(`field:${action.transition}`);
    try { await saveAction({ type: 'advance_field_job', workOrderId: job.id, baseRevision: job.revision, transition: action.transition }); await load(); }
    catch { Alert.alert('Action required', 'The field action remains saved on this device. Open Sync to review it or try again when the connection is stable.'); }
    finally { setBusy(''); }
  }

  async function toggleTask(taskId: string) {
    if (!job) return;
    const task = job.tasks.find((item) => item.id === taskId);
    if (!task) return;
    setBusy(`task:${taskId}`);
    await saveAction({ type: 'set_task_status', workOrderId: job.id, taskId, baseRevision: task.revision, status: task.status === 'done' ? 'pending' : 'done' });
    await load(); setBusy('');
  }

  async function addTime() {
    if (!job) return;
    const minutes = Number(duration);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return Alert.alert('Check the time', 'Enter the number of minutes worked, from 1 to 1440.');
    setBusy('time');
    const today = new Date().toISOString().slice(0, 10);
    await saveAction({ type: 'add_time_entry', workOrderId: job.id, baseRevision: job.revision, workDate: today, durationMinutes: minutes, notes: notes.trim() });
    setDuration(''); setNotes(''); setBusy('');
    Alert.alert('Time saved', sync.online ? 'The entry is syncing now.' : 'The entry is secure on this device and will sync later.');
  }

  async function saveForm(form: FieldForm, answers: Record<string, string | boolean>, complete: boolean) {
    if (!job) return;
    const missing = form.template.fields.filter((field) => field.required && (field.type === 'checkbox' ? answers[field.key] !== true : !String(answers[field.key] || '').trim())).map((field) => field.label);
    if (complete && missing.length) return Alert.alert('Finish the required fields', missing.join('\n'));
    setBusy(`form:${form.id}`);
    await saveAction({ type: 'save_job_form', workOrderId: job.id, formId: form.id, baseRevision: form.revision, answers, complete });
    await load(); setBusy('');
    Alert.alert(complete ? 'Form completed' : 'Draft saved', sync.online ? 'The field record is syncing now.' : 'The field record is secure on this device and will sync when reception returns.');
  }

  async function capturePhoto() {
    if (!job) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return Alert.alert('Camera access needed', 'Allow camera access in device settings to add a job photo.');
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.82, exif: false });
    if (result.canceled) return;
    const asset = result.assets[0];
    const file = new File(asset.uri);
    setBusy('photo');
    await saveUpload({ workOrderId: job.id, uri: asset.uri, fileName: asset.fileName || `job-photo-${Date.now()}.jpg`, contentType: asset.mimeType || 'image/jpeg', sizeBytes: asset.fileSize || file.size, category: 'progress', caption: '' });
    setBusy('');
    Alert.alert('Photo saved', sync.online ? 'The photo is uploading securely.' : 'The photo will upload when reception returns.');
  }

  async function chooseDocument() {
    if (!job) return;
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], copyToCacheDirectory: true, multiple: false });
    if (result.canceled) return;
    const asset = result.assets[0];
    const file = new File(asset.uri);
    if (file.size > 50 * 1024 * 1024) return Alert.alert('File is too large', 'Choose a photo or PDF no larger than 50 MB.');
    setBusy('document');
    await saveUpload({ workOrderId: job.id, uri: asset.uri, fileName: asset.name, contentType: asset.mimeType || 'application/pdf', sizeBytes: asset.size || file.size, category: 'document', caption: '' });
    setBusy('');
    Alert.alert('Document saved', sync.online ? 'The document is uploading securely.' : 'The document will upload when reception returns.');
  }

  if (!job) return <Screen><View style={styles.empty}><MaterialCommunityIcons name="briefcase-remove-outline" size={42} color={colours.muted} /><Text style={styles.title}>Job is not available</Text><Text style={styles.body}>It may have been unassigned or removed during sync.</Text></View></Screen>;

  const completed = job.tasks.filter((task) => task.status === 'done').length;
  const fieldForms = job.forms || [];
  const fieldAction = fieldActions[job.appointmentStatus];
  const syncLabel = !sync.online ? 'Offline' : sync.conflicts ? 'Action required' : sync.running || sync.queuedActions || sync.queuedUploads ? 'Syncing' : 'Saved';
  return (
    <Screen>
      <View style={styles.hero}>
        <View style={styles.badges}><View style={styles.jobNumber}><Text style={styles.jobNumberText}>{job.workNumber}</Text></View><View style={styles.stage}><Text style={styles.stageText}>{readable(job.stage)}</Text></View></View>
        <Text style={styles.title}>{job.title || 'Field job'}</Text>
        <Text style={styles.body}>{job.customerName} | {job.protectedJob ? job.siteArea || 'Protected service area' : job.serviceAddress || job.siteArea || 'Service site not added'}</Text>
        {job.appointmentStartsAt ? <Text style={styles.meta}>{new Date(job.appointmentStartsAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</Text> : null}
      </View>

      <View style={[styles.privacy, job.protectedJob && styles.protected]}>
        <MaterialCommunityIcons name={job.protectedJob ? 'shield-lock-outline' : 'map-marker-check-outline'} size={26} color={colours.green} />
        <View style={styles.flex}><Text style={styles.cardTitle}>{job.protectedJob ? 'AEA protected job' : 'Direct customer job'}</Text><Text style={styles.body}>{job.protectedJob ? 'Customer name, phone, email and street address stay protected. Use the AEA platform for communication.' : job.serviceAddress || `${job.siteArea || 'Service area'} | Address is not stored offline yet.`}</Text></View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>NEXT ACTION</Text>
        {fieldAction ? <Pressable accessibilityRole="button" accessibilityLabel={fieldAction.label} disabled={busy !== ''} onPress={() => void advanceFieldJob()} style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}><MaterialCommunityIcons name={fieldAction.icon} size={28} color={colours.white} /><Text style={styles.primaryActionText}>{busy === `field:${fieldAction.transition}` ? 'Saving...' : fieldAction.label}</Text></Pressable> : <Text style={styles.body}>{job.appointmentStatus === 'completed' && job.stage === 'completed' ? 'Field work is complete. Invoice and handover are ready in TLink.' : job.appointmentStatus === 'completed' ? 'This appointment was completed outside the field workflow. Ask dispatch to reopen or reschedule it.' : 'Schedule this job before starting travel.'}</Text>}
        {!job.protectedJob && (job.customerPhone || job.serviceAddress) ? <View style={styles.row}>{job.customerPhone ? <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`tel:${job.customerPhone.replace(/[^+\d]/g, '')}`)} style={[styles.contactAction, styles.flex]}><Text style={styles.contactActionText}>Call</Text></Pressable> : null}{job.serviceAddress ? <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.serviceAddress)}`)} style={[styles.contactAction, styles.flex]}><Text style={styles.contactActionText}>Get directions</Text></Pressable> : null}</View> : null}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeading}><View><Text style={styles.label}>TODAY</Text><Text style={styles.cardTitle}>What must happen</Text></View></View>
        <View style={styles.todayItem}><MaterialCommunityIcons name={job.description ? 'check-circle-outline' : 'alert-circle-outline'} size={25} color={job.description ? colours.green : colours.muted} /><View style={styles.flex}><Text style={styles.taskTitle}>Scope and instructions</Text><Text style={styles.meta}>{job.description || 'Open Notes in TLink before starting.'}</Text></View></View>
        <View style={styles.todayItem}><MaterialCommunityIcons name={completed === job.tasks.length ? 'check-circle-outline' : 'clipboard-check-outline'} size={25} color={completed === job.tasks.length ? colours.green : colours.muted} /><View style={styles.flex}><Text style={styles.taskTitle}>Assigned tasks</Text><Text style={styles.meta}>{completed}/{job.tasks.length} complete</Text></View></View>
        {job.tasks.length ? job.tasks.map((task) => <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: task.status === 'done' }} key={task.id} disabled={busy !== ''} onPress={() => void toggleTask(task.id)} style={({ pressed }) => [styles.task, pressed && styles.pressed]}><MaterialCommunityIcons name={task.status === 'done' ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={28} color={task.status === 'done' ? colours.green : colours.muted} /><View style={styles.flex}><Text style={[styles.taskTitle, task.status === 'done' && styles.taskDone]}>{task.title}</Text>{task.dueAt ? <Text style={styles.meta}>Due {new Date(task.dueAt).toLocaleDateString('en-AU')}</Text> : null}</View></Pressable>) : <Text style={styles.body}>No checklist has been added by the office.</Text>}
        <View style={styles.todayItem}><MaterialCommunityIcons name={fieldForms.every((form) => form.status === 'complete') ? 'check-circle-outline' : 'file-document-edit-outline'} size={25} color={fieldForms.every((form) => form.status === 'complete') ? colours.green : colours.muted} /><View style={styles.flex}><Text style={styles.taskTitle}>Required forms</Text><Text style={styles.meta}>{fieldForms.filter((form) => form.status === 'complete').length}/{fieldForms.length} complete</Text></View></View>
        <View style={styles.todayItem}><MaterialCommunityIcons name={job.media.length ? 'check-circle-outline' : 'camera-outline'} size={25} color={job.media.length ? colours.green : colours.muted} /><View style={styles.flex}><Text style={styles.taskTitle}>Required photo proof</Text><Text style={styles.meta}>{job.media.length} field file{job.media.length === 1 ? '' : 's'} synced</Text></View></View>
        <View style={styles.todayItem}><MaterialCommunityIcons name={!job.openIssues ? 'check-circle-outline' : 'alert-circle-outline'} size={25} color={!job.openIssues ? colours.green : colours.muted} /><View style={styles.flex}><Text style={styles.taskTitle}>Open issues or blockers</Text><Text style={styles.meta}>{job.openIssues ? `${job.openIssues} need attention in TLink Notes` : 'None open'}</Text></View></View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeading}><View><Text style={styles.label}>FIELD FORMS</Text><Text style={styles.cardTitle}>Technical records</Text></View><Text style={styles.progress}>{fieldForms.filter((form) => form.status === 'complete').length}/{fieldForms.length}</Text></View>
        <Text style={styles.body}>Complete these short technical records with or without reception. Drafts stay encrypted on this device until sync succeeds.</Text>
        {fieldForms.length ? fieldForms.map((form) => <JobFieldForm key={`${form.id}:${form.updatedAt}`} form={form} busy={busy === `form:${form.id}`} onSave={saveForm} />) : <Text style={styles.body}>No field forms have been assigned to this job.</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>FIELD EVIDENCE</Text><Text style={styles.cardTitle}>Photos and documents</Text><Text style={styles.body}>Files save safely on this device first. Uploads resume automatically after a connection drops.</Text>
        <View style={styles.row}><FieldButton variant="secondary" loading={busy === 'photo'} style={styles.flex} onPress={() => void capturePhoto()}>Take photo</FieldButton><FieldButton variant="secondary" loading={busy === 'document'} style={styles.flex} onPress={() => void chooseDocument()}>Add document</FieldButton></View>
        <Text style={styles.meta}>{job.media.length} field file{job.media.length === 1 ? '' : 's'} already synced</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>TIME ENTRY</Text><Text style={styles.cardTitle}>Record today&apos;s work</Text>
        <Text style={styles.inputLabel}>Minutes worked</Text><TextInput style={styles.input} value={duration} onChangeText={setDuration} keyboardType="number-pad" placeholder="For example, 90" />
        <Text style={styles.inputLabel}>Work note, optional</Text><TextInput style={[styles.input, styles.notes]} multiline value={notes} onChangeText={setNotes} placeholder={job.protectedJob ? 'Describe the work only. Do not add customer contact details.' : 'Briefly describe completed work'} maxLength={500} />
        <FieldButton loading={busy === 'time'} disabled={!duration} onPress={() => void addTime()}>Save time entry</FieldButton>
      </View>

      <View style={styles.syncLine}><MaterialCommunityIcons name={sync.online ? sync.conflicts ? 'cloud-alert-outline' : 'cloud-check-outline' : 'cloud-off-outline'} size={20} color={colours.green} /><Text style={styles.body}>{syncLabel}</Text></View>
    </Screen>
  );
}

function JobFieldForm({ form, busy, onSave }: { form: FieldForm; busy: boolean; onSave: (form: FieldForm, answers: Record<string, string | boolean>, complete: boolean) => Promise<void> }) {
  const [answers, setAnswers] = useState<Record<string, string | boolean>>(form.answers || {});
  const [open, setOpen] = useState(form.status !== 'complete');
  function change(key: string, value: string | boolean) { setAnswers((current) => ({ ...current, [key]: value })); }
  return <View style={styles.formBlock}>
    <Pressable onPress={() => setOpen((value) => !value)} style={styles.formRow} accessibilityRole="button" accessibilityState={{ expanded: open }}>
      <MaterialCommunityIcons name={form.status === 'complete' ? 'check-decagram-outline' : 'clipboard-text-outline'} size={25} color={form.status === 'complete' ? colours.green : colours.muted} />
      <View style={styles.flex}><Text style={styles.taskTitle}>{form.name}</Text><Text style={styles.meta}>{form.jurisdiction} | Version {form.templateVersion} | {form.status === 'complete' ? 'Complete and locked' : form.ready ? 'Ready to complete' : `${form.missing.length} required`}</Text></View>
      <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={colours.muted} />
    </Pressable>
    {open && <View style={styles.formBody}><Text style={styles.body}>{form.template.guidance}</Text>{form.template.fields.map((field) => <View key={field.key} style={styles.formField}>
      <Text style={styles.inputLabel}>{field.label}{field.required ? ' *' : ''}</Text>
      {field.type === 'checkbox' ? <Pressable disabled={form.status === 'complete'} accessibilityRole="checkbox" accessibilityState={{ checked: answers[field.key] === true }} onPress={() => change(field.key, answers[field.key] !== true)} style={[styles.checkbox, answers[field.key] === true && styles.checkboxSelected]}><MaterialCommunityIcons name={answers[field.key] === true ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={25} color={colours.green} /><Text style={styles.body}>{answers[field.key] === true ? 'Confirmed' : 'Tap to confirm'}</Text></Pressable>
        : field.type === 'select' ? <View style={styles.optionList}>{(field.options || []).map((option) => <Pressable key={option} disabled={form.status === 'complete'} onPress={() => change(field.key, option)} style={[styles.option, answers[field.key] === option && styles.optionSelected]}><Text style={styles.optionText}>{option}</Text></Pressable>)}</View>
        : <TextInput editable={form.status !== 'complete'} style={[styles.input, field.type === 'textarea' && styles.notes]} multiline={field.type === 'textarea'} value={String(answers[field.key] || '')} onChangeText={(value) => change(field.key, value)} maxLength={field.maxLength || 240} placeholder={field.type === 'date' ? 'YYYY-MM-DD' : 'Enter technical job information'} />}
    </View>)}{form.status !== 'complete' && <View style={styles.formActions}><FieldButton variant="secondary" loading={busy} style={styles.flex} onPress={() => void onSave(form, answers, false)}>Save draft</FieldButton><FieldButton loading={busy} style={styles.flex} onPress={() => void onSave(form, answers, true)}>Complete</FieldButton></View>}</View>}
  </View>;
}

const styles = StyleSheet.create({
  hero: { gap: spacing.xs },
  badges: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  jobNumber: { backgroundColor: colours.forest, borderRadius: 7, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  jobNumberText: { color: colours.white, fontSize: 12, fontWeight: '800' },
  stage: { backgroundColor: colours.mint, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  stageText: { color: colours.ink, fontSize: 12, fontWeight: '700' },
  title: { color: colours.ink, fontSize: 28, lineHeight: 34, fontWeight: '800' },
  body: { color: colours.muted, lineHeight: 21 },
  privacy: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colours.white, borderWidth: 1, borderColor: colours.line },
  protected: { backgroundColor: colours.mint, borderColor: colours.mintStrong },
  flex: { flex: 1 },
  card: { backgroundColor: colours.white, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colours.line, gap: spacing.sm },
  cardTitle: { color: colours.ink, fontSize: 19, fontWeight: '800' },
  cardHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: colours.green, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  progress: { color: colours.green, fontSize: 18, fontWeight: '800' },
  primaryAction: { minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: colours.green, borderRadius: radius.md },
  primaryActionText: { color: colours.white, fontSize: 18, fontWeight: '800' },
  contactAction: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colours.green, borderRadius: radius.sm },
  contactActionText: { color: colours.green, fontWeight: '800' },
  pressed: { opacity: 0.7 },
  task: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: 1, borderTopColor: colours.line, paddingVertical: spacing.sm },
  todayItem: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: 1, borderTopColor: colours.line, paddingVertical: spacing.sm },
  taskTitle: { color: colours.ink, fontSize: 16, fontWeight: '600' },
  taskDone: { color: colours.muted, textDecorationLine: 'line-through' },
  formRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: 1, borderTopColor: colours.line, paddingVertical: spacing.sm },
  formBlock: { borderTopWidth: 1, borderTopColor: colours.line },
  formBody: { backgroundColor: '#fbfdfc', borderRadius: radius.sm, gap: spacing.sm, padding: spacing.md },
  formField: { gap: 6 },
  checkbox: { alignItems: 'center', borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.sm },
  checkboxSelected: { backgroundColor: colours.mint, borderColor: colours.green },
  optionList: { gap: 7 },
  option: { borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, minHeight: 46, justifyContent: 'center', paddingHorizontal: spacing.md },
  optionSelected: { backgroundColor: colours.mint, borderColor: colours.green },
  optionText: { color: colours.ink, fontWeight: '700' },
  formActions: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.xs },
  meta: { color: colours.muted, fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  inputLabel: { color: colours.ink, fontWeight: '700', marginTop: spacing.xs },
  input: { minHeight: 50, borderWidth: 1, borderColor: colours.line, borderRadius: radius.sm, paddingHorizontal: spacing.md, fontSize: 16, color: colours.ink, backgroundColor: '#fbfdfc' },
  notes: { minHeight: 90, textAlignVertical: 'top', paddingTop: spacing.md },
  syncLine: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  empty: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
});
