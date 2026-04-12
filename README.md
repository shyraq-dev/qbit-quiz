# QBit Quiz — Telegram Mini App

> Қазақ тіліндегі интерактивті викторина платформасы. Telegram Mini App ретінде жұмыс істейді, браузер арқылы да қолжетімді.

---

## 🚀 Мүмкіндіктер

### 📝 Тест жүйесі
- **4 тапсырма түрі:** Бір дұрыс жауап / Бірнеше дұрыс / Мәнмәтін негізіндегі / Сәйкестендіру
- **Медиа қолдауы:** URL немесе файлдан сурет жүктеу (base64)
- **Мәнмәтін орналасуы:** Мәтін→Сурет немесе Сурет→Мәтін
- **Жауап саны:** 4 / 5 / 6 нұсқа
- **Таймер:** Сұрақ басына уақыт шектеуі
- **Түсіндірме:** Жауаптан кейін 5 секунд шығады

### 🎮 Ойын режимі (Multiplayer)
- Кодпен қосылатын live ойын
- Хост режимі — жүргізуші жауаптарды көреді, бақылайды
- Realtime scoreboard (Supabase Realtime)
- Пауза / Скип / Жауаптарды көрсету
- Ойын аяқталғанда нәтиже экраны

### 💬 Мессенджер
- Жеке хаттар (Realtime)
- Жауап беру, жөнелту, бекіту, өңдеу, жою
- Онлайн/оффлайн статус, теру индикаторы
- Оқылды белгісі (✔✔)
- Бекітілген хаттар

### 🔔 Хабарландыру жүйесі
- Push notifications
- Тарих режимі (🕐)
- Барлығын оқу батырмасы
- Хабарланды дегеннен кейін жасырылады

### 📤 Экспорт / Импорт
- Telegram sendPoll форматына экспорт
- Барлық тапсырма түрлері қолданылады
- Импорт — кодты қойып тестке айналдыру
- Алдын ала қарау + өңдеу режимі

### 👤 Бейін
- Аватар эмодзи, аты, @юзернейм
- Туған күн, өзі жайлы ақпарат
- Статистика (ойын саны, үздік нәтиже)

### 🔐 Аутентификация
- **Telegram WebApp** — автоматты авторизация
- **Браузер** — тіркелу/кіру формасы (SHA-256 хэш)
- Құпиясөзді қалпына келтіру (пайдаланушы аты арқылы)

---

## 🛠 Технологиялар

| Бөлім | Технология |
|-------|-----------|
| Frontend | HTML, CSS, Vanilla JS (бір файл) |
| Backend | Vercel Serverless Functions (Node.js) |
| Database | Supabase (PostgreSQL + Realtime) |
| Auth | Telegram WebApp initData / SHA-256 |
| Deploy | Vercel (авто-деплой GitHub-тан) |

---

## 📁 Жоба құрылымы

```
qbit-quiz/
├── index.html              # Бүкіл фронтенд (~4600 жол)
├── sw.js                   # Service Worker (push notifications)
├── vercel.json             # Vercel конфигурациясы (cron)
├── package.json
└── api/
    ├── admin.js            # Әкімші панелі
    ├── browser-auth.js     # Браузер тіркелу/кіру
    ├── chat.js             # Мессенджер
    ├── config.js           # Конфигурация
    ├── feedback.js         # Кері байланыс
    ├── game.js             # Ойын логикасы
    ├── leaderboard.js      # Рейтинг
    ├── notifications.js    # Хабарландырулар
    ├── notify.js           # Push + апталық cron
    ├── profile.js          # Бейін
    └── save-result.js      # Нәтижені сақтау
```

---

## ⚙️ Орнату

### 1. Supabase кестелері

Supabase Dashboard-та SQL Editor-да іске қосыңыз:

```sql
-- Негізгі кестелер
CREATE TABLE users (
  id bigint PRIMARY KEY,
  first_name text, username text, app_username text,
  avatar text DEFAULT '🐱', bio text,
  birthday_day int, birthday_month int, birthday_year int,
  total_games int DEFAULT 0, best_score int DEFAULT 0,
  chat_id bigint, created_at timestamptz DEFAULT now(),
  -- Браузер қолданушылары
  password_hash text, is_browser_user boolean DEFAULT false,
  browser_username text UNIQUE
);

CREATE TABLE quizzes (
  id text PRIMARY KEY, title text, category text DEFAULT 'Жалпы',
  difficulty text DEFAULT 'medium', timer int DEFAULT 20,
  questions jsonb DEFAULT '[]', answerCount int DEFAULT 4,
  created_by bigint, data jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE results (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id bigint, quiz_id text, score int,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE game_sessions (
  id text PRIMARY KEY, quiz_id text, quiz_data jsonb,
  host_id bigint, status text DEFAULT 'waiting',
  current_question int DEFAULT 0, show_answers boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE game_players (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id text, user_id bigint, username text, first_name text,
  score int DEFAULT 0, avatar text
);

CREATE TABLE game_answers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id text, user_id bigint, question_idx int,
  answer_idx int, is_correct boolean, time_ms int, points int DEFAULT 0
);

CREATE TABLE notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id bigint, type text, title text, body text,
  data jsonb DEFAULT '{}', is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE chat_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  from_user_id bigint, to_user_id bigint, text text,
  reply_to_id uuid, reply_to_text text,
  edited_text text, is_edited boolean DEFAULT false,
  deleted_for jsonb DEFAULT '[]',
  is_read boolean DEFAULT false, is_delivered boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE feedback (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id bigint, first_name text, username text,
  message text, reply text, is_read_by_user boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE categories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text UNIQUE, emoji text
);
```

### 2. Vercel Environment Variables

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
BOT_TOKEN=1234567890:ABC...
ADMIN_ID=123456789
CRON_SECRET=кездейсоқ_құпия_сөз
```

### 3. Deploy

```bash
git clone https://github.com/shyraq-dev/qbit-quiz
cd qbit-quiz
# Vercel-ге байланыстырып, env variables орнатыңыз
vercel --prod
```

---

## 🔄 Aпталық cron

`/api/notify` — дүйсенбі сайын 10:00 UTC-та апталық рейтинг жібереді.

`vercel.json`-да конфигурацияланған:
```json
{
  "crons": [{ "path": "/api/notify", "schedule": "0 10 * * 1" }]
}
```

---

## 📊 Деректер базасы схемасы

```
users ──── results ──── quizzes
  │                        │
  ├── game_players ─── game_sessions
  │       │
  │   game_answers
  │
  ├── notifications
  ├── chat_messages
  └── feedback
```

---

## 👤 Автор

**Shyraq** — [@shyraq-dev](https://github.com/shyraq-dev)

Жоба: [QBit Quiz Bot](https://t.me/QBitQuizBot)
