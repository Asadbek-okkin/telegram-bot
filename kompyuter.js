/* "💻 Kompyuter" tugmasi: ofisdagi kompyuter yoniqmi - ko'rish va bot orqali o'chirish.
Kompyuterdagi kompyuter/agent.py o'zi shu botga ulanib turadi (long-poll, tashqaridan kompyuterga kirilmaydi):
  nginx  https://inok.uz/claude-pc/  ->  http://127.0.0.1:8099/   (POST /aloqa, X-Kalit sarlavhasi)
Agent ulanib turgan bo'lsa - kompyuter yoniq; 90 s dan ortiq jim bo'lsa - o'chiq. Yoqilsa/o'chsa bot o'zi xabar beradi.
Sozlash (Hetzner /etc/claude-asadbek-bot.env): PC_KALIT=<kompyuterdagi C:\ProgramData\KompyuterAgent\kalit.txt> */
const http = require('http');
const crypto = require('crypto');
const tg = require('./telegram-api');

const PC_KALIT = process.env.PC_KALIT || '';
const PORT = parseInt(process.env.PC_PORT || '8099', 10);
const TUGMA = '💻 Kompyuter';
const KEYBOARD_ROWS = [[TUGMA]];
const USHLASH_MS = 25 * 1000; // buyruq bo'lmasa agent so'rovi shuncha ushlab turiladi
const OCHIQ_CHEGARA_MS = 90 * 1000; // agent shuncha jim bo'lsa - kompyuter o'chiq
const BUYRUQ_MUDDAT_MS = 60 * 1000;

let CHAT_ID = null;
let pc = null; // agentning oxirgi holati
let oxirgiAloqa = 0;
const kutayotganlar = new Set(); // ushlab turilgan agent so'rovlari: {res, timer}
let navbat = null; // {id, amal, kechikish, chatId, msgId, vaqt}
let oxirgiYoniq = null;

function yoniqmi() {
  return kutayotganlar.size > 0 || Date.now() - oxirgiAloqa < OCHIQ_CHEGARA_MS;
}

function davomiylik(s) {
  const kun = Math.floor(s / 86400);
  const soat = Math.floor((s % 86400) / 3600);
  const daq = Math.floor((s % 3600) / 60);
  return (kun ? `${kun} kun ` : '') + (kun || soat ? `${soat} soat ` : '') + `${daq} daqiqa`;
}

function toshkentVaqti(ms = Date.now()) {
  return new Date(ms).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit' });
}

function yakshanbami() {
  return new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Tashkent', weekday: 'short' }) === 'Sun';
}

function holatMatni() {
  if (!PC_KALIT) return "Kompyuter boshqaruvi sozlanmagan (serverda PC_KALIT yo'q).";
  if (!yoniqmi() || !pc) {
    const oxirgi = oxirgiAloqa ? `\nOxirgi aloqa: ${toshkentVaqti(oxirgiAloqa)}` : '';
    return `🔴 Kompyuter O'CHIQ (yoki internetga ulanmagan).${oxirgi}`;
  }
  // agent so'rovi kelganidan beri o'tgan vaqtni ham qo'shamiz
  const yoniqS = pc.yoniq_s + Math.floor((Date.now() - pc._olingan) / 1000);
  const holatNomi = (h) => (/^(Active|Активно)$/i.test(h) ? 'faol' : /^(Disc|Диск)/i.test(h) ? 'uzilgan' : h);
  const kirgan = (pc.foydalanuvchilar || []).map((f) => `${f.ism} (${holatNomi(f.holat)})`).join(', ');
  let m = `🟢 Kompyuter YONIQ — ${pc.kompyuter}\n`
    + `Yoqilgan: ${pc.boshlangan} (${davomiylik(yoniqS)} oldin)\n`
    + `Windows'ga kirgan: ${kirgan || 'hech kim (kirish oynasida turibdi)'}`;
  if (pc.ochirish) m += `\n\n⏻ O'chirish rejalashtirilgan — ${Math.max(0, pc.ochirish - Math.floor(Date.now() / 1000))} soniyadan keyin.`;
  return m;
}

function holatTugmalari() {
  if (!yoniqmi() || !pc) return { inline_keyboard: [[{ text: '🔄 Qayta tekshirish', callback_data: 'pc:yangila' }]] };
  const qator = pc.ochirish
    ? [{ text: "✖ O'chirishni bekor qilish", callback_data: 'pc:bekor' }]
    : [{ text: "⏻ O'chirish", callback_data: 'pc:ochir?' }];
  return { inline_keyboard: [qator, [{ text: '🔄 Yangilash', callback_data: 'pc:yangila' }]] };
}

// ---------------------------------------------------------------- agent bilan aloqa (HTTP)
function javobBer(k, buyruq) {
  clearTimeout(k.timer);
  kutayotganlar.delete(k);
  try {
    k.res.writeHead(200, { 'Content-Type': 'application/json' });
    k.res.end(JSON.stringify({ buyruq: buyruq || null }));
  } catch {}
}

function buyruqYubor(b) {
  navbat = { ...b, id: crypto.randomBytes(6).toString('hex'), vaqt: Date.now() };
  const k = kutayotganlar.values().next().value;
  if (k) {
    const bn = navbat;
    navbat = null;
    javobBer(k, { id: bn.id, amal: bn.amal, kechikish: bn.kechikish });
    yuborilgan.set(bn.id, bn);
  }
  const id = navbat ? navbat.id : null;
  setTimeout(() => {
    if (navbat && navbat.id === id) {
      const b2 = navbat;
      navbat = null;
      tg.editMessageText(b2.chatId, b2.msgId, "Kompyuter buyruqni qabul qilmadi (aloqa yo'q).", { reply_markup: holatTugmalari() });
    }
  }, BUYRUQ_MUDDAT_MS + 1000);
}

const yuborilgan = new Map(); // id -> buyruq (natija kelganda xabarni yangilash uchun)

async function natijaKeldi(n) {
  const b = yuborilgan.get(n.id);
  if (!b) return;
  yuborilgan.delete(n.id);
  if (b.amal === 'ochir') {
    if (n.ok) {
      await tg.editMessageText(b.chatId, b.msgId, `⏻ Kompyuter ${n.kechikish} soniyadan keyin o'chadi.\nO'chgach bot o'zi xabar beradi.`, {
        reply_markup: { inline_keyboard: [[{ text: '✖ Bekor qilish', callback_data: 'pc:bekor' }]] },
      });
    } else {
      await tg.editMessageText(b.chatId, b.msgId, `O'chirib bo'lmadi: ${n.xato || "noma'lum xato"}`, { reply_markup: holatTugmalari() });
    }
  } else if (b.amal === 'bekor') {
    await tg.editMessageText(b.chatId, b.msgId, (n.ok ? "✖ O'chirish bekor qilindi.\n\n" : `Bekor qilib bo'lmadi: ${n.xato || ''}\n\n`) + holatMatni(), { reply_markup: holatTugmalari() });
  }
}

function kalitTogri(berilgan) {
  const a = Buffer.from(String(berilgan || ''));
  const b = Buffer.from(PC_KALIT);
  return PC_KALIT && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function serverniBoshla() {
  const srv = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.replace(/\/+$/, '').endsWith('/aloqa')) {
      res.writeHead(404); return res.end();
    }
    if (!kalitTogri(req.headers['x-kalit'])) {
      res.writeHead(403); return res.end();
    }
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 100000) req.destroy(); });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(s || '{}'); } catch {}
      if (body.holat) pc = { ...body.holat, _olingan: Date.now() };
      oxirgiAloqa = Date.now();
      if (body.natija) natijaKeldi(body.natija).catch((e) => console.error('kompyuter natija:', e.message));
      // boshqa (eski) ushlab turilgan so'rovlarni bo'shatamiz - bir vaqtda bitta agent so'rovi ushlanadi
      for (const eski of [...kutayotganlar]) javobBer(eski, null);
      const k = { res, timer: null };
      if (navbat) {
        const bn = navbat;
        navbat = null;
        yuborilgan.set(bn.id, bn);
        kutayotganlar.add(k);
        return javobBer(k, { id: bn.id, amal: bn.amal, kechikish: bn.kechikish });
      }
      k.timer = setTimeout(() => { oxirgiAloqa = Date.now(); javobBer(k, null); }, USHLASH_MS);
      kutayotganlar.add(k);
      // agent uzilib qolsa (javob berilmasdan) - ro'yxatdan olib tashlaymiz
      res.on('close', () => { if (!res.writableEnded) { clearTimeout(k.timer); kutayotganlar.delete(k); } });
    });
  });
  srv.on('error', (e) => console.error(`kompyuter server (port ${PORT}):`, e.message));
  srv.listen(PORT, '127.0.0.1', () => console.log(`kompyuter agent serveri: 127.0.0.1:${PORT}`));
}

// ---------------------------------------------------------------- Telegram
async function handleText(chatId, text) {
  if (text !== TUGMA) return false;
  await tg.sendMessage(chatId, holatMatni(), { reply_markup: holatTugmalari() });
  return true;
}

async function handleCallback(cq) {
  const data = cq.data || '';
  if (!data.startsWith('pc:')) return false;
  const chatId = cq.message.chat.id;
  const msgId = cq.message.message_id;
  const tahrir = (matn, tugmalar) => tg.editMessageText(chatId, msgId, matn, tugmalar ? { reply_markup: tugmalar } : {});

  if (data === 'pc:yangila') {
    await tg.answerCallbackQuery(cq.id, { text: yoniqmi() ? 'Yoniq' : "O'chiq" });
    await tahrir(holatMatni(), holatTugmalari());
  } else if (data === 'pc:ochir?') {
    await tg.answerCallbackQuery(cq.id);
    await tahrir("Kompyuter o'chirilsinmi?\nOchiq dasturlardagi saqlanmagan ishlar yo'qoladi.", {
      inline_keyboard: [
        [{ text: '⏻ Ha, 1 daqiqadan keyin', callback_data: 'pc:ochir:60' }, { text: '⏻ Ha, hozir', callback_data: 'pc:ochir:5' }],
        [{ text: "Yo'q", callback_data: 'pc:yangila' }],
      ],
    });
  } else if (data.startsWith('pc:ochir:') || data === 'pc:bekor') {
    if (!yoniqmi()) {
      await tg.answerCallbackQuery(cq.id, { text: "Kompyuter o'chiq" });
      await tahrir(holatMatni(), holatTugmalari());
      return true;
    }
    const amal = data === 'pc:bekor' ? 'bekor' : 'ochir';
    const kechikish = amal === 'ochir' ? parseInt(data.split(':')[2], 10) || 60 : 0;
    await tg.answerCallbackQuery(cq.id, { text: 'Buyruq yuborildi' });
    await tahrir('⏳ Buyruq kompyuterga yuborildi...');
    buyruqYubor({ amal, kechikish, chatId, msgId });
  } else {
    await tg.answerCallbackQuery(cq.id);
  }
  return true;
}

// Har 30 s: yoqildi / o'chdi bo'lsa xabar beradi
async function tekshir() {
  const yoniq = yoniqmi() && !!pc;
  console.log(`[kompyuter] yoniq=${yoniq} oldingi=${oxirgiYoniq} kutayotgan=${kutayotganlar.size} jim=${Math.round((Date.now() - oxirgiAloqa) / 1000)}s`);
  if (oxirgiYoniq !== null && yoniq !== oxirgiYoniq) {
    if (yoniq) {
      const izoh = yakshanbami() ? "\n\nBugun yakshanba — kerak bo'lmasa o'chirib qo'ying." : '';
      await tg.sendMessage(CHAT_ID, `💻 Kompyuter YOQILDI (${toshkentVaqti()}).${izoh}\n\n${holatMatni()}`, { reply_markup: holatTugmalari() });
    } else {
      await tg.sendMessage(CHAT_ID, `🔴 Kompyuter O'CHDI (${toshkentVaqti(oxirgiAloqa)}).`);
    }
  }
  oxirgiYoniq = yoniq;
}

function startKuzatuv(chatId) {
  if (!PC_KALIT) return;
  CHAT_ID = chatId;
  serverniBoshla();
  // bot qayta ishga tushganda agent ~1 daqiqada qayta ulanadi - shu vaqt ichida "o'chdi/yoqildi" deb xato xabar bermaslik uchun
  setTimeout(() => {
    oxirgiYoniq = yoniqmi() && !!pc;
    setInterval(() => tekshir().catch((e) => console.error('kompyuter kuzatuv:', e.message)), 30 * 1000);
  }, OCHIQ_CHEGARA_MS);
}

module.exports = { KEYBOARD_ROWS, handleText, handleCallback, startKuzatuv };
