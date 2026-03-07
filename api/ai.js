const https = require('https');
const crypto = require('crypto');

const OYLAN_BASE = 'oylan.nu.edu.kz';

function verifyTelegram(initData) {
  try {
    if (!initData) return false;
    if (!process.env.BOT_TOKEN) return true;
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;
    params.delete('hash');
    const arr = [...params.entries()].sort(([a],[b]) => a.localeCompare(b));
    const dataStr = arr.map(([k,v]) => `${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256','WebAppData').update(process.env.BOT_TOKEN).digest();
    const computed = crypto.createHmac('sha256',secret).update(dataStr).digest('hex');
    return computed === hash;
  } catch { return true; }
}

function httpsRequest(method, path, body, apiKey) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const options = {
      hostname: OYLAN_BASE,
      path,
      method,
      headers: {
        'accept': 'application/json',
        'Authorization': `Api-Key ${apiKey}`,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function createAssistant(apiKey, systemPrompt) {
  const name = `QBit-${Date.now()}`;
  const res = await httpsRequest('POST', '/api/v1/assistant/', {
    name,
    description: 'Викторина сұрақтарын жасайтын ассистент',
    temperature: 0.5,
    max_tokens: 3000,
    model: 'Oylan',
    system_instructions: systemPrompt,
    is_latin: false,
  }, apiKey);

  console.log('Create assistant status:', res.status);
  if (res.status !== 201) throw new Error(`Assistant жасалмады: ${res.body.substring(0, 200)}`);
  return JSON.parse(res.body);
}

async function deleteAssistant(apiKey, assistantId) {
  try {
    await httpsRequest('DELETE', `/api/v1/assistant/${assistantId}/`, null, apiKey);
    console.log('Assistant жойылды:', assistantId);
  } catch(e) {
    console.log('Assistant жою қатесі (елемейміз):', e.message);
  }
}

async function sendInteraction(apiKey, assistantId, userMessage) {
  const res = await httpsRequest('POST', `/api/v1/assistant/${assistantId}/interactions/`, {
    content: userMessage,
  }, apiKey);

  console.log('Interaction status:', res.status);
  if (res.status === 402) throw new Error('Oylan токендері бітті');
  if (res.status !== 201) throw new Error(`Interaction қатесі: ${res.body.substring(0, 300)}`);

  const data = JSON.parse(res.body);
  return data.response?.content || '';
}

function safeParseJSON(text) {
  text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) throw new Error('JSON табылмады');
  text = text.substring(jsonStart, jsonEnd + 1);

  try {
    return JSON.parse(text);
  } catch(e1) {
    try {
      const cleaned = text
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/,\s*]/g, ']')
        .replace(/,\s*}/g, '}');
      return JSON.parse(cleaned);
    } catch(e2) {
      const questions = [];
      const blocks = text.split(/"text"\s*:/);
      for (let i = 1; i < blocks.length; i++) {
        try {
          const block = blocks[i];
          const textMatch = block.match(/^\s*"([^"]+)"/);
          const optionsMatch = block.match(/"options"\s*:\s*\[([^\]]+)\]/);
          const correctMatch = block.match(/"correct"\s*:\s*(\d)/);
          const explMatch = block.match(/"explanation"\s*:\s*"([^"]+)"/);
          if (!textMatch) continue;

          let opts = ['А нұсқа', 'Б нұсқа', 'В нұсқа', 'Г нұсқа'];
          if (optionsMatch) {
            const rawOpts = optionsMatch[1].match(/"([^"]+)"/g);
            if (rawOpts && rawOpts.length >= 2) {
              opts = rawOpts.map(o => o.replace(/"/g, ''));
              while (opts.length < 4) opts.push('—');
            }
          }

          questions.push({
            text: textMatch[1],
            options: opts.slice(0, 4),
            correct: correctMatch ? parseInt(correctMatch[1]) : 0,
            explanation: explMatch ? explMatch[1] : '',
          });
        } catch {}
      }
      if (questions.length > 0) return { questions };
      throw new Error('JSON parse мүмкін болмады: ' + e1.message);
    }
  }
}

async function generateQuestions(apiKey, userPrompt) {
  const systemPrompt = `Сен викторина жасаушысың. Пайдаланушы сұраған тақырып немесе мәтін бойынша сұрақтар жасайсың.
МАҢЫЗДЫ: Әрқашан тек таза JSON форматында жауап бер. Ешқандай түсіндірме немесе қосымша мәтін жазба.
JSON форматы: {"questions":[{"text":"сұрақ","options":["A","B","C","D"],"correct":0,"explanation":"түсіндірме"}]}
correct — дұрыс жауаптың индексі (0, 1, 2 немесе 3).
Барлық мазмұн қазақ тілінде болуы керек.`;

  let assistantId = null;
  try {
    const assistant = await createAssistant(apiKey, systemPrompt);
    assistantId = assistant.id;
    console.log('Assistant ID:', assistantId);

    const responseText = await sendInteraction(apiKey, assistantId, userPrompt);
    console.log('Oylan raw:', responseText.substring(0, 300));

    const parsed = safeParseJSON(responseText);
    if (!parsed.questions || !Array.isArray(parsed.questions)) {
      throw new Error('questions массиві жоқ');
    }
    return parsed.questions;
  } finally {
    if (assistantId) await deleteAssistant(apiKey, assistantId);
  }
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

  const apiKey = process.env.OYLAN_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: 'OYLAN_API_KEY орнатылмаған' });
  }

  try {
    if (action === 'generate_from_topic') {
      const { topic, count = 5, difficulty = 'medium' } = payload;
      const diffMap = {
        easy: 'оңай, мектеп деңгейінде',
        medium: 'орта, университет деңгейінде',
        hard: 'қиын, эксперт деңгейінде',
      };
      const prompt = `Тақырып: "${topic}"
Сұрақ саны: ${count}
Қиындық: ${diffMap[difficulty] || diffMap.medium}

Дәл ${count} сұрақ жаса. Тек JSON:
{"questions":[{"text":"сұрақ","options":["A","B","C","D"],"correct":0,"explanation":"түсіндірме"}]}`;

      const questions = await generateQuestions(apiKey, prompt);
      return res.json({ ok: true, questions });
    }

    if (action === 'generate_from_text') {
      const { text, count = 5, difficulty = 'medium' } = payload;
      const diffMap = { easy: 'оңай', medium: 'орта', hard: 'қиын' };
      const prompt = `Мәтін негізінде ${count} қазақша сұрақ жаса. Қиындық: ${diffMap[difficulty] || 'орта'}.

МӘТІН: ${text.substring(0, 2000)}

Дәл ${count} сұрақ жаса. Тек JSON:
{"questions":[{"text":"сұрақ","options":["A","B","C","D"],"correct":0,"explanation":"түсіндірме"}]}`;

      const questions = await generateQuestions(apiKey, prompt);
      return res.json({ ok: true, questions });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('AI қате:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};