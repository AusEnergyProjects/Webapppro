import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colours, spacing } from '@/lib/theme';
import { useApp } from '@/providers/app-provider';
import { TeamPresence } from '@/components/team-presence';

export function BusinessBanner() {
  const { user, access, businesses, businessError, openBusinessChooser } = useApp();
  if (!user || access.status !== 'approved') return null;
  const canSwitch = user.authMode === 'firebase' && businesses.length > 1;
  const own = businesses.find(choice => choice.ownerUid === user.ownerId)?.role === 'owner';
  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.row}>
      <MaterialCommunityIcons name="office-building-outline" size={22} color={colours.green} />
      <View style={styles.copy}>
        <Text style={styles.label}>{own ? 'YOUR BUSINESS' : 'WORKING WITH'}</Text>
        <Text numberOfLines={1} style={styles.name}>{user.businessName || 'Your team'}</Text>
      </View>
      <TeamPresence key={user.localOwnerKey} />
      {canSwitch ? <Pressable accessibilityRole="button" accessibilityLabel="Switch business"
        style={styles.switch} onPress={() => void openBusinessChooser()}><Text style={styles.switchText}>Switch</Text></Pressable> : null}
    </View>
    {businessError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{businessError}</Text> : null}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colours.forest },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  copy: { flex: 1, gap: 2 },
  label: { color: colours.green, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  name: { color: colours.white, fontSize: 15, fontWeight: '700' },
  switch: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colours.line, borderRadius: 12 },
  switchText: { color: colours.white, fontWeight: '700' },
  error: { color: colours.red, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, lineHeight: 20 },
});
