import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { tradeJobFormSelectionId, type TradeJobFormLibraryOption, type TradeJobFormSelection } from '../../../src/lib/trade-job-form-library';
import { colours, radius, spacing } from '@/lib/theme';
import { FieldButton } from './field-button';

export function FieldNewJobFormPicker({ options, selections, onSelect, onRemove, loading, error, disabled, onRetry }: {
  options: TradeJobFormLibraryOption[];
  selections: TradeJobFormSelection[];
  onSelect: (option: TradeJobFormLibraryOption) => void;
  onRemove: (selection: TradeJobFormSelection) => void;
  loading: boolean;
  error: string;
  disabled: boolean;
  onRetry: () => void;
}) {
  const [search, setSearch] = useState('');
  const terms = search.trim().toLocaleLowerCase('en-AU').split(/\s+/).filter(Boolean);
  const matches = options.filter((option) => {
    const text = [option.name, option.group, option.jurisdiction, option.description, option.searchText, ...option.categories].join(' ').toLocaleLowerCase('en-AU');
    return terms.every((term) => text.includes(term));
  });
  const selectedIds = new Set(selections.map(tradeJobFormSelectionId));

  return <View style={styles.section}>
    <Text style={styles.heading}>Job forms</Text>
    <Text style={styles.help}>Search all rental assessments, safety checks, Creditex forms and business forms. Add the forms needed for this job.</Text>
    {selections.length ? <View style={styles.selected}>
      <Text style={styles.label}>Selected forms ({selections.length})</Text>
      {selections.map((selection) => {
        const id = tradeJobFormSelectionId(selection);
        const option = options.find((candidate) => candidate.id === id);
        const reason = !loading && !error ? option?.unavailableReason || (!option ? 'This form is no longer available. Remove it before continuing.' : '') : '';
        return <View key={id} style={styles.selection}>
          <Text style={styles.name}>{selection.name}</Text>
          {reason ? <Text style={styles.error}>{reason}</Text> : null}
          <FieldButton variant="quiet" disabled={disabled} onPress={() => onRemove(selection)}>Remove {selection.name}</FieldButton>
        </View>;
      })}
    </View> : <Text style={styles.help}>No forms selected.</Text>}
    <TextInput accessibilityLabel="Search all forms" autoCapitalize="none" autoCorrect={false} editable={!disabled}
      placeholder="Search all forms" placeholderTextColor={colours.muted} selectionColor={colours.green}
      value={search} onChangeText={setSearch} style={styles.search} />
    {loading ? <Text accessibilityLiveRegion="polite" style={styles.help}>Loading the current form library...</Text> : error ? <>
      <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>
      <FieldButton variant="secondary" disabled={disabled} onPress={onRetry}>Retry form library</FieldButton>
    </> : <>
      <Text accessibilityLiveRegion="polite" style={styles.help}>{matches.length} {matches.length === 1 ? 'form' : 'forms'} found</Text>
      {!matches.length ? <Text style={styles.help}>No forms match your search. Try another name, program or work type.</Text> : null}
      {matches.map((option) => {
        const selected = selectedIds.has(option.id);
        const unavailable = Boolean(option.unavailableReason);
        const blocked = disabled || selected || unavailable;
        return <Pressable key={option.id} accessibilityRole="button" accessibilityLabel={`${selected ? 'Selected' : 'Add'} ${option.name}`}
          accessibilityState={{ disabled: blocked, selected }} disabled={blocked} onPress={() => onSelect(option)}
          style={[styles.option, selected && styles.optionSelected]}>
          <Text style={styles.label}>{option.group} | {option.jurisdiction}</Text>
          <Text style={styles.name}>{option.name}</Text>
          <Text style={styles.help}>{option.description}</Text>
          {unavailable ? <Text style={styles.error}>{option.unavailableReason}</Text> : <Text style={styles.action}>{selected ? 'Selected' : 'Add form'}</Text>}
        </Pressable>;
      })}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm, marginTop: spacing.md },
  heading: { color: colours.ink, fontSize: 21, fontWeight: '800' },
  label: { color: colours.muted, fontSize: 13, fontWeight: '700' },
  name: { color: colours.ink, fontSize: 16, fontWeight: '700' },
  help: { color: colours.muted, lineHeight: 21 },
  error: { color: colours.red, lineHeight: 21 },
  search: { borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, color: colours.ink, minHeight: 48, padding: spacing.sm },
  selected: { gap: spacing.sm },
  selection: { borderColor: colours.green, borderLeftWidth: 3, gap: spacing.xs, paddingLeft: spacing.sm },
  option: { borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, gap: spacing.xs, minHeight: 48, padding: spacing.md },
  optionSelected: { borderColor: colours.green, backgroundColor: colours.mint },
  action: { color: colours.green, fontWeight: '800' },
});
