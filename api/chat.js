const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

function verifyTelegramData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash'); params.delete('hash');
    const arr = [...params.entries()].sort(([a],[b])=>a.localeCompare(b));
    const dataStr = arr.map(([k,v])=>`${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256','WebAppData').update(process.env.BOT_TOKEN).digest();
    return crypto.createHmac('sha256',secret).update(dataStr).digest('hex') === hash;
  } catch { return false; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(200).end();
  const { initData, action, text, toUserId, query, userId, messageId, appUsername } = req.body;
  if (!verifyTelegramData(initData)) return res.status(401).json({ ok:false });
  const params = new URLSearchParams(initData);
  const user = JSON.parse(params.get('user'));
  // last_seen жаңарту
  supabase.from('users').update({ last_seen: new Date().toISOString() }).eq('id', user.id).then(()=>{});
  try {
    if (action==='set_username') {
      const uname = appUsername;
      if (!uname||uname.trim().length<3) return res.json({ok:false,error:'Минимум 3 таңба'});
      if (uname.trim().length>20) return res.json({ok:false,error:'Максимум 20 таңба'});
      if (!/^[a-zA-Z0-9_]+$/.test(uname.trim())) return res.json({ok:false,error:'Тек әріп, сан және _'});
      const {data:ex} = await supabase.from('users').select('id').eq('app_username',uname.trim().toLowerCase()).single();
      if (ex&&ex.id!==user.id) return res.json({ok:false,error:'Бұл ат бос емес'});
      await supabase.from('users').update({app_username:uname.trim().toLowerCase()}).eq('id',user.id);
      return res.json({ok:true});
    }
    if (action==='search') {
      if (!query||query.trim().length<2) return res.json({ok:false,error:'Минимум 2 таңба'});
      const q=query.trim().toLowerCase().replace('@','');
      const {data} = await supabase.from('users').select('id,first_name,app_username,avatar,last_seen').ilike('app_username',`${q}%`).neq('id',user.id).limit(10);
      return res.json({ok:true,users:data||[]});
    }
    if (action==='user_profile') {
      if (!userId) return res.json({ok:false,error:'userId керек'});
      const {data} = await supabase.from('users').select('id,first_name,username,app_username,avatar,last_seen,total_games,total_correct,total_questions').eq('id',userId).single();
      return res.json({ok:true,user:data});
    }
    if (action==='conversations') {
      const {data:msgs} = await supabase.from('chat_messages').select('from_user_id,to_user_id,text,created_at,is_read').or(`from_user_id.eq.${user.id},to_user_id.eq.${user.id}`).order('created_at',{ascending:false});
      if (!msgs?.length) return res.json({ok:true,conversations:[]});
      const pm={};
      for (const m of msgs) {
        const pid=m.from_user_id===user.id?m.to_user_id:m.from_user_id;
        if (!pm[pid]) pm[pid]={partner_id:pid,last_message:m.text,last_at:m.created_at,unread:0};
        if (m.to_user_id===user.id&&!m.is_read) pm[pid].unread++;
      }
      const pids=Object.keys(pm).map(Number);
      const {data:partners} = await supabase.from('users').select('id,first_name,app_username,avatar,last_seen').in('id',pids);
      const convs=(partners||[]).map(p=>({...pm[p.id],first_name:p.first_name,app_username:p.app_username,avatar:p.avatar||'🐱',last_seen:p.last_seen})).sort((a,b)=>new Date(b.last_at)-new Date(a.last_at));
      return res.json({ok:true,conversations:convs});
    }
    if (action==='messages') {
      if (!toUserId) return res.json({ok:false,error:'toUserId керек'});
      const {data: allMsgs} = await supabase.from('chat_messages').select('*').or(`and(from_user_id.eq.${user.id},to_user_id.eq.${toUserId}),and(from_user_id.eq.${toUserId},to_user_id.eq.${user.id})`).order('created_at',{ascending:true}).limit(100);
      // Өзі үшін жойылған хаттарды фильтрлеу
      const data = (allMsgs||[]).filter(m => !(m.deleted_for||[]).includes(user.id));
      await supabase.from('chat_messages').update({is_read:true,is_delivered:true}).eq('from_user_id',toUserId).eq('to_user_id',user.id).eq('is_read',false);
      return res.json({ok:true,messages:data||[]});
    }
    if (action==='send') {
      if (!toUserId) return res.json({ok:false,error:'toUserId керек'});
      if (!text||text.trim().length<1) return res.json({ok:false,error:'Бос'});
      const { reply_to_id, reply_to_text } = req.body;
      const {data} = await supabase.from('chat_messages').insert({
        from_user_id:user.id, to_user_id:toUserId, text:text.trim(),
        is_delivered:false, is_read:false,
        reply_to_id: reply_to_id||null, reply_to_text: reply_to_text||null,
      }).select().single();
      return res.json({ok:true,message:data});
    }
    if (action==='mark_read') {
      if (!messageId) return res.json({ok:false});
      await supabase.from('chat_messages').update({is_read:true,is_delivered:true}).eq('id',messageId).eq('to_user_id',user.id);
      return res.json({ok:true});
    }
    if (action==='unread') {
      const {count} = await supabase.from('chat_messages').select('*',{count:'exact',head:true}).eq('to_user_id',user.id).eq('is_read',false);
      return res.json({ok:true,count:count||0});
    }
    // ── Хатты өңдеу ─────────────────────────────────────
    if (action==='edit') {
      const { messageId, newText } = req.body;
      if (!messageId || !newText?.trim()) return res.json({ok:false,error:'Бос'});
      await supabase.from('chat_messages')
        .update({ text: newText.trim(), edited_text: newText.trim(), is_edited: true })
        .eq('id', messageId).eq('from_user_id', user.id);
      return res.json({ok:true});
    }
    // ── Хатты жою (тек өзі үшін) ─────────────────────────
    if (action==='delete_for_me') {
      const { messageId } = req.body;
      const { data: msg } = await supabase.from('chat_messages')
        .select('deleted_for').eq('id', messageId).single();
      const deletedFor = msg?.deleted_for || [];
      if (!deletedFor.includes(user.id)) deletedFor.push(user.id);
      await supabase.from('chat_messages').update({ deleted_for: deletedFor }).eq('id', messageId);
      return res.json({ok:true});
    }
    // ── Хатты жою (екеуі үшін де) ────────────────────────
    if (action==='delete_for_all') {
      const { messageId } = req.body;
      await supabase.from('chat_messages').delete()
        .eq('id', messageId).eq('from_user_id', user.id);
      return res.json({ok:true});
    }
    // ── Чатты бекіту/шешу ────────────────────────────────
    if (action==='pin_conversation') {
      const { partnerId, pin } = req.body;
      await supabase.from('users').update({
        pinned_chat: pin ? partnerId : null
      }).eq('id', user.id);
      return res.json({ok:true});
    }
    return res.status(400).json({ok:false,error:'Unknown action'});
  } catch(e) {
    console.error(e);
    return res.status(500).json({ok:false,error:e.message});
  }
};
