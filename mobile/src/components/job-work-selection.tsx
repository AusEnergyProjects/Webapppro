import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FieldSelect } from './field-select';
import { FieldButton } from './field-button';
import { colours, spacing } from '@/lib/theme';

export type FieldPermissions = {
  canCreateJobs: boolean; canAssignJobs: boolean;
  canViewQuotes: boolean; canManageQuotes: boolean; canSendQuotes: boolean;
  canViewInvoices: boolean; canManageInvoices: boolean;
  canViewPriceBook: boolean; canManagePriceBook: boolean; canApplyDiscounts: boolean;
};
export type FieldJobOptions = {
  permissions: FieldPermissions; memberId: string;
  services: { id: string; label: string }[];
  assignees: { id: string; displayName: string }[]; moreAssignees: boolean;
  programs: { id: string; code: string; label: string }[];
  activities: { id: string; programCode: string; code: string; title: string; serviceCategory: string }[];
};
export type PlannedFieldActivity = { programTemplateId: string; activityTemplateId: string };

export function JobWorkSelection({ options, serviceCategory, onServiceChange, activities, onActivitiesChange }: {
  options: FieldJobOptions; serviceCategory: string; onServiceChange: (value: string) => void;
  activities: PlannedFieldActivity[]; onActivitiesChange: (value: PlannedFieldActivity[]) => void;
}) {
  const [programId, setProgramId] = useState('');
  const [activityId, setActivityId] = useState('');
  const program = options.programs.find((item) => item.id === programId);
  const available = options.activities.filter((item) => item.programCode === program?.code
    && !activities.some((selected) => selected.activityTemplateId === item.id));
  return <View style={styles.stack}>
    <FieldSelect label="Work type" value={serviceCategory} options={options.services.map((item) => ({ value: item.id, label: item.label }))} onChange={onServiceChange} />
    <Text style={styles.label}>Certificate or program forms, optional</Text>
    {activities.map((selected, index) => {
      const activity = options.activities.find((item) => item.id === selected.activityTemplateId);
      const selectedProgram = options.programs.find((item) => item.id === selected.programTemplateId);
      return <View key={`${selected.programTemplateId}:${selected.activityTemplateId}`} style={styles.selection}>
        <Text style={styles.text}>{index + 1}. {selectedProgram?.code} {activity?.code} | {activity?.title || 'Activity no longer available for this property'}</Text>
        <FieldButton variant="quiet" onPress={() => onActivitiesChange(activities.filter((_, i) => i !== index))}>Remove form</FieldButton>
      </View>;
    })}
    {activities.length < 12 ? <>
      <FieldSelect label="Certificate or program" value={programId} options={options.programs.map((item) => ({ value: item.id, label: item.label }))} onChange={(value) => { setProgramId(value); setActivityId(''); }} placeholder="Choose if this work claims a benefit" />
      {program ? <FieldSelect label="Activity" value={activityId} options={available.map((item) => ({ value: item.id, label: `${item.code} | ${item.title}` }))} onChange={setActivityId} /> : null}
      {program && available.some((item) => item.id === activityId) ? <FieldButton variant="secondary" onPress={() => {
        onActivitiesChange([...activities, { programTemplateId: program.id, activityTemplateId: activityId }]); setProgramId(''); setActivityId('');
      }}>Add this form</FieldButton> : null}
    </> : null}
    {activities.length ? <Text style={styles.help}>Each activity gets its own form and evidence record. Creditex&apos;s current requirements control when it is ready for field work.</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  stack: { gap: spacing.md }, label: { color: colours.ink, fontSize: 16, fontWeight: '700' },
  text: { color: colours.ink, fontSize: 16 }, help: { color: colours.muted, fontSize: 14, lineHeight: 20 },
  selection: { gap: spacing.xs, borderLeftWidth: 3, borderColor: colours.green, paddingLeft: spacing.md },
});
