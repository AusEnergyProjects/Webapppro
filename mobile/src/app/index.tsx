import * as Google from 'expo-auth-session/providers/google';
import { Redirect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { FieldButton } from '@/components/field-button';
import { Screen } from '@/components/screen';
import { GOOGLE_CLIENT_ID } from '@/lib/config';
import { emailSignIn, googleSignIn, resetPassword } from '@/lib/auth';
import { colours, radius, spacing } from '@/lib/theme';
import { readableAuthError, useApp } from '@/providers/app-provider';

WebBrowser.maybeCompleteAuthSession();

function GoogleButton({ onError }: { onError: (message: string) => void }) {
  const [request, response, prompt] = Google.useIdTokenAuthRequest({
    clientId: GOOGLE_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  });
  useEffect(() => {
    if (response?.type !== 'success') return;
    const token = response.params.id_token;
    if (!token) return onError('Google did not return a secure sign in token.');
    void googleSignIn(token).catch((error) => onError(readableAuthError(error)));
  }, [onError, response]);
  return <FieldButton variant="secondary" disabled={!request} onPress={() => void prompt()}>Continue with Google</FieldButton>;
}

export default function SignInScreen() {
  const { user, loading } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  if (loading) return <View style={styles.loading}><ActivityIndicator size="large" color={colours.green} /><Text>Opening secure field work...</Text></View>;
  if (user) return <Redirect href="/(tabs)/work" />;

  async function signIn() {
    setBusy(true); setMessage('');
    try { await emailSignIn(email, password); }
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
          <View style={styles.mark}><Text style={styles.markText}>AEA</Text></View>
          <Text style={styles.eyebrow}>SECURE FIELD SERVICE</Text>
          <Text style={styles.title}>Your workday, clear and ready</Text>
          <Text style={styles.intro}>See assigned jobs, complete field records and keep working when reception drops.</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sign in to AEA Field</Text>
          <Text style={styles.label}>Work email</Text>
          <TextInput style={styles.input} autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="name@business.com.au" />
          <Text style={styles.label}>Password</Text>
          <TextInput style={styles.input} autoCapitalize="none" autoComplete="current-password" secureTextEntry value={password} onChangeText={setPassword} placeholder="Password" />
          {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
          <FieldButton loading={busy} disabled={!email.trim() || !password} onPress={() => void signIn()}>Sign in</FieldButton>
          {GOOGLE_CLIENT_ID ? <GoogleButton onError={setMessage} /> : null}
          <FieldButton variant="quiet" disabled={busy} onPress={() => void reset()}>Forgot password</FieldButton>
        </View>
        <Text style={styles.privacy}>Only authorised installer team members can sign in. AEA protected customer contact details never enter this app.</Text>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: colours.cream },
  brand: { paddingTop: spacing.xl, gap: spacing.sm },
  mark: { width: 66, height: 66, borderRadius: 20, backgroundColor: colours.forest, alignItems: 'center', justifyContent: 'center' },
  markText: { color: colours.white, fontWeight: '900', fontSize: 20 },
  eyebrow: { color: colours.green, fontSize: 12, fontWeight: '800', letterSpacing: 1.2, marginTop: spacing.md },
  title: { color: colours.ink, fontSize: 34, lineHeight: 40, fontWeight: '800' },
  intro: { color: colours.muted, fontSize: 17, lineHeight: 25 },
  card: { backgroundColor: colours.white, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: colours.line },
  cardTitle: { color: colours.ink, fontSize: 21, fontWeight: '800', marginBottom: spacing.sm },
  label: { color: colours.ink, fontWeight: '700', marginTop: spacing.xs },
  input: { minHeight: 52, borderWidth: 1, borderColor: colours.line, borderRadius: radius.sm, paddingHorizontal: spacing.md, fontSize: 16, color: colours.ink, backgroundColor: '#fbfdfc' },
  message: { color: colours.red, lineHeight: 20, paddingVertical: spacing.xs },
  privacy: { color: colours.muted, textAlign: 'center', fontSize: 13, lineHeight: 19, paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
});
