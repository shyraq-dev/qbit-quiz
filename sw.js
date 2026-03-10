// public/sw.js — GitHub-қа қос, Vercel статик файл ретінде береді

self.addEventListener('push', function(event) {
  let data = { title: 'QBit Quiz', body: 'Жаңа хабарлама', icon: '/icon.png' };
  try {
    data = event.data.json();
  } catch (e) {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icon.png',
      badge: '/icon.png',
      data: data.data || {},
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const url = event.notification.data?.url || 'https://t.me/QBitQuizBot/quiz';
  event.waitUntil(clients.openWindow(url));
});
