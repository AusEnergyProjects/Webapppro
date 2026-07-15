import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Redirect, Tabs } from 'expo-router';

import { colours } from '@/lib/theme';
import { useApp } from '@/providers/app-provider';

export default function FieldTabs() {
  const { user, loading, sync } = useApp();
  if (!loading && !user) return <Redirect href="/" />;
  return (
    <Tabs screenOptions={{
      headerStyle: { backgroundColor: colours.forest },
      headerTintColor: colours.white,
      headerTitleStyle: { fontWeight: '800' },
      tabBarActiveTintColor: colours.green,
      tabBarInactiveTintColor: colours.muted,
      tabBarStyle: { height: 66, paddingBottom: 8, paddingTop: 6 },
      tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
    }}>
      <Tabs.Screen name="work" options={{ title: 'My work', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="briefcase-check-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="sync" options={{ title: 'Sync', tabBarBadge: sync.conflicts || undefined, tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="sync" color={color} size={size} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'Account', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="account-circle-outline" color={color} size={size} /> }} />
    </Tabs>
  );
}
