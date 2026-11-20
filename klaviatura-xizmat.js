/* ⌨️ Sof Özbek klaviatura — foydalanuvchilardan fikr va yangi so'zlarni yig'ish (faqat server, kompyuterga bog'liq emas).

   Telefon ilovasi (https://inok.uz/claude-pc/klaviatura/...):
     POST /klaviatura/sozlar {q, v, s:[...]}            lug'atda yo'q, telefonda kamida 3 marta yozilgan so'zlar
     POST /klaviatura/fikr   {q, v, a, tur, matn}       fikr ('fikr') yoki ilova xatosi ('xato') -> darhol adminga
     GET  /klaviatura/lugat  -> {versiya, sozlar:[...]}  tasdiqlangan qo'shimcha so'zlar (ilova kuniga 1 marta oladi)
   q - anonim qurilma raqami (ilova o'zi yasaydi), hech qanday shaxsiy ma'lumot yo'q.

   Har 4 kunda ("4 kunlik reja"): kamida 3 xil qurilmada yozilgan so'zlar lug'atga qo'shiladi (versiya+1),
   adminga hisobot: nechta foydalanuvchi, qo'shilgan so'zlar, nomzodlar, kelgan fikrlar.
   Admin buyruqlari: /klaviatura_hisobot - hozir hisobot va lug'atni yangilash; /lugat_ochir so'z - so'zni olib tashlash. */
const fs = require('fs');
const path = require('path');
const tg = require('./telegram-api');

const YIGIM = path.join(__dirname, 'data', 'klaviatura-yigim.json');
const LUGAT = path.join(__dirname, 'data', 'klaviatura-lugat.json');
const REJA_MS = 4 * 24 * 60 * 60 * 1000;
const KAMIDA_QURILMA = 3;
const SOZ_RE = /^[a-zöğşçʼ]{3,20}$/;
const Q_RE = /^[a-zA-Z0-9-]{8,40}$/;

let ADMIN = null;

function oqi(f, def) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; }
}

function yoz(f, d) {
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d)); } catch (e) {
    console.error('klaviatura-xizmat yozish:', e.message);
  }
}

let yigim = null;
let lugat = null;
function yuklash() {
  if (!yigim) yigim = oqi(YIGIM, { sozlar: {}, qurilmalar: {}, fikrlar: [], oxirgiReja: Date.now() });
  if (!lugat) lugat = oqi(LUGAT, { versiya: 0, sozlar: [], qora: [] });
}

let saqlashTaymer = null;
function saqla() {
  if (saqlashTaymer) return;
  saqlashTaymer = setTimeout(() => { saqlashTaymer = null; yoz(YIGIM, yigim); }, 5000);
}

// ---------- himoya: IP bo'yicha soatiga 40 so'rov ----------
const ipHisob = new Map();
function ruxsatmi(req) {
  const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0];
  const soat = Math.floor(Date.now() / 3600000);
  const k = ip + '|' + soat;
  const n = (ipHisob.get(k) || 0) + 1;
  ipHisob.set(k, n);
  if (ipHisob.size > 5000) ipHisob.clear();
  return n <= 40;
}

function tanaOl(req, max) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > max) { req.destroy(); resolve(null); } });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

function json(res, kod, obj) {
  res.writeHead(kod, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const xatoEslatildi = new Map(); // bir xil xato kuniga 1 marta

function handleHttp(req, res) {
  const url = req.url.split('?')[0].replace(/\/+$/, '');
  const m = url.match(/\/klaviatura\/(sozlar|fikr|lugat)$/);
  if (!m) return false;
  yuklash();
  if (m[1] === 'lugat' && req.method === 'GET') {
    json(res, 200, { versiya: lugat.versiya, sozlar: lugat.sozlar });
    return true;
  }
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return true; }
  if (!ruxsatmi(req)) { json(res, 429, { xato: "ko'p so'rov" }); return true; }
  const max = m[1] === 'fikr' ? 8000 : 20000;
  tanaOl(req, max).then((b) => {
    if (!b || !Q_RE.test(String(b.q || ''))) return json(res, 400, { xato: "noto'g'ri so'rov" });
    const q = String(b.q);
    yigim.qurilmalar[q] = { vaqt: Date.now(), v: String(b.v || '').slice(0, 20) };
    if (m[1] === 'sozlar') {
      const sozlar = Array.isArray(b.s) ? b.s.slice(0, 300) : [];
      const qora = new Set(lugat.qora);
      const bor = new Set(lugat.sozlar);
      for (const x of sozlar) {
        const s = String(x || '').toLowerCase();
        if (!SOZ_RE.test(s) || qora.has(s) || bor.has(s)) continue;
        const e = yigim.sozlar[s] || (yigim.sozlar[s] = { q: [] });
        if (!e.q.includes(q) && e.q.length < 50) e.q.push(q);
      }
      saqla();
      return json(res, 200, { ok: true });
    }
    // fikr / xato
    const tur = b.tur === 'xato' ? 'xato' : 'fikr';
    const matn = String(b.matn || '').trim().slice(0, 3500);
    if (!matn) return json(res, 400, { xato: "bo'sh" });
    yigim.fikrlar.push({ vaqt: Date.now(), tur, v: String(b.v || '').slice(0, 20), a: String(b.a || '').slice(0, 40), matn: matn.slice(0, 1500) });
    if (yigim.fikrlar.length > 500) yigim.fikrlar = yigim.fikrlar.slice(-500);
    saqla();
    json(res, 200, { ok: true });
    if (ADMIN) {
      if (tur === 'xato') {
        const kalit = matn.split('\n').slice(0, 3).join('|');
        const oldin = xatoEslatildi.get(kalit);
        if (oldin && Date.now() - oldin < 24 * 3600 * 1000) return;
        xatoEslatildi.set(kalit, Date.now());
        tg.sendMessage(ADMIN, `🐞 Klaviatura xatosi (v${b.v || '?'}, ${b.a || 'Android ?'})\n\n${matn.slice(0, 1500)}`).catch(() => {});
      } else {
        tg.sendMessage(ADMIN, `💬 Klaviatura haqida fikr (v${b.v || '?'})\n\n${matn}`).catch(() => {});
      }
    }
    return undefined;
  });
  return true;
}

/** 4 kunlik reja: so'zlarni tasdiqlash va hisobot. */
async function reja(qolda) {
  yuklash();
  const hozir = Date.now();
  const oldingi = yigim.oxirgiReja || 0;
  const qora = new Set(lugat.qora);
  const bor = new Set(lugat.sozlar);
  const yangi = [];
  const nomzod = [];
  for (const [s, e] of Object.entries(yigim.sozlar)) {
    if (qora.has(s) || bor.has(s)) { delete yigim.sozlar[s]; continue; }
    if (e.q.length >= KAMIDA_QURILMA) { yangi.push(s); delete yigim.sozlar[s]; } else nomzod.push([s, e.q.length]);
  }
  if (yangi.length) {
    lugat.sozlar.push(...yangi.sort());
    lugat.versiya += 1;
    yoz(LUGAT, lugat);
  }
  const faol = Object.values(yigim.qurilmalar).filter((x) => hozir - x.vaqt < REJA_MS).length;
  const jami = Object.keys(yigim.qurilmalar).length;
  const versiyalar = {};
  for (const x of Object.values(yigim.qurilmalar)) if (hozir - x.vaqt < REJA_MS) versiyalar[x.v] = (versiyalar[x.v] || 0) + 1;
  const fikrlar = yigim.fikrlar.filter((f) => f.vaqt > oldingi);
  yigim.oxirgiReja = hozir;
  yoz(YIGIM, yigim);

  nomzod.sort((a, b) => b[1] - a[1]);
  let t = `⌨️ Klaviatura — ${qolda ? 'hisobot' : '4 kunlik reja'}\n\n`;
  t += `👥 Faol foydalanuvchilar (4 kun): ${faol} (jami ${jami})\n`;
  if (Object.keys(versiyalar).length) t += `📱 Versiyalar: ${Object.entries(versiyalar).map(([v, n]) => `${v || '?'}: ${n}`).join(', ')}\n`;
  t += `\n📚 Lug'atga qo'shildi: ${yangi.length} ta so'z (lug'at qo'shimchasi v${lugat.versiya}, jami ${lugat.sozlar.length})\n`;
  if (yangi.length) t += yangi.slice(0, 60).join(', ') + (yangi.length > 60 ? ' ...' : '') + '\n';
  if (nomzod.length) t += `\n⏳ Nomzodlar (${KAMIDA_QURILMA} ta qurilmaga yetmagan): ${nomzod.slice(0, 25).map(([s, n]) => `${s}(${n})`).join(', ')}\n`;
  const oddiy = fikrlar.filter((f) => f.tur === 'fikr');
  const xatolar = fikrlar.filter((f) => f.tur === 'xato');
  t += `\n💬 Fikrlar: ${oddiy.length}, 🐞 xatolar: ${xatolar.length}\n`;
  for (const f of oddiy.slice(-15)) t += `• ${f.matn.slice(0, 200)}\n`;
  t += "\nYangi so'zlar telefonlarga 1 kun ichida o'zi yetib boradi.\nKeraksiz so'zni olib tashlash: /lugat_ochir so'z";
  if (ADMIN) {
    for (let i = 0; i < t.length; i += 3800) await tg.sendMessage(ADMIN, t.slice(i, i + 3800)).catch(() => {});
  }
}

async function handleText(chatId, text) {
  if (/^\/klaviatura_hisobot\b/.test(text || '')) { await reja(true); return true; }
  const m = (text || '').match(/^\/lugat_ochir\s+(\S+)/);
  if (m) {
    yuklash();
    const s = m[1].toLowerCase();
    lugat.sozlar = lugat.sozlar.filter((x) => x !== s);
    if (!lugat.qora.includes(s)) lugat.qora.push(s);
    lugat.versiya += 1;
    yoz(LUGAT, lugat);
    delete yigim.sozlar[s];
    saqla();
    await tg.sendMessage(chatId, `🗑 "${s}" lug'atdan olib tashlandi va boshqa qo'shilmaydi.`);
    return true;
  }
  return false;
}

function start(adminChatId) {
  ADMIN = adminChatId;
  yuklash();
  setInterval(() => {
    if (Date.now() - (yigim.oxirgiReja || 0) >= REJA_MS) reja(false).catch((e) => console.error('klaviatura reja:', e.message));
  }, 60 * 60 * 1000);
}

module.exports = { handleHttp, handleText, start };
