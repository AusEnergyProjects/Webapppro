/* TLink notification delivery only. Deliberately no fetch handler or page cache. */
function safeNotificationData(value) {
  if (!value || typeof value !== 'object' || value.v !== 1 || !['team-message', 'team-call'].includes(value.kind)) return null;
  if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(value.id)
      || typeof value.threadId !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(value.threadId)
      || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) return null;
  return {v:1,kind:value.kind,id:value.id,threadId:value.threadId,expiresAt:value.expiresAt};
}

function notificationDestination(value, now = Date.now()) {
  const data = safeNotificationData(value);
  if (!data) return null;
  const url = new URL('/direct-trade/messages',self.location.origin);
  url.searchParams.set('threadId',data.threadId);
  // Old call alerts still open the conversation so the recipient can call back.
  if (data.kind === 'team-call' && Date.parse(data.expiresAt) > now) url.searchParams.set('callId',data.id);
  return url.href;
}

self.addEventListener('install',event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate',event => { event.waitUntil(self.clients.claim()); });

self.addEventListener('push',event => {
  let value;
  try { value = event.data?.json(); } catch { return; }
  const data = safeNotificationData(value);
  if (!data) return;
  const expired = Date.parse(data.expiresAt) <= Date.now();
  event.waitUntil(self.registration.showNotification('TLink',{
    body:data.kind === 'team-call' ? expired ? 'Missed team call' : 'Incoming team call' : 'New team message',
    icon:'/tlink-icon-192.png', badge:'/tlink-mark.png',
    tag:`tlink:${data.kind}:${data.id}`, data,
    requireInteraction:data.kind === 'team-call' && !expired,
  }));
});

self.addEventListener('notificationclick',event => {
  event.notification.close();
  const destination = notificationDestination(event.notification.data);
  if (!destination) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing = windows.find(client => {
      try { const url = new URL(client.url); return url.origin === self.location.origin && url.pathname === '/direct-trade/messages'; }
      catch { return false; }
    });
    if (existing) {
      try {
        const windowClient = existing.url === destination ? existing : await existing.navigate(destination);
        if (windowClient) { await windowClient.focus(); return; }
      } catch { /* A tab may close between discovery and navigation. Open it below. */ }
    }
    await self.clients.openWindow(destination);
  })());
});
