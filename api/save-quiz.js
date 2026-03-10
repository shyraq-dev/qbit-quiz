const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { notifyAll } = require('./notify');

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
  if (req.method !== 'POST') return res.status(405).end();

  const { initData, quiz, isNew } = req.body;

  if (!verifyTelegramData(initData)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const params = new URLSearchParams(initData);
  const user = JSON.parse(params.get('user'));

  try {
    let result;

    if (quiz.id) {
      // Жаңарту
      const { data, error } = await supabase
        .from('quizzes')
        .update({
          title: quiz.title,
          description: quiz.description || '',
          category: quiz.category || 'general',
          questions: quiz.questions,
          updated_at: new Date().toISOString(),
        })
        .eq('id', quiz.id)
        .eq('created_by', user.id) // тек өз тесттерін өзгерте алады
        .select().single();

      if (error) throw error;
      result = data;
    } else {
      // Жаңа тест жасау
      const { data, error } = await supabase
        .from('quizzes')
        .insert({
          title: quiz.title,
          description: quiz.description || '',
          category: quiz.category || 'general',
          questions: quiz.questions,
          created_by: user.id,
        })
        .select().single();

      if (error) throw error;
      result = data;

      // Жаңа тест қосылды — барлық пайдаланушыларға хабарлама
      notifyAll(
        `📚 <b>Жаңа тест қосылды!</b>\n\n` +
        `🎯 ${quiz.title}\n` +
        `❓ ${quiz.questions?.length || 0} сұрақ\n\n` +
        `Ойнау үшін: t.me/QBitQuizBot/quiz`,
        {
          title: '📚 Жаңа тест!',
          body: `${quiz.title} — ${quiz.questions?.length || 0} сұрақ`,
          icon: '/icon.png',
          data: { url: 'https://t.me/QBitQuizBot/quiz' },
        }
      ).catch(() => {});
    }

    return res.json({ ok: true, quiz: result });
  } catch (e) {
    console.error('save-quiz error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
