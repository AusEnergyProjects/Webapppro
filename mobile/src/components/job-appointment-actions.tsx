import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useState, type ComponentProps } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { FieldButton } from '@/components/field-button';
import { FieldDatePicker } from '@/components/field-date-picker';
import { FieldSelect } from '@/components/field-select';
import { KeyboardAwareScrollView } from '@/components/keyboard-aware-scroll-view';
import { apiRequest } from '@/lib/api';
import { appointmentContactLinks, appointmentFormValues, appointmentTimeParts, appointmentTimeValue, type AppointmentAction, type AppointmentActionContext, type AppointmentActionResult } from '@/lib/appointment-actions';
import { localWorkDate } from '@/lib/schedule';
import { removeDeletedFieldJob } from '@/lib/sync';
import { colours, radius, spacing } from '@/lib/theme';
import type { FieldJob } from '@/lib/types';

export function JobAppointmentActions({ job, online, onClose, onSaved }: {
  job: FieldJob; online: boolean; onClose: () => void;
  onSaved: (action: AppointmentAction, result: AppointmentActionResult) => void;
}) {
  const [screen, setScreen] = useState<AppointmentAction | 'menu'>('menu');
  const [context, setContext] = useState<AppointmentActionContext | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [date, setDate] = useState(localWorkDate);
  const [time, setTime] = useState('09:00');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [memberId, setMemberId] = useState('');
  const [assigneeDate, setAssigneeDate] = useState('');
  const [assigneeError, setAssigneeError] = useState('');
  const [customer, setCustomer] = useState({ firstName: '', lastName: '', phone: '', email: '' });
  const requestKey = `${job.id}:${online}:${attempt}`;
  const loading = online && loadedKey !== requestKey;

  useEffect(() => {
    const controller = new AbortController();
    if (!online) return () => controller.abort();
    void apiRequest<AppointmentActionContext>(`/api/field/appointment-actions?workOrderId=${encodeURIComponent(job.id)}`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setContext(result); setError('');
        const form = appointmentFormValues(result.appointment);
        const chosenDate = form.date < localWorkDate() ? localWorkDate() : form.date;
        setDate(chosenDate); setAssigneeDate(chosenDate); setAssigneeError('');
        setTime(form.time); setDurationMinutes(form.durationMinutes);
        setMemberId(form.memberId || job.assigneeMemberId);
        if (result.customer) setCustomer({ firstName: result.customer.firstName, lastName: result.customer.lastName, phone: result.customer.phone, email: result.customer.email });
      })
      .catch((caught) => { if (!controller.signal.aborted) { setContext(null); setError(caught instanceof Error ? caught.message : 'Could not load appointment actions.'); } })
      .finally(() => { if (!controller.signal.aborted) setLoadedKey(requestKey); });
    return () => controller.abort();
  }, [job.id, job.assigneeMemberId, online, requestKey]);

  useEffect(() => {
    if (!online || !['schedule', 'reschedule'].includes(screen) || !context || date === assigneeDate) return;
    const controller = new AbortController();
    void apiRequest<AppointmentActionContext>(`/api/field/appointment-actions?workOrderId=${encodeURIComponent(job.id)}&appointmentDate=${encodeURIComponent(date)}`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.job.revision !== context.job.revision) {
          setAssigneeError('This appointment changed. Refresh its details before saving.');
        } else {
          setContext((current) => current ? { ...current, assignees: result.assignees, permissions: result.permissions } : current);
          setAssigneeError('');
        }
        setAssigneeDate(date);
      })
      .catch((caught) => { if (!controller.signal.aborted) { setAssigneeError(caught instanceof Error ? caught.message : 'Could not check worker availability.'); setAssigneeDate(date); } });
    return () => controller.abort();
  }, [online, screen, context, date, assigneeDate, job.id]);

  const links = appointmentContactLinks(job, context?.customer || null);
  const clock = appointmentTimeParts(time);
  const close = () => { if (!busy) onClose(); };
  function choose(action: AppointmentAction) { setError(''); setScreen(action); }

  async function openLink(url: string) {
    setError('');
    try { await Linking.openURL(url); }
    catch { setError('Your phone could not open this action. Check that a maps, phone or email app is available.'); }
  }

  async function save(action: AppointmentAction) {
    if (!context || busy || loading || !online) return;
    setError(''); setBusy(true);
    try {
      const result = await apiRequest<AppointmentActionResult>('/api/field/appointment-actions', {
        method: 'PATCH',
        body: JSON.stringify({ workOrderId: job.id, action, expectedRevision: context.job.revision,
          appointmentId: context.appointment?.id || '', expectedAppointmentRevision: context.appointment?.revision || 0,
          ...(['schedule', 'reschedule'].includes(action) ? { startsAt: `${date}T${time}`, durationMinutes, memberId } : {}),
          ...(action === 'update_customer' ? { customer: { ...customer, expectedUpdatedAt: context.customer?.updatedAt } } : {}),
          ...(action === 'delete' ? { confirmDelete: true } : {}),
        }),
      });
      if (result.deletedJobId) {
        try { await removeDeletedFieldJob(result.deletedJobId); }
        catch { result.deviceCleanupPending = true; }
      }
      onSaved(action, result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'This change could not be saved.');
    } finally { setBusy(false); }
  }

  const title = { menu: 'Job actions', schedule: 'Schedule job', reschedule: 'Reschedule', no_show: 'Mark as no show', cancel: 'Cancel job', update_customer: 'Edit customer details', delete: 'Delete job' }[screen];
  return <Modal visible transparent animationType="slide" onRequestClose={close}>
    <View style={styles.backdrop}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close job actions" disabled={busy} onPress={close} style={StyleSheet.absoluteFill} />
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.header}><View style={styles.headingCopy}><Text style={styles.number}>{job.workNumber}</Text><Text style={styles.title}>{title}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close job actions" disabled={busy} onPress={close} style={styles.close}><MaterialCommunityIcons name="close" size={24} color={colours.ink} /></Pressable></View>
        <KeyboardAwareScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {screen === 'menu' ? <>
            {loading ? <Text accessibilityLiveRegion="polite" style={styles.help}>Loading appointment actions...</Text> : null}
            {!online ? <Text style={styles.help}>Reconnect to change the appointment or customer details.</Text> : null}
            {context?.permissions.schedule ? <ActionRow label="Schedule job" icon="calendar-plus" onPress={() => choose('schedule')} /> : null}
            {context?.permissions.reschedule ? <ActionRow label="Reschedule" icon="calendar-clock" onPress={() => choose('reschedule')} /> : null}
            {context?.permissions.noShow ? <ActionRow label="Mark as no show" icon="account-clock-outline" onPress={() => choose('no_show')} /> : null}
            {context?.permissions.cancel ? <ActionRow label="Cancel job" icon="calendar-remove-outline" onPress={() => choose('cancel')} /> : null}
            {links.directions ? <ActionRow label="Directions" icon="directions" onPress={() => void openLink(links.directions)} /> : null}
            {links.call ? <ActionRow label="Call customer" icon="phone-outline" onPress={() => void openLink(links.call)} /> : null}
            {links.email ? <ActionRow label="Email customer" icon="email-outline" onPress={() => void openLink(links.email)} /> : null}
            {context?.permissions.editCustomer && context.customer && !job.protectedJob ? <ActionRow label="Edit customer details" icon="account-edit-outline" onPress={() => choose('update_customer')} /> : null}
            {context?.permissions.deleteJob ? <ActionRow label="Delete job" icon="delete-outline" onPress={() => choose('delete')} /> : null}
            {job.protectedJob ? <Text style={styles.help}>This is an AEA-managed opportunity. Contact Australian Energy Assessments to arrange or cancel the work.</Text> : null}
            {context && !job.protectedJob && !context.permissions.schedule && !context.permissions.reschedule && !context.permissions.noShow && !context.permissions.cancel ? <Text style={styles.help}>Appointment changes are controlled by your Team permissions.</Text> : null}
          </> : null}
          {['schedule', 'reschedule'].includes(screen) && context ? <>
            <FieldDatePicker label="Day" value={date} minimum={localWorkDate()} disabled={busy} onChange={setDate} />
            <Text style={styles.label}>Start time</Text>
            <View style={styles.timeRow}>
              <View style={styles.timePart}><FieldSelect label="Hour" value={String(clock.hour)} disabled={busy} options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} onChange={(value) => setTime(appointmentTimeValue(Number(value), clock.minute, clock.period))} /></View>
              <View style={styles.timePart}><FieldSelect label="Minutes" value={clock.minute} disabled={busy} options={['00', '15', '30', '45'].map((value) => ({ value, label: `:${value}` }))} onChange={(value) => setTime(appointmentTimeValue(clock.hour, value, clock.period))} /></View>
              <View style={styles.timePart}><FieldSelect label="AM / PM" value={clock.period} disabled={busy} options={[{ value: 'am', label: 'AM' }, { value: 'pm', label: 'PM' }]} onChange={(value) => setTime(appointmentTimeValue(clock.hour, clock.minute, value))} /></View>
            </View>
            <FieldSelect label="Assigned to" value={memberId} disabled={busy || assigneeDate !== date} options={context.assignees.map((person) => ({ value: person.id, label: person.displayName }))} onChange={setMemberId} placeholder="Choose a team member" />
            {assigneeDate !== date ? <Text style={styles.help}>Checking team members for this date...</Text> : null}
            {assigneeError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{assigneeError}</Text> : null}
            <Text style={styles.help}>{durationMinutes} minutes reserved. The customer will receive the schedule change by email when an email address is saved. Connected Google calendars are updated.</Text>
            <FieldButton loading={busy} disabled={loading || !online || !date || assigneeDate !== date || Boolean(assigneeError) || !(screen === 'schedule' ? context.permissions.schedule : context.permissions.reschedule) || !context.assignees.some((person) => person.id === memberId)} onPress={() => void save(screen === 'schedule' ? 'schedule' : 'reschedule')}>Save appointment</FieldButton>
          </> : null}
          {screen === 'no_show' ? <><Text style={styles.help}>Remove this appointment from the schedule and keep the job ready to reschedule once you speak to the customer.</Text><FieldButton loading={busy} disabled={!online} onPress={() => void save('no_show')}>Mark as no show</FieldButton></> : null}
          {screen === 'cancel' ? <><Text style={styles.help}>Cancel this job and remove the appointment from the schedule and connected Google calendars. Existing assessment records are retained.</Text><FieldButton loading={busy} disabled={!online} onPress={() => void save('cancel')}>Confirm cancellation</FieldButton></> : null}
          {screen === 'delete' ? <><Text style={styles.help}>Permanently delete this job, its forms, notes, photos and quotes, including accepted quotes. The customer stays in your customer list. This cannot be undone.</Text><Text style={styles.help}>Partly completed forms can be deleted. Completed work, issued reports, financial records and submitted or audited activity records must be retained.</Text><FieldButton loading={busy} disabled={!online || loading} onPress={() => void save('delete')}>Permanently delete job</FieldButton></> : null}
          {screen === 'update_customer' ? <>
            <ContactField label="First name" value={customer.firstName} editable={!busy} onChangeText={(value) => setCustomer((current) => ({ ...current, firstName: value }))} />
            <ContactField label="Last name" value={customer.lastName} editable={!busy} onChangeText={(value) => setCustomer((current) => ({ ...current, lastName: value }))} />
            <ContactField label="Phone" value={customer.phone} editable={!busy} keyboardType="phone-pad" onChangeText={(value) => setCustomer((current) => ({ ...current, phone: value }))} />
            <ContactField label="Email" value={customer.email} editable={!busy} keyboardType="email-address" autoCapitalize="none" onChangeText={(value) => setCustomer((current) => ({ ...current, email: value }))} />
            <FieldButton loading={busy} disabled={!online} onPress={() => void save('update_customer')}>Save customer details</FieldButton>
          </> : null}
          {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
          {(error || assigneeError) && online ? <FieldButton variant="secondary" disabled={loading || busy} onPress={() => { setScreen('menu'); setAttempt((value) => value + 1); }}>Refresh appointment details</FieldButton> : null}
          {screen !== 'menu' ? <FieldButton variant="secondary" disabled={busy} onPress={() => { setScreen('menu'); setError(''); }}>Back to actions</FieldButton> : null}
        </KeyboardAwareScrollView>
      </View>
    </View>
  </Modal>;
}

function ContactField({ label, ...props }: { label: string } & ComponentProps<typeof TextInput>) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput {...props} accessibilityLabel={label} style={styles.input} placeholderTextColor={colours.muted} selectionColor={colours.green} /></View>;
}
function ActionRow({ label, icon, onPress }: { label: string; icon: ComponentProps<typeof MaterialCommunityIcons>['name']; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.action, pressed && styles.pressed]}><MaterialCommunityIcons name={icon} color={colours.green} size={23} /><Text style={styles.actionText}>{label}</Text><MaterialCommunityIcons name="chevron-right" size={22} color={colours.muted} /></Pressable>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.65)' },
  sheet: { maxHeight: '90%', backgroundColor: colours.cream, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.md, paddingBottom: 32, borderWidth: 1, borderColor: colours.line },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingBottom: spacing.md },
  headingCopy: { flex: 1 }, number: { color: colours.green, fontWeight: '700', fontSize: 13 }, title: { color: colours.ink, fontSize: 23, fontWeight: '800', marginTop: spacing.xs },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colours.mint },
  content: { gap: spacing.md, paddingBottom: spacing.sm },
  action: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 54, backgroundColor: colours.surface, borderRadius: radius.sm, padding: spacing.sm }, actionText: { flex: 1, color: colours.ink, fontSize: 17, fontWeight: '700' }, pressed: { opacity: 0.72 },
  help: { color: colours.muted, lineHeight: 21 }, label: { color: colours.ink, fontWeight: '700', fontSize: 15 }, error: { color: colours.red, lineHeight: 21 },
  timeRow: { flexDirection: 'row', gap: spacing.sm }, timePart: { flex: 1, minWidth: 0 }, field: { gap: spacing.xs },
  input: { borderWidth: 1, borderColor: colours.line, borderRadius: radius.md, backgroundColor: colours.surfaceRaised, color: colours.ink, fontSize: 16, minHeight: 50, padding: spacing.md },
});
