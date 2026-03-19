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
    const dataCheckString = arr.map(([k, v]) => `${k}=${v}`).join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData')
      .update(process.env.BOT_TOKEN).digest();
    const computedHash = crypto.createHmac('sha256', secretKey)
      .update(dataCheckString).digest('hex');
    return computedHash === hash;
  } catch { return false; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { initData, action, bio } = req.body;

  // Bio жаңарту
  if (action === 'update_bio') {
    if (!verifyTelegramData(initData)) return res.status(401).json({ error: 'Unauthorized' });
    const params = new URLSearchParams(initData);
    const user = JSON.parse(params.get('user'));
    const bioText = bio?.trim().slice(0, 200) || null;
    await supabase.from('users').update({ bio: bioText }).eq('id', user.id);
    return res.status(200).json({ ok: true });
  }

  if (!verifyTelegramData(initData)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const params = new URLSearchParams(initData);
  const user = JSON.parse(params.get('user'));

  try {
    // Пайдаланушы деректері
    const { data: userData } = await supabase
      .from('users').select('*, bio').eq('id', user.id).single();

    // Соңғы 10 ойын
    const { data: recentResults } = await supabase
      .from('results')
      .select('*')
      .eq('user_id', user.id)
      .order('played_at', { ascending: false })
      .limit(10);

    // Рейтингтегі орны — accuracy бойынша (leaderboard-пен сәйкес)
    // Пайдаланушының accuracy есептеу
    const myAccuracy = userData && userData.total_questions > 0
      ? userData.total_correct / userData.total_questions
      : 0;

    // Осы пайдаланушыдан жоғары accuracy-сі барларды сана
    // Supabase-де computed column жоқ, сондықтан JS-де есептейміз
    const { data: allUsers } = await supabase
      .from('users')
      .select('id, total_correct, total_questions')
      .gt('total_games', 0)
      .gt('total_questions', 0);

    const rank = (allUsers || []).filter(u => {
      if (u.id === user.id) return false;
      const acc = u.total_correct / u.total_questions;
      return acc > myAccuracy;
    }).length + 1;

    return res.status(200).json({
      ok: true,
      user: userData || {
        id: user.id,
        first_name: user.first_name,
        username: user.username,
        total_games: 0,
        total_correct: 0,
        total_questions: 0,
        best_streak: 0,
      },
      recentResults: recentResults || [],
      rank,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};
