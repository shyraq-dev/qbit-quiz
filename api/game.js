const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

function verifyTelegram(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');

    const arr = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    const dataStr = arr.map(([k, v]) => `${k}=${v}`).join('\n');

    const secret = crypto
      .createHmac('sha256', 'WebAppData')
      .update(process.env.BOT_TOKEN)
      .digest();

    const computed = crypto
      .createHmac('sha256', secret)
      .update(dataStr)
      .digest('hex');

    return computed === hash;
  } catch {
    return false;
  }
}

function getUser(initData) {
  const params = new URLSearchParams(initData);
  return JSON.parse(params.get('user') || '{}');
}

function genCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
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

  const user = getUser(initData);

  try {

    // ───────── CREATE GAME ─────────
    if (action === 'create') {

      const { quizData } = payload;
      const code = genCode();

      const { data, error } = await supabase
        .from('game_sessions')
        .insert({
          id: code,
          quiz_id: quizData.id,
          quiz_data: quizData,
          host_id: user.id,
          status: 'waiting',
          current_question: 0,
          show_answers: false
        })
        .select()
        .single();

      if (error) throw error;

      await supabase.from('game_players').insert({
        session_id: code,
        user_id: user.id,
        username: user.username || null,
        first_name: user.first_name || 'Хост',
        score: 0
      });

      return res.json({ ok: true, code, session: data });
    }

    // ───────── JOIN GAME ─────────
    if (action === 'join') {

      const { code } = payload;

      const { data: session } = await supabase
        .from('game_sessions')
        .select('*')
        .eq('id', code.toUpperCase())
        .single();

      if (!session)
        return res.json({ ok: false, error: 'Ойын табылмады' });

      if (session.status !== 'waiting')
        return res.json({ ok: false, error: 'Ойын басталып кеткен' });

      await supabase.from('game_players').upsert({
        session_id: session.id,
        user_id: user.id,
        username: user.username || null,
        first_name: user.first_name || 'Ойыншы',
        score: 0
      }, { onConflict: 'session_id,user_id' });

      return res.json({ ok: true, session });
    }

    // ───────── START GAME ─────────
    if (action === 'start') {

      const { code } = payload;

      const { data: session } = await supabase
        .from('game_sessions')
        .select('*')
        .eq('id', code)
        .single();

      if (!session)
        return res.json({ ok: false, error: 'Ойын табылмады' });

      if (session.host_id !== user.id)
        return res.json({ ok: false, error: 'Тек хост бастайды' });

      await supabase.from('game_sessions')
        .update({
          status: 'playing',
          current_question: 0,
          show_answers: false
        })
        .eq('id', code);

      return res.json({ ok: true });
    }

    // ───────── REVEAL ANSWERS ─────────
    if (action === 'reveal_answers') {

      const { code } = payload;

      const { data: session } = await supabase
        .from('game_sessions')
        .select('*')
        .eq('id', code)
        .single();

      if (!session || session.host_id !== user.id)
        return res.json({ ok: false, error: 'Рұқсат жоқ' });

      await supabase
        .from('game_sessions')
        .update({ show_answers: true })
        .eq('id', code);

      return res.json({ ok: true });
    }

    // ───────── NEXT QUESTION ─────────
    if (action === 'next_question') {

      const { code } = payload;

      const { data: session } = await supabase
        .from('game_sessions')
        .select('*')
        .eq('id', code)
        .single();

      if (!session || session.host_id !== user.id)
        return res.json({ ok: false, error: 'Рұқсат жоқ' });

      const nextIdx = session.current_question + 1;

      if (nextIdx >= session.quiz_data.questions.length) {

        await supabase.from('game_sessions')
          .update({
            status: 'finished',
            show_answers: false
          })
          .eq('id', code);

        return res.json({ ok: true, finished: true });
      }

      await supabase.from('game_sessions')
        .update({
          current_question: nextIdx,
          show_answers: false
        })
        .eq('id', code);

      return res.json({ ok: true, questionIdx: nextIdx });
    }

    // ───────── ANSWER ─────────
    if (action === 'answer') {

      const { code, questionIdx, answerIdx, timeMs } = payload;

      const { data: session } = await supabase
        .from('game_sessions')
        .select('*')
        .eq('id', code)
        .single();

      if (!session)
        return res.json({ ok: false, error: 'Ойын табылмады' });

      if (questionIdx !== session.current_question)
        return res.json({ ok: false, error: 'expired question' });

      const q = session.quiz_data?.questions?.[questionIdx];

      if (!q)
        return res.json({ ok: false, error: 'invalid question' });

      // duplicate answer check
      const { data: existing } = await supabase
        .from('game_answers')
        .select('id')
        .eq('session_id', code)
        .eq('user_id', user.id)
        .eq('question_idx', questionIdx)
        .maybeSingle();

      if (existing)
        return res.json({ ok: false, error: 'already answered' });

      const isCorrect = answerIdx === q.correct;

      const timer = session.quiz_data.timer || 20;
      const timeFraction = Math.max(0, 1 - timeMs / (timer * 1000));
      const points = isCorrect ? Math.round(500 + 500 * timeFraction) : 0;

      const { error } = await supabase
        .from('game_answers')
        .insert({
          session_id: code,
          user_id: user.id,
          question_idx: questionIdx,
          answer_idx: answerIdx,
          is_correct: isCorrect,
          time_ms: timeMs,
          points
        });

      if (error) throw error;

      if (isCorrect) {

        const { data: player } = await supabase
          .from('game_players')
          .select('score')
          .eq('session_id', code)
          .eq('user_id', user.id)
          .single();

        await supabase
          .from('game_players')
          .update({
            score: (player?.score || 0) + points
          })
          .eq('session_id', code)
          .eq('user_id', user.id);
      }

      return res.json({ ok: true, isCorrect, points });
    }

    // ───────── SCOREBOARD ─────────
    if (action === 'scoreboard') {

      const { code } = payload;

      const { data: players } = await supabase
        .from('game_players')
        .select('*')
        .eq('session_id', code)
        .order('score', { ascending: false });

      const { data: session } = await supabase
        .from('game_sessions')
        .select('*')
        .eq('id', code)
        .single();

      return res.json({
        ok: true,
        players: players || [],
        session
      });
    }

    // ───────── SESSION ─────────
    if (action === 'session') {

      const { code } = payload;

      const { data: session } = await supabase
        .from('game_sessions')
        .select('*')
        .eq('id', code)
        .single();

      const { data: players } = await supabase
        .from('game_players')
        .select('*')
        .eq('session_id', code)
        .order('score', { ascending: false });

      return res.json({
        ok: true,
        session,
        players: players || []
      });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }

};