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
  console.log('Groq status:', res.status);

  if (res.status !== 200) {
    throw new Error(`Groq HTTP ${res.status}: ${res.body.substring(0, 200)}`);
  }

  const data = JSON.parse(res.body);
  let text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Groq жауап бос');

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

 // if (!verifyTelegram(initData)) {
  //  return res.status(401).json({ error: 'Unauthorized' });
 // }

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ ok: false, error: 'GROQ_API_KEY орнатылмаған' });
  }

  try {

    if (action === 'generate_from_topic') {
      const { topic, count = 5, difficulty = 'medium' } = payload;

      const diffMap = {
        easy: 'оңай, мектеп деңгейінде',
        medium: 'орта, университет деңгейінде',
        hard: 'қиын, эксперт деңгейінде',
      };

      const prompt = `Сен викторина жасаушысың. Тек қазақ тілінде жаз.

Тақырып: "${topic}"
Сұрақ саны: ${count}
Қиындық: ${diffMap[difficulty] || diffMap.medium}

МАҢЫЗДЫ: Тек таза JSON жауап бер. Ешқандай түсіндірме, кіріспе мәтін жазба.

Формат:
{"questions":[{"text":"сұрақ мәтіні","options":["А нұсқа","Б нұсқа","В нұсқа","Г нұсқа"],"correct":0,"explanation":"қысқа түсіндірме"}]}

correct — дұрыс жауаптың индексі (0, 1, 2 немесе 3).
Дәл ${count} сұрақ жаса.`;

      const questions = await callGroq(prompt);
      return res.json({ ok: true, questions });
    }

    if (action === 'generate_from_text') {
      const { text, count = 5, difficulty = 'medium' } = payload;

      const diffMap = {
        easy: 'оңай',
        medium: 'орта',
        hard: 'қиын',
      };

      const prompt = `Сен викторина жасаушысың. Тек қазақ тілінде жаз.

Төмендегі мәтін негізінде ${count} сұрақ жаса.
Қиындық: ${diffMap[difficulty] || 'орта'}.

МӘТІН:
${text.substring(0, 2000)}

МАҢЫЗДЫ: Тек таза JSON жауап бер. Ешқандай түсіндірме жазба.

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
index.html — тек ЖИ КӨМЕКШІ бөлімін ауыстырыңыз, тіл таңдау жоқ:
<!-- ЖИ КӨМЕКШІ -->
<div class="card ai-card">
  <div class="card-title" style="color:#a78bfa">🤖 жи көмекші</div>
  <div style="display:flex;gap:8px;margin-bottom:16px">
    <button class="ai-mode-btn active" id="aiMode-topic" onclick="setAiMode('topic')">💡 Тақырып бойынша</button>
    <button class="ai-mode-btn" id="aiMode-text" onclick="setAiMode('text')">📝 Мәтіннен</button>
  </div>
  <div id="aiTopicPanel">
    <label>Тақырып</label>
    <input type="text" id="aiTopic" placeholder="Мысалы: Қазақстан тарихы, Python негіздері..."/>
    <div style="display:flex;gap:8px">
      <div style="flex:1">
        <label>Сұрақ саны</label>
        <select id="aiCount"><option value="3">3</option><option value="5" selected>5</option><option value="10">10</option><option value="15">15</option></select>
      </div>
      <div style="flex:1">
        <label>Қиындық</label>
        <select id="aiDifficulty"><option value="easy">🟢 Оңай</option><option value="medium" selected>🟡 Орта</option><option value="hard">🔴 Қиын</option></select>
      </div>
    </div>
  </div>
  <div id="aiTextPanel" style="display:none">
    <label>Мәтін енгізіңіз</label>
    <textarea id="aiText" rows="5" placeholder="Кез келген мәтінді қойыңыз — ЖИ сол мәтін негізінде сұрақ жасайды..."></textarea>
    <div style="display:flex;gap:8px">
      <div style="flex:1">
        <label>Сұрақ саны</label>
        <select id="aiCountText"><option value="3">3</option><option value="5" selected>5</option><option value="10">10</option></select>
      </div>
      <div style="flex:1">
        <label>Қиындық</label>
        <select id="aiDifficultyText"><option value="easy">🟢 Оңай</option><option value="medium" selected>🟡 Орта</option><option value="hard">🔴 Қиын</option></select>
      </div>
    </div>
  </div>
  <button class="btn btn-ai" id="aiGenerateBtn" onclick="generateAiQuestions()" style="width:100%;justify-content:center">✨ ЖИ сұрақ жасасын</button>
  <div id="aiResult" style="display:none;margin-top:14px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <span style="font-family:Space Mono,monospace;font-size:11px;color:var(--accent3)">✅ Сұрақтар дайын!</span>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm btn-success" onclick="addAiQuestionsToForm()">➕ Тестке қосу</button>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('aiResult').style.display='none'">✕</button>
      </div>
    </div>
    <div id="aiPreview"></div>
  </div>
</div>