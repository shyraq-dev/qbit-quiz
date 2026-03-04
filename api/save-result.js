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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { initData, result } = req.body;

  if (!verifyTelegramData(initData)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const params = new URLSearchParams(initData);
  const user = JSON.parse(params.get('user'));

  try {
    // Пайдаланушыны upsert
    await supabase.from('users').upsert({
      id: user.id,
      username: user.username || null,
      first_name: user.first_name || 'Қолданушы',
      photo_url: user.photo_url || null,
    }, { onConflict: 'id', ignoreDuplicates: false });

    // Нәтижені сақта
    await supabase.from('results').insert({
      user_id: user.id,
      quiz_id: result.quizId,
      quiz_title: result.quizTitle,
      score: result.score,
      correct: result.correct,
      wrong: result.wrong,
      time_sec: result.timeSec,
      max_streak: result.maxStreak,
    });

    // Пайдаланушы статистикасын жаңарт
    const { data: userData } = await supabase
      .from('users').select('*').eq('id', user.id).single();

    if (userData) {
      await supabase.from('users').update({
        total_games: userData.total_games + 1,
        total_correct: userData.total_correct + result.correct,
        total_questions: userData.total_questions + result.correct + result.wrong,
        best_streak: Math.max(userData.best_streak, result.maxStreak),
        last_played: new Date().toISOString().split('T')[0],
      }).eq('id', user.id);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};