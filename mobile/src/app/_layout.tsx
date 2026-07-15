import '@/lib/background';
import '@/lib/notifications';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { colours } from '@/lib/theme';
import { AppProvider } from '@/providers/app-provider';

export default function RootLayout() {
  return (
    <AppProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{
        headerStyle: { backgroundColor: colours.forest },
        headerTintColor: colours.white,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colours.cream },
      }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="job/[id]" options={{ title: 'Job details', headerBackTitle: 'Work' }} />
      </Stack>
    </AppProvider>
  );
}
