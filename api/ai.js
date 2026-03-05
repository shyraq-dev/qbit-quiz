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

// Бірнеше модель — бірі қате берсе келесісі сынайды
const MODELS = [
  'mistralai/mistral-7b-instruct:free',
  'huggingfaceh4/zephyr-7b-beta:free',
  'openchat/openchat-7b:free',
];

async function callOpenRouter(prompt) {
  let lastError = null;

  for (const model of MODELS) {
    try {
      console.log(`🤖 Модель сынауда: ${model}`);
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://qbit-quiz.vercel.app',
          'X-Title': 'QBit Quiz',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 3000,
        })
      });

      const raw = await r.text();
      console.log(`📥 Raw response (${model}):`, raw.substring(0, 200));

      if (!r.ok) {
        lastError = `HTTP ${r.status}: ${raw.substring(0, 100)}`;
        continue;
      }

      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        lastError = `JSON parse қате: ${raw.substring(0, 100)}`;
        continue;
      }

      if (!data.choices?.[0]?.message?.content) {
        lastError = 'Жауап бос';
        continue;
      }

      let text = data.choices[0].message.content.trim();
      // Markdown code block тазалау
      text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

      // JSON бөлімін табу
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) {
        lastError = `JSON табылмады: ${text.substring(0, 100)}`;
        continue;
      }
      text = text.substring(jsonStart, jsonEnd + 1);

      const parsed = JSON.parse(text);
      if (!parsed.questions || !Array.isArray(parsed.questions)) {
        lastError = 'questions массиві жоқ';
        continue;
      }

      console.log(`✅ Сәтті: ${model}, ${parsed.questions.length} сұрақ`);
      return parsed.questions;

    } catch (e) {
      lastError = e.message;
      console.error(`❌ ${model} қате:`, e.message);
    }
  }

  throw new Error(lastError || 'Барлық модельдер сәтсіз');
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

  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(500).json({ ok: false, error: 'OPENROUTER_API_KEY орнатылмаған' });
  }

  try {

    // ── ТАҚЫРЫП БОЙЫНША ───────────────────────
    if (action === 'generate_from_topic') {
      const { topic, count = 5, difficulty = 'medium', language = 'kk' } = payload;

      const langMap = {
        kk: 'қазақ тілінде жаз',
        ru: 'напиши на русском языке',
        en: 'write in English',
      };
      const diffMap = {
        easy: 'оңай, мектеп деңгейінде',
        medium: 'орта, университет деңгейінде',
        hard: 'қиын, эксперт деңгейінде',
      };

      const prompt = `Сен викторина жасаушысың. ${langMap[language] || langMap.kk}.

Тақырып: "${topic}"
Сұрақ саны: ${count}
Қиындық: ${diffMap[difficulty] || diffMap.medium}

МАҢЫЗДЫ: Тек JSON форматында жауап бер. Басқа мәтін жазба. Формат:
{"questions":[{"text":"сұрақ","options":["А","Б","В","Г"],"correct":0,"explanation":"түсіндірме"}]}

correct — дұрыс жауап индексі (0,1,2 немесе 3).
Дәл ${count} сұрақ жаса.`;

      const questions = await callOpenRouter(prompt);
      return res.json({ ok: true, questions });
    }

    // ── МӘТІННЕН ──────────────────────────────
    if (action === 'generate_from_text') {
      const { text, count = 5, difficulty = 'medium' } = payload;

      const diffMap = {
        easy: 'оңай',
        medium: 'орта',
        hard: 'қиын',
      };

      const prompt = `Сен викторина жасаушысың. Қазақ тілінде жаз.

Төмендегі мәтін негізінде ${count} сұрақ жаса.
Қиындық: ${diffMap[difficulty] || 'орта'}.

МӘТІН:
${text.substring(0, 2000)}

МАҢЫЗДЫ: Тек JSON форматында жауап бер. Басқа мәтін жазба. Формат:
{"questions":[{"text":"сұрақ","options":["А","Б","В","Г"],"correct":0,"explanation":"түсіндірме"}]}

correct — дұрыс жауап индексі (0,1,2 немесе 3).
Дәл ${count} сұрақ жаса.`;

      const questions = await callOpenRouter(prompt);
      return res.json({ ok: true, questions });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('AI endpoint қате:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};