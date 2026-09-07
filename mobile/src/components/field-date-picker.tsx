import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colours, radius, spacing } from '@/lib/theme';
import { FieldButton } from './field-button';

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function parseDate(value: string) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return null;
  const date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 12);
  return dateKey(date) === value ? date : null;
}

export function FieldDatePicker({ label, value, onChange, minimum, disabled = false }: {
  label: string; value: string; onChange: (date: string) => void; minimum?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date());
  const selected = parseDate(value);
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const offset = (first.getDay() + 6) % 7;
  const dayCount = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const earliest = minimum ? parseDate(minimum) : null;
  const previousLast = new Date(first.getFullYear(), first.getMonth(), 0, 12);
  function show() { setMonth(selected || earliest || new Date()); setOpen(true); }
  return <View style={styles.wrapper}>
    <Text style={styles.label}>{label}</Text>
    <FieldButton variant="secondary" disabled={disabled} onPress={show}>{selected ? selected.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'Choose date'}</FieldButton>
    <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={styles.backdrop}><View style={styles.calendar} accessibilityViewIsModal>
        <Text style={styles.title}>{label}</Text>
        <View style={styles.navigation}>
          <FieldButton variant="quiet" disabled={Boolean(earliest && previousLast < earliest)} onPress={() => setMonth(new Date(first.getFullYear(), first.getMonth() - 1, 1, 12))}>Previous</FieldButton>
          <Text style={styles.month}>{first.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}</Text>
          <FieldButton variant="quiet" onPress={() => setMonth(new Date(first.getFullYear(), first.getMonth() + 1, 1, 12))}>Next</FieldButton>
        </View>
        <View style={styles.grid}>
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, i) => <Text key={`day-${i}`} style={styles.dayHeading}>{day}</Text>)}
          {Array.from({ length: offset }, (_, i) => <View key={`blank-${i}`} style={styles.cell} />)}
          {Array.from({ length: dayCount }, (_, i) => {
            const date = new Date(first.getFullYear(), first.getMonth(), i + 1, 12); const key = dateKey(date);
            const unavailable = Boolean(earliest && date < earliest); const active = value === key;
            return <Pressable key={key} style={[styles.cell, active && styles.selected]} disabled={unavailable}
              accessibilityRole="button" accessibilityLabel={date.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              accessibilityState={{ selected: active, disabled: unavailable }} onPress={() => { onChange(key); setOpen(false); }}>
              <Text style={[styles.day, active && styles.selectedText, unavailable && styles.unavailable]}>{i + 1}</Text>
            </Pressable>;
          })}
        </View>
        <FieldButton variant="secondary" onPress={() => setOpen(false)}>Cancel</FieldButton>
      </View></View>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  wrapper: { gap: spacing.sm }, label: { color: colours.ink, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: spacing.md },
  calendar: { width: '100%', maxWidth: 460, alignSelf: 'center', backgroundColor: colours.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md },
  title: { color: colours.ink, fontWeight: '800', fontSize: 20 }, navigation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  month: { color: colours.ink, fontWeight: '700', flexShrink: 1, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' }, cell: { width: '14.2857%', minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  dayHeading: { width: '14.2857%', textAlign: 'center', color: colours.muted, paddingBottom: spacing.sm },
  day: { color: colours.ink, fontSize: 17 }, selected: { backgroundColor: colours.green }, selectedText: { color: colours.forest, fontWeight: '800' }, unavailable: { color: colours.muted, opacity: 0.4 },
});
