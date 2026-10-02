import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { readNativeWorkspace, saveNativeWorkspace, type NativeWorkspace } from '@/lib/native-workspace';
import { colours } from '@/lib/theme';
import { FieldButton } from '@/components/field-button';

const Context = createContext<{ workspace: NativeWorkspace; choose: (workspace: NativeWorkspace) => Promise<void> } | null>(null);
export function NativeWorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<NativeWorkspace | null>(null);
  const [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => { let active = true; void readNativeWorkspace().then(value => { if (active) setWorkspace(value); }).catch(() => { if (active) setError(true); }); return () => { active = false; }; }, [attempt]);
  if (error && !workspace) return <View style={{ flex: 1, backgroundColor: colours.cream, justifyContent: 'center', padding: 24, gap: 16 }}><Text style={{ color: colours.ink }}>Unlock your phone, then try opening TLink again.</Text><FieldButton onPress={() => { setError(false); setAttempt(value => value + 1); }}>Try again</FieldButton></View>;
  if (!workspace) return <View style={{ flex: 1, backgroundColor: colours.cream, justifyContent: 'center' }}><ActivityIndicator color={colours.green} accessibilityLabel="Opening TLink" /></View>;
  return <Context.Provider value={{ workspace, choose: async next => { await saveNativeWorkspace(next); setWorkspace(next); } }}>{children}</Context.Provider>;
}
export function useNativeWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error('Native workspace is unavailable.');
  return value;
}
