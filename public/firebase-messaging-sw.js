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

const APP_CACHE = 'sv-smart-dispatch-app-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.jpg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith('sv-smart-dispatch-app-') && cacheName !== APP_CACHE)
        .map((cacheName) => caches.delete(cacheName))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(async () => {
          const cache = await caches.open(APP_CACHE);
          return (await cache.match('/index.html')) || Response.error();
        })
    );
    return;
  }

  if (requestUrl.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(APP_CACHE).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) return cachedResponse;

        const response = await fetch(event.request);
        if (response.ok && response.type === 'basic') {
          await cache.put(event.request, response.clone());
        }
        return response;
      })
    );
  }
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
