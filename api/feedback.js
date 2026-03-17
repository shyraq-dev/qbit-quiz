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

  const { initData, action, message } = req.body;

  if (!verifyTelegramData(initData)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const params = new URLSearchParams(initData);
  const user = JSON.parse(params.get('user'));

  try {
    // Пікір жіберу
    if (action === 'send') {
      if (!message || message.trim().length < 3) {
        return res.json({ ok: false, error: 'Хабарлама тым қысқа' });
      }
      if (message.trim().length > 1000) {
        return res.json({ ok: false, error: 'Хабарлама тым ұзын (макс. 1000 таңба)' });
      }

      await supabase.from('feedback').insert({
        user_id: user.id,
        username: user.username || null,
        first_name: user.first_name || null,
        message: message.trim(),
      });

      return res.json({ ok: true });
    }

    // Пікірлерді алу (тек әкімші)
    if (action === 'list') {
      const adminId = parseInt(process.env.ADMIN_ID);
      if (user.id !== adminId) {
        return res.status(403).json({ ok: false, error: 'Рұқсат жоқ' });
      }

      const { data } = await supabase
        .from('feedback')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      return res.json({ ok: true, feedback: data || [] });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
};
