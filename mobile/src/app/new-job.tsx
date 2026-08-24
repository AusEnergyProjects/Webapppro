import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, PanResponder, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { FieldButton } from '@/components/field-button';
import { Screen } from '@/components/screen';
import { ApiError, apiRequest } from '@/lib/api';
import { colours, radius, spacing } from '@/lib/theme';
import { useApp } from '@/providers/app-provider';

const modules = [
  { key: 'minimum_standards', label: 'Rental minimum standards', icon: 'home-outline' },
  { key: 'electrical_safety_check', label: 'Electrical safety check', icon: 'flash-outline' },
  { key: 'gas_safety_check', label: 'Gas safety check', icon: 'fire' },
  { key: 'smoke_alarm_check', label: 'Smoke alarm check', icon: 'smoke-detector' },
] as const;

type Locality = { suburb: string; state: string };
type CustomerCandidate = {
  customerId: string; customerNumber: string; customerType: string; displayName: string;
  firstName: string; lastName: string; businessName: string; email: string; phone: string;
  serviceSiteId: string; siteLabel: string; addressLine1: string; suburb: string;
  addressState: string; postcode: string; reasons: string[];
};
type CalendarInviteResult = { requested: boolean; status: 'not_requested' | 'accepted' | 'failed' | 'unavailable'; message: string };

function addDays(days: number) { const date = new Date(); date.setDate(date.getDate() + days); return date; }
function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function timeParts(value: string) { const [hourText, minute = '00'] = value.split(':'); const hour24 = Number(hourText); return { hour: hour24 % 12 || 12, minute, period: hour24 < 12 ? 'am' : 'pm' } as const; }
function timeValue(hour: number, minute: string, period: string) { const hour24 = period === 'am' ? hour % 12 : (hour % 12) + 12; return `${String(hour24).padStart(2, '0')}:${minute}`; }
function displayTime(value: string) { const parts = timeParts(value); return `${parts.hour}:${parts.minute} ${parts.period}`; }
function displayDuration(minutes: number) { if (minutes < 60) return `${minutes} min`; const hours = Math.floor(minutes / 60); const remaining = minutes % 60; return `${hours} hr${hours === 1 ? '' : 's'}${remaining ? ` ${remaining} min` : ''}`; }

export default function NewJobScreen() {
  const { user, syncNow } = useApp();
  const dates = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(index)), []);
  const [selectedDate, setSelectedDate] = useState(() => dateKey(addDays(1)));
  const [time, setTime] = useState('09:00');
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [duration, setDuration] = useState(90);
  const [selectedModules, setSelectedModules] = useState<string[]>(['minimum_standards']);
  const [firstName, setFirstName] = useState(''); const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState(''); const [phone, setPhone] = useState('');
  const [addressLine1, setAddressLine1] = useState(''); const [postcode, setPostcode] = useState(''); const [suburb, setSuburb] = useState('');
  const [localities, setLocalities] = useState<Locality[]>([]); const [localityBusy, setLocalityBusy] = useState(false);
  const [localityMessage, setLocalityMessage] = useState('Enter the postcode first. TLink will find the matching Victorian suburb.');
  const [customerCandidates, setCustomerCandidates] = useState<CustomerCandidate[]>([]); const [selectedCustomer, setSelectedCustomer] = useState<CustomerCandidate | null>(null);
  const [customerLookupBusy, setCustomerLookupBusy] = useState(false); const [emailCalendarInvite, setEmailCalendarInvite] = useState(false);
  const [notes, setNotes] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');

  useEffect(() => {
    if (!/^\d{4}$/.test(postcode)) return;
    let cancelled = false;
    const timeout = setTimeout(() => {
      setLocalityBusy(true); setLocalityMessage('Finding Victorian suburbs...');
      void apiRequest<{ localities?: Locality[] }>(`/api/address-localities?postcode=${encodeURIComponent(postcode)}`)
        .then((result) => {
          if (cancelled) return;
          const matches = (result.localities || []).filter((item) => item.state === 'VIC'); setLocalities(matches);
          if (matches.length === 1) { setSuburb(matches[0].suburb); setLocalityMessage(`${matches[0].suburb}, Victoria selected.`); }
          else if (matches.length > 1) { setSuburb((current) => matches.some((item) => item.suburb === current) ? current : ''); setLocalityMessage('Choose the correct suburb for this postcode.'); }
          else { setSuburb(''); setLocalityMessage('No Victorian suburb was found for that postcode. Check the four digits.'); }
        }).catch(() => { if (!cancelled) { setLocalities([]); setLocalityMessage('Suburbs could not be loaded. Check reception and try the postcode again.'); } })
        .finally(() => { if (!cancelled) setLocalityBusy(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [postcode]);

  useEffect(() => {
    const normalEmail = email.trim().toLowerCase();
    if (selectedCustomer || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalEmail)) return;
    let cancelled = false;
    const timeout = setTimeout(() => {
      setCustomerLookupBusy(true);
      void apiRequest<{ duplicateCandidates?: CustomerCandidate[] }>('/api/trade-crm', { method: 'POST', body: JSON.stringify({ action: 'find_field_customer_by_email', email: normalEmail }) })
        .then((result) => { if (!cancelled) setCustomerCandidates(result.duplicateCandidates || []); })
        .catch(() => { if (!cancelled) setCustomerCandidates([]); })
        .finally(() => { if (!cancelled) setCustomerLookupBusy(false); });
    }, 450);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [email, selectedCustomer]);

  function toggleModule(key: string) { setSelectedModules((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key]); }
  function chooseCustomer(candidate: CustomerCandidate) {
    if (!candidate.serviceSiteId) return;
    setSelectedCustomer(candidate); setCustomerCandidates([]); setFirstName(candidate.firstName); setLastName(candidate.lastName);
    setEmail(candidate.email); setPhone(candidate.phone); setAddressLine1(candidate.addressLine1); setPostcode(candidate.postcode); setSuburb(candidate.suburb); setError('');
  }
  function clearSelectedCustomer() { setSelectedCustomer(null); setCustomerCandidates([]); setFirstName(''); setLastName(''); setEmail(''); setPhone(''); setAddressLine1(''); setPostcode(''); setSuburb(''); setLocalities([]); setLocalityBusy(false); setLocalityMessage('Enter the postcode first. TLink will find the matching Victorian suburb.'); }
  function changeEmail(value: string) {
    setCustomerCandidates([]); setCustomerLookupBusy(false);
    if (selectedCustomer && value.trim().toLowerCase() !== selectedCustomer.email.trim().toLowerCase()) { clearSelectedCustomer(); setEmail(value); return; }
    setEmail(value);
  }
  function changePostcode(value: string) {
    const next = value.replace(/\D/g, '').slice(0, 4);
    setPostcode(next); setLocalities([]); setLocalityBusy(false);
    setLocalityMessage('Enter the postcode first. TLink will find the matching Victorian suburb.');
    if (!lockedToSavedCustomer) setSuburb('');
  }

  async function createJob() {
    setError('');
    if (!selectedModules.length) return setError('Choose at least one assessment or safety-check workflow.');
    if (!selectedCustomer && (!firstName.trim() || !lastName.trim() || !email.trim() || phone.replace(/\D/g, '').length < 8)) return setError('Add the customer name, email and valid mobile number.');
    if (selectedCustomer && !selectedCustomer.serviceSiteId) return setError('This saved customer needs a property address before a field job can be added.');
    if (!addressLine1.trim() || !suburb.trim() || !/^\d{4}$/.test(postcode)) return setError('Add the Victorian street, postcode and suburb.');
    if (localities.length > 1 && !localities.some((item) => item.suburb === suburb)) return setError('Choose the correct suburb for this postcode.');
    setBusy(true);
    try {
      const result = await apiRequest<{ ok: boolean; id: string; workNumber?: string; calendarInvite?: CalendarInviteResult }>('/api/trade-crm', {
        method: 'POST', body: JSON.stringify({
          action: 'create_scheduled_job', customerMode: selectedCustomer ? 'existing' : 'new', crmCustomerId: selectedCustomer?.customerId || '',
          serviceSiteMode: selectedCustomer ? 'existing' : 'new', serviceSiteId: selectedCustomer?.serviceSiteId || '', customerType: selectedCustomer?.customerType || 'residential',
          firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim().toLowerCase(), phone: phone.trim(), siteLabel: 'Rental property',
          addressLine1: addressLine1.trim(), addressLine2: '', suburb: suburb.trim(), addressState: 'VIC', postcode, addressEntryMode: 'manual_pending_review',
          serviceCategory: 'rental-inspection', buildingType: 'house_townhouse', priority: 'standard', assigneeMemberId: user?.memberId,
          startsAt: `${selectedDate}T${time}`, durationMinutes: duration, appointmentType: 'site_visit', appointmentNotes: notes.trim(), description: notes.trim(),
          rentalInspectionModulesJson: JSON.stringify(selectedModules), emailCalendarInvite,
        }),
      });
      await syncNow();
      const inviteMessage = result.calendarInvite?.requested ? `\n\n${result.calendarInvite.message}` : '';
      Alert.alert('Job added', `${result.workNumber || 'The new job'} is now in your schedule.${inviteMessage}`, [{ text: 'Open schedule', onPress: () => router.replace('/(tabs)/work') }]);
    } catch (caught) {
      const matches = caught instanceof ApiError && Array.isArray(caught.payload.duplicateCandidates) ? caught.payload.duplicateCandidates as CustomerCandidate[] : [];
      if (matches.length) { setCustomerCandidates(matches); setError('This customer is already saved. Choose the correct saved customer and property below.'); }
      else setError(caught instanceof Error ? caught.message : 'The job could not be created.');
    } finally { setBusy(false); }
  }

  const timeSelection = timeParts(time); const lockedToSavedCustomer = Boolean(selectedCustomer);
  return <Screen>
    <View style={styles.hero}><Text style={styles.eyebrow}>QUICK JOB</Text><Text style={styles.heading}>Add it without the paperwork maze</Text><Text style={styles.intro}>The job is assigned to you. The chosen workflows open from the saved job.</Text></View>
    <View style={styles.card}><Text style={styles.cardTitle}>1. Choose the work</Text><Text style={styles.help}>Minimum standards starts selected, but every option can be switched on or off.</Text>
      {modules.map((module) => { const selected = selectedModules.includes(module.key); return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} key={module.key} onPress={() => toggleModule(module.key)} style={[styles.choice, selected && styles.choiceSelected]}><MaterialCommunityIcons name={module.icon} size={24} color={selected ? colours.green : colours.muted} /><Text style={styles.choiceText}>{module.label}</Text><MaterialCommunityIcons name={selected ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={25} color={selected ? colours.green : colours.muted} /></Pressable>; })}
    </View>
    <View style={styles.card}><Text style={styles.cardTitle}>2. Customer and property</Text>
      {selectedCustomer ? <View style={styles.selectedCustomer}><View style={styles.selectedCustomerCopy}><Text style={styles.selectedCustomerLabel}>SAVED CUSTOMER</Text><Text style={styles.selectedCustomerName}>{selectedCustomer.displayName}</Text><Text style={styles.help}>{selectedCustomer.customerNumber} | {selectedCustomer.siteLabel || 'Saved property'}</Text></View><Pressable accessibilityRole="button" onPress={clearSelectedCustomer} style={styles.changeButton}><Text style={styles.changeButtonText}>Change</Text></Pressable></View> : null}
      <View style={styles.row}><Field editable={!lockedToSavedCustomer} label="First name" value={firstName} onChangeText={setFirstName} /><Field editable={!lockedToSavedCustomer} label="Last name" value={lastName} onChangeText={setLastName} /></View>
      <Field editable={!lockedToSavedCustomer} label="Email" value={email} onChangeText={changeEmail} keyboardType="email-address" autoCapitalize="none" />
      {customerLookupBusy ? <Text style={styles.inlineStatus}>Checking for a saved customer...</Text> : null}
      {customerCandidates.length ? <View style={styles.matches}><Text style={styles.matchesTitle}>Existing customer found</Text><Text style={styles.help}>Choose the correct saved customer and property. TLink will use that record instead of creating a duplicate.</Text>
        {customerCandidates.map((candidate) => <Pressable accessibilityRole="button" disabled={!candidate.serviceSiteId} key={`${candidate.customerId}:${candidate.serviceSiteId || 'no-site'}`} onPress={() => chooseCustomer(candidate)} style={[styles.match, !candidate.serviceSiteId && styles.disabledMatch]}><View style={styles.matchCopy}><Text style={styles.matchName}>{candidate.displayName}</Text><Text style={styles.matchAddress}>{candidate.serviceSiteId ? [candidate.addressLine1, candidate.suburb, candidate.postcode].filter(Boolean).join(', ') : 'No saved property address'}</Text><Text style={styles.matchReason}>Matched by {candidate.reasons.join(' and ')}</Text></View><MaterialCommunityIcons name="chevron-right" color={candidate.serviceSiteId ? colours.green : colours.muted} size={25} /></Pressable>)}
      </View> : null}
      <Field editable={!lockedToSavedCustomer} label="Mobile" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field editable={!lockedToSavedCustomer} label="Street address" value={addressLine1} onChangeText={setAddressLine1} />
      <Field editable={!lockedToSavedCustomer} label="Postcode" value={postcode} onChangeText={changePostcode} keyboardType="number-pad" />
      <Text accessibilityLiveRegion="polite" style={[styles.inlineStatus, localityMessage.startsWith('No ') && styles.inlineError]}>{localityBusy ? 'Finding Victorian suburbs...' : localityMessage}</Text>
      {localities.length > 1 && !lockedToSavedCustomer ? <View style={styles.suburbChoices}>{localities.map((item) => <Pressable accessibilityRole="radio" accessibilityState={{ selected: suburb === item.suburb }} key={item.suburb} onPress={() => setSuburb(item.suburb)} style={[styles.suburbChoice, suburb === item.suburb && styles.suburbChoiceSelected]}><Text style={[styles.suburbChoiceText, suburb === item.suburb && styles.suburbChoiceTextSelected]}>{item.suburb}</Text></Pressable>)}</View> : null}
      <Field editable={!lockedToSavedCustomer && /^\d{4}$/.test(postcode) && !localityBusy && localities.length === 0} label="Suburb" value={suburb} onChangeText={setSuburb} /><Text style={styles.vic}>Victoria</Text>
    </View>
    <View style={styles.card}><Text style={styles.cardTitle}>3. Appointment</Text>
      <View style={styles.dateStrip}>{dates.map((date) => { const key = dateKey(date); const selected = key === selectedDate; return <Pressable accessibilityRole="radio" accessibilityState={{ selected }} key={key} onPress={() => setSelectedDate(key)} style={[styles.date, selected && styles.dateSelected]}><Text style={[styles.dateDay, selected && styles.selectedText]}>{date.toLocaleDateString('en-AU', { weekday: 'short' })}</Text><Text style={[styles.dateNumber, selected && styles.selectedText]}>{date.getDate()}</Text></Pressable>; })}</View>
      <Text style={styles.label}>Start time</Text><Pressable accessibilityRole="button" accessibilityLabel={`Start time ${displayTime(time)}`} onPress={() => setTimePickerOpen(true)} style={styles.timeField}><MaterialCommunityIcons name="clock-outline" size={24} color={colours.green} /><View style={styles.timeFieldCopy}><Text style={styles.timeValue}>{displayTime(time)}</Text><Text style={styles.help}>Choose any 15-minute time across the full day</Text></View><MaterialCommunityIcons name="chevron-down" size={24} color={colours.muted} /></Pressable>
      <Text style={styles.label}>Time allowed</Text><DurationSlider value={duration} onChange={setDuration} />
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: emailCalendarInvite }} onPress={() => setEmailCalendarInvite((current) => !current)} style={[styles.inviteChoice, emailCalendarInvite && styles.inviteChoiceSelected]}><MaterialCommunityIcons name={emailCalendarInvite ? 'checkbox-marked' : 'checkbox-blank-outline'} size={26} color={emailCalendarInvite ? colours.green : colours.muted} /><View style={styles.inviteCopy}><Text style={styles.inviteTitle}>Email the customer a calendar invite</Text><Text style={styles.help}>Sends a branded TLink email and calendar file after the job is saved.</Text></View></Pressable>
      <Text style={styles.label}>Access or visit notes, optional</Text><TextInput multiline numberOfLines={3} style={[styles.input, styles.notes]} value={notes} onChangeText={setNotes} placeholder="Keys, parking, tenant contact or hazards" placeholderTextColor={colours.muted} selectionColor={colours.green} />
    </View>
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}<FieldButton loading={busy} onPress={() => void createJob()}>Add job to my schedule</FieldButton><FieldButton variant="quiet" disabled={busy} onPress={() => router.back()}>Cancel</FieldButton>
    <Modal animationType="fade" transparent visible={timePickerOpen} onRequestClose={() => setTimePickerOpen(false)}><View style={styles.modalBackdrop}><View accessibilityViewIsModal style={styles.timeModal}>
      <View style={styles.modalHeader}><View><Text style={styles.eyebrow}>START TIME</Text><Text style={styles.modalTitle}>{displayTime(time)}</Text></View><Pressable accessibilityLabel="Close time picker" onPress={() => setTimePickerOpen(false)} style={styles.modalClose}><MaterialCommunityIcons name="close" color={colours.ink} size={25} /></Pressable></View>
      <Text style={styles.pickerLabel}>Hour</Text><View style={styles.hourGrid}>{Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => <Pressable key={hour} onPress={() => setTime(timeValue(hour, timeSelection.minute, timeSelection.period))} style={[styles.hourChoice, timeSelection.hour === hour && styles.pickerChoiceSelected]}><Text style={[styles.pickerChoiceText, timeSelection.hour === hour && styles.pickerChoiceTextSelected]}>{hour}</Text></Pressable>)}</View>
      <Text style={styles.pickerLabel}>Minutes</Text><View style={styles.minuteGrid}>{['00', '15', '30', '45'].map((minute) => <Pressable key={minute} onPress={() => setTime(timeValue(timeSelection.hour, minute, timeSelection.period))} style={[styles.minuteChoice, timeSelection.minute === minute && styles.pickerChoiceSelected]}><Text style={[styles.pickerChoiceText, timeSelection.minute === minute && styles.pickerChoiceTextSelected]}>:{minute}</Text></Pressable>)}</View>
      <Text style={styles.pickerLabel}>Morning or afternoon</Text><View style={styles.periodGrid}>{['am', 'pm'].map((period) => <Pressable key={period} onPress={() => setTime(timeValue(timeSelection.hour, timeSelection.minute, period))} style={[styles.periodChoice, timeSelection.period === period && styles.pickerChoiceSelected]}><Text style={[styles.pickerChoiceText, timeSelection.period === period && styles.pickerChoiceTextSelected]}>{period.toUpperCase()}</Text></Pressable>)}</View>
      <FieldButton onPress={() => setTimePickerOpen(false)}>Use {displayTime(time)}</FieldButton>
    </View></View></Modal>
  </Screen>;
}

function DurationSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [trackWidth, setTrackWidth] = useState(1); const minimum = 15; const maximum = 480; const step = 15;
  const responder = useMemo(() => {
    const updateFromPosition = (position: number) => { const ratio = Math.max(0, Math.min(1, position / trackWidth)); const next = minimum + Math.round((ratio * (maximum - minimum)) / step) * step; onChange(Math.max(minimum, Math.min(maximum, next))); };
    return PanResponder.create({ onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true, onPanResponderGrant: (event) => updateFromPosition(event.nativeEvent.locationX), onPanResponderMove: (event) => updateFromPosition(event.nativeEvent.locationX) });
  }, [trackWidth, onChange]);
  const ratio = (value - minimum) / (maximum - minimum); const adjust = (amount: number) => onChange(Math.max(minimum, Math.min(maximum, value + amount)));
  return <View style={styles.sliderBlock}><View style={styles.durationHeader}><Text style={styles.durationValue}>{displayDuration(value)}</Text><Text style={styles.durationRange}>15 min to 8 hrs</Text></View>
    <View accessible accessibilityRole="adjustable" accessibilityLabel="Appointment duration" accessibilityValue={{ min: minimum, max: maximum, now: value, text: displayDuration(value) }} accessibilityActions={[{ name: 'increment', label: 'Add 15 minutes' }, { name: 'decrement', label: 'Remove 15 minutes' }]} onAccessibilityAction={(event) => adjust(event.nativeEvent.actionName === 'increment' ? step : -step)} onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)} style={styles.sliderTrackTouch} {...responder.panHandlers}><View style={styles.sliderTrack}><View style={[styles.sliderFill, { width: `${ratio * 100}%` }]} /><View style={[styles.sliderThumb, { left: `${ratio * 100}%` }]} /></View></View>
    <View style={styles.sliderActions}><Pressable accessibilityLabel="Remove 15 minutes" disabled={value === minimum} onPress={() => adjust(-step)} style={[styles.adjustButton, value === minimum && styles.adjustButtonDisabled]}><MaterialCommunityIcons name="minus" size={24} color={colours.ink} /></Pressable><Text style={styles.sliderStep}>15-minute intervals</Text><Pressable accessibilityLabel="Add 15 minutes" disabled={value === maximum} onPress={() => adjust(step)} style={[styles.adjustButton, value === maximum && styles.adjustButtonDisabled]}><MaterialCommunityIcons name="plus" size={24} color={colours.ink} /></Pressable></View>
  </View>;
}

function Field({ label, editable = true, ...props }: { label: string; editable?: boolean; value: string; onChangeText: (value: string) => void; keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'number-pad'; autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters' }) { return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput {...props} editable={editable} style={[styles.input, !editable && styles.inputLocked]} placeholder={label} placeholderTextColor={colours.muted} selectionColor={colours.green} /></View>; }

const styles = StyleSheet.create({
  hero: { gap: spacing.xs }, eyebrow: { color: colours.green, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 }, heading: { color: colours.ink, fontSize: 27, lineHeight: 33, fontWeight: '800' }, intro: { color: colours.muted, fontSize: 15, lineHeight: 22 },
  card: { backgroundColor: colours.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colours.line, padding: spacing.md, gap: spacing.sm }, cardTitle: { color: colours.ink, fontSize: 19, fontWeight: '800' }, help: { color: colours.muted, lineHeight: 20 },
  choice: { minHeight: 58, borderWidth: 1, borderColor: colours.line, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md }, choiceSelected: { backgroundColor: colours.mint, borderColor: colours.green }, choiceText: { flex: 1, color: colours.ink, fontWeight: '700' },
  row: { flexDirection: 'row', gap: spacing.sm }, field: { flex: 1, gap: spacing.xs }, label: { color: colours.ink, fontWeight: '700', marginTop: spacing.xs }, input: { minHeight: 50, borderWidth: 1, borderColor: colours.line, borderRadius: radius.sm, paddingHorizontal: spacing.md, color: colours.ink, backgroundColor: colours.surfaceRaised, fontSize: 16 }, inputLocked: { backgroundColor: colours.mint, color: colours.muted }, notes: { minHeight: 88, paddingTop: spacing.sm, textAlignVertical: 'top' },
  vic: { color: colours.green, fontWeight: '800', backgroundColor: colours.mint, borderRadius: radius.sm, padding: spacing.sm }, inlineStatus: { color: colours.muted, fontSize: 13, lineHeight: 18 }, inlineError: { color: colours.red },
  suburbChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }, suburbChoice: { borderWidth: 1, borderColor: colours.line, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, suburbChoiceSelected: { backgroundColor: colours.green, borderColor: colours.green }, suburbChoiceText: { color: colours.ink, fontWeight: '700' }, suburbChoiceTextSelected: { color: colours.cream },
  selectedCustomer: { alignItems: 'center', backgroundColor: colours.mint, borderColor: colours.green, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, padding: spacing.md }, selectedCustomerCopy: { flex: 1, gap: 3 }, selectedCustomerLabel: { color: colours.green, fontSize: 11, fontWeight: '900', letterSpacing: 1 }, selectedCustomerName: { color: colours.ink, fontSize: 18, fontWeight: '800' }, changeButton: { borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }, changeButtonText: { color: colours.ink, fontWeight: '800' },
  matches: { backgroundColor: colours.mint, borderRadius: radius.md, gap: spacing.sm, padding: spacing.sm }, matchesTitle: { color: colours.green, fontSize: 17, fontWeight: '800' }, match: { alignItems: 'center', backgroundColor: colours.surfaceRaised, borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 72, padding: spacing.sm }, disabledMatch: { opacity: 0.55 }, matchCopy: { flex: 1, gap: 3 }, matchName: { color: colours.ink, fontWeight: '800' }, matchAddress: { color: colours.muted, fontSize: 13 }, matchReason: { color: colours.green, fontSize: 12, fontWeight: '700' },
  dateStrip: { flexDirection: 'row', gap: 4 }, date: { flex: 1, minHeight: 60, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' }, dateSelected: { backgroundColor: colours.forest }, dateDay: { color: colours.muted, fontSize: 11, fontWeight: '700' }, dateNumber: { color: colours.ink, fontSize: 18, fontWeight: '800' }, selectedText: { color: colours.white, fontWeight: '800' },
  timeField: { alignItems: 'center', backgroundColor: colours.surfaceRaised, borderColor: colours.line, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 72, paddingHorizontal: spacing.md }, timeFieldCopy: { flex: 1 }, timeValue: { color: colours.ink, fontSize: 22, fontWeight: '800' },
  sliderBlock: { backgroundColor: colours.surfaceRaised, borderRadius: radius.md, gap: spacing.sm, padding: spacing.md }, durationHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, durationValue: { color: colours.green, fontSize: 21, fontWeight: '900' }, durationRange: { color: colours.muted, fontSize: 12, fontWeight: '700' }, sliderTrackTouch: { justifyContent: 'center', minHeight: 44 }, sliderTrack: { backgroundColor: colours.line, borderRadius: 999, height: 7, position: 'relative' }, sliderFill: { backgroundColor: colours.green, borderRadius: 999, height: 7 }, sliderThumb: { backgroundColor: colours.green, borderColor: colours.ink, borderRadius: 12, borderWidth: 3, height: 24, marginLeft: -12, marginTop: -15.5, position: 'absolute', top: '50%', width: 24 }, sliderActions: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, adjustButton: { alignItems: 'center', backgroundColor: colours.mintStrong, borderRadius: 999, height: 44, justifyContent: 'center', width: 44 }, adjustButtonDisabled: { opacity: 0.35 }, sliderStep: { color: colours.muted, fontSize: 13, fontWeight: '700' },
  inviteChoice: { alignItems: 'center', borderColor: colours.line, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 76, padding: spacing.md }, inviteChoiceSelected: { backgroundColor: colours.mint, borderColor: colours.green }, inviteCopy: { flex: 1, gap: 3 }, inviteTitle: { color: colours.ink, fontSize: 15, fontWeight: '800' }, error: { color: colours.red, backgroundColor: colours.redSoft, borderRadius: radius.sm, padding: spacing.md, lineHeight: 20 },
  modalBackdrop: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.72)', flex: 1, justifyContent: 'center', padding: spacing.md }, timeModal: { backgroundColor: colours.surface, borderColor: colours.line, borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm, maxWidth: 480, padding: spacing.md, width: '100%' }, modalHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, modalTitle: { color: colours.ink, fontSize: 28, fontWeight: '900' }, modalClose: { alignItems: 'center', backgroundColor: colours.surfaceRaised, borderRadius: radius.sm, height: 46, justifyContent: 'center', width: 46 }, pickerLabel: { color: colours.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, marginTop: spacing.xs, textTransform: 'uppercase' }, hourGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }, hourChoice: { alignItems: 'center', borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, justifyContent: 'center', minHeight: 42, width: '22%' }, minuteGrid: { flexDirection: 'row', gap: spacing.xs }, minuteChoice: { alignItems: 'center', borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 46 }, periodGrid: { flexDirection: 'row', gap: spacing.xs }, periodChoice: { alignItems: 'center', borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 48 }, pickerChoiceSelected: { backgroundColor: colours.green, borderColor: colours.green }, pickerChoiceText: { color: colours.ink, fontWeight: '800' }, pickerChoiceTextSelected: { color: colours.cream },
});
