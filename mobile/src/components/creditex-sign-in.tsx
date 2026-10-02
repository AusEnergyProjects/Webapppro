import { useState } from 'react';
import type { MultiFactorResolver } from 'firebase/auth';
import { Linking, Text, TextInput, View } from 'react-native';
import { FieldButton } from '@/components/field-button';
import { Screen } from '@/components/screen';
import { resetPassword } from '@/lib/auth';
import { API_BASE_URL } from '@/lib/config';
import { creditexEmailSignIn, creditexSignInError, verifyCreditexAuthenticator } from '@/lib/creditex-auth';
import { colours } from '@/lib/theme';
import { creditexStyles as styles } from '@/components/creditex-styles';

export function CreditexSignIn({ onTrade }: { onTrade: () => Promise<void> }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [resolver, setResolver] = useState<MultiFactorResolver | null>(null), [factor, setFactor] = useState(''), [code, setCode] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const factors = resolver?.hints.filter(hint => hint.factorId === 'totp') || [];
  async function signIn() {
    if (busy) return; setBusy(true); setMessage('');
    try { const challenge = await creditexEmailSignIn(email, password); setPassword(''); setResolver(challenge); setFactor(challenge?.hints.find(hint => hint.factorId === 'totp')?.uid || ''); }
    catch (error) { setMessage(creditexSignInError(error)); }
    finally { setBusy(false); }
  }
  async function verify() {
    if (busy || !resolver) return; setBusy(true); setMessage('');
    try { await verifyCreditexAuthenticator(resolver, factor, code); setResolver(null); }
    catch (error) { setMessage(creditexSignInError(error)); }
    finally { setCode(''); setBusy(false); }
  }
  async function reset() {
    if (busy) return; setBusy(true); setMessage('');
    try { await resetPassword(email, 'creditex'); setMessage('If this email has an account, the password reset email is on its way.'); }
    catch (error) { setMessage(creditexSignInError(error)); }
    finally { setBusy(false); }
  }
  return <Screen><Text style={styles.eyebrow}>TLINK · CREDITEX</Text><Text style={styles.title}>Creditex team sign-in</Text><Text style={styles.body}>Use the individual email invited by your Creditex administrator. Your saved permissions apply on every device.</Text>
    <View style={styles.card}>{resolver ? <>
      <Text style={styles.heading}>Authenticator code</Text><Text style={styles.body}>Enter the current six-digit code for your TLink account.</Text>
      {factors.map((hint, index) => factors.length > 1 ? <FieldButton key={hint.uid} variant={factor === hint.uid ? 'primary' : 'secondary'} onPress={() => setFactor(hint.uid)}>{hint.displayName || `Authenticator ${index + 1}`}</FieldButton> : null)}
      {!factors.length ? <Text style={styles.error}>This account uses a different second factor. Open Account security in the web workspace to set up an authenticator.</Text> : <TextInput accessibilityLabel="Authenticator code" style={styles.input} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} value={code} onChangeText={value => setCode(value.replace(/\D/g, ''))} editable={!busy} />}
      <FieldButton loading={busy} disabled={!factor || code.length !== 6} onPress={() => void verify()}>Verify and continue</FieldButton>
      <FieldButton variant="quiet" disabled={busy} onPress={() => { setResolver(null); setCode(''); setMessage(''); }}>Cancel</FieldButton>
    </> : <><Text style={styles.label}>Work email</Text><TextInput accessibilityLabel="Work email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" style={styles.input} value={email} onChangeText={setEmail} editable={!busy} placeholder="name@business.com.au" placeholderTextColor={colours.muted}/>
      <Text style={styles.label}>Password</Text><TextInput accessibilityLabel="Password" autoCapitalize="none" autoComplete="current-password" secureTextEntry style={styles.input} value={password} onChangeText={setPassword} editable={!busy}/>
      <FieldButton loading={busy} disabled={!email.trim() || !password} onPress={() => void signIn()}>Sign in to Creditex</FieldButton><FieldButton variant="quiet" disabled={busy || !email.trim()} onPress={() => void reset()}>Set or reset password</FieldButton>
    </>}{message ? <Text accessibilityLiveRegion="polite" style={styles.error}>{message}</Text> : null}</View>
    <Text style={styles.body}>First time here? Accept your team invitation in the web workspace and complete Account security. If you normally use Google, set a password for the same invited email to sign in here.</Text>
    <FieldButton variant="secondary" disabled={busy} onPress={() => void Linking.openURL(`${API_BASE_URL}/creditex/compliance`)}>Open web setup</FieldButton>
    <FieldButton variant="quiet" disabled={busy} onPress={() => void onTrade().catch(error => setMessage(creditexSignInError(error)))}>Trade team sign-in</FieldButton>
  </Screen>;
}
