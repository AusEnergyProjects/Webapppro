import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { FieldButton } from './field-button';
import { colours, radius, spacing } from '@/lib/theme';

export function FieldSelect({ label, value, options, onChange, disabled = false, placeholder = 'Choose an option' }: {
  label: string; value: string; options: readonly { value: string; label: string }[];
  onChange: (value: string) => void; disabled?: boolean; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = options.find((option) => option.value === value);
  const shown = options.filter((option) => option.label.toLowerCase().includes(search.trim().toLowerCase()));
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${selected?.label || placeholder}`} disabled={disabled} onPress={() => { setSearch(''); setOpen(true); }} style={[styles.input, disabled && styles.disabled]}>
      <Text style={styles.value}>{selected?.label || placeholder} ▾</Text>
    </Pressable>
    <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)} transparent>
      <View style={styles.backdrop}><View style={styles.sheet} accessibilityViewIsModal>
        <Text style={styles.heading}>{label}</Text>
        {options.length > 8 ? <TextInput accessibilityLabel={`Search ${label.toLowerCase()}`} value={search} onChangeText={setSearch} placeholder="Search" placeholderTextColor={colours.muted} style={[styles.input, styles.value]} /> : null}
        <ScrollView keyboardShouldPersistTaps="handled">
          {shown.map((option) => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ selected: value === option.value }} onPress={() => { onChange(option.value); setOpen(false); }} style={styles.option}>
            <Text style={[styles.value, option.value === value && styles.selected]}>{option.value === value ? '● ' : '○ '}{option.label}</Text>
          </Pressable>)}
          {!shown.length ? <Text style={styles.value}>No matching options.</Text> : null}
        </ScrollView>
        <FieldButton variant="secondary" onPress={() => setOpen(false)}>Close</FieldButton>
      </View></View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs }, label: { color: colours.ink, fontWeight: '700', fontSize: 15 },
  input: { backgroundColor: colours.surfaceRaised, borderColor: colours.line, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, minHeight: 48 },
  value: { color: colours.ink, fontSize: 16 }, heading: { color: colours.ink, fontSize: 22, fontWeight: '800' },
  disabled: { opacity: 0.5 }, selected: { color: colours.green, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '85%', backgroundColor: colours.cream, padding: spacing.lg, paddingBottom: 36, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, gap: spacing.md },
  option: { minHeight: 52, justifyContent: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderColor: colours.line },
});
