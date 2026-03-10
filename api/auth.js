const crypto = require('crypto');

/**
 * Telegram Login Widget деректерін верификациялайтын API.
 * Браузерде ашылғанда Widget callback-тен келген userData-ны тексереді.
 * Дұрыс болса — синтетикалық initData қайтарады (profile/save-result үшін).
 */

function verifyTelegramWidget(data) {
  // Telegram Widget деректерін верификациялау
  // https://core.telegram.org/widgets/login#checking-authorization
  const { hash, ...rest } = data;
  if (!hash) return false;

  const checkArr = Object.keys(rest)
    .sort()
    .map(k => `${k}=${rest[k]}`);
  const checkString = checkArr.join('\n');

  // Secret key = SHA256(bot_token)
  const secretKey = crypto.createHash('sha256')
    .update(process.env.BOT_TOKEN)
    .digest();

  const computedHash = crypto.createHmac('sha256', secretKey)
    .update(checkString)
    .digest('hex');

  if (computedHash !== hash) return false;

  // auth_date 1 сағаттан ескі болса — қабылдамаймыз
  const authDate = parseInt(rest.auth_date || '0', 10);
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > 3600) return false;

  return true;
}

function buildInitData(userData) {
  // profile.js / save-result.js / game.js-та verifyTelegramData() пайдаланатын
  // формат: user=...&auth_date=...&hash=...
  // Бірақ browser session үшін бізде тек user деректері бар.
  // Сондықтан сервер тарапта auth.js арқылы расталған session tokenін қайтарамыз.
  // Басқа API-дар бұл tokenді /api/auth арқылы тексереді.

  const user = {
    id: userData.id,
    first_name: userData.first_name || '',
    last_name: userData.last_name || '',
    username: userData.username || '',
    photo_url: userData.photo_url || '',
    auth_date: userData.auth_date,
  };

  // initData форматы: URL-encoded, WebApp initData сияқты
  const params = new URLSearchParams();
  params.set('user', JSON.stringify(user));
  params.set('auth_date', String(userData.auth_date));
  params.set('auth_source', 'widget');

  // HMAC-SHA256 қол қою (game.js / profile.js-тегі verifyTelegramData-мен сәйкес болу үшін)
  const arr = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataStr = arr.map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData')
    .update(process.env.BOT_TOKEN).digest();
  const hash = crypto.createHmac('sha256', secretKey)
    .update(dataStr).digest('hex');
  params.set('hash', hash);

  return params.toString();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { telegramData } = req.body;

  if (!telegramData || typeof telegramData !== 'object') {
    return res.status(400).json({ ok: false, error: 'Деректер жоқ' });
  }

  // Telegram Widget деректерін тексеру
  if (!verifyTelegramWidget(telegramData)) {
    return res.status(401).json({ ok: false, error: 'Деректер расталмады' });
  }

  // Расталды — initData жасап қайтарамыз
  const initData = buildInitData(telegramData);

  return res.json({
    ok: true,
    initData,
    user: {
      id: telegramData.id,
      first_name: telegramData.first_name,
      last_name: telegramData.last_name || '',
      username: telegramData.username || '',
      photo_url: telegramData.photo_url || '',
    },
  });
};
