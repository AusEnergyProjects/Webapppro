import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { firebaseAuth } from '@/lib/auth';
import { runSync } from '@/lib/sync';

export const FIELD_SYNC_TASK = 'aea-field-secure-sync-v1';

TaskManager.defineTask(FIELD_SYNC_TASK, async () => {
  if (!firebaseAuth.currentUser) return BackgroundTask.BackgroundTaskResult.Success;
  try {
    await runSync();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSync() {
  await BackgroundTask.registerTaskAsync(FIELD_SYNC_TASK, { minimumInterval: 15 });
}

export async function unregisterBackgroundSync() {
  await BackgroundTask.unregisterTaskAsync(FIELD_SYNC_TASK);
}
