const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function sendTelegram(chatId, text) {
  if (!chatId || !process.env.BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch (e) { console.error('Telegram notify error:', e); }
}

async function notifyUsers(userIds, { type, title, body, data = {}, telegram }) {
  if (!userIds || !userIds.length) return;
  const rows = userIds.map(uid => ({ user_id: uid, type, title, body, data }));
  await supabase.from('notifications').insert(rows);
  if (telegram) {
    const { data: users } = await supabase
      .from('users').select('chat_id').in('id', userIds);
    for (const u of users || []) {
      if (u.chat_id) await sendTelegram(u.chat_id, telegram);
    }
  }
}

async function notifyAll({ type, title, body, data = {}, telegram }) {
  const { data: users } = await supabase
    .from('users').select('id, chat_id').gt('total_games', 0);
  if (!users || !users.length) return;
  const rows = users.map(u => ({ user_id: u.id, type, title, body, data }));
  for (let i = 0; i < rows.length; i += 500) {
    await supabase.from('notifications').insert(rows.slice(i, i + 500));
  }
  if (telegram) {
    for (const u of users) {
      if (u.chat_id) {
        await sendTelegram(u.chat_id, telegram);
        await new Promise(r => setTimeout(r, 50));
      }
    }
  }
}

module.exports = { sendTelegram, notifyUsers, notifyAll };
