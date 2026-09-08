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
export type PlannedFieldActivity = { programTemplateId: string; activityTemplateId: string; variantId?: string };

const premisesVariantActivityIds = new Set(['veu-1', 'veu-3', 'veu-6']);
const residentialBuildingTypes = new Set(['house_townhouse', 'apartment_unit']);
const businessBuildingTypes = new Set(['commercial_office', 'retail_hospitality', 'industrial_warehouse', 'institutional_community_health']);

export const fieldBuildingTypeOptions = [
  { value: 'house_townhouse', label: 'House or townhouse' },
  { value: 'apartment_unit', label: 'Apartment or unit' },
  { value: 'commercial_office', label: 'Commercial or office' },
  { value: 'retail_hospitality', label: 'Retail or hospitality' },
  { value: 'industrial_warehouse', label: 'Industrial or warehouse' },
  { value: 'institutional_community_health', label: 'Institutional, community or health' },
  { value: 'not_sure', label: 'Other or not sure' },
] as const;

export function fieldActivityRequiresPremisesVariant(activityTemplateId: string) {
  return premisesVariantActivityIds.has(activityTemplateId);
}

export function fieldActivityPremisesVariantId(activityTemplateId: string, buildingType: string) {
  if (!fieldActivityRequiresPremisesVariant(activityTemplateId)) return '';
  const premises = residentialBuildingTypes.has(buildingType)
    ? 'residential'
    : businessBuildingTypes.has(buildingType)
      ? 'business'
      : '';
  return premises ? `${activityTemplateId.replaceAll('-', '_')}_${premises}` : '';
}

export function fieldActivitiesForBuildingType(activities: PlannedFieldActivity[], buildingType: string) {
  return activities.map((activity) => {
    const variantId = fieldActivityPremisesVariantId(activity.activityTemplateId, buildingType);
    return {
      programTemplateId: activity.programTemplateId,
      activityTemplateId: activity.activityTemplateId,
      ...(variantId ? { variantId } : {}),
    };
  });
}

export function JobWorkSelection({ options, serviceCategory, onServiceChange, buildingType, onBuildingTypeChange, activities, onActivitiesChange }: {
  options: FieldJobOptions; serviceCategory: string; onServiceChange: (value: string) => void;
  buildingType: string; onBuildingTypeChange: (value: string) => void;
  activities: PlannedFieldActivity[]; onActivitiesChange: (value: PlannedFieldActivity[]) => void;
}) {
  const [programId, setProgramId] = useState('');
  const [activityId, setActivityId] = useState('');
  const [additionalWork, setAdditionalWork] = useState(false);
  const [additionalCategory, setAdditionalCategory] = useState('');
  const formCategory = additionalWork ? additionalCategory : serviceCategory;
  const matchingActivities = options.activities.filter((item) => item.serviceCategory === formCategory);
  const matchingPrograms = options.programs.filter((item) => matchingActivities.some((activity) => activity.programCode === item.code));
  const program = matchingPrograms.find((item) => item.id === programId);
  const available = matchingActivities.filter((item) => item.programCode === program?.code
    && !activities.some((selected) => selected.activityTemplateId === item.id));
  const selectedActivity = available.find((item) => item.id === activityId);
  const selectedVariantId = fieldActivityPremisesVariantId(activityId, buildingType);
  const premisesRequired = Boolean(selectedActivity)
    && fieldActivityRequiresPremisesVariant(activityId)
    && !selectedVariantId;
  return <View style={styles.stack}>
    <FieldSelect label="Work type" value={serviceCategory} options={options.services.map((item) => ({ value: item.id, label: item.label }))} onChange={(value) => {
      if (value !== serviceCategory) { setProgramId(''); setActivityId(''); setAdditionalWork(false); setAdditionalCategory(''); onActivitiesChange([]); onServiceChange(value); }
    }} />
    <FieldSelect label="Premises type" value={buildingType} options={fieldBuildingTypeOptions} onChange={onBuildingTypeChange} placeholder="Choose the premises" />
    {activities.map((selected, index) => {
      const activity = options.activities.find((item) => item.id === selected.activityTemplateId);
      const selectedProgram = options.programs.find((item) => item.id === selected.programTemplateId);
      return <View key={`${selected.programTemplateId}:${selected.activityTemplateId}`} style={styles.selection}>
        <Text style={styles.text}>{index + 1}. {selectedProgram?.code} {activity?.code} | {activity?.title || 'Activity no longer available for this property'}</Text>
        {selected.variantId ? <Text style={styles.help}>{selected.variantId.endsWith('_business') ? 'Business premises form' : 'Residential premises form'}</Text> : null}
        <FieldButton variant="quiet" onPress={() => onActivitiesChange(activities.filter((_, i) => i !== index))}>Remove form</FieldButton>
      </View>;
    })}
    {activities.length < 12 && !additionalWork ? <FieldButton variant="quiet" onPress={() => { setAdditionalWork(true); setAdditionalCategory(''); setProgramId(''); setActivityId(''); }}>Add another type of work</FieldButton> : null}
    {additionalWork ? <>
      <FieldSelect label="Additional work type" value={additionalCategory} options={options.services.filter((item) => options.activities.some((activity) => activity.serviceCategory === item.id)).map((item) => ({ value: item.id, label: item.label }))} onChange={(value) => { setAdditionalCategory(value); setProgramId(''); setActivityId(''); }} placeholder="Choose the additional work" />
      <FieldButton variant="quiet" onPress={() => { setAdditionalWork(false); setAdditionalCategory(''); setProgramId(''); setActivityId(''); }}>Cancel additional work</FieldButton>
    </> : null}
    {matchingPrograms.length ? <Text style={styles.label}>Program forms, optional</Text> : null}
    {matchingPrograms.length && activities.length < 12 ? <>
      <FieldSelect label="Certificate or program" value={programId} options={matchingPrograms.map((item) => ({ value: item.id, label: item.label }))} onChange={(value) => { setProgramId(value); setActivityId(''); }} placeholder="Choose if this work claims a benefit" />
      {program ? <FieldSelect label="Activity" value={activityId} options={available.map((item) => ({ value: item.id, label: `${item.code} | ${item.title}` }))} onChange={setActivityId} /> : null}
      {premisesRequired ? <Text style={styles.warning}>Choose residential or business premises before adding this activity form.</Text> : null}
      {program && selectedActivity ? <FieldButton variant="secondary" disabled={premisesRequired} onPress={() => {
        onActivitiesChange([...activities, { programTemplateId: program.id, activityTemplateId: activityId, ...(selectedVariantId ? { variantId: selectedVariantId } : {}) }]); setProgramId(''); setActivityId(''); setAdditionalWork(false); setAdditionalCategory('');
      }}>Add this form</FieldButton> : null}
    </> : null}
    {activities.length ? <Text style={styles.help}>Complete each activity&apos;s forms, evidence and signatures. Creditex handles certificate creation with the program administrator.</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  stack: { gap: spacing.md }, label: { color: colours.ink, fontSize: 16, fontWeight: '700' },
  text: { color: colours.ink, fontSize: 16 }, help: { color: colours.muted, fontSize: 14, lineHeight: 20 },
  warning: { color: colours.red, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  selection: { gap: spacing.xs, borderLeftWidth: 3, borderColor: colours.green, paddingLeft: spacing.md },
});
