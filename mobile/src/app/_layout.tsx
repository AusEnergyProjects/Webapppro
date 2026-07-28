import '@/lib/background';
import '@/lib/notifications';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { colours } from '@/lib/theme';
import { AppProvider, useApp } from '@/providers/app-provider';

function AppNavigation() {
  const { access } = useApp();
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{
        headerStyle: { backgroundColor: colours.forest },
        headerTintColor: colours.white,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colours.cream },
      }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Protected guard={access.status === 'approved'}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="job/[id]" options={{ title: 'Job details', headerBackTitle: 'Work' }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <AppProvider>
      <AppNavigation />
    </AppProvider>
  );
}
