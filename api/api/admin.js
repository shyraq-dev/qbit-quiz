const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

function verifyAdmin(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    const arr = [...params.entries()].sort(([a],[b]) => a.localeCompare(b));
    const dataStr = arr.map(([k,v]) => `${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256','WebAppData').update(process.env.BOT_TOKEN).digest();
    const computed = crypto.createHmac('sha256',secret).update(dataStr).digest('hex');
    if (computed !== hash) return false;
    const user = JSON.parse(params.get('user') || '{}');
    return String(user.id) === String(process.env.ADMIN_ID);
  } catch { return false; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { initData, action, payload } = req.body;

  if (!verifyAdmin(initData)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    // ── DASHBOARD STATS ──────────────────────
    if (action === 'stats') {
      const [usersRes, resultsRes, todayRes] = await Promise.all([
        supabase.from('users').select('*', { count: 'exact', head: true }),
        supabase.from('results').select('*', { count: 'exact', head: true }),
        supabase.from('results').select('*', { count: 'exact', head: true })
          .gte('played_at', new Date(Date.now() - 24*60*60*1000).toISOString()),
      ]);
      const weekAgo = new Date(Date.now() - 7*24*60*60*1000).toISOString();
      const { count: weeklyActive } = await supabase
        .from('results').select('user_id', { count: 'exact', head: true })
        .gte('played_at', weekAgo);
      return res.json({ ok: true, data: {
        totalUsers: usersRes.count || 0,
        totalGames: resultsRes.count || 0,
        todayGames: todayRes.count || 0,
        weeklyActive: weeklyActive || 0,
      }});
    }

    // ── RECENT GAMES ─────────────────────────
    if (action === 'recent_games') {
      const { data } = await supabase
        .from('results')
        .select('*, users(first_name, username)')
        .order('played_at', { ascending: false })
        .limit(20);
      return res.json({ ok: true, data: data || [] });
    }

    // ── USERS LIST ───────────────────────────
    if (action === 'users') {
      const { data } = await supabase
        .from('users')
        .select('*')
        .order('total_games', { ascending: false })
        .limit(50);
      return res.json({ ok: true, data: data || [] });
    }

    // ── DELETE QUIZ ──────────────────────────
    if (action === 'delete_quiz') {
      const { quizId } = payload;
      await supabase.from('quizzes').delete().eq('id', quizId);
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};