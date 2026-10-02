import { StyleSheet } from 'react-native';
import { colours, radius, spacing } from '@/lib/theme';

export const creditexStyles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colours.cream },
  header: { backgroundColor: colours.forest, flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderColor: colours.line },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  grow: { flex: 1 },
  eyebrow: { color: colours.green, fontWeight: '800', fontSize: 12, letterSpacing: 1, marginTop: spacing.md },
  title: { color: colours.ink, fontWeight: '800', fontSize: 28 },
  heading: { color: colours.ink, fontWeight: '700', fontSize: 19 },
  body: { color: colours.muted, fontSize: 15, lineHeight: 22 },
  label: { color: colours.ink, fontWeight: '700', fontSize: 15 },
  error: { color: colours.red, fontSize: 15, lineHeight: 22 },
  card: { backgroundColor: colours.surface, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colours.line, gap: spacing.sm },
  input: { minHeight: 48, padding: spacing.sm, color: colours.ink, backgroundColor: colours.surfaceRaised, borderWidth: 1, borderColor: colours.line, borderRadius: radius.sm, fontSize: 16 },
  metric: { width: '47%', minHeight: 112, backgroundColor: colours.surface, borderWidth: 1, borderColor: colours.line, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  metricNumber: { color: colours.green, fontSize: 32, fontWeight: '800' },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderColor: colours.line, backgroundColor: colours.surface },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', gap: 5 },
  tabText: { color: colours.muted, fontSize: 11, fontWeight: '700' },
  selected: { color: colours.green },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-start', padding: 16, paddingTop: 65 },
  popup: { backgroundColor: colours.surface, maxHeight: '80%', borderRadius: radius.md, borderWidth: 1, borderColor: colours.line, padding: 16, gap: 12 },
  message: { padding: 12, backgroundColor: colours.surfaceRaised, borderRadius: radius.sm, gap: 6 },
});
