const crypto = require('crypto');

/**
 * Telegram Widget redirect callback.
 * Пайдаланушы нөмірін растағаннан кейін Telegram осы URL-ге redirect жасайды.
 * URL параметрлерінде user деректері болады.
 * Верификациялап, sessionStorage-қа жазып, негізгі бетке redirect жасаймыз.
 */

function verifyTelegramWidget(data) {
  const { hash, ...rest } = data;
  if (!hash) return false;

  const checkArr = Object.keys(rest).sort().map(k => `${k}=${rest[k]}`);
  const checkString = checkArr.join('\n');

  const secretKey = crypto.createHash('sha256')
    .update(process.env.BOT_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secretKey)
    .update(checkString).digest('hex');

  if (computedHash !== hash) return false;

  const authDate = parseInt(rest.auth_date || '0', 10);
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > 86400) return false; // 24 сағат

  return true;
}

function buildInitData(userData) {
  const user = {
    id: userData.id,
    first_name: userData.first_name || '',
    last_name: userData.last_name || '',
    username: userData.username || '',
    photo_url: userData.photo_url || '',
    auth_date: userData.auth_date,
  };

  const params = new URLSearchParams();
  params.set('user', JSON.stringify(user));
  params.set('auth_date', String(userData.auth_date));
  params.set('auth_source', 'widget');

  const arr = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataStr = arr.map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData')
    .update(process.env.BOT_TOKEN).digest();
  const hash = crypto.createHmac('sha256', secretKey)
    .update(dataStr).digest('hex');
  params.set('hash', hash);

  return params.toString();
}

module.exports = (req, res) => {
  // Telegram GET параметрлерін алу
  const { hash, id, first_name, last_name, username, photo_url, auth_date } = req.query;

  if (!hash || !id) {
    return res.status(400).send('Деректер жоқ');
  }

  const telegramData = { hash, id, first_name, last_name, username, photo_url, auth_date };

  // Верификация
  if (!verifyTelegramWidget(telegramData)) {
    return res.status(401).send('Деректер расталмады');
  }

  // initData жасау
  const initData = buildInitData(telegramData);

  // Деректерді sessionStorage-қа жазып, негізгі бетке redirect жасайтын HTML беру
  const sessionData = JSON.stringify({
    id: parseInt(id),
    first_name: first_name || '',
    last_name: last_name || '',
    username: username || '',
    photo_url: photo_url || '',
    auth_date: parseInt(auth_date),
    _initData: initData,
  });

  // XSS қауіпсіздігі үшін JSON-ды escape жасаймыз
  const safeSessionData = sessionData.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Кіру...</title></head>
<body>
<script>
  try {
    sessionStorage.setItem('qbit_tg_user', '${safeSessionData}');
    window.location.replace('/');
  } catch(e) {
    window.location.replace('/');
  }
</script>
<p style="font-family:sans-serif;text-align:center;margin-top:40px">Бетке өту...</p>
</body>
</html>`);
};
