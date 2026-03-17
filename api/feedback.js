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

  const { initData, action, message, id, reply } = req.body;

  if (!verifyTelegramData(initData)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const params = new URLSearchParams(initData);
  const user = JSON.parse(params.get('user'));
  const adminId = parseInt(process.env.ADMIN_ID);

  try {
    // ── Пікір жіберу ────────────────────────────────────────
    if (action === 'send') {
      if (!message || message.trim().length < 3)
        return res.json({ ok: false, error: 'Хабарлама тым қысқа' });
      if (message.trim().length > 1000)
        return res.json({ ok: false, error: 'Макс. 1000 таңба' });

      const { data } = await supabase.from('feedback').insert({
        user_id: user.id,
        username: user.username || null,
        first_name: user.first_name || null,
        message: message.trim(),
      }).select().single();

      return res.json({ ok: true, feedback: data });
    }

    // ── Өз пікірлерін алу (пайдаланушы) ───────────────────
    if (action === 'my') {
      const { data } = await supabase
        .from('feedback')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);

      // Оқылмаған жауаптарды оқылды деп белгілеу
      const unreadIds = (data || [])
        .filter(f => f.reply && !f.is_read_by_user)
        .map(f => f.id);
      if (unreadIds.length) {
        await supabase.from('feedback')
          .update({ is_read_by_user: true })
          .in('id', unreadIds);
      }

      return res.json({ ok: true, feedback: data || [] });
    }

    // ── Оқылмаған жауап санын алу (badge үшін) ─────────────
    if (action === 'unread_replies') {
      const { count } = await supabase
        .from('feedback')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .not('reply', 'is', null)
        .eq('is_read_by_user', false);

      return res.json({ ok: true, count: count || 0 });
    }

    // ── Барлық пікірлерді алу (тек әкімші) ────────────────
    if (action === 'list') {
      if (user.id !== adminId)
        return res.status(403).json({ ok: false, error: 'Рұқсат жоқ' });

      const { data } = await supabase
        .from('feedback')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      return res.json({ ok: true, feedback: data || [] });
    }

    // ── Жауап беру (тек әкімші) ────────────────────────────
    if (action === 'reply') {
      if (user.id !== adminId)
        return res.status(403).json({ ok: false, error: 'Рұқсат жоқ' });
      if (!reply || reply.trim().length < 1)
        return res.json({ ok: false, error: 'Жауап бос' });

      await supabase.from('feedback')
        .update({
          reply: reply.trim(),
          replied_at: new Date().toISOString(),
          is_read_by_user: false,
        })
        .eq('id', id);

      return res.json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
};
