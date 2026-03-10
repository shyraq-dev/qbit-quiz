const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ── Telegram Bot хабарламасы ──────────────────────────────
async function sendTelegram(chatId, text, extra = {}) {
  if (!chatId || !process.env.BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...extra,
      }),
    });
  } catch (e) {
    console.error('Telegram notify error:', e);
  }
}

// ── Web Push хабарламасы ──────────────────────────────────
async function sendWebPush(subscription, payload) {
  if (!process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_PUBLIC_KEY) return;
  try {
    // web-push пакеті Vercel-де жұмыс істейді
    const webpush = require('web-push');
    webpush.setVapidDetails(
      `mailto:${process.env.VAPID_EMAIL || 'admin@qbitquiz.com'}`,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    await webpush.sendNotification(subscription, JSON.stringify(payload));
  } catch (e) {
    if (e.statusCode === 410 || e.statusCode === 404) {
      // Subscription жарамсыз — DB-ден өшіру
      await supabase.from('push_subscriptions')
        .delete().eq('endpoint', subscription.endpoint);
    } else {
      console.error('Web Push error:', e);
    }
  }
}

// ── Пайдаланушыларға хабарлама жіберу (негізгі функция) ──
async function notifyUsers(userIds, message, webPushPayload) {
  if (!userIds || !userIds.length) return;

  // Telegram chat_id алу
  const { data: users } = await supabase
    .from('users')
    .select('id, chat_id')
    .in('id', userIds);

  // Web Push subscription алу
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('*')
    .in('user_id', userIds);

  const pushPayload = webPushPayload || { title: 'QBit Quiz', body: message };

  for (const user of users || []) {
    // Telegram
    if (user.chat_id) {
      await sendTelegram(user.chat_id, message);
    }
    // Web Push
    const userSubs = (subs || []).filter(s => s.user_id === user.id);
    for (const sub of userSubs) {
      await sendWebPush(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        pushPayload
      );
    }
  }
}

// ── Барлық пайдаланушыларға жіберу ────────────────────────
async function notifyAll(message, webPushPayload) {
  const { data: users } = await supabase
    .from('users')
    .select('id')
    .gt('total_games', 0);
  const ids = (users || []).map(u => u.id);
  await notifyUsers(ids, message, webPushPayload);
}

module.exports = { sendTelegram, sendWebPush, notifyUsers, notifyAll };
