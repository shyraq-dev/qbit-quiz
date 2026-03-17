const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

function verifyTelegramData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    const arr = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    const dataStr = arr.map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
    return crypto.createHmac('sha256', secret).update(dataStr).digest('hex') === hash;
  } catch { return false; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { initData, action, text, userId } = req.body;
  if (!verifyTelegramData(initData)) return res.status(401).json({ ok: false });

  const params = new URLSearchParams(initData);
  const user = JSON.parse(params.get('user'));
  const adminId = parseInt(process.env.ADMIN_ID);
  const isAdmin = user.id === adminId;

  try {
    // ── Хабарламаларды алу ───────────────────────────────
    if (action === 'messages') {
      const targetId = isAdmin ? userId : user.id;
      if (!targetId) return res.json({ ok: false, error: 'userId керек' });

      const { data } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('user_id', targetId)
        .order('created_at', { ascending: true })
        .limit(100);

      // Оқылды деп белгілеу
      const sender = isAdmin ? 'user' : 'admin';
      await supabase.from('chat_messages')
        .update({ is_read: true })
        .eq('user_id', targetId)
        .eq('sender', sender)
        .eq('is_read', false);

      return res.json({ ok: true, messages: data || [] });
    }

    // ── Хабарлама жіберу ─────────────────────────────────
    if (action === 'send') {
      if (!text || text.trim().length < 1) return res.json({ ok: false, error: 'Бос' });
      if (text.trim().length > 1000) return res.json({ ok: false, error: 'Макс. 1000 таңба' });

      const targetUserId = isAdmin ? userId : user.id;
      const sender = isAdmin ? 'admin' : 'user';

      const { data } = await supabase.from('chat_messages').insert({
        user_id: targetUserId,
        sender,
        text: text.trim(),
      }).select().single();

      return res.json({ ok: true, message: data });
    }

    // ── Оқылмаған санын алу (badge) ──────────────────────
    if (action === 'unread') {
      const sender = isAdmin ? 'user' : 'admin';
      const qb = supabase.from('chat_messages')
        .select('*', { count: 'exact', head: true })
        .eq('sender', sender)
        .eq('is_read', false);

      if (!isAdmin) qb.eq('user_id', user.id);

      const { count } = await qb;
      return res.json({ ok: true, count: count || 0 });
    }

    // ── Барлық чат қолданушылар тізімі (әкімші) ─────────
    if (action === 'users') {
      if (!isAdmin) return res.status(403).json({ ok: false });

      // Чат жазған пайдаланушылар + оқылмаған хабарлама саны
      const { data: msgs } = await supabase
        .from('chat_messages')
        .select('user_id, sender, is_read, created_at, text')
        .order('created_at', { ascending: false });

      if (!msgs?.length) return res.json({ ok: true, users: [] });

      // user_id бойынша топтау
      const userMap = {};
      for (const m of msgs) {
        if (!userMap[m.user_id]) {
          userMap[m.user_id] = { user_id: m.user_id, last_message: m.text, last_at: m.created_at, unread: 0 };
        }
        if (m.sender === 'user' && !m.is_read) userMap[m.user_id].unread++;
      }

      const userIds = Object.keys(userMap).map(Number);
      const { data: users } = await supabase
        .from('users').select('id, first_name, username, avatar').in('id', userIds);

      const result = (users || []).map(u => ({
        ...userMap[u.id],
        first_name: u.first_name,
        username: u.username,
        avatar: u.avatar || '🐱',
      })).sort((a, b) => new Date(b.last_at) - new Date(a.last_at));

      return res.json({ ok: true, users: result });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
