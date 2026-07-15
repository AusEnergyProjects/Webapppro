import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { FieldButton } from '@/components/field-button';
import { Screen } from '@/components/screen';
import { APP_VERSION } from '@/lib/config';
import { getDeviceId, getDeviceName } from '@/lib/device';
import { colours, radius, spacing } from '@/lib/theme';
import { useApp } from '@/providers/app-provider';

export default function SettingsScreen() {
  const { user, signOut } = useApp();
  const [deviceId, setDeviceId] = useState('');
  useEffect(() => { void getDeviceId().then(setDeviceId); }, []);
  return (
    <Screen>
      <View style={styles.hero}><Text style={styles.eyebrow}>ACCOUNT</Text><Text style={styles.heading}>Field access</Text><Text style={styles.intro}>This device is registered to your installer team and can be revoked by the business owner.</Text></View>
      <View style={styles.card}>
        <View style={styles.icon}><MaterialCommunityIcons name="account-hard-hat-outline" color={colours.white} size={30} /></View>
        <Text style={styles.title}>{user?.displayName || 'Installer team member'}</Text>
        <Text style={styles.body}>{user?.email}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>THIS DEVICE</Text>
        <View style={styles.fact}><Text style={styles.body}>Name</Text><Text style={styles.value}>{getDeviceName()}</Text></View>
        <View style={styles.fact}><Text style={styles.body}>App version</Text><Text style={styles.value}>{APP_VERSION}</Text></View>
        <View style={styles.fact}><Text style={styles.body}>Device reference</Text><Text numberOfLines={1} style={[styles.value, styles.reference]}>{deviceId.slice(-12) || 'Preparing...'}</Text></View>
      </View>
      <View style={styles.privacy}><MaterialCommunityIcons name="shield-lock-outline" size={26} color={colours.green} /><View style={styles.flex}><Text style={styles.title}>Privacy by design</Text><Text style={styles.body}>Offline records are encrypted. Signing out or remote revocation removes cached jobs, queued files and addresses from this device.</Text></View></View>
      <FieldButton variant="danger" onPress={() => Alert.alert('Sign out of AEA Field?', 'All offline work on this device will be removed. Sync saved changes first if possible.', [{ text: 'Stay signed in', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => void signOut() }])}>Sign out and remove local work</FieldButton>
      <Text style={styles.footer}>Australian Energy Assessments | Secure field service</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: spacing.xs },
  eyebrow: { color: colours.green, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  heading: { color: colours.ink, fontSize: 28, fontWeight: '800' },
  intro: { color: colours.muted, fontSize: 16, lineHeight: 23 },
  card: { backgroundColor: colours.white, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colours.line, gap: spacing.sm },
  icon: { width: 54, height: 54, borderRadius: 18, backgroundColor: colours.forest, alignItems: 'center', justifyContent: 'center' },
  title: { color: colours.ink, fontSize: 19, fontWeight: '800' },
  body: { color: colours.muted, lineHeight: 21 },
  label: { color: colours.green, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, borderTopWidth: 1, borderTopColor: colours.line, paddingTop: spacing.sm },
  value: { flex: 1, textAlign: 'right', color: colours.ink, fontWeight: '700' },
  reference: { fontFamily: 'monospace' },
  privacy: { flexDirection: 'row', gap: spacing.md, backgroundColor: colours.mint, borderRadius: radius.md, padding: spacing.md },
  flex: { flex: 1 },
  footer: { color: colours.muted, textAlign: 'center', fontSize: 12, padding: spacing.lg },
});
