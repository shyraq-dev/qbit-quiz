const { createClient } = require('@supabase/supabase-js');
const { sendTelegram } = require('./notify');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async (req, res) => {
  // Vercel Cron тек GET жіберуі керек + CRON_SECRET тексеру
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Апталық топ 10 алу
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: results } = await supabase
      .from('results')
      .select('user_id, score, users(id, first_name, username, chat_id)')
      .gte('created_at', weekAgo)
      .order('score', { ascending: false });

    if (!results || !results.length) return res.json({ ok: true, sent: 0 });

    // Пайдаланушы бойынша жиынтық есептеу
    const userMap = {};
    for (const r of results) {
      const uid = r.user_id;
      if (!userMap[uid]) {
        userMap[uid] = {
          user: r.users,
          totalScore: 0,
          games: 0,
        };
      }
      userMap[uid].totalScore += r.score || 0;
      userMap[uid].games += 1;
    }

    const ranked = Object.values(userMap)
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, 10);

    // Рейтинг мәтінін жасау
    const medals = ['🥇', '🥈', '🥉'];
    let rankText = '🏆 <b>Апталық рейтинг!</b>\n\n';
    ranked.forEach((entry, i) => {
      const medal = medals[i] || `${i + 1}.`;
      const name = entry.user?.first_name || entry.user?.username || 'Ойыншы';
      rankText += `${medal} ${name} — ${Math.round(entry.totalScore / entry.games)}% орт.\n`;
    });
    rankText += `\n📱 t.me/QBitQuizBot/quiz`;

    // chat_id бар барлық пайдаланушыларға жіберу
    const { data: allUsers } = await supabase
      .from('users')
      .select('chat_id')
      .not('chat_id', 'is', null);

    let sent = 0;
    for (const u of allUsers || []) {
      await sendTelegram(u.chat_id, rankText);
      sent++;
      // Rate limit үшін кішкене күту
      await new Promise(r => setTimeout(r, 50));
    }

    return res.json({ ok: true, sent });
  } catch (e) {
    console.error('Weekly cron error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
