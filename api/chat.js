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

  const { initData, action, text, toUserId, appUsername } = req.body;
  if (!verifyTelegramData(initData)) return res.status(401).json({ ok: false });

  const params = new URLSearchParams(initData);
  const user = JSON.parse(params.get('user'));

  try {
    // ── @username орнату ─────────────────────────────────
    if (action === 'set_username') {
      if (!appUsername || appUsername.trim().length < 3) {
        return res.json({ ok: false, error: 'Минимум 3 таңба' });
      }
      if (appUsername.trim().length > 20) {
        return res.json({ ok: false, error: 'Максимум 20 таңба' });
      }
      if (!/^[a-zA-Z0-9_]+$/.test(appUsername.trim())) {
        return res.json({ ok: false, error: 'Тек әріп, сан және _ болуы мүмкін' });
      }
      // Бос па тексеру
      const { data: existing } = await supabase
        .from('users').select('id').eq('app_username', appUsername.trim().toLowerCase()).single();
      if (existing && existing.id !== user.id) {
        return res.json({ ok: false, error: 'Бұл ат бос емес' });
      }
      await supabase.from('users')
        .update({ app_username: appUsername.trim().toLowerCase() })
        .eq('id', user.id);
      return res.json({ ok: true });
    }

    // ── Пайдаланушы іздеу (@username арқылы) ────────────
    if (action === 'search') {
      const { query } = req.body;
      if (!query || query.trim().length < 2) {
        return res.json({ ok: false, error: 'Минимум 2 таңба' });
      }
      const q = query.trim().toLowerCase().replace('@', '');
      const { data } = await supabase
        .from('users')
        .select('id, first_name, app_username, avatar')
        .ilike('app_username', `${q}%`)
        .neq('id', user.id)
        .limit(10);
      return res.json({ ok: true, users: data || [] });
    }

    // ── Чаттар тізімі ────────────────────────────────────
    if (action === 'conversations') {
      // Хабарлама жазысқан барлық адамдар
      const { data: msgs } = await supabase
        .from('chat_messages')
        .select('from_user_id, to_user_id, text, created_at, is_read')
        .or(`from_user_id.eq.${user.id},to_user_id.eq.${user.id}`)
        .order('created_at', { ascending: false });

      if (!msgs?.length) return res.json({ ok: true, conversations: [] });

      // Бірегей партнерлерді табу
      const partnerMap = {};
      for (const m of msgs) {
        const partnerId = m.from_user_id === user.id ? m.to_user_id : m.from_user_id;
        if (!partnerMap[partnerId]) {
          partnerMap[partnerId] = {
            partner_id: partnerId,
            last_message: m.text,
            last_at: m.created_at,
            unread: 0,
          };
        }
        if (m.to_user_id === user.id && !m.is_read) {
          partnerMap[partnerId].unread++;
        }
      }

      const partnerIds = Object.keys(partnerMap).map(Number);
      const { data: partners } = await supabase
        .from('users')
        .select('id, first_name, app_username, avatar')
        .in('id', partnerIds);

      const convs = (partners || []).map(p => ({
        ...partnerMap[p.id],
        first_name: p.first_name,
        app_username: p.app_username,
        avatar: p.avatar || '🐱',
      })).sort((a, b) => new Date(b.last_at) - new Date(a.last_at));

      return res.json({ ok: true, conversations: convs });
    }

    // ── Хабарламаларды алу ───────────────────────────────
    if (action === 'messages') {
      if (!toUserId) return res.json({ ok: false, error: 'toUserId керек' });

      const { data } = await supabase
        .from('chat_messages')
        .select('*')
        .or(`and(from_user_id.eq.${user.id},to_user_id.eq.${toUserId}),and(from_user_id.eq.${toUserId},to_user_id.eq.${user.id})`)
        .order('created_at', { ascending: true })
        .limit(100);

      // Оқылды деп белгілеу
      await supabase.from('chat_messages')
        .update({ is_read: true })
        .eq('from_user_id', toUserId)
        .eq('to_user_id', user.id)
        .eq('is_read', false);

      return res.json({ ok: true, messages: data || [] });
    }

    // ── Хабарлама жіберу ─────────────────────────────────
    if (action === 'send') {
      if (!toUserId) return res.json({ ok: false, error: 'toUserId керек' });
      if (!text || text.trim().length < 1) return res.json({ ok: false, error: 'Бос' });
      if (text.trim().length > 1000) return res.json({ ok: false, error: 'Макс. 1000 таңба' });

      const { data } = await supabase.from('chat_messages').insert({
        from_user_id: user.id,
        to_user_id: toUserId,
        text: text.trim(),
      }).select().single();

      return res.json({ ok: true, message: data });
    }

    // ── Оқылмаған жалпы саны ─────────────────────────────
    if (action === 'unread') {
      const { count } = await supabase
        .from('chat_messages')
        .select('*', { count: 'exact', head: true })
        .eq('to_user_id', user.id)
        .eq('is_read', false);
      return res.json({ ok: true, count: count || 0 });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
