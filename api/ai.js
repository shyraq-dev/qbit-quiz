const fetch = require('node-fetch');
const crypto = require('crypto');

function verifyTelegram(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    const arr = [...params.entries()].sort(([a],[b]) => a.localeCompare(b));
    const dataStr = arr.map(([k,v]) => `${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256','WebAppData').update(process.env.BOT_TOKEN).digest();
    const computed = crypto.createHmac('sha256',secret).update(dataStr).digest('hex');
    return computed === hash;
  } catch { return false; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { initData, action, payload } = req.body;

  if (!verifyTelegram(initData)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── ТАҚЫРЫП БОЙЫНША СҰРАҚ ЖАСАУ ──────────
  if (action === 'generate_from_topic') {
    const { topic, count = 5, difficulty = 'medium', language = 'kk' } = payload;

    const langMap = { kk: 'қазақ тілінде', ru: 'на русском языке', en: 'in English' };
    const diffMap = { easy: 'оңай (мектеп деңгейі)', medium: 'орта (университет деңгейі)', hard: 'қиын (эксперт деңгейі)' };

    const prompt = `Сен викторина сұрақтарын жасайтын көмекшісің.

Тақырып: "${topic}"
Сұрақ саны: ${count}
Қиындық: ${diffMap[difficulty] || diffMap.medium}
Тіл: ${langMap[language] || langMap.kk}

Дәл ${count} сұрақ жаса. Әр сұрақта 4 жауап нұсқасы болсын, тек біреуі дұрыс.

ТЕК JSON форматында жауап бер, басқа ештеңе жазба:
{
  "questions": [
    {
      "text": "Сұрақ мәтіні",
      "options": ["А нұсқасы", "Б нұсқасы", "В нұсқасы", "Г нұсқасы"],
      "correct": 0,
      "explanation": "Қысқа түсіндірме"
    }
  ]
}

correct — дұрыс жауаптың индексі (0,1,2,3).`;

    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://qbit-quiz.vercel.app',
          'X-Title': 'QBit Quiz',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.0-flash-exp:free',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 3000,
        })
      });

      const data = await r.json();
      if (!r.ok) throw new Error(data.error?.message || 'API қате');

      let text = data.choices[0].message.content.trim();
      // JSON тазалау
      text = text.replace(/```json/g,'').replace(/```/g,'').trim();
      const parsed = JSON.parse(text);

      return res.json({ ok: true, questions: parsed.questions });
    } catch(e) {
      console.error('AI қате:', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── МӘТІННЕН СҰРАҚ ЖАСАУ ─────────────────
  if (action === 'generate_from_text') {
    const { text, count = 5, difficulty = 'medium' } = payload;

    const diffMap = { easy: 'оңай', medium: 'орта', hard: 'қиын' };

    const prompt = `Сен викторина сұрақтарын жасайтын көмекшісің.

Төмендегі мәтін негізінде ${count} сұрақ жаса.
Қиындық деңгейі: ${diffMap[difficulty] || 'орта'}.
Сұрақтар мәтіннің мазмұнына сәйкес болсын.
Жауаптар мәтінде бар мәліметтерге негізделсін.

МӘТІН:
${text.substring(0, 3000)}

ТЕК JSON форматында жауап бер:
{
  "questions": [
    {
      "text": "Сұрақ мәтіні",
      "options": ["А", "Б", "В", "Г"],
      "correct": 0,
      "explanation": "Түсіндірме"
    }
  ]
}`;

    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://qbit-quiz.vercel.app',
          'X-Title': 'QBit Quiz',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.0-flash-exp:free',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 3000,
        })
      });

      const data = await r.json();
      if (!r.ok) throw new Error(data.error?.message || 'API қате');

      let content = data.choices[0].message.content.trim();
      content = content.replace(/```json/g,'').replace(/```/g,'').trim();
      const parsed = JSON.parse(content);

      return res.json({ ok: true, questions: parsed.questions });
    } catch(e) {
      console.error('AI қате:', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
};