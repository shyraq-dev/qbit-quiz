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

  const { initData, action, id } = req.body || {};
  if (!verifyTelegramData(initData)) return res.status(401).json({ ok: false });

  const params = new URLSearchParams(initData);
  const user = JSON.parse(params.get('user'));

  try {
    if (action === 'list') {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(30);
      const unread = (data || []).filter(n => !n.is_read).length;
      return res.json({ ok: true, notifications: data || [], unread });
    }

    if (action === 'read_all') {
      await supabase.from('notifications')
        .update({ is_read: true })
        .eq('user_id', user.id)
        .eq('is_read', false);
      return res.json({ ok: true });
    }

    if (action === 'read') {
      await supabase.from('notifications')
        .update({ is_read: true })
        .eq('id', id)
        .eq('user_id', user.id);
      return res.json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
