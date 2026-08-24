import * as Updates from 'expo-updates';

import { publicApiRequest } from '@/lib/api';
import { APP_VERSION, MOBILE_PLATFORM } from '@/lib/config';

type ReleasePolicy = {
  latestVersion?: string;
  updateUrl?: string;
};

function versionParts(value: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  return match ? match.slice(1).map(Number) : null;
}

function isNewer(next: string, current: string) {
  const left = versionParts(next); const right = versionParts(current);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

export type UpdateCheckResult =
  | { kind: 'ready'; message: string }
  | { kind: 'download'; message: string; url: string }
  | { kind: 'current'; message: string };

export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  if (Updates.isEnabled) {
    try {
      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        await Updates.fetchUpdateAsync();
        return { kind: 'ready', message: 'The update is downloaded and ready to restart.' };
      }
    } catch {
      // The release endpoint remains the fallback for an APK update or an EAS outage.
    }
  }
  const response = await publicApiRequest<{ policy?: ReleasePolicy }>(`/api/field/app-release?platform=${MOBILE_PLATFORM}`);
  const latest = String(response.policy?.latestVersion || APP_VERSION);
  const candidateUrl = String(response.policy?.updateUrl || '');
  let updateUrl = '';
  try {
    const parsed = new URL(candidateUrl);
    if (parsed.protocol === 'https:') updateUrl = parsed.toString();
  } catch { /* full builds must come from an absolute HTTPS release URL */ }
  if (isNewer(latest, APP_VERSION) && updateUrl) {
    return { kind: 'download', url: updateUrl, message: `TLink Field ${latest} is ready to install.` };
  }
  return { kind: 'current', message: `TLink Field ${APP_VERSION} is up to date.` };
}

export async function restartIntoUpdate() {
  await Updates.reloadAsync();
}
