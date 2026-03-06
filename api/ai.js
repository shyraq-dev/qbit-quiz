const https = require('https');
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

function httpsPost(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function callGroq(prompt) {
  const body = JSON.stringify({
    model: 'llama-3.1-8b-instant',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 3000,
  });

  const options = {
    hostname: 'api.groq.com',
    path: '/openai/v1/chat/completions',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  const res = await httpsPost(options, body);
  console.log('📥 Groq status:', res.status);
  console.log('📥 Groq raw:', res.body.substring(0, 300));

  if (res.status !== 200) {
    throw new Error(`Groq HTTP ${res.status}: ${res.body.substring(0, 200)}`);
  }

  const data = JSON.parse(res.body);
  let text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Groq жауап бос');

  // JSON тазалау
  text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) throw new Error('JSON табылмады');
  text = text.substring(jsonStart, jsonEnd + 1);

  const parsed = JSON.parse(text);
  if (!parsed.questions || !Array.isArray(parsed.questions)) {
    throw new Error('questions массиві жоқ');
  }

  return parsed.questions;
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

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ ok: false, error: 'GROQ_API_KEY орнатылмаған' });
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

МАҢЫЗДЫ ЕРЕЖЕ: Тек таза JSON жауап бер. Ешқандай түсіндірме, кіріспе мәтін жазба.

Формат:
{"questions":[{"text":"сұрақ мәтіні","options":["А нұсқа","Б нұсқа","В нұсқа","Г нұсқа"],"correct":0,"explanation":"қысқа түсіндірме"}]}

correct — дұрыс жауаптың индексі (0, 1, 2 немесе 3).
Дәл ${count} сұрақ жаса.`;

      const questions = await callGroq(prompt);
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

МАҢЫЗДЫ ЕРЕЖЕ: Тек таза JSON жауап бер. Ешқандай түсіндірме жазба.

Формат:
{"questions":[{"text":"сұрақ мәтіні","options":["А нұсқа","Б нұсқа","В нұсқа","Г нұсқа"],"correct":0,"explanation":"қысқа түсіндірме"}]}

correct — дұрыс жауаптың индексі (0, 1, 2 немесе 3).
Дәл ${count} сұрақ жаса.`;

      const questions = await callGroq(prompt);
      return res.json({ ok: true, questions });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('AI қате:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};