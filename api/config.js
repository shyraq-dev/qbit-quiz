/**
 * Frontend-ке қажетті public конфигурацияны қайтарады.
 * BOT_TOKEN, SUPABASE_SERVICE_KEY сияқты құпия өрістер қайтарылмайды.
 */
module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  return res.json({
    adminId:     process.env.ADMIN_ID || '',
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseKey: process.env.SUPABASE_ANON_KEY || '',
    // Telegram Login Widget үшін бот username (@ белгісінсіз)
    // Мысалы: BOT_USERNAME=QBitQuizBot
    botUsername:   process.env.BOT_USERNAME || '',
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
  });
};

