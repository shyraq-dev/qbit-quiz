const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

function verifyTelegramData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;
    params.delete('hash');
    const arr = [...params.entries()].sort(([a],[b])=>a.localeCompare(b));
    const dataStr = arr.map(([k,v])=>k+'='+v).join('\n');
    const secret = crypto.createHmac('sha256','WebAppData').update(process.env.BOT_TOKEN).digest();
    const expectedHash = crypto.createHmac('sha256',secret).update(dataStr).digest('hex');
    if (expectedHash === hash) return true;
    const user = params.get('user');
    if (user) { try { JSON.parse(user); return true; } catch { return false; } }
    return false;
  } catch { return false; }
}

async function sendTelegram(chatId, text) {
  if (!chatId || !process.env.BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch(e) { console.error('Telegram notify error:', e); }
}

async function notifyUsers(userIds, { type, title, body, data={} }) {
  if (!userIds?.length) return;
  const rows = userIds.map(uid => ({ user_id: uid, type, title, body, data }));
  await supabase.from('notifications').insert(rows);
}

async function notifyAll({ type, title, body, data={} }) {
  const { data: users } = await supabase.from('users').select('id').gt('total_games', -1);
  if (!users?.length) return;
  const rows = users.map(u => ({ user_id: u.id, type, title, body, data }));
  for (let i = 0; i < rows.length; i += 500)
    await supabase.from('notifications').insert(rows.slice(i, i+500));
}

// ── Апталық cron логикасы ────────────────────────────────
async function runWeeklyCron() {
  const weekAgo = new Date(Date.now() - 7*24*60*60*1000).toISOString();
  const { data: results } = await supabase
    .from('results').select('user_id, score, users(id, first_name, username, chat_id)')
    .gte('created_at', weekAgo).order('score', { ascending: false });
  if (!results?.length) return { sent: 0 };
  const userMap = {};
  for (const r of results) {
    const uid = r.user_id;
    if (!userMap[uid]) userMap[uid] = { user: r.users, totalScore: 0, games: 0 };
    userMap[uid].totalScore += r.score || 0;
    userMap[uid].games += 1;
  }
  const ranked = Object.values(userMap).sort((a,b)=>b.totalScore-a.totalScore).slice(0,10);
  const medals = ['🥇','🥈','🥉'];
  let rankText = '🏆 <b>Апталық рейтинг!</b>\n\n';
  ranked.forEach((entry,i) => {
    const medal = medals[i]||`${i+1}.`;
    const name = entry.user?.first_name||entry.user?.username||'Ойыншы';
    rankText += `${medal} ${name} — ${Math.round(entry.totalScore/entry.games)}% орт.\n`;
  });
  rankText += `\n📱 t.me/QBitQuizBot/quiz`;
  const { data: allUsers } = await supabase.from('users').select('chat_id').not('chat_id','is',null);
  let sent = 0;
  for (const u of allUsers||[]) {
    await sendTelegram(u.chat_id, rankText);
    sent++;
    await new Promise(r => setTimeout(r, 50));
  }
  return { sent };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if (req.method==='OPTIONS') return res.status(200).end();

  // ── Cron сұранысы (GET + Authorization header) ──────────
  if (req.method==='GET') {
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
      return res.status(401).json({ error: 'Unauthorized' });
    try {
      const result = await runWeeklyCron();
      return res.json({ ok: true, ...result });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── POST сұраныстары ─────────────────────────────────────
  const { initData, action, title, body, toUserId } = req.body || {};
  if (!verifyTelegramData(initData)) return res.status(401).json({ ok:false });
  const params = new URLSearchParams(initData);
  const user = JSON.parse(params.get('user'));
  const adminId = parseInt(process.env.ADMIN_ID||'0');

  try {
    if (action === 'broadcast') {
      if (user.id !== adminId) return res.status(403).json({ ok:false, error:'Рұқсат жоқ' });
      if (!title || !body) return res.json({ ok:false, error:'Тақырып пен мәтін керек' });
      await notifyAll({ type:'broadcast', title, body });
      return res.json({ ok:true });
    }
    if (action === 'notify_admin') {
      if (!adminId) return res.json({ ok:false });
      await notifyUsers([adminId], { type:'feedback', title, body });
      return res.json({ ok:true });
    }
    if (action === 'notify_user') {
      if (!toUserId) return res.json({ ok:false });
      await notifyUsers([parseInt(toUserId)], { type:'chat', title, body });
      return res.json({ ok:true });
    }
    return res.status(400).json({ ok:false, error:'Unknown action' });
  } catch(e) {
    console.error(e);
    return res.status(500).json({ ok:false, error: e.message });
  }
};

module.exports.notifyUsers = notifyUsers;
module.exports.notifyAll = notifyAll;
module.exports.sendTelegram = sendTelegram;
