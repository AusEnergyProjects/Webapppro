import { deviceRegistration } from '@/lib/device';

type Registration = Awaited<ReturnType<typeof deviceRegistration>>;
type Options = Parameters<typeof deviceRegistration>[0];

let pendingRegistration: Promise<void> = Promise.resolve();

/** Keep sync, foreground and native token updates in one device-write order. */
export function persistDeviceRegistration(
  persist: (registration: Registration) => Promise<void>,
  options?: Options,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const operation = pendingRegistration.then(async () => {
    if (!isCurrent()) return;
    // Sample after earlier writes finish. A token arriving while a previous
    // request is in flight must be the final value saved, never overwritten by it.
    const registration = await deviceRegistration(options);
    if (isCurrent()) await persist(registration);
  });
  // A failed request still reaches its caller; it must not block a later refresh.
  pendingRegistration = operation.catch(() => undefined);
  return operation;
}

export function waitForDeviceRegistrations(): Promise<void> {
  return pendingRegistration;
}
