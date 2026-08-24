import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { FieldButton } from '@/components/field-button';
import { Screen } from '@/components/screen';
import { emailSignIn, resetPassword } from '@/lib/auth';
import { colours, radius, spacing } from '@/lib/theme';
import { readableAuthError, useApp } from '@/providers/app-provider';
import tlinkIcon from '../../assets/images/icon.png';

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
