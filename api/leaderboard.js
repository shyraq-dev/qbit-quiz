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
        .select('user_id, score, correct, wrong, users(id, first_name, username, avatar)')
        .gte('played_at', weekAgo);

      // Пайдаланушы бойынша топта
      const map = {};
      for (const r of rows || []) {
        const uid = r.user_id;
        if (!map[uid]) {
          // r.users null болуы мүмкін — қауіпсіз деструктуризация
          const u = r.users || {};
          map[uid] = {
            user_id: uid,
            id: u.id || uid,
            first_name: u.first_name || 'Қолданушы',
            username: u.username || null,
            avatar: u.avatar || null,
            scores: [],
            total_correct: 0,
            total_questions: 0,
            games: 0,
          };
        }
        map[uid].scores.push(r.score);
        map[uid].total_correct += (r.correct || 0);
        map[uid].total_questions += (r.correct || 0) + (r.wrong || 0);
        map[uid].games++;
      }

      data = Object.values(map)
        .map(u => {
          // avg_score: дұрыс жауап % (score емес, accuracy)
          const accuracy = u.total_questions > 0
            ? Math.round(u.total_correct / u.total_questions * 100)
            : 0;
          return { ...u, avg_score: accuracy };
        })
        .sort((a, b) => b.avg_score - a.avg_score || b.games - a.games)
        .slice(0, 20);

    } else if (type === 'quiz' && quiz_id) {
      // Тест бойынша рейтинг
      const { data: rows } = await supabase
        .from('results')
        .select('user_id, score, time_sec, users(id, first_name, username, avatar)')
        .eq('quiz_id', quiz_id)
        .order('score', { ascending: false })
        .order('time_sec', { ascending: true })
        .limit(20);
      data = (rows || []).map(r => ({
        ...r,
        ...(r.users || {}),
      }));

    } else {
      // Жалпы рейтинг — accuracy % бойынша сортта (total_correct/total_questions)
      const { data: rows } = await supabase
        .from('users')
        .select('id, first_name, username, avatar, total_games, total_correct, total_questions, best_streak')
        .gt('total_games', 0)
        .gt('total_questions', 0)
        .order('total_correct', { ascending: false }) // DB-де computed column жоқ, JS-де sort
        .limit(100); // accuracy есептеу үшін көбірек алып, JS-де sort жасаймыз

      data = (rows || [])
        .map(u => ({
          ...u,
          _accuracy: Math.round(u.total_correct / u.total_questions * 100),
        }))
        .sort((a, b) => b._accuracy - a._accuracy || b.total_games - a.total_games)
        .slice(0, 20);
    }

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};
