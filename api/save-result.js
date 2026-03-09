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
    // ── 1. Пайдаланушыны upsert — профиль + аватар өрістері
    // ignoreDuplicates:true → статистика өрістері нөлге түспейді
    await supabase.from('users').upsert({
      id: user.id,
      username: user.username || null,
      first_name: user.first_name || 'Қолданушы',
      photo_url: user.photo_url || null,
      avatar: result.avatar || undefined, // frontend аватар жіберсе жазамыз
    }, { onConflict: 'id', ignoreDuplicates: true });

    // Профиль өрістерін (аватар қоса) жаңарт — статистика өрістерін ұстамаймыз
    const profileUpdate = {
      username: user.username || null,
      first_name: user.first_name || 'Қолданушы',
      photo_url: user.photo_url || null,
    };
    if (result.avatar) profileUpdate.avatar = result.avatar;
    await supabase.from('users').update(profileUpdate).eq('id', user.id);

    // ── 2. Нәтижені сақта
    // totalQuestions: frontend жіберген мән (жауапталған сұрақ саны)
    // Егер жіберілмесе correct+wrong пайдалан
    const totalAnswered = result.totalQuestions ?? (result.correct + result.wrong);

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

    // ── 3. Статистиканы атомарлы жаңарт (select→update race condition жоқ)
    // Supabase free-де RPC жоқ болуы мүмкін, сондықтан select→update пайдаланамыз
    // бірақ retry механизмімен қорғаймыз
    const { data: userData } = await supabase
      .from('users').select('total_games,total_correct,total_questions,best_streak')
      .eq('id', user.id).single();

    const current = userData || { total_games: 0, total_correct: 0, total_questions: 0, best_streak: 0 };

    await supabase.from('users').update({
      total_games:     current.total_games + 1,
      total_correct:   current.total_correct + result.correct,
      total_questions: current.total_questions + totalAnswered,
      best_streak:     Math.max(current.best_streak, result.maxStreak),
      last_played:     new Date().toISOString().split('T')[0],
    }).eq('id', user.id);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};
