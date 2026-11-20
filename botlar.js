/* "🛡 Botlar": Claude Asadbek boshqa botlarning admini - holati (ishlayaptimi), oxirgi ishlari (log), boshqarish.
Telegram bir botga boshqa bot chatini o'qishga ruxsat bermaydi, shuning uchun botlar ular ishlayotgan joy orqali boshqariladi:
  server  - shu Hetzner serverdagi systemd xizmati (systemctl / journalctl). Qayta ishga tushirish/to'xtatish
            uchun bot root bo'lmasa sudo ruxsati kerak: deploy/botlar-ruxsat.sh (bir marta, root sifatida).
  kompyuter - ofis kompyuteridagi dastur; kompyuterdagi kuzatuvchi (hooks/claude_telegram.py kuzat) har 30 s
            holat yuboradi (holat.botlar) va buyruqlarni /vs-kut kanalidan oladi (claude-sessiya.js).
Bot to'xtab qolsa yoki qayta ishlasa - o'zi xabar beradi. */
const { execFile } = require('child_process');
const tg = require('./telegram-api');

const BOTLAR = [
  { id: 'avtobot', nomi: 'Avtobot', joy: 'server', unitlar: ['avtobot'] },
  { id: 'gps', nomi: 'GPS_Nazoratbot', joy: 'server', unitlar: ['gps-nazorat'] },
  { id: 'bazis', nomi: 'BazisUstaAIBot', joy: 'server', unitlar: ['bazis-usta', 'bazis-usta-bot', 'bazisusta'] },
  { id: 'jarvis', nomi: 'JarvisAsadbekBot', joy: 'kompyuter' },
  { id: 'pult', nomi: 'Control Pult', joy: 'noma\'lum' },
  { id: 'pultcam', nomi: 'Pultcam', joy: 'noma\'lum' },
];

let CHAT_ID = null;
const unitKesh = {}; // bot id -> topilgan systemd unit nomi
const oxirgiHolat = {}; // bot id -> true/false (o'zgarsa xabar beriladi)
let kompyuterBotlar = {}; // kuzatuvchidan: {jarvis: {ishlayapti, log}}
let kompyuterVaqt = 0;
let buyruqYuboruvchi = null; // claude-sessiya.kuzatuvchigaBuyruq

function ishga(cmd, args, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || (err && err.message) || '').trim() });
    });
  });
}

async function unit(b) {
  if (unitKesh[b.id]) return unitKesh[b.id];
  for (const u of b.unitlar) {
    const r = await ishga('systemctl', ['show', u, '-p', 'LoadState', '--value']);
    if (r.ok && r.out === 'loaded') { unitKesh[b.id] = u; return u; }
  }
  return null;
}

async function serverHolat(b) {
  const u = await unit(b);
  if (!u) return { ishlayapti: null, izoh: 'serverda xizmati topilmadi' };
  const a = await ishga('systemctl', ['is-active', u]);
  const t = await ishga('systemctl', ['show', u, '-p', 'ActiveEnterTimestamp', '--value']);
  return { ishlayapti: a.out === 'active', izoh: a.out, qachondan: t.out };
}

async function holat(b) {
  if (b.joy === 'server') return serverHolat(b);
  if (b.joy === 'kompyuter') {
    if (!kompyuterVaqt || Date.now() - kompyuterVaqt > 3 * 60 * 1000) return { ishlayapti: null, izoh: "kompyuter bilan aloqa yo'q" };
    const k = kompyuterBotlar[b.id] || {};
    return { ishlayapti: !!k.ishlayapti, izoh: k.ishlayapti ? 'ishlayapti' : "to'xtagan" };
  }
  return { ishlayapti: null, izoh: 'qayerda ishlashi aniqlanmagan' };
}

function belgi(h) {
  return h.ishlayapti === true ? '🟢' : h.ishlayapti === false ? '🔴' : '⚪';
}

async function royxatMatni() {
  let m = '🛡 Botlar\n';
  for (const b of BOTLAR) {
    const h = await holat(b);
    m += `\n${belgi(h)} ${b.nomi} — ${h.izoh}${h.qachondan ? `\n      ${h.qachondan} dan beri` : ''}`;
  }
  m += "\n\n👇 Botni tanlang: oxirgi ishlari va boshqarish.";
  return m;
}

function royxatTugmalari() {
  const q = BOTLAR.map((b) => [{ text: b.nomi, callback_data: `bt:k:${b.id}` }]);
  q.push([{ text: '🔄 Yangilash', callback_data: 'bt:r' }]);
  return { inline_keyboard: q };
}

async function kartaMatni(b) {
  const h = await holat(b);
  let m = `${belgi(h)} ${b.nomi}\n📍 ${b.joy === 'server' ? 'Hetzner serveri' : b.joy === 'kompyuter' ? 'ofis kompyuteri' : 'aniqlanmagan'} · ${h.izoh}`;
  if (h.qachondan) m += `\n⏱ ${h.qachondan} dan beri`;
  let log = '';
  if (b.joy === 'server' && (await unit(b))) {
    const r = await ishga('journalctl', ['-u', await unit(b), '-n', '15', '--no-pager', '-o', 'short-iso']);
    log = r.ok ? r.out : `(log o'qilmadi: ${r.err.slice(0, 200)})`;
  } else if (b.joy === 'kompyuter') {
    log = (kompyuterBotlar[b.id] || {}).log || '';
  } else {
    m += "\n\nBu bot qaysi kompyuter/serverda ishlashini ayting — keyin uni ham ulayman.";
  }
  if (log) {
    const qisqa = log.length > 2500 ? '…' + log.slice(-2500) : log;
    m += `\n\n📜 Oxirgi ishlari:\n${qisqa}`;
  }
  return m;
}

function kartaTugmalari(b) {
  const q = [];
  if (b.joy === 'server' || b.joy === 'kompyuter') {
    q.push([
      { text: '♻️ Qayta ishga tushirish', callback_data: `bt:a:${b.id}:restart` },
    ]);
    q.push([
      { text: '▶ Yoqish', callback_data: `bt:a:${b.id}:start` },
      { text: "⏹ To'xtatish", callback_data: `bt:a:${b.id}:stop?` },
    ]);
  }
  q.push([{ text: '🔄 Yangilash', callback_data: `bt:k:${b.id}` }, { text: "⬅️ Ro'yxat", callback_data: 'bt:r' }]);
  return { inline_keyboard: q };
}

async function serverAmal(b, amal) {
  const u = await unit(b);
  if (!u) return { ok: false, xato: 'xizmat topilmadi' };
  const root = typeof process.getuid === 'function' && process.getuid() === 0;
  const r = root ? await ishga('systemctl', [amal, u], 60000) : await ishga('sudo', ['-n', 'systemctl', amal, u], 60000);
  if (r.ok) return { ok: true };
  const ruxsat = /password|sudo|not allowed|authentication|Access denied|Interactive/i.test(r.err);
  return { ok: false, xato: ruxsat ? "serverda ruxsat yo'q — deploy/botlar-ruxsat.sh ni bir marta root sifatida ishga tushirish kerak" : r.err.slice(0, 300) };
}

async function amalBajar(b, amal, chatId, msgId) {
  const nomlar = { restart: 'qayta ishga tushirilmoqda', start: 'yoqilmoqda', stop: "to'xtatilmoqda" };
  await tg.editMessageText(chatId, msgId, `⏳ ${b.nomi} ${nomlar[amal]}...`);
  let r;
  if (b.joy === 'server') {
    r = await serverAmal(b, amal);
  } else if (b.joy === 'kompyuter' && buyruqYuboruvchi) {
    r = await buyruqYuboruvchi({ amal: 'bot', nom: b.id, qil: amal }, 90000);
  } else {
    r = { ok: false, xato: 'bu botni boshqarib bo\'lmaydi' };
  }
  if (b.joy === 'server') await new Promise((ok) => setTimeout(ok, 3000));
  const bosh = r && r.ok ? `✅ ${b.nomi}: bajarildi.` : `⚠️ ${b.nomi}: ${(r && r.xato) || 'javob kelmadi'}`;
  if (r && r.ok) guruhga(`🛡 ${b.nomi} ${{ restart: 'qayta ishga tushirildi ♻️', start: 'yoqildi ▶', stop: "to'xtatildi ⏹" }[amal]} (admin buyrug'i bilan).`);
  await tg.editMessageText(chatId, msgId, `${bosh}\n\n${await kartaMatni(b)}`, { reply_markup: kartaTugmalari(b) });
}

async function handleText(chatId, text) {
  if (text !== '🛡 Botlar') return false;
  await tg.sendMessage(chatId, await royxatMatni(), { reply_markup: royxatTugmalari() });
  return true;
}

async function handleCallback(cq) {
  const data = cq.data || '';
  if (!data.startsWith('bt:')) return false;
  const chatId = cq.message.chat.id;
  const msgId = cq.message.message_id;
  const [, tur, id, amal] = data.split(':');
  await tg.answerCallbackQuery(cq.id);
  if (tur === 'r') {
    await tg.editMessageText(chatId, msgId, await royxatMatni(), { reply_markup: royxatTugmalari() });
    return true;
  }
  const b = BOTLAR.find((x) => x.id === id);
  if (!b) return true;
  if (tur === 'k') {
    await tg.editMessageText(chatId, msgId, await kartaMatni(b), { reply_markup: kartaTugmalari(b) });
  } else if (tur === 'a' && amal === 'stop?') {
    await tg.editMessageText(chatId, msgId, `⏹ ${b.nomi} to'xtatilsinmi? To'xtatilsa, u foydalanuvchilarga javob bermaydi.`, {
      reply_markup: { inline_keyboard: [[{ text: "⏹ Ha, to'xtatish", callback_data: `bt:a:${b.id}:stop` }, { text: "Yo'q", callback_data: `bt:k:${b.id}` }]] },
    });
  } else if (tur === 'a' && ['restart', 'start', 'stop'].includes(amal)) {
    await amalBajar(b, amal, chatId, msgId);
  }
  return true;
}

// kuzatuvchidan (holat.botlar): {jarvis: {ishlayapti, log}}
function kompyuterdanKeldi(botlar) {
  if (!botlar || typeof botlar !== 'object') return;
  kompyuterBotlar = {};
  for (const b of BOTLAR.filter((x) => x.joy === 'kompyuter')) {
    const k = botlar[b.id];
    if (k && typeof k === 'object') kompyuterBotlar[b.id] = { ishlayapti: !!k.ishlayapti, log: String(k.log || '').slice(-4000) };
  }
  kompyuterVaqt = Date.now();
}

// Har 2 daqiqa: bot to'xtasa yoki qayta ishlasa - bir marta xabar
async function tekshir() {
  for (const b of BOTLAR) {
    if (b.joy !== 'server' && b.joy !== 'kompyuter') continue;
    const h = await holat(b);
    if (h.ishlayapti === null) continue;
    if (oxirgiHolat[b.id] !== undefined && oxirgiHolat[b.id] !== h.ishlayapti) {
      guruhga(h.ishlayapti ? `🟢 ${b.nomi} qayta ishlayapti.` : `🔴 ${b.nomi} to'xtab qoldi (${h.izoh}).`);
      await tg.sendMessage(CHAT_ID, h.ishlayapti
        ? `🟢 ${b.nomi} qayta ishlayapti.`
        : `🔴 ${b.nomi} TO'XTAB QOLDI (${h.izoh}).`, {
        reply_markup: { inline_keyboard: [[{ text: `🛡 ${b.nomi} — ko'rish`, callback_data: `bt:k:${b.id}` }]] },
      });
    }
    oxirgiHolat[b.id] = h.ishlayapti;
  }
}

// ---------------------------------------------------------------- Botlar guruhi: umumiy holat taxtasi
// Telegram'da botlar bir-birining xabarini ko'rmaydi, shuning uchun guruh - odamlar uchun taxta:
// to'xtash/qayta ishlash, admin buyruqlari va har kuni 09:00 dagi umumiy holat shu yerga yoziladi.
// Ulash: guruhga egasi /botlar_guruhi yozadi.
// Guruhda /botlar - hozirgi holat.
const fs = require('fs');
const path = require('path');

const GURUH_FAYL = path.join(__dirname, 'data', 'botlar-guruh.json');
let guruhId = null;
try { guruhId = JSON.parse(fs.readFileSync(GURUH_FAYL, 'utf8')).id || null; } catch {}

function guruhga(matn) {
  if (guruhId) tg.sendMessage(guruhId, matn).catch(() => {});
}

async function guruhHolati() {
  return (await royxatMatni()).replace("\n\n👇 Botni tanlang: oxirgi ishlari va boshqarish.", '');
}

async function handleGroupMessage(message) {
  const text = String(message.text || '').trim();
  const egasi = String(message.from && message.from.id) === String(CHAT_ID);
  const id = String(message.chat.id);
  const buyruq = text.split(/[\s@]/)[0];
  // faqat buyruq bilan: bot moderatsiya qiladigan guruhlarda egasining oddiy xabari taxtani adashtirmasin
  if (egasi && buyruq === '/botlar_guruhi') {
    guruhId = id;
    fs.mkdirSync(path.dirname(GURUH_FAYL), { recursive: true });
    fs.writeFileSync(GURUH_FAYL, JSON.stringify({ id, nomi: message.chat.title || '' }));
    await tg.sendMessage(id, `✅ Bu guruh botlar taxtasi qilib ulandi.\nBot to'xtasa/qayta ishlasa, admin buyruqlari va har kuni 09:00 da umumiy holat shu yerga yoziladi. Holatni ko'rish: /botlar\n\n${await guruhHolati()}`);
    await tg.sendMessage(CHAT_ID, `✅ «${message.chat.title || 'guruh'}» botlar taxtasi sifatida ulandi.`);
    return true;
  }
  if (id === guruhId && buyruq === '/botlar') {
    await tg.sendMessage(id, await guruhHolati());
    return true;
  }
  return false;
}

let oxirgiErtalab = '';
async function ertalabkiHisobot() {
  if (!guruhId) return;
  const t = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', hour12: false });
  const kun = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
  if (t < '09:00' || t > '09:10' || oxirgiErtalab === kun) return;
  oxirgiErtalab = kun;
  await tg.sendMessage(guruhId, `☀️ Xayrli tong! Botlar holati:\n${(await guruhHolati()).replace('🛡 Botlar\n', '')}`);
}

function start(chatId, buyruqFn) {
  CHAT_ID = chatId;
  buyruqYuboruvchi = buyruqFn;
  setTimeout(() => {
    tekshir().catch(() => {});
    setInterval(() => {
      tekshir().catch((e) => console.error('botlar tekshir:', e.message));
      ertalabkiHisobot().catch((e) => console.error('botlar ertalab:', e.message));
    }, 2 * 60 * 1000);
  }, 90 * 1000);
}

module.exports = { handleText, handleCallback, handleGroupMessage, kompyuterdanKeldi, start };
