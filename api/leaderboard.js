const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { type, quiz_id } = req.query;

  try {
    let data;

    if (type === 'weekly') {
      // Апталық: осы аптадағы нәтижелер
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: rows } = await supabase
        .from('results')
        .select('user_id, score, users(first_name, username)')
        .gte('played_at', weekAgo)
        .order('score', { ascending: false });

      // Пайдаланушы бойынша топта, орт. score есепте
      const map = {};
      for (const r of rows || []) {
        if (!map[r.user_id]) map[r.user_id] = { ...r.users, user_id: r.user_id, scores: [], games: 0 };
        map[r.user_id].scores.push(r.score);
        map[r.user_id].games++;
      }
      data = Object.values(map)
        .map(u => ({ ...u, avg_score: Math.round(u.scores.reduce((a,b)=>a+b,0)/u.scores.length) }))
        .sort((a,b) => b.avg_score - a.avg_score)
        .slice(0, 20);

    } else if (type === 'quiz' && quiz_id) {
      // Тест бойынша рейтинг
      const { data: rows } = await supabase
        .from('results')
        .select('user_id, score, time_sec, users(first_name, username)')
        .eq('quiz_id', quiz_id)
        .order('score', { ascending: false })
        .order('time_sec', { ascending: true })
        .limit(20);
      data = rows || [];

    } else {
      // Жалпы рейтинг
      const { data: rows } = await supabase
        .from('users')
        .select('id, first_name, username, total_games, total_correct, total_questions, best_streak')
        .gt('total_games', 0)
        .order('total_correct', { ascending: false })
        .limit(20);
      data = rows || [];
    }

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};