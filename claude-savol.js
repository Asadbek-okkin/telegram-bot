/* Claude Code (ofis kompyuteridagi VS Code) savollari va ruxsat so'rovlarini Telegram'ga o'tkazish.

Bot Telegram'ni shu serverda tinglaydi, shuning uchun kompyuterdagi hook getUpdates chaqira olmaydi
(409 Conflict). Hook o'rniga shu serverga chiqadi (kompyuter.js bilan bir HTTP server, bir X-Kalit):
  POST /claude-pc/savol   {id, matn, tugmalar:[{t,v}], kop:false, erkin:true}  -> {ok}
  POST /claude-pc/javob   {id}  -> {javob: null | {qiymat, matn}}   (javob bo'lmasa ~25 s ushlab turadi)
  POST /claude-pc/yopildi {id, izoh}  -> xabardagi tugmalar olib tashlanadi (kompyuterda javob berilgan/vaqt tugagan)
Tugma bosilsa -> {qiymat: v}; xabarga matn bilan javob (reply) yoki oxirgi ochiq savolga oddiy matn -> {matn}. */
const tg = require('./telegram-api');

const CHAT_ID = '313364362';
const USHLASH_MS = 25 * 1000;
const ESKIRISH_MS = 3 * 60 * 60 * 1000;
const MAX_MATN = 3500;

const savollar = new Map(); // id -> {id, msgId, matn, tugmalar, kop, erkin, tanlangan:Set, javob, kutuvchilar:Set, vaqt}

function tozala() {
  const chegara = Date.now() - ESKIRISH_MS;
  for (const [id, s] of savollar) if (s.vaqt < chegara) savollar.delete(id);
}

function klaviatura(s) {
  const qatorlar = s.tugmalar.map((b, i) => [{
    text: (s.kop ? (s.tanlangan.has(i) ? '☑️ ' : '⬜ ') : '') + b.t,
    callback_data: `cc:${s.id}:${i}`,
  }]);
  if (s.kop) qatorlar.push([{ text: '✔ Tayyor', callback_data: `cc:${s.id}:ok` }]);
  return { inline_keyboard: qatorlar };
}

function bodyOqi(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 200000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function json(res, kod, obj) {
  if (res.writableEnded) return;
  res.writeHead(kod, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function javobQoy(s, javob) {
  if (s.javob) return false;
  s.javob = javob;
  for (const k of s.kutuvchilar) { clearTimeout(k.timer); json(k.res, 200, { javob }); }
  s.kutuvchilar.clear();
  return true;
}

async function yangiSavol(body) {
  tozala();
  const id = String(body.id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  if (!id) return { ok: false, xato: 'id yo\'q' };
  if (savollar.has(id)) return { ok: true };
  let matn = String(body.matn || '').trim() || '(bo\'sh savol)';
  if (matn.length > MAX_MATN) matn = matn.slice(0, MAX_MATN) + '…';
  const tugmalar = (Array.isArray(body.tugmalar) ? body.tugmalar : [])
    .slice(0, 12)
    .map((b) => ({ t: String(b.t || b.v || '').slice(0, 60), v: String(b.v ?? b.t ?? '') }))
    .filter((b) => b.t);
  const s = {
    id, matn, tugmalar, kop: !!body.kop, erkin: body.erkin !== false,
    tanlangan: new Set(), javob: null, kutuvchilar: new Set(), vaqt: Date.now(), msgId: null,
  };
  savollar.set(id, s);
  const r = await tg.sendMessage(CHAT_ID, matn, tugmalar.length ? { reply_markup: klaviatura(s) } : {});
  if (r && r.ok) s.msgId = r.result.message_id;
  return { ok: !!s.msgId };
}

function javobKut(body, res) {
  const s = savollar.get(String(body.id || ''));
  if (!s) return json(res, 200, { javob: null, yoq: true });
  if (s.javob) return json(res, 200, { javob: s.javob });
  const k = { res, timer: null };
  k.timer = setTimeout(() => { s.kutuvchilar.delete(k); json(res, 200, { javob: null }); }, USHLASH_MS);
  s.kutuvchilar.add(k);
  res.on('close', () => { if (!res.writableEnded) { clearTimeout(k.timer); s.kutuvchilar.delete(k); } });
}

async function yopildi(body) {
  const s = savollar.get(String(body.id || ''));
  if (!s) return;
  savollar.delete(s.id);
  if (s.msgId && !s.javob) {
    const izoh = String(body.izoh || 'kompyuterda hal qilindi');
    await tg.editMessageText(CHAT_ID, s.msgId, `${s.matn}\n\n⌛ ${izoh}`);
  }
}

// kompyuter.js HTTP serveridan chaqiriladi; kalit allaqachon tekshirilgan bo'lishi kerak emas - shu yerda tekshiramiz.
function handleHttp(req, res, kalitTogri) {
  if (req.method !== 'POST') return false;
  const yol = req.url.split('?')[0].replace(/\/+$/, '');
  const amal = ['/savol', '/javob', '/yopildi'].find((a) => yol.endsWith(a));
  if (!amal) return false;
  if (!kalitTogri(req.headers['x-kalit'])) { res.writeHead(403); res.end(); return true; }
  bodyOqi(req).then(async (body) => {
    try {
      if (amal === '/savol') return json(res, 200, await yangiSavol(body));
      if (amal === '/javob') return javobKut(body, res);
      await yopildi(body);
      return json(res, 200, { ok: true });
    } catch (e) {
      console.error('claude-savol:', e.message);
      return json(res, 500, { ok: false });
    }
  });
  return true;
}

async function handleCallback(cq) {
  const data = cq.data || '';
  if (!data.startsWith('cc:')) return false;
  const [, id, tanlov] = data.split(':');
  const s = savollar.get(id);
  if (!s || s.javob) {
    await tg.answerCallbackQuery(cq.id, { text: 'Bu savol endi faol emas' });
    return true;
  }
  if (s.kop && tanlov !== 'ok') {
    const i = parseInt(tanlov, 10);
    if (s.tanlangan.has(i)) s.tanlangan.delete(i); else s.tanlangan.add(i);
    await tg.answerCallbackQuery(cq.id);
    await tg.editMessageText(CHAT_ID, s.msgId, s.matn, { reply_markup: klaviatura(s) });
    return true;
  }
  let qiymat;
  let korinish;
  if (s.kop) {
    const tanlar = [...s.tanlangan].sort((a, b) => a - b).map((i) => s.tugmalar[i]).filter(Boolean);
    qiymat = tanlar.map((b) => b.v);
    korinish = tanlar.map((b) => b.t).join(', ') || '(hech narsa)';
  } else {
    const b = s.tugmalar[parseInt(tanlov, 10)];
    if (!b) { await tg.answerCallbackQuery(cq.id); return true; }
    qiymat = b.v;
    korinish = b.t;
  }
  javobQoy(s, { qiymat });
  await tg.answerCallbackQuery(cq.id, { text: 'Yuborildi' });
  await tg.editMessageText(CHAT_ID, s.msgId, `${s.matn}\n\n✅ Javob: ${korinish}`);
  return true;
}

// Oddiy matn: savol xabariga reply bo'lsa - o'sha savolga; aks holda (tugma matni bo'lmasa) eng oxirgi ochiq savolga.
async function handleMessage(message) {
  const text = (message.text || '').trim();
  if (!text || text.startsWith('/')) return false;
  const ochiq = [...savollar.values()].filter((s) => !s.javob && s.erkin && s.msgId);
  if (!ochiq.length) return false;
  let s = null;
  const replyId = message.reply_to_message && message.reply_to_message.message_id;
  if (replyId) s = ochiq.find((x) => x.msgId === replyId) || null;
  if (!s) {
    if (replyId) return false;
    if (/^\p{Extended_Pictographic}/u.test(text)) return false; // pastki klaviatura tugmalari
    s = ochiq.sort((a, b) => b.vaqt - a.vaqt)[0];
  }
  javobQoy(s, { matn: text });
  await tg.editMessageText(CHAT_ID, s.msgId, `${s.matn}\n\n✅ Javob: ${text}`);
  await tg.sendMessage(CHAT_ID, '✅ Claude\'ga yuborildi', { reply_to_message_id: message.message_id });
  return true;
}

module.exports = { handleHttp, handleCallback, handleMessage };
