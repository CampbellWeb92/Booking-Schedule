const CACHE_NAME = "massage-by-ash-schedule-v13";
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./supabase-config.js",
  "./manifest.webmanifest",
  "./notification.wav",
  "./images/logo-clean.png",
  "./images/background.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});




self.addEventListener("push", event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { body: event.data ? event.data.text() : "New booking request" };
  }

  const title = payload.title || "New Booking Request";
  const data = payload.data || {};
  const options = {
    body: payload.body || "A new booking request has been received.",
    icon: "./images/logo-clean.png",
    badge: "./images/logo-clean.png",
    tag: data.appointmentId ? `mba-booking-${data.appointmentId}` : "mba-booking-push",
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: [180, 80, 180, 80, 260],
    timestamp: Date.now(),
    data: {
      appointmentId: data.appointmentId || null,
      url: data.url || "./?pending=1"
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const appointmentId = event.notification.data?.appointmentId || null;
  const targetUrl = event.notification.data?.url || "./?pending=1";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(async clientList => {
      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus();
          client.postMessage({ type: "OPEN_PENDING_BOOKINGS", appointmentId });
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
