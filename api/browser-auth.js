const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + process.env.BOT_TOKEN).digest('hex');
}

function generateInitData(user) {
  const userData = JSON.stringify({ id: user.id, first_name: user.first_name, username: user.browser_username||'', is_bot: false });
  const dataStr = `user=${userData}&auth_date=${Math.floor(Date.now()/1000)}`;
  const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  const hash = crypto.createHmac('sha256', secret).update(dataStr).digest('hex');
  return dataStr + '&hash=' + hash;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { action, username, password, firstName, appUsername, birthday_day, birthday_month, birthday_year, bio, avatar } = req.body || {};
  try {
    if (action === 'register') {
      if (!username || username.trim().length < 3) return res.json({ ok: false, error: 'Пайдаланушы аты кем дегенде 3 таңба' });
      if (!password || password.length < 6) return res.json({ ok: false, error: 'Құпиясөз кем дегенде 6 таңба' });
      const { data: existing } = await supabase.from('users').select('id').eq('browser_username', username.trim().toLowerCase()).single();
      if (existing) return res.json({ ok: false, error: 'Бұл пайдаланушы аты бос емес' });
      const browserId = Math.floor(Math.random() * 900000000) + 8000000000; // 8B+ range, Telegram ID-мен қабыспайды
      const { data: newUser, error } = await supabase.from('users').insert({
        id: browserId,
        first_name: firstName?.trim() || username.trim(),
        browser_username: username.trim().toLowerCase(),
        app_username: appUsername?.trim().toLowerCase() || null,
        password_hash: hashPassword(password),
        is_browser_user: true,
        avatar: avatar || '🐱',
        bio: bio?.trim() || null,
        birthday_day: birthday_day || null,
        birthday_month: birthday_month || null,
        birthday_year: birthday_year || null,
      }).select().single();
      if (error) throw error;
      return res.json({ ok: true, initData: generateInitData(newUser), user: { id: newUser.id, first_name: newUser.first_name, browser_username: newUser.browser_username } });
    }
    if (action === 'login') {
      if (!username || !password) return res.json({ ok: false, error: 'Толтырыңыз' });
      const { data: user } = await supabase.from('users').select('*').eq('browser_username', username.trim().toLowerCase()).eq('password_hash', hashPassword(password)).single();
      if (!user) return res.json({ ok: false, error: 'Пайдаланушы аты немесе құпиясөз қате' });
      return res.json({ ok: true, initData: generateInitData(user), user: { id: user.id, first_name: user.first_name, browser_username: user.browser_username } });
    }
    if (action === 'reset_password') {
      const { newPassword } = req.body || {};
      if (!username || !newPassword || newPassword.length < 6)
        return res.json({ ok: false, error: 'Деректер жеткіліксіз' });
      const { data: existing } = await supabase.from('users')
        .select('id').eq('browser_username', username.trim().toLowerCase()).single();
      if (!existing) return res.json({ ok: false, error: 'Пайдаланушы табылмады' });
      await supabase.from('users')
        .update({ password_hash: hashPassword(newPassword) })
        .eq('browser_username', username.trim().toLowerCase());
      return res.json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch(e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
