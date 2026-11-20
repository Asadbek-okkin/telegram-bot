/* "🤖 Claude Code" tugmasi: kompyuterdagi ochiq Claude Code sessiyalari - nechta, mavzusi, holati -
va tanlangan sessiyaga Telegram'dan xabar yuborish.

Kompyuterdagi hook (hooks/claude_telegram.py holat) har hodisada shu serverga holat yuboradi:
  POST /claude-pc/holat {sid, loyiha, mavzu, holat, izoh, ol}  -> {xabarlar: [...]}
     holat: ishlayapti | kutyapti | tayyor | tugadi ;  ol=true bo'lsa navbatdagi xabarlar olinadi (o'chiriladi)
  POST /claude-pc/kut   {sid}  -> {xabarlar: [...]}   (xabar bo'lmasa ~25 s ushlab turadi; bo'sh sessiya kutish uchun) */
const fs = require('fs');
const path = require('path');
const tg = require('./telegram-api');

const CHAT_ID = '313364362';
const TUGMA = '🤖 Claude Code';
const KEYBOARD_ROWS = [[TUGMA]];
const FAYL = path.join(__dirname, 'data', 'claude-sessiyalar.json');
const USHLASH_MS = 25 * 1000;
const UNUTISH_MS = 24 * 60 * 60 * 1000; // shuncha jim sessiya ro'yxatdan o'chadi
const JIM_MS = 15 * 60 * 1000; // "ishlayapti" holatida shuncha xabarsiz - shubhali

let sessiyalar = {}; // sid -> {sid, loyiha, mavzu, holat, izoh, oxirgi, boshlangan, navbat:[{matn, ackId}]}
const kutuvchilar = new Map(); // sid -> Set<{res, timer}>
let yozishSid = null; // "✉️ yozish" bosilgandan keyin keyingi matn shu sessiyaga ketadi

try { sessiyalar = JSON.parse(fs.readFileSync(FAYL, 'utf8')) || {}; } catch {}

function saqla() {
  try {
    fs.mkdirSync(path.dirname(FAYL), { recursive: true });
    fs.writeFileSync(FAYL, JSON.stringify(sessiyalar));
  } catch (e) { console.error('claude-sessiya saqlash:', e.message); }
}

function tozala() {
  const chegara = Date.now() - UNUTISH_MS;
  for (const [sid, s] of Object.entries(sessiyalar)) if (s.oxirgi < chegara) delete sessiyalar[sid];
}

function qachon(ms) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return 'hozirgina';
  if (s < 3600) return `${Math.floor(s / 60)} daq. oldin`;
  return `${Math.floor(s / 3600)} soat ${Math.floor((s % 3600) / 60)} daq. oldin`;
}

function nomi(s) {
  return s.mavzu || 'Yangi sessiya';
}

function belgi(s) {
  if (s.holat === 'ishlayapti') return Date.now() - s.oxirgi > JIM_MS ? '🟠' : '🟢';
  if (s.holat === 'kutyapti') return '🟡';
  return '⚪';
}

function holatQisqa(s) {
  if (s.holat === 'ishlayapti') {
    if (Date.now() - s.oxirgi > JIM_MS) return `ishlayapti(?) — ${qachon(s.oxirgi)} dan beri xabar yo'q`;
    return 'ishlayapti';
  }
  if (s.holat === 'kutyapti') return `JAVOBINGIZNI KUTYAPTI${s.izoh ? ` (${s.izoh})` : ''}`;
  return "bo'sh — topshiriq kutyapti";
}

function tartibli() {
  tozala();
  return Object.values(sessiyalar).sort((a, b) => (a.boshlangan || 0) - (b.boshlangan || 0));
}

function ogohlantirish() {
  if (oxirgiRoyxat && Date.now() - oxirgiRoyxat > 3 * 60 * 1000) {
    return `⚠️ Kompyuterdan ma'lumot kelmayapti (oxirgisi ${qachon(oxirgiRoyxat)}) — kompyuter o'chiq bo'lishi mumkin.\n\n`;
  }
  return '';
}

function royxat() {
  const list = tartibli();
  if (!list.length) return { list, matn: `${ogohlantirish()}🤖 Claude Code: ochiq sessiya yo'q.` };
  const loyihalar = new Set(list.map((s) => s.loyiha));
  let m = `${ogohlantirish()}🤖 Claude Code — ${list.length} ta sessiya\n`;
  list.forEach((s, i) => {
    m += `\n${belgi(s)} ${i + 1}. ${nomi(s)}`;
    if (loyihalar.size > 1) m += `  📁 ${s.loyiha}`;
    m += `\n      ${holatQisqa(s)}`;
  });
  m += '\n\n👇 Sessiyani tanlang — natijasini ko\'rasiz va unga yozasiz.';
  return { list, matn: m };
}

function qisqart(t, n) {
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function tugmalar(list) {
  const q = list.slice(0, 10).map((s, i) => [{ text: `${belgi(s)} ${i + 1}. ${qisqart(nomi(s), 34)}`, callback_data: `cs:och:${s.sid.slice(0, 12)}` }]);
  q.push([{ text: '🔄 Yangilash', callback_data: 'cs:yangila' }]);
  return { inline_keyboard: q };
}

// Bitta sessiya kartasi: holat + oxirgi natija; karta ochiq turganda yozilgan matn shu sessiyaga ketadi.
function karta(s) {
  const raqam = tartibli().findIndex((x) => x.sid === s.sid) + 1;
  let m = `${belgi(s)} ${raqam}. ${nomi(s)}\n📁 ${s.loyiha} · ${holatQisqa(s)}`;
  if (s.natija) {
    const n = s.natija.length > 2500 ? '…' + s.natija.slice(-2500) : s.natija;
    m += `\n\n📄 Oxirgi natija (${qachon(s.natijaVaqt || s.oxirgi)}):\n${n}`;
  } else {
    m += '\n\n📄 Hali natija yo\'q.';
  }
  if (s.navbat && s.navbat.length) m += `\n\n📨 ${s.navbat.length} ta xabaringiz yetkazilishini kutyapti.`;
  m += '\n\n✍️ Shu yerga yozing — xabaringiz shu sessiyaga boradi.';
  return m;
}

function kartaTugmalari(s) {
  const q = [[{ text: '⬅️ Ro\'yxat', callback_data: 'cs:yangila' }]];
  if (s) q.unshift([{ text: '⏹ Sessiyani yopish', callback_data: `cs:yop?:${s.sid.slice(0, 12)}` }]);
  if (s && s.natija && s.natija.length > 2500) q.unshift([{ text: "📄 To'liq javobni o'qish", callback_data: `cs:tol:${s.sid.slice(0, 12)}` }]);
  return { inline_keyboard: q };
}

function json(res, kod, obj) {
  if (res.writableEnded) return;
  res.writeHead(kod, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function navbatniOl(s) {
  const x = s.navbat || [];
  s.navbat = [];
  for (const n of x) if (n.ackId) tg.editMessageText(CHAT_ID, n.ackId, `✅ Claude xabaringizni oldi (${s.mavzu || s.loyiha}):\n${n.matn.replace(/\[\[rasm:[0-9a-f]+\]\]/g, '🖼 rasm')}`);
  return x.map((n) => n.matn);
}

function kutuvchigaBer(sid) {
  const set = kutuvchilar.get(sid);
  const s = sessiyalar[sid];
  if (!set || !set.size || !s || !(s.navbat || []).length) return;
  const k = [...set][0];
  set.delete(k);
  clearTimeout(k.timer);
  json(k.res, 200, { xabarlar: navbatniOl(s) });
  saqla();
}

// Kompyuterdagi Claude Code'ning o'z ro'yxati (~/.claude/sessions): ochiq sessiyalarning to'liq to'plami.
// Unda yo'q sessiya - yopilgan; bor, lekin serverda yo'q - hook hali ishlamagan sessiya (qo'shiladi).
let oxirgiRoyxat = 0; // kompyuterdan oxirgi to'liq ro'yxat kelgan vaqt

function royxatniMoslash(royxat) {
  oxirgiRoyxat = Date.now();
  const bor = new Set();
  for (const r of royxat) {
    const sid = String(r.sid || '').slice(0, 64);
    if (!sid) continue;
    bor.add(sid);
    const s = sessiyalar[sid] || { sid, boshlangan: Date.now(), navbat: [], oxirgi: Date.now() };
    s.loyiha = String(r.loyiha || s.loyiha || 'loyiha').slice(0, 80);
    if (r.mavzu) s.mavzu = String(r.mavzu).slice(0, 120);
    const yangi = r.holat;
    const ozgardi = s.holat !== yangi && !(s.holat === 'kutyapti' && yangi === 'ishlayapti');
    if (!s.holat || ozgardi) {
      s.holat = yangi;
      s.izoh = '';
      s.oxirgi = Date.now();
    } else if (yangi !== 'ishlayapti') {
      s.oxirgi = Date.now(); // bo'sh/kutayotgan sessiya tirik - "ishlayapti(?)" shubhasi faqat ishlayotganlarga
    }
    sessiyalar[sid] = s;
  }
  for (const sid of Object.keys(sessiyalar)) if (!bor.has(sid)) delete sessiyalar[sid];
}

// ---------------------------------------------------------------- 🧩 VS Code: kerakli sessiyani kompyuterda ochish
// Kuzatuvchi (hooks/claude_telegram.py kuzat, foydalanuvchi sessiyasida) har 30 s so'nggi sessiyalarni yuboradi
// (holat.songgi) va POST /vs-kut ni long-poll qiladi. Tugma bosilsa - unga {id, sid} beriladi; kuzatuvchi
// VS Code'da shu sessiya papkasini ochadi va sessiyani davom ettiradi, keyin POST /vs-natija {id, ok, xato}.
let songgi = []; // [{sid, loyiha, mavzu, vaqt}] - yangisi birinchi
let vsNavbat = null; // {id, sid, chatId, msgId, vaqt}
const vsKutuvchilar = new Set(); // {res, timer}
const vsYuborilgan = new Map(); // id -> buyruq
let oxirgiVsKut = 0;

// ---------------------------------------------------------------- 🎨 AI Studio (D:\ai-studio) yoqish/o'chirish
// Kuzatuvchi har 30 s holatni yuboradi (holat.ai: {ishlayapti, manzillar, pin}); buyruqlar shu /vs-kut kanalidan.
let aiHolat = null;

function aiMatni(bosh = '') {
  let m = bosh ? `${bosh}\n\n` : '';
  if (!vsUlanganmi()) return `${m}🎨 AI Studio\n\n⚠️ Kompyuterdagi kuzatuvchi ulanmagan (kompyuter o'chiq yoki Windows'ga kirilmagan).`;
  if (!aiHolat) return `${m}🎨 AI Studio\n\nHolati hali ma'lum emas — 🔄 Yangilash.`;
  if (!aiHolat.ishlayapti) return `${m}🎨 AI Studio — ⚪ o'chiq`;
  m += '🎨 AI Studio — 🟢 ishlayapti';
  const ml = aiHolat.manzillar || [];
  if (ml.length && aiHolat.pin) {
    m += '\n\n📱 Telefondan ochish (bosing — PIN avtomatik kiritiladi):';
    for (const u of ml) {
      const tailscale = /^https:\/\/100\./.test(u);
      m += `\n${tailscale ? '🌍 Istalgan joydan (Tailscale yoqilgan telefonda)' : '🏢 Ofis Wi-Fi\'ida'}:\n${u}/kirish?pin=${aiHolat.pin}`;
    }
    m += `\n\nPIN: ${aiHolat.pin}\nBirinchi ochilganda «xavfsiz emas» chiqadi → «Qo'shimcha» → «Baribir o'tish».`;
  }
  return m;
}

function aiTugmalar() {
  const q = [];
  if (aiHolat && aiHolat.ishlayapti) q.push([{ text: "⏹ AI Studio'ni o'chirish", callback_data: 'cs:ai:ochir' }]);
  else q.push([{ text: "▶ AI Studio'ni yoqish", callback_data: 'cs:ai:yoq' }]);
  q.push([{ text: '🔄 Yangilash', callback_data: 'cs:ai' }]);
  return { inline_keyboard: q };
}

function vsUlanganmi() {
  return vsKutuvchilar.size > 0 || Date.now() - oxirgiVsKut < 90 * 1000;
}

function vsRoyxat() {
  const ochiq = new Set(Object.keys(sessiyalar));
  const list = songgi.slice(0, 12);
  if (!vsUlanganmi()) {
    return { list: [], matn: "🧩 VS Code\n\n⚠️ Kompyuterdagi kuzatuvchi ulanmagan (kompyuter o'chiq yoki Windows'ga kirilmagan).\nkuzatuvchini-ornatish.bat ishga tushirilganini tekshiring." };
  }
  if (!list.length) return { list, matn: "🧩 VS Code\n\nClaude Code sessiyalari topilmadi." };
  let m = '🧩 VS Code — Claude Code sessiyalari\n';
  list.forEach((s, i) => {
    m += `\n${ochiq.has(s.sid) ? '🟢' : '⚪'} ${i + 1}. ${s.mavzu || 'Nomsiz sessiya'}\n      📁 ${s.loyiha} · ${qachon(s.vaqt)}`;
  });
  m += "\n\n🟢 — hozir ochiq.\n👇 Sessiyani tanlang — kompyuterda VS Code shu loyihada ochiladi va sessiya davom ettiriladi.";
  return { list, matn: m };
}

function vsTugmalar(list) {
  const q = list.map((s, i) => [{ text: `${i + 1}. ${qisqart(s.mavzu || 'Nomsiz sessiya', 30)} · ${qisqart(s.loyiha, 14)}`, callback_data: `cs:vso:${s.sid.slice(0, 12)}` }]);
  q.push([{ text: '🔄 Yangilash', callback_data: 'cs:vs' }]);
  return { inline_keyboard: q };
}

function vsBuyruqBer() {
  if (!vsNavbat || !vsKutuvchilar.size) return;
  const k = [...vsKutuvchilar][0];
  vsKutuvchilar.delete(k);
  clearTimeout(k.timer);
  const b = vsNavbat;
  vsNavbat = null;
  vsYuborilgan.set(b.id, b);
  json(k.res, 200, { buyruq: { id: b.id, sid: b.sid, amal: b.amal || 'och' } });
}

function vsKut(res) {
  oxirgiVsKut = Date.now();
  const k = { res, timer: null };
  k.timer = setTimeout(() => { vsKutuvchilar.delete(k); oxirgiVsKut = Date.now(); json(res, 200, { buyruq: null }); }, USHLASH_MS);
  vsKutuvchilar.add(k);
  res.on('close', () => { if (!res.writableEnded) { clearTimeout(k.timer); vsKutuvchilar.delete(k); } });
  vsBuyruqBer();
}

async function vsNatija(n) {
  const b = vsYuborilgan.get(String(n.id || ''));
  if (!b) return;
  vsYuborilgan.delete(b.id);
  if (String(b.amal || '').startsWith('ai-')) {
    if (n.ai && typeof n.ai === 'object') aiHolat = n.ai;
    const bosh = n.ok
      ? (b.amal === 'ai-yoq' ? '✅ AI Studio yoqildi.' : b.amal === 'ai-ochir' ? "⏹ AI Studio o'chirildi." : '')
      : `⚠️ ${String(n.xato || 'xato').slice(0, 200)}`;
    await tg.editMessageText(b.chatId, b.msgId, aiMatni(bosh), { reply_markup: aiTugmalar(), disable_web_page_preview: true });
    return;
  }
  if (b.amal === 'yop') {
    const sx = sessiyalar[b.sid] || {};
    if (n.ok) { delete sessiyalar[b.sid]; saqla(); }
    const r = royxat();
    await tg.editMessageText(b.chatId, b.msgId, `${n.ok ? `⏹ Sessiya yopildi: ${nomi(sx)}` : `⚠️ Yopib bo'lmadi: ${String(n.xato || 'xato').slice(0, 200)}`}\n\n${r.matn}`, { reply_markup: tugmalar(r.list) });
    return;
  }
  const s = songgi.find((x) => x.sid === b.sid) || {};
  const bosh = n.ok
    ? `✅ VS Code'da ochildi: ${s.mavzu || 'sessiya'} (📁 ${s.loyiha || ''})`
    : `⚠️ Ochib bo'lmadi: ${String(n.xato || 'xato').slice(0, 200)}`;
  const { list, matn } = vsRoyxat();
  await tg.editMessageText(b.chatId, b.msgId, `${bosh}\n\n${matn}`, { reply_markup: vsTugmalar(list) });
}

function holatKeldi(b) {
  if (b.ai && typeof b.ai === 'object') {
    aiHolat = {
      ishlayapti: !!b.ai.ishlayapti,
      manzillar: (Array.isArray(b.ai.manzillar) ? b.ai.manzillar : []).map(String).filter((u) => /^https:\/\/[\d.]+:\d+$/.test(u)).slice(0, 4),
      pin: String(b.ai.pin || '').replace(/\D/g, '').slice(0, 8),
    };
  }
  if (Array.isArray(b.songgi)) {
    songgi = b.songgi
      .filter((r) => r && /^[0-9a-f-]{36}$/i.test(String(r.sid || '')))
      .slice(0, 20)
      .map((r) => ({ sid: String(r.sid), loyiha: String(r.loyiha || 'loyiha').slice(0, 80), mavzu: String(r.mavzu || '').slice(0, 120), vaqt: Number(r.vaqt) || Date.now() }));
  }
  if (Array.isArray(b.royxat)) royxatniMoslash(b.royxat);
  const sid = String(b.sid || '').slice(0, 64);
  if (!sid) { saqla(); return { xabarlar: [] }; }
  if (b.holat === 'tugadi') {
    delete sessiyalar[sid];
    saqla();
    return { xabarlar: [] };
  }
  const s = sessiyalar[sid] || { sid, boshlangan: Date.now(), navbat: [] };
  s.loyiha = String(b.loyiha || s.loyiha || 'loyiha').slice(0, 80);
  if (b.mavzu) s.mavzu = String(b.mavzu).slice(0, 120);
  if (b.holat) s.holat = b.holat;
  s.izoh = b.izoh ? String(b.izoh).slice(0, 80) : '';
  s.oxirgi = Date.now();
  if (b.xabar) { s.natija = String(b.xabar).slice(-20000); s.natijaVaqt = Date.now(); }
  sessiyalar[sid] = s;
  const xabarlar = b.ol ? navbatniOl(s) : [];
  saqla();
  if (b.bildir) bildir(s, String(b.xabar || '')).catch((e) => console.error('claude-sessiya bildir:', e.message));
  return { xabarlar };
}

// Claude ishni tugatdi, siz esa kompyuterdan uzoqdasiz: oxirgi xabarini yuboramiz; javob shu sessiyaga boradi.
// Javob to'liq yuboriladi (uzun bo'lsa bir necha qismga bo'linib); istalgan qismiga reply - shu sessiyaga.
function qismlarga(matn, n = 3800) {
  const q = [];
  let x = matn;
  while (x.length > n) {
    let k = x.lastIndexOf('\n', n);
    if (k < n / 2) k = n;
    q.push(x.slice(0, k));
    x = x.slice(k).replace(/^\n+/, '');
  }
  if (x) q.push(x);
  return q;
}

async function bildir(s, xabar) {
  let x = xabar.trim();
  if (x.length > 20000) x = '…(boshi qisqartirildi)\n' + x.slice(-20000);
  const bosh = `🤖 Claude javobi — ${s.mavzu || s.loyiha}\n📁 ${s.loyiha}\n\n`;
  const oxiri = "\n\n↩️ Javob yozing yoki 🎤 ovozli xabar yuboring — shu sessiyaga boradi va Claude davom etadi.";
  const qismlar = qismlarga(x || '(matn yo‘q)');
  s.bildirishIdlar = [];
  for (let i = 0; i < qismlar.length; i++) {
    const tartib = qismlar.length > 1 ? `(${i + 1}/${qismlar.length}) ` : '';
    const matn = (i === 0 ? bosh : '') + tartib + qismlar[i] + (i === qismlar.length - 1 ? oxiri : '');
    const r = await tg.sendMessage(CHAT_ID, matn);
    if (r && r.ok) {
      s.bildirishId = r.result.message_id;
      s.bildirishIdlar.push(r.result.message_id);
    }
  }
  s.bildirishVaqt = Date.now();
  saqla();
}

function navbatgaQoy(s, text, ackId) {
  s.navbat = s.navbat || [];
  s.navbat.push({ matn: text, ackId });
  saqla();
  kutuvchigaBer(s.sid);
}

function kut(b, res) {
  const sid = String(b.sid || '');
  const s = sessiyalar[sid];
  if (s && (s.navbat || []).length) { json(res, 200, { xabarlar: navbatniOl(s) }); return saqla(); }
  if (!kutuvchilar.has(sid)) kutuvchilar.set(sid, new Set());
  const set = kutuvchilar.get(sid);
  const k = { res, timer: null };
  k.timer = setTimeout(() => { set.delete(k); json(res, 200, { xabarlar: [] }); }, USHLASH_MS);
  set.add(k);
  res.on('close', () => { if (!res.writableEnded) { clearTimeout(k.timer); set.delete(k); } });
}

function bodyOqi(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 100000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function handleHttp(req, res, kalitTogri) {
  if (req.method !== 'POST') return false;
  const yol = req.url.split('?')[0].replace(/\/+$/, '');
  const amal = ['/holat', '/vs-kut', '/vs-natija', '/rasm', '/kut'].find((a) => yol.endsWith(a));
  if (!amal) return false;
  if (!kalitTogri(req.headers['x-kalit'])) { res.writeHead(403); res.end(); return true; }
  bodyOqi(req).then((b) => {
    try {
      if (amal === '/holat') return json(res, 200, holatKeldi(b));
      if (amal === '/rasm') { // kompyuterdagi hook Telegram'dan kelgan rasmni yuklab oladi
        const id = String(b.id || '');
        const f = path.join(RASM_PAPKA, `${id}.jpg`);
        if (!/^[0-9a-f]{16}$/.test(id) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        return res.end(fs.readFileSync(f));
      }
      if (amal === '/vs-kut') return vsKut(res);
      if (amal === '/vs-natija') {
        vsNatija(b).catch((e) => console.error('claude-sessiya vs-natija:', e.message));
        return json(res, 200, { ok: true });
      }
      return kut(b, res);
    } catch (e) {
      console.error('claude-sessiya:', e.message);
      return json(res, 500, {});
    }
  });
  return true;
}

async function handleText(chatId, text) {
  if (text !== TUGMA) return false;
  yozishSid = null;
  const { list, matn } = royxat();
  await tg.sendMessage(chatId, matn, { reply_markup: tugmalar(list) });
  return true;
}

async function handleCallback(cq) {
  const data = cq.data || '';
  if (!data.startsWith('cs:')) return false;
  const msgId = cq.message.message_id;
  if (data === 'cs:yangila') {
    yozishSid = null;
    const { list, matn } = royxat();
    await tg.answerCallbackQuery(cq.id);
    await tg.editMessageText(CHAT_ID, msgId, matn, { reply_markup: tugmalar(list) });
    return true;
  }
  if (data.startsWith('cs:rs:') || data.startsWith('cs:rk:')) return rasmCallback(cq, data, msgId);
  if (data === 'cs:ai') {
    yozishSid = null;
    await tg.answerCallbackQuery(cq.id);
    await tg.editMessageText(CHAT_ID, msgId, aiMatni(), { reply_markup: aiTugmalar(), disable_web_page_preview: true });
    return true;
  }
  if (data === 'cs:ai:yoq' || data === 'cs:ai:ochir') {
    if (!vsUlanganmi()) {
      await tg.answerCallbackQuery(cq.id, { text: 'Kompyuter ulanmagan' });
      return true;
    }
    const amal = data === 'cs:ai:yoq' ? 'ai-yoq' : 'ai-ochir';
    await tg.answerCallbackQuery(cq.id, { text: 'Buyruq yuborildi' });
    const id = require('crypto').randomBytes(6).toString('hex');
    vsNavbat = { id, amal, sid: '', chatId: cq.message.chat.id, msgId, vaqt: Date.now() };
    await tg.editMessageText(CHAT_ID, msgId, amal === 'ai-yoq' ? '⏳ AI Studio yoqilmoqda (1 daqiqagacha)...' : "⏳ AI Studio o'chirilmoqda...");
    vsBuyruqBer();
    setTimeout(() => {
      const navbatda = vsNavbat && vsNavbat.id === id;
      if (navbatda) vsNavbat = null;
      if (!vsYuborilgan.delete(id) && !navbatda) return;
      tg.editMessageText(CHAT_ID, msgId, aiMatni('⚠️ Kompyuter javob bermadi.'), { reply_markup: aiTugmalar(), disable_web_page_preview: true }).catch(() => {});
    }, 180 * 1000);
    return true;
  }
  if (data === 'cs:vs') {
    yozishSid = null;
    const { list, matn } = vsRoyxat();
    await tg.answerCallbackQuery(cq.id);
    await tg.editMessageText(CHAT_ID, msgId, matn, { reply_markup: vsTugmalar(list) });
    return true;
  }
  if (data.startsWith('cs:tol:')) {
    const s = Object.values(sessiyalar).find((x) => x.sid.startsWith(data.slice(7)));
    await tg.answerCallbackQuery(cq.id, { text: s && s.natija ? 'Yuborilmoqda' : 'Javob topilmadi' });
    if (s && s.natija) await bildir(s, s.natija);
    return true;
  }
  // ⏹ Sessiyani yopish: tasdiq -> kuzatuvchi kompyuterda shu sessiya jarayonini to'xtatadi
  if (data.startsWith('cs:yop?:') || data.startsWith('cs:yop!:')) {
    const tasdiq = data.startsWith('cs:yop!:');
    const bosh = data.slice(8);
    const s = Object.values(sessiyalar).find((x) => x.sid.startsWith(bosh));
    yozishSid = null;
    if (!s) {
      await tg.answerCallbackQuery(cq.id, { text: 'Sessiya allaqachon yopilgan' });
      const r = royxat();
      await tg.editMessageText(CHAT_ID, msgId, r.matn, { reply_markup: tugmalar(r.list) });
      return true;
    }
    if (!tasdiq) {
      await tg.answerCallbackQuery(cq.id);
      await tg.editMessageText(CHAT_ID, msgId, `⏹ «${nomi(s)}» sessiyasi yopilsinmi?\nClaude hozir ishlayotgan bo'lsa, ish to'xtaydi. Suhbat saqlanib qoladi — keyin 🧩 VS Code orqali qayta ochish mumkin.`, {
        reply_markup: { inline_keyboard: [[{ text: '⏹ Ha, yopish', callback_data: `cs:yop!:${bosh}` }, { text: "Yo'q", callback_data: `cs:och:${bosh}` }]] },
      });
      return true;
    }
    if (!vsUlanganmi()) {
      await tg.answerCallbackQuery(cq.id, { text: 'Kompyuter ulanmagan' });
      return true;
    }
    await tg.answerCallbackQuery(cq.id, { text: 'Buyruq yuborildi' });
    const id = require('crypto').randomBytes(6).toString('hex');
    vsNavbat = { id, amal: 'yop', sid: s.sid, chatId: cq.message.chat.id, msgId, vaqt: Date.now() };
    await tg.editMessageText(CHAT_ID, msgId, `⏳ Yopilmoqda: ${nomi(s)}...`);
    vsBuyruqBer();
    setTimeout(() => {
      const navbatda = vsNavbat && vsNavbat.id === id;
      if (navbatda) vsNavbat = null;
      if (!vsYuborilgan.delete(id) && !navbatda) return;
      tg.editMessageText(CHAT_ID, msgId, "⚠️ Kompyuter javob bermadi.", { reply_markup: kartaTugmalari(s) }).catch(() => {});
    }, 90 * 1000);
    return true;
  }
  if (data.startsWith('cs:vso:')) {
    const bosh = data.slice(7);
    const s = songgi.find((x) => x.sid.startsWith(bosh));
    if (!s || !vsUlanganmi()) {
      await tg.answerCallbackQuery(cq.id, { text: s ? 'Kompyuter ulanmagan' : 'Sessiya topilmadi' });
      const { list, matn } = vsRoyxat();
      await tg.editMessageText(CHAT_ID, msgId, matn, { reply_markup: vsTugmalar(list) });
      return true;
    }
    await tg.answerCallbackQuery(cq.id, { text: 'Buyruq yuborildi' });
    vsNavbat = { id: require('crypto').randomBytes(6).toString('hex'), sid: s.sid, chatId: cq.message.chat.id, msgId, vaqt: Date.now() };
    const id = vsNavbat.id;
    await tg.editMessageText(CHAT_ID, msgId, `⏳ VS Code ochilmoqda: ${s.mavzu || 'sessiya'} (📁 ${s.loyiha})...`);
    vsBuyruqBer();
    setTimeout(() => {
      const kutilgan = (vsNavbat && vsNavbat.id === id) || vsYuborilgan.has(id);
      if (!kutilgan) return;
      if (vsNavbat && vsNavbat.id === id) vsNavbat = null;
      vsYuborilgan.delete(id);
      const r = vsRoyxat();
      tg.editMessageText(CHAT_ID, msgId, `⚠️ Kompyuter javob bermadi.\n\n${r.matn}`, { reply_markup: vsTugmalar(r.list) }).catch(() => {});
    }, 90 * 1000);
    return true;
  }
  // cs:och: yangi; cs:yoz:/cs:nat: - eski xabarlardagi tugmalar ham karta ochadi
  if (data.startsWith('cs:och:') || data.startsWith('cs:yoz:') || data.startsWith('cs:nat:')) {
    const bosh = data.slice(7);
    const s = Object.values(sessiyalar).find((x) => x.sid.startsWith(bosh));
    await tg.answerCallbackQuery(cq.id);
    if (!s) {
      const { list, matn } = royxat();
      await tg.editMessageText(CHAT_ID, msgId, `Bu sessiya yopilgan.\n\n${matn}`, { reply_markup: tugmalar(list) });
      return true;
    }
    yozishSid = s.sid;
    s.bildirishId = msgId; // kartaga reply qilinsa ham shu sessiyaga
    saqla();
    await tg.editMessageText(CHAT_ID, msgId, karta(s), { reply_markup: kartaTugmalari(s) });
    return true;
  }
  await tg.answerCallbackQuery(cq.id);
  return true;
}

async function yubor(s, text, message) {
  const qachonOladi = s.holat === 'ishlayapti'
    ? 'Claude ishlayapti — keyingi qadamida oladi.'
    : s.holat === 'kutyapti'
      ? "Claude hozir boshqa savolingizga javob kutyapti — avval o'sha savolga javob bering; xabar keyin yetkaziladi."
      : 'Claude bo\'sh turgan edi — hozir uyg\'otiladi.';
  const r = await tg.sendMessage(CHAT_ID, `📨 Yuborildi → ${nomi(s)}\n${qachonOladi}`, { reply_to_message_id: message.message_id });
  navbatgaQoy(s, text, r && r.ok ? r.result.message_id : null);
}

// 1-bosqich (claude-savol'dan oldin): "✉️ yozish" bosilgan bo'lsa yoki "Claude ishni tugatdi" xabariga reply qilinsa.
async function handleMessage(message) {
  const text = (message.text || '').trim();
  if (!text) return false;
  const replyId = message.reply_to_message && message.reply_to_message.message_id;
  if (replyId) {
    const s = Object.values(sessiyalar).find((x) => x.bildirishId === replyId || (x.bildirishIdlar || []).includes(replyId));
    if (s) { await yubor(s, text, message); return true; }
  }
  if (!yozishSid) return false;
  if (text.startsWith('/') || /^\p{Extended_Pictographic}/u.test(text)) { yozishSid = null; return false; }
  const s = sessiyalar[yozishSid];
  // karta ochiq qoladi: ketma-ket bir nechta xabar yozish mumkin; boshqa tugma bosilsa yopiladi
  if (!s) { yozishSid = null; await tg.sendMessage(CHAT_ID, 'Bu sessiya endi yopilgan, xabar yuborilmadi.'); return true; }
  await yubor(s, text, message);
  return true;
}

// 2-bosqich (claude-savol ochiq savolni olmagan bo'lsa): oddiy matn so'nggi 60 daqiqadagi "ishni tugatdi" sessiyasiga.
async function handleFallback(message) {
  const text = (message.text || '').trim();
  if (!text || text.startsWith('/') || /^\p{Extended_Pictographic}/u.test(text) || message.reply_to_message) return false;
  const s = Object.values(sessiyalar)
    .filter((x) => x.holat === 'tayyor' && x.bildirishVaqt && Date.now() - x.bildirishVaqt < 60 * 60 * 1000)
    .sort((a, b) => b.bildirishVaqt - a.bildirishVaqt)[0];
  if (!s) return false;
  await yubor(s, text, message);
  return true;
}

// ---------------------------------------------------------------- 🖼 Skrinshot (rasm + izoh) sessiyaga
// Rasm serverda saqlanadi (data/claude-rasmlar/<id>.jpg); sessiyaga matn ichida [[rasm:<id>]] belgisi boradi,
// kompyuterdagi hook uni POST /rasm orqali yuklab olib, fayl yo'liga almashtiradi (Claude Read bilan ko'radi).
const RASM_PAPKA = path.join(__dirname, 'data', 'claude-rasmlar');
const kutilganRasmlar = new Map(); // kalit -> {message, kanalga, vaqt}

function rasmFaylId(message) {
  if (message.photo && message.photo.length) return message.photo[message.photo.length - 1].file_id;
  const d = message.document;
  if (d && /^image\//.test(d.mime_type || '')) return d.file_id;
  return null;
}

async function rasmniSessiyaga(s, message) {
  fs.mkdirSync(RASM_PAPKA, { recursive: true });
  const eski = Date.now() - 3 * 24 * 3600 * 1000;
  for (const f of fs.readdirSync(RASM_PAPKA)) {
    try { if (fs.statSync(path.join(RASM_PAPKA, f)).mtimeMs < eski) fs.unlinkSync(path.join(RASM_PAPKA, f)); } catch {}
  }
  const id = require('crypto').randomBytes(8).toString('hex');
  fs.writeFileSync(path.join(RASM_PAPKA, `${id}.jpg`), await tg.faylYukla(rasmFaylId(message)));
  const izoh = (message.caption || '').trim();
  await yubor(s, `${izoh || "(izohsiz rasm — rasmga qarab nima kerakligini tushunib oling)"}\n[[rasm:${id}]]`, message);
}

// true - rasm Claude'ga ketdi yoki qayerga yuborishni so'radik; false - Claude sessiyasi yo'q (kanal postiga)
async function handlePhoto(message, kanalga) {
  if (!rasmFaylId(message)) return false;
  const replyId = message.reply_to_message && message.reply_to_message.message_id;
  let s = replyId ? Object.values(sessiyalar).find((x) => x.bildirishId === replyId || (x.bildirishIdlar || []).includes(replyId)) : null;
  if (!s && yozishSid) s = sessiyalar[yozishSid];
  if (s) { await rasmniSessiyaga(s, message); return true; }
  const list = tartibli();
  if (!list.length) return false;
  const kalit = String(message.message_id);
  kutilganRasmlar.set(kalit, { message, kanalga, vaqt: Date.now() });
  for (const [k, v] of kutilganRasmlar) if (Date.now() - v.vaqt > 3600 * 1000) kutilganRasmlar.delete(k);
  const q = list.slice(0, 8).map((x, i) => [{ text: `🤖 ${i + 1}. ${qisqart(nomi(x), 34)}`, callback_data: `cs:rs:${kalit}:${x.sid.slice(0, 12)}` }]);
  q.push([{ text: '📢 Kanalga post', callback_data: `cs:rk:${kalit}` }]);
  await tg.sendMessage(CHAT_ID, '🖼 Bu rasm qayerga? Claude sessiyasini tanlang:', { reply_to_message_id: message.message_id, reply_markup: { inline_keyboard: q } });
  return true;
}

async function rasmCallback(cq, data, msgId) {
  const [, tur, kalit, bosh] = data.split(':');
  const k = kutilganRasmlar.get(kalit);
  if (!k) {
    await tg.answerCallbackQuery(cq.id, { text: 'Rasm eskirgan — qayta yuboring' });
    return true;
  }
  kutilganRasmlar.delete(kalit);
  await tg.answerCallbackQuery(cq.id);
  if (tur === 'rk') {
    await tg.editMessageText(CHAT_ID, msgId, '📢 Kanal postiga yuborildi.');
    await k.kanalga(k.message);
    return true;
  }
  const s = Object.values(sessiyalar).find((x) => x.sid.startsWith(bosh));
  if (!s) { await tg.editMessageText(CHAT_ID, msgId, 'Bu sessiya yopilgan, rasm yuborilmadi.'); return true; }
  await tg.editMessageText(CHAT_ID, msgId, `🖼 → ${nomi(s)}`);
  await rasmniSessiyaga(s, k.message);
  return true;
}

module.exports = { KEYBOARD_ROWS, handleHttp, handleText, handleCallback, handleMessage, handleFallback, handlePhoto };
