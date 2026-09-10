import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { apiRequest } from '@/lib/api';
import { colours, radius, spacing } from '@/lib/theme';
import { FieldButton } from './field-button';
import { FieldSelect } from './field-select';
import { FieldJobActivityPicker } from './field-job-activity-picker';

type Question = { key: string; label: string; type: string; required: boolean; options?: string[] };
type BusinessForm = { id: string; templateKey: string; version: number; name: string; description: string; guidance: string; fields: Question[]; updatedAt: string; categories: string[]; jurisdiction: string };
type Library = { canManage: boolean; templates: BusinessForm[] };
type JobForms = { templates: { key: string; version: number; name: string; description: string }[]; forms: { templateKey: string; templateVersion: number }[] };
const fresh = (): Question => ({ key: `question_${Crypto.randomUUID().replaceAll('-', '_')}`, label: '', type: 'select', required: false, options: ['Yes', 'No'] });

export function FieldFormLibrary({ workOrderId, serviceCategory, onBack, onChanged, online }: {
  workOrderId: string; serviceCategory: string; onBack: () => void; onChanged: () => Promise<void>; online: boolean;
}) {
  const [library, setLibrary] = useState<Library>({ canManage: false, templates: [] });
  const [jobForms, setJobForms] = useState<JobForms>({ templates: [], forms: [] });
  const [editing, setEditing] = useState<BusinessForm | 'new' | null>(null);
  const [name, setName] = useState(''); const [guidance, setGuidance] = useState('');
  const [questions, setQuestions] = useState<Question[]>([fresh()]);
  const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0); const [loadedFor, setLoadedFor] = useState('');
  const loadKey = JSON.stringify([online, workOrderId, loadAttempt]);
  const loading = online && loadedFor !== loadKey; const [error, setError] = useState('');
  const navigation = useNavigation();
  usePreventRemove(dirty || busy, ({ data }) => {
    if (busy) return Alert.alert('Please wait', 'Wait for the current form request to finish.');
    Alert.alert('Unsaved form', 'Discard the changes to this business form?', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(data.action) }]);
  });
  const load = useCallback((signal?: AbortSignal) => {
    if (!online) return Promise.resolve();
    return Promise.all([apiRequest<Library>('/api/trade-form-templates', { signal }), apiRequest<JobForms>(`/api/trade-job-forms?workOrderId=${encodeURIComponent(workOrderId)}`, { signal })])
      .then(([business, job]) => { if (!signal?.aborted) { setLibrary(business); setJobForms(job); } })
      .catch((caught) => { if (!signal?.aborted) setError(caught instanceof Error ? caught.message : 'The form library could not be opened.'); })
      .finally(() => { if (!signal?.aborted) setLoadedFor(loadKey); });
  }, [online, workOrderId, loadKey]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  function edit(form: BusinessForm | 'new') {
    setEditing(form); setName(form === 'new' ? '' : form.name); setGuidance(form === 'new' ? '' : form.guidance);
    setQuestions(form === 'new' ? [fresh()] : form.fields); setDirty(false); setError('');
  }
  function back() {
    const leave = () => { setDirty(false); if (editing) setEditing(null); else onBack(); };
    if (!dirty) return leave();
    Alert.alert('Unsaved form', 'Save first or discard these changes.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard changes', style: 'destructive', onPress: leave }]);
  }
  async function save() {
    if (!online || busy || loading || !library.canManage || !editing) return;
    setBusy(true); setError('');
    try {
      const current = editing === 'new' ? null : editing;
      const result = await apiRequest<Library>('/api/trade-form-templates', { method: 'POST', body: JSON.stringify({
        id: current?.id, expectedVersion: current?.version, expectedUpdatedAt: current?.updatedAt,
        name, description: current?.description || name, guidance, fields: questions,
        jurisdiction: current?.jurisdiction || 'AU', categories: current?.categories || [serviceCategory],
      }) });
      setLibrary(result); setDirty(false); setEditing(null);
      setJobForms(await apiRequest<JobForms>(`/api/trade-job-forms?workOrderId=${encodeURIComponent(workOrderId)}`));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The form was not saved.'); }
    finally { setBusy(false); }
  }
  async function add(key: string, version: number) {
    if (!online || busy || loading) return;
    setBusy(true); setError('');
    try {
      setJobForms(await apiRequest<JobForms>('/api/trade-job-forms', { method: 'POST', body: JSON.stringify({ workOrderId, templateKey: key, templateVersion: version }) }));
      await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The form could not be added.'); }
    finally { setBusy(false); }
  }
  function change(index: number, patch: Partial<Question>) {
    setQuestions((current) => current.map((question, i) => i === index ? { ...question, ...patch } : question)); setDirty(true);
  }
  return <View style={styles.card}>
    <FieldButton variant="secondary" disabled={busy} onPress={back}>{editing ? 'Form library' : 'Job'}</FieldButton>
    <Text style={styles.title}>{editing ? 'Your business form' : 'Add work or a form'}</Text>
    {editing ? <Text style={styles.help}>Saved versions of your business forms stay with each job.</Text> : null}
    {!online ? <Text style={styles.help}>Reconnect to manage the form library.</Text> : null}
    {loading ? <Text style={styles.help}>Loading forms...</Text> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {editing ? <>
      <Text style={styles.label}>Form name</Text><TextInput style={styles.input} value={name} maxLength={140} editable={!busy} onChangeText={(value) => { setName(value); setDirty(true); }} />
      <Text style={styles.label}>Instructions for the technician</Text><TextInput style={styles.input} value={guidance} maxLength={1200} multiline editable={!busy} onChangeText={(value) => { setGuidance(value); setDirty(true); }} />
      {questions.map((question, index) => <View key={question.key} style={styles.question}>
        <Text style={styles.label}>Question {index + 1}</Text><TextInput style={styles.input} value={question.label} editable={!busy} maxLength={180} onChangeText={(label) => change(index, { label })} />
        <FieldSelect label="Answer" value={question.type} disabled={busy} options={[{ value: 'select', label: 'Select an answer' }, { value: 'checkbox', label: 'Confirm a check' }, { value: 'text', label: 'Short text' }, { value: 'textarea', label: 'Notes' }, { value: 'date', label: 'Date' }]} onChange={(type) => change(index, { type, options: type === 'select' ? question.options || ['Yes', 'No'] : undefined })} />
        {question.type === 'select' ? <><Text style={styles.label}>Answers, one per line</Text><TextInput style={styles.input} value={(question.options || []).join('\n')} editable={!busy} multiline maxLength={2000} onChangeText={(value) => change(index, { options: value.split('\n') })} /></> : null}
        <FieldSelect label="Required to complete this form" value={question.required ? 'yes' : 'no'} disabled={busy} options={[{ value: 'no', label: 'Optional' }, { value: 'yes', label: 'Required' }]} onChange={(value) => change(index, { required: value === 'yes' })} />
        {questions.length > 1 ? <FieldButton variant="quiet" disabled={busy} onPress={() => { setQuestions((current) => current.filter((_, i) => i !== index)); setDirty(true); }}>Remove question</FieldButton> : null}
      </View>)}
      {questions.length < 30 ? <FieldButton variant="secondary" disabled={busy} onPress={() => { setQuestions((current) => [...current, fresh()]); setDirty(true); }}>Add question</FieldButton> : null}
      <FieldButton disabled={busy || loading || !online || !name.trim() || !guidance.trim()} onPress={() => void save()}>Save and make available</FieldButton>
    </> : <>
      <FieldJobActivityPicker workOrderId={workOrderId} online={online} onChanged={onChanged} />
      <Text style={styles.title}>Supporting forms</Text>
      <Text style={styles.help}>Optional business checklists for this job.</Text>
      {jobForms.templates.map((template) => {
        const added = jobForms.forms.some((form) => form.templateKey === template.key && form.templateVersion === template.version);
        return <View key={template.key} style={styles.question}><Text style={styles.label}>{template.name}</Text><Text style={styles.help}>{template.description}</Text><FieldButton variant="secondary" disabled={busy || loading || !online || added} onPress={() => void add(template.key, template.version)}>{added ? 'Added to this job' : 'Add to job'}</FieldButton></View>;
      })}
      {library.canManage ? <><FieldButton disabled={busy || loading || !online} onPress={() => edit('new')}>Create your own form</FieldButton>{library.templates.map((form) => <FieldButton key={form.id} variant="quiet" disabled={busy || loading || !online} onPress={() => edit(form)}>Edit {form.name}</FieldButton>)}</> : null}
      <FieldButton variant="quiet" disabled={busy || loading || !online} onPress={() => { setError(''); setLoadAttempt((value) => value + 1); }}>Refresh library</FieldButton>
    </>}
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: spacing.lg, gap: spacing.sm, borderRadius: radius.lg, backgroundColor: colours.surface, borderWidth: 1, borderColor: colours.line },
  question: { paddingVertical: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colours.line },
  title: { color: colours.ink, fontSize: 21, fontWeight: '800' }, label: { color: colours.ink, fontWeight: '700' },
  input: { minHeight: 48, color: colours.ink, borderWidth: 1, borderColor: colours.line, borderRadius: radius.sm, padding: spacing.sm },
  help: { color: colours.muted, lineHeight: 21 }, error: { color: colours.red },
});
