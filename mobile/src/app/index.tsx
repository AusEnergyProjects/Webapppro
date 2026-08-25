import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Application from 'expo-application';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { FieldButton } from '@/components/field-button';
import { Screen } from '@/components/screen';
import { emailSignIn, resetPassword } from '@/lib/auth';
import { API_BASE_URL, APP_VERSION } from '@/lib/config';
import { colours, radius, spacing } from '@/lib/theme';
import { checkForAppUpdate, restartIntoUpdate } from '@/lib/updates';
import { readableAuthError, useApp } from '@/providers/app-provider';
import tlinkIcon from '../../assets/images/icon.png';

function StartupSettings() {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const installUrl = `${API_BASE_URL}/direct-trade/field-app`;

  async function checkUpdate() {
    setChecking(true);
    setMessage('Checking for the latest TLink update...');
    try {
      const result = await checkForAppUpdate();
      setMessage(result.message);
      if (result.kind === 'ready') {
        Alert.alert('Update ready', result.message, [
          { text: 'Later', style: 'cancel' },
          { text: 'Restart now', onPress: () => void restartIntoUpdate() },
        ]);
      }
      if (result.kind === 'download') {
        Alert.alert('Update available', result.message, [
          { text: 'Later', style: 'cancel' },
          { text: 'Open update', onPress: () => void Linking.openURL(result.url) },
        ]);
      }
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'The update check could not be completed.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      <View style={styles.topActions}>
        <Pressable
          accessibilityLabel="Open TLink settings"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => setOpen(true)}
          style={({ pressed }) => [styles.settingsButton, pressed && styles.pressed]}
        >
          <MaterialCommunityIcons name="cog-outline" color={colours.white} size={25} />
        </Pressable>
      </View>
      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
        transparent
        visible={open}
      >
        <View style={styles.settingsBackdrop}>
          <View accessibilityViewIsModal style={styles.settingsSheet}>
            <View style={styles.settingsHeader}>
              <View style={styles.settingsHeadingCopy}>
                <Text style={styles.eyebrow}>TLINK SETTINGS</Text>
                <Text style={styles.settingsTitle}>App and updates</Text>
              </View>
              <Pressable
                accessibilityLabel="Close TLink settings"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setOpen(false)}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="close" color={colours.ink} size={24} />
              </Pressable>
            </View>
            <Text style={styles.settingsBody}>Check for small app updates here. If TLink needs a full Android build, open the secure install page.</Text>
            {message ? <Text accessibilityLiveRegion="polite" style={styles.updateMessage}>{message}</Text> : null}
            <FieldButton loading={checking} onPress={() => void checkUpdate()}>Check for update</FieldButton>
            <FieldButton variant="quiet" disabled={checking} onPress={() => void Linking.openURL(installUrl)}>Open secure install page</FieldButton>
            <View style={styles.versionFacts}>
              <View style={styles.versionFact}><Text style={styles.settingsBody}>App version</Text><Text style={styles.versionValue}>{APP_VERSION}</Text></View>
              <View style={styles.versionFact}><Text style={styles.settingsBody}>Build</Text><Text style={styles.versionValue}>{Application.nativeBuildVersion || 'Development'}</Text></View>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

export default function SignInScreen() {
  const { user, loading, access, sync, syncNow, pinSignIn, signOut } = useApp();
  const [displayName, setDisplayName] = useState('');
  const [pin, setPin] = useState('');
  const [officeMode, setOfficeMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  if (loading) return <View style={styles.loading}><ActivityIndicator size="large" color={colours.green} /><Text style={styles.intro}>Checking secure trade access...</Text></View>;
  if (user && access.status === 'approved') return <Redirect href="/(tabs)/work" />;
  if (user) {
    return (
      <Screen>
        <StartupSettings />
        <View style={styles.brand}>
          <Image accessibilityLabel="TLink" alt="TLink" source={tlinkIcon} style={styles.mark} />
          <Text style={styles.eyebrow}>SECURE FIELD ACCESS</Text>
          <Text style={styles.title}>{access.title}</Text>
          <Text accessibilityLiveRegion="polite" style={styles.intro}>{access.message}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Signed in as</Text>
          <Text style={styles.account}>{user.displayName || user.email || 'Work account'}</Text>
          <Text style={styles.guidance}>{access.guidance}</Text>
          <FieldButton loading={sync.running || access.status === 'checking'} onPress={() => void syncNow()}>
            Check access again
          </FieldButton>
          <FieldButton variant="danger" onPress={() => void signOut()}>Sign out and remove local work</FieldButton>
        </View>
        <Text style={styles.privacy}>Protected jobs remain locked and cached work is removed when the server rejects access.</Text>
      </Screen>
    );
  }

  async function signIn() {
    setBusy(true); setMessage('');
    try { await emailSignIn(email, password); }
    catch (error) { setMessage(readableAuthError(error)); }
    finally { setBusy(false); }
  }

  async function signInWithPin() {
    setBusy(true); setMessage('');
    try { await pinSignIn(displayName, pin); }
    catch (error) { setMessage(readableAuthError(error)); }
    finally { setBusy(false); }
  }

  async function reset() {
    if (!email.trim()) return setMessage('Enter the account email first.');
    setBusy(true); setMessage('');
    try { await resetPassword(email); setMessage('Password reset instructions have been sent.'); }
    catch (error) { setMessage(readableAuthError(error)); }
    finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <StartupSettings />
        <View style={styles.brand}>
          <Image accessibilityLabel="TLink" alt="TLink" source={tlinkIcon} style={styles.mark} />
          <Text style={styles.eyebrow}>SECURE FIELD SERVICE</Text>
          <Text style={styles.title}>Your workday, clear and ready</Text>
          <Text style={styles.intro}>See assigned jobs, complete field records and keep working when reception drops.</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{officeMode ? 'Office account sign-in' : 'Open your field schedule'}</Text>
          {officeMode ? <>
            <Text style={styles.label}>Work email</Text>
            <TextInput style={styles.input} autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="name@business.com.au" placeholderTextColor={colours.muted} />
            <Text style={styles.label}>Password</Text>
            <TextInput style={styles.input} autoCapitalize="none" autoComplete="current-password" secureTextEntry value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={colours.muted} />
          </> : <>
            <Text style={styles.help}>Enter the username and six-digit PIN your TLink administrator sent you.</Text>
            <Text style={styles.label}>TLink username</Text>
            <TextInput style={styles.input} autoCapitalize="none" autoComplete="username" value={displayName} onChangeText={setDisplayName} placeholder="For example, John Smith" placeholderTextColor={colours.muted} />
            <Text style={styles.label}>Six-digit PIN</Text>
            <TextInput style={[styles.input, styles.pin]} keyboardType="number-pad" secureTextEntry maxLength={6} value={pin} onChangeText={(value) => setPin(value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" placeholderTextColor={colours.muted} />
          </>}
          {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
          {officeMode ? <>
            <FieldButton loading={busy} disabled={!email.trim() || !password} onPress={() => void signIn()}>Sign in</FieldButton>
            <FieldButton variant="quiet" disabled={busy} onPress={() => void reset()}>Forgot password</FieldButton>
          </> : <FieldButton loading={busy} disabled={!displayName.trim() || pin.length !== 6} onPress={() => void signInWithPin()}>Open my schedule</FieldButton>}
          <FieldButton variant="quiet" disabled={busy} onPress={() => { setOfficeMode((value) => !value); setMessage(''); }}>
            {officeMode ? 'Use name and PIN' : 'Use an office account instead'}
          </FieldButton>
        </View>
        <Text style={styles.privacy}>Your PIN works once on this phone. Only jobs assigned to your TLink access are downloaded.</Text>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: colours.cream },
  topActions: { minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  settingsButton: { width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colours.forest, borderWidth: 1, borderColor: colours.line },
  pressed: { opacity: 0.72 },
  settingsBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 9, 18, 0.78)' },
  settingsSheet: { backgroundColor: colours.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderWidth: 1, borderColor: colours.line, padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  settingsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  settingsHeadingCopy: { flex: 1, gap: spacing.xs },
  settingsTitle: { color: colours.ink, fontSize: 24, fontWeight: '800' },
  settingsBody: { color: colours.muted, fontSize: 15, lineHeight: 22 },
  closeButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colours.surfaceRaised, borderWidth: 1, borderColor: colours.line },
  updateMessage: { color: colours.green, backgroundColor: colours.mint, borderRadius: radius.sm, padding: spacing.sm, lineHeight: 20 },
  versionFacts: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colours.line, paddingTop: spacing.md },
  versionFact: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  versionValue: { color: colours.ink, fontWeight: '800' },
  brand: { paddingTop: spacing.xl, gap: spacing.sm },
  mark: { width: 72, height: 72, borderRadius: 20 },
  eyebrow: { color: colours.green, fontSize: 12, fontWeight: '800', letterSpacing: 1.2, marginTop: spacing.md },
  title: { color: colours.ink, fontSize: 34, lineHeight: 40, fontWeight: '800' },
  intro: { color: colours.muted, fontSize: 17, lineHeight: 25 },
  card: { backgroundColor: colours.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: colours.line },
  cardTitle: { color: colours.ink, fontSize: 21, fontWeight: '800', marginBottom: spacing.sm },
  help: { color: colours.muted, fontSize: 15, lineHeight: 22, marginBottom: spacing.xs },
  account: { color: colours.ink, fontSize: 16, fontWeight: '700' },
  guidance: { color: colours.muted, lineHeight: 21, marginBottom: spacing.sm },
  label: { color: colours.ink, fontWeight: '700', marginTop: spacing.xs },
  input: { minHeight: 52, borderWidth: 1, borderColor: colours.line, borderRadius: radius.sm, paddingHorizontal: spacing.md, fontSize: 16, color: colours.ink, backgroundColor: colours.surfaceRaised },
  pin: { fontSize: 22, fontWeight: '800', letterSpacing: 8, textAlign: 'center' },
  message: { color: colours.red, lineHeight: 20, paddingVertical: spacing.xs },
  privacy: { color: colours.muted, textAlign: 'center', fontSize: 13, lineHeight: 19, paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
});
