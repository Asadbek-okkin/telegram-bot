/* 🤝 Botlar jamoasi (ekosistema): Claude Asadbek - boshliq/dispetcher.
Guruhda (botlar.js taxtasi) egasi buyruq beradi: "Vazifa: ...", "Claude, ...", "@claude_asadbek_bot ...", "/v ...".
Telegram'da botlar bir-birining xabarini ko'rmaydi, shuning uchun "suhbat" shu yerda: Claude Asadbek AI bilan
buyruqni qadamlarga bo'ladi, har qadamni o'sha botning AGENT ESHIGIGA beradi (bot natijani guruhga O'Z NOMIDAN
yozadi va Claude'ga qaytaradi), natija keyingi botga kontekst bo'ladi; oxirida Claude natijalarni tekshiradi.

🏛 Majlis: "Claude, majlis" / "/majlis" (yoki har kuni belgilangan soatda): davomat -> to'plangan vazifalar ->
har biri botlarga bo'lib beriladi -> natijalar -> Claude tekshiruvi (✅/⚠️/❌) guruhga va egasiga.
Vazifa qo'shish: guruhda "Majlis: ..." yoki shaxsiy chatda "/majlis_vazifa ...".

➕ Yangi bot ulash (Claude Code'siz): shaxsiy chatda  /bot_qosh nomi | nima ish qiladi | agent eshigi url
  -> kalit beriladi. Botda POST <url> {vazifa, kontekst, guruh} (X-Agent-Kalit sarlavhasi) -> {ok, matn}
  bo'lishi kifoya: tayyor shablon deploy/agent_shablon.py, qo'llanma BOT-ULASH.md. O'chirish: /bot_ochir id */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const tg = require('./telegram-api');
const gemini = require('./gemini-api');
const statistika = require('./statistika');

const FAYL = path.join(__dirname, 'data', 'agentlar.json');
const MAJLIS_FAYL = path.join(__dirname, 'data', 'majlis.json');

const STANDART = {
  claude: { nomi: 'Claude Asadbek', belgi: '🧠', ish: "jamoa boshlig'i: botlar holati, statistika, umumiy savollarga javob, rejalashtirish, xulosa, tekshiruv" },
  avtobot: { nomi: 'Avtobot', belgi: '🚗', ish: "AI yordamchi: savolga javob, post/matn yozish, tarjima, g'oya, tahlil", url: 'http://127.0.0.1:8396/agent' },
  jarvis: { nomi: 'JarvisAsadbekBot', belgi: '🎙', ish: "ofis kompyuteri: ekran rasmi, ekranda nima borligi, o'qilmagan xabarlar, eslatmalar" },
  gps: { nomi: 'GPS_Nazoratbot', belgi: '📍', ish: "GPS kuzatuv: mashinalar, to'lovlar, obunalar" },
  bazis: { nomi: 'BazisUstaAIBot', belgi: '🪚', ish: 'Bazis-Mebelshik: shkaf chizish, kroy, smeta' },
  pult: { nomi: 'Control Pult', belgi: '🎛', ish: 'kompyuter boshqaruv pulti' },
  pultcam: { nomi: 'Pultcam', belgi: '📷', ish: 'kameralar' },
};

function oqiJson(f, standart) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return standart; }
}
function yozJson(f, d) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(d, null, 1));
}

// standart + /bot_qosh bilan qo'shilganlar (fayldagi yozuv standartnikini ustidan yozadi)
function agentlar() {
  const q = oqiJson(FAYL, {});
  const r = {};
  for (const [k, v] of Object.entries(STANDART)) r[k] = { ...v };
  for (const [k, v] of Object.entries(q)) r[k] = { ...(r[k] || { belgi: '🤖' }), ...v };
  return r;
}
function ulanganmi(id, a) {
  return id === 'claude' || !!a.url;
}

function rejaRoli() {
  const A = agentlar();
  return `Sen @claude_asadbek_bot - Telegram botlar jamoasining boshlig'i (dispetcher).
Jamoa:
${Object.entries(A).map(([k, a]) => `- ${k}: ${a.nomi} — ${a.ish}${ulanganmi(k, a) ? '' : ' (HALI ULANMAGAN)'}`).join('\n')}
Foydalanuvchi buyrug'ini qadamlarga bo'l: har qadamni eng mos botga ber. Har bot faqat o'z funksiyasini bajaradi.
HALI ULANMAGAN botga qadam berma - uning ishini claude bajarsin yoki izohda ayt. Oddiy savol bo'lsa bitta claude qadami yetarli.
Faqat JSON qaytar, boshqa hech narsa yozma:
{"qadamlar":[{"bot":"avtobot","vazifa":"..."}],"izoh":"qisqa reja, o'zbekcha"}`;
}

let botUsername = null;
async function username() {
  if (botUsername) return botUsername;
  const r = await tg.apiCall('getMe', {}).catch(() => null);
  botUsername = r && r.ok ? r.result.username : 'claude_asadbek_bot';
  return botUsername;
}

function soRov(url, usul, body, kalit, timeout = 120000) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch { resolve({ ok: false, xato: "url noto'g'ri" }); return; }
    const lib = u.protocol === 'https:' ? https : http;
    const data = body ? JSON.stringify(body) : '';
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
    if (kalit) headers['X-Agent-Kalit'] = kalit;
    const req = lib.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: usul, timeout, headers }, (res) => {
      let s = '';
      res.on('data', (c) => { s += c; });
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch { resolve({ ok: res.statusCode < 300, xato: `javob o'qilmadi (${res.statusCode})` }); } });
    });
    req.on('timeout', () => req.destroy(new Error('vaqt tugadi')));
    req.on('error', (e) => resolve({ ok: false, xato: /ECONNREFUSED/.test(e.message) ? "agent eshigi yopiq (bot yangilanmagan yoki to'xtagan)" : e.message }));
    if (data) req.write(data);
    req.end();
  });
}

function jsonAjrat(matn) {
  const t = String(matn || '').replace(/```(json)?/g, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

const CLAUDE_ROLI = "Sen @claude_asadbek_bot - botlar jamoasi boshlig'isan. O'zbek tilida, aniq va qisqa yoz. Markdown ishlatma, mos joyda emoji qo'y.";

async function claudeQadam(vazifa, kontekst, guruh, qoshimcha) {
  const prompt = `${kontekst ? `Oldingi botlar natijasi:\n${kontekst}\n\n` : ''}${qoshimcha ? `Ma'lumot:\n${qoshimcha}\n\n` : ''}Vazifa: ${vazifa}`;
  const matn = await gemini.chat([{ role: 'user', content: prompt }], CLAUDE_ROLI);
  await tg.sendMessage(guruh, `🧠 ${matn || '…'}`);
  return matn;
}

// Bitta buyruq: reja -> botlar -> natijalar. Qaytaradi {vazifa, natijalar:[{bot, ok, matn}]}
// botlarHolati: botlar.js dan (aylanma require bo'lmasligi uchun parametr)
async function bajar(guruh, buyruq, botlarHolati) {
  const A = agentlar();
  await tg.apiCall('sendChatAction', { chat_id: guruh, action: 'typing' }).catch(() => {});
  const rejaMatn = await gemini.chat([{ role: 'user', content: buyruq }], rejaRoli()).catch((e) => `{"xato":"${e.message}"}`);
  const reja = jsonAjrat(rejaMatn);
  const natijalar = [];
  if (!reja || !Array.isArray(reja.qadamlar) || !reja.qadamlar.length) {
    await tg.sendMessage(guruh, `🤷 Buyruqni rejaga aylantira olmadim.${reja && reja.izoh ? `\n${reja.izoh}` : ''}`);
    return { vazifa: buyruq, natijalar };
  }
  const qadamlar = reja.qadamlar.filter((q) => A[q.bot]).slice(0, 6);
  await tg.sendMessage(guruh, `🧭 Reja${reja.izoh ? `: ${reja.izoh}` : ''}\n\n${qadamlar.map((q, i) => `${i + 1}️⃣ ${A[q.bot].belgi || '🤖'} ${A[q.bot].nomi} — ${q.vazifa}`).join('\n')}`);
  let kontekst = '';
  for (const q of qadamlar) {
    const a = A[q.bot];
    let natija;
    try {
      if (q.bot === 'claude') {
        const qosh = /holat|ishlayapti|to'xta|status|davomat/i.test(q.vazifa) ? await botlarHolati()
          : /statistik|nechta|hisob/i.test(q.vazifa) ? statistika.botlarHisoboti(7) : '';
        natija = { ok: true, matn: await claudeQadam(q.vazifa, kontekst, guruh, qosh) };
      } else if (a.url) {
        await tg.sendMessage(guruh, `📤 ${a.belgi || '🤖'} ${a.nomi}, sizga vazifa: ${q.vazifa}`);
        natija = await soRov(a.url, 'POST', { vazifa: q.vazifa, kontekst, guruh }, a.kalit);
      } else {
        natija = { ok: false, xato: 'hali jamoaga ulanmagan' };
      }
    } catch (e) {
      natija = { ok: false, xato: e.message };
    }
    statistika.qayd(`agent_${q.bot}`);
    natijalar.push({ bot: q.bot, nomi: a.nomi, vazifa: q.vazifa, ok: !!(natija && natija.ok), matn: String((natija && (natija.matn || natija.xato)) || '') });
    if (!natija || !natija.ok) {
      await tg.sendMessage(guruh, `⚠️ ${a.nomi}: ${(natija && natija.xato) || 'bajarilmadi'}`);
      continue;
    }
    if (natija.guruhga === false) await tg.sendMessage(guruh, `${a.nomi} guruhga yoza olmadi (botni guruhga qo'shing). Natijasi:\n${String(natija.matn).slice(0, 3500)}`);
    if (q.bot !== 'claude') await tg.sendMessage(guruh, `📥 ${a.belgi || '🤖'} ${a.nomi} natijani Claude Asadbek'ga topshirdi ✅`);
    kontekst += `\n[${a.nomi}]: ${String(natija.matn || '').slice(0, 2000)}`;
  }
  return { vazifa: buyruq, natijalar };
}

// Claude natijalarni tekshiradi: [{vazifa, natijalar}] -> matn
async function tekshir(ishlar) {
  const material = ishlar.map((x, i) => `${i + 1}. VAZIFA: ${x.vazifa}\n${x.natijalar.map((n) => `  - ${n.nomi} (${n.ok ? 'bajardi' : 'XATO'}): ${n.matn.slice(0, 800)}`).join('\n') || '  (natija yo\'q)'}`).join('\n\n');
  const savol = `Har bir vazifa uchun natijani tekshir va baho ber: ✅ bajarildi / ⚠️ qisman / ❌ bajarilmadi, bir qator izoh bilan. Oxirida 1-2 gaplik umumiy xulosa va keyingi qadam.\n\n${material}`;
  return gemini.chat([{ role: 'user', content: savol }], CLAUDE_ROLI).catch((e) => `Tekshirib bo'lmadi: ${e.message}`);
}

// ---------------------------------------------------------------- 🏛 Majlis
function majlis() {
  return oqiJson(MAJLIS_FAYL, { vazifalar: [], soat: '09:30', oxirgi: '' });
}
function majlisSaqla(d) { yozJson(MAJLIS_FAYL, d); }

function vazifaQosh(matn) {
  const d = majlis();
  d.vazifalar.push({ matn: String(matn).slice(0, 1500), vaqt: Date.now() });
  majlisSaqla(d);
  return d.vazifalar.length;
}

async function davomat() {
  const A = agentlar();
  const qatorlar = [];
  for (const [id, a] of Object.entries(A)) {
    let h;
    if (id === 'claude') h = '🟢 shu yerda (rais)';
    else if (!a.url) h = '⚪ jamoaga hali ulanmagan';
    else {
      const r = await soRov(a.url, 'GET', null, a.kalit, 4000);
      h = r && (r.ok || r.bot) ? '🟢 shu yerda' : `🔴 javob bermadi`;
    }
    qatorlar.push(`${a.belgi || '🤖'} ${a.nomi} — ${h}`);
  }
  return qatorlar.join('\n');
}

let majlisBormi = false;
async function majlisOtkaz(guruh, botlarHolati, kim = 'egasi') {
  if (majlisBormi) { await tg.sendMessage(guruh, '⏳ Majlis allaqachon ketyapti.'); return; }
  majlisBormi = true;
  try {
    const d = majlis();
    const sana = new Date().toLocaleDateString('uz-UZ', { timeZone: 'Asia/Tashkent' });
    await tg.sendMessage(guruh, `🏛━━━━━━━━━━━━━━━━━\n   MAJLIS BOSHLANDI · ${sana}\n━━━━━━━━━━━━━━━━━━🏛\n\n🧠 Claude Asadbek: Assalomu alaykum, jamoa! 👋 Davomat:\n\n${await davomat()}`);
    await tg.sendMessage(guruh, statistika.botlarHisoboti(1));
    if (!d.vazifalar.length) {
      await tg.sendMessage(guruh, "📭 Bugun uchun vazifa berilmagan.\nVazifa qo'shish: guruhda «Majlis: ...» yoki shaxsiy chatda /majlis_vazifa ...\n\n🏁 Majlis yopildi. Hammaga rahmat! 🙌");
      return;
    }
    await tg.sendMessage(guruh, `📌 Asadbek akadan olgan vazifalarim (${d.vazifalar.length} ta):\n\n${d.vazifalar.map((v, i) => `${i + 1}️⃣ ${v.matn}`).join('\n')}\n\n✂️ Endi vazifalarni bo'lib beraman…`);
    const ishlar = [];
    for (const [i, v] of d.vazifalar.entries()) {
      await tg.sendMessage(guruh, `━━━ ${i + 1}-vazifa ━━━\n${v.matn}`);
      ishlar.push(await bajar(guruh, v.matn, botlarHolati));
    }
    statistika.qayd('majlis');
    const xulosa = await tekshir(ishlar);
    const yakun = `📝 MAJLIS YAKUNI — Claude Asadbek tekshiruvi\n\n${xulosa}\n\n🏁 Majlis yopildi. Hammaga rahmat! 🙌`;
    await tg.sendMessage(guruh, yakun);
    if (String(guruh) !== String(egaChat)) await tg.sendMessage(egaChat, `🏛 Majlis yakunlandi (${kim}).\n\n${yakun}`);
    d.vazifalar = [];
    d.oxirgi = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
    majlisSaqla(d);
  } finally {
    majlisBormi = false;
  }
}

let egaChat = null;
let guruhOl = () => null;
let holatOl = async () => '';
function start(chatId, guruhFn, holatFn) {
  egaChat = chatId;
  guruhOl = guruhFn;
  holatOl = holatFn;
  setInterval(() => {
    const d = majlis();
    const g = guruhOl();
    if (!g || !d.soat) return;
    const t = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', hour12: false });
    const kun = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
    const [hh, mm] = d.soat.split(':').map(Number);
    const [th, tm] = t.split(':').map(Number);
    const farq = th * 60 + tm - (hh * 60 + mm);
    if (farq >= 0 && farq < 10 && d.oxirgi !== kun) {
      d.oxirgi = kun;
      majlisSaqla(d);
      majlisOtkaz(g, holatOl, 'kunlik, avtomatik').catch((e) => console.error('majlis:', e.message));
    }
  }, 60 * 1000);
}

// ---------------------------------------------------------------- guruh xabarlari
// null - tegishli emas; {tur:'vazifa'|'majlis'|'majlis_vazifa', matn}
async function buyruqAjrat(message) {
  const t = String(message.text || message.caption || '').trim();
  const u = await username();
  if (/^\/majlis(@\w+)?$/i.test(t) || /^claude\s*[:,]?\s*majlis\s*[.!]?$/i.test(t)) return { tur: 'majlis' };
  const mv = t.match(/^majlis\s*:\s*([\s\S]+)/i);
  if (mv) return { tur: 'majlis_vazifa', matn: mv[1].trim() };
  if (/^\/(v|vazifa)(@\w+)?(\s|$)/i.test(t)) return { tur: 'vazifa', matn: t.replace(/^\/\w+(@\w+)?\s*/i, '') };
  // "Vazifa: ..." / "Claude, ..." - oddiy matn: boshqa botlar (privacy rejimida) buni ko'rmaydi
  const m = t.match(/^(vazifa|claude)\s*[:,]\s*([\s\S]+)/i);
  if (m) return { tur: 'vazifa', matn: m[2].trim() };
  const re = new RegExp(`@${u}\\b`, 'i');
  if (re.test(t)) return { tur: 'vazifa', matn: t.replace(re, '').trim() };
  const r = message.reply_to_message;
  if (r && r.from && r.from.is_bot && r.from.username && r.from.username.toLowerCase() === u.toLowerCase()) return { tur: 'vazifa', matn: t };
  return null;
}

async function guruhBuyrugi(guruh, message, botlarHolati) {
  const b = await buyruqAjrat(message);
  if (!b) return false;
  tg.reaksiya(guruh, message.message_id, '👀');
  const tugadi = (ok) => tg.reaksiya(guruh, message.message_id, ok ? '👌' : '🤷');
  try {
    if (b.tur === 'majlis') await majlisOtkaz(guruh, botlarHolati);
    else if (b.tur === 'majlis_vazifa') {
      const n = vazifaQosh(b.matn);
      await tg.sendMessage(guruh, `📌 Majlis kun tartibiga qo'shildi (${n}-vazifa). Majlis: «Claude, majlis» yoki har kuni ${majlis().soat} da.`, { reply_to_message_id: message.message_id });
    } else {
      const ish = await bajar(guruh, b.matn, botlarHolati);
      if (ish.natijalar.some((n) => n.bot !== 'claude')) {
        await tg.sendMessage(guruh, `🔎 Claude Asadbek tekshiruvi:\n\n${await tekshir([ish])}`);
      }
    }
    tugadi(true);
  } catch (e) {
    console.error('agentlar:', e.message);
    tugadi(false);
  }
  return true;
}

// ---------------------------------------------------------------- shaxsiy chat buyruqlari (egasi)
async function handleText(chatId, text) {
  const t = String(text || '').trim();
  if (/^\/majlis_vazifa\s+/i.test(t)) {
    const n = vazifaQosh(t.replace(/^\/majlis_vazifa\s+/i, ''));
    await tg.sendMessage(chatId, `📌 Majlis kun tartibiga qo'shildi (${n} ta vazifa).`);
    return true;
  }
  if (/^\/majlis_soat\s+\d{1,2}:\d{2}$/i.test(t)) {
    const d = majlis();
    d.soat = t.split(/\s+/)[1].padStart(5, '0');
    majlisSaqla(d);
    await tg.sendMessage(chatId, `⏰ Kunlik majlis endi har kuni ${d.soat} da.`);
    return true;
  }
  if (t === '🏛 Majlis' || /^\/majlis$/i.test(t)) {
    const d = majlis();
    await tg.sendMessage(chatId, `🏛 Majlis\n\n⏰ Har kuni: ${d.soat}\n📌 Kun tartibi (${d.vazifalar.length} ta):\n${d.vazifalar.map((v, i) => `${i + 1}. ${v.matn}`).join('\n') || '— bo\'sh'}\n\n➕ /majlis_vazifa matn — vazifa qo'shish\n⏰ /majlis_soat 09:30 — vaqtni o'zgartirish`, {
      reply_markup: { inline_keyboard: [[{ text: '▶ Majlisni hozir boshlash', callback_data: 'ag:majlis' }], [{ text: '🗑 Kun tartibini tozalash', callback_data: 'ag:tozala' }]] },
    });
    return true;
  }
  if (/^\/bot_qosh\b/i.test(t)) {
    const q = t.replace(/^\/bot_qosh\s*/i, '').split('|').map((x) => x.trim());
    if (q.length < 2 || !q[0]) {
      await tg.sendMessage(chatId, "➕ Yangi bot ulash:\n/bot_qosh nomi | nima ish qiladi | agent eshigi url\n\nMisol:\n/bot_qosh Kassa bot | kassa hisobotlari, kunlik tushum | https://misol.uz/agent\n\nurl bo'lmasa ham qo'shiladi (keyin /bot_qosh bilan url qo'shasiz). Botga nima qo'shish kerakligi: BOT-ULASH.md");
      return true;
    }
    const id = q[0].toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || `bot${Date.now() % 10000}`;
    const d = oqiJson(FAYL, {});
    const eski = d[id] || {};
    d[id] = { ...eski, nomi: q[0].slice(0, 60), ish: (q[1] || eski.ish || '').slice(0, 300), url: q[2] || eski.url || '', belgi: eski.belgi || '🤖', kalit: eski.kalit || crypto.randomBytes(12).toString('hex') };
    yozJson(FAYL, d);
    await tg.sendMessage(chatId, `✅ «${d[id].nomi}» jamoaga qo'shildi (id: ${id}).\n\n🔑 Agent kaliti: ${d[id].kalit}\nBot so'rovdagi X-Agent-Kalit sarlavhasini shu bilan solishtirsin.\n\n${d[id].url ? '🔗 Agent eshigi: ' + d[id].url : "⚠️ url yo'q — vazifa berilmaydi. Url tayyor bo'lgach: /bot_qosh " + d[id].nomi + ' | ' + d[id].ish + ' | url'}\n\nBotni guruhga ham qo'shing — natijani o'zi yozadi.`);
    return true;
  }
  if (/^\/bot_ochir\s+\S+/i.test(t)) {
    const id = t.split(/\s+/)[1].toLowerCase();
    const d = oqiJson(FAYL, {});
    if (!d[id]) { await tg.sendMessage(chatId, `«${id}» topilmadi (standart botlarni o'chirib bo'lmaydi).`); return true; }
    delete d[id];
    yozJson(FAYL, d);
    await tg.sendMessage(chatId, `🗑 «${id}» jamoadan chiqarildi.`);
    return true;
  }
  if (/^\/jamoa$/i.test(t)) {
    const A = agentlar();
    await tg.sendMessage(chatId, `🤝 Jamoa (${Object.keys(A).length} ta bot):\n\n${Object.entries(A).map(([id, a]) => `${a.belgi || '🤖'} ${a.nomi} (${id}) — ${ulanganmi(id, a) ? '🟢 ulangan' : '⚪ ulanmagan'}\n    ${a.ish}`).join('\n')}\n\n➕ /bot_qosh — yangi bot ulash`);
    return true;
  }
  return false;
}

async function handleCallback(cq) {
  const data = cq.data || '';
  if (!data.startsWith('ag:')) return false;
  await tg.answerCallbackQuery(cq.id);
  if (data === 'ag:majlis') {
    const g = guruhOl();
    if (!g) { await tg.sendMessage(cq.message.chat.id, "Avval guruhda /botlar_guruhi yozing."); return true; }
    await tg.sendMessage(cq.message.chat.id, '🏛 Majlis guruhda boshlandi.');
    majlisOtkaz(g, holatOl).catch((e) => console.error('majlis:', e.message));
  } else if (data === 'ag:tozala') {
    const d = majlis();
    d.vazifalar = [];
    majlisSaqla(d);
    await tg.editMessageText(cq.message.chat.id, cq.message.message_id, '🗑 Kun tartibi tozalandi.');
  }
  return true;
}

module.exports = { bajar, buyruqAjrat, guruhBuyrugi, handleText, handleCallback, start, agentlar };
