import { StyleSheet, Text, View } from 'react-native';
import provider from '../../../src/data/creditex-declaration-provider.json';
import type { ActivityAnswers, ActivityDeclaration, ActivityForm, ActivitySignature } from '../../../src/lib/trade-activity-form-types';
import { boundActivityDeclaration, expandedActivityFields, fieldConditionMet } from '../../../src/lib/trade-activity-form-flow';
import { activityCurrentSignatureKeys, activityOptionLabel } from '@/lib/activity-field-wizard';
import { colours, radius, spacing } from '@/lib/theme';

export function ActivityAssignmentReview({ record, answers, declaration }: {
  record: { form: ActivityForm; recordNumber: string; signatures: ActivitySignature[]; missing: { key: string; kind: string }[] };
  answers: ActivityAnswers;
  declaration: ActivityDeclaration;
}) {
  const fields = expandedActivityFields(record.form, answers).filter((field) =>
    !['photo', 'document'].includes(field.type) && !field.key.startsWith('delivery.')
    && answers[field.key] !== undefined && answers[field.key] !== '');
  const currentSignatureKeys = activityCurrentSignatureKeys(record.signatures, record.missing);
  const sections = [...new Set(fields.map((field) => `${field.phase}:${field.section}`))];
  const declarations = record.form.declarations.filter((item) => fieldConditionMet(item.condition, answers));
  return <View style={styles.document}>
    <View style={styles.cover}>
      <Text style={styles.brand}>CREDITEX</Text>
      <Text style={styles.title}>{record.form.programCode === 'VEU' ? 'VEEC assignment form' : 'Activity record and declarations'}</Text>
      <Text style={styles.subtitle}>{record.form.title}</Text>
      <Text style={styles.meta}>{record.recordNumber} · Form version {record.form.version}</Text>
      <Text style={styles.meta}>{provider.legalName} · ABN {provider.abn}</Text>
      <Text style={styles.meta}>{provider.email} · {provider.phone}</Text>
    </View>
    <View style={styles.signing}>
      <Text style={styles.eyebrow}>YOU ARE SIGNING THIS PART</Text>
      <Text style={styles.heading}>{declaration.title}</Text>
      <Text style={styles.text}>{declaration.phase === 'before' ? 'Before work' : 'Work completed'} · {declaration.role === 'customer' ? 'Customer' : declaration.role === 'technician' ? 'Technician' : 'Authorised signer'}</Text>
      <Text style={styles.text}>{boundActivityDeclaration(declaration, answers)}</Text>
    </View>
    <Text style={styles.heading}>Details entered for this activity</Text>
    {sections.map((section) => <View key={section} style={styles.section}>
      <Text style={styles.heading}>{section.slice(section.indexOf(':') + 1)}</Text>
      {fields.filter((field) => `${field.phase}:${field.section}` === section).map((field) => <View key={field.key} style={styles.answer}>
        <Text style={styles.label}>{field.label}{field.repeatGroup ? ` · Item ${field.repeatIndex + 1}` : ''}</Text>
        <Text style={styles.text}>{typeof answers[field.key] === 'boolean' ? answers[field.key] ? 'Yes' : 'No'
          : field.type === 'select' ? activityOptionLabel(String(answers[field.key]), field.optionLabels?.[String(answers[field.key])])
          : String(answers[field.key])}</Text>
      </View>)}
    </View>)}
    <Text style={styles.heading}>All declarations for this activity</Text>
    {declarations.map((item) => {
      const signature = currentSignatureKeys.has(item.key)
        ? [...record.signatures].reverse().find((saved) => saved.declarationKey === item.key) : undefined;
      return <View key={item.key} style={styles.section}>
        <Text style={styles.heading}>{item.title}</Text>
        <Text style={styles.label}>{item.phase === 'before' ? 'Before work' : 'After work'} · {item.role}</Text>
        <Text style={styles.text}>{boundActivityDeclaration(item, answers)}</Text>
        <Text style={styles.label}>{signature ? `Signed by ${signature.signerName} · ${new Date(signature.signedAt).toLocaleString('en-AU')}` : item.key === declaration.key ? 'Ready for your signature' : 'Not signed yet'}</Text>
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  document: { gap: spacing.lg },
  cover: { padding: spacing.lg, gap: spacing.sm, backgroundColor: colours.surfaceRaised, borderRadius: radius.md },
  brand: { color: colours.green, fontWeight: '900', fontSize: 26, letterSpacing: 1.5 },
  title: { color: colours.ink, fontWeight: '800', fontSize: 23, lineHeight: 29 },
  subtitle: { color: colours.ink, fontSize: 17, lineHeight: 24 },
  meta: { color: colours.muted, fontSize: 12, lineHeight: 18 },
  signing: { padding: spacing.md, borderWidth: 2, borderColor: colours.green, borderRadius: radius.md, gap: spacing.sm },
  eyebrow: { color: colours.green, fontWeight: '800', fontSize: 12 },
  heading: { color: colours.ink, fontWeight: '800', fontSize: 17, lineHeight: 24 },
  text: { color: colours.ink, fontSize: 15, lineHeight: 23 },
  label: { color: colours.muted, fontSize: 13, lineHeight: 20 },
  section: { padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colours.line, borderRadius: radius.md },
  answer: { paddingVertical: spacing.xs, gap: 3 },
});
