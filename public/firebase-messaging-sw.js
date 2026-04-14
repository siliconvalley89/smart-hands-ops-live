// firebase-messaging-sw.js
// Service worker for Firebase Cloud Messaging — handles background push notifications.
// Vite copies everything in public/ to dist/, so this file is served from the site root.

importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyA_7MVsNQ4jJU1eO-Yfv9M_WQILopF2evk',
  authDomain: 'smart-hands-live.firebaseapp.com',
  projectId: 'smart-hands-live',
  storageBucket: 'smart-hands-live.firebasestorage.app',
  messagingSenderId: '859653333476',
  appId: '1:859653333476:web:36aafadee67815bae2e7f1',
});

const messaging = firebase.messaging();

// Called when a push arrives while the app is in the background or closed
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'New Dispatch';
  const data = payload.data || {};

  const lines = [
    payload.notification?.body || data.location || '',
    data.serialNumber ? `S/N: ${data.serialNumber}` : '',
    data.details   ? `Details: ${data.details}` : '',
    data.clientPhone ? `Client: ${data.clientPhone}` : '',
  ].filter(Boolean);

  self.registration.showNotification(title, {
    body: lines.join('\n'),
    requireInteraction: true,
    tag: `job-${data.jobId || 'new'}`,
    data: { url: '/' },
  });
});

// Tap notification → open / focus the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
