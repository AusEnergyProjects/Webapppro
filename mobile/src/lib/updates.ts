import * as Updates from 'expo-updates';

import { publicApiRequest } from '@/lib/api';
import { APP_VERSION, MOBILE_PLATFORM } from '@/lib/config';

function versionParts(value: unknown) {
  const match = typeof value === 'string' && /^(\d+)\.(\d+)\.(\d+)(?:[-+][A-Za-z0-9.-]+)?$/.exec(value.trim());
  const parts = match ? match.slice(1).map(Number) : null;
  return parts?.every(Number.isSafeInteger) ? parts : null;
}

function isNewer(left: number[], right: number[]) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

export type UpdateCheckResult =
  | { kind: 'ready'; message: string }
  | { kind: 'download'; message: string; url: string }
  | { kind: 'current'; message: string }
  | { kind: 'unavailable'; message: string };

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export async function checkForAppUpdate(options: { signal?: AbortSignal; checkOta?: boolean } = {}): Promise<UpdateCheckResult> {
  const cancelled = () => { if (options.signal?.aborted) throw new Error('Update check cancelled.'); };
  const unavailable: UpdateCheckResult = { kind: 'unavailable', message: 'The latest TLink release could not be verified. Try checking again when connected.' };
  try {
    cancelled();
    // A compatible JavaScript update cannot install newer native capabilities.
    const response = await publicApiRequest<unknown>(`/api/field/app-release?platform=${MOBILE_PLATFORM}`, {
      cache: 'no-store', headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }, signal: options.signal,
    });
    cancelled();
    if (!record(response) || response.ok !== true || !record(response.policy)) return unavailable;
    const policy = response.policy;
    const latest = versionParts(policy.latestVersion), minimum = versionParts(policy.minimumVersion), current = versionParts(APP_VERSION);
    if (policy.platform !== MOBILE_PLATFORM || !latest || !minimum || !current || isNewer(minimum, latest)) return unavailable;
    if (typeof policy.updateUrl !== 'string' || !policy.updateUrl.trim()) return unavailable;
    let url: URL;
    try { url = new URL(policy.updateUrl); } catch { return unavailable; }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.port || url.hash) return unavailable;
    const guide = url.hostname === 'ausenergyassessments.com' && url.pathname.replace(/\/$/, '') === '/direct-trade/field-app' && !url.search;
    const apple = (url.hostname === 'testflight.apple.com' && /^\/join\/[A-Za-z0-9]+\/?$/.test(url.pathname))
      || (url.hostname === 'apps.apple.com' && /^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id\d+\/?$/.test(url.pathname));
    if (MOBILE_PLATFORM === 'ios' ? !guide && !apple : url.hostname === 'apple.com' || url.hostname.endsWith('.apple.com')) return unavailable;
    if (isNewer(latest, current)) {
      return { kind: 'download', url: url.toString(), message: `TLink ${String(policy.latestVersion).trim()} is ready to install.` };
    }
    if (Updates.isEnabled && options.checkOta !== false) {
      const update = await Updates.checkForUpdateAsync();
      cancelled();
      if (update.isAvailable || update.isRollBackToEmbedded) {
        const downloaded = await Updates.fetchUpdateAsync();
        cancelled();
        return downloaded.isNew || downloaded.isRollBackToEmbedded
          ? { kind: 'ready', message: 'The update is downloaded and ready to restart.' } : unavailable;
      }
    }
    return { kind: 'current', message: `TLink ${APP_VERSION} is up to date.` };
  } catch {
    cancelled();
    return unavailable;
  }
}

export async function restartIntoUpdate() {
  await Updates.reloadAsync();
}
