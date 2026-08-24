import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { FieldButton } from '@/components/field-button';
import { Screen } from '@/components/screen';
import { apiRequest } from '@/lib/api';
import { colours, radius, spacing } from '@/lib/theme';
import { useApp } from '@/providers/app-provider';

const modules = [
  { key: 'minimum_standards', label: 'Rental minimum standards', icon: 'home-outline' },
  { key: 'electrical_safety_check', label: 'Electrical safety check', icon: 'flash-outline' },
  { key: 'gas_safety_check', label: 'Gas safety check', icon: 'fire' },
  { key: 'smoke_alarm_check', label: 'Smoke alarm check', icon: 'smoke-detector' },
] as const;

function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function NewJobScreen() {
  const { user, syncNow } = useApp();
  const dates = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(index)), []);
  const [selectedDate, setSelectedDate] = useState(() => dateKey(addDays(1)));
  const [time, setTime] = useState('09:00');
  const [duration, setDuration] = useState(90);
  const [selectedModules, setSelectedModules] = useState<string[]>(['minimum_standards']);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [suburb, setSuburb] = useState('');
  const [postcode, setPostcode] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function toggleModule(key: string) {
    setSelectedModules((current) => current.includes(key)
      ? current.filter((value) => value !== key)
      : [...current, key]);
  }

  async function createJob() {
    setError('');
    if (!selectedModules.length) return setError('Choose at least one assessment or safety-check workflow.');
    if (!firstName.trim() || !lastName.trim() || !email.trim() || phone.replace(/\D/g, '').length < 8) {
      return setError('Add the customer name, email and valid mobile number.');
    }
    if (!addressLine1.trim() || !suburb.trim() || !/^\d{4}$/.test(postcode)) {
      return setError('Add the Victorian street, suburb and four-digit postcode.');
    }
    setBusy(true);
    try {
      const result = await apiRequest<{ ok: boolean; id: string; workNumber?: string }>('/api/trade-crm', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create_scheduled_job',
          customerMode: 'new',
          serviceSiteMode: 'new',
          customerType: 'residential',
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          siteLabel: 'Rental property',
          addressLine1: addressLine1.trim(),
          addressLine2: '',
          suburb: suburb.trim(),
          addressState: 'VIC',
          postcode,
          addressEntryMode: 'manual_pending_review',
          serviceCategory: 'rental-inspection',
          buildingType: 'house_townhouse',
          priority: 'standard',
          assigneeMemberId: user?.memberId,
          startsAt: `${selectedDate}T${time}`,
          durationMinutes: duration,
          appointmentType: 'site_visit',
          appointmentNotes: notes.trim(),
          description: notes.trim(),
          rentalInspectionModulesJson: JSON.stringify(selectedModules),
        }),
      });
      await syncNow();
      Alert.alert('Job added', `${result.workNumber || 'The new job'} is now in your schedule.`, [
        { text: 'Open schedule', onPress: () => router.replace('/(tabs)/work') },
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The job could not be created.');
    } finally { setBusy(false); }
  }

  return <Screen>
    <View style={styles.hero}><Text style={styles.eyebrow}>QUICK JOB</Text><Text style={styles.heading}>Add it without the paperwork maze</Text><Text style={styles.intro}>The job is assigned to you. The chosen workflows open from the saved job.</Text></View>

    <View style={styles.card}>
      <Text style={styles.cardTitle}>1. Choose the work</Text>
      <Text style={styles.help}>Minimum standards starts selected, but every option can be switched on or off.</Text>
      {modules.map((module) => {
        const selected = selectedModules.includes(module.key);
        return <Pressable key={module.key} onPress={() => toggleModule(module.key)} style={[styles.choice, selected && styles.choiceSelected]}><MaterialCommunityIcons name={module.icon} size={24} color={selected ? colours.green : colours.muted} /><Text style={styles.choiceText}>{module.label}</Text><MaterialCommunityIcons name={selected ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={25} color={selected ? colours.green : colours.muted} /></Pressable>;
      })}
    </View>

    <View style={styles.card}>
      <Text style={styles.cardTitle}>2. Customer and property</Text>
      <View style={styles.row}><Field label="First name" value={firstName} onChangeText={setFirstName} /><Field label="Last name" value={lastName} onChangeText={setLastName} /></View>
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <Field label="Mobile" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field label="Street address" value={addressLine1} onChangeText={setAddressLine1} />
      <View style={styles.row}><Field label="Suburb" value={suburb} onChangeText={setSuburb} /><Field label="Postcode" value={postcode} onChangeText={(value) => setPostcode(value.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" /></View>
      <Text style={styles.vic}>Victoria</Text>
    </View>

    <View style={styles.card}>
      <Text style={styles.cardTitle}>3. Appointment</Text>
      <View style={styles.dateStrip}>{dates.map((date) => {
        const key = dateKey(date); const selected = key === selectedDate;
        return <Pressable key={key} onPress={() => setSelectedDate(key)} style={[styles.date, selected && styles.dateSelected]}><Text style={[styles.dateDay, selected && styles.selectedText]}>{date.toLocaleDateString('en-AU', { weekday: 'short' })}</Text><Text style={[styles.dateNumber, selected && styles.selectedText]}>{date.getDate()}</Text></Pressable>;
      })}</View>
      <Text style={styles.label}>Start time</Text>
      <View style={styles.pills}>{['08:00', '09:00', '10:00', '12:00', '14:00', '16:00'].map((value) => <Pressable key={value} onPress={() => setTime(value)} style={[styles.pill, time === value && styles.pillSelected]}><Text style={time === value ? styles.selectedText : styles.pillText}>{value}</Text></Pressable>)}</View>
      <Text style={styles.label}>Time allowed</Text>
      <View style={styles.pills}>{[60, 90, 120, 180].map((value) => <Pressable key={value} onPress={() => setDuration(value)} style={[styles.pill, duration === value && styles.pillSelected]}><Text style={duration === value ? styles.selectedText : styles.pillText}>{value < 60 ? `${value} min` : `${value / 60} hr${value > 60 ? 's' : ''}`}</Text></Pressable>)}</View>
      <Text style={styles.label}>Access or visit notes, optional</Text>
      <TextInput multiline numberOfLines={3} style={[styles.input, styles.notes]} value={notes} onChangeText={setNotes} placeholder="Keys, parking, tenant contact or hazards" />
    </View>

    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    <FieldButton loading={busy} onPress={() => void createJob()}>Add job to my schedule</FieldButton>
    <FieldButton variant="quiet" disabled={busy} onPress={() => router.back()}>Cancel</FieldButton>
  </Screen>;
}

function Field({ label, ...props }: { label: string; value: string; onChangeText: (value: string) => void; keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'number-pad'; autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters' }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput {...props} style={styles.input} placeholder={label} /></View>;
}

const styles = StyleSheet.create({
  hero: { gap: spacing.xs },
  eyebrow: { color: colours.green, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  heading: { color: colours.ink, fontSize: 27, lineHeight: 33, fontWeight: '800' },
  intro: { color: colours.muted, fontSize: 15, lineHeight: 22 },
  card: { backgroundColor: colours.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colours.line, padding: spacing.md, gap: spacing.sm },
  cardTitle: { color: colours.ink, fontSize: 19, fontWeight: '800' },
  help: { color: colours.muted, lineHeight: 20 },
  choice: { minHeight: 58, borderWidth: 1, borderColor: colours.line, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  choiceSelected: { backgroundColor: colours.mint, borderColor: colours.green },
  choiceText: { flex: 1, color: colours.ink, fontWeight: '700' },
  row: { flexDirection: 'row', gap: spacing.sm },
  field: { flex: 1, gap: spacing.xs },
  label: { color: colours.ink, fontWeight: '700', marginTop: spacing.xs },
  input: { minHeight: 50, borderWidth: 1, borderColor: colours.line, borderRadius: radius.sm, paddingHorizontal: spacing.md, color: colours.ink, backgroundColor: '#fbfdfc', fontSize: 16 },
  notes: { minHeight: 88, paddingTop: spacing.sm, textAlignVertical: 'top' },
  vic: { color: colours.green, fontWeight: '800', backgroundColor: colours.mint, borderRadius: radius.sm, padding: spacing.sm },
  dateStrip: { flexDirection: 'row', gap: 4 },
  date: { flex: 1, minHeight: 60, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  dateSelected: { backgroundColor: colours.forest },
  dateDay: { color: colours.muted, fontSize: 11, fontWeight: '700' },
  dateNumber: { color: colours.ink, fontSize: 18, fontWeight: '800' },
  selectedText: { color: colours.white, fontWeight: '800' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pill: { minHeight: 42, minWidth: 72, paddingHorizontal: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: colours.line, alignItems: 'center', justifyContent: 'center' },
  pillSelected: { backgroundColor: colours.forest, borderColor: colours.forest },
  pillText: { color: colours.ink, fontWeight: '700' },
  error: { color: colours.red, backgroundColor: colours.redSoft, borderRadius: radius.sm, padding: spacing.md, lineHeight: 20 },
});
