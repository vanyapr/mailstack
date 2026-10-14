/* Notifications only: never cache authenticated pages, API responses or mail. */
self.addEventListener('push', event => {
  event.waitUntil(self.registration.showNotification('MailStack', {
    body: 'У вас новое письмо во «Входящих».',
    icon: '/mailstack-192.png',
    tag: 'mailstack-inbox',
    data: {url: '/mail'},
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    const mail = windows.find(client => new URL(client.url).origin === self.location.origin && new URL(client.url).pathname === '/mail');
    if (mail) return mail.focus();
    return self.clients.openWindow('/mail');
  })());
});
self.addEventListener('message', event => {
  if (event.data === 'clear-notifications') event.waitUntil((async () => {
    for (const notification of await self.registration.getNotifications({tag: 'mailstack-inbox'})) notification.close();
  })());
});
