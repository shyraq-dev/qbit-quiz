const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

function verifyTelegramData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash'); params.delete('hash');
    const arr = [...params.entries()].sort(([a],[b])=>a.localeCompare(b));
    const dataStr = arr.map(([k,v])=>`${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256','WebAppData').update(process.env.BOT_TOKEN).digest();
    return crypto.createHmac('sha256',secret).update(dataStr).digest('hex') === hash;
  } catch { return false; }
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(200).end();

  const { initData, action, title, body, toUserId } = req.body;
  if (!verifyTelegramData(initData)) return res.status(401).json({ ok:false });
  const params = new URLSearchParams(initData);
  const user = JSON.parse(params.get('user'));
  const adminId = parseInt(process.env.ADMIN_ID||'0');

  try {
    // Барлық қолданушыларға хабарлама (тек әкімші)
    if (action === 'broadcast') {
      if (user.id !== adminId) return res.status(403).json({ ok:false, error:'Рұқсат жоқ' });
      if (!title || !body) return res.json({ ok:false, error:'Тақырып пен мәтін керек' });
      await notifyAll({ type:'broadcast', title, body });
      return res.json({ ok:true });
    }

    // Әкімшіге notification (кері байланыс жіберілгенде)
    if (action === 'notify_admin') {
      if (!adminId) return res.json({ ok:false });
      await notifyUsers([adminId], { type:'feedback', title, body });
      return res.json({ ok:true });
    }

    // Белгілі бір қолданушыға notification (чат хабарламасы)
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
