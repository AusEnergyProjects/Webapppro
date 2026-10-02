import '@/lib/background';
import '@/lib/notifications';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { DashboardAppUpdate } from '@/components/dashboard-app-update';
import { BusinessBanner } from '@/components/business-banner';
import { NotificationNavigation } from '@/components/notification-navigation';
import { colours } from '@/lib/theme';
import { AppProvider, useApp } from '@/providers/app-provider';
import { NativeTeamCallProvider } from '@/providers/native-team-call-provider';
import { NativeWorkTimeProvider } from '@/components/work-time-tracking';
import { NativeWorkspaceProvider, useNativeWorkspace } from '@/providers/native-workspace-provider';
import { CreditexNativeApp } from '@/components/creditex-native-app';

function AppNavigation() {
  const { access } = useApp();
  return (
    <>
      <StatusBar style="light" />
      <DashboardAppUpdate />
      <NotificationNavigation />
      <BusinessBanner />
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
          <Stack.Screen name="new-job" options={{ title: 'New field job', headerBackTitle: 'Schedule' }} />
          <Stack.Screen name="new-commercial" options={{ title: 'Quote or invoice', headerBackTitle: 'Work' }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

function WorkspaceApp() {
  const { workspace } = useNativeWorkspace();
  if (workspace === 'creditex') return <CreditexNativeApp />;
  return (
    <AppProvider>
      <NativeWorkTimeProvider>
      <NativeTeamCallProvider>
        <AppNavigation />
      </NativeTeamCallProvider>
      </NativeWorkTimeProvider>
    </AppProvider>
  );
}

export default function RootLayout() {
  return <NativeWorkspaceProvider><WorkspaceApp /></NativeWorkspaceProvider>;
}
