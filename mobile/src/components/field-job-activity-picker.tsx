import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { apiRequest } from '@/lib/api';
import { colours, spacing } from '@/lib/theme';
import { FieldButton } from './field-button';
import { FieldSelect } from './field-select';
import { fieldActivityPremisesVariantId, fieldActivityRequiresPremisesVariant } from './job-work-selection';

type Choice = { id: string; title: string; added: boolean; unavailableReason: string };
type Activity = Choice & { programCode: string; programTemplateId: string; code: string };
type Catalogue = {
  revision: number; buildingType: string; canAdd: boolean; unavailableReason: string;
  programs: { id: string; code: string; label: string }[]; activities: Activity[]; rentalModules: Choice[];
};

export function FieldJobActivityPicker({ workOrderId, online, onChanged }: {
  workOrderId: string; online: boolean; onChanged: () => Promise<void>;
}) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [group, setGroup] = useState('rental');
  const [selection, setSelection] = useState('');
  const [premises, setPremises] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadedFor, setLoadedFor] = useState('');
  const loadKey = JSON.stringify([workOrderId, online, loadAttempt]);
  const loading = online && loadedFor !== loadKey;
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback((signal?: AbortSignal) => {
    if (!online) return Promise.resolve();
    return apiRequest<Catalogue>(`/api/field/job-activities?workOrderId=${encodeURIComponent(workOrderId)}`, { signal })
      .then((next) => { if (!signal?.aborted) { setCatalogue(next); setError(''); } })
      .catch((caught) => { if (!signal?.aborted) setError(caught instanceof Error ? caught.message : 'The activity library could not be loaded.'); })
      .finally(() => { if (!signal?.aborted) setLoadedFor(loadKey); });
  }, [online, workOrderId, loadKey]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const choices = group === 'rental' ? catalogue?.rentalModules || [] : catalogue?.activities.filter((item) => item.programTemplateId === group) || [];
  const selected = choices.find((item) => item.id === selection);
  const activity = group === 'rental' ? null : catalogue?.activities.find((item) => item.id === selection);
  const variant = activity ? fieldActivityPremisesVariantId(activity.id, premises || catalogue?.buildingType || '') : '';
  const needsPremises = Boolean(activity && fieldActivityRequiresPremisesVariant(activity.id) && !variant);

  async function add() {
    if (!catalogue || !selected || !online || busy || selected.added || selected.unavailableReason || needsPremises) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const next = await apiRequest<Catalogue & { message: string }>('/api/field/job-activities', { method: 'POST', body: JSON.stringify({
        workOrderId, expectedRevision: catalogue.revision,
        ...(activity ? { kind: 'program', activityTemplateId: activity.id, programTemplateId: activity.programTemplateId, ...(variant ? { variantId: variant } : {}) }
          : { kind: 'rental', moduleKey: selected.id }),
      }) });
      setCatalogue(next); setSelection(''); setMessage(next.message);
      try { await onChanged(); }
      catch { setMessage(`${next.message} Refresh the job when connected to see the updated forms.`); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The form could not be added.'); }
    finally { setBusy(false); }
  }

  return <View style={styles.section}>
    <Text style={styles.title}>Assessment and program forms</Text>
    <Text style={styles.help}>Add a rental assessment or program activity to this customer&apos;s existing job.</Text>
    {!online ? <Text style={styles.help}>Connect to add a new activity. Already attached forms remain available on the job.</Text> : null}
    {loading ? <Text style={styles.help}>Loading available activities...</Text> : null}
    {catalogue ? <>
      <FieldSelect label="Form or program" value={group} disabled={busy || !online} options={[
        { value: 'rental', label: 'Rental inspections and safety checks' },
        ...catalogue.programs.map((program) => ({ value: program.id, label: program.label })),
      ]} onChange={(value) => { setGroup(value); setSelection(''); setPremises(''); setMessage(''); }} />
      <FieldSelect label={group === 'rental' ? 'Assessment' : 'Activity'} placeholder="Choose the form to add" value={selection} disabled={busy || !online}
        options={choices.map((choice) => ({ value: choice.id, label: `${choice.title}${choice.added ? ' (already added)' : choice.unavailableReason ? ' (unavailable)' : ''}` }))}
        onChange={(value) => { setSelection(value); setMessage(''); }} />
      {catalogue.unavailableReason ? <Text style={styles.error}>{catalogue.unavailableReason}</Text> : null}
      {selected?.added ? <Text style={styles.help}>Already attached. Open this form from the job.</Text> : selected?.unavailableReason ? <Text style={styles.error}>{selected.unavailableReason}</Text> : null}
      {activity && fieldActivityRequiresPremisesVariant(activity.id) && !fieldActivityPremisesVariantId(activity.id, catalogue.buildingType) ? <FieldSelect
        label="Premises for this activity" value={premises} disabled={busy || !online} placeholder="Choose the premises"
        options={[{ value: 'house_townhouse', label: 'Residential' }, { value: 'commercial_office', label: 'Business' }]} onChange={setPremises} /> : null}
      {selected && !selected.added ? <FieldButton disabled={busy || loading || !online || Boolean(selected.unavailableReason) || needsPremises} onPress={() => void add()}>
        {busy ? 'Adding form...' : 'Add to this job'}
      </FieldButton> : null}
    </> : null}
    {error ? <><Text style={styles.error}>{error}</Text><FieldButton variant="quiet" disabled={busy || loading || !online} onPress={() => setLoadAttempt((value) => value + 1)}>Refresh activity library</FieldButton></> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.success}>{message}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm, paddingVertical: spacing.md },
  title: { color: colours.ink, fontSize: 18, fontWeight: '800' },
  help: { color: colours.muted, lineHeight: 21 }, error: { color: colours.red, lineHeight: 21 },
  success: { color: colours.green, lineHeight: 21 },
});
